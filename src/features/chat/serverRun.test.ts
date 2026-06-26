import { describe, it, expect, vi } from 'vitest';
import { runOnServer, type ServerRunDeps } from './serverRun';
import type { RunRecord } from '../../data/cloud/types';

function run(status: RunRecord['status']): RunRecord {
  return {
    id: 'r1',
    threadId: 't1',
    userId: 'u1',
    assistantMessageId: 'm2',
    status,
    tools: [],
    allowDestructive: [],
    createdAt: 'x',
    heartbeatAt: 'x',
  };
}

const ack = { runId: 'r1', assistantMessageId: 'm2', status: 'queued' as const };

describe('runOnServer', () => {
  it('syncs (pushes the thread) before submitting so the server can find it', async () => {
    const order: string[] = [];
    const deps: ServerRunDeps = {
      sync: vi.fn(async () => {
        order.push('sync');
        return new Set<string>();
      }),
      submitRun: vi.fn(async () => {
        order.push('submit');
        return ack;
      }),
      getRun: vi.fn(async () => run('complete')),
      onThreadsChanged: vi.fn(),
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 1,
    };

    await runOnServer(deps, 't1', { text: 'hi', clientMessageId: 'm1' });

    expect(order[0]).toBe('sync');
    expect(order[1]).toBe('submit');
    expect(deps.submitRun).toHaveBeenCalledWith('t1', { text: 'hi', clientMessageId: 'm1' });
  });

  it('polls until the run is terminal, forwarding changed threads to the UI', async () => {
    let i = 0;
    const statuses: RunRecord['status'][] = ['queued', 'running', 'complete'];
    const deps: ServerRunDeps = {
      sync: vi.fn(async () => new Set(['t1'])),
      submitRun: vi.fn(async () => ack),
      getRun: vi.fn(async () => run(statuses[Math.min(i++, statuses.length - 1)])),
      onThreadsChanged: vi.fn(),
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 1,
    };

    const final = await runOnServer(deps, 't1', { text: 'hi' });

    expect(final?.status).toBe('complete');
    expect(deps.getRun).toHaveBeenCalledTimes(3); // queued, running, complete
    expect(deps.onThreadsChanged).toHaveBeenCalledWith(new Set(['t1']));
  });

  it('keeps polling when getRun throws transiently (record not visible yet)', async () => {
    let calls = 0;
    const deps: ServerRunDeps = {
      sync: vi.fn(async () => new Set<string>()),
      submitRun: vi.fn(async () => ack),
      getRun: vi.fn(async () => {
        calls++;
        if (calls < 2) throw new Error('not visible yet');
        return run('complete');
      }),
      onThreadsChanged: vi.fn(),
      sleep: async () => {},
      now: () => 0,
      pollIntervalMs: 1,
    };

    const final = await runOnServer(deps, 't1', { text: 'hi' });

    expect(final?.status).toBe('complete');
    expect(calls).toBe(2);
  });

  it('stops watching after the timeout (the run still completes server-side)', async () => {
    let t = 0;
    const deps: ServerRunDeps = {
      sync: vi.fn(async () => new Set<string>()),
      submitRun: vi.fn(async () => ack),
      getRun: vi.fn(async () => run('running')), // never terminal
      onThreadsChanged: vi.fn(),
      sleep: async () => {},
      now: () => (t += 1000), // advance 1s per read
      pollIntervalMs: 1,
      timeoutMs: 1500,
    };

    const final = await runOnServer(deps, 't1', { text: 'hi' });

    expect(final?.status).toBe('running'); // returns the last seen run, then stops polling
  });

  it('propagates a submit error so the caller can surface it', async () => {
    const deps: ServerRunDeps = {
      sync: vi.fn(async () => new Set<string>()),
      submitRun: vi.fn(async () => {
        throw new Error('A response is already being generated in this thread.');
      }),
      getRun: vi.fn(async () => run('complete')),
      onThreadsChanged: vi.fn(),
      sleep: async () => {},
      now: () => 0,
    };

    await expect(runOnServer(deps, 't1', { text: 'hi' })).rejects.toThrow('already being generated');
    expect(deps.getRun).not.toHaveBeenCalled();
  });
});
