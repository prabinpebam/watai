import { useEffect, useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react';
import { SkillsBody } from './SkillsBody';
import { SkillDetailDialog } from './SkillDetailDialog';
import { SkillErrorsDialog } from './SkillErrorsDialog';
import { useSkills } from './useSkills';
import { skillsApi } from '../../data';
import type { SkillDetail, SkillSummary, SkillValidationError } from '../../lib/types';

const meta = {
  title: 'Features/Skills',
  parameters: { layout: 'fullscreen' },
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

function installSkillFixtures() {
  Object.assign(skillsApi, {
    list: async () => skillRows,
    get: async (id: string) => ({ ...skillDetail, ...(skillRows.find((s) => s.id === id) ?? {}) }),
    setEnabled: async (id: string, enabled: boolean) => ({
      ...(skillRows.find((s) => s.id === id) ?? skillRows[0]),
      enabled,
    }),
    upload: async () => skillRows[1],
    replace: async (id: string) => skillRows.find((s) => s.id === id) ?? skillRows[1],
    remove: async () => undefined,
    download: async () => ({ url: 'data:application/zip;base64,UEs=' }),
  });
  useSkills.setState({ skills: [], loading: true, loadError: false, busy: {}, uploading: false });
}

function SkillsHarness({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    installSkillFixtures();
    setReady(true);
  }, []);

  return (
    <MemoryRouter initialEntries={['/settings/skills']}>
      <div className="page" style={{ minHeight: 720, padding: 'var(--space-6)' }}>
        <div className="settings-panel" style={{ maxWidth: 880 }}>
          {ready ? children : null}
        </div>
      </div>
    </MemoryRouter>
  );
}

export const Catalog: Story = {
  render: () => (
    <SkillsHarness>
      <SkillsBody />
    </SkillsHarness>
  ),
};

export const CodeInterpreterGate: Story = {
  render: () => (
    <SkillsHarness>
      <SkillsBody codeInterpreterOff />
    </SkillsHarness>
  ),
};

export const DetailDialog: Story = {
  render: () => (
    <SkillsHarness>
      <SkillDetailDialog
        skill={skillRows[0]}
        onClose={() => {}}
        onToggle={() => {}}
        onReplace={() => {}}
        onDownload={() => {}}
        onDelete={() => {}}
      />
    </SkillsHarness>
  ),
};

export const ValidationDialog: Story = {
  render: () => <SkillErrorsDialog errors={validationErrors} onClose={() => {}} />,
};