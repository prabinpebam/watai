import { useEffect, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react';
import { HistoryList } from './HistoryList';
import { SearchView } from './SearchView';
import { repo } from '../../data';
import { useUi } from '../../state/store';
import type { Thread } from '../../lib/types';

const meta = {
  title: 'Features/History',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const now = Date.now();
const threads: Thread[] = [
  {
    id: 'thread-active',
    title: 'PDF worksheet draft',
    pinned: true,
    archived: false,
    temporary: false,
    createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 4 * 60 * 1000).toISOString(),
    messageCount: 12,
    lastMessagePreview: 'The final worksheet PDF is attached.',
  },
  {
    id: 'thread-running',
    title: 'Research sources for lesson plan',
    pinned: false,
    archived: false,
    temporary: false,
    createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    messageCount: 8,
    lastMessagePreview: 'Finding high-quality references.',
  },
  {
    id: 'thread-old',
    title: 'Image prompts for story cards',
    pinned: false,
    archived: false,
    temporary: false,
    createdAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    messageCount: 5,
    lastMessagePreview: 'Use a bright editorial style.',
  },
];

function installHistoryFixtures() {
  Object.assign(repo, {
    listThreads: async () => threads,
    updateThread: async (id: string, patch: Partial<Thread>) => ({
      ...(threads.find((t) => t.id === id) ?? threads[0]),
      ...patch,
    }),
    deleteThread: async () => undefined,
    search: async (query: string) =>
      query.trim()
        ? [
            {
              thread: threads[0],
              messageId: 'm1',
              snippet: 'The generated PDF includes answer key pages and print margins.',
            },
            {
              thread: threads[1],
              messageId: 'm2',
              snippet: 'Research sources cite the original curriculum PDF.',
            },
          ]
        : [],
  });
  useUi.setState((state) => ({ threadsVersion: state.threadsVersion + 1 }));
}

function HistoryHarness({ children }: { children: ReactNode }) {
  useEffect(() => {
    installHistoryFixtures();
  }, []);
  return <MemoryRouter initialEntries={['/']}>{children}</MemoryRouter>;
}

function SearchWithSeededQuery() {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search conversations"]');
    if (!input) return;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, 'PDF');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);
  return <SearchView onClose={() => {}} />;
}

export const SidebarList: Story = {
  render: () => (
    <HistoryHarness>
      <aside className="sidebar" style={{ height: 720, width: 320 }}>
        <HistoryList activeId="thread-active" />
      </aside>
    </HistoryHarness>
  ),
};

export const CollapsedRail: Story = {
  render: () => (
    <HistoryHarness>
      <aside className="sidebar sidebar--collapsed" style={{ height: 720, width: 84 }}>
        <HistoryList activeId="thread-active" collapsed />
      </aside>
    </HistoryHarness>
  ),
};

export const SearchResults: Story = {
  render: () => (
    <HistoryHarness>
      <SearchWithSeededQuery />
    </HistoryHarness>
  ),
};