import { MemoryRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react';
import { Onboarding } from './Onboarding';

const meta = {
  title: 'Features/Onboarding',
  component: Onboarding,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Onboarding>;

export default meta;
type Story = StoryObj<typeof meta>;

function OnboardingFrame({ path }: { path: string }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Onboarding />
    </MemoryRouter>
  );
}

export const Welcome: Story = {
  render: () => <OnboardingFrame path="/welcome" />,
};

export const Keys: Story = {
  render: () => <OnboardingFrame path="/key" />,
};

export const Microphone: Story = {
  render: () => <OnboardingFrame path="/mic" />,
};