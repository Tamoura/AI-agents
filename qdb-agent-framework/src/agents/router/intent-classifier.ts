/**
 * Intent Classifier — Classifies user intent and maps to target agent.
 * Uses keyword/pattern matching for v1. Production: use Claude Haiku for classification.
 */

export interface ClassificationResult {
  targetAgent: string;
  confidence: number;
  intent: string;
  domain: string;
}

interface IntentPattern {
  agent: string;
  domain: string;
  intent: string;
  patterns: RegExp[];
  keywords: string[];
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    agent: "it_operations",
    domain: "infrastructure",
    intent: "incident_report",
    patterns: [/incident/i, /outage/i, /down/i, /not working/i, /error/i, /issue/i],
    keywords: ["server", "network", "azure", "infrastructure", "vpn", "firewall", "system"],
  },
  {
    agent: "it_operations",
    domain: "dr_planning",
    intent: "dr_inquiry",
    patterns: [/disaster recovery/i, /DR\s/i, /failover/i, /backup/i, /playbook/i],
    keywords: ["disaster", "recovery", "failover", "backup", "continuity"],
  },
  {
    agent: "it_operations",
    domain: "incidents",
    intent: "service_health",
    patterns: [/service health/i, /status/i, /monitoring/i, /uptime/i],
    keywords: ["health", "monitoring", "status", "uptime", "availability"],
  },
  {
    agent: "pmo",
    domain: "project_management",
    intent: "project_status",
    patterns: [/project status/i, /delivery/i, /milestone/i, /sprint/i],
    keywords: ["project", "milestone", "delivery", "sprint", "timeline", "deadline"],
  },
  {
    agent: "pmo",
    domain: "reporting",
    intent: "pmo_report",
    patterns: [/project report/i, /PMO/i, /portfolio.*project/i],
    keywords: ["report", "dashboard", "pmo", "progress", "budget"],
  },
  {
    agent: "credit_assessment",
    domain: "credit_analysis",
    intent: "credit_review",
    patterns: [/credit/i, /loan/i, /facility/i, /financing/i, /borrower/i],
    keywords: ["credit", "loan", "facility", "financing", "borrower", "collateral", "risk"],
  },
  {
    agent: "customer_lifecycle",
    domain: "customer_management",
    intent: "customer_inquiry",
    patterns: [/customer/i, /onboarding/i, /KYC/i, /client/i],
    keywords: ["customer", "client", "onboarding", "kyc", "account"],
  },
  {
    agent: "portfolio_monitoring",
    domain: "portfolio_analysis",
    intent: "portfolio_health",
    patterns: [/portfolio/i, /exposure/i, /NPL/i, /watch\s*list/i, /covenant/i, /obligor/i],
    keywords: ["portfolio", "exposure", "npl", "concentration", "provision", "covenant", "obligor", "limit"],
  },
  {
    agent: "regulatory_compliance",
    domain: "compliance",
    intent: "compliance_check",
    patterns: [/compliance/i, /QCB/i, /PDPPL/i, /regulation/i, /sharia/i, /\bAML\b/i, /regulatory\s+return/i],
    keywords: ["compliance", "regulation", "qcb", "pdppl", "sharia", "audit", "aml", "return"],
  },
  {
    agent: "document_intelligence",
    domain: "document_processing",
    intent: "document_search",
    patterns: [/document/i, /policy.*document/i, /find.*file/i, /search.*doc/i],
    keywords: ["document", "file", "pdf", "policy", "template"],
  },
];

export function classifyIntent(userMessage: string): ClassificationResult {
  const lowerMessage = userMessage.toLowerCase();
  const scores: { pattern: IntentPattern; score: number }[] = [];

  for (const pattern of INTENT_PATTERNS) {
    let score = 0;

    // Pattern matching (higher weight)
    for (const regex of pattern.patterns) {
      if (regex.test(userMessage)) {
        score += 3;
      }
    }

    // Keyword matching
    for (const keyword of pattern.keywords) {
      if (lowerMessage.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }

    if (score > 0) {
      scores.push({ pattern, score });
    }
  }

  if (scores.length === 0) {
    return {
      targetAgent: "it_operations",
      confidence: 0.1,
      intent: "unknown",
      domain: "general",
    };
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!;
  const maxPossible = best.pattern.patterns.length * 3 + best.pattern.keywords.length;
  const confidence = Math.min(best.score / maxPossible, 1);

  return {
    targetAgent: best.pattern.agent,
    confidence,
    intent: best.pattern.intent,
    domain: best.pattern.domain,
  };
}
