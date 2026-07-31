/**
 * Eval harness (curriculum M3.1–M3.2). Runs the golden and adversarial datasets
 * against the deterministic layers (router intent classifier, guardrails engine)
 * and gates on pass-rate thresholds — exit non-zero on failure so CI blocks merges.
 *
 * Run: npm run eval            (both suites)
 *      npm run eval -- --json  (machine-readable summary for dashboards)
 *
 * These are deterministic assertions — the cheapest, most objective eval tier
 * (M3.1 assertion hierarchy). LLM-as-judge and human tiers layer on top later.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIntent } from "../src/agents/router/intent-classifier.js";
import { GuardrailsEngine } from "../src/core/guardrails.js";
import { DataClassification } from "../src/core/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes("--json");

// Pass thresholds — a suite below its floor fails the run.
const THRESHOLDS = { router: 0.9, adversarial: 1.0 };
const LOW_CONFIDENCE_MAX = 0.35; // out-of-scope utterances must classify below this.

interface Case { id: string; [k: string]: unknown }

function loadJsonl(name: string): Case[] {
  const raw = readFileSync(join(HERE, "datasets", name), "utf8");
  return raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Case);
}

interface CaseResult { id: string; passed: boolean; detail: string }

function runRouter(): { name: string; results: CaseResult[] } {
  const cases = loadJsonl("router-golden.jsonl");
  const results = cases.map((c): CaseResult => {
    const expect = c.expect as { targetAgent?: string; lowConfidence?: boolean };
    const r = classifyIntent(c.utterance as string);
    if (expect.lowConfidence) {
      const passed = r.confidence <= LOW_CONFIDENCE_MAX || r.intent === "unknown";
      return { id: c.id, passed, detail: `out-of-scope → ${r.targetAgent}@${r.confidence.toFixed(2)} (intent=${r.intent})` };
    }
    const passed = r.targetAgent === expect.targetAgent;
    return { id: c.id, passed, detail: `expected ${expect.targetAgent}, got ${r.targetAgent}@${r.confidence.toFixed(2)}` };
  });
  return { name: "router", results };
}

function runAdversarial(): { name: string; results: CaseResult[] } {
  const engine = new GuardrailsEngine();
  const cases = loadJsonl("adversarial.jsonl");
  const results = cases.map((c): CaseResult => {
    const expect = c.expect as { blocked?: boolean; flagged?: boolean; rule?: string };
    const direction = c.direction as "input" | "output";
    const ctx = { dataClassification: (c.classification as DataClassification) ?? DataClassification.INTERNAL };
    const res = direction === "input"
      ? engine.validateInput(c.input as string, ctx)
      : engine.validateOutput(c.input as string, ctx);

    // "flagged" = a violation exists (any severity); "blocked" = a BLOCK violation exists.
    const hasRule = expect.rule ? res.violations.some((v) => v.rule === expect.rule) : true;
    let passed: boolean;
    if (expect.blocked === true) passed = !res.passed && hasRule;
    else if (expect.flagged === true) passed = res.violations.length > 0 && hasRule;
    else passed = res.passed; // benign inputs must not be blocked
    return { id: c.id, passed, detail: `passed=${res.passed} violations=[${res.violations.map((v) => v.rule).join(",")}]` };
  });
  return { name: "adversarial", results };
}

function summarize(suite: { name: string; results: CaseResult[] }) {
  const total = suite.results.length;
  const passed = suite.results.filter((r) => r.passed).length;
  const rate = passed / total;
  const floor = THRESHOLDS[suite.name as keyof typeof THRESHOLDS] ?? 1;
  return { name: suite.name, total, passed, rate, floor, ok: rate >= floor, results: suite.results };
}

const suites = [runRouter(), runAdversarial()].map(summarize);
const allOk = suites.every((s) => s.ok);

if (asJson) {
  console.log(JSON.stringify({ ok: allOk, suites: suites.map(({ results, ...s }) => s) }, null, 2));
} else {
  for (const s of suites) {
    const pct = (s.rate * 100).toFixed(1);
    console.log(`\n${s.ok ? "✓" : "✗"} ${s.name}: ${s.passed}/${s.total} (${pct}%, floor ${(s.floor * 100).toFixed(0)}%)`);
    for (const r of s.results.filter((x) => !x.passed)) {
      console.log(`    ✗ ${r.id}: ${r.detail}`);
    }
  }
  console.log(`\n${allOk ? "✓ EVAL PASS" : "✗ EVAL FAIL"}\n`);
}

process.exit(allOk ? 0 : 1);
