import { isDeepStrictEqual } from 'node:util';
import { hasCurrentMemoryEmbedding, memoryEmbeddingTextHash, parseMemoryRecord, usableMemoryVector, type MemoryRecord } from '../domain/memory';
import type { MemoryIndexJob } from '../domain/memoryIndex';
import type { MemoryStore } from '../ports/memoryStore';
import type { MemoryIndexStore } from '../ports/memoryIndexStore';
import type { SettingsStore } from '../ports/settingsStore';
import type { EmbedCredentials, Embedder } from '../ports/embedder';
import type { ServiceClock } from './threadService';

export class MemoryIndexService {
  constructor(private readonly deps: {
    store: MemoryStore & MemoryIndexStore;
    settings: SettingsStore;
    credentials: { getDecrypted(userId: string): Promise<EmbedCredentials> };
    embedder: Embedder;
    clock: ServiceClock;
    enabled: () => boolean;
    contained: () => boolean;
  }) {}

  async reconcile(): Promise<{ completed: number; ignored: number; deferred: number }> {
    const result = { completed: 0, ignored: 0, deferred: 0 };
    if (!this.deps.enabled() || this.deps.contained()) return result;
    const jobs = await this.deps.store.listIndexJobs(this.deps.clock.now(), 3);
    let deadline: number | undefined;
    for (const candidate of jobs.slice(0, 3)) {
      if (!this.deps.enabled() || this.deps.contained() || (deadline !== undefined && Date.now() >= deadline)) break;
      try {
        const token = this.deps.clock.newId();
        const job = await this.deps.store.claimIndexJob(candidate.userId, candidate.id, this.deps.clock.now(), token);
        if (!job) continue;
        if (job.id !== candidate.id || job.userId !== candidate.userId || job.memoryId !== candidate.memoryId ||
            job.model !== candidate.model || job.revision !== candidate.revision || job.textHash !== candidate.textHash ||
            job.state !== 'running' || job.executionToken !== token) throw new Error('Memory index claim binding failed.');
        deadline ??= Date.now() + 120_000;
        const remaining = Math.min(deadline - Date.now(), Date.parse(job.availableAt) - Date.parse(this.deps.clock.now()));
        if (!Number.isFinite(remaining) || remaining <= 0) { result.deferred += 1; break; }
        const controller = new AbortController();
        let onAbort!: () => void;
        const aborted = new Promise<'deferred'>(resolve => { onAbort = () => resolve('deferred'); });
        controller.signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), remaining);
        try {
          const outcome = await Promise.race([this.processClaim(job, controller.signal), aborted]);
          if (outcome) result[outcome] += 1;
          if (controller.signal.aborted) break;
        } finally {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', onAbort);
        }
      } catch {
        result.deferred += 1;
      }
    }
    return result;
  }

  private async checked<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const result = await operation();
    signal.throwIfAborted();
    return result;
  }

  private async processClaim(job: MemoryIndexJob, signal: AbortSignal): Promise<'completed' | 'ignored' | 'deferred' | null> {
    const ignore = async () => await this.checked(signal, () => this.deps.store.finishIndexJob(job, 'ignored', this.deps.clock.now())) ? 'ignored' as const : null;
    try {
      const memory = await this.eligible(job, signal);
      if (!memory || hasCurrentMemoryEmbedding(memory, job.userId, job.model, memory.embedding?.length ?? 0)) return await ignore();
      const credentials = await this.checked(signal, () => this.deps.credentials.getDecrypted(job.userId));
      if (!isDeepStrictEqual(await this.eligible(job, signal), memory)) return await ignore();
      const vector = await this.checked(signal, () => this.deps.embedder.embed(credentials, memory.text, { signal }));
      if (!usableMemoryVector(vector) || vector.length > 16_384) throw new Error('Invalid memory embedding.');
      const currentCredentials = await this.checked(signal, () => this.deps.credentials.getDecrypted(job.userId));
      if (credentials.baseUrl !== currentCredentials.baseUrl || credentials.key !== currentCredentials.key ||
          !isDeepStrictEqual(await this.eligible(job, signal), memory)) return await ignore();
      const indexed = parseMemoryRecord({ ...memory, embedding: vector, embeddingModel: job.model, embeddingTextHash: job.textHash });
      return await this.checked(signal, () => this.deps.store.finishIndexJob(job, 'completed', this.deps.clock.now(), { expected: memory, record: indexed }))
        ? 'completed' : null;
    } catch {
      if (!signal.aborted) {
        try { await this.checked(signal, () => this.deps.store.finishIndexJob(job, job.attempts >= 3 ? 'failed' : 'queued', this.deps.clock.now())); } catch {}
      }
      return 'deferred';
    }
  }

  private async savedUseAllowed(userId: string, signal: AbortSignal): Promise<boolean> {
    const settings = await this.checked(signal, () => this.deps.settings.get(userId));
    const personalization = settings?.value.personalization;
    return personalization?.memoryEnabled === true && personalization.memory?.enabled === true && personalization.memory.referenceSaved === true;
  }

  private async eligible(job: MemoryIndexJob, signal: AbortSignal): Promise<MemoryRecord | null> {
    signal.throwIfAborted();
    if (!this.deps.enabled() || this.deps.contained() || job.model !== this.deps.embedder.model || job.availableAt <= this.deps.clock.now()) return null;
    if (!(await this.savedUseAllowed(job.userId, signal))) return null;
    const memory = await this.checked(signal, () => this.deps.store.get(job.userId, job.memoryId));
    if (!memory || memory.userId !== job.userId || memory.id !== job.memoryId || memory.status !== 'active' || memory.confirmation !== 'approved' ||
        memory.sensitive || memory.revision !== job.revision || memoryEmbeddingTextHash(memory.text) !== job.textHash) return null;
    if (await this.checked(signal, () => this.deps.store.isExcluded(job.userId, memory.sourceHash, memory.sourceRefs, memory.id))) return null;
    if (!isDeepStrictEqual(await this.checked(signal, () => this.deps.store.getIndexJob(job.userId, job.id)), job)) return null;
    if (!(await this.savedUseAllowed(job.userId, signal))) return null;
    if (!this.deps.enabled() || this.deps.contained() || job.availableAt <= this.deps.clock.now()) return null;
    return memory;
  }
}