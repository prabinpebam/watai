import type { Meta, StoryObj } from '@storybook/react';
import { PersonalizationBody, Settings } from './Settings';
import { DEFAULT_SETTINGS } from '../../lib/types';

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
        <div className="settings-head">
          <div className="settings-head__title">Personalization</div>
          <div className="settings-head__sub">Custom instructions and memory</div>
        </div>
        <PersonalizationBody
          ctx={{
            settings: DEFAULT_SETTINGS,
            setSettings: () => undefined,
            loaded: true,
            account: { name: 'Story User', email: 'story@example.com' },
            me: { email: 'story@example.com', isAdmin: true, isInvited: true },
            stats: { bytes: null, chats: null, images: null },
            chatModel: 'gpt-5.4',
            onModelSaved: () => undefined,
            tavilyConfigured: true,
          }}
        />
      </div>
    </div>
  ),
  parameters: { frame: 'surface' },
};