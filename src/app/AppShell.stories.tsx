import type { Meta, StoryObj } from '@storybook/react';
import { AppShell, SidebarContent } from './AppShell';

const meta = {
  title: 'App/Shell',
  parameters: { layout: 'fullscreen', frame: 'app', route: '/c/story-thread' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SidebarExpanded: Story = {
  render: () => (
    <aside className="sidebar" style={{ height: 720 }}><SidebarContent /></aside>
  ),
  parameters: { frame: 'surface' },
};

export const ShellFrame: Story = {
  render: () => <AppShell />,
};