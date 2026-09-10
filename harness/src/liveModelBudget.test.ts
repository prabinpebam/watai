// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteLiveModelBudget } from "./liveModelBudget";
import { SqliteHarnessStore } from "./sqliteStore";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("SQLite live-model budget", () => {
  it("durably reserves the full evaluation before dispatch across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watai-live-budget-"));
    directories.push(directory);
    const store = new SqliteHarnessStore(join(directory, "budget.sqlite"));
    const budget = new SqliteLiveModelBudget(store, "evaluation-grant", "eval-run-1", {
      usd: 5,
      inputTokens: 100_000,
      outputTokens: 10_000,
      requests: 20,
      aiCredits: 20,
    });
    const reservation = await budget.reserve({
      evaluationId: "semantic-routing-live",
      worstCase: { usd: 5, inputTokens: 100_000, outputTokens: 10_000, requests: 20, aiCredits: 20 },
      expectedRuns: 18,
    });
    expect(store.readBudget("evaluation-grant").reservations[0].status).toBe("dispatched");
    store.close();

    const restarted = new SqliteHarnessStore(join(directory, "budget.sqlite"));
    expect(restarted.readBudget("evaluation-grant").reservations[0]).toMatchObject({
      reservationId: reservation.reservationId,
      status: "dispatched",
    });
    restarted.close();
  });

  it("settles actual usage within the reserved ceiling", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watai-live-budget-"));
    directories.push(directory);
    const store = new SqliteHarnessStore(join(directory, "budget.sqlite"));
    const budget = new SqliteLiveModelBudget(store, "evaluation-grant", "eval-run-2", {
      usd: 5, inputTokens: 100_000, outputTokens: 10_000, requests: 20, aiCredits: 20,
    });
    const reservation = await budget.reserve({
      evaluationId: "semantic-routing-live",
      worstCase: { usd: 5, inputTokens: 100_000, outputTokens: 10_000, requests: 20, aiCredits: 20 },
      expectedRuns: 18,
    });
    await budget.settle(reservation.reservationId, {
      usd: 2, inputTokens: 50_000, outputTokens: 5_000, requests: 18, aiCredits: 10,
    });
    expect(store.readBudget("evaluation-grant").reservations[0]).toMatchObject({
      status: "settled",
      actual: { usd: 2, requests: 18, aiCredits: 10 },
    });
    store.close();
  });

  it("rejects concurrent evaluations that exceed the shared grant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watai-live-budget-"));
    directories.push(directory);
    const store = new SqliteHarnessStore(join(directory, "budget.sqlite"));
    const first = new SqliteLiveModelBudget(store, "evaluation-grant", "eval-run-a", {
      usd: 10, inputTokens: 200, outputTokens: 200, requests: 2, aiCredits: 30,
    });
    const second = new SqliteLiveModelBudget(store, "evaluation-grant", "eval-run-b", {
      usd: 10, inputTokens: 200, outputTokens: 200, requests: 2, aiCredits: 30,
    });
    await first.reserve({
      evaluationId: "first", worstCase: { usd: 4, inputTokens: 80, outputTokens: 80, requests: 1, aiCredits: 20 }, expectedRuns: 1,
    });
    await expect(second.reserve({
      evaluationId: "second", worstCase: { usd: 4, inputTokens: 80, outputTokens: 80, requests: 1, aiCredits: 20 }, expectedRuns: 1,
    })).rejects.toThrow();
    store.close();
  });
});
