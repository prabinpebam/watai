import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAuthorityCeremonyRequest } from "./authorityCeremony.js";
import { collectAuthorityContractDigests } from "./authorityInputs.js";
import type { LiveModelEvaluationManifest } from "./modelEvaluation.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const approvedRegistry = "https://packagefeedproxy.microsoft.io/npm/";

function execute(executable: string, args: string[], maxBuffer = 20 * 1024 * 1024): string {
  return execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10 * 60_000,
    maxBuffer,
    windowsHide: true,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      APPDATA: process.env.APPDATA,
      npm_config_registry: approvedRegistry,
    },
  }).trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

const status = execute("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
if (status) throw new Error("Source is dirty. Commit and revalidate bootstrap changes before generating authority requests.");
const sourceSha = execute("git", ["rev-parse", "HEAD"]);
const npmEntryPoint = process.env.npm_execpath?.trim();
if (!npmEntryPoint) throw new Error("npm_execpath is required to invoke the pinned npm CLI portably.");
const npm = (args: string[]) => execute(process.execPath, [npmEntryPoint, ...args]);
const validation = npm(["run", "validate:harness"]);
const npmRegistry = npm(["config", "get", "registry"]);
if (npmRegistry !== approvedRegistry) throw new Error(`Effective npm registry is not approved: ${npmRegistry}`);

const imageReference = process.env.WATAI_SMOKE_WORKER_IMAGE?.trim() || "watai-harness-smoke-worker:local";
const imageId = execute("docker", ["image", "inspect", imageReference, "--format", "{{.Id}}"]);
if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Smoke worker image is not bound by an immutable SHA-256.");
const smokeWorkerImageSha256 = imageId.slice("sha256:".length);
const repositoryMount = root.replaceAll("\\", "/");
const probeScript = [
  "const fs=require('node:fs');",
  "const status=fs.readFileSync('/proc/self/status','utf8');",
  "const cap=/^CapEff:\\s*([0-9a-f]+)/mi.exec(status)?.[1]||'';",
  "const write=p=>{try{fs.writeFileSync(p,'x');return true}catch{return false}};",
  "console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),capEff:cap,rootWritable:write('/probe'),sourceWritable:write('/workspace/source/probe'),interfaces:fs.readdirSync('/sys/class/net').sort(),dependencies:fs.existsSync('/opt/watai/node_modules'),dockerSocket:fs.existsSync('/var/run/docker.sock')}));",
].join("");
const probe = execute("docker", [
  "run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000",
  "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64",
  "--memory", "1024m", "--cpus", "1",
  "--mount", `type=bind,src=${repositoryMount},dst=/workspace/source,readonly`,
  "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", imageId, "node", "-e", probeScript,
]);
const probeResult = JSON.parse(probe) as {
  uid: number; gid: number; capEff: string; rootWritable: boolean; sourceWritable: boolean;
  interfaces: string[]; dependencies: boolean; dockerSocket: boolean;
};
if (
  probeResult.uid !== 1000 || probeResult.gid !== 1000 || !/^0+$/.test(probeResult.capEff) ||
  probeResult.rootWritable || probeResult.sourceWritable || probeResult.interfaces.some((name) => name !== "lo") ||
  !probeResult.dependencies || probeResult.dockerSocket
) {
  throw new Error("Smoke worker isolation probe failed.");
}

const ghStatus = spawnSync("gh", ["auth", "status", "--hostname", "github.com"], {
  cwd: root,
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
  stdio: ["ignore", "ignore", "ignore"],
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, LOCALAPPDATA: process.env.LOCALAPPDATA,
    APPDATA: process.env.APPDATA },
});
if (ghStatus.status !== 0) throw new Error("GitHub CLI has no current authenticated github.com account.");
const dockerServerVersion = execute("docker", ["version", "--format", "{{.Server.Version}}"]).trim();
const rootInputs = await collectAuthorityContractDigests(root);
const manifest = JSON.parse(
  await import("node:fs/promises").then(({ readFile }) =>
    readFile(resolve(root, "harness", "evaluator", "model-evaluations.json"), "utf8")),
) as LiveModelEvaluationManifest;
const contract = manifest.evaluations.find((evaluation) => evaluation.id === "implementation-agent-smoke");
if (!contract) throw new Error("Frozen implementation-agent-smoke contract is missing.");
const request = buildAuthorityCeremonyRequest({
  repositoryId: process.env.WATAI_REPOSITORY_ID?.trim() || "prabinpebam/watai",
  evidence: {
    sourceSha,
    rootInputs,
    smokeWorkerImageSha256,
    smokeWorkerProbeSha256: digest(probe),
    validationOutputSha256: digest(validation),
    npmRegistry,
    gitHubCliAuthenticated: true,
    dockerServerVersion,
  },
  evaluationBudget: contract.budget,
  maxAiCredits: contract.budget.requests,
  claimLifetimeSeconds: 15 * 60,
});

const requestedOutputRoot = resolve(
  process.env.WATAI_AUTHORITY_REQUEST_ROOT?.trim() || resolve(root, "..", "watai-harness-authority-requests"),
);
await mkdir(requestedOutputRoot, { recursive: true, mode: 0o700 });
const repository = await realpath(root);
const outputRoot = await realpath(requestedOutputRoot);
if (inside(repository, outputRoot)) throw new Error("Authority requests must be written outside the repository.");
const outputDirectory = resolve(outputRoot, `bootstrap-${sourceSha.slice(0, 12)}`);
await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
await Promise.all([
  writeFile(resolve(outputDirectory, "ceremony-request.json"), `${JSON.stringify(request, null, 2)}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600,
  }),
  writeFile(resolve(outputDirectory, "validation.log"), `${validation}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600,
  }),
  writeFile(resolve(outputDirectory, "smoke-worker-probe.json"), `${JSON.stringify(probeResult, null, 2)}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600,
  }),
  writeFile(resolve(outputDirectory, "OWNER-REVIEW.md"), [
    "# Independent authority review",
    "",
    "1. Verify the committed source SHA and every root binding independently.",
    "2. Review the validation log and rerun checks from trusted source if needed.",
    "3. Verify the smoke image digest and isolation controls.",
    "4. Supply independent owner and runtime-evidence public keys in the trust root.",
    "5. Sign only the approved request payloads; keep private keys outside this directory and repository.",
    "6. Pin the canonical trust-root digest separately from the authority bundle.",
    "",
    "This package grants evaluation bootstrap only. It does not authorize candidate implementation or release.",
    "",
  ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 }),
]);

console.log(JSON.stringify({
  schemaVersion: "1.0",
  status: "READY_FOR_INDEPENDENT_REVIEW",
  releaseEligible: false,
  sourceSha,
  smokeWorkerImageSha256,
  evidenceSha256: request.evidenceSha256,
  outputDirectory,
  next: "An independent owner reviews this package, creates the root, signs approved claim requests, and supplies an external runtime evidence signer.",
}, null, 2));