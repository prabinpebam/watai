import type { Meta, StoryObj } from '@storybook/react';
import { Settings } from './Settings';

const meta = {
  title: 'Features/Settings',
  component: Settings,
  parameters: { layout: 'fullscreen', frame: 'app', route: '/settings/models' },
} satisfies Meta<typeof Settings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SettingsShell: Story = {
  render: () => <Settings />,
};