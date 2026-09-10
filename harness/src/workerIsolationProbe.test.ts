// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildWorkerIsolationProbeArgs, probeWorkerIsolation } from "./workerIsolationProbe";
import type { LockedTaskSpec } from "./taskSpec";
import type { WorkerRuntimePlan } from "./worker";

const task = {
  runId: "run-probe",
  taskSpecSha256: "a".repeat(64),
  bindings: { policySha256: "b".repeat(64) },
} as LockedTaskSpec;
const runtime = {
  runtimeImageSha256: "c".repeat(64),
  containerDependencyDirectory: "/opt/watai/node_modules",
  memoryMb: 1024,
  cpuCount: 1,
  pidsLimit: 64,
} as WorkerRuntimePlan;

describe("worker isolation probe", () => {
  it("uses the required Docker isolation controls", () => {
    const args = buildWorkerIsolationProbeArgs("C:/fixture", runtime);
    expect(args).toEqual(expect.arrayContaining([
      "--network", "none", "--read-only", "--user", "1000:1000",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "sha256:" + runtime.runtimeImageSha256,
    ]));
    const mounts = args.flatMap((value, index) => args[index - 1] === "--mount" ? [value] : []);
    expect(mounts.join(" ")).not.toContain("docker.sock");
  });

  it("emits a task-bound attestation payload only for passing observed controls", () => {
    const result = probeWorkerIsolation(task, runtime, "C:/fixture", () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({
        uid: 1000,
        gid: 1000,
        rootWritable: false,
        sourceWritable: false,
        capEff: "0000000000000000",
        interfaces: ["lo"],
        sensitiveEnvironmentNames: [],
        dockerSocketPresent: false,
        homeMounted: false,
        dependencyDirectoryPresent: true,
      }),
    }));
    expect(result).toMatchObject({
      status: "PASSED",
      attestationPayload: {
        taskSpecSha256: task.taskSpecSha256,
        runtimeImageSha256: runtime.runtimeImageSha256,
        networkMode: "none",
      },
    });
  });

  it("fails when the source or root filesystem is writable", () => {
    const result = probeWorkerIsolation(task, runtime, "C:/fixture", () => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({
        uid: 1000,
        gid: 1000,
        rootWritable: true,
        sourceWritable: true,
        capEff: "0000000000000000",
        interfaces: ["lo"],
        sensitiveEnvironmentNames: [],
        dockerSocketPresent: false,
        homeMounted: false,
        dependencyDirectoryPresent: true,
      }),
    }));
    expect(result.status).toBe("FAILED");
    expect(result.blockers.map((blocker) => blocker.code)).toContain("ISOLATION_CONTROLS_FAILED");
  });
});
