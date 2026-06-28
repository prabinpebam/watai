import type { Meta, StoryObj } from '@storybook/react';
import { SkillsBody } from './SkillsBody';
import { SkillDetailDialog } from './SkillDetailDialog';
import { SkillErrorsDialog } from './SkillErrorsDialog';
import type { SkillDetail, SkillSummary, SkillValidationError } from '../../lib/types';

const meta = {
  title: 'Features/Skills',
  parameters: { layout: 'fullscreen', frame: 'surface', route: '/settings/skills' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const skillRows: SkillSummary[] = [
  {
    id: 'pdf',
    name: 'PDF Agent',
    description: 'Create, fill, inspect, and repair PDF documents from user instructions.',
    source: 'default',
    version: 2,
    enabled: true,
    status: 'ready',
    fileCount: 11,
  },
  {
    id: 'invoice-writer',
    name: 'Invoice Writer',
    description: 'Draft polished invoices from notes, line items, and uploaded evidence.',
    source: 'user',
    version: 1,
    enabled: true,
    status: 'ready',
    bytes: 284672,
    fileCount: 5,
  },
  {
    id: 'legacy-tax',
    name: 'Legacy Tax Helper',
    description: 'Missing required SKILL.md frontmatter.',
    source: 'user',
    version: 1,
    enabled: false,
    status: 'invalid',
    error: 'Missing required description field.',
    bytes: 92160,
    fileCount: 3,
  },
];

const skillDetail: SkillDetail = {
  ...skillRows[0],
  license: 'MIT',
  files: [
    { path: 'SKILL.md', bytes: 6048 },
    { path: 'scripts/create_pdf.py', bytes: 12840 },
    { path: 'references/pdf_forms.md', bytes: 8044 },
    { path: 'templates/report.html', bytes: 4096 },
  ],
  body: [
    '# PDF Agent',
    '',
    'Use this skill when the user asks to create, fill, inspect, or repair PDF files.',
    '',
    'Return only the final PDF artifact unless the user explicitly asks for reference files.',
  ].join('\n'),
};

const validationErrors: SkillValidationError[] = [
  { rule: 'skill-md', message: 'SKILL.md is missing from the zip root.' },
  { rule: 'size', message: 'references/source.pdf exceeds the per-file limit.' },
  { rule: 'path', message: 'Remove absolute paths before uploading the package.' },
];

export const Catalog: Story = {
  render: () => (
    <div className="settings-panel storybook-surface">
      <SkillsBody />
    </div>
  ),
};

export const CodeInterpreterGate: Story = {
  render: () => (
    <div className="settings-panel storybook-surface">
      <SkillsBody codeInterpreterOff />
    </div>
  ),
};

export const DetailDialog: Story = {
  render: () => (
    <SkillDetailDialog
      skill={skillRows[0]}
      onClose={() => {}}
      onToggle={() => {}}
      onReplace={() => {}}
      onDownload={() => {}}
      onDelete={() => {}}
    />
  ),
};

export const ValidationDialog: Story = {
  render: () => <SkillErrorsDialog errors={validationErrors} onClose={() => {}} />,
};