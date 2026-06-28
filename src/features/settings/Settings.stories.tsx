import type { Meta, StoryObj } from '@storybook/react';
import { MemoryManager, Settings } from './Settings';

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

export const PersonalizationMemory: Story = {
  render: () => (
    <div className="page">
      <div className="page__inner">
        <MemoryManager enabled />
      </div>
    </div>
  ),
  parameters: { frame: 'surface' },
};