/**
 * Seed Tools — Register initial tools into the framework.
 * Run: npm run seed:tools
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync } from "node:fs";

import { AuditLogger } from "../src/core/audit-logger.js";
import { ToolRegistry } from "../src/core/tool-registry.js";

import { manifest as cbsManifest, execute as cbsExecute } from "../src/tools/data/query-core-banking.js";
import { manifest as pbiManifest, execute as pbiExecute } from "../src/tools/data/query-power-bi.js";
import { manifest as ecmManifest, execute as ecmExecute } from "../src/tools/data/search-ecm.js";
import { manifest as ticketManifest, execute as ticketExecute } from "../src/tools/actions/create-ticket.js";
import { manifest as notifManifest, execute as notifExecute } from "../src/tools/actions/send-notification.js";
import { manifest as shariaManifest, execute as shariaExecute } from "../src/tools/compliance/check-sharia.js";
import { manifest as qcbManifest, execute as qcbExecute } from "../src/tools/compliance/validate-qcb-limits.js";
import { manifest as auditToolManifest, createExecutor } from "../src/tools/compliance/log-audit-trail.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data", "audit");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const auditLogger = new AuditLogger(join(dataDir, "audit.db"));
const registry = new ToolRegistry(auditLogger);

const tools = [
  { manifest: cbsManifest, executor: cbsExecute },
  { manifest: pbiManifest, executor: pbiExecute },
  { manifest: ecmManifest, executor: ecmExecute },
  { manifest: ticketManifest, executor: ticketExecute },
  { manifest: notifManifest, executor: notifExecute },
  { manifest: shariaManifest, executor: shariaExecute },
  { manifest: qcbManifest, executor: qcbExecute },
  { manifest: auditToolManifest, executor: createExecutor(auditLogger) },
];

console.log("Seeding tools...");
for (const { manifest, executor } of tools) {
  const result = registry.register(manifest, executor);
  if (result.ok) {
    console.log(`  [OK] ${manifest.toolId} — ${manifest.displayName}`);
  } else {
    console.error(`  [FAIL] ${manifest.toolId}: ${result.error.message}`);
  }
}
console.log(`\nRegistered ${registry.listTools().length} tools.`);
auditLogger.close();
