import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { HistoryList } from './HistoryList';
import { SearchView } from './SearchView';

const meta = {
  title: 'Features/History',
  parameters: { layout: 'fullscreen', frame: 'surface', route: '/' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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
    <aside className="sidebar" style={{ height: 720, width: 320 }}>
      <HistoryList activeId="story-thread" />
    </aside>
  ),
};

export const CollapsedRail: Story = {
  render: () => (
    <aside className="sidebar sidebar--collapsed" style={{ height: 720, width: 84 }}>
      <HistoryList activeId="story-thread" collapsed />
    </aside>
  ),
};

export const SearchResults: Story = {
  render: () => <SearchWithSeededQuery />,
  parameters: { frame: 'app', route: '/search' },
};