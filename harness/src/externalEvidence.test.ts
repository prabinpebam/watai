// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CommandArtifactSigner } from "./externalSigner";
import type { LiveModelRunObservation } from "./modelEvaluation";
import { writeModelObservationClaims, writePortableModelObservations } from "./modelObservationWriter";

const directories: string[] = [];
const unsigned = (): Omit<LiveModelRunObservation, "producerIdentity" | "issuedAt" | "expiresAt" | "signature"> => ({
  evaluationId: "implementation-agent-smoke",
  runId: "run-1",
  caseId: "bounded-read",
  repetition: 1,
  providerId: "github-copilot",
  requestedModel: "gpt-5.4",
  resolvedModelVersion: "gpt-5.4-2026-03-05",
  status: "completed",
  semanticPass: true,
  latencyMs: 1000,
  usage: { usd: 0, inputTokens: 1000, outputTokens: 100, requests: 1, aiCredits: 1 },
  usageReceiptSha256: "a".repeat(64),
  responseSha256: "b".repeat(64),
  caseDefinitionSha256: "c".repeat(64),
  graderSha256: "d".repeat(64),
  gradedArtifactSha256: "e".repeat(64),
  gradeOutputSha256: "f".repeat(64),
  errorCode: null,
  completedAt: "2026-09-10T11:00:00.000Z",
});

function signerScript(mutate = false): string {
  return [
    "let data='';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => data += chunk);",
    "process.stdin.on('end', () => {",
    "const request=JSON.parse(data);",
    mutate ? "request.payload.caseId='changed';" : "",
    "process.stdout.write(JSON.stringify({...request.payload,producerIdentity:'external-signer',issuedAt:'2026-09-10T11:00:00.000Z',expiresAt:'2026-09-10T11:15:00.000Z',signature:'signed'}));",
    "});",
  ].join("");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("external evidence boundaries", () => {
  it("accepts an external signature only when the measured payload is unchanged", async () => {
    const signer = new CommandArtifactSigner({
      executable: process.execPath,
      args: ["-e", signerScript()],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    await expect(signer.sign(unsigned())).resolves.toMatchObject({
      producerIdentity: "external-signer",
      signature: "signed",
    });

    const mutatingSigner = new CommandArtifactSigner({
      executable: process.execPath,
      args: ["-e", signerScript(true)],
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    await expect(mutatingSigner.sign(unsigned())).rejects.toMatchObject({ code: "EXTERNAL_SIGNER_BINDING_INVALID" });
  });

  it("writes observations once as canonical portable JSONL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watai-model-observations-"));
    directories.push(directory);
    const path = join(directory, "observations.jsonl");
    const observation: LiveModelRunObservation = {
      ...unsigned(),
      producerIdentity: "external-signer",
      issuedAt: "2026-09-10T11:00:00.000Z",
      expiresAt: "2026-09-10T11:15:00.000Z",
      signature: "signed",
    };
    const result = await writePortableModelObservations(path, [observation]);
    expect(result).toMatchObject({ path, count: 1 });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readFile(path, "utf8")).trim()).toContain('"evaluationId":"implementation-agent-smoke"');
    const claims = await writeModelObservationClaims(join(directory, "claims"), [observation]);
    expect(claims.count).toBe(1);
    expect(await readFile(join(directory, "claims", "implementation-agent-smoke-bounded-read-1-run-1.json"), "utf8"))
      .toContain('"kind": "model-evaluation-observation"');
    await expect(writePortableModelObservations(path, [observation])).rejects.toMatchObject({ code: "EEXIST" });
  });
});
