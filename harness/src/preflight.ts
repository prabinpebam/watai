import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface CommandObservation {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface DeploymentObservation {
  sourceSha: string | null;
  frontendArtifactSha256: string | null;
  apiArtifactSha256: string | null;
  runtime: string | null;
  region: string | null;
  configRevision: string | null;
  infraRevision: string | null;
  dataSchemaRevision: string | null;
  queueGeneration: string | null;
  reason: string;
}

export interface LocalPreflightReport {
  schemaVersion: "1.0";
  status: "OBSERVED_PARTIAL" | "OBSERVED_LOCAL_COMPLETE";
  releaseEligible: false;
  collectedAt: string;
  repository: {
    repositoryId: string;
    branch: string;
    upstream: string | null;
    sourceSha: string;
    treeSha256: string;
    diffSha256: string;
    clean: boolean;
    changedPaths: string[];
  };
  contracts: {
    backlogSha256: string;
    policySha256: string;
    workflowSha256: string;
    schemaSha256: string;
  };
  dependencies: {
    rootLockSha256: string;
    apiLockSha256: string;
  };
  toolchain: {
    platform: string;
    architecture: string;
    node: CommandObservation;
    npm: CommandObservation;
    git: CommandObservation;
    dockerClient: CommandObservation;
    dockerServer: CommandObservation;
    azureCli: CommandObservation;
    functionsCoreTools: CommandObservation;
    githubCli: CommandObservation;
  };
  packageSources: {
    npmRegistry: string | null;
    approvedNpmRegistry: string;
    compliant: boolean;
    observedRegistries: Array<{ context: string; key: string; location: string; compliant: boolean }>;
    violations: string[];
  };
  validationInventory: {
    rootScripts: string[];
    apiScripts: string[];
    requiredCommandsPresent: boolean;
  };
  deployment: DeploymentObservation;
  blockers: Array<{ code: string; message: string }>;
  observations: Array<{ code: string; message: string }>;
}

interface CommandResult {
  ok: boolean;
  stdout: string;
}

const approvedNpmRegistry = "https://packagefeedproxy.microsoft.io/npm/";

function sanitizedLocation(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return `invalid:${digest(value).slice(0, 12)}`;
  }
}

function approvedRegistry(value: string, approved: string[]): boolean {
  const normalized = value.endsWith("/") ? value : `${value}/`;
  return approved.some((entry) => normalized === (entry.endsWith("/") ? entry : `${entry}/`));
}

export function analyzeNpmSources(
  contexts: Array<{ name: string; config: Record<string, unknown>; manifestText: string; lockText: string }>,
  approved: string[] = [approvedNpmRegistry],
  sourceLayers: Array<{ name: string; config: Record<string, unknown> }> = [],
): LocalPreflightReport["packageSources"] {
  const observedRegistries: LocalPreflightReport["packageSources"]["observedRegistries"] = [];
  const violations: string[] = [];
  const contextsWithRegistry = new Set<string>();
  let defaultRegistry: string | null = null;
  for (const context of contexts) {
    for (const [key, rawValue] of Object.entries(context.config)) {
      if (key.toLowerCase() !== "registry" && !key.toLowerCase().endsWith(":registry")) continue;
      if (typeof rawValue !== "string") {
        violations.push(`${context.name}:${key}:non-string-registry`);
        continue;
      }
      if (key.toLowerCase() === "registry" && context.name === "root") defaultRegistry = rawValue;
      contextsWithRegistry.add(context.name);
      const compliant = approvedRegistry(rawValue, approved);
      observedRegistries.push({
        context: context.name,
        key,
        location: sanitizedLocation(rawValue),
        compliant,
      });
      if (!compliant) violations.push(`${context.name}:${key}:unapproved-registry`);
    }

    let manifest: Record<string, unknown>;
    let lock: unknown;
    try {
      manifest = JSON.parse(context.manifestText) as Record<string, unknown>;
      lock = JSON.parse(context.lockText);
    } catch {
      violations.push(`${context.name}:package-json-invalid`);
      continue;
    }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = manifest[section];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
      for (const [name, specification] of Object.entries(dependencies as Record<string, unknown>)) {
        if (
          typeof specification === "string" &&
          /^(?:https?:|git(?:\+|:)|github:|ssh:)/i.test(specification)
        ) {
          violations.push(`${context.name}:${section}:${name}:direct-source`);
        }
      }
    }
    const inspectLock = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(inspectLock);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === "resolved" && typeof child === "string" && /^https?:/i.test(child)) {
          if (!approved.some((entry) => child.startsWith(entry))) {
            violations.push(`${context.name}:lock:${sanitizedLocation(child)}:unapproved-resolved`);
          }
        } else {
          inspectLock(child);
        }
      }
    };
    inspectLock(lock);
  }
  for (const layer of sourceLayers) {
    for (const [key, rawValue] of Object.entries(layer.config)) {
      if (key.toLowerCase() !== "registry" && !key.toLowerCase().endsWith(":registry")) continue;
      if (typeof rawValue !== "string") {
        violations.push(`${layer.name}:${key}:non-string-registry`);
        continue;
      }
      const compliant = approvedRegistry(rawValue, approved);
      observedRegistries.push({
        context: layer.name,
        key,
        location: sanitizedLocation(rawValue),
        compliant,
      });
      if (!compliant) violations.push(`${layer.name}:${key}:unapproved-registry`);
    }
  }
  return {
    npmRegistry: defaultRegistry,
    approvedNpmRegistry,
    compliant: contexts.every((context) => contextsWithRegistry.has(context.name)) && violations.length === 0,
    observedRegistries,
    violations: [...new Set(violations)].sort(),
  };
}

function parseNpmrcRegistries(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (key.toLowerCase() !== "registry" && !key.toLowerCase().endsWith(":registry")) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function readNpmrcRegistries(path: string | undefined): Promise<Record<string, string>> {
  if (!path) return {};
  try {
    return parseNpmrcRegistries(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

function registryEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env)
    .filter(([key, value]) =>
      Boolean(value) &&
      key.toLowerCase().startsWith("npm_config_") &&
      key.toLowerCase().includes("registry"))
    .map(([key, value]) => [key, value!]));
}

function run(cwd: string, executable: string, args: string[]): CommandResult {
  const candidates = process.platform === "win32" && !executable.includes(".")
    ? [executable, `${executable}.cmd`]
    : [executable];
  for (const candidate of candidates) {
    try {
      const stdout = execFileSync(candidate, args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trimEnd();
      return { ok: true, stdout };
    } catch {}
  }
  if (
    process.platform === "win32" &&
    !/[\r\n\0&|<>^%]/.test(executable) &&
    args.every((arg) => !/[\r\n\0&|<>^%]/.test(arg))
  ) {
    try {
      const shim = executable.endsWith(".cmd") ? executable : `${executable}.cmd`;
      const stdout = execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", shim, ...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trimEnd();
      return { ok: true, stdout };
    } catch {}
  }
  return { ok: false, stdout: "" };
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/, 1)[0]?.trim() || undefined;
}

function commandVersion(cwd: string, executable: string, args: string[]): CommandObservation {
  const result = run(cwd, executable, args);
  if (result.ok) return { available: true, version: firstLine(result.stdout) };
  const located = process.platform === "win32"
    ? run(cwd, "where.exe", [`${executable}.cmd`])
    : run(cwd, "which", [executable]);
  return located.ok
    ? { available: false, reason: "Command is installed but its local version probe failed." }
    : { available: false, reason: "Command is not installed or discoverable." };
}

function runNpm(cwd: string, args: string[]): CommandResult {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? run(cwd, process.execPath, [npmExecPath, ...args])
    : run(cwd, "npm", args);
}

export function repositoryIdFromRemote(remote: string): string {
  const trimmed = remote.trim();
  const match = trimmed.match(/(?:github\.com[/:])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : `unknown:${digest(trimmed).slice(0, 12)}`;
}

export function evaluatePreflight(
  report: Omit<LocalPreflightReport, "status" | "blockers" | "observations">,
): Pick<LocalPreflightReport, "status" | "blockers" | "observations"> {
  const blockers: LocalPreflightReport["blockers"] = [];
  const observations: LocalPreflightReport["observations"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });

  if (!report.repository.clean) {
    block("SOURCE_DIRTY", "The observed source has working-tree changes and cannot be spec-locked.");
  }
  if (!report.packageSources.compliant) {
    block("NPM_FEED_NONCOMPLIANT", "npm is not routed through the approved Microsoft package feed.");
  }
  if (!report.validationInventory.requiredCommandsPresent) {
    block("VALIDATION_INVENTORY_INCOMPLETE", "Required root/API validation scripts are missing.");
  }
  if (!report.toolchain.dockerServer.available) {
    block("WORKER_ISOLATION_UNAVAILABLE", "The configured Docker server is not reachable.");
  }
  if (
    !report.deployment.sourceSha &&
    (!report.deployment.frontendArtifactSha256 || !report.deployment.apiArtifactSha256)
  ) {
    block(
      "DEPLOYED_IDENTITY_INCOMPLETE",
      "A source commit or exact frontend and API artifact digests must be observed.",
    );
  }
  if (!report.deployment.runtime || !report.deployment.region) {
    block("DEPLOYMENT_RUNTIME_UNKNOWN", "The deployed runtime and region have not been observed.");
  }
  if (!report.deployment.configRevision || !report.deployment.infraRevision) {
    block("DEPLOYMENT_CONFIG_UNKNOWN", "Configuration and infrastructure revisions are unknown.");
  }

  for (const [name, command] of Object.entries(report.toolchain)) {
    if (typeof command === "object" && command && "available" in command && !command.available) {
      observations.push({ code: `TOOL_UNAVAILABLE:${name}`, message: command.reason ?? "Unavailable" });
    }
  }

  return {
    status: blockers.length === 0 ? "OBSERVED_LOCAL_COMPLETE" : "OBSERVED_PARTIAL",
    blockers,
    observations,
  };
}

export async function collectLocalPreflight(
  root: string,
  deployment?: Partial<DeploymentObservation>,
): Promise<LocalPreflightReport> {
  const read = (path: string) => readFile(resolve(root, path));
  const [
    backlog,
    policy,
    workflow,
    schema,
    rootLock,
    apiLock,
    rootPackageText,
    apiPackageText,
  ] = await Promise.all([
    read("documentation/implementation/2026-09-10-autonomous-delivery/contracts/backlog.json"),
    read("documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json"),
    read("documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json"),
    read("documentation/implementation/2026-09-10-autonomous-delivery/contracts/plan.schema.json"),
    read("package-lock.json"),
    read("api/package-lock.json"),
    read("package.json"),
    read("api/package.json"),
  ]);
  const rootPackage = JSON.parse(rootPackageText.toString("utf8")) as { scripts?: Record<string, string> };
  const apiPackage = JSON.parse(apiPackageText.toString("utf8")) as { scripts?: Record<string, string> };
  const status = run(root, "git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  const changedPaths = status.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).replaceAll("\\", "/"))
    .sort();
  const head = run(root, "git", ["rev-parse", "HEAD"]);
  const branch = run(root, "git", ["branch", "--show-current"]);
  const upstream = run(root, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const remote = run(root, "git", ["config", "--get", "remote.origin.url"]);
  const treeListing = run(root, "git", ["ls-tree", "-r", "--full-tree", "HEAD"]);
  const trackedDiff = run(root, "git", ["diff", "--binary", "HEAD", "--", "."]);
  const rootNpmConfig = runNpm(root, ["config", "list", "--json"]);
  const apiNpmConfig = runNpm(resolve(root, "api"), ["config", "list", "--json"]);
  const userConfigPath = runNpm(root, ["config", "get", "userconfig"]);
  const globalConfigPath = runNpm(root, ["config", "get", "globalconfig"]);
  const [projectNpmrc, apiNpmrc, userNpmrc, globalNpmrc] = await Promise.all([
    readNpmrcRegistries(resolve(root, ".npmrc")),
    readNpmrcRegistries(resolve(root, "api", ".npmrc")),
    readNpmrcRegistries(userConfigPath.ok ? userConfigPath.stdout.trim() : undefined),
    readNpmrcRegistries(globalConfigPath.ok ? globalConfigPath.stdout.trim() : undefined),
  ]);
  const npmVersion = runNpm(root, ["--version"]);
  const dockerClient = commandVersion(root, "docker", ["--version"]);
  const dockerServer = commandVersion(root, "docker", ["version", "--format", "{{.Server.Version}}"]);
  if (!dockerServer.available && dockerClient.available) {
    dockerServer.reason = "Docker client is installed but the configured server is unreachable.";
  }
  const rootScripts = Object.keys(rootPackage.scripts ?? {}).sort();
  const apiScripts = Object.keys(apiPackage.scripts ?? {}).sort();
  const requiredRoot = ["build", "test", "validate:harness"];
  const requiredApi = ["build", "test", "typecheck"];

  const base: Omit<LocalPreflightReport, "status" | "blockers" | "observations"> = {
    schemaVersion: "1.0",
    releaseEligible: false,
    collectedAt: new Date().toISOString(),
    repository: {
      repositoryId: repositoryIdFromRemote(remote.stdout.trim()),
      branch: branch.stdout.trim() || "unknown",
      upstream: upstream.ok ? upstream.stdout.trim() : null,
      sourceSha: head.stdout.trim() || "unknown",
      treeSha256: digest(treeListing.stdout),
      diffSha256: digest(`${status.stdout}\n${trackedDiff.stdout}`),
      clean: status.ok && status.stdout.length === 0,
      changedPaths,
    },
    contracts: {
      backlogSha256: digest(backlog),
      policySha256: digest(policy),
      workflowSha256: digest(workflow),
      schemaSha256: digest(schema),
    },
    dependencies: {
      rootLockSha256: digest(rootLock),
      apiLockSha256: digest(apiLock),
    },
    toolchain: {
      platform: process.platform,
      architecture: process.arch,
      node: { available: true, version: process.version },
      npm: npmVersion.ok
        ? { available: true, version: firstLine(npmVersion.stdout) }
        : { available: false, reason: "npm CLI unavailable or returned a nonzero status." },
      git: commandVersion(root, "git", ["--version"]),
      dockerClient,
      dockerServer,
      azureCli: commandVersion(root, "az", ["version", "--output", "tsv"]),
      functionsCoreTools: commandVersion(root, "func", ["--version"]),
      githubCli: commandVersion(root, "gh", ["--version"]),
    },
    packageSources: analyzeNpmSources(
      [
        {
          name: "root-effective",
          config: rootNpmConfig.ok ? JSON.parse(rootNpmConfig.stdout) as Record<string, unknown> : {},
          manifestText: rootPackageText.toString("utf8"),
          lockText: rootLock.toString("utf8"),
        },
        {
          name: "api-effective",
          config: apiNpmConfig.ok ? JSON.parse(apiNpmConfig.stdout) as Record<string, unknown> : {},
          manifestText: apiPackageText.toString("utf8"),
          lockText: apiLock.toString("utf8"),
        },
      ],
      [approvedNpmRegistry],
      [
        { name: "project-npmrc", config: projectNpmrc },
        { name: "api-project-npmrc", config: apiNpmrc },
        { name: "user-npmrc", config: userNpmrc },
        { name: "global-npmrc", config: globalNpmrc },
        { name: "environment", config: registryEnvironment() },
      ],
    ),
    validationInventory: {
      rootScripts,
      apiScripts,
      requiredCommandsPresent:
        requiredRoot.every((script) => rootScripts.includes(script)) &&
        requiredApi.every((script) => apiScripts.includes(script)),
    },
    deployment: {
      sourceSha: null,
      frontendArtifactSha256: null,
      apiArtifactSha256: null,
      runtime: null,
      region: null,
      configRevision: null,
      infraRevision: null,
      dataSchemaRevision: null,
      queueGeneration: null,
      reason: "Cloud and public deployment state was not queried by the local preflight.",
      ...deployment,
    },
  };

  return { ...base, ...evaluatePreflight(base) };
}