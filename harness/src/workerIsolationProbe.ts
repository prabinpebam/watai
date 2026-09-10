import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import type { LockedTaskSpec } from "./taskSpec.js";
import type { WorkerIsolationAttestation, WorkerRuntimePlan } from "./worker.js";

export type UnsignedWorkerIsolationAttestation = Omit<
  WorkerIsolationAttestation,
  "issuer" | "issuedAt" | "expiresAt" | "signature"
>;

interface ProbeOutput {
  uid: number;
  gid: number;
  rootWritable: boolean;
  sourceWritable: boolean;
  capEff: string;
  interfaces: string[];
  sensitiveEnvironmentNames: string[];
  dockerSocketPresent: boolean;
  homeMounted: boolean;
  dependencyDirectoryPresent: boolean;
}

export interface WorkerIsolationProbeResult {
  status: "PASSED" | "FAILED";
  blockers: Array<{ code: string; message: string }>;
  dockerArgsSha256: string;
  rawOutputSha256: string;
  attestationPayload?: UnsignedWorkerIsolationAttestation;
}

const probeScript = [
  "const fs=require('node:fs');",
  "const writable=p=>{try{fs.writeFileSync(p,'x');fs.unlinkSync(p);return true}catch{return false}};",
  "const status=fs.readFileSync('/proc/self/status','utf8');",
  "const cap=/^CapEff:\\s*([0-9a-f]+)/mi.exec(status)?.[1]||'';",
  "const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').split(/\\n/).map(line=>line.split(' ')[4]);",
  "const sensitive=Object.keys(process.env).filter(k=>/(TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|GITHUB|AZURE)/i.test(k));",
  "console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),rootWritable:writable('/watai-root-probe'),sourceWritable:writable('/workspace/source/watai-source-probe'),capEff:cap,interfaces:fs.readdirSync('/sys/class/net').sort(),sensitiveEnvironmentNames:sensitive,dockerSocketPresent:fs.existsSync('/var/run/docker.sock'),homeMounted:mounts.some(path=>path==='/home'||path.startsWith('/home/')),dependencyDirectoryPresent:fs.existsSync('/opt/watai/node_modules')}));",
].join("");

export function buildWorkerIsolationProbeArgs(
  sourceRoot: string,
  runtime: WorkerRuntimePlan,
): string[] {
  if (!/^[a-f0-9]{64}$/.test(runtime.runtimeImageSha256)) throw new Error("Runtime image SHA-256 is invalid.");
  return [
    "run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", String(runtime.pidsLimit), "--memory", `${runtime.memoryMb}m`, "--cpus", String(runtime.cpuCount),
    "--mount", `type=bind,src=${sourceRoot.replaceAll("\\", "/")},dst=/workspace/source,readonly`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    `sha256:${runtime.runtimeImageSha256}`,
    "node", "-e", probeScript,
  ];
}

export function probeWorkerIsolation(
  task: LockedTaskSpec,
  runtime: WorkerRuntimePlan,
  sourceRoot: string,
  execute: (args: string[]) => { status: number | null; stdout: string; stderr: string } = (args) => {
    const result = spawnSync("docker", args, {
      encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
      windowsHide: true, shell: false,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
  },
): WorkerIsolationProbeResult {
  const args = buildWorkerIsolationProbeArgs(sourceRoot, runtime);
  const result = execute(args);
  const rawOutputSha256 = createHash("sha256").update(result.stdout).update("\0").update(result.stderr).digest("hex");
  const blockers: WorkerIsolationProbeResult["blockers"] = [];
  if (result.status !== 0) {
    blockers.push({ code: "ISOLATION_PROBE_FAILED", message: result.stderr.slice(0, 1000) || "Docker probe failed." });
  }
  let observed: ProbeOutput | undefined;
  try {
    observed = JSON.parse(result.stdout.trim()) as ProbeOutput;
  } catch {
    blockers.push({ code: "ISOLATION_PROBE_OUTPUT_INVALID", message: "Docker probe did not return one JSON observation." });
  }
  if (observed && (
    observed.uid !== 1000 || observed.gid !== 1000 || observed.rootWritable || observed.sourceWritable ||
    !/^0+$/.test(observed.capEff) || observed.interfaces.some((name) => name !== "lo") ||
    observed.sensitiveEnvironmentNames.length > 0 || observed.dockerSocketPresent || observed.homeMounted ||
    !observed.dependencyDirectoryPresent
  )) {
    blockers.push({ code: "ISOLATION_CONTROLS_FAILED", message: "Observed container isolation does not match the worker contract." });
  }
  const attestationPayload: UnsignedWorkerIsolationAttestation | undefined = blockers.length === 0 ? {
    attestationId: `worker-isolation-${task.runId}-${runtime.runtimeImageSha256.slice(0, 12)}`,
    taskSpecSha256: task.taskSpecSha256,
    policySha256: task.bindings.policySha256,
    runtimeImageSha256: runtime.runtimeImageSha256,
    engine: "docker-linux",
    networkMode: "none",
    rootFilesystemReadOnly: true,
    sourceMountReadOnly: true,
    writesThroughGateway: true,
    nonRootUser: true,
    noNewPrivileges: true,
    droppedCapabilities: ["ALL"],
    dockerSocketMounted: false,
    hostHomeMounted: false,
    credentialEnvironmentEmpty: true,
  } : undefined;
  return {
    status: blockers.length === 0 ? "PASSED" : "FAILED",
    blockers,
    dockerArgsSha256: createHash("sha256").update(JSON.stringify(args)).digest("hex"),
    rawOutputSha256,
    ...(attestationPayload ? { attestationPayload } : {}),
  };
}
