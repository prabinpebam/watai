import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ChatView } from './ChatView';

vi.mock('./useChat', () => ({
  useChat: () => ({
    messages: [
      { id: 'user-1', role: 'user', content: 'question' },
      { id: 'answer-42', role: 'assistant', content: 'matched answer' },
    ],
    loading: false,
    send: vi.fn(), regenerate: vi.fn(), stop: vi.fn(), streaming: false, indexing: false, lockedBy: null,
  }),
}));

vi.mock('./Message', () => ({
  UserMessage: ({ message }: { message: { id: string } }) => <div data-message-id={message.id}>user</div>,
  AssistantMessage: ({ message }: { message: { id: string } }) => <div data-message-id={message.id}>assistant</div>,
}));
vi.mock('./Composer', () => ({ Composer: () => <div /> }));
vi.mock('./PromptMinimap', () => ({ PromptMinimap: () => null }));
vi.mock('./SourcePane', () => ({ SourcePane: () => null }));
vi.mock('./ThreadFilesPane', () => ({ ThreadFilesPane: () => null }));
vi.mock('./Attachments', () => ({ GeneratedImageViewer: () => null }));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChatView exact search target', () => {
  it('centers and focuses the matched message from the route hash', async () => {
    render(
      <MemoryRouter initialEntries={['/c/thread-1#message-answer-42']}>
        <ChatView threadId="thread-1" />
      </MemoryRouter>,
    );
    const target = document.querySelector<HTMLElement>('[data-message-id="answer-42"]')!;
    await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
    expect(target).toHaveFocus();
  });
});