import { randomUUID } from 'node:crypto';
import { CosmosThreadStore } from './adapters/cosmos/threadStore';
import { CosmosMessageStore } from './adapters/cosmos/messageStore';
import { CosmosSettingsStore } from './adapters/cosmos/settingsStore';
import { CosmosInviteStore } from './adapters/cosmos/inviteStore';
import { CosmosCredentialStore } from './adapters/cosmos/credentialStore';
import { AzureSasMinter } from './adapters/azure/sasMinter';
import { KeyVaultWrapper } from './adapters/azure/keyVaultWrapper';
import { LocalKeyWrapper } from './adapters/local/keyWrapper';
import { entraVerifierFromEnv } from './adapters/auth/entraTokenVerifier';
import { ThreadService } from './application/threadService';
import { ThreadLockService } from './application/threadLockService';
import { MessageService } from './application/messageService';
import { SettingsService } from './application/settingsService';
import { AssetService } from './application/assetService';
import { AccessService } from './application/accessService';
import { CredentialService } from './application/credentialService';
import { createThreadsController } from './http/threadsController';
import { createThreadLockController } from './http/threadLockController';
import { createMessagesController } from './http/messagesController';
import { createSettingsController } from './http/settingsController';
import { createAssetsController } from './http/assetsController';
import { createMeController } from './http/meController';
import { createInvitesController } from './http/invitesController';
import { createCredentialsController } from './http/credentialsController';
import { AppError } from './domain/errors';
import type { TokenVerifier } from './ports/tokenVerifier';
import type { KeyWrapper } from './ports/keyWrapper';

export interface ApiContainer {
  verifier: TokenVerifier;
  access: AccessService;
  threads: ReturnType<typeof createThreadsController>;
  threadLock: ReturnType<typeof createThreadLockController>;
  messages: ReturnType<typeof createMessagesController>;
  settings: ReturnType<typeof createSettingsController>;
  assets: ReturnType<typeof createAssetsController>;
  me: ReturnType<typeof createMeController>;
  invites: ReturnType<typeof createInvitesController>;
  credentials: ReturnType<typeof createCredentialsController>;
}

/** Production uses an Azure Key Vault RSA key as the KEK; local dev falls back to an
 *  app-setting master key. The credential domain is identical either way (KeyWrapper port). */
function buildKeyWrapper(): KeyWrapper {
  return process.env.KEY_VAULT_URI ? new KeyVaultWrapper() : new LocalKeyWrapper();
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
  const inviteStore = new CosmosInviteStore();
  const credentialStore = new CosmosCredentialStore();
  const minter = new AzureSasMinter();
  const access = new AccessService(
    inviteStore,
    process.env.ADMIN_EMAIL ?? '',
    (process.env.ADMIN_OID ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  cached = {
    verifier: buildVerifier(),
    access,
    threads: createThreadsController(new ThreadService(threadStore, clock)),
    threadLock: createThreadLockController(new ThreadLockService(threadStore, clock)),
    messages: createMessagesController(new MessageService(threadStore, messageStore, clock)),
    settings: createSettingsController(new SettingsService(settingsStore)),
    assets: createAssetsController(new AssetService(threadStore, minter)),
    me: createMeController(access),
    invites: createInvitesController(inviteStore, clock),
    credentials: createCredentialsController(new CredentialService(credentialStore, buildKeyWrapper(), clock)),
  };
  return cached;
}
