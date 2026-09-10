// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GatewayService } from "./gatewayService";
import type { LockedTaskSpec } from "./taskSpec";
import type { GatewayRequest, WorkerLaunchManifest } from "./worker";

const directories: string[] = [];
const digest = (character: string) => character.repeat(64);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "watai-gateway-"));
  directories.push(root);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(root, "outside.txt"), "outside\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root });
  const task = {
    taskSpecSha256: digest("1"),
    source: { sourceSha: "a".repeat(40) },
    bindings: { policySha256: digest("2") },
    fencingEpoch: 1,
    allowedPaths: ["src"],
    allowedTools: ["watai_read_file", "watai_search_text", "watai_apply_patch", "watai_run_validation", "watai_git_diff", "watai_submit_result"],
  } as LockedTaskSpec;
  const manifest = {
    runId: "run-gateway",
    taskSpecSha256: task.taskSpecSha256,
    sourceSha: task.source.sourceSha,
    policySha256: task.bindings.policySha256,
    fencingEpoch: task.fencingEpoch,
    manifestSha256: digest("3"),
    runtime: {
      validationCommands: [{ id: "fixed", executable: process.execPath, args: ["-e", "process.exit(0)"], cwd: "src", timeoutMs: 10_000, maxOutputBytes: 10_000 }],
    },
  } as WorkerLaunchManifest;
  return { root, task, manifest, service: await GatewayService.create({ workspaceRoot: root, task, manifest }) };
}

function request(tool: GatewayRequest["tool"], args: unknown): GatewayRequest {
  return {
    schemaVersion: "1.0",
    requestId: `request-${tool}`,
    runId: "run-gateway",
    taskSpecSha256: digest("1"),
    manifestSha256: digest("3"),
    fencingEpoch: 1,
    tool,
    arguments: args,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("gateway service", () => {
  it("reads and searches only tracked workspace files with bounded output", async () => {
    const { service } = await fixture();
    const read = await service.invoke(request("watai_read_file", { path: "src/value.ts", startLine: 1, endLine: 1 }));
    const search = await service.invoke(request("watai_search_text", { query: "value", isRegexp: false, includePattern: "*.ts", maxResults: 10 }));
    expect(read).toMatchObject({ status: "success", result: { content: "export const value = 1;" } });
    expect(search).toMatchObject({ status: "success", result: { results: [expect.objectContaining({ path: "src/value.ts" })] } });
  });

  it("applies an in-root patch and rejects an out-of-root patch", async () => {
    const { service } = await fixture();
    const allowedPatch = "diff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n";
    const allowed = await service.invoke(request("watai_apply_patch", {
      patch: allowedPatch,
      patchSha256: createHash("sha256").update(allowedPatch).digest("hex"),
    }));
    expect(allowed).toMatchObject({ status: "success", result: { changedPaths: ["src/value.ts"] } });

    const outsidePatch = "diff --git a/outside.txt b/outside.txt\n--- a/outside.txt\n+++ b/outside.txt\n@@ -1 +1 @@\n-outside\n+changed\n";
    const outside = await service.invoke({
      ...request("watai_apply_patch", {
        patch: outsidePatch,
        patchSha256: createHash("sha256").update(outsidePatch).digest("hex"),
      }),
      requestId: "request-outside",
    });
    expect(outside.status).toBe("failure");
  });

  it("runs only fixed validation IDs and replays identical requests", async () => {
    const { service } = await fixture();
    const fixed = request("watai_run_validation", { commandId: "fixed" });
    const first = await service.invoke(fixed);
    const replay = await service.invoke(fixed);
    const unknown = await service.invoke({ ...fixed, requestId: "request-unknown", arguments: { commandId: "other" } });
    expect(first).toBe(replay);
    expect(first).toMatchObject({ status: "success", result: { passed: true } });
    expect(unknown.status).toBe("failure");
  });

  it("rejects request ID reuse with changed content", async () => {
    const { service } = await fixture();
    const first = request("watai_read_file", { path: "src/value.ts", startLine: 1, endLine: 1 });
    await service.invoke(first);
    const conflict = await service.invoke({ ...first, arguments: { path: "outside.txt", startLine: 1, endLine: 1 } });
    expect(conflict).toMatchObject({ status: "failure", result: { code: "REQUEST_ID_CONFLICT" } });
  });
});