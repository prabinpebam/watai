// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CommandLiveModelProviderAdapter } from "./liveModelExecutor";
import type { LiveModelEvaluationContract } from "./modelEvaluation";
import type { ModelCaseDefinition } from "./modelCases";

const contract: LiveModelEvaluationContract = {
  id: "semantic-routing-live",
  purpose: "product-behavior",
  applicableGates: ["G02"],
  providerId: "azure-openai",
  requestedModel: "gpt-5.4",
  resolvedVersionPolicy: "observed",
  expectedResolvedVersion: null,
  caseIds: ["plain-response"],
  repetitions: 3,
  thresholds: { minimumSemanticPassRate: 1, maximumErrorRate: 0, maximumP95LatencyMs: 10_000 },
  budget: { usd: 1, inputTokens: 10_000, outputTokens: 1_000, requests: 3 },
  requiresUsageReceipts: true,
  requiresPortableJsonl: true,
};
const definition: ModelCaseDefinition = {
  id: "plain-response",
  input: "Explain isometric projection.",
  oracle: { kind: "semantic-action", expectedAction: "respond" },
};

function script(): string {
  return [
    "let data='';process.stdin.setEncoding('utf8');",
    "process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>{",
    "const r=JSON.parse(data);",
    "process.stdout.write(JSON.stringify({status:'completed',artifact:{kind:r.definition.oracle.kind,selectedAction:'respond'},latencyMs:10,usage:{usd:0,inputTokens:10,outputTokens:2,requests:1},responseSha256:'b'.repeat(64),resolvedModelVersion:'gpt-5.4-test',errorCode:null,completedAt:'2026-09-10T11:00:00.000Z'}));",
    "});",
  ].join('');
}

describe("command live-model adapter", () => {
  it("executes a real external adapter process with strict structured output", async () => {
    const adapter = new CommandLiveModelProviderAdapter("azure-openai", {
      executable: process.execPath,
      args: ["-e", script()],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      environment: {},
    });
    await expect(adapter.run({ contract, definition, repetition: 1 })).resolves.toMatchObject({
      status: "completed",
      artifact: { kind: "semantic-action", selectedAction: "respond" },
      usage: { requests: 1 },
    });
  });

  it("returns a failed denominator observation when the adapter process exits nonzero", async () => {
    const adapter = new CommandLiveModelProviderAdapter("azure-openai", {
      executable: process.execPath,
      args: ["-e", "process.stderr.write('provider failed');process.exit(2)"],
      cwd: process.cwd(),
      timeoutMs: 5_000,
      environment: {},
    });
    await expect(adapter.run({ contract, definition, repetition: 1 })).resolves.toMatchObject({
      status: "failed",
      artifact: { kind: "semantic-action", selectedAction: "adapter-failed" },
      usage: { requests: 0 },
      errorCode: "ADAPTER_PROCESS_FAILED",
    });
  });
});
