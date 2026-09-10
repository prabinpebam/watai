import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import type { LockedTaskSpec } from "./taskSpec.js";
import { canonical, sha256 } from "./trust.js";
import type {
  FixedValidationCommand,
  GatewayRequest,
  GatewayResponse,
  GatewayToolId,
  WorkerLaunchManifest,
} from "./worker.js";

export interface GatewayStoredReceipt {
  requestId: string;
  runId: string;
  fingerprint: string;
  tool: GatewayToolId;
  status: "pending" | "completed";
  response?: GatewayResponse;
  createdAt: string;
  completedAt?: string;
}

export interface GatewayReceiptStore {
  begin(receipt: Omit<GatewayStoredReceipt, "status" | "response" | "completedAt">): Promise<GatewayStoredReceipt | undefined>;
  complete(runId: string, requestId: string, fingerprint: string, response: GatewayResponse, completedAt: string): Promise<void>;
  list(runId: string): Promise<GatewayStoredReceipt[]>;
}

export class MemoryGatewayReceiptStore implements GatewayReceiptStore {
  private readonly receipts = new Map<string, GatewayStoredReceipt>();

  async begin(receipt: Omit<GatewayStoredReceipt, "status" | "response" | "completedAt">): Promise<GatewayStoredReceipt | undefined> {
    const key = `${receipt.runId}\0${receipt.requestId}`;
    const prior = this.receipts.get(key);
    if (prior) return structuredClone(prior);
    this.receipts.set(key, { ...receipt, status: "pending" });
    return undefined;
  }

  async complete(runId: string, requestId: string, fingerprint: string, response: GatewayResponse, completedAt: string): Promise<void> {
    const key = `${runId}\0${requestId}`;
    const current = this.receipts.get(key);
    if (!current || current.fingerprint !== fingerprint) throw new Error("Gateway receipt completion is stale or conflicting.");
    this.receipts.set(key, { ...current, status: "completed", response: structuredClone(response), completedAt });
  }

  async list(runId: string): Promise<GatewayStoredReceipt[]> {
    return [...this.receipts.values()].filter((receipt) => receipt.runId === runId).map((receipt) => structuredClone(receipt));
  }
}

export interface GatewayValidationResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  passed: boolean;
}

export interface GatewayValidationRunner {
  run(command: FixedValidationCommand, context: {
    workspaceRoot: string;
    manifest: WorkerLaunchManifest;
  }): GatewayValidationResult;
}

export function buildDockerValidationArgs(
  command: FixedValidationCommand,
  workspaceRoot: string,
  manifest: WorkerLaunchManifest,
): string[] {
  const workspace = workspaceRoot.replaceAll("\\", "/");
  const relativeCwd = command.cwd.replaceAll("\\", "/").replace(/^\.\/?/, "");
  const workdir = `/workspace/run/${relativeCwd}`.replace(/\/$/, "");
  return [
    "run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", String(manifest.runtime.pidsLimit),
    "--memory", `${manifest.runtime.memoryMb}m`,
    "--cpus", String(manifest.runtime.cpuCount),
    "--mount", `type=bind,src=${workspace},dst=/workspace/source,readonly`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m",
    "--tmpfs", `/workspace/run:rw,nosuid,size=${manifest.runtime.memoryMb}m`,
    "--workdir", "/workspace/run",
    "--env", `PATH=${manifest.runtime.containerDependencyDirectory}/.bin:/usr/local/bin:/usr/bin:/bin`,
    "--env", "npm_config_registry=https://packagefeedproxy.microsoft.io/npm/",
    `sha256:${manifest.runtime.runtimeImageSha256}`,
    "/bin/sh",
    "-c",
    "cp -a /workspace/source/. /workspace/run/ && test -d \"$2\" && if [ ! -e /workspace/run/node_modules ]; then ln -s \"$2\" /workspace/run/node_modules; fi && cd \"$1\" && shift 2 && exec \"$@\"",
    "watai-validation",
    workdir,
    manifest.runtime.containerDependencyDirectory,
    command.executable,
    ...command.args,
  ];
}

export class DockerGatewayValidationRunner implements GatewayValidationRunner {
  run(command: FixedValidationCommand, context: {
    workspaceRoot: string;
    manifest: WorkerLaunchManifest;
  }): GatewayValidationResult {
    const args = buildDockerValidationArgs(command, context.workspaceRoot, context.manifest);
    const result = spawnSync("docker", args, {
      encoding: "utf8",
      maxBuffer: command.maxOutputBytes,
      timeout: command.timeoutMs,
      windowsHide: true,
      shell: false,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
      },
    });
    return {
      exitCode: result.status,
      signal: result.signal,
      stdout: (result.stdout ?? "").slice(0, command.maxOutputBytes),
      stderr: (result.stderr ?? result.error?.message ?? "").slice(0, command.maxOutputBytes),
      passed: !result.error && result.status === 0,
    };
  }
}

export interface GatewayValidationReceipt {
  commandId: string;
  diffSha256: string;
  passed: boolean;
  resultSha256: string;
}

export interface GatewaySubmission {
  receiptId: string;
  runId: string;
  diffSha256: string;
  changedPaths: string[];
  validationCommandIds: string[];
  summary: string;
  completedAt: string;
}

export interface GatewayServiceOptions {
  workspaceRoot: string;
  task: LockedTaskSpec;
  manifest: WorkerLaunchManifest;
  receiptStore: GatewayReceiptStore;
  validationRunner?: GatewayValidationRunner;
  now?: () => number;
  maxReadBytes?: number;
  maxOutputBytes?: number;
}

interface GatewayErrorResult {
  code: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be nonempty text.`);
  return value;
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(value);
}

export class GatewayService {
  private readonly workspaceRoot: string;
  private readonly task: LockedTaskSpec;
  private readonly manifest: WorkerLaunchManifest;
  private readonly maxReadBytes: number;
  private readonly maxOutputBytes: number;
  private readonly validationCommands: Map<string, FixedValidationCommand>;
  private readonly receiptStore: GatewayReceiptStore;
  private readonly validationRunner: GatewayValidationRunner;
  private readonly now: () => number;
  private readonly validationReceipts = new Map<string, GatewayValidationReceipt>();
  private submission?: GatewaySubmission;

  private constructor(options: GatewayServiceOptions, workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.task = options.task;
    this.manifest = options.manifest;
    this.maxReadBytes = options.maxReadBytes ?? 1024 * 1024;
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
    this.receiptStore = options.receiptStore;
    this.validationRunner = options.validationRunner ?? new DockerGatewayValidationRunner();
    this.now = options.now ?? Date.now;
    this.validationCommands = new Map(options.manifest.runtime.validationCommands.map((command) => [command.id, command]));
  }

  static async create(options: GatewayServiceOptions): Promise<GatewayService> {
    const root = await realpath(options.workspaceRoot);
    if (
      options.task.taskSpecSha256 !== options.manifest.taskSpecSha256 ||
      options.task.source.sourceSha !== options.manifest.sourceSha ||
      options.task.bindings.policySha256 !== options.manifest.policySha256 ||
      options.task.fencingEpoch !== options.manifest.fencingEpoch
    ) {
      throw new Error("Gateway task and launch manifest are misbound.");
    }
    const service = new GatewayService(options, root);
    const head = service.git(["rev-parse", "HEAD"]).trim();
    if (head !== options.manifest.sourceSha) {
      throw new Error("Gateway workspace HEAD does not match the launch source SHA.");
    }
    const changed = service.changedPaths();
    if (changed.some((path) => !service.pathAllowed(path))) {
      throw new Error("Gateway workspace already contains changes outside the writable roots.");
    }
    for (const receipt of await options.receiptStore.list(options.manifest.runId)) {
      if (receipt.status !== "completed" || !receipt.response || receipt.response.status !== "success") continue;
      const result = receipt.response.result;
      if (!isRecord(result)) continue;
      if (typeof result.commandId === "string" && typeof result.diffSha256 === "string" && typeof result.passed === "boolean") {
        service.validationReceipts.set(result.commandId, {
          commandId: result.commandId,
          diffSha256: result.diffSha256,
          passed: result.passed,
          resultSha256: receipt.response.resultSha256,
        });
      }
      if (
        result.accepted === true &&
        typeof result.receiptId === "string" &&
        typeof result.diffSha256 === "string" &&
        Array.isArray(result.changedPaths) &&
        Array.isArray(result.validationCommandIds) &&
        typeof result.summary === "string" &&
        typeof result.completedAt === "string"
      ) {
        service.submission = result as unknown as GatewaySubmission;
      }
    }
    return service;
  }

  async invoke(request: GatewayRequest): Promise<GatewayResponse> {
    const fingerprint = sha256(canonical(request));
    const prior = await this.receiptStore.begin({
      requestId: request.requestId,
      runId: request.runId,
      fingerprint,
      tool: request.tool,
      createdAt: new Date(this.now()).toISOString(),
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        return this.response(request, "failure", {
          code: "REQUEST_ID_CONFLICT",
          message: "Gateway request ID was reused with different content.",
        });
      }
      if (prior.status !== "completed" || !prior.response) {
        return this.response(request, "failure", {
          code: "REQUEST_OUTCOME_UNKNOWN",
          message: "A prior gateway attempt began but has no durable completion receipt.",
        });
      }
      return prior.response;
    }
    let status: GatewayResponse["status"] = "success";
    let result: unknown;
    try {
      this.validateRequest(request);
      result = await this.execute(request);
    } catch (error) {
      status = "failure";
      result = {
        code: "GATEWAY_REJECTED",
        message: error instanceof Error ? error.message : String(error),
      } satisfies GatewayErrorResult;
    }
    const response = this.response(request, status, result);
    await this.receiptStore.complete(request.runId, request.requestId, fingerprint, response, new Date(this.now()).toISOString());
    return response;
  }

  async getSubmission(runId: string): Promise<GatewaySubmission | undefined> {
    if (runId !== this.manifest.runId) return undefined;
    return this.submission ? structuredClone(this.submission) : undefined;
  }

  private validateRequest(request: GatewayRequest): void {
    if (
      request.schemaVersion !== "1.0" ||
      !request.requestId.trim() ||
      request.runId !== this.manifest.runId ||
      request.taskSpecSha256 !== this.manifest.taskSpecSha256 ||
      request.manifestSha256 !== this.manifest.manifestSha256 ||
      request.fencingEpoch !== this.manifest.fencingEpoch ||
      !this.task.allowedTools.includes(request.tool)
    ) {
      throw new Error("Gateway request is invalid, stale or outside the locked tool set.");
    }
  }

  private response(
    request: GatewayRequest,
    status: GatewayResponse["status"],
    result: unknown,
  ): GatewayResponse {
    return {
      schemaVersion: "1.0",
      requestId: request.requestId,
      runId: request.runId,
      manifestSha256: request.manifestSha256,
      status,
      result,
      resultSha256: sha256(canonical(result)),
    };
  }

  private async resolveTrackedPath(path: string): Promise<string> {
    if (isAbsolute(path) || path.includes("\0")) throw new Error("Path must be repository-relative.");
    const target = resolve(this.workspaceRoot, path);
    const physical = await realpath(target);
    if (!inside(this.workspaceRoot, physical)) throw new Error("Path escapes the workspace.");
    return physical;
  }

  private pathAllowed(path: string): boolean {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
    return this.task.allowedPaths.some((root) => normalized === root || normalized.startsWith(`${root}/`));
  }

  private git(args: string[], input?: string, maxOutputBytes = this.maxOutputBytes): string {
    const result = spawnSync("git", args, {
      cwd: this.workspaceRoot,
      input,
      encoding: "utf8",
      maxBuffer: maxOutputBytes,
      timeout: 120_000,
      windowsHide: true,
      shell: false,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
      },
    });
    if (result.error || result.status !== 0) {
      throw new Error((result.stderr || result.error?.message || "Git command failed.").slice(0, 4000));
    }
    return result.stdout;
  }

  private async execute(request: GatewayRequest): Promise<unknown> {
    const args = request.arguments;
    if (!isRecord(args)) throw new Error("Tool arguments must be an object.");
    switch (request.tool) {
      case "watai_read_file": {
        const path = text(args.path, "path");
        const startLine = integer(args.startLine, "startLine", 1, 1_000_000);
        const endLine = integer(args.endLine, "endLine", startLine, 1_000_000);
        const physical = await this.resolveTrackedPath(path);
        const file = await readFile(physical);
        if (file.length > this.maxReadBytes) throw new Error("File exceeds the read-byte ceiling.");
        return { path, startLine, endLine, content: file.toString("utf8").split(/\r?\n/).slice(startLine - 1, endLine).join("\n") };
      }
      case "watai_search_text": {
        const query = text(args.query, "query");
        const includePattern = text(args.includePattern, "includePattern");
        const maxResults = integer(args.maxResults, "maxResults", 1, 200);
        const isRegexp = args.isRegexp === true;
        const matcher = isRegexp ? new RegExp(query, "i") : undefined;
        const files = this.git(["ls-files", "-z"]).split("\0").filter(Boolean);
        const extension = includePattern.startsWith("*.") ? includePattern.slice(1) : undefined;
        const results: Array<{ path: string; line: number; text: string }> = [];
        for (const path of files) {
          if (extension && !path.endsWith(extension)) continue;
          let content: string;
          try {
            const file = await readFile(await this.resolveTrackedPath(path));
            if (file.length > this.maxReadBytes || file.includes(0)) continue;
            content = file.toString("utf8");
          } catch {
            continue;
          }
          const lines = content.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            if ((matcher ? matcher.test(lines[index]) : lines[index].toLowerCase().includes(query.toLowerCase()))) {
              results.push({ path, line: index + 1, text: lines[index].slice(0, 500) });
              if (results.length >= maxResults) return { results, truncated: true };
            }
          }
        }
        return { results, truncated: false };
      }
      case "watai_apply_patch": {
        const patch = text(args.patch, "patch");
        const patchSha256 = text(args.patchSha256, "patchSha256");
        const expectedDiffSha256 = text(args.expectedDiffSha256, "expectedDiffSha256");
        if (createHash("sha256").update(patch).digest("hex") !== patchSha256) {
          throw new Error("Patch digest mismatch.");
        }
        const paths = [...patch.matchAll(/^(?:---|\+\+\+) (.+)$/gm)]
          .map((match) => match[1].trim())
          .filter((path) => path !== "/dev/null")
          .map((path) => path.replace(/^[ab]\//, ""));
        if (paths.length === 0 || paths.some((path) => !this.pathAllowed(path))) {
          throw new Error("Patch contains a path outside the writable roots.");
        }
        const beforeSha256 = await this.currentDiffSha256();
        if (expectedDiffSha256 !== beforeSha256) {
          throw new Error("Patch lost optimistic concurrency because the workspace diff changed.");
        }
        this.git(["apply", "--check", "--whitespace=error-all", "-"], patch);
        this.git(["apply", "--whitespace=error-all", "-"], patch);
        try {
          const changedPaths = this.changedPaths();
          if (changedPaths.some((path) => !this.pathAllowed(path))) {
            throw new Error("Resulting diff escaped the writable roots.");
          }
          return { changedPaths, diffSha256: await this.currentDiffSha256() };
        } catch (error) {
          this.git(["apply", "--reverse", "--whitespace=nowarn", "-"], patch);
          if (await this.currentDiffSha256() !== beforeSha256) {
            throw new Error("Patch rollback did not restore the prior workspace state.");
          }
          throw error;
        }
      }
      case "watai_run_validation": {
        const commandId = text(args.commandId, "commandId");
        const command = this.validationCommands.get(commandId);
        if (!command) throw new Error(`Unknown validation command ${commandId}.`);
        const diffSha256 = await this.currentDiffSha256();
        const result = this.validationRunner.run(command, { workspaceRoot: this.workspaceRoot, manifest: this.manifest });
        const output = {
          commandId,
          diffSha256,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
          passed: result.passed,
        };
        this.validationReceipts.set(commandId, {
          commandId,
          diffSha256,
          passed: result.passed,
          resultSha256: sha256(canonical(output)),
        });
        return output;
      }
      case "watai_git_diff":
        return {
          changedPaths: this.changedPaths(),
          diff: this.git(["diff", "--no-ext-diff", "--binary", "--", "."]),
          diffSha256: await this.currentDiffSha256(),
        };
      case "watai_submit_result": {
        const changedPaths = Array.isArray(args.changedPaths) ? args.changedPaths.map((path) => text(path, "changedPath")) : [];
        const actual = this.changedPaths();
        if (canonical([...changedPaths].sort()) !== canonical([...actual].sort())) {
          throw new Error("Submitted changed paths do not match the actual Git diff.");
        }
        const diffSha256 = await this.currentDiffSha256();
        const requiredValidationIds = [...this.validationCommands.keys()].sort();
        const submittedValidationIds = Array.isArray(args.validationCommandIds)
          ? args.validationCommandIds.map((id) => text(id, "validationCommandId")).sort()
          : [];
        if (canonical(requiredValidationIds) !== canonical(submittedValidationIds)) {
          throw new Error("Submission must name every fixed validation command exactly once.");
        }
        for (const commandId of requiredValidationIds) {
          const receipt = this.validationReceipts.get(commandId);
          if (!receipt || !receipt.passed || receipt.diffSha256 !== diffSha256) {
            throw new Error(`Validation ${commandId} has no passing receipt for the current diff.`);
          }
        }
        const completedAt = new Date(this.now()).toISOString();
        const summary = text(args.summary, "summary").slice(0, 4000);
        const submission: GatewaySubmission = {
          receiptId: sha256(canonical({ runId: request.runId, diffSha256, completedAt })),
          runId: request.runId,
          diffSha256,
          changedPaths: actual,
          validationCommandIds: requiredValidationIds,
          summary,
          completedAt,
        };
        this.submission = submission;
        return {
          accepted: true,
          ...submission,
        };
      }
    }
  }

  private changedPaths(): string[] {
    const tracked = this.git(["diff", "--name-only", "-z", "--", "."]).split("\0").filter(Boolean);
    const untracked = this.git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
    return [...new Set([...tracked, ...untracked].map((path) => path.replaceAll("\\", "/")))].sort();
  }

  private async currentDiffSha256(): Promise<string> {
    const hash = createHash("sha256");
    hash.update(this.git(["diff", "--no-ext-diff", "--binary", "--", "."]));
    for (const path of this.changedPaths()) {
      hash.update("\0");
      hash.update(path);
      try {
        hash.update("\0");
        hash.update(await readFile(await this.resolveTrackedPath(path)));
      } catch {
        hash.update("\0<missing>");
      }
    }
    return hash.digest("hex");
  }
}