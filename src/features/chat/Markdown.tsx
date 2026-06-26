import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { Icon } from '../../design/icons';
import { Lightbox } from './Lightbox';

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in (node as any)) {
    return extractText((node as any).props.children);
  }
  return '';
}

/** Which live preview, if any, a fenced block supports. SVG is detected from the language or a
 *  leading `<svg>`; HTML from the language only (to avoid false positives on arbitrary markup). */
function previewKind(lang: string | undefined, code: string): 'svg' | 'html' | null {
  const l = (lang || '').toLowerCase();
  if (l === 'svg') return 'svg';
  if (l === 'html' || l === 'htm' || l === 'xhtml') return 'html';
  if ((l === '' || l === 'xml' || l === 'markup') && /^\s*<svg[\s>]/i.test(code)) return 'svg';
  return null;
}

/** ChatGPT-style fenced code block: header [lang · preview? · wrap · copy] + scrollable body.
 *  SVG/HTML blocks can toggle a live, sandboxed preview. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [preview, setPreview] = useState(false);

  const codeEl: any = Array.isArray(children) ? children[0] : children;
  const codeProps = codeEl?.props ?? {};
  const className: string = codeProps.className || '';
  const lang = /language-([\w-]+)/.exec(className)?.[1];
  const code = extractText(codeProps.children);
  const kind = previewKind(lang, code);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="code-block">
      <div className="code-block__bar">
        <span className="code-block__lang">
          <Icon name="code" size={13} />
          {lang || 'text'}
        </span>
        <div className="code-block__actions">
          {kind && (
            <button
              type="button"
              className={`code-block__btn ${preview ? 'code-block__btn--on' : ''}`}
              onClick={() => setPreview((p) => !p)}
              title={preview ? 'Show code' : `Preview ${kind.toUpperCase()}`}
              aria-pressed={preview}
            >
              <Icon name={preview ? 'code' : 'eye'} size={14} />
              <span>{preview ? 'Code' : 'Preview'}</span>
            </button>
          )}
          {!preview && (
            <button
              type="button"
              className={`code-block__btn ${wrap ? 'code-block__btn--on' : ''}`}
              onClick={() => setWrap((w) => !w)}
              title={wrap ? 'Disable soft wrap' : 'Soft wrap'}
              aria-pressed={wrap}
            >
              <Icon name="wrap" size={14} />
            </button>
          )}
          <button type="button" className="code-block__btn" onClick={copy} title="Copy code">
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      {preview && kind === 'svg' ? (
        <div className="code-block__preview">
          <img
            className="code-block__svg"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(code)}`}
            alt="SVG preview"
          />
        </div>
      ) : preview && kind === 'html' ? (
        // Sandboxed WITHOUT allow-same-origin: scripts run in an opaque origin and cannot reach the
        // app's DOM, cookies, or storage — a safe live preview of generated/untrusted HTML.
        <iframe className="code-block__html" title="HTML preview" sandbox="allow-scripts" srcDoc={code} />
      ) : (
        <pre className={`code-block__pre ${wrap ? 'code-block__pre--wrap' : ''}`}>{children}</pre>
      )}
    </div>
  );
}

interface MarkdownProps {
  content: string;
}

/** Allow safe links + inline data-image URLs; block javascript: and other schemes. */
function safeUrl(url: string): string {
  if (/^(https?:|mailto:|tel:|#|\/|\.)/i.test(url)) return url;
  if (/^data:image\//i.test(url)) return url;
  return '';
}

/** Normalize the LaTeX delimiters LLMs commonly emit (`\(...\)`, `\[...\]`) to the `$`/`$$`
 *  that remark-math understands, without rewriting fenced code blocks or inline code spans. */
function normalizeMath(src: string): string {
  const blocks = src.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return blocks
    .map((block, bi) => {
      if (bi % 2 === 1) return block; // fenced code — leave untouched
      return block
        .split(/(`[^`]*`)/g)
        .map((seg, si) =>
          si % 2 === 1
            ? seg // inline code — leave untouched
            : seg
                .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `$$${body}$$`)
                .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`),
        )
        .join('');
    })
    .join('');
}

export const Markdown = memo(function Markdown({ content }: MarkdownProps) {
  const [light, setLight] = useState<{ src: string; alt: string } | null>(null);

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        urlTransform={safeUrl}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
          img: ({ src, alt }) =>
            typeof src === 'string' ? (
              <img
                className="md-img"
                src={src}
                alt={alt || ''}
                loading="lazy"
                onClick={() => setLight({ src, alt: alt || '' })}
              />
            ) : null,
        }}
      >
        {normalizeMath(content)}
      </ReactMarkdown>

      {light && <Lightbox src={light.src} alt={light.alt} onClose={() => setLight(null)} />}
    </div>
  );
});
