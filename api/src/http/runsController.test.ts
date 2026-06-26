import { describe, it, expect, beforeEach } from 'vitest';
import { createRunsController } from './runsController';
import { RunService } from '../application/runService';
import { MessageService } from '../application/messageService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import type { RunStarter } from '../ports/runStarter';

async function makeController() {
  const threadStore = new InMemoryThreadStore();
  await threadStore.put({
    id: 't1',
    userId: 'userA',
    title: 'T',
    pinned: false,
    archived: false,
    temporary: false,
    messageCount: 0,
    createdAt: 'x',
    updatedAt: 'x',
    deletedAt: null,
  });
  let n = 0;
  let t = 0;
  const clock = {
    newId: () => `id_${++n}`,
    now: () => `2026-06-01T00:00:${String(t++).padStart(2, '0')}Z`,
  };
  const messages = new MessageService(threadStore, new InMemoryMessageStore(), clock);
  const runStore = new InMemoryRunStore();
  const starter: RunStarter = {
    async start(run) {
      return { instanceId: `inst_${run.id}` };
    },
    async cancel() {},
  };
  const svc = new RunService(threadStore, messages, runStore, starter, clock);
  return createRunsController(svc);
}

describe('runsController', () => {
  let ctrl: Awaited<ReturnType<typeof makeController>>;
  beforeEach(async () => (ctrl = await makeController()));

  it('POST submits a run → 202 with runId + assistantMessageId', async () => {
    const res = await ctrl.submit({ claims: { sub: 'userA' }, params: { id: 't1' }, body: { text: 'hi' } });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'queued' });
    expect((res.body as { runId: string }).runId).toBeTruthy();
  });

  it('rejects an unauthenticated submit → 401', async () => {
    const res = await ctrl.submit({ claims: {}, params: { id: 't1' }, body: { text: 'hi' } });
    expect(res.status).toBe(401);
  });

  it('maps an empty prompt → 400', async () => {
    const res = await ctrl.submit({ claims: { sub: 'userA' }, params: { id: 't1' }, body: {} });
    expect(res.status).toBe(400);
  });

  it('maps a second concurrent run → 409', async () => {
    await ctrl.submit({ claims: { sub: 'userA' }, params: { id: 't1' }, body: { text: 'a' } });
    const res = await ctrl.submit({ claims: { sub: 'userA' }, params: { id: 't1' }, body: { text: 'b' } });
    expect(res.status).toBe(409);
  });

  it('GET returns the run; DELETE cancels it → 200', async () => {
    const created = await ctrl.submit({ claims: { sub: 'userA' }, params: { id: 't1' }, body: { text: 'x' } });
    const runId = (created.body as { runId: string }).runId;

    const got = await ctrl.get({ claims: { sub: 'userA' }, params: { id: 't1', runId } });
    expect(got.status).toBe(200);
    expect((got.body as { id: string }).id).toBe(runId);

    const canceled = await ctrl.cancel({ claims: { sub: 'userA' }, params: { id: 't1', runId } });
    expect(canceled.status).toBe(200);
    expect((canceled.body as { status: string }).status).toBe('canceled');
  });

  it('cross-user GET fails closed → 404', async () => {
    const created = await ctrl.submit({ claims: { sub: 'userA' }, params: { id: 't1' }, body: { text: 'x' } });
    const runId = (created.body as { runId: string }).runId;
    const res = await ctrl.get({ claims: { sub: 'userB' }, params: { id: 't1', runId } });
    expect(res.status).toBe(404);
  });
});
