import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from './Markdown';

vi.mock('./Lightbox', () => ({ Lightbox: ({ alt }: { alt?: string }) => <div role="dialog">{alt}</div> }));
vi.mock('./webImageActions', () => ({ attachWebImage: vi.fn() }));
afterEach(cleanup);

describe('Markdown images', () => {
  it('opens image expansion from a named native button', () => {
    render(<Markdown content="![Architecture diagram](https://example.test/diagram.png)" />);
    const expand = screen.getByRole('button', { name: 'Expand Architecture diagram' });
    fireEvent.keyDown(expand, { key: 'Enter' });
    fireEvent.click(expand);
    expect(screen.getByRole('dialog')).toHaveTextContent('Architecture diagram');
  });
});