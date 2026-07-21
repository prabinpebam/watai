import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HistoryList } from './HistoryList';
import { useUi } from '../../state/store';

vi.mock('../../data', () => ({
  repo: {
    listThreads: vi.fn().mockResolvedValue([]),
  },
}));

afterEach(() => {
  cleanup();
  useUi.setState({ threadSyncCount: 0 });
});

describe('HistoryList sync status', () => {
  it('shows activity while checking for thread updates and clears it when settled', async () => {
    useUi.setState({ threadSyncCount: 1 });
    const { container } = render(
      <MemoryRouter>
        <HistoryList />
      </MemoryRouter>,
    );

    expect(screen.getByRole('progressbar', { name: 'Checking for conversation updates' })).toBeInTheDocument();

    act(() => useUi.getState().endThreadSync());

    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(container.querySelector('.thread-sync-status')).toBeInTheDocument();
  });
});
