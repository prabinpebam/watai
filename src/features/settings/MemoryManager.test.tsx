import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryArchiveTools, MemoryManager, PersonalizationBody } from './Settings';
import { Profiler, StrictMode, type ComponentProps } from 'react';
import { DEFAULT_SETTINGS } from '../../lib/types';
import { cloudApi, repo, realtime } from '../../data';
import { saveFile } from '../../lib/saveFile';
import { useUi } from '../../state/store';
import type { MemoryProfileView, MemoryRecord, MemoryTransferArchive } from '../../data/cloud/types';

const accountScope = vi.hoisted(() => ({ current: {} }));

vi.mock('../../data', () => ({
  repo: { listMemory: vi.fn(), getMemoryProfile: vi.fn(), removeMemory: vi.fn(), addMemory: vi.fn(), updateMemory: vi.fn() },
  realtime: { ensure: vi.fn(async () => {}), on: vi.fn(() => () => {}) },
  cloudApi: { exportMemoryArchive: vi.fn(), previewMemoryArchive: vi.fn() }, accountLocalStorageKey: vi.fn(),
  currentAccountKvStore: vi.fn(() => accountScope.current),
}));
vi.mock('../../lib/saveFile', () => ({ saveFile: vi.fn(async () => {}) }));

const profile: MemoryProfileView = {
  schemaVersion: 1, userId: 'owner', updatedAt: '2026-01-01T00:00:00Z', evidenceCount: 0,
  profile: {
    user: { details: {}, family: { spouse: [], children: [], pets: [] },
      preferences: { communication: [], engineering: [], design: [], tools: [], other: [] },
      interests: { media: [], hobbies: [], other: [] } },
    work: { projects: [], repositories: [], deployments: [], currentFocus: [] }, avoidances: [],
  },
  temporal: { today: { items: [] }, week: { items: [] }, month: { items: [] } },
};
const memory = (id: string, status: MemoryRecord['status'] = 'active'): MemoryRecord => ({
  id, userId: 'owner', kind: 'fact', status, text: id, confidence: 1, salience: 0.5,
  pinned: false, sensitive: false, visibility: 'normal', useCount: 0, revision: 1,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
});

beforeEach(() => {
  accountScope.current = {};
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: true, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null })));
  vi.mocked(repo.listMemory).mockReset().mockResolvedValue([]);
  vi.mocked(repo.getMemoryProfile).mockReset().mockResolvedValue(profile);
  vi.mocked(repo.removeMemory).mockReset().mockResolvedValue(undefined);
  vi.mocked(repo.addMemory).mockReset();
  vi.mocked(repo.updateMemory).mockReset();
  vi.mocked(realtime.on).mockClear();
  vi.mocked(cloudApi.exportMemoryArchive).mockReset();
  vi.mocked(cloudApi.previewMemoryArchive).mockReset();
  vi.mocked(saveFile).mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function preferencesContext(): ComponentProps<typeof PersonalizationBody>['ctx'] {
  return { settings: DEFAULT_SETTINGS, setSettings: vi.fn(), loaded: true, account: { name: null, email: null },
    me: null, stats: { bytes: null, chats: null, images: null }, chatModel: null, onModelSaved: vi.fn(), tavilyConfigured: false };
}

describe('Memory archive inspection', () => {
  const archive = (count = 1): MemoryTransferArchive => ({ version: 2, scope: 'active-records', exportedAt: '2026-01-01T00:00:00Z',
    memories: Array.from({ length: count }, (_, index) => ({ ...memory(`Archive record ${index}`), confirmation: 'approved',
      validAt: '2025-01-01T00:00:00Z', embeddingTextHash: 'a'.repeat(64) })), summary: null });

  it('previews records in bounded pages without writing or automatically downloading', async () => {
    const content = archive(21);
    content.memories[0].text = '<img src=x onerror=alert(1)>';
    vi.mocked(cloudApi.previewMemoryArchive).mockResolvedValue({ added: 0, skipped: 0, rejected: [], archive: content });
    render(<MemoryArchiveTools />);
    const payload = { ...content, mode: 'commit' };
    fireEvent.change(screen.getByLabelText('Memory archive file'), { target: { files: [{ size: 100, text: async () => JSON.stringify(payload) }] } });
    const dialog = await screen.findByRole('dialog', { name: 'Memory archive' });
    expect(within(dialog).getByText('Preview only. No records imported.')).toBeInTheDocument();
    expect(within(dialog).getByText(content.memories[0].text)).toBeInTheDocument();
    expect(dialog.querySelector('img')).toBeNull();
    expect(within(dialog).queryByText('Archive record 20')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next archive page' }));
    expect(within(dialog).getByText('Archive record 20')).toBeInTheDocument();
    expect(within(dialog).queryByText('Archive record 19')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next archive page' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous archive page' }));
    expect(within(dialog).getByText(content.memories[0].text)).toBeInTheDocument();
    expect(cloudApi.previewMemoryArchive).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
    expect(repo.addMemory).not.toHaveBeenCalled();
    expect(repo.updateMemory).not.toHaveBeenCalled();
    expect(repo.removeMemory).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('downloads prepared export metadata only after a separate explicit click', async () => {
    const content = archive();
    vi.mocked(cloudApi.exportMemoryArchive).mockResolvedValue(content);
    render(<MemoryArchiveTools />);
    const trigger = screen.getByRole('button', { name: 'Export archive' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Memory archive' });
    expect(saveFile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download archive' }));
    expect(saveFile).toHaveBeenCalledOnce();
    const [blob, filename] = vi.mocked(saveFile).mock.calls[0];
    expect(filename).toBe('watai-memory-active-v2.json');
    const serialized = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob as Blob);
    });
    expect(JSON.parse(serialized)).toEqual(content);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('rejects malformed JSON before sending it for preview', async () => {
    render(<MemoryArchiveTools />);
    fireEvent.change(screen.getByLabelText('Memory archive file'), { target: { files: [{ size: 1, text: async () => '{' }] } });
    await screen.findByText('Archive is not valid JSON.');
    expect(cloudApi.previewMemoryArchive).not.toHaveBeenCalled();
  });

  it.each(['file', 'export'] as const)('bounds a stalled archive %s operation and ignores its late result', async stage => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      vi.mocked(cloudApi.exportMemoryArchive).mockImplementation(async () => { await blocked; return archive(); });
      render(<MemoryArchiveTools />);
      if (stage === 'file') fireEvent.change(screen.getByLabelText('Memory archive file'), { target: { files: [{ size: 1,
        text: async () => { await blocked; return JSON.stringify(archive()); },
      }] } });
      else fireEvent.click(screen.getByRole('button', { name: 'Export archive' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(15_001); });
      expect(screen.getByText('Archive request timed out. Try again.')).toBeInTheDocument();
      if (stage === 'export') expect(vi.mocked(cloudApi.exportMemoryArchive).mock.calls[0][0]?.aborted).toBe(true);
      await act(async () => { release(); });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(cloudApi.previewMemoryArchive).not.toHaveBeenCalled();
      expect(saveFile).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it.each(['unmount', 'account'] as const)('does not publish an archive after %s', async change => {
    let complete!: (archive: MemoryTransferArchive) => void;
    vi.mocked(cloudApi.exportMemoryArchive).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = render(<MemoryArchiveTools />);
    fireEvent.click(screen.getByRole('button', { name: 'Export archive' }));
    if (change === 'unmount') view.unmount();
    else accountScope.current = {};
    await act(async () => { complete(archive()); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();
    if (change === 'unmount') expect(vi.mocked(cloudApi.exportMemoryArchive).mock.calls[0][0]?.aborted).toBe(true);
  });

  it('aborts superseded uploads and retains only the newest preview', async () => {
    let complete!: (result: Awaited<ReturnType<typeof cloudApi.previewMemoryArchive>>) => void;
    const old = archive();
    const fresh = archive();
    fresh.memories[0].text = 'Newest archive';
    vi.mocked(cloudApi.previewMemoryArchive).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }))
      .mockResolvedValueOnce({ added: 0, skipped: 0, rejected: [], archive: fresh });
    render(<MemoryArchiveTools />);
    const select = (content: MemoryTransferArchive) => fireEvent.change(screen.getByLabelText('Memory archive file'), {
      target: { files: [{ size: 100, text: async () => JSON.stringify(content) }] },
    });
    select(old);
    await waitFor(() => expect(cloudApi.previewMemoryArchive).toHaveBeenCalledOnce());
    select(fresh);
    await screen.findByText('Newest archive');
    expect(vi.mocked(cloudApi.previewMemoryArchive).mock.calls[0][1]?.aborted).toBe(true);
    await act(async () => { complete({ added: 0, skipped: 0, rejected: [], archive: old }); });
    expect(screen.getByText('Newest archive')).toBeInTheDocument();
    expect(screen.queryByText(old.memories[0].text)).not.toBeInTheDocument();
  });

  it('rejects an oversized archive before reading its text or calling the API', async () => {
    const text = vi.fn(async () => '{}');
    const file = { name: 'large.json', size: 72 * 1024 * 1024 + 1, text };
    render(<MemoryArchiveTools />);
    fireEvent.change(screen.getByLabelText('Memory archive file'), { target: { files: [file] } });
    await screen.findByText('Archive exceeds the 72 MiB limit.');
    expect(text).not.toHaveBeenCalled();
    expect(cloudApi.previewMemoryArchive).not.toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
  });
});

describe('memory preference persistence', () => {
  it('enables saved-only memory from an off snapshot without restoring automatic learning', async () => {
    const ctx = preferencesContext();
    ctx.settings = { ...DEFAULT_SETTINGS, personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: false } };
    vi.mocked(ctx.setSettings).mockResolvedValue(undefined);
    render(<PersonalizationBody ctx={ctx} />);
    await screen.findByText('No structured memory yet');
    fireEvent.click(screen.getByRole('switch', { name: /^Memory$/ }));
    await waitFor(() => expect(ctx.setSettings).toHaveBeenCalledOnce());
    expect(vi.mocked(ctx.setSettings).mock.calls[0][0]).toMatchObject({ personalization: {
      memoryEnabled: true, memory: { enabled: true, referenceSaved: true, referenceHistory: false,
        autoExtract: false, learnChats: 'off', paused: false },
    } });
  });

  it.each(['switch', 'unmount'] as const)('discards preference failures after %s', async change => {
    const ctx = preferencesContext();
    let rejectSave!: (error: Error) => void;
    vi.mocked(ctx.setSettings).mockReturnValue(new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const view = render(<PersonalizationBody ctx={ctx} />);
    await screen.findByText('No structured memory yet');
    const toasts = useUi.getState().toasts;
    fireEvent.click(screen.getByRole('switch', { name: /^Memory$/ }));
    fireEvent.click(screen.getByRole('switch', { name: /^Memory$/ }));
    expect(ctx.setSettings).toHaveBeenCalledOnce();
    if (change === 'switch') accountScope.current = {};
    else view.unmount();
    await act(async () => { rejectSave(new Error('Old account save error')); });
    expect(screen.queryByText('Memory preference could not be saved. Retry the change.')).not.toBeInTheDocument();
    expect(useUi.getState().toasts).toEqual(toasts);
    expect(ctx.setSettings).toHaveBeenCalledOnce();
  });

  it('releases pending controls after a confirmed local save without a server-policy success toast', async () => {
    const ctx = preferencesContext();
    let complete!: () => void;
    vi.mocked(ctx.setSettings).mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
    render(<StrictMode><PersonalizationBody ctx={ctx} /></StrictMode>);
    await screen.findByText('No structured memory yet');
    const toasts = useUi.getState().toasts;
    fireEvent.click(screen.getByRole('switch', { name: /^Memory$/ }));
    expect(screen.getByRole('switch', { name: /^Memory$/ })).toBeDisabled();
    await act(async () => { complete(); });
    expect(screen.getByRole('switch', { name: /^Memory$/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
    expect(useUi.getState().toasts).toEqual(toasts);
  });

  it('reports failure without success claims and retries only the intended memory patch', async () => {
    const ctx = preferencesContext();
    let rejectSave!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => { rejectSave = reject; });
    void pending.catch(() => {});
    vi.mocked(ctx.setSettings).mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const view = render(<PersonalizationBody ctx={ctx} />);
    await screen.findByText('No structured memory yet');
    const toasts = useUi.getState().toasts;
    fireEvent.click(screen.getByRole('switch', { name: /^Memory$/ }));
    const protectedWhilePending = screen.getByRole('switch', { name: /^Memory$/ }).hasAttribute('disabled');
    await act(async () => { rejectSave(new Error('Synthetic save failure')); });
    expect(screen.getByText('Memory preference could not be saved. Retry the change.')).toBeInTheDocument();
    expect(protectedWhilePending).toBe(true);
    expect(useUi.getState().toasts).toEqual(toasts);
    const current = { ...ctx, settings: { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' as const } } };
    view.rerender(<PersonalizationBody ctx={current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(ctx.setSettings).toHaveBeenCalledTimes(2));
    expect(vi.mocked(ctx.setSettings).mock.calls[1][0]).toMatchObject({ appearance: { theme: 'dark' }, personalization: { memoryEnabled: false } });
    await waitFor(() => expect(screen.queryByText('Memory preference could not be saved. Retry the change.')).not.toBeInTheDocument());
    expect(useUi.getState().toasts).toEqual(toasts);
  });
});

describe('MemoryManager load ownership', () => {
  it.each([
    { fields: { invalidAt: '2000-01-01T00:00:00Z' }, label: 'Expired' },
    { fields: { validAt: '2099-01-01T00:00:00Z' }, label: 'Not yet valid' },
    { fields: { validAt: 'unknown' }, label: 'Validity unknown' },
    { fields: { invalidAt: 'unknown' }, label: 'Validity unknown' },
  ])('labels active evidence that is not currently eligible: $label', async ({ fields, label }) => {
    const record = { ...memory('Retained temporal record'), confirmation: 'approved' as const, ...fields };
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(record.text);
    expect(screen.getByText(content => content.startsWith(`${label} ·`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Edit$/ })).toBeEnabled();
    expect(repo.updateMemory).not.toHaveBeenCalled();
    expect(record.status).toBe('active');
  });

  it('retries a failed structured profile without changing views', async () => {
    vi.mocked(repo.getMemoryProfile).mockRejectedValueOnce(new Error('Memory request timed out. Retry loading memory.')).mockResolvedValue(profile);
    render(<MemoryManager enabled />);
    await screen.findByText('Memory request timed out. Retry loading memory.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry memory' }));
    await screen.findByText('No structured memory yet');
    expect(repo.getMemoryProfile).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('tab', { name: 'Structured' })).toHaveAttribute('aria-selected', 'true');
  });

  it('retries the selected raw filter only once while the retry is pending', async () => {
    render(<MemoryManager enabled />);
    await screen.findByText('No structured memory yet');
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText('No active memories');
    vi.mocked(repo.listMemory).mockRejectedValueOnce(new Error('Read unavailable'));
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    await screen.findByText('Read unavailable');
    let complete!: (records: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const before = vi.mocked(repo.listMemory).mock.calls.length;
    const retry = screen.getByRole('button', { name: 'Retry memory' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(repo.listMemory).toHaveBeenCalledTimes(before + 1);
    expect(vi.mocked(repo.listMemory).mock.calls.at(-1)?.[0]?.status).toBe('suppressed');
    await act(async () => { complete([memory('Hidden saved record', 'suppressed')]); });
    await screen.findByText('Hidden saved record');
    expect(screen.getByRole('tab', { name: 'Hidden' })).toHaveAttribute('aria-selected', 'true');
  });

  it('preserves an open draft across a failed refresh and manual retry', async () => {
    const record = memory('Original memory');
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(record.text);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Unsaved draft' } });
    vi.mocked(repo.listMemory).mockRejectedValueOnce(new Error('Refresh failed'));
    await act(async () => { vi.mocked(realtime.on).mock.calls[0][1]({} as never); });
    await screen.findByText('Refresh failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry memory' }));
    expect(await screen.findByLabelText('Memory text')).toHaveValue('Unsaved draft');
    expect(repo.updateMemory).not.toHaveBeenCalled();
  });

  it('does not retry a failed memory read for an abandoned account scope', async () => {
    vi.mocked(repo.getMemoryProfile).mockRejectedValue(new Error('Profile failed'));
    render(<MemoryManager enabled />);
    await screen.findByText('Profile failed');
    const before = vi.mocked(repo.listMemory).mock.calls.length;
    accountScope.current = {};
    fireEvent.click(screen.getByRole('button', { name: 'Retry memory' }));
    expect(repo.listMemory).toHaveBeenCalledTimes(before);
  });

  it('never commits an old Active record under the newly selected Hidden filter', async () => {
    const active = memory('Active-only record');
    let finishHidden!: (records: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockImplementation(async query => query?.status === 'suppressed'
      ? new Promise(resolve => { finishHidden = resolve; }) : [active]);
    const commits: Array<{ hidden: boolean; activeVisible: boolean }> = [];
    render(<Profiler id="memory" onRender={() => commits.push({
      hidden: screen.queryByRole('tab', { name: 'Hidden' })?.getAttribute('aria-selected') === 'true',
      activeVisible: screen.queryByText(active.text) !== null,
    })}><MemoryManager enabled /></Profiler>);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(active.text);
    commits.length = 0;
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    const duringPending = [...commits];
    await act(async () => { finishHidden([memory('Hidden-only record', 'suppressed')]); });
    await screen.findByText('Hidden-only record');
    expect(duringPending.some(commit => commit.hidden)).toBe(true);
    expect(commits.every(commit => !commit.hidden || !commit.activeVisible)).toBe(true);
  });

  it('refreshes the current view after a save started in Structured', async () => {
    const record = memory('Saved record');
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    const structured = structuredClone(profile);
    structured.evidenceCount = 1;
    structured.profile.user.preferences.communication = [{ text: 'Structured preference', sourceMemoryIds: [record.id], confidence: 1 }];
    vi.mocked(repo.getMemoryProfile).mockResolvedValueOnce(structured).mockRejectedValue(new Error('Profile unavailable after switch'));
    let complete!: (record: MemoryRecord) => void;
    vi.mocked(repo.updateMemory).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    render(<MemoryManager enabled />);
    await screen.findByText('Structured preference');
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByLabelText('Memory text');
    await act(async () => { complete({ ...record, text: 'Draft', revision: 2 }); });
    expect(repo.getMemoryProfile).toHaveBeenCalledOnce();
    expect(await screen.findByText(record.text)).toBeInTheDocument();
    expect(screen.queryByText('Profile unavailable after switch')).not.toBeInTheDocument();
  });

  it('keeps raw evidence available independently of a failed structured profile', async () => {
    vi.mocked(repo.listMemory).mockImplementation(async query => [memory(query?.status === 'invalidated' ? 'Old record' : 'Saved record', query?.status)]);
    vi.mocked(repo.getMemoryProfile).mockRejectedValue(new Error('Profile unavailable'));
    render(<MemoryManager enabled />);
    await screen.findByText('Profile unavailable');
    const profileCalls = vi.mocked(repo.getMemoryProfile).mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText('Saved record');
    fireEvent.click(screen.getByRole('tab', { name: 'Outdated' }));
    await screen.findByText('Old record');
    expect(repo.getMemoryProfile).toHaveBeenCalledTimes(profileCalls);
    expect(vi.mocked(repo.listMemory).mock.calls.map(([query]) => query?.status)).toEqual(['active', 'active', 'invalidated']);
    fireEvent.click(screen.getByRole('tab', { name: 'Structured' }));
    await screen.findByText('Profile unavailable');
    expect(repo.getMemoryProfile).toHaveBeenCalledTimes(profileCalls + 1);
    expect(vi.mocked(repo.listMemory).mock.calls.at(-1)?.[0]?.status).toBe('active');
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText('Old record');
    expect(screen.getByRole('tab', { name: 'Outdated' })).toHaveAttribute('aria-selected', 'true');
  });

  it('allows another record to update while one memory patch is pending', async () => {
    const first = memory('First memory');
    const second = memory('Second memory');
    vi.mocked(repo.listMemory).mockResolvedValue([first, second]);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(repo.updateMemory).mockImplementation(async id => {
      if (id === first.id) await blocked;
      return { ...(id === first.id ? first : second), revision: 2, pinned: true };
    });
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(first.text);
    const firstRow = screen.getByText(first.text).closest('.setting-row') as HTMLElement;
    const secondRow = screen.getByText(second.text).closest('.setting-row') as HTMLElement;
    fireEvent.click(within(firstRow).getByRole('button', { name: 'Pin' }));
    expect(within(secondRow).getByRole('button', { name: 'Pin' })).toBeEnabled();
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(repo.updateMemory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.updateMemory).mock.calls.map(([id]) => id)).toEqual([first.id, second.id]);
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Pin' }).every(button => !button.hasAttribute('disabled'))).toBe(true));
  });

  it('prevents duplicate saves and same-record status writes while retaining retryable drafts', async () => {
    const record = memory('Original memory');
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    let reject!: (error: Error) => void;
    vi.mocked(repo.updateMemory).mockReturnValueOnce(new Promise((_resolve, failed) => { reject = failed; }))
      .mockResolvedValueOnce({ ...record, text: 'Draft', revision: 2 });
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(record.text);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Draft' } });
    const save = screen.getByRole('button', { name: /^Save$/ });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(repo.updateMemory).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(screen.getByRole('button', { name: /^Pin$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Hide$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Draft' } });
    await act(async () => { reject(new Error('Save unavailable')); });
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('Memory text')).toHaveValue('Draft');
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(repo.updateMemory).toHaveBeenCalledTimes(2));
  });

  it('hides stale combined profile text as soon as any contributing source is forgotten', async () => {
    const first = memory('first');
    const second = memory('second');
    vi.mocked(repo.listMemory).mockResolvedValue([first, second]);
    const combined = structuredClone(profile);
    combined.evidenceCount = 2;
    combined.profile.user.preferences.communication = [{ text: 'Combined private preference', sourceMemoryIds: [first.id, second.id], confidence: 1 }];
    vi.mocked(repo.getMemoryProfile).mockResolvedValue(combined);
    vi.mocked(repo.removeMemory).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Second source deletion failed.'));
    render(<MemoryManager enabled />);
    await screen.findByText('Combined private preference');
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(repo.removeMemory).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Combined private preference')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(await screen.findByText(second.text)).toBeInTheDocument();
    expect(screen.queryByText(first.text)).not.toBeInTheDocument();
  });

  it('keeps an open memory draft bound to its original revision after refresh', async () => {
    const record = memory('Original memory');
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    vi.mocked(repo.updateMemory).mockRejectedValue(new Error('Conflict: original revision changed.'));
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(record.text);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'My original revision draft' } });
    vi.mocked(repo.listMemory).mockResolvedValue([{ ...record, text: 'Another device correction', revision: 2 }]);
    await act(async () => { vi.mocked(realtime.on).mock.calls[0][1]({} as never); });
    expect(await screen.findByLabelText('Memory text')).toHaveValue('My original revision draft');
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(repo.updateMemory).toHaveBeenCalledOnce());
    expect(repo.updateMemory).toHaveBeenCalledWith(record.id, { expectedRevision: 1, text: 'My original revision draft', kind: 'fact' });
    expect(screen.getByLabelText('Memory text')).toHaveValue('My original revision draft');
  });

  it.each(['modify', 'reopen'] as const)('does not close a newer draft after an older save completes: %s', async change => {
    const record = memory('Original memory');
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    let complete!: (record: MemoryRecord) => void;
    vi.mocked(repo.updateMemory).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(record.text);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Submitted draft' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(repo.updateMemory).toHaveBeenCalledOnce());
    if (change === 'reopen') {
      fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
      fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    }
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'New unsaved draft' } });
    await act(async () => { complete({ ...record, text: 'Submitted draft', revision: 2 }); });
    expect(await screen.findByLabelText('Memory text')).toHaveValue('New unsaved draft');
  });

  it.each(['Conflict: reload before saving.', 'Network unavailable.'])('keeps a rejected memory edit open with its draft: %s', async failure => {
    const record = memory('Original memory');
    vi.mocked(repo.listMemory).mockResolvedValue([record]);
    vi.mocked(repo.updateMemory).mockRejectedValueOnce(new Error(failure)).mockResolvedValueOnce({ ...record, text: 'My unsaved correction', revision: 2 });
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(record.text);
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'My unsaved correction' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(useUi.getState().toasts.some(toast => toast.message === failure)).toBe(true));
    expect(screen.getByLabelText('Memory text')).toHaveValue('My unsaved correction');
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(repo.updateMemory).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.updateMemory).mock.calls[1]).toEqual([record.id, { expectedRevision: 1, text: 'My unsaved correction', kind: 'fact' }]);
    await waitFor(() => expect(screen.queryByLabelText('Memory text')).not.toBeInTheDocument());
  });

  it('keeps confirmed deletions excluded across fresh stale reads while showing tombstones', async () => {
    const item = memory('Confirmed exclusion');
    vi.mocked(repo.listMemory).mockImplementation(async query => query?.status === 'deleted'
      ? [{ ...item, text: 'Deleted memory', status: 'deleted', revision: 2 }] : [item]);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(item.text);
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(item.text)).not.toBeInTheDocument();
    await act(async () => { vi.mocked(realtime.on).mock.calls[0][1]({} as never); });
    expect(screen.queryByText(item.text)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Excluded' }));
    expect(await screen.findByText('Deleted memory')).toBeInTheDocument();
  });

  it.each(['add', 'edit'] as const)('does not refresh or notify a new account after a delayed %s', async action => {
    const item = memory('Owned memory');
    vi.mocked(repo.listMemory).mockResolvedValue([item]);
    let complete!: (record: MemoryRecord) => void;
    const pending = new Promise<MemoryRecord>(resolve => { complete = resolve; });
    vi.mocked(repo.addMemory).mockReturnValue(pending);
    vi.mocked(repo.updateMemory).mockReturnValue(pending);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(item.text);
    if (action === 'add') {
      fireEvent.change(screen.getByRole('textbox', { name: /Add memory/ }), { target: { value: 'New owned memory' } });
      fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
      fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'Edited owned memory' } });
      fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    }
    const toasts = useUi.getState().toasts;
    const calls = vi.mocked(repo.listMemory).mock.calls.length;
    accountScope.current = {};
    await act(async () => { complete(item); });
    expect(repo.listMemory).toHaveBeenCalledTimes(calls);
    expect(useUi.getState().toasts).toEqual(toasts);
  });

  it('keeps the fresh StrictMode lifetime while rejecting its initial load', async () => {
    let firstDone!: (items: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockImplementationOnce(() => new Promise(resolve => { firstDone = resolve; }))
      .mockResolvedValue([memory('StrictMode current')]);
    render(<StrictMode><MemoryManager enabled /></StrictMode>);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(await screen.findByText('StrictMode current')).toBeInTheDocument();
    await act(async () => { firstDone([memory('StrictMode obsolete')]); });
    expect(screen.queryByText('StrictMode obsolete')).not.toBeInTheDocument();
    expect(screen.getByText('StrictMode current')).toBeInTheDocument();
  });

  it('does not dispatch a realtime refresh from the previous account scope', async () => {
    render(<MemoryManager enabled />);
    await screen.findByText('No structured memory yet');
    const calls = vi.mocked(repo.listMemory).mock.calls.length;
    accountScope.current = {};
    await act(async () => { vi.mocked(realtime.on).mock.calls[0][1]({} as never); });
    expect(repo.listMemory).toHaveBeenCalledTimes(calls);
  });

  it('loads the active filter after adding from another status', async () => {
    vi.mocked(repo.addMemory).mockResolvedValue(memory('New active memory'));
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText('No active memories');
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    await screen.findByText('No suppressed memories');
    vi.mocked(repo.listMemory).mockClear().mockResolvedValue([memory('New active memory')]);
    fireEvent.change(screen.getByRole('textbox', { name: /Add memory/ }), { target: { value: 'New active memory' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await screen.findByText('New active memory');
    expect(vi.mocked(repo.listMemory).mock.calls.every(([query]) => query?.status === 'active')).toBe(true);
  });

  it.each(['switch', 'unmount'] as const)('stops later batch deletes after account %s', async change => {
    const first = memory('First source');
    const second = memory('Second source');
    vi.mocked(repo.listMemory).mockResolvedValue([first, second]);
    vi.mocked(repo.getMemoryProfile).mockResolvedValue({ ...profile, evidenceCount: 2,
      profile: { ...profile.profile, work: { ...profile.profile.work,
        projects: [{ text: 'Combined owner memory', sourceMemoryIds: [first.id, second.id], confidence: 1 }] } } });
    let complete!: () => void;
    vi.mocked(repo.removeMemory).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const view = render(<MemoryManager enabled />);
    await screen.findByText('Combined owner memory');
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(repo.removeMemory).toHaveBeenCalledTimes(1));
    if (change === 'switch') accountScope.current = {};
    else view.unmount();
    await act(async () => { complete(); });
    expect(repo.removeMemory).toHaveBeenCalledTimes(1);
  });

  it('reflects confirmed progress when a later source-memory deletion fails', async () => {
    const first = memory('Confirmed deletion');
    const second = memory('Failed deletion remains');
    vi.mocked(repo.listMemory).mockResolvedValue([first, second]);
    vi.mocked(repo.getMemoryProfile).mockResolvedValue({ ...profile, evidenceCount: 2,
      profile: { ...profile.profile, work: { ...profile.profile.work,
        projects: [{ text: 'Combined memory', sourceMemoryIds: [first.id, second.id], confidence: 1 }] } } });
    vi.mocked(repo.removeMemory).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Second deletion failed'));
    render(<MemoryManager enabled />);
    await screen.findByText('Combined memory');
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(repo.removeMemory).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    expect(screen.queryByText(first.text)).not.toBeInTheDocument();
    expect(await screen.findByText(second.text)).toBeInTheDocument();
  });

  it('does not restore a confirmed deletion from an already-running refresh', async () => {
    let refreshDone!: (items: MemoryRecord[]) => void;
    const item = memory('Delete this memory');
    vi.mocked(repo.listMemory).mockResolvedValueOnce([item])
      .mockResolvedValueOnce([item])
      .mockImplementationOnce(() => new Promise(resolve => { refreshDone = resolve; }));
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText(item.text);
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/excluded from future replies\. Source chats and backups may remain/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/permanently deleted/)).not.toBeInTheDocument();
    await act(async () => { vi.mocked(realtime.on).mock.calls[0][1]({} as never); });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Delete$/ }));
    await waitFor(() => expect(repo.removeMemory).toHaveBeenCalledWith(item.id));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await act(async () => { refreshDone([item]); });
    expect(screen.queryByText(item.text)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading memory/)).not.toBeInTheDocument();
  });

  it('does not stop the newer loading state when an older request finishes', async () => {
    let oldDone!: (items: MemoryRecord[]) => void;
    let currentDone!: (items: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockImplementationOnce(() => new Promise(resolve => { oldDone = resolve; }))
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise(resolve => { currentDone = resolve; }));
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    await act(async () => { oldDone([memory('Stale')]); });
    expect(screen.getByText(/Loading memory/)).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    await act(async () => { currentDone([memory('Current', 'suppressed')]); });
    expect(await screen.findByText('Current')).toBeInTheDocument();
  });

  it('discards a superseded inactive-page read before publishing a mixed result', async () => {
    let activeDone!: (items: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise(resolve => { activeDone = resolve; }))
      .mockResolvedValueOnce([memory('Current outdated', 'invalidated')]);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText('No active memories');
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    await waitFor(() => expect(repo.listMemory).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('tab', { name: 'Outdated' }));
    expect(await screen.findByText('Current outdated')).toBeInTheDocument();
    await act(async () => { activeDone([memory('Old hidden', 'suppressed')]); });
    expect(screen.getByText('Current outdated')).toBeInTheDocument();
    expect(screen.queryByText('Old hidden')).not.toBeInTheDocument();
  });

  it('keeps a same-status realtime refresh when the initial load finishes late', async () => {
    let oldDone!: (items: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockImplementationOnce(() => new Promise(resolve => { oldDone = resolve; }))
      .mockResolvedValue([memory('Realtime current')]);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await act(async () => { vi.mocked(realtime.on).mock.calls[0][1]({} as never); });
    expect(await screen.findByText('Realtime current')).toBeInTheDocument();
    await act(async () => { oldDone([memory('Initial stale')]); });
    expect(screen.getByText('Realtime current')).toBeInTheDocument();
  });

  it('does not start follow-up active reads after unmount', async () => {
    let hiddenDone!: (items: MemoryRecord[]) => void;
    vi.mocked(repo.listMemory).mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise(resolve => { hiddenDone = resolve; }));
    const view = render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    await screen.findByText('No active memories');
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    view.unmount();
    await act(async () => { hiddenDone([memory('Unmounted', 'suppressed')]); });
    expect(repo.listMemory).toHaveBeenCalledTimes(3);
  });

  it.each(['success', 'failure'] as const)('keeps the current filter after stale load %s', async outcome => {
    let resolveOld!: (items: MemoryRecord[]) => void;
    let rejectOld!: (error: Error) => void;
    vi.mocked(repo.listMemory).mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([memory('Current hidden memory', 'suppressed')]);
    render(<MemoryManager enabled />);
    fireEvent.click(screen.getByRole('tab', { name: 'Evidence' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Hidden' }));
    expect(await screen.findByText('Current hidden memory')).toBeInTheDocument();
    await act(async () => {
      if (outcome === 'success') resolveOld([memory('Stale active memory')]);
      else rejectOld(new Error('Stale load error'));
    });
    expect(screen.getByText('Current hidden memory')).toBeInTheDocument();
    expect(screen.queryByText('Stale active memory')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale load error')).not.toBeInTheDocument();
  });
});