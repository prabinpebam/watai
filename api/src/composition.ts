import { randomUUID } from 'node:crypto';
import { CosmosThreadStore } from './adapters/cosmos/threadStore';
import { CosmosMessageStore } from './adapters/cosmos/messageStore';
import { CosmosSettingsStore } from './adapters/cosmos/settingsStore';
import { CosmosInviteStore } from './adapters/cosmos/inviteStore';
import { CosmosCredentialStore } from './adapters/cosmos/credentialStore';
import { CosmosRunStore } from './adapters/cosmos/runStore';
import { CosmosImageStore } from './adapters/cosmos/imageStore';
import { AzureSasMinter } from './adapters/azure/sasMinter';
import { KeyVaultWrapper } from './adapters/azure/keyVaultWrapper';
import { LocalKeyWrapper } from './adapters/local/keyWrapper';
import { QueueRunStarter } from './adapters/azure/queueRunStarter';
import { QueueImageStarter } from './adapters/azure/queueImageStarter';
import { AzureSignalR, type SignalRSender } from './adapters/azure/signalr';
import { entraVerifierFromEnv } from './adapters/auth/entraTokenVerifier';
import { ThreadService } from './application/threadService';
import { ThreadLockService } from './application/threadLockService';
import { ThreadFilesService } from './application/threadFilesService';
import { AiProxyService } from './application/aiProxyService';
import { aoaiFiles } from './ai/files';
import { MessageService } from './application/messageService';
import { SettingsService } from './application/settingsService';
import { AssetService } from './application/assetService';
import type { AllowedContentType } from './domain/asset';
import { AccessService } from './application/accessService';
import { CredentialService } from './application/credentialService';
import { RunService } from './application/runService';
import type { RunWorkerDeps } from './application/runWorker';
import { ImageService } from './application/imageService';
import type { ImageWorkerDeps } from './application/imageWorker';
import { createThreadsController } from './http/threadsController';
import { createThreadLockController } from './http/threadLockController';
import { createMessagesController } from './http/messagesController';
import { createSettingsController } from './http/settingsController';
import { createThreadFilesController } from './http/threadFilesController';
import { createAssetsController } from './http/assetsController';
import { createMeController } from './http/meController';
import { createInvitesController } from './http/invitesController';
import { createCredentialsController } from './http/credentialsController';
import { createRunsController } from './http/runsController';
import { createImagesController } from './http/imagesController';
import { createNegotiateController } from './http/negotiateController';
import { createAiProxyController } from './http/aiProxyController';
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
  threadFiles: ReturnType<typeof createThreadFilesController>;
  assets: ReturnType<typeof createAssetsController>;
  me: ReturnType<typeof createMeController>;
  invites: ReturnType<typeof createInvitesController>;
  credentials: ReturnType<typeof createCredentialsController>;
  runs: ReturnType<typeof createRunsController>;
  images: ReturnType<typeof createImagesController>;
  negotiate: ReturnType<typeof createNegotiateController>;
  aiProxy: ReturnType<typeof createAiProxyController>;
  /** Dependencies the queue-triggered run worker needs to process a job. */
  runWorker: RunWorkerDeps;
  /** Dependencies the queue-triggered image worker needs to process a job. */
  imageWorker: ImageWorkerDeps;
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
  const runStore = new CosmosRunStore();
  const imageStore = new CosmosImageStore();
  const minter = new AzureSasMinter();
  const access = new AccessService(
    inviteStore,
    process.env.ADMIN_EMAIL ?? '',
    (process.env.ADMIN_OID ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const messageService = new MessageService(threadStore, messageStore, clock);
  const credentialService = new CredentialService(credentialStore, buildKeyWrapper(), clock);
  const runService = new RunService(threadStore, messageService, runStore, new QueueRunStarter(), clock);
  const imageService = new ImageService(imageStore, credentialService, new QueueImageStarter(), minter, clock);
  const assetService = new AssetService(threadStore, minter);
  const settingsService = new SettingsService(settingsStore);
  const threadFilesService = new ThreadFilesService(threadStore, credentialService, aoaiFiles, clock);
  const aiProxyService = new AiProxyService(credentialService);
  const signalr: SignalRSender | null = process.env.AzureSignalRConnectionString
    ? new AzureSignalR(process.env.AzureSignalRConnectionString)
    : null;

  cached = {
    verifier: buildVerifier(),
    access,
    threads: createThreadsController(
      new ThreadService(threadStore, clock),
      (userId, id) => threadFilesService.cleanup(userId, id),
    ),
    threadLock: createThreadLockController(new ThreadLockService(threadStore, clock)),
    messages: createMessagesController(messageService),
    settings: createSettingsController(settingsService),
    threadFiles: createThreadFilesController(threadFilesService),
    assets: createAssetsController(assetService),
    me: createMeController(access),
    invites: createInvitesController(inviteStore, clock),
    credentials: createCredentialsController(credentialService),
    runs: createRunsController(runService),
    images: createImagesController(imageService),
    negotiate: createNegotiateController(signalr),
    aiProxy: createAiProxyController(aiProxyService),
    runWorker: {
      runStore,
      messageStore,
      threadStore,
      credentials: credentialService,
      settings: settingsService,
      uploadImage: makeUploadImage(assetService),
      uploadArtifact: makeUploadImage(assetService),
      signalr: signalr ?? undefined,
      clock,
    },
    imageWorker: {
      imageStore,
      credentials: credentialService,
      minter,
      signalr: signalr ?? undefined,
      clock,
    },
  };
  return cached;
}

/** Upload generated image bytes via a short-lived write SAS (reuses the asset path scheme), so the
 *  worker needs no extra blob role beyond the SAS minter's. Returns the stored blob path. */
function makeUploadImage(assets: AssetService) {
  return async (
    userId: string,
    threadId: string,
    imageId: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<string> => {
    const sas = await assets.requestSas(userId, {
      threadId,
      assetId: imageId,
      op: 'write',
      contentType: contentType as AllowedContentType,
    });
    const res = await fetch(sas.url, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType },
      body: bytes as unknown as RequestInit['body'],
    });
    if (!res.ok) throw new Error(`Image upload failed (${res.status}).`);
    return sas.blobPath;
  };
}
