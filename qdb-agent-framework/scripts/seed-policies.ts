/**
 * Seed Policies — Load agent policies from YAML files.
 * Run: npm run seed:policies
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyEngine } from "../src/governance/policy-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const policiesDir = join(__dirname, "..", "policies");

const engine = new PolicyEngine();
console.log("Loading policies from:", policiesDir);

const result = engine.loadFromDirectory(policiesDir);
if (result.ok) {
  console.log(`\nLoaded ${result.value.length} policies:`);
  for (const policy of result.value) {
    console.log(`  [OK] ${policy.agentId} — ${policy.displayName} (v${policy.version})`);
    console.log(`       Allowed tools: ${policy.allowedTools.length}, Denied tools: ${policy.deniedTools.length}`);
    console.log(`       Autonomy: ${policy.autonomy.defaultLevel}, Max classification: ${policy.dataBoundaries.maxClassification}`);
  }
} else {
  console.error(`Failed: ${result.error.message}`);
}
