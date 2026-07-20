import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { LibraryItemDTO } from '../../data/cloud/types';
import { LibraryView } from './LibraryView';

const mocks = vi.hoisted(() => ({
  listLibrary: vi.fn(),
}));

vi.mock('../../data', () => ({ cloudApi: { listLibrary: mocks.listLibrary } }));

vi.mock('../../lib/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../lib/hooks')>('../../lib/hooks');
  return { ...actual, useIsExpanded: () => true };
});

const image: LibraryItemDTO = {
  id: 'image-1',
  state: 'active',
  kind: 'image',
  origin: 'chat_generated_image',
  name: 'image-1.png',
  mime: 'image/png',
  bytes: 2048,
  createdAt: '2026-07-19T12:00:00.000Z',
  updatedAt: '2026-07-19T12:00:00.000Z',
  source: { surface: 'chat', threadId: 'thread-1', threadTitleSnapshot: 'Launch plans', createdAt: '2026-07-19T12:00:00.000Z' },
  image: { prompt: 'A launch poster', provenanceComplete: false },
  url: 'https://blob.test/image.png',
};

function LocationView() {
  return <output data-testid="location">{useLocation().pathname}{useLocation().search}</output>;
}

function renderLibrary(path = '/library') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/library" element={<><LibraryView /><LocationView /></>} />
        <Route path="/library/:itemId" element={<LocationView />} />
        <Route path="/library/create/image" element={<LocationView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.listLibrary.mockReset();
  mocks.listLibrary.mockResolvedValue({ items: [image], totalApprox: 1 });
});

describe('LibraryView', () => {
  it('shows layout-preserving shimmer rows instead of a circular loader', () => {
    mocks.listLibrary.mockReturnValue(new Promise(() => {}));
    renderLibrary();
    expect(screen.getByRole('status', { name: 'Loading Library' })).toBeInTheDocument();
    expect(document.querySelectorAll('.library-skeleton-row')).toHaveLength(8);
    expect(document.querySelector('.spinner')).toBeNull();
  });

  it('renders returned items and opens detail while preserving source metadata', async () => {
    renderLibrary();
    expect(await screen.findByText('A launch poster')).toBeInTheDocument();
    expect(screen.getByText(/Launch plans/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('A launch poster'));
    expect(screen.getByTestId('location')).toHaveTextContent('/library/image-1');
  });

  it('writes image mode to the URL and renders a real image tile', async () => {
    renderLibrary();
    await screen.findByText('A launch poster');
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/library?kind=image'));
    expect(await screen.findByRole('img', { name: 'A launch poster' })).toHaveAttribute('src', image.url);
    expect(screen.getByRole('button', { name: /Create image/ })).toBeInTheDocument();
  });

  it('shows the filtered empty state and clears filters', async () => {
    mocks.listLibrary.mockResolvedValue({ items: [], totalApprox: 0 });
    renderLibrary('/library?kind=pdf');
    expect(await screen.findByText('No items match these filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/library'));
  });

  it('retries a failed initial request', async () => {
    mocks.listLibrary.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [image], totalApprox: 1 });
    renderLibrary();
    expect(await screen.findByText('We couldn’t load your Library')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('A launch poster')).toBeInTheDocument();
    expect(mocks.listLibrary).toHaveBeenCalledTimes(2);
  });
});
