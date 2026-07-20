import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibraryImage } from './LibraryImage';

describe('LibraryImage', () => {
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
