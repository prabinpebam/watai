import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import type { LibraryItemDTO } from '../../data/cloud/types';
import { useUi } from '../../state/store';
import { LibraryPicker } from './LibraryPicker';

const mocks = vi.hoisted(() => ({ listLibrary: vi.fn() }));
vi.mock('../../data', () => ({ cloudApi: { listLibrary: mocks.listLibrary } }));
vi.mock('../../lib/hooks', async () => {
  const actual = await vi.importActual<typeof import('../../lib/hooks')>('../../lib/hooks');
  return { ...actual, useIsExpanded: () => true };
});

const base = {
  state: 'active' as const,
  origin: 'library_upload' as const,
  bytes: 100,
  createdAt: '2026-07-20T00:00:00Z',
  updatedAt: '2026-07-20T00:00:00Z',
  source: { surface: 'library' as const, createdAt: '2026-07-20T00:00:00Z' },
};
const image: LibraryItemDTO = { ...base, id: 'img', kind: 'image', name: 'Reference.png', mime: 'image/png', image: { provenanceComplete: true }, url: 'data:image/png;base64,AA==' };
const pdf: LibraryItemDTO = { ...base, id: 'pdf', kind: 'pdf', name: 'Brief.pdf', mime: 'application/pdf' };
const archive: LibraryItemDTO = { ...base, id: 'zip', kind: 'archive', name: 'Assets.zip', mime: 'application/zip' };

beforeEach(() => {
  mocks.listLibrary.mockReset().mockResolvedValue({ items: [image, pdf, archive], totalApprox: 3 });
  useUi.setState({ stagedLibraryByThread: {} });
});

describe('LibraryPicker', () => {
  it('multi-selects compatible items and stages them only on Done', async () => {
    const close = vi.fn();
    render(<LibraryPicker threadId="thread-1" onClose={close} />);
    await screen.findByText('Reference.png');
    fireEvent.click(screen.getByRole('button', { name: /Reference.png/ }));
    fireEvent.click(screen.getByRole('button', { name: /Brief.pdf/ }));
    expect(useUi.getState().stagedLibraryByThread['thread-1']).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done (2)' }));
    expect(useUi.getState().stagedLibraryByThread['thread-1'].map((selection) => selection.item.id)).toEqual(['img', 'pdf']);
    expect(useUi.getState().stagedLibraryByThread['thread-1'][0].mode).toBe('attach');
    expect(close).toHaveBeenCalled();
  });

  it('hides download-only items by default and reveals a disabled reason', async () => {
    render(<LibraryPicker threadId="thread-1" onClose={() => {}} />);
    await screen.findByText('Reference.png');
    expect(screen.queryByText('Assets.zip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show unavailable' }));
    const unavailable = await screen.findByRole('button', { name: /Assets.zip/ });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute('title', expect.stringContaining('download-only'));
  });

  it('cancels without staging and restores through the close callback', async () => {
    const close = vi.fn();
    render(<LibraryPicker threadId="thread-1" onClose={close} />);
    await screen.findByText('Reference.png');
    fireEvent.click(screen.getByRole('button', { name: /Reference.png/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(useUi.getState().stagedLibraryByThread['thread-1']).toBeUndefined();
  });
});
