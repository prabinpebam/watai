import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../lib/types';

const mocks = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getThreadLock: vi.fn(async () => null),
  getCredentialStatus: vi.fn(async () => ({ capabilities: {} })),
  skillsList: vi.fn(async () => []),
  syncNow: vi.fn(async () => new Set<string>()),
  saveServerMessage: vi.fn(async () => undefined),
  realtimeEnsure: vi.fn(async () => true),
  realtimeOn: vi.fn(() => () => {}),
  realtimeLiveSince: vi.fn(() => 0),
}));

vi.mock('../../data', () => ({
  repo: {
    listMessages: mocks.listMessages,
    getThreadLock: mocks.getThreadLock,
  },
  cloudApi: {
    getCredentialStatus: mocks.getCredentialStatus,
    cancelRun: vi.fn(async () => undefined),
    submitRun: vi.fn(),
    getRun: vi.fn(),
    listMessages: vi.fn(),
  },
  skillsApi: { list: mocks.skillsList },
  syncNow: mocks.syncNow,
  saveServerMessage: mocks.saveServerMessage,
  realtime: {
    ensure: mocks.realtimeEnsure,
    on: mocks.realtimeOn,
    liveSince: mocks.realtimeLiveSince,
  },
}));

import { useUi } from '../../state/store';
import { useRuns } from './runStore';
import { useChat } from './useChat';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    threadId: 't1',
    role: 'assistant',
    content: 'Loaded answer',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRuns.setState({ runs: {} });
  useUi.setState({
    threadRev: {},
    threadLocks: {},
    stream: { status: 'idle' },
    sourcePane: null,
    filesPane: null,
  });
});

describe('useChat refresh loading', () => {
  it('keeps current messages visible during same-thread refreshes', async () => {
    const first = message();
    const refreshed = message({ content: 'Refreshed answer' });
    const pendingRefresh = deferred<Message[]>();
    mocks.listMessages.mockResolvedValueOnce([first]).mockReturnValueOnce(pendingRefresh.promise);

    const { result } = renderHook(() => useChat('t1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages.map((m) => m.content)).toEqual(['Loaded answer']);

    act(() => useUi.getState().bumpThread('t1'));

    expect(result.current.loading).toBe(false);
    expect(result.current.messages.map((m) => m.content)).toEqual(['Loaded answer']);

    await act(async () => {
      pendingRefresh.resolve([refreshed]);
      await pendingRefresh.promise;
    });

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.content)).toEqual(['Refreshed answer']),
    );
  });
});