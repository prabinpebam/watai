import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageContent } from './Message';

vi.mock('./Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}));

afterEach(() => {
  vi.useRealTimers();
});

describe('MessageContent', () => {
  it('throttles streaming updates and renders terminal content immediately', () => {
    vi.useFakeTimers();
    const view = render(<MessageContent content="A" streaming />);

    view.rerender(<MessageContent content="AB" streaming />);
    expect(screen.getByText('A')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText('AB')).toBeInTheDocument();

    view.rerender(<MessageContent content="ABC" streaming={false} />);
    expect(screen.getByText('ABC')).toBeInTheDocument();
  });
});