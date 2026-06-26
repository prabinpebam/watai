import type { SealedSecret } from '../domain/crypto';
import type { ModelDeployments } from '../domain/credentials';

/**
 * Server-side credential document (Cosmos `credentials`, partition key /userId). Holds
 * **ciphertext only** — the raw Azure OpenAI / Tavily keys are never persisted in the clear.
 * Exactly one document per user (`id: "cred"`).
 */
export interface CredentialRecord {
  id: 'cred';
  userId: string;
  /** Non-secret config (safe to return to the owner). */
  baseUrl: string;
  models: ModelDeployments;
  /** Last-4 hint for the UI. */
  keyHint: string;
  /** Envelope-encrypted Azure OpenAI key. */
  aoai: SealedSecret;
  /** Envelope-encrypted Tavily key (web search), if configured. */
  tavily?: SealedSecret | null;
  tavilyHint?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialStore {
  get(userId: string): Promise<CredentialRecord | null>;
  put(record: CredentialRecord): Promise<CredentialRecord>;
  delete(userId: string): Promise<void>;
}
