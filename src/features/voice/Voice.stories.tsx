import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react';
import { VoiceMode } from './VoiceMode';

const meta = {
  title: 'Features/Voice',
  component: VoiceMode,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof VoiceMode>;

export default meta;
type Story = StoryObj<typeof meta>;

function VoiceFrame({ path = '/voice/story-thread' }: { path?: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/voice/:threadId" element={<VoiceMode />} />
        <Route path="/voice" element={<VoiceMode />} />
      </Routes>
    </MemoryRouter>
  );
}

export const Idle: Story = {
  render: () => <VoiceFrame />,
};

export const NewChatVoice: Story = {
  render: () => <VoiceFrame path="/voice" />,
};