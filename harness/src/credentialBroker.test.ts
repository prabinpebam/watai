// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createLocalGhTokenProvider, type TokenExecutor } from "./credentialBroker";

describe("local GitHub credential broker", () => {
  it("returns a short-lived in-memory token only for GitHub", async () => {
    const executor: TokenExecutor = { execute: vi.fn().mockReturnValue("synthetic-token\n") };
    const provider = createLocalGhTokenProvider(executor);
    const first = await provider({ host: "github.com", reason: "initial", sessionId: "session" });
    const second = await provider({ host: "github.com", reason: "refresh", sessionId: "session" });
    expect(first).toMatchObject({ kind: "token", accessToken: "synthetic-token", expiresIn: 300 });
    expect(second).toMatchObject({ kind: "token", accessToken: "synthetic-token" });
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("rejects unsupported hosts without executing gh", async () => {
    const executor: TokenExecutor = { execute: vi.fn() };
    const result = await createLocalGhTokenProvider(executor)({
      host: "example.com",
      reason: "initial",
      sessionId: "session",
    });
    expect(result).toMatchObject({ kind: "cancelled" });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("fails closed on command or malformed-token errors", async () => {
    const failing: TokenExecutor = { execute: vi.fn(() => { throw new Error("denied"); }) };
    const malformed: TokenExecutor = { execute: vi.fn().mockReturnValue("two words") };
    await expect(createLocalGhTokenProvider(failing)({ host: "github.com", reason: "initial", sessionId: "one" }))
      .resolves.toMatchObject({ kind: "cancelled" });
    await expect(createLocalGhTokenProvider(malformed)({ host: "github.com", reason: "initial", sessionId: "two" }))
      .resolves.toMatchObject({ kind: "cancelled" });
  });
});