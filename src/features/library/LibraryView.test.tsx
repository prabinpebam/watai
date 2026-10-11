import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { LibraryItemDTO } from '../../data/cloud/types';
import { LibraryView } from './LibraryView';

const mocks = vi.hoisted(() => ({
  listLibrary: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../../data', () => ({ cloudApi: { listLibrary: mocks.listLibrary } }));
vi.mock('./upload', () => ({ uploadToLibrary: mocks.upload }));

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

const pdf: LibraryItemDTO = {
  ...image,
  id: 'pdf-1',
  kind: 'pdf',
  origin: 'chat_upload',
  name: 'old-filter.pdf',
  mime: 'application/pdf',
  image: undefined,
  url: undefined,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

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
  mocks.upload.mockReset().mockResolvedValue(image);
});

describe('LibraryView', () => {
  it.each(['unmount', 'replacement'])('cancels an old batch and starts no later files after %s', async action => {
    const pending = deferred<LibraryItemDTO>();
    mocks.upload.mockReturnValueOnce(pending.promise);
    const view = renderLibrary();
    await screen.findByText('A launch poster');
    const input = view.container.querySelector('input[type="file"]')!;
    const first = new File(['first'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['second'], 'second.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [first, second] } });
    expect(mocks.upload).toHaveBeenCalledOnce();
    const signal = mocks.upload.mock.calls[0][3] as AbortSignal | undefined;
    if (action === 'unmount') view.unmount();
    else fireEvent.change(input, { target: { files: [new File(['new'], 'replacement.pdf', { type: 'application/pdf' })] } });
    await act(async () => pending.resolve(image));
    expect(signal?.aborted).toBe(true);
    expect(mocks.upload.mock.calls.some(([file]) => file.name === 'second.pdf')).toBe(false);
    expect(mocks.upload).toHaveBeenCalledTimes(action === 'unmount' ? 1 : 2);
  });

  it('rejects an old page after switching away and back to the same filter', async () => {
    const pending = deferred<{ items: LibraryItemDTO[] }>();
    const stale = { ...pdf, id: 'old-page', name: 'stale-page.pdf' };
    mocks.listLibrary.mockImplementation((query: { cursor?: string; kind?: string[] }) => {
      if (query.cursor) return pending.promise;
      if (query.kind?.includes('image')) return Promise.resolve({ items: [image] });
      return Promise.resolve({ items: [pdf], cursor: 'next-page' });
    });
    renderLibrary();
    await screen.findByText('old-filter.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    await screen.findByRole('img', { name: 'A launch poster' });
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('old-filter.pdf');
    await act(async () => pending.resolve({ items: [stale] }));
    expect(screen.queryByText('stale-page.pdf')).not.toBeInTheDocument();
  });

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

  it('does not append an old pagination response after the filter changes', async () => {
    const oldPage = deferred<{ items: LibraryItemDTO[]; totalApprox: number }>();
    mocks.listLibrary.mockImplementation((query: { cursor?: string; kind?: string[] }) => {
      if (query.cursor) return oldPage.promise;
      if (query.kind?.includes('image')) return Promise.resolve({ items: [image], totalApprox: 1 });
      return Promise.resolve({ items: [pdf], cursor: 'next-page', totalApprox: 2 });
    });
    renderLibrary();
    await screen.findByText('old-filter.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Images' }));
    await screen.findByRole('img', { name: 'A launch poster' });

    await act(async () => oldPage.resolve({ items: [pdf], totalApprox: 2 }));
    expect(screen.queryByText('old-filter.pdf')).not.toBeInTheDocument();
  });
});
