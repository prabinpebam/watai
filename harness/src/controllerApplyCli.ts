import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileWorkflow,
  type EventCommand,
  type WorkflowDefinition,
} from "./controller.js";
import { loadOperationalAuthority } from "./operationalAuthority.js";
import { SqliteHarnessStore, SqliteStoreError } from "./sqliteStore.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commandPath = process.env.WATAI_EVENT_COMMAND_PATH?.trim();
if (!commandPath) throw new Error("WATAI_EVENT_COMMAND_PATH is required.");
const authority = await loadOperationalAuthority(root, "implementation");
const [workflowText, commandText] = await Promise.all([
  readFile(resolve(root, "documentation", "implementation", "2026-09-10-autonomous-delivery", "contracts", "workflow.json"), "utf8"),
  readFile(resolve(commandPath), "utf8"),
]);
const workflow = compileWorkflow(JSON.parse(workflowText) as WorkflowDefinition);
const command = JSON.parse(commandText) as EventCommand;
const databasePath = process.env.WATAI_HARNESS_DB_PATH?.trim() || resolve(root, ".harness-state", "harness.sqlite");
const store = new SqliteHarnessStore(databasePath);
try {
  try {
    store.readCandidate(command.envelope.runId);
  } catch (error) {
    if (!(error instanceof SqliteStoreError) || error.code !== "CANDIDATE_UNKNOWN" || command.envelope.eventType !== "dispatch") {
      throw error;
    }
    store.createCandidate(workflow, {
      runId: command.envelope.runId,
      fencingEpoch: command.envelope.fencingEpoch,
      sourceSha: command.envelope.sourceSha,
      policySha256: command.envelope.policySha256,
    });
  }
  const result = store.apply(workflow, command, authority.authorities);
  console.log(JSON.stringify({
    schemaVersion: "1.0",
    status: result.kind === "quarantined" ? "QUARANTINED" : "EVENT_COMMITTED",
    releaseEligible: false,
    kind: result.kind,
    runId: result.candidate.runId,
    revision: result.candidate.revision,
    state: result.candidate.state,
    effectId: result.receipt.effectId ?? null,
  }, null, 2));
  if (result.kind === "quarantined") process.exitCode = 2;
} finally {
  store.close();
}
