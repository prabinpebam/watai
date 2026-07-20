import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { LibraryItemDTO } from '../../data/cloud/types';
import { LibraryDetail } from './LibraryDetail';
import { useUi } from '../../state/store';

const mocks = vi.hoisted(() => ({
  getLibraryItem: vi.fn(),
  getLibraryLineage: vi.fn(),
  listLibrary: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock('../../data', () => ({ cloudApi: { getLibraryItem: mocks.getLibraryItem, getLibraryLineage: mocks.getLibraryLineage, listLibrary: mocks.listLibrary } }));
vi.mock('../../lib/saveFile', () => ({ saveFile: mocks.saveFile }));
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
  image: { prompt: 'A launch poster', model: 'gpt-image', size: '1024x1024', provenanceComplete: false },
  url: 'https://blob.test/image.png',
};

function LocationView() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderDetail(itemId = 'image-1') {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/library/${itemId}`, state: { backTo: '/library?kind=image', focusId: itemId } }]}>
      <Routes>
        <Route path="/library/:itemId" element={<><LibraryDetail /><LocationView /></>} />
        <Route path="*" element={<LocationView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.getLibraryItem.mockReset();
  mocks.saveFile.mockReset().mockResolvedValue(undefined);
  mocks.getLibraryItem.mockResolvedValue(image);
  mocks.getLibraryLineage.mockReset().mockResolvedValue({ items: [] });
  mocks.listLibrary.mockReset().mockResolvedValue({ items: [image], totalApprox: 1 });
  useUi.setState({ stagedLibraryByThread: {} });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

describe('LibraryDetail', () => {
  it('renders image metadata, incomplete provenance, download, and source navigation', async () => {
    renderDetail();
    expect(await screen.findByRole('img', { name: 'A launch poster' })).toHaveAttribute('src', image.url);
    expect(screen.getByText('Reference history is unavailable for this older image.')).toBeInTheDocument();
    expect(screen.getByText('gpt-image')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledWith(image.url, image.name));

    fireEvent.click(screen.getByRole('button', { name: 'Show in chat' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/c/thread-1');
  });

  it('returns to the preserved filtered list URL', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Image' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/library?kind=image');
  });

  it('shows an honest download-first state for unsupported browser previews', async () => {
    mocks.getLibraryItem.mockResolvedValue({ ...image, id: 'doc-1', kind: 'document', name: 'brief.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', image: undefined });
    renderDetail('doc-1');
    expect(await screen.findByText('Preview isn’t available for this file type.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('renders retained tombstones without a broken preview or enabled download', async () => {
    mocks.getLibraryItem.mockResolvedValue({ ...image, state: 'purged', url: undefined, purgedAt: '2026-07-19T13:00:00.000Z' });
    renderDetail();
    expect(await screen.findByText('Permanently deleted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('renders and navigates ordered reference and derived lineage results', async () => {
    const reference = { ...image, id: 'reference', image: { ...image.image!, prompt: 'Reference image' } };
    const derived = { ...image, id: 'derived', image: { ...image.image!, prompt: 'Derived image' } };
    mocks.getLibraryLineage.mockImplementation(async (_id: string, direction: string) => ({ items: direction === 'references' ? [reference] : [derived] }));
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'References' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Derived outputs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reference image/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/library/reference');
    await waitFor(() => expect(mocks.getLibraryItem).toHaveBeenLastCalledWith('reference'));
    await screen.findByRole('heading', { name: 'Image' });
  });

  it('stages a compatible item in a lazy new chat without sending it', async () => {
    renderDetail();
    await screen.findByRole('heading', { name: 'Image' });
    fireEvent.click(screen.getByRole('button', { name: 'Use in new chat' }));
    const location = screen.getByTestId('location').textContent ?? '';
    expect(location).toMatch(/^\/c\//);
    const threadId = location.slice('/c/'.length);
    expect(useUi.getState().stagedLibraryByThread[threadId]).toEqual([{ item: image, mode: 'attach' }]);
  });

  it('shows a filmstrip and navigates filtered images with buttons and arrow keys', async () => {
    const second = { ...image, id: 'image-2', name: 'image-2.png', image: { ...image.image!, prompt: 'Second image' }, url: 'https://blob.test/image-2.png' };
    mocks.listLibrary.mockResolvedValue({ items: [image, second], totalApprox: 2 });
    mocks.getLibraryItem.mockImplementation(async (id: string) => id === second.id ? second : image);
    renderDetail();

    expect(await screen.findByRole('navigation', { name: 'Image navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next image' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'A launch poster' })).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/library/image-2'));
    await waitFor(() => expect(mocks.getLibraryItem).toHaveBeenLastCalledWith('image-2'));

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/library/image-1'));
  });
});
