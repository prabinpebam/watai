import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/types';

const data = vi.hoisted(() => ({
  loadAccountSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('../../data', () => ({
  loadAccountSettings: data.loadAccountSettings,
  repo: { saveSettings: data.saveSettings },
}));

import { useSettings } from './useSettings';

beforeEach(() => {
  data.loadAccountSettings.mockReset();
  data.saveSettings.mockReset();
});

describe('useSettings', () => {
  it('does not report settings loaded when authoritative hydration fails', async () => {
    data.loadAccountSettings.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.degraded).toBe(true));
    expect(result.current.loaded).toBe(false);
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
