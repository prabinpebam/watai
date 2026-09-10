import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../state/store';
import { AppErrorBoundary } from './AppErrorBoundary';

function BrokenScreen(): never {
  throw new Error('Chunk load failed');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppErrorBoundary', () => {
  it('offers named recovery without clearing drafts or active run state', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useUi.setState({
      composerDrafts: { thread: 'keep this draft' },
      stream: { status: 'streaming', threadId: 'thread', messageId: 'assistant' },
    });

    render(<AppErrorBoundary><BrokenScreen /></AppErrorBoundary>);

    expect(screen.getByRole('alert')).toHaveTextContent('Watai couldn’t load this screen');
    expect(screen.getByRole('button', { name: 'Reload Watai' })).toBeInTheDocument();
    expect(useUi.getState().composerDrafts).toEqual({ thread: 'keep this draft' });
    expect(useUi.getState().stream.status).toBe('streaming');
  });
});