// Local session stub (auth plane is stubbed for the frontend-first build).
const SESSION_KEY = 'watai.session';

export interface Session {
  name: string;
  createdAt: string;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function startSession(name: string): Session {
  const session: Session = { name: name || 'You', createdAt: new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function endSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
