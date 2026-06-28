import type { Meta, StoryObj } from '@storybook/react';

const meta = {
  title: 'Design System/Coverage Tracker',
  parameters: {
    docs: {
      description: {
        component: 'Coverage index for Watai UI surfaces. Every reusable primitive and feature surface should have a Storybook story before it ships.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const rows = [
  ['Primitives', 'Button, IconButton, Switch, Field, TextAreaField, Segmented, SelectMenu, Avatar', 'Design System/Controls'],
  ['App shell', 'Sidebar, app frame, compact drawer', 'App/Shell'],
  ['Chat', 'Messages, composer, attachments, tools, files, sources, markdown, lightbox', 'Features/Chat'],
  ['Image Studio', 'Composer, toolbar, gallery cards, image states', 'Features/Image Studio'],
  ['Settings', 'Settings shell and section navigation', 'Features/Settings'],
  ['Skills', 'Skill rows, detail, validation modal, code-interpreter gate', 'Features/Skills'],
  ['Voice', 'Voice mode states and controls', 'Features/Voice'],
  ['History/Search', 'History rows, collapsed rail, and search results', 'Features/History'],
  ['Onboarding', 'Welcome, model key setup, and microphone priming', 'Features/Onboarding'],
];

export const CoverageMatrix: Story = {
  render: () => (
    <div className="settings-card" style={{ width: 'min(920px, 100%)', padding: 'var(--space-5)' }}>
      <div className="settings-head" style={{ marginBottom: 'var(--space-5)' }}>
        <div className="settings-head__title">Storybook coverage</div>
        <div className="settings-head__sub">Track every app surface against its canonical design-system story.</div>
      </div>
      <div className="md-table-wrap">
        <table>
          <thead>
            <tr><th>Area</th><th>Covered UI</th><th>Story</th></tr>
          </thead>
          <tbody>
            {rows.map(([area, covered, story]) => (
              <tr key={area}><td>{area}</td><td>{covered}</td><td>{story}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ),
};