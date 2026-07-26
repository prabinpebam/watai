import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GeneratedImageViewer } from './Attachments';
import type { ImageRef } from '../../lib/types';

const mocks = vi.hoisted(() => ({ resolveImageUrl: vi.fn() }));

vi.mock('../../data', () => ({ repo: { resolveImageUrl: mocks.resolveImageUrl } }));

function img(id: string): ImageRef {
  return {
    id,
    blobPath: `https://example.test/${id}.png`,
    prompt: `prompt ${id}`,
    size: '1024x1024',
    outputFormat: 'png',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function Harness({ images, startId }: { images: ImageRef[]; startId: string }) {
  const [currentId, setCurrentId] = useState<string | null>(startId);
  return (
    <GeneratedImageViewer
      images={images}
      currentId={currentId}
      onSelect={(image) => setCurrentId(image.id)}
      onClose={() => setCurrentId(null)}
    />
  );
}

describe('GeneratedImageViewer', () => {
  beforeEach(() => {
    mocks.resolveImageUrl.mockReset();
    mocks.resolveImageUrl.mockImplementation((image: ImageRef) => Promise.resolve(image.blobPath!));
  });

  it('keeps the filmstrip mounted and resolves each image once while stepping', async () => {
    const images = [img('a1'), img('a2'), img('a3')];
    render(<Harness images={images} startId="a1" />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Open image/ })).toHaveLength(3));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    const resolvedFirstPass = mocks.resolveImageUrl.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));

    // Still the same viewer: the strip and the counter survive the selection.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Open image/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Open image 3' }));
    expect(screen.getByText('3 of 3')).toBeInTheDocument();

    // Navigation must not re-resolve anything — the session cache already holds every URL.
    expect(mocks.resolveImageUrl).toHaveBeenCalledTimes(resolvedFirstPass);
  });

  it('renders nothing once closed', async () => {
    render(<Harness images={[img('b1'), img('b2')]} startId="b1" />);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
