import { execFileSync } from "node:child_process";
import type { GitHubTokenProvider } from "@github/copilot-sdk";

export interface TokenCommand {
  executable: string;
  args: string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface TokenExecutor {
  execute(command: TokenCommand): string;
}

const defaultExecutor: TokenExecutor = {
  execute(command) {
    return execFileSync(command.executable, command.args, {
      encoding: "utf8",
      timeout: command.timeoutMs,
      maxBuffer: command.maxOutputBytes,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
      },
    });
  },
};

export function createLocalGhTokenProvider(
  executor: TokenExecutor = defaultExecutor,
): GitHubTokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  return async ({ host }) => {
    const normalizedHost = host.toLowerCase();
    if (normalizedHost !== "github.com" && normalizedHost !== "api.github.com") {
      return { kind: "cancelled", reason: "Unsupported GitHub host." };
    }
    const now = Date.now();
    if (cached && cached.expiresAt - 30_000 > now) {
      return { kind: "token", accessToken: cached.token, expiresIn: Math.floor((cached.expiresAt - now) / 1000) };
    }
    let token: string;
    try {
      token = executor.execute({
        executable: "gh",
        args: ["auth", "token", "--hostname", "github.com"],
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
      }).trim();
    } catch {
      return { kind: "cancelled", reason: "Token broker could not acquire a current credential." };
    }
    if (!token || token.length > 16 * 1024 || /\s/.test(token)) {
      return { kind: "cancelled", reason: "Token broker returned an invalid credential." };
    }
    const lifetimeSeconds = 5 * 60;
    cached = { token, expiresAt: now + lifetimeSeconds * 1_000 };
    return { kind: "token", accessToken: token, expiresIn: lifetimeSeconds };
  };
}