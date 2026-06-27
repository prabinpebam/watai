import { AppError } from '../domain/errors';
import { parseCredentialsInput, type ModelDeployments } from '../domain/credentials';
import { sealSecret, openSecret, keyHint } from '../domain/crypto';
import { isFoundryHost } from '../ai/http';
import type { CredentialRecord, CredentialStore } from '../ports/credentialStore';
import type { KeyWrapper } from '../ports/keyWrapper';
import type { ServiceClock } from './threadService';

/** What the configured endpoint + models can do, derived from the saved config (no live probe).
 *  Foundry hosts serve the agentic Responses suite; function tools gate on their own config. */
export interface CredentialCapabilities {
  chat: boolean;
  image: boolean;
  transcribe: boolean;
  tts: boolean;
  agentic: boolean;
  codeInterpreter: boolean;
  fileSearch: boolean;
  webSearch: boolean;
}

/** Non-secret status returned to the client — NEVER includes ciphertext or any plaintext key. */
export interface CredentialStatus {
  configured: boolean;
  baseUrl?: string;
  models?: ModelDeployments;
  keyHint?: string;
  tavilyConfigured: boolean;
  tavilyHint?: string | null;
  knowledgeBaseVectorStoreId?: string | null;
  capabilities?: CredentialCapabilities;
}

/** Decrypted credentials — INTERNAL ONLY (the run engine). Never serialized to a client. */
export interface DecryptedCredentials {
  baseUrl: string;
  models: ModelDeployments;
  key: string;
  tavilyKey?: string;
  knowledgeBaseVectorStoreId?: string;
}

/**
 * Owns the encrypted credential vault. The client may only WRITE a key (encrypted on the way
 * in) and READ non-secret status; decryption is exposed solely to the server-side run engine
 * via {@link getDecrypted}. The raw key is encrypted before any persistence and is never
 * returned, logged, or echoed.
 */
export class CredentialService {
  constructor(
    private readonly store: CredentialStore,
    private readonly wrapper: KeyWrapper,
    private readonly clock: ServiceClock,
  ) {}

  async save(userId: string, input: unknown): Promise<CredentialStatus> {
    const parsed = parseCredentialsInput(input);
    const ts = this.clock.now();
    const existing = await this.store.get(userId);
    if (!parsed.key && !existing) {
      throw new AppError('validation', 'An API key is required.');
    }
    // Partial update: an omitted key/tavily/KB keeps whatever is already stored, so editing a
    // model never forces the (write-only) key to be re-entered.
    const record: CredentialRecord = {
      id: 'cred',
      userId,
      baseUrl: parsed.baseUrl,
      models: parsed.models,
      keyHint: parsed.key ? keyHint(parsed.key) : existing!.keyHint,
      aoai: parsed.key ? await sealSecret(parsed.key, this.wrapper) : existing!.aoai,
      tavily:
        parsed.tavilyKey !== undefined
          ? parsed.tavilyKey
            ? await sealSecret(parsed.tavilyKey, this.wrapper)
            : null
          : (existing?.tavily ?? null),
      tavilyHint:
        parsed.tavilyKey !== undefined
          ? parsed.tavilyKey
            ? keyHint(parsed.tavilyKey)
            : null
          : (existing?.tavilyHint ?? null),
      knowledgeBaseVectorStoreId:
        parsed.knowledgeBaseVectorStoreId !== undefined
          ? parsed.knowledgeBaseVectorStoreId
          : (existing?.knowledgeBaseVectorStoreId ?? null),
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    };
    return this.toStatus(await this.store.put(record));
  }

  async getStatus(userId: string): Promise<CredentialStatus> {
    const rec = await this.store.get(userId);
    return rec ? this.toStatus(rec) : { configured: false, tavilyConfigured: false };
  }

  async delete(userId: string): Promise<void> {
    await this.store.delete(userId);
  }

  /** INTERNAL: decrypt for the run engine. Throws `not_found` when unconfigured. */
  async getDecrypted(userId: string): Promise<DecryptedCredentials> {
    const rec = await this.store.get(userId);
    if (!rec) throw new AppError('not_found', 'No credentials configured.');
    return {
      baseUrl: rec.baseUrl,
      models: rec.models,
      key: await openSecret(rec.aoai, this.wrapper),
      tavilyKey: rec.tavily ? await openSecret(rec.tavily, this.wrapper) : undefined,
      knowledgeBaseVectorStoreId: rec.knowledgeBaseVectorStoreId ?? undefined,
    };
  }

  private toStatus(rec: CredentialRecord): CredentialStatus {
    const foundry = isFoundryHost(rec.baseUrl);
    return {
      configured: true,
      baseUrl: rec.baseUrl,
      models: rec.models,
      keyHint: rec.keyHint,
      tavilyConfigured: !!rec.tavily,
      tavilyHint: rec.tavilyHint ?? null,
      knowledgeBaseVectorStoreId: rec.knowledgeBaseVectorStoreId ?? null,
      capabilities: {
        chat: !!rec.models.chat,
        image: !!rec.models.image,
        transcribe: !!rec.models.transcribe,
        tts: !!rec.models.tts,
        agentic: foundry,
        codeInterpreter: foundry,
        fileSearch: foundry,
        webSearch: !!rec.tavily,
      },
    };
  }
}
