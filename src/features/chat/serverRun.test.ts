import { describe, it, expect, vi } from 'vitest';
import { runOnServer, type ServerRunDeps } from './serverRun';
import type { Message } from '../../lib/types';
import type { RunRecord } from '../../data/cloud/types';

const CREATED = '2026-01-01T00:00:00.000Z';

function runRec(status: RunRecord['status'] = 'running'): RunRecord {
  return {
    id: 'r1',
    threadId: 't1',
    userId: 'u1',
    assistantMessageId: 'm2',
    status,
    tools: [],
    allowDestructive: [],
    createdAt: CREATED,
    heartbeatAt: 'x',
  };
}

function asst(content: string, status: Message['status']): Message {
  return { id: 'm2', threadId: 't1', role: 'assistant', content, status, createdAt: CREATED };
}

const ack = { runId: 'r1', assistantMessageId: 'm2', status: 'queued' as const };

function baseDeps(over: Partial<ServerRunDeps> = {}): ServerRunDeps {
  return {
    sync: vi.fn(async () => new Set<string>()),
    submitRun: vi.fn(async () => ack),
    getRun: vi.fn(async () => runRec('running')),
    getAssistantMessage: vi.fn(async () => null),
    onAssistant: vi.fn(),
    onThreadsChanged: vi.fn(),
    sleep: async () => {},
    now: () => 0,
    pollIntervalMs: 1,
    ...over,
  };
}

describe('runOnServer', () => {
  it('syncs (pushes the thread) before submitting so the server can find it', async () => {
    const order: string[] = [];
    const deps = baseDeps({
      sync: vi.fn(async () => {
        order.push('sync');
        return new Set<string>();
      }),
      submitRun: vi.fn(async () => {
        order.push('submit');
        return ack;
      }),
      getAssistantMessage: vi.fn(async () => asst('hi', 'complete')),
    });

    await runOnServer(deps, 't1', { text: 'hi', clientMessageId: 'm1' });

    expect(order[0]).toBe('sync');
    expect(order[1]).toBe('submit');
    expect(deps.submitRun).toHaveBeenCalledWith('t1', { text: 'hi', clientMessageId: 'm1' });
  });

  it('streams the growing assistant content into the UI until terminal', async () => {
    let i = 0;
    const frames: Array<[string, Message['status']]> = [
      ['He', 'streaming'],
      ['Hello', 'streaming'],
      ['Hello!', 'complete'],
    ];
    const deps = baseDeps({
      getAssistantMessage: vi.fn(async () => {
        const [c, s] = frames[Math.min(i++, frames.length - 1)];
        return asst(c, s);
      }),
    });

    const out = await runOnServer(deps, 't1', { text: 'hi' });

    expect(deps.onAssistant).toHaveBeenCalledTimes(3);
    const contents = (deps.onAssistant as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as Message).content,
    );
    expect(contents).toEqual(['He', 'Hello', 'Hello!']);
    expect(out.assistant?.content).toBe('Hello!');
    expect(out.assistant?.status).toBe('complete');
  });

  it('anchors the read window just before the run createdAt (skew-proof)', async () => {
    const getAssistantMessage = vi.fn(async () => asst('done', 'complete'));
    const deps = baseDeps({ getAssistantMessage });

    await runOnServer(deps, 't1', { text: 'hi' });

    // since = run.createdAt - 1000ms
    expect(getAssistantMessage).toHaveBeenCalledWith('t1', 'm2', '2025-12-31T23:59:59.000Z');
  });

  it('keeps polling while the message is not written yet (null then throw then ready)', async () => {
    let calls = 0;
    const deps = baseDeps({
      getAssistantMessage: vi.fn(async () => {
        calls++;
        if (calls === 1) return null;
        if (calls === 2) throw new Error('not visible yet');
        return asst('done', 'complete');
      }),
    });

    const out = await runOnServer(deps, 't1', { text: 'hi' });

    expect(calls).toBe(3);
    expect(out.assistant?.content).toBe('done');
  });

  it('stops watching after the timeout, returning the last seen message', async () => {
    let t = 0;
    const deps = baseDeps({
      getAssistantMessage: vi.fn(async () => asst('partial', 'streaming')), // never terminal
      now: () => (t += 1000),
      timeoutMs: 1500,
    });

    const out = await runOnServer(deps, 't1', { text: 'hi' });

    expect(out.assistant?.content).toBe('partial');
  });

  it('stops immediately when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const deps = baseDeps({
      signal: ctrl.signal,
      getAssistantMessage: vi.fn(async () => asst('x', 'streaming')),
    });

    const out = await runOnServer(deps, 't1', { text: 'hi' });

    expect(out.assistant).toBeNull();
    expect(deps.getAssistantMessage).not.toHaveBeenCalled();
  });

  it('propagates a submit error so the caller can surface it', async () => {
    const deps = baseDeps({
      submitRun: vi.fn(async () => {
        throw new Error('A response is already being generated in this thread.');
      }),
    });

    await expect(runOnServer(deps, 't1', { text: 'hi' })).rejects.toThrow('already being generated');
    expect(deps.getAssistantMessage).not.toHaveBeenCalled();
  });
});
