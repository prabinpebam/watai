import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HistoryList } from './HistoryList';
import { useUi } from '../../state/store';

vi.mock('../../data', () => ({
  repo: {
    listThreads: vi.fn().mockResolvedValue([{
      id: 'today-1',
      title: 'Today conversation',
      pinned: false,
      archived: false,
      temporary: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]),
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

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Checking for conversation updates' })).toBeInTheDocument();
    expect(container.querySelectorAll('.thread-sync-dots i')).toHaveLength(3);

    act(() => useUi.getState().endThreadSync());

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(container.querySelector('.thread-sync-dots')).toBeInTheDocument();
  });
});
