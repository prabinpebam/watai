import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibraryImage } from './LibraryImage';

describe('LibraryImage', () => {
  it.each(['source-change', 'load-failure'])('ignores a stale decode completion after %s', async change => {
    let resolve!: () => void;
    const decoded = new Promise<void>(done => { resolve = done; });
    const { rerender } = render(<LibraryImage src="old.png" alt="Preview" />);
    const full = screen.getByRole('img', { name: 'Preview' });
    Object.defineProperty(full, 'decode', { configurable: true, value: () => decoded });
    fireEvent.load(full);
    if (change === 'source-change') rerender(<LibraryImage src="new.png" alt="Preview" />);
    else fireEvent.error(full);
    await act(async () => resolve());
    expect(full.closest('.library-image')).not.toHaveClass('is-loaded');
    if (change === 'load-failure') expect(full.closest('.library-image')).toHaveClass('is-failed');
  });

  it('keeps a blurred preview until the full image decodes, then reveals it', async () => {
    render(<LibraryImage src="full.png" previewSrc="preview.png" alt="Generated poster" />);
    const full = screen.getByRole('img', { name: 'Generated poster' });
    const root = full.closest('.library-image')!;
    expect(root).not.toHaveClass('is-loaded');
    expect(root.querySelector('.library-image__preview')).toHaveAttribute('src', 'preview.png');

    Object.defineProperty(full, 'decode', { value: async () => undefined });
    fireEvent.load(full);

    await waitFor(() => expect(root).toHaveClass('is-loaded'));
  });

  it('uses the same image as a blurred progressive layer when no thumbnail exists', () => {
    render(<LibraryImage src="only.png" alt="Only image" />);
    const full = screen.getByRole('img', { name: 'Only image' });
    expect(full.closest('.library-image')?.querySelector('.library-image__preview')).toBeNull();
    expect(full).toHaveAttribute('src', 'only.png');
  });
});
