import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SearchView } from './SearchView';

const mocks = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock('../../data', () => ({ repo: { search: mocks.search } }));

function Destination() {
  const location = useLocation();
  return <div>{location.pathname}{location.hash}</div>;
}

function renderSearch() {
  render(
    <MemoryRouter initialEntries={['/search']}>
      <Routes>
        <Route path="/search" element={<SearchView />} />
        <Route path="/c/:threadId" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('SearchView request states', () => {
  it('shows an initial failure with a same-query retry instead of calling it empty', async () => {
    mocks.search.mockRejectedValueOnce(new Error('index unavailable')).mockResolvedValueOnce([]);
    renderSearch();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'budget' } });

    expect(screen.queryByText(/No matches/)).not.toBeInTheDocument();
    expect(await screen.findByText('Could not search conversations.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));

    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    expect(mocks.search).toHaveBeenLastCalledWith('budget');
    expect(await screen.findByText('No matches for "budget".')).toBeInTheDocument();
  });

  it('opens the exact matched message rather than only its thread', async () => {
    mocks.search.mockResolvedValueOnce([{
      thread: {
        id: 'thread-1', title: 'Planning', pinned: false, archived: false, temporary: false,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
      messageId: 'message-42',
      snippet: 'the budget decision',
    }]);
    renderSearch();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search conversations' }), { target: { value: 'budget' } });
    fireEvent.click(await screen.findByRole('button', { name: /Planning/ }));

    expect(await screen.findByText('/c/thread-1#message-message-42')).toBeInTheDocument();
  });
});