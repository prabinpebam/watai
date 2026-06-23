import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import 'katex/dist/katex.min.css';
import { Icon, langGlyph } from '../../design/icons';
import { Lightbox } from './Lightbox';

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in (node as any)) {
    return extractText((node as any).props.children);
  }
  return '';
}

/** ChatGPT-style fenced code block: header [lang · wrap · copy] + scrollable body. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);

  const codeEl: any = Array.isArray(children) ? children[0] : children;
  const codeProps = codeEl?.props ?? {};
  const className: string = codeProps.className || '';
  const lang = /language-([\w-]+)/.exec(className)?.[1];
  const glyph = langGlyph(lang);

  const copy = () => {
    navigator.clipboard.writeText(extractText(codeProps.children)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="code-block">
      <div className="code-block__bar">
        <span className="code-block__lang">
          {glyph ? <FontAwesomeIcon icon={glyph} /> : <Icon name="code" size={13} />}
          {lang || 'text'}
        </span>
        <div className="code-block__actions">
          <button
            type="button"
            className={`code-block__btn ${wrap ? 'code-block__btn--on' : ''}`}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? 'Disable soft wrap' : 'Soft wrap'}
            aria-pressed={wrap}
          >
            <Icon name="wrap" size={14} />
          </button>
          <button type="button" className="code-block__btn" onClick={copy} title="Copy code">
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <pre className={`code-block__pre ${wrap ? 'code-block__pre--wrap' : ''}`}>{children}</pre>
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
        {content}
      </ReactMarkdown>

      {light && <Lightbox src={light.src} alt={light.alt} onClose={() => setLight(null)} />}
    </div>
  );
});
