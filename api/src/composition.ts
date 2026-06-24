import { randomUUID } from 'node:crypto';
import { CosmosThreadStore } from './adapters/cosmos/threadStore';
import { CosmosMessageStore } from './adapters/cosmos/messageStore';
import { CosmosSettingsStore } from './adapters/cosmos/settingsStore';
import { AzureSasMinter } from './adapters/azure/sasMinter';
import { entraVerifierFromEnv } from './adapters/auth/entraTokenVerifier';
import { ThreadService } from './application/threadService';
import { MessageService } from './application/messageService';
import { SettingsService } from './application/settingsService';
import { AssetService } from './application/assetService';
import { createThreadsController } from './http/threadsController';
import { createMessagesController } from './http/messagesController';
import { createSettingsController } from './http/settingsController';
import { createAssetsController } from './http/assetsController';
import { AppError } from './domain/errors';
import type { TokenVerifier } from './ports/tokenVerifier';

export interface ApiContainer {
  verifier: TokenVerifier;
  threads: ReturnType<typeof createThreadsController>;
  messages: ReturnType<typeof createMessagesController>;
  settings: ReturnType<typeof createSettingsController>;
  assets: ReturnType<typeof createAssetsController>;
}

/**
 * Until Entra (AUTH_*) is configured, every protected route fails closed with 401
 * rather than crashing — the API is never accidentally open.
 */
function buildVerifier(): TokenVerifier {
  if (process.env.AUTH_ISSUER && process.env.AUTH_AUDIENCE && process.env.AUTH_JWKS_URI) {
    return entraVerifierFromEnv();
  }
  return {
    async verify(): Promise<never> {
      throw new AppError('unauthorized', 'Authentication is not configured.');
    },
  };
}

let cached: ApiContainer | undefined;

/** Lazily wire the real (Cosmos/Storage/Entra) adapters into controllers. Built once. */
export function container(): ApiContainer {
  if (cached) return cached;
  const clock = { now: () => new Date().toISOString(), newId: () => randomUUID() };

  const threadStore = new CosmosThreadStore();
  const messageStore = new CosmosMessageStore();
  const settingsStore = new CosmosSettingsStore();
  const minter = new AzureSasMinter();

  cached = {
    verifier: buildVerifier(),
    threads: createThreadsController(new ThreadService(threadStore, clock)),
    messages: createMessagesController(new MessageService(threadStore, messageStore, clock)),
    settings: createSettingsController(new SettingsService(settingsStore)),
    assets: createAssetsController(new AssetService(threadStore, minter)),
  };
  return cached;
}
