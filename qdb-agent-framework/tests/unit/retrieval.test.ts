import { describe, it, expect } from "vitest";
import { RetrievalIndex, chunkDocument, type Document } from "../../src/core/retrieval.js";
import { DataClassification } from "../../src/core/types.js";

const DOCS: Document[] = [
  {
    id: "dr-1", title: "DR Playbook — Azure Qatar Failover",
    source: "ECM:playbook/dr-azure-qatar",
    classification: DataClassification.INTERNAL,
    text: "Disaster recovery failover procedure for the Azure Qatar region. On a P1 outage, activate the West Europe replica and notify the CIO. Recovery time objective is four hours across all seven sites.",
  },
  {
    id: "sal-1", title: "Executive Compensation Schedule",
    source: "ECM:hr/exec-comp",
    classification: DataClassification.CONFIDENTIAL,
    text: "The salary and bonus schedule for senior management including base compensation and performance incentives for the fiscal year.",
  },
  {
    id: "ar-1", title: "دليل التعافي من الكوارث",
    source: "ECM:playbook/dr-ar",
    classification: DataClassification.INTERNAL,
    text: "إجراء التعافي من الكوارث في منطقة Azure قطر. عند وقوع حادث حرج فعّل النسخة الاحتياطية في أوروبا الغربية خلال ٤ ساعات.",
  },
];

describe("chunkDocument", () => {
  it("produces chunks carrying source and classification", () => {
    const chunks = chunkDocument(DOCS[0]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].source).toBe("ECM:playbook/dr-azure-qatar");
    expect(chunks[0].classification).toBe(DataClassification.INTERNAL);
  });
  it("returns no chunks for empty text", () => {
    expect(chunkDocument({ ...DOCS[0], text: "" })).toHaveLength(0);
  });
});

describe("RetrievalIndex", () => {
  it("retrieves a relevant chunk with a citation", () => {
    const idx = new RetrievalIndex();
    idx.addAll(DOCS);
    const res = idx.retrieve("azure qatar failover recovery", DataClassification.INTERNAL);
    expect(res.answerable).toBe(true);
    expect(res.results[0].citation.source).toBe("ECM:playbook/dr-azure-qatar");
    expect(res.results[0].citation.title).toContain("DR Playbook");
  });

  it("is honest when nothing is grounded (no confident improvisation)", () => {
    const idx = new RetrievalIndex();
    idx.addAll(DOCS);
    const res = idx.retrieve("quarterly marketing campaign performance", DataClassification.INTERNAL);
    expect(res.answerable).toBe(false);
    expect(res.results).toHaveLength(0);
  });

  it("enforces the classification ceiling at query time", () => {
    const idx = new RetrievalIndex();
    idx.addAll(DOCS);
    // An INTERNAL-cleared caller querying for salary must NOT receive the CONFIDENTIAL chunk.
    const res = idx.retrieve("salary bonus compensation", DataClassification.INTERNAL);
    expect(res.results.every((r) => r.chunk.classification !== DataClassification.CONFIDENTIAL)).toBe(true);
    expect(res.withheldForClassification).toBeGreaterThan(0);
  });

  it("returns the confidential chunk to a cleared caller", () => {
    const idx = new RetrievalIndex();
    idx.addAll(DOCS);
    const res = idx.retrieve("salary bonus compensation", DataClassification.CONFIDENTIAL);
    expect(res.answerable).toBe(true);
    expect(res.results[0].citation.source).toBe("ECM:hr/exec-comp");
  });

  it("matches Arabic queries against Arabic documents (normalized)", () => {
    const idx = new RetrievalIndex();
    idx.addAll(DOCS);
    const res = idx.retrieve("التعافي من الكوارث", DataClassification.INTERNAL);
    expect(res.answerable).toBe(true);
    expect(res.results.some((r) => r.citation.source === "ECM:playbook/dr-ar")).toBe(true);
  });

  it("formats citations for inline use", () => {
    const idx = new RetrievalIndex();
    idx.addAll(DOCS);
    const res = idx.retrieve("failover recovery objective", DataClassification.INTERNAL);
    const cites = RetrievalIndex.formatCitations(res.results);
    expect(cites).toMatch(/\[1\]/);
    expect(cites).toContain("ECM:");
  });
});
