import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { AttachmentList } from './Attachments';
import { AssistantMessage, UserMessage } from './Message';
import { ChatView } from './ChatView';
import { Composer } from './Composer';
import { Lightbox } from './Lightbox';
import { Markdown } from './Markdown';
import { SourcePane } from './SourcePane';
import { ThreadFilesPane } from './ThreadFilesPane';
import { ToolsMenu } from './ToolsMenu';
import { cloudApi, repo } from '../../data';
import { useUi } from '../../state/store';
import type { Artifact, Attachment, Citation, ImageRef, Message, Thread, ThreadFile } from '../../lib/types';

const meta = {
  title: 'Features/Chat',
  parameters: { layout: 'fullscreen', frame: 'surface', route: '/c/story-thread' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const userMessage: Message = {
  id: 'u1',
  threadId: 't1',
  role: 'user',
  content: '/pdf Create a worksheet from this file',
  status: 'complete',
  createdAt: new Date().toISOString(),
};

const assistantMessage: Message = {
  id: 'a1',
  threadId: 't1',
  role: 'assistant',
  content: 'Done — the PDF is ready as an attachment below.',
  status: 'complete',
  createdAt: new Date().toISOString(),
  toolCalls: [
    { id: 'w1', kind: 'web_search', name: 'web_search', status: 'done', summary: 'Search sources' },
    { id: 'c1', kind: 'code_interpreter', name: 'code_interpreter', status: 'done', summary: 'Create PDF', resultPreview: 'wrote /mnt/data/worksheet.pdf' },
  ],
};

const pdfAttachment: Attachment = {
  id: 'p1',
  kind: 'file',
  mime: 'application/pdf',
  bytes: 32000,
  name: 'worksheet.pdf',
  blobPath: 'data:application/pdf;base64,JVBERi0xLjQKJQ==',
};

const pdfArtifact: Artifact = {
  id: 'p1',
  name: 'worksheet.pdf',
  mime: 'application/pdf',
  kind: 'pdf',
  bytes: 32000,
  blobPath: 'data:application/pdf;base64,JVBERi0xLjQKJQ==',
  createdAt: new Date().toISOString(),
};

const storyImages: ImageRef[] = [
  {
    id: 'img-a',
    blobPath: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" fill="black"/><text x="160" y="118" text-anchor="middle" font-size="26" fill="white">A</text></svg>',
    prompt: 'A compact storybook preview with a carefully bounded prompt that can expand when the user wants to inspect the full generation request.',
    size: '1024x1024',
    outputFormat: 'png',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'img-b',
    blobPath: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220"><rect width="320" height="220" fill="%232f6feb"/><text x="160" y="118" text-anchor="middle" font-size="26" fill="white">B</text></svg>',
    prompt: 'Second generated image in the thread.',
    size: '1024x1024',
    outputFormat: 'png',
    createdAt: new Date().toISOString(),
  },
];

const citations: Citation[] = [
  {
    title: 'PDF accessibility checklist',
    url: 'https://example.com/pdf-accessibility',
    content: 'Use semantic headings, tagged tables, and readable contrast in generated PDFs.',
  },
  {
    filename: 'lesson-plan.pdf',
    source: 'file',
    content: 'The worksheet should include two worked examples before the practice problems.',
  },
];

const threadFiles: ThreadFile[] = [
  {
    fileId: 'doc1',
    name: 'source-notes.pdf',
    bytes: 184000,
    status: 'ready',
    createdAt: new Date().toISOString(),
    kind: 'document',
    blobPath: 'story/source-notes.pdf',
    mime: 'application/pdf',
  },
  {
    fileId: 'artifact1',
    name: 'worksheet.pdf',
    bytes: 32000,
    status: 'ready',
    createdAt: new Date().toISOString(),
    kind: 'artifact',
    blobPath: 'story/worksheet.pdf',
    mime: 'application/pdf',
  },
];

const storyThread: Thread = {
  id: 'story-thread',
  title: 'Storybook thread',
  pinned: false,
  archived: false,
  temporary: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messageCount: 2,
  files: threadFiles,
};

function installThreadFileFixtures() {
  Object.assign(repo, {
    getThread: async () => storyThread,
    listMessages: async () => [{ ...userMessage, attachments: [pdfAttachment] }],
    resolveAssetUrl: async () => pdfAttachment.blobPath ?? '',
  });
  Object.assign(cloudApi, {
    listThreadFiles: async () => threadFiles,
    uploadThreadFile: async () => undefined,
    deleteThreadFile: async () => undefined,
  });
}

export const Messages: Story = {
  render: () => (
    <div className="chat__column" style={{ maxWidth: 720 }}>
      <UserMessage message={userMessage} />
      <AssistantMessage message={{ ...assistantMessage, artifacts: [pdfArtifact] }} streaming={false} onRegenerate={() => {}} />
    </div>
  ),
};

export const ComposerSurface: Story = {
  render: () => (
    <div className="storybook-row-frame">
      <Composer value="/pdf Make this into a polished PDF" onChange={() => {}} onSend={() => {}} streaming={false} onStop={() => {}} />
    </div>
  ),
};

export const AttachmentsAndTools: Story = {
  render: () => (
    <div className="col storybook-row-frame" style={{ gap: 'var(--space-5)' }}>
      <ToolsMenu />
      <AttachmentList attachments={[pdfAttachment]} />
    </div>
  ),
};

export const ThreadFilesPanel: Story = {
  render: function ThreadFilesPanelStory() {
    installThreadFileFixtures();
    useUi.setState({ filesPane: 'story-thread', sourcePane: null });
    return <ThreadFilesPane />;
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const SourcesPanel: Story = {
  render: function SourcesPanelStory() {
    useUi.setState({ sourcePane: { citations, index: 0 }, filesPane: null });
    return <SourcePane />;
  },
};

export const MarkdownContent: Story = {
  render: () => (
    <div className="msg msg--assistant storybook-row-frame">
      <div className="msg__bubble">
        <Markdown
          content={[
            'Here is a compact summary with math $a^2 + b^2 = c^2$ and a table.',
            '',
            '| Item | Status |',
            '| --- | --- |',
            '| PDF artifact | Ready |',
            '| Reference files | Hidden |',
            '',
            '```ts',
            "const artifact = 'worksheet.pdf';",
            '```',
          ].join('\n')}
        />
      </div>
    </div>
  ),
};

export const ImageLightbox: Story = {
  render: function ImageLightboxStory() {
    const [index, setIndex] = useState(0);
    const images = storyImages.map((image) => ({ image, url: image.blobPath! }));
    const current = images[index];
    return (
      <Lightbox
        src={current.url}
        alt={current.image.prompt}
        prompt={current.image.prompt}
        onClose={() => {}}
        onDownload={() => {}}
        images={images}
        currentIndex={index}
        onSelect={(item) => setIndex(Math.max(0, images.findIndex((candidate) => candidate.image.id === item.image.id)))}
      />
    );
  },
  parameters: { frame: 'none' },
};

export const PromptMinimapThread: Story = {
  render: () => <ChatView threadId="story-thread" />,
  parameters: { frame: 'app', route: '/c/story-thread' },
};

export const PromptMinimapWithFilesPane: Story = {
  render: function PromptMinimapWithFilesPaneStory() {
    useEffect(() => {
      useUi.setState({ filesPane: 'story-thread', sourcePane: null });
    }, []);
    return <ChatView threadId="story-thread" />;
  },
  parameters: { frame: 'app', route: '/c/story-thread' },
};