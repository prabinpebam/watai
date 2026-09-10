import type { Container, OperationInput, SqlParameter } from '@azure/cosmos';
import type { RunAdmissionRequest, RunAdmissionResult, RunRecord, RunStore, RunTransitionResult } from '../../ports/runStore';
import { getCosmosDatabase } from './cosmosClient';
import { ownerScopedDocumentId } from './ownerScopedId';
import { isActive, type RunStatus } from '../../domain/run';

type RunDocument = Omit<RunRecord, 'id'> & { id: string; runId?: string; _etag?: string };
interface RunAdmissionDocument {
  id: string;
  recordType: 'run-admission';
  userId: string;
  threadId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  runId: string;
}
interface RunSlotDocument {
  id: string;
  recordType: 'run-slot';
  userId: string;
  threadId: string;
  runId: string;
}

function fromDocument(document: RunDocument): RunRecord {
  const { runId, _etag: _etag, ...record } = document;
  return { ...record, id: runId ?? document.id };
}

function toDocument(record: RunRecord): RunDocument {
  return {
    ...record,
    id: ownerScopedDocumentId('run', record.userId, record.id),
    runId: record.id,
  };
}

function admissionId(userId: string, idempotencyKey: string): string {
  return ownerScopedDocumentId('run-admission', userId, idempotencyKey);
}

function slotId(userId: string): string {
  return ownerScopedDocumentId('run-slot', userId, 'active');
}

/** Cosmos-backed RunStore. Container `runs`, partition key /threadId. */
export class CosmosRunStore implements RunStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('runs');
  }

  async get(userId: string, threadId: string, runId: string): Promise<RunRecord | null> {
    try {
      const { resource } = await this.container
        .item(ownerScopedDocumentId('run', userId, runId), threadId)
        .read<RunDocument>();
      return resource?.userId === userId ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    try {
      const { resource } = await this.container.item(runId, threadId).read<RunDocument>();
      return resource?.userId === userId ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  private async resolveAdmissionConflict(request: RunAdmissionRequest): Promise<RunAdmissionResult> {
    const { run, idempotencyKey, requestFingerprint } = request;
    try {
      const { resource } = await this.container
        .item(admissionId(run.userId, idempotencyKey), run.threadId)
        .read<RunAdmissionDocument>();
      if (resource?.userId === run.userId) {
        if (resource.requestFingerprint !== requestFingerprint) return { outcome: 'payload_mismatch' };
        const existing = await this.get(run.userId, run.threadId, resource.runId);
        if (existing) return { outcome: 'replay', run: existing };
      }
    } catch (error) {
      if ((error as { code?: number }).code !== 404) throw error;
    }
    try {
      const { resource } = await this.container.item(slotId(run.userId), run.threadId).read<RunSlotDocument>();
      if (resource?.userId === run.userId) return { outcome: 'active_conflict' };
    } catch (error) {
      if ((error as { code?: number }).code !== 404) throw error;
    }
    return { outcome: 'active_conflict' };
  }

  async admit(request: RunAdmissionRequest): Promise<RunAdmissionResult> {
    const { run, idempotencyKey, requestFingerprint } = request;
    if (request.legacyMessageExists) {
      try {
        const { resource } = await this.container
          .item(admissionId(run.userId, idempotencyKey), run.threadId)
          .read<RunAdmissionDocument>();
        if (resource?.userId === run.userId) return this.resolveAdmissionConflict(request);
      } catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
      return { outcome: 'legacy_conflict' };
    }
    const receipt: RunAdmissionDocument = {
      id: admissionId(run.userId, idempotencyKey),
      recordType: 'run-admission',
      userId: run.userId,
      threadId: run.threadId,
      idempotencyKey,
      requestFingerprint,
      runId: run.id,
    };
    const slot: RunSlotDocument = {
      id: slotId(run.userId),
      recordType: 'run-slot',
      userId: run.userId,
      threadId: run.threadId,
      runId: run.id,
    };
    const operations = [toDocument(run), receipt, slot].map((resourceBody) => ({
      operationType: 'Create' as const,
      resourceBody,
    })) as OperationInput[];
    try {
      const { result } = await this.container.items.batch(operations, run.threadId);
      if (!result) throw new Error('Run admission batch returned no operation results.');
      if (result.every((operation) => operation.statusCode >= 200 && operation.statusCode < 300)) {
        return { outcome: 'accepted', run };
      }
      if (result.some((operation) => operation.statusCode === 409 || operation.statusCode === 412)) {
        return this.resolveAdmissionConflict(request);
      }
      throw new Error(`Run admission batch failed (${result.map((operation) => operation.statusCode).join(',')}).`);
    } catch (error) {
      if ((error as { code?: number }).code === 409 || (error as { code?: number }).code === 412) {
        return this.resolveAdmissionConflict(request);
      }
      throw error;
    }
  }

  async acknowledgeStart(userId: string, threadId: string, runId: string, instanceId: string): Promise<RunRecord | null> {
    const item = this.container.item(ownerScopedDocumentId('run', userId, runId), threadId);
    try {
      const { resource } = await item.read<RunDocument>();
      if (!resource || resource.userId !== userId) return null;
      if (resource.status !== 'queued') return fromDocument(resource);
      const updated: RunDocument = { ...resource, instanceId };
      try {
        const { resource: replaced } = await item.replace(updated, resource._etag
          ? { accessCondition: { type: 'IfMatch', condition: resource._etag } }
          : undefined);
        return replaced ? fromDocument(replaced as RunDocument) : fromDocument(updated);
      } catch (error) {
        if ((error as { code?: number }).code !== 412) throw error;
        return this.get(userId, threadId, runId);
      }
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async transition(
    userId: string,
    threadId: string,
    runId: string,
    expectedStatuses: RunStatus[],
    patch: Partial<Omit<RunRecord, 'id' | 'userId' | 'threadId'>>,
  ): Promise<RunTransitionResult> {
    const item = this.container.item(ownerScopedDocumentId('run', userId, runId), threadId);
    let current: RunDocument;
    try {
      const { resource } = await item.read<RunDocument>();
      if (!resource || resource.userId !== userId) return { outcome: 'missing' };
      current = resource;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return { outcome: 'missing' };
      throw error;
    }
    if (!expectedStatuses.includes(current.status)) {
      return { outcome: 'unchanged', run: fromDocument(current) };
    }
    if (!current._etag) throw new Error('Run transition requires a Cosmos ETag.');
    const updated: RunDocument = { ...current, ...patch };
    try {
      if (!isActive(updated.status)) {
        try {
          const { resource: slot } = await this.container.item(slotId(userId), threadId).read<RunSlotDocument>();
          if (slot?.userId === userId && slot.runId === runId) {
            const operations: OperationInput[] = [
              {
                operationType: 'Replace',
                id: updated.id,
                ifMatch: current._etag,
                resourceBody: updated,
              } as OperationInput,
              { operationType: 'Delete', id: slot.id } as OperationInput,
            ];
            const { result } = await this.container.items.batch(operations, threadId);
            if (!result) throw new Error('Run transition batch returned no operation results.');
            if (result.every((operation) => operation.statusCode >= 200 && operation.statusCode < 300)) {
              return { outcome: 'updated', run: fromDocument(updated) };
            }
            if (!result.some((operation) => operation.statusCode === 409 || operation.statusCode === 412)) {
              throw new Error(`Run transition batch failed (${result.map((operation) => operation.statusCode).join(',')}).`);
            }
          }
        } catch (error) {
          if ((error as { code?: number }).code !== 404) throw error;
        }
      }
      const { resource } = await item.replace(updated, {
        accessCondition: { type: 'IfMatch', condition: current._etag },
      });
      return { outcome: 'updated', run: fromDocument((resource ?? updated) as RunDocument) };
    } catch (error) {
      if ((error as { code?: number }).code !== 409 && (error as { code?: number }).code !== 412) throw error;
      const latest = await this.get(userId, threadId, runId);
      return latest ? { outcome: 'unchanged', run: latest } : { outcome: 'missing' };
    }
  }

  async put(record: RunRecord): Promise<RunRecord> {
    const document = toDocument(record);
    if (!isActive(record.status)) {
      try {
        const { resource: slot } = await this.container
          .item(slotId(record.userId), record.threadId)
          .read<RunSlotDocument>();
        if (slot?.userId === record.userId && slot.runId === record.id) {
          const operations: OperationInput[] = [
            { operationType: 'Upsert', resourceBody: document } as OperationInput,
            { operationType: 'Delete', id: slot.id } as OperationInput,
          ];
          const { result } = await this.container.items.batch(operations, record.threadId);
          if (!result) throw new Error('Run finalization batch returned no operation results.');
          if (result.every((operation) => operation.statusCode >= 200 && operation.statusCode < 300)) return record;
          throw new Error(`Run finalization batch failed (${result.map((operation) => operation.statusCode).join(',')}).`);
        }
      } catch (error) {
        if ((error as { code?: number }).code !== 404) throw error;
      }
    }
    await this.container.items.upsert(document);
    return record;
  }

  async listActive(userId: string, threadId: string): Promise<RunRecord[]> {
    const query =
      "SELECT * FROM c WHERE c.userId = @u AND c.threadId = @t AND (c.status = 'queued' OR c.status = 'running')";
    const parameters: SqlParameter[] = [{ name: '@u', value: userId }, { name: '@t', value: threadId }];
    const { resources } = await this.container.items
      .query<RunDocument>({ query, parameters }, { partitionKey: threadId })
      .fetchAll();
    const records = new Map<string, RunRecord>();
    for (const document of resources) {
      const record = fromDocument(document);
      if (!records.has(record.id) || document.runId) records.set(record.id, record);
    }
    return [...records.values()];
  }

  async deleteByThread(userId: string, threadId: string): Promise<void> {
    const { resources } = await this.container.items
      .query<{ id: string }>(
        { query: 'SELECT c.id FROM c WHERE c.userId = @userId AND c.threadId = @threadId', parameters: [{ name: '@userId', value: userId }, { name: '@threadId', value: threadId }] },
        { partitionKey: threadId },
      )
      .fetchAll();
    for (const { id } of resources) {
      await this.container.item(id, threadId).delete().catch(() => {});
    }
  }
}
