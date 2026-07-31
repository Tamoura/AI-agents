/**
 * Guardrails Engine — Input/output validation, content moderation, PII blocking.
 * Runs before and after LLM calls to enforce safety constraints.
 * Inspired by OpenAI Agents SDK guardrails but with governance integration.
 */

import {
  type DataClassification,
  DATA_CLASSIFICATION_RANK,
} from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GuardrailResult {
  readonly passed: boolean;
  readonly violations: readonly GuardrailViolation[];
  readonly sanitizedContent?: string;
}

export interface GuardrailViolation {
  readonly rule: string;
  readonly severity: "BLOCK" | "WARN" | "INFO";
  readonly message: string;
  readonly field?: string;
}

export interface GuardrailRule {
  readonly name: string;
  readonly description: string;
  readonly severity: "BLOCK" | "WARN" | "INFO";
  readonly check: (content: string, context?: GuardrailContext) => GuardrailViolation | null;
}

export interface GuardrailContext {
  readonly agentId?: string;
  readonly userId?: string;
  readonly dataClassification?: DataClassification;
  readonly direction: "input" | "output";
}

// ─── Normalization ─────────────────────────────────────────────────────────

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * Normalize content so detection rules see one canonical form:
 * Arabic-Indic digits (٠-٩ / ۰-۹) → ASCII, and common Arabic letter variants
 * (alef with hamza/madda → bare alef, ta marbuta → ha) so keyword patterns
 * match real Gulf traffic, not just MSA-with-Latin-digits.
 */
export function normalizeForDetection(content: string): string {
  return content
    .replace(ARABIC_INDIC_DIGITS, (d) => {
      const code = d.charCodeAt(0);
      return String((code >= 0x06f0 ? code - 0x06f0 : code - 0x0660) % 10);
    })
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ً-ٰٟ]/g, ""); // strip tashkeel/diacritics
}

// ─── Built-in Rules ─────────────────────────────────────────────────────────

/** Detects and blocks injection attempts in user input (English + Arabic). */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /<<SYS>>/i,
  /ADMIN\s*OVERRIDE/i,
  /\bdo\s+anything\s+now\b/i,
  /jailbreak/i,
  // Arabic-language injection markers (checked against normalized content)
  /تجاهل\s+(كل\s+)?(التعليمات|الاوامر)\s+السابقه/, // "ignore (all) previous instructions"
  /انت\s+الان\s+/,                                  // "you are now ..."
  /انس\s+(كل\s+)?ما\s+سبق/,                        // "forget (all) that came before"
  /تصرف\s+(كانك|بصفتك|بوصفك)/,                       // "act as / as if you are"
  /وضع\s+المطور/,                                    // "developer mode"
];

export const PROMPT_INJECTION_RULE: GuardrailRule = {
  name: "prompt_injection",
  description: "Blocks prompt injection attempts (English + Arabic)",
  severity: "BLOCK",
  check: (content) => {
    const normalized = normalizeForDetection(content);
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(content) || pattern.test(normalized)) {
        return {
          rule: "prompt_injection",
          severity: "BLOCK",
          message: `Potential prompt injection detected: matches pattern ${pattern.source}`,
        };
      }
    }
    return null;
  },
};

/** Detects PII in outputs to prevent data leakage. */
const PII_PATTERNS_OUTPUT = [
  // Qatar National ID: 11 digits, optionally QID-prefixed or in prose. Detected on normalized text.
  { pattern: /\bQID[-\s]?\d{11}\b/i, type: "Qatar National ID" },
  { pattern: /\b[23]\d{10}\b/, type: "Qatar National ID" },
  // Qatar IBAN: QA + 2 check digits + 25 alphanumerics; generic IBAN as fallback.
  { pattern: /\bQA\d{2}[A-Z0-9]{25}\b/i, type: "Qatar IBAN" },
  { pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, type: "IBAN" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, type: "Credit Card" },
  // Qatar mobile: +974 or 00974 then 3/5/6/7 + 7 digits; plus generic.
  { pattern: /(?:\+?974|00974)[\s-]?[3567]\d{3}[\s-]?\d{4}/, type: "Qatar Phone Number" },
  { pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, type: "Phone Number" },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, type: "Email Address" },
];

export const PII_LEAKAGE_RULE: GuardrailRule = {
  name: "pii_leakage",
  description: "Detects PII in agent outputs",
  severity: "WARN",
  check: (content, context) => {
    if (context?.direction !== "output") return null;

    const normalized = normalizeForDetection(content);
    for (const { pattern, type } of PII_PATTERNS_OUTPUT) {
      if (pattern.test(content) || pattern.test(normalized)) {
        return {
          rule: "pii_leakage",
          severity: "WARN",
          message: `Potential ${type} detected in output. Consider masking.`,
        };
      }
    }
    return null;
  },
};

/** Blocks content that exceeds the agent's data classification boundary. */
export const CLASSIFICATION_BOUNDARY_RULE: GuardrailRule = {
  name: "classification_boundary",
  description: "Blocks content exceeding data classification boundaries",
  severity: "BLOCK",
  check: (content, context) => {
    if (!context?.dataClassification) return null;

    const sensitiveTerms = [
      { terms: ["password", "secret", "private key", "api_key", "token"], classification: "RESTRICTED" },
      { terms: ["salary", "credit score", "account balance", "loan amount"], classification: "CONFIDENTIAL" },
    ];

    const agentRank = DATA_CLASSIFICATION_RANK[context.dataClassification];

    for (const { terms, classification } of sensitiveTerms) {
      const termRank = DATA_CLASSIFICATION_RANK[classification as DataClassification];
      if (termRank > agentRank) {
        for (const term of terms) {
          if (content.toLowerCase().includes(term)) {
            return {
              rule: "classification_boundary",
              severity: "BLOCK",
              message: `Content contains "${term}" which is ${classification}, exceeding agent's ${context.dataClassification} boundary.`,
            };
          }
        }
      }
    }
    return null;
  },
};

/** Limits output length to prevent runaway generation. */
export const MAX_OUTPUT_LENGTH_RULE: GuardrailRule = {
  name: "max_output_length",
  description: "Limits output to 50,000 characters",
  severity: "WARN",
  check: (content, context) => {
    if (context?.direction !== "output") return null;
    if (content.length > 50_000) {
      return {
        rule: "max_output_length",
        severity: "WARN",
        message: `Output length (${content.length}) exceeds 50,000 character limit.`,
      };
    }
    return null;
  },
};

/** Blocks SQL injection patterns. */
export const SQL_INJECTION_RULE: GuardrailRule = {
  name: "sql_injection",
  description: "Blocks SQL injection patterns in input",
  severity: "BLOCK",
  check: (content, context) => {
    if (context?.direction !== "input") return null;

    const sqlPatterns = [
      /('\s*OR\s+')/i,
      /(;\s*DROP\s+TABLE)/i,
      /(UNION\s+SELECT)/i,
      /(INSERT\s+INTO.*VALUES)/i,
      /(--.*)$/m,
      /(\/\*[\s\S]*?\*\/)/,
    ];

    for (const pattern of sqlPatterns) {
      if (pattern.test(content)) {
        return {
          rule: "sql_injection",
          severity: "BLOCK",
          message: "Potential SQL injection pattern detected.",
        };
      }
    }
    return null;
  },
};

// ─── Guardrails Engine ──────────────────────────────────────────────────────

export class GuardrailsEngine {
  private readonly rules: GuardrailRule[] = [];

  constructor(rules?: GuardrailRule[]) {
    // Default rules always active
    this.rules.push(
      PROMPT_INJECTION_RULE,
      PII_LEAKAGE_RULE,
      CLASSIFICATION_BOUNDARY_RULE,
      MAX_OUTPUT_LENGTH_RULE,
      SQL_INJECTION_RULE,
    );

    if (rules) {
      this.rules.push(...rules);
    }
  }

  /**
   * Add a custom guardrail rule.
   */
  addRule(rule: GuardrailRule): void {
    this.rules.push(rule);
  }

  /**
   * Validate input before sending to LLM.
   */
  validateInput(
    content: string,
    context?: Omit<GuardrailContext, "direction">,
  ): GuardrailResult {
    return this.runRules(content, { ...context, direction: "input" });
  }

  /**
   * Validate output from LLM before returning to user.
   */
  validateOutput(
    content: string,
    context?: Omit<GuardrailContext, "direction">,
  ): GuardrailResult {
    return this.runRules(content, { ...context, direction: "output" });
  }

  /**
   * Sanitize content by masking detected PII patterns.
   */
  sanitize(content: string): string {
    let sanitized = content;

    for (const { pattern, type } of PII_PATTERNS_OUTPUT) {
      sanitized = sanitized.replace(pattern, `[${type} REDACTED]`);
    }

    return sanitized;
  }

  private runRules(content: string, context: GuardrailContext): GuardrailResult {
    const violations: GuardrailViolation[] = [];

    for (const rule of this.rules) {
      const violation = rule.check(content, context);
      if (violation) {
        violations.push(violation);
      }
    }

    const hasBlocking = violations.some((v) => v.severity === "BLOCK");

    return {
      passed: !hasBlocking,
      violations,
      sanitizedContent: hasBlocking ? undefined : this.sanitize(content),
    };
  }

  getRuleNames(): string[] {
    return this.rules.map((r) => r.name);
  }
}
