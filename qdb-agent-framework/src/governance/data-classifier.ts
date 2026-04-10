/**
 * Data Classifier — Enforces data classification boundaries between agents.
 * Ensures data flows upward (more restrictive) but responses are downgraded
 * when crossing agent boundaries.
 */

import {
  type Result,
  DataClassification,
  DATA_CLASSIFICATION_RANK,
  Ok,
  Err,
  ErrorCodes,
} from "../core/types.js";

/** Field-level classification for fine-grained data control. */
export interface FieldClassification {
  fieldPath: string;
  classification: DataClassification;
  containsPII: boolean;
}

/** Result of classifying a data payload. */
export interface ClassificationResult {
  overallClassification: DataClassification;
  fields: FieldClassification[];
  containsPII: boolean;
}

/** Known PII field patterns used across QDB systems. */
const PII_PATTERNS = [
  /national[_\s]?id/i,
  /qid/i,
  /passport/i,
  /phone/i,
  /mobile/i,
  /email/i,
  /address/i,
  /date[_\s]?of[_\s]?birth/i,
  /dob/i,
  /salary/i,
  /income/i,
  /bank[_\s]?account/i,
  /iban/i,
  /credit[_\s]?card/i,
];

/** Fields that indicate financial confidentiality. */
const CONFIDENTIAL_PATTERNS = [
  /balance/i,
  /loan[_\s]?amount/i,
  /facility[_\s]?amount/i,
  /exposure/i,
  /collateral/i,
  /credit[_\s]?score/i,
  /risk[_\s]?rating/i,
  /profit[_\s]?rate/i,
  /provision/i,
];

/** Fields that are always restricted. */
const RESTRICTED_PATTERNS = [
  /password/i,
  /secret/i,
  /api[_\s]?key/i,
  /token/i,
  /private[_\s]?key/i,
];

export class DataClassifier {
  /**
   * Classify a data payload by inspecting field names and values.
   */
  classifyPayload(
    data: Record<string, unknown>,
    baseClassification: DataClassification = DataClassification.PUBLIC,
  ): ClassificationResult {
    const fields: FieldClassification[] = [];
    let highestRank = DATA_CLASSIFICATION_RANK[baseClassification];
    let containsPII = false;

    this.inspectFields(data, "", fields);

    for (const field of fields) {
      const rank = DATA_CLASSIFICATION_RANK[field.classification];
      if (rank > highestRank) {
        highestRank = rank;
      }
      if (field.containsPII) {
        containsPII = true;
      }
    }

    const overallClassification = Object.entries(DATA_CLASSIFICATION_RANK).find(
      ([_, rank]) => rank === highestRank,
    )?.[0] as DataClassification ?? baseClassification;

    return { overallClassification, fields, containsPII };
  }

  /**
   * Mask fields that exceed a given classification threshold.
   * Returns a new object with sensitive fields replaced by mask values.
   */
  maskFields(
    data: Record<string, unknown>,
    maxClassification: DataClassification,
    piiHandling: "MASK" | "REDACT" | "ALLOW" = "MASK",
  ): Record<string, unknown> {
    const classification = this.classifyPayload(data);
    const maxRank = DATA_CLASSIFICATION_RANK[maxClassification];
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data)) {
      const fieldClassification = classification.fields.find(
        (f) => f.fieldPath === key,
      );

      if (fieldClassification) {
        const fieldRank = DATA_CLASSIFICATION_RANK[fieldClassification.classification];

        // Mask or redact if field classification exceeds allowed level
        if (fieldRank > maxRank) {
          result[key] = piiHandling === "REDACT" ? undefined : "***MASKED***";
          continue;
        }

        // Handle PII fields according to policy
        if (fieldClassification.containsPII && piiHandling !== "ALLOW") {
          if (piiHandling === "REDACT") {
            result[key] = undefined;
          } else {
            result[key] = this.maskValue(value);
          }
          continue;
        }
      }

      // Recurse into nested objects
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        result[key] = this.maskFields(
          value as Record<string, unknown>,
          maxClassification,
          piiHandling,
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Validate that a data transfer between agents respects classification boundaries.
   * Rule: data classification flows upward; responses must be downgraded.
   */
  validateDataTransfer(
    _sourceMaxClassification: DataClassification,
    targetMaxClassification: DataClassification,
    dataClassification: DataClassification,
  ): Result<void> {
    const targetRank = DATA_CLASSIFICATION_RANK[targetMaxClassification];
    const dataRank = DATA_CLASSIFICATION_RANK[dataClassification];

    if (dataRank > targetRank) {
      return Err({
        code: ErrorCodes.DATA_CLASSIFICATION_VIOLATION,
        message: `Data classification ${dataClassification} exceeds target agent's maximum ${targetMaxClassification}. Data must be downgraded before transfer.`,
      });
    }

    return Ok(undefined);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private inspectFields(
    data: Record<string, unknown>,
    prefix: string,
    fields: FieldClassification[],
  ): void {
    for (const [key, value] of Object.entries(data)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;

      const isPII = PII_PATTERNS.some((p) => p.test(key));
      let classification = DataClassification.PUBLIC;

      if (RESTRICTED_PATTERNS.some((p) => p.test(key))) {
        classification = DataClassification.RESTRICTED;
      } else if (CONFIDENTIAL_PATTERNS.some((p) => p.test(key))) {
        classification = DataClassification.CONFIDENTIAL;
      } else if (isPII) {
        classification = DataClassification.CONFIDENTIAL;
      }

      fields.push({ fieldPath, classification, containsPII: isPII });

      // Recurse into nested objects
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        this.inspectFields(value as Record<string, unknown>, fieldPath, fields);
      }
    }
  }

  private maskValue(value: unknown): string {
    if (typeof value === "string") {
      if (value.length <= 4) return "****";
      return value.slice(0, 2) + "***" + value.slice(-2);
    }
    return "***MASKED***";
  }
}
