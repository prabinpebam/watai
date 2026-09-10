import { execFileSync } from "node:child_process";
import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export interface CandidateWorktreeRequest {
  repositoryRoot: string;
  worktreeRoot: string;
  sliceId: string;
  runId: string;
  baseSha: string;
}

export interface CandidateWorktree {
  path: string;
  branch: string;
  headSha: string;
  clean: boolean;
}

export class WorktreeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

function git(repositoryRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new WorktreeError("GIT_COMMAND_FAILED", (stderr || "Git command failed.").slice(0, 4000));
  }
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function prepareCandidateWorktree(
  request: CandidateWorktreeRequest,
): Promise<CandidateWorktree> {
  if (!/^[HES]\d{2}$/.test(request.sliceId)) {
    throw new WorktreeError("SLICE_ID_INVALID", "Slice ID must match the canonical backlog format.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(request.runId)) {
    throw new WorktreeError("RUN_ID_INVALID", "Run ID is not filesystem and branch safe.");
  }
  if (!/^[a-f0-9]{40}$/.test(request.baseSha)) {
    throw new WorktreeError("BASE_SHA_INVALID", "Base must be an exact Git commit SHA.");
  }
  const repositoryRoot = await realpath(request.repositoryRoot);
  const worktreeParent = resolve(request.worktreeRoot);
  await mkdir(worktreeParent, { recursive: true });
  const physicalParent = await realpath(worktreeParent);
  if (inside(repositoryRoot, physicalParent)) {
    throw new WorktreeError("WORKTREE_ROOT_INSIDE_REPOSITORY", "Candidate worktrees must be outside the controller checkout.");
  }
  git(repositoryRoot, ["cat-file", "-e", `${request.baseSha}^{commit}`]);
  const branch = `candidate/${request.sliceId}/${request.runId}`;
  const target = resolve(physicalParent, `${request.sliceId}-${request.runId}`);
  if (!inside(physicalParent, target) || basename(target) !== `${request.sliceId}-${request.runId}`) {
    throw new WorktreeError("WORKTREE_PATH_INVALID", "Candidate worktree path escaped its root.");
  }
  const existingBranch = git(repositoryRoot, ["branch", "--list", branch]);
  const listed = git(repositoryRoot, ["worktree", "list", "--porcelain"]);
  const targetIdentity = resolve(target).toLowerCase();
  const worktreeExists = listed.split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)).toLowerCase())
    .includes(targetIdentity);
  if (worktreeExists) {
    const headSha = git(target, ["rev-parse", "HEAD"]);
    const currentBranch = git(target, ["branch", "--show-current"]);
    if (headSha !== request.baseSha || currentBranch !== branch) {
      throw new WorktreeError("WORKTREE_BINDING_FAILED", "Existing candidate worktree moved from its exact source binding.");
    }
    const status = git(target, ["status", "--porcelain=v1", "--untracked-files=all"]);
    return { path: target, branch, headSha, clean: !status };
  }
  if (existingBranch) {
    const branchSha = git(repositoryRoot, ["rev-parse", branch]);
    if (branchSha !== request.baseSha) {
      throw new WorktreeError("BRANCH_BINDING_FAILED", `Existing candidate branch moved from ${request.baseSha}.`);
    }
    git(repositoryRoot, ["worktree", "add", target, branch]);
    return { path: target, branch, headSha: branchSha, clean: true };
  }

  try {
    git(repositoryRoot, ["worktree", "add", "--no-checkout", "-b", branch, target, request.baseSha]);
    git(target, ["checkout", "--detach", request.baseSha]);
    git(target, ["switch", "-C", branch, request.baseSha]);
    const headSha = git(target, ["rev-parse", "HEAD"]);
    const currentBranch = git(target, ["branch", "--show-current"]);
    const status = git(target, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (headSha !== request.baseSha || currentBranch !== branch || status) {
      throw new WorktreeError("WORKTREE_BINDING_FAILED", "Created worktree is not cleanly bound to the requested source.");
    }
    return { path: target, branch, headSha, clean: true };
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
    try {
      git(repositoryRoot, ["worktree", "prune"]);
      git(repositoryRoot, ["branch", "-D", branch]);
    } catch {}
    throw error;
  }
}