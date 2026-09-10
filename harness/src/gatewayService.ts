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
  WorkerLaunchManifest,
} from "./worker.js";

interface GatewayServiceOptions {
  workspaceRoot: string;
  task: LockedTaskSpec;
  manifest: WorkerLaunchManifest;
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
  private readonly receipts = new Map<string, { fingerprint: string; response: GatewayResponse }>();

  private constructor(options: GatewayServiceOptions, workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.task = options.task;
    this.manifest = options.manifest;
    this.maxReadBytes = options.maxReadBytes ?? 1024 * 1024;
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
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
    return new GatewayService(options, root);
  }

  async invoke(request: GatewayRequest): Promise<GatewayResponse> {
    const fingerprint = sha256(canonical(request));
    const prior = this.receipts.get(request.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        return this.response(request, "failure", {
          code: "REQUEST_ID_CONFLICT",
          message: "Gateway request ID was reused with different content.",
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
    this.receipts.set(request.requestId, { fingerprint, response });
    return response;
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
        if (createHash("sha256").update(patch).digest("hex") !== patchSha256) {
          throw new Error("Patch digest mismatch.");
        }
        const paths = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1].trim());
        if (paths.length === 0 || paths.some((path) => !this.pathAllowed(path))) {
          throw new Error("Patch contains a path outside the writable roots.");
        }
        this.git(["apply", "--check", "--whitespace=error-all", "-"], patch);
        this.git(["apply", "--whitespace=error-all", "-"], patch);
        const changedPaths = this.changedPaths();
        if (changedPaths.some((path) => !this.pathAllowed(path))) {
          throw new Error("Resulting diff escaped the writable roots.");
        }
        return { changedPaths };
      }
      case "watai_run_validation": {
        const commandId = text(args.commandId, "commandId");
        const command = this.validationCommands.get(commandId);
        if (!command) throw new Error(`Unknown validation command ${commandId}.`);
        const result = spawnSync(command.executable, command.args, {
          cwd: resolve(this.workspaceRoot, command.cwd),
          encoding: "utf8",
          maxBuffer: command.maxOutputBytes,
          timeout: command.timeoutMs,
          windowsHide: true,
          shell: false,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            npm_config_registry: "https://packagefeedproxy.microsoft.io/npm/",
          },
        });
        return {
          commandId,
          exitCode: result.status,
          signal: result.signal,
          stdout: result.stdout.slice(0, command.maxOutputBytes),
          stderr: result.stderr.slice(0, command.maxOutputBytes),
          passed: !result.error && result.status === 0,
        };
      }
      case "watai_git_diff":
        return { changedPaths: this.changedPaths(), diff: this.git(["diff", "--no-ext-diff", "--binary", "--", "."]) };
      case "watai_submit_result": {
        const changedPaths = Array.isArray(args.changedPaths) ? args.changedPaths.map((path) => text(path, "changedPath")) : [];
        const actual = this.changedPaths();
        if (canonical([...changedPaths].sort()) !== canonical([...actual].sort())) {
          throw new Error("Submitted changed paths do not match the actual Git diff.");
        }
        return {
          accepted: true,
          summary: text(args.summary, "summary").slice(0, 4000),
          changedPaths: actual,
          validationCommandIds: Array.isArray(args.validationCommandIds) ? args.validationCommandIds : [],
        };
      }
    }
  }

  private changedPaths(): string[] {
    return this.git(["status", "--porcelain=v1", "--untracked-files=all"])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).replaceAll("\\", "/"))
      .sort();
  }
}