import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserMessage, AssistantMessage } from '../features/chat/Message';
import { IconButton } from '../design/ui';
import type { Attachment, ImageRef, Message } from '../lib/types';

// A dev-only showcase that renders the REAL chat components (not screenshots) across every
// state, so the chat UI can be reviewed in one place. Reached at #/dev/gallery in dev builds
// only; this whole module is tree-shaken from production (see App.tsx).

const NOW = new Date().toISOString();
let seq = 0;
function msg(p: Partial<Message> & Pick<Message, 'role' | 'content' | 'status'>): Message {
  return { id: `gal-${++seq}`, threadId: 'gallery', createdAt: NOW, ...p };
}

function svgDataUrl(label: string, c1: string, c2: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${c1}'/><stop offset='1' stop-color='${c2}'/>` +
    `</linearGradient></defs>` +
    `<rect width='640' height='400' fill='url(#g)'/>` +
    `<text x='50%' y='50%' fill='white' font-family='sans-serif' font-size='30' ` +
    `text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const imageAttachment: Attachment = {
  id: 'att-img',
  kind: 'image',
  blobPath: svgDataUrl('mountains.png', '#6d8bff', '#9b5cff'),
  mime: 'image/svg+xml',
  bytes: 184320,
  name: 'mountains.png',
  width: 640,
  height: 400,
};

const csvAttachment: Attachment = {
  id: 'att-csv',
  kind: 'file',
  blobPath: 'data:text/csv;base64,',
  mime: 'text/csv',
  bytes: 20480,
  name: 'quarterly-data.csv',
};

const genImages: ImageRef[] = [
  {
    id: 'img-1',
    blobPath: svgDataUrl('Generated render', '#0ea5e9', '#6d28d9'),
    prompt: 'a watercolor fox in a misty forest',
    size: '1024x1024',
    outputFormat: 'png',
    createdAt: NOW,
  },
];

const mdShowcase =
  `# Formatting showcase\n\n` +
  `Exercises **every** renderer the chat supports.\n\n` +
  `## Text & emphasis\n` +
  `**Bold**, *italic*, ***both***, ~~strikethrough~~, \`inline code\`, and a safe ` +
  `[link](https://openai.com).\n\n` +
  `> Blockquotes are great for asides and callouts.\n\n` +
  `## Lists\n` +
  `- Fruits\n  - Apple\n  - Banana\n- Vegetables\n  - Carrot\n\n` +
  `1. First\n2. Second\n3. Third\n\n` +
  `- [x] Render markdown\n- [x] Highlight code\n- [ ] Ship to production\n\n` +
  `## Table\n` +
  `| Feature | Status | Notes |\n| --- | :---: | --- |\n` +
  `| Streaming | yes | token-by-token |\n| Code copy | yes | per block |\n| Math | yes | KaTeX |\n\n` +
  `## Code\n` +
  `\`\`\`ts\ntype Result<T> = { ok: true; value: T } | { ok: false; error: string };\n\`\`\`\n\n` +
  `\`\`\`python\ndef fib(n: int):\n    a, b = 0, 1\n    for _ in range(n):\n        yield a\n        a, b = b, a + b\n\`\`\`\n\n` +
  `\`\`\`bash\nnpm install && npm run build\n\`\`\`\n\n` +
  `## Math\n` +
  `Inline: the area of a circle is $A = \\pi r^2$.\n\n` +
  `$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$\n\n` +
  `## Image\n` +
  `![Gradient sample](${svgDataUrl('Inline markdown image', '#22c55e', '#0ea5e9')})\n\n` +
  `---\nThat's the full set.`;

const longText =
  'I have a multi-paragraph question. First, how does the streaming work end to end? ' +
  'Second, what happens when the connection drops midway? And finally, can I resume a ' +
  'response that was interrupted, or do I have to regenerate it from scratch every time?';

const noop = () => undefined;

interface Section {
  id: string;
  title: string;
  hint?: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'user',
    title: 'User messages',
    hint: 'Plain text, with attachments (image + file), and a long multi-line message.',
    body: (
      <>
        <UserMessage message={msg({ role: 'user', content: 'How do I center a div?', status: 'complete' })} />
        <UserMessage
          message={msg({
            role: 'user',
            content: 'Here are the files I mentioned.',
            status: 'complete',
            attachments: [imageAttachment, csvAttachment],
          })}
        />
        <UserMessage message={msg({ role: 'user', content: longText, status: 'complete' })} />
      </>
    ),
  },
  {
    id: 'thinking',
    title: 'Assistant — thinking & streaming',
    hint: 'Empty + streaming shows the typing dots; partial + streaming shows the typing caret.',
    body: (
      <>
        <AssistantMessage message={msg({ role: 'assistant', content: '', status: 'streaming' })} streaming onRegenerate={noop} />
        <AssistantMessage
          message={msg({ role: 'assistant', content: 'Sure — a black hole is a region of spacetime where gravity is so strong that', status: 'streaming' })}
          streaming
          onRegenerate={noop}
        />
      </>
    ),
  },
  {
    id: 'complete',
    title: 'Assistant — complete answer (all markdown renderers)',
    hint: 'Headings, emphasis, lists, task lists, tables, code highlighting, KaTeX math, images, blockquotes. Hover for the action bar.',
    body: (
      <AssistantMessage
        message={msg({ role: 'assistant', model: 'gpt-5.4', content: mdShowcase, status: 'complete' })}
        streaming={false}
        onRegenerate={noop}
      />
    ),
  },
  {
    id: 'images',
    title: 'Assistant — generated images',
    hint: 'In-chat image generation output (download / expand controls).',
    body: (
      <AssistantMessage
        message={msg({ role: 'assistant', content: 'Here is the fox you asked for:', status: 'complete', images: genImages })}
        streaming={false}
        onRegenerate={noop}
      />
    ),
  },
  {
    id: 'generating',
    title: 'Assistant — generating image (animated placeholder)',
    hint: 'Subtle animated gradient sized to the requested aspect ratio; swapped for the image when ready. Shown for square, portrait, and landscape.',
    body: (
      <>
        <AssistantMessage
          message={msg({ role: 'assistant', content: 'Sure — generating that now.', status: 'streaming', pendingImages: [{ id: 'p-sq', size: '1024x1024' }] })}
          streaming
          onRegenerate={noop}
        />
        <AssistantMessage
          message={msg({ role: 'assistant', content: '', status: 'streaming', pendingImages: [{ id: 'p-port', size: '1024x1536' }] })}
          streaming
          onRegenerate={noop}
        />
        <AssistantMessage
          message={msg({ role: 'assistant', content: '', status: 'streaming', pendingImages: [{ id: 'p-land', size: '1536x1024' }] })}
          streaming
          onRegenerate={noop}
        />
      </>
    ),
  },
  {
    id: 'errors',
    title: 'Assistant — error states',
    hint: 'The danger alert for a few representative AiError codes.',
    body: (
      <>
        <AssistantMessage
          message={msg({ role: 'assistant', content: '', status: 'error', error: { code: 'bad_request', message: 'The request was invalid.' } })}
          streaming={false}
          onRegenerate={noop}
        />
        <AssistantMessage
          message={msg({ role: 'assistant', content: '', status: 'error', error: { code: 'rate_limited', message: 'Rate limit reached. Try again shortly.' } })}
          streaming={false}
          onRegenerate={noop}
        />
        <AssistantMessage
          message={msg({ role: 'assistant', content: '', status: 'error', error: { code: 'content_filtered', message: 'The response was filtered by content policy.' } })}
          streaming={false}
          onRegenerate={noop}
        />
      </>
    ),
  },
  {
    id: 'interrupted',
    title: 'Assistant — interrupted (stopped)',
    hint: 'Partial content kept, with the "Stopped." marker.',
    body: (
      <AssistantMessage
        message={msg({ role: 'assistant', content: 'I was explaining how diffusion models gradually denoise an image, but', status: 'interrupted' })}
        streaming={false}
        onRegenerate={noop}
      />
    ),
  },
];

export default function ChatGallery() {
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="appbar">
        <IconButton name="close" label="Back to app" onClick={() => navigate('/')} />
        <div className="appbar__title">
          Chat components{' '}
          <span
            style={{
              fontSize: 11,
              fontWeight: 'var(--font-weight-semibold)',
              letterSpacing: 0.5,
              padding: '2px 6px',
              marginLeft: 8,
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-surface-3)',
              color: 'var(--color-text-secondary)',
              verticalAlign: 'middle',
            }}
          >
            DEV
          </span>
        </div>
        <div style={{ width: 40 }} />
      </div>

      <div className="chat__scroll">
        {SECTIONS.map((s) => (
          <div className="chat__column" key={s.id}>
            <div
              style={{
                margin: '28px 0 8px',
                paddingBottom: 6,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <div className="text-strong" style={{ fontSize: 'var(--text-callout-size)' }}>{s.title}</div>
              {s.hint && (
                <div className="muted" style={{ fontSize: 'var(--text-caption-size)', marginTop: 2 }}>
                  {s.hint}
                </div>
              )}
            </div>
            {s.body}
          </div>
        ))}
        <div style={{ height: 64 }} />
      </div>
    </div>
  );
}
