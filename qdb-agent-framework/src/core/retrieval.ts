/**
 * Retrieval with citations — reference RAG index (curriculum M1.5).
 *
 * Dependency-free, hybrid keyword scoring over classified document chunks, with
 * two properties a bank needs that naive RAG lacks:
 *
 *  1. Citations are mandatory. Every result carries its source + chunk so a human
 *     can verify — uncited claims are how hallucinations enter official records
 *     (PRODUCTION-PLAYBOOK §4.3). `answerable` is false when nothing scores, so an
 *     agent can honestly say "no grounded answer" instead of improvising.
 *  2. Classification-ceiling filtering at QUERY time. The caller's clearance is
 *     applied per chunk, so an INTERNAL-cleared agent never retrieves CONFIDENTIAL
 *     content — the "one big index" data-boundary trap (curriculum M1.5 / M4.2).
 *
 * Arabic-aware: queries and chunks are normalized (Arabic-Indic digits, alef/ta-
 * marbuta variants, diacritics) so Gulf traffic matches, not just MSA-with-Latin.
 * Production swaps the scorer for embeddings + a real vector store behind the same
 * interface (PRODUCTION-PLAYBOOK §7.3 caveat).
 */

import { DataClassification, DATA_CLASSIFICATION_RANK } from "./types.js";
import { normalizeForDetection } from "./guardrails.js";

export interface Document {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly classification: DataClassification;
  readonly source: string; // e.g. "ECM:policy/dr-playbook-2026"
}

export interface Chunk {
  readonly docId: string;
  readonly title: string;
  readonly source: string;
  readonly classification: DataClassification;
  readonly index: number; // chunk ordinal within the document
  readonly text: string;
}

export interface Citation {
  readonly source: string;
  readonly title: string;
  readonly chunkIndex: number;
}

export interface RetrievalResult {
  readonly chunk: Chunk;
  readonly score: number;
  readonly citation: Citation;
}

export interface RetrievalResponse {
  readonly answerable: boolean;
  readonly results: readonly RetrievalResult[];
  /** Chunks that matched but were withheld because they exceed the caller's clearance. */
  readonly withheldForClassification: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "for", "and", "or", "is", "are", "on", "with",
  "من", "في", "على", "إلى", "عن", "أو", "و", "ما", "هل", "هذا", "هذه",
]);

function tokenize(text: string): string[] {
  return normalizeForDetection(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Split a document into overlapping word-window chunks with metadata carried through. */
export function chunkDocument(doc: Document, windowWords = 60, overlap = 15): Chunk[] {
  const words = doc.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, windowWords - overlap);
  const chunks: Chunk[] = [];
  for (let start = 0, i = 0; start < words.length; start += step, i++) {
    chunks.push({
      docId: doc.id,
      title: doc.title,
      source: doc.source,
      classification: doc.classification,
      index: i,
      text: words.slice(start, start + windowWords).join(" "),
    });
    if (start + windowWords >= words.length) break;
  }
  return chunks;
}

export class RetrievalIndex {
  private readonly chunks: Chunk[] = [];
  /** token → document frequency, for a light IDF weighting. */
  private readonly docFreq = new Map<string, number>();

  add(doc: Document): void {
    for (const chunk of chunkDocument(doc)) {
      this.chunks.push(chunk);
      for (const t of new Set(tokenize(chunk.text))) {
        this.docFreq.set(t, (this.docFreq.get(t) ?? 0) + 1);
      }
    }
  }

  addAll(docs: readonly Document[]): void {
    for (const d of docs) this.add(d);
  }

  /**
   * Retrieve top-k chunks the caller is cleared to see. Chunks above the caller's
   * classification are counted in `withheldForClassification`, never returned.
   */
  retrieve(
    query: string,
    callerClearance: DataClassification,
    k = 3,
  ): RetrievalResponse {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) {
      return { answerable: false, results: [], withheldForClassification: 0 };
    }
    const ceiling = DATA_CLASSIFICATION_RANK[callerClearance];
    const totalChunks = Math.max(this.chunks.length, 1);

    let withheld = 0;
    const scored: RetrievalResult[] = [];
    for (const chunk of this.chunks) {
      const chunkTokens = tokenize(chunk.text);
      const bag = new Set(chunkTokens);
      let score = 0;
      for (const q of qTokens) {
        if (bag.has(q)) {
          const df = this.docFreq.get(q) ?? 1;
          score += Math.log(1 + totalChunks / df); // rarer terms weigh more
        }
      }
      if (score <= 0) continue;
      if (DATA_CLASSIFICATION_RANK[chunk.classification] > ceiling) {
        withheld++;
        continue; // classification ceiling enforced at query time
      }
      scored.push({
        chunk,
        score,
        citation: { source: chunk.source, title: chunk.title, chunkIndex: chunk.index },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, k);
    return { answerable: results.length > 0, results, withheldForClassification: withheld };
  }

  /** Render results as an inline-citation string an agent can put in a grounded answer. */
  static formatCitations(results: readonly RetrievalResult[]): string {
    return results.map((r, i) => `[${i + 1}] ${r.citation.title} (${r.citation.source}#${r.citation.chunkIndex})`).join("\n");
  }

  get size(): number {
    return this.chunks.length;
  }
}
