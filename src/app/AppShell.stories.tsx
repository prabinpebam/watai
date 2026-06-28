import { HashRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react';
import { AppShell, SidebarContent } from './AppShell';

const meta = {
  title: 'App/Shell',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SidebarExpanded: Story = {
  render: () => (
    <HashRouter>
      <aside className="sidebar" style={{ height: 720 }}><SidebarContent /></aside>
    </HashRouter>
  ),
};

export const ShellFrame: Story = {
  render: () => (
    <HashRouter>
      <div style={{ height: 720 }}><AppShell /></div>
    </HashRouter>
  ),
};