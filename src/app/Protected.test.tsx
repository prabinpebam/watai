import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  isSignedIn: vi.fn(),
  loadMe: vi.fn(),
  getCredentialStatus: vi.fn(),
  listThreads: vi.fn(),
}));

vi.mock('../auth/cloudAuth', () => ({ isSignedIn: mocks.isSignedIn, signOut: vi.fn() }));
vi.mock('../auth/access', () => ({ loadMe: mocks.loadMe, cachedMe: vi.fn(() => null) }));
vi.mock('../data/secureStore', () => ({ clearApiCredentials: vi.fn() }));
vi.mock('../data', () => ({
  cloudApi: { getCredentialStatus: mocks.getCredentialStatus },
  repo: { listThreads: mocks.listThreads }, realtime: {}, accountLocalStorageKey: vi.fn(), seedMockDataIfEmpty: vi.fn(), purgeDemoData: vi.fn(),
  syncNow: vi.fn(), backfillSync: vi.fn(),
}));
vi.mock('../features/chat/runStore', () => ({ restoreInterruptedRuns: vi.fn() }));

import { Protected, RootRedirect } from './App';

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Protected startup recovery', () => {
  it('retries a rejected bootstrap check instead of spinning forever', async () => {
    mocks.isSignedIn.mockRejectedValueOnce(new Error('auth unavailable')).mockResolvedValueOnce(false);
    render(<MemoryRouter><Protected><div>Application</div></Protected></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Watai couldn’t finish starting');
    fireEvent.click(screen.getByRole('button', { name: 'Retry startup' }));
    await waitFor(() => expect(mocks.isSignedIn).toHaveBeenCalledTimes(2));
  });

  it('retries a failed root conversation read', async () => {
    mocks.listThreads.mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue([]);
    render(<MemoryRouter><RootRedirect /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversations couldn’t be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversations' }));
    await waitFor(() => expect(mocks.listThreads).toHaveBeenCalledTimes(2));
  });
});