import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it.each([true, false])('applies a definitive credential status while setup remains mounted: %s', async configured => {
    if (!configured) localStorage.setItem('watai.configured', '1');
    mocks.isSignedIn.mockResolvedValue(true);
    mocks.loadMe.mockResolvedValue({ isInvited: true });
    mocks.getCredentialStatus.mockResolvedValue({ configured });
    render(<MemoryRouter><Protected><div>Application</div></Protected></MemoryRouter>);
    await waitFor(() => expect(mocks.getCredentialStatus).toHaveBeenCalledOnce());
    await waitFor(() => expect(localStorage.getItem('watai.configured')).toBe(configured ? '1' : null));
    if (configured) expect(await screen.findByText('Application')).toBeInTheDocument();
    else await waitFor(() => expect(screen.queryByText('Application')).not.toBeInTheDocument());
  });

  it('preserves cached-ready behavior after a transient live status failure', async () => {
    localStorage.setItem('watai.configured', '1');
    mocks.isSignedIn.mockResolvedValue(true);
    mocks.loadMe.mockResolvedValue({ isInvited: true });
    mocks.getCredentialStatus.mockRejectedValue(new Error('Temporary status failure'));
    render(<MemoryRouter><Protected><div>Application</div></Protected></MemoryRouter>);
    await waitFor(() => expect(mocks.getCredentialStatus).toHaveBeenCalledOnce());
    expect(screen.getByText('Application')).toBeInTheDocument();
    expect(localStorage.getItem('watai.configured')).toBe('1');
  });

  it.each(['auth', 'access', 'credentials'] as const)('abandons late %s results without further requests or cache writes', async stage => {
    localStorage.setItem('watai.configured', '1');
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    mocks.isSignedIn.mockImplementation(async () => { if (stage === 'auth') await blocked; return true; });
    mocks.loadMe.mockImplementation(async () => { if (stage === 'access') await blocked; return { isInvited: true }; });
    mocks.getCredentialStatus.mockImplementation(async () => { if (stage === 'credentials') await blocked; return { configured: false }; });
    const view = render(<MemoryRouter><Protected><div>Application</div></Protected></MemoryRouter>);
    const started = stage === 'auth' ? mocks.isSignedIn : stage === 'access' ? mocks.loadMe : mocks.getCredentialStatus;
    await waitFor(() => expect(started).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { release(); });
    expect(mocks.loadMe).toHaveBeenCalledTimes(stage === 'auth' ? 0 : 1);
    expect(mocks.getCredentialStatus).toHaveBeenCalledTimes(stage === 'credentials' ? 1 : 0);
    expect(localStorage.getItem('watai.configured')).toBe('1');
  });

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