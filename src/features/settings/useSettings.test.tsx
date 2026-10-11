import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, effectiveMemorySettings } from '../../lib/types';
import { useUi } from '../../state/store';

const data = vi.hoisted(() => ({
  loadAccountSettings: vi.fn(),
  saveSettings: vi.fn(),
  scope: {},
}));

vi.mock('../../data', () => ({
  loadAccountSettings: data.loadAccountSettings,
  repo: { saveSettings: data.saveSettings },
  currentAccountKvStore: () => data.scope,
}));

import { useSettings } from './useSettings';

beforeEach(() => {
  data.loadAccountSettings.mockReset();
  data.saveSettings.mockReset();
  data.scope = {};
  useUi.getState().setTheme('system');
});
afterEach(cleanup);

describe('useSettings', () => {
  it.each([false, true].flatMap(master => [false, true].map(nested => ({ master, nested }))))
    ('keeps client effective memory opt-outs authoritative: %j', ({ master, nested }) => {
      const settings = { ...DEFAULT_SETTINGS, personalization: { memoryEnabled: master,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, enabled: nested } } };
      const before = structuredClone(settings);
      const enabled = master && nested;
      expect(effectiveMemorySettings(settings)).toMatchObject({ enabled, referenceSaved: enabled,
        referenceHistory: enabled, autoExtract: enabled, learnChats: enabled ? 'automatic' : 'off' });
      expect(settings).toEqual(before);
    });

  it('does not replace a newer local save with an older load result', async () => {
    let complete!: (value: typeof DEFAULT_SETTINGS) => void;
    data.loadAccountSettings.mockResolvedValueOnce(DEFAULT_SETTINGS)
      .mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    data.saveSettings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.retry());
    await act(async () => { await result.current.setSettings({ ...DEFAULT_SETTINGS,
      personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: false } }); });
    await act(async () => { complete(DEFAULT_SETTINGS); });
    expect(result.current.settings.personalization.memoryEnabled).toBe(false);
  });

  it('does not dispatch saves from the previous account scope', async () => {
    data.loadAccountSettings.mockResolvedValue(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    data.scope = {};
    await act(async () => { await result.current.setSettings(DEFAULT_SETTINGS); });
    expect(data.saveSettings).not.toHaveBeenCalled();
  });

  it('preserves save rejection without mirroring failed appearance', async () => {
    data.loadAccountSettings.mockResolvedValue(DEFAULT_SETTINGS);
    data.saveSettings.mockRejectedValue(new Error('Synthetic save failure'));
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await expect(result.current.setSettings({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' } }))
        .rejects.toThrow('Synthetic save failure');
    });
    expect(useUi.getState().theme).toBe('system');
  });

  it('ignores a previous load after a newer retry succeeds', async () => {
    let complete!: (value: typeof DEFAULT_SETTINGS) => void;
    data.loadAccountSettings.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }))
      .mockResolvedValueOnce({ ...DEFAULT_SETTINGS, personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: false } });
    const { result } = renderHook(() => useSettings());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { complete(DEFAULT_SETTINGS); });
    expect(result.current.settings.personalization.memoryEnabled).toBe(false);
  });

  it('ignores a load completed for a previous account scope', async () => {
    let complete!: (value: typeof DEFAULT_SETTINGS) => void;
    data.loadAccountSettings.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const { result } = renderHook(() => useSettings());
    data.scope = {};
    await act(async () => { complete(DEFAULT_SETTINGS); });
    expect(result.current.loaded).toBe(false);
  });

  it.each(['newer-save', 'account-switch', 'unmount'] as const)('does not mirror a stale save after %s', async change => {
    data.loadAccountSettings.mockResolvedValue(DEFAULT_SETTINGS);
    let complete!: () => void;
    data.saveSettings.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; })).mockResolvedValue(undefined);
    const view = renderHook(() => useSettings());
    await waitFor(() => expect(view.result.current.loaded).toBe(true));
    let first!: Promise<void>;
    act(() => { first = view.result.current.setSettings({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' } }); });
    if (change === 'newer-save') await act(async () => { await view.result.current.setSettings({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light' } }); });
    if (change === 'account-switch') data.scope = {};
    if (change === 'unmount') view.unmount();
    await act(async () => { complete(); await first; });
    expect(useUi.getState().theme).toBe(change === 'newer-save' ? 'light' : 'system');
  });

  it('does not report settings loaded when authoritative hydration fails', async () => {
    data.loadAccountSettings.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.degraded).toBe(true));
    expect(result.current.loaded).toBe(false);
  });

  it('retries the authoritative read from the degraded state', async () => {
    data.loadAccountSettings.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(DEFAULT_SETTINGS);
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.degraded).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(data.loadAccountSettings).toHaveBeenCalledTimes(2);
  });

  it('reports ready only after authoritative settings load', async () => {
    data.loadAccountSettings.mockResolvedValueOnce({
      ...DEFAULT_SETTINGS,
      personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: false },
    });
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.degraded).toBe(false);
    expect(result.current.settings.personalization.memoryEnabled).toBe(false);
  });
});
