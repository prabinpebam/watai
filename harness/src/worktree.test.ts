// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareCandidateWorktree, WorktreeError } from "./worktree";

const directories: string[] = [];

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "watai-worktree-repo-"));
  const worktrees = await mkdtemp(join(tmpdir(), "watai-worktrees-"));
  directories.push(root, worktrees);
  await writeFile(join(root, "README.md"), "fixture\n", "utf8");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: root });
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, worktrees, baseSha };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("candidate worktree", () => {
  it("creates a clean external branch at the exact source SHA", async () => {
    const fixture = await repository();
    const result = await prepareCandidateWorktree({
      repositoryRoot: fixture.root,
      worktreeRoot: fixture.worktrees,
      sliceId: "S36",
      runId: "run-001",
      baseSha: fixture.baseSha,
    });
    expect(result).toMatchObject({
      branch: "candidate/S36/run-001",
      headSha: fixture.baseSha,
      clean: true,
    });
  });

  it("rejects branch reuse", async () => {
    const fixture = await repository();
    const request = {
      repositoryRoot: fixture.root,
      worktreeRoot: fixture.worktrees,
      sliceId: "S36",
      runId: "run-001",
      baseSha: fixture.baseSha,
    };
    await prepareCandidateWorktree(request);
    await expect(prepareCandidateWorktree(request)).rejects.toBeInstanceOf(WorktreeError);
  });

  it("rejects a worktree root inside the controller checkout", async () => {
    const fixture = await repository();
    const inside = join(fixture.root, ".worktrees");
    await mkdir(inside);
    await expect(prepareCandidateWorktree({
      repositoryRoot: fixture.root,
      worktreeRoot: inside,
      sliceId: "S36",
      runId: "run-001",
      baseSha: fixture.baseSha,
    })).rejects.toMatchObject({ code: "WORKTREE_ROOT_INSIDE_REPOSITORY" });
  });
});