import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantMessage } from './Message';
import type { Message } from '../../lib/types';

vi.mock('./Markdown', () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }));
vi.mock('../../data', () => ({ repo: {}, cloudApi: {} }));

const message: Message = {
  id: 'assistant-1', threadId: 'thread-1', role: 'assistant', content: 'Answer',
  status: 'streaming', createdAt: '2026-01-01T00:00:00Z',
};

afterEach(cleanup);

describe('AssistantMessage status announcements', () => {
  it('announces a streaming reply completion once without announcing completed history on mount', () => {
    const props = { message, streaming: true, onRegenerate: vi.fn() };
    const { rerender } = render(<AssistantMessage {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(<AssistantMessage {...props} streaming={false} message={{ ...message, status: 'complete' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Assistant reply complete.');
    expect(screen.getAllByRole('status')).toHaveLength(1);

    cleanup();
    render(<AssistantMessage {...props} streaming={false} message={{ ...message, status: 'complete' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});