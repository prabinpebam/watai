import { act, renderHook, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../lib/types';
import type { ServerRunDeps, ServerRunResult } from './serverRun';
import type { SubmitRunBody } from '../../data/cloud/types';

const mocks = vi.hoisted(() => ({
  listMessages: vi.fn(),
  getThreadLock: vi.fn(async () => null),
  getCredentialStatus: vi.fn(async () => ({ capabilities: {} })),
  skillsList: vi.fn(async () => []),
  syncNow: vi.fn(async () => new Set<string>()),
  saveServerMessage: vi.fn(async () => undefined),
  realtimeEnsure: vi.fn(async () => true),
  realtimeOn: vi.fn((_target: string, _handler: (payload: unknown) => void) => () => {}),
  realtimeLiveSince: vi.fn(() => 0),
  getThread: vi.fn(),
  createThread: vi.fn(),
  appendMessage: vi.fn(),
  runOnServer: vi.fn(),
  submitRun: vi.fn(),
  kv: { get: vi.fn(), set: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), keys: vi.fn(async () => []) },
}));

vi.mock('./serverRun', () => ({ runOnServer: mocks.runOnServer }));

vi.mock('../../data', () => ({
  repo: {
    listMessages: mocks.listMessages,
    getThreadLock: mocks.getThreadLock,
    getThread: mocks.getThread,
    createThread: mocks.createThread,
    appendMessage: mocks.appendMessage,
    getSettings: vi.fn(async () => ({ tools: {} })),
  },
  cloudApi: {
    getCredentialStatus: mocks.getCredentialStatus,
    cancelRun: vi.fn(async () => undefined),
    submitRun: mocks.submitRun,
    getRun: vi.fn(),
    listMessages: vi.fn(),
  },
  skillsApi: { list: mocks.skillsList },
  syncNow: mocks.syncNow,
  saveServerMessage: mocks.saveServerMessage,
  currentAccountKvStore: () => mocks.kv,
  realtime: {
    ensure: mocks.realtimeEnsure,
    on: mocks.realtimeOn,
    liveSince: mocks.realtimeLiveSince,
  },
}));

import { useUi } from '../../state/store';
import { useRuns } from './runStore';
import { useChat } from './useChat';

const realStartServerRun = useRuns.getState().startServerRun;

afterEach(() => { vi.useRealTimers(); });

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
  useRuns.setState({ runs: {}, handoffs: {} });
  useRuns.setState({ startServerRun: vi.fn(async () => undefined) });
  mocks.getThread.mockResolvedValue({ id: 't1', temporary: false });
  mocks.appendMessage.mockResolvedValue(undefined);
  mocks.submitRun.mockReset().mockResolvedValue({ runId: 'run', assistantMessageId: 'server-reply', status: 'queued' });
  useUi.setState({
    threadRev: {},
    threadLocks: {},
    stream: { status: 'idle' },
    sourcePane: null,
    filesPane: null,
  });
});

describe('useChat refresh loading', () => {
  it.each(['before-save', 'during-save'])('does not restore an old handoff or clear a replacement run after ownership changes %s', async phase => {
    const finished = deferred<ServerRunResult>();
    const saved = deferred<undefined>();
    mocks.runOnServer.mockReturnValueOnce(finished.promise);
    mocks.saveServerMessage.mockImplementationOnce(() => saved.promise);
    const running = realStartServerRun('t1', { text: 'Old prompt', clientMessageId: 'old-prompt' });
    const replacement = { threadId: 't1', message: message({ id: 'replacement' }), controller: new AbortController() };
    if (phase === 'before-save') useRuns.setState({ runs: { t1: replacement }, handoffs: {} });
    finished.resolve({ run: null, assistant: message({ id: 'old-reply' }) });
    if (phase === 'during-save') {
      await waitFor(() => expect(mocks.saveServerMessage).toHaveBeenCalledOnce());
      useRuns.setState({ runs: { t1: replacement }, handoffs: {} });
    }
    saved.resolve(undefined);
    await running;
    expect(useRuns.getState().runs.t1).toBe(replacement);
    expect(useRuns.getState().handoffs).toEqual({});
    if (phase === 'before-save') expect(mocks.saveServerMessage).not.toHaveBeenCalled();
    mocks.saveServerMessage.mockReset().mockResolvedValue(undefined);
  });

  it('never replaces a new reply with another message pushed for the same thread', async () => {
    const acknowledgement = deferred<{ runId: string; assistantMessageId: string; status: string }>();
    const finished = deferred<ServerRunResult>();
    mocks.submitRun.mockReturnValueOnce(acknowledgement.promise);
    mocks.runOnServer.mockImplementation(async (deps: ServerRunDeps, threadId: string, body: SubmitRunBody) => {
      await deps.submitRun(threadId, body);
      return finished.promise;
    });
    const observedIds: string[] = [];
    const unsubscribe = useRuns.subscribe(state => {
      if (state.runs.t1) observedIds.push(state.runs.t1.message.id);
    });
    const running = realStartServerRun('t1', { text: 'New prompt', clientMessageId: 'new-prompt' });
    try {
      await waitFor(() => expect(mocks.submitRun).toHaveBeenCalledOnce());
      const onMessage = mocks.realtimeOn.mock.calls.find(([target]) => target === 'message')![1];
      const old = { ...message({ id: 'previous-reply' }), userId: 'owner' };
      const own = { ...message({ id: 'server-reply', status: 'streaming', content: 'Current reply' }), userId: 'owner' };
      onMessage({ threadId: 't1', message: old });
      onMessage({ threadId: 't1', message: own });
      expect(useRuns.getState().runs.t1.message.id).toMatch(/^pending-/);
      acknowledgement.resolve({ runId: 'run', assistantMessageId: 'server-reply', status: 'queued' });
      await waitFor(() => expect(useRuns.getState().runs.t1.message.id).toBe('server-reply'));
      onMessage({ threadId: 't1', message: old });
      onMessage({ threadId: 't1', message: { ...old, id: 'new-prompt', role: 'user' } });
      expect(useRuns.getState().runs.t1.message.id).toBe('server-reply');
      expect(observedIds).not.toContain('previous-reply');
      expect(observedIds).not.toContain('new-prompt');
    } finally {
      acknowledgement.resolve({ runId: 'run', assistantMessageId: 'server-reply', status: 'queued' });
      finished.resolve({ run: null, assistant: null });
      await running;
      unsubscribe();
    }
  });

  it.each([-5000, 5000])('preserves every visible turn across real run-store handoffs with server clock skew %sms', async skew => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    const transport = deferred<ServerRunResult>();
    const finalRead = deferred<Message[]>();
    const persisted: Message[] = [];
    const commits: Message[][] = [];
    let callbacks!: ServerRunDeps;
    let submitted!: SubmitRunBody;
    mocks.listMessages.mockReset().mockImplementation(async () => [...persisted]);
    mocks.appendMessage.mockImplementation(async (prompt: Message) => { persisted.push(prompt); });
    mocks.runOnServer.mockImplementation(async (deps: ServerRunDeps, targetThread: string, body: SubmitRunBody) => {
      callbacks = deps;
      submitted = body;
      await deps.submitRun(targetThread, body);
      return transport.promise;
    });
    useRuns.setState({ startServerRun: realStartServerRun });
    const { result } = renderHook(() => {
      const chat = useChat('t1');
      useLayoutEffect(() => { commits.push(chat.messages.map(item => ({ ...item }))); });
      return chat;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.send('A chronology-sensitive prompt'); });
    await waitFor(() => expect(mocks.runOnServer).toHaveBeenCalledOnce());
    const prompt = persisted[0];
    const seed = useRuns.getState().runs.t1.message;
    const peer = message({ id: 'peer-prompt', role: 'user', content: 'A later prompt from another device', createdAt: '2026-09-11T12:00:01.000Z' });
    persisted.push(peer);
    act(() => useUi.getState().bumpThread('t1'));
    await waitFor(() => expect(result.current.messages.some(item => item.id === peer.id)).toBe(true));
    const pair = (submitted as SubmitRunBody & { messageOrder?: { user: string; assistant: string } }).messageOrder;
    const assistantTime = pair?.assistant ?? new Date(Date.now() + skew).toISOString();
    const reply = message({ id: 'server-reply', status: 'streaming', content: 'First chunk', createdAt: assistantTime });
    try {
      act(() => callbacks.onAssistant(reply));
      act(() => callbacks.onAssistant({ ...reply, content: 'First chunk and second chunk' }));
      mocks.listMessages.mockReturnValueOnce(finalRead.promise);
      await act(async () => { transport.resolve({ run: null, assistant: { ...reply, status: 'complete' } }); await transport.promise; });
      await waitFor(() => expect(useRuns.getState().runs.t1).toBeUndefined());
      await act(async () => { finalRead.resolve([prompt, { ...reply, status: 'complete' }, peer]); await finalRead.promise; });
      await waitFor(() => expect(result.current.messages).toHaveLength(3));
      const visible = commits.slice(commits.findIndex(items => items.some(item => item.id === seed.id)));
      expect(visible.length).toBeGreaterThan(3);
      for (const items of visible) {
        const response = items.find(item => item.id === seed.id || item.id === reply.id);
        expect(response, `Response disappeared in ${JSON.stringify(items.map(item => item.id))}`).toBeDefined();
        expect(items.findIndex(item => item.id === prompt.id)).toBeLessThan(items.findIndex(item => item.id === response!.id));
        expect(response!.createdAt).toBe(seed.createdAt);
        if (items.some(item => item.id === peer.id)) expect(items.findIndex(item => item.id === response!.id)).toBeLessThan(items.findIndex(item => item.id === peer.id));
      }
    } finally {
      transport.resolve({ run: null, assistant: null });
      finalRead.resolve(persisted);
    }
  });

  it('keeps the submitted prompt before its reply in every commit when an older reload resolves late', async () => {
    const staleRead = deferred<Message[]>();
    const append = deferred<void>();
    mocks.listMessages.mockResolvedValueOnce([]).mockReturnValueOnce(staleRead.promise);
    mocks.appendMessage.mockReturnValueOnce(append.promise);
    let prompt!: Message;
    let response!: Message;
    const commits: Array<Array<{ id: string; role: Message['role'] }>> = [];
    useRuns.setState({ startServerRun: vi.fn(async () => {
      prompt = mocks.appendMessage.mock.calls[0][0] as Message;
      response = message({ id: 'reply', status: 'streaming', createdAt: new Date(Date.parse(prompt.createdAt) + 1).toISOString() });
      useRuns.setState({ runs: { t1: { threadId: 't1', message: response, controller: new AbortController() } } });
    }) });
    const { result } = renderHook(() => {
      const chat = useChat('t1');
      useLayoutEffect(() => { commits.push(chat.messages.map(({ id, role }) => ({ id, role }))); });
      return chat;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let sending!: Promise<{ accepted: boolean }>;
    await act(async () => { sending = result.current.send('My new prompt'); });
    await waitFor(() => expect(mocks.appendMessage).toHaveBeenCalledOnce());
    act(() => useUi.getState().bumpThread('t1'));
    await waitFor(() => expect(mocks.listMessages).toHaveBeenCalledTimes(2));
    await act(async () => { append.resolve(); await sending; });
    await act(async () => { staleRead.resolve([]); await staleRead.promise; });
    mocks.listMessages.mockResolvedValue([prompt, response]);
    act(() => useUi.getState().bumpThread('t1'));
    await waitFor(() => expect(result.current.messages.map(item => item.id)).toEqual([prompt.id, response.id]));
    const afterSubmission = commits.slice(commits.findIndex(items => items.some(item => item.id === prompt.id)));
    expect(afterSubmission.length).toBeGreaterThan(2);
    expect(afterSubmission.every(items => items.some(item => item.id === prompt.id))).toBe(true);
    expect(afterSubmission.filter(items => items.some(item => item.id === response.id))
      .every(items => items.findIndex(item => item.id === prompt.id) < items.findIndex(item => item.id === response.id))).toBe(true);
  });

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

  it('exposes retry after an initial read failure without clearing the draft', async () => {
    mocks.listMessages.mockRejectedValueOnce(new Error('IndexedDB unavailable')).mockResolvedValueOnce([message()]);
    useUi.setState({ composerDrafts: { t1: 'keep draft' } });
    const { result } = renderHook(() => useChat('t1'));

    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.loading).toBe(false);
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.loadError).toBe(false);
    expect(useUi.getState().composerDrafts.t1).toBe('keep draft');
  });

  it('rejects acceptance when transactional message persistence fails', async () => {
    mocks.listMessages.mockResolvedValue([]);
    mocks.appendMessage.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const { result } = renderHook(() => useChat('t1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.send('Keep this draft')).rejects.toThrow('IndexedDB unavailable');
    });
    expect(result.current.messages).toEqual([]);
  });

  it('admits only one append across simultaneous send calls', async () => {
    mocks.listMessages.mockResolvedValue([]);
    const pending = deferred<void>();
    mocks.appendMessage.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useChat('t1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let first!: Promise<{ accepted: boolean }>;
    let second!: Promise<{ accepted: boolean }>;
    act(() => {
      first = result.current.send('First');
      second = result.current.send('Second');
    });
    await expect(second).resolves.toEqual({ accepted: false });
    await act(async () => {
      pending.resolve();
      await expect(first).resolves.toEqual({ accepted: true });
    });
    expect(mocks.appendMessage).toHaveBeenCalledTimes(1);
  });
});