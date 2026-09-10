import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentList } from './Attachments';

const mocks = vi.hoisted(() => ({ resolveAssetUrl: vi.fn() }));
vi.mock('../../data', () => ({ repo: { resolveAssetUrl: mocks.resolveAssetUrl } }));
vi.mock('./Lightbox', () => ({ ImagePrompt: () => null, Lightbox: () => null }));

const attachment = {
  id: 'image-1', kind: 'image' as const, mime: 'image/png', name: 'diagram.png', bytes: 10,
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('AttachmentList recovery', () => {
  it('shows a named error and retries the same attachment', async () => {
    mocks.resolveAssetUrl.mockRejectedValueOnce(new Error('expired')).mockResolvedValueOnce('blob:recovered');
    render(<AttachmentList attachments={[attachment]} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('diagram.png couldn’t be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry attachment' }));
    expect(await screen.findByRole('img', { name: 'diagram.png' })).toHaveAttribute('src', 'blob:recovered');
    expect(mocks.resolveAssetUrl).toHaveBeenCalledTimes(2);
  });
});