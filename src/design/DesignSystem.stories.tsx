import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Avatar, Button, Field, IconButton, Segmented, SelectMenu, Switch, TextAreaField } from './ui';
import { Icon } from './icons';

const meta = {
  title: 'Design System/Controls',
  parameters: {
    docs: {
      description: {
        component: 'Canonical Watai controls. Use these primitives instead of native controls in feature UI.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => (
    <div className="col" style={{ gap: 'var(--space-4)', width: 420 }}>
      <div className="row">
        <Button variant="primary" icon="sparkle">Primary</Button>
        <Button variant="secondary" icon="upload">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </div>
      <div className="row">
        <IconButton name="file-text" label="Files" />
        <IconButton name="code" label="Code" variant="accent" />
        <IconButton name="mic" label="Dictate" variant="muted" />
        <Button variant="danger" icon="trash">Danger</Button>
      </div>
    </div>
  ),
};

export const Inputs: Story = {
  render: () => (
    <div className="col" style={{ gap: 'var(--space-5)', width: 420 }}>
      <Field label="Deployment name" value="gpt-5.4" readOnly hint="Use the exact deployment name from Azure." />
      <TextAreaField label="Prompt" value="Describe the worksheet style..." readOnly />
    </div>
  ),
};

export const ChoiceControls: Story = {
  render: function ChoiceControlsStory() {
    const [model, setModel] = useState('model-router');
    const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
    const [enabled, setEnabled] = useState(true);
    return (
      <div className="col" style={{ gap: 'var(--space-5)', width: 420 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="text-strong">Chat model</span>
          <SelectMenu
            label="Chat model"
            value={model}
            onChange={setModel}
            options={[
              { value: 'model-router', label: 'Auto', description: 'Routes automatically' },
              { value: 'gpt-5.4', label: 'gpt-5.4', description: 'Direct deployment' },
            ]}
          />
        </div>
        <Segmented
          value={quality}
          onChange={setQuality}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
        <div className="row">
          <Avatar size="sm" variant="assistant"><Icon name="sparkle" size={15} /></Avatar>
          <span>Code interpreter</span>
          <Switch checked={enabled} onChange={setEnabled} label="Code interpreter" />
        </div>
      </div>
    );
  },
};