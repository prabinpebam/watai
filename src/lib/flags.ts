// Client feature flags (localStorage-backed) for staged rollout of in-progress features.
//
// `serverRuns` routes generation through the server-authoritative run engine (POST a prompt; the
// server generates + persists the reply even if this client closes) instead of the legacy
// in-browser path. It requires cloud sign-in, cloud sync, and a server-side credential vault entry.
// Kept as an explicit opt-in so existing in-browser users are unaffected during the migration.

const SERVER_RUNS_KEY = 'watai.flags.serverRuns';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch {
    return false; // storage unavailable (e.g. private mode) — treat as off.
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'on');
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — flag silently stays off. */
  }
}

/** True when generation should be routed to the server-authoritative run engine. */
export function isServerRunsEnabled(): boolean {
  return readFlag(SERVER_RUNS_KEY);
}

export function setServerRunsEnabled(on: boolean): void {
  writeFlag(SERVER_RUNS_KEY, on);
}
