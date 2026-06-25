import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../design/icons';
import { Switch } from '../../design/ui';
import { repo } from '../../data';
import { getApiConfig, getTavilyKey, saveTavilyKey } from '../../data/secureStore';
import { detectCapabilities } from '../../ai/capabilities';
import { useUi } from '../../state/store';
import type { CapabilityMatrix, Settings } from '../../lib/types';

type ToolsState = NonNullable<Settings['tools']>;
const DEFAULTS: ToolsState = {
  agenticMode: true,
  webSearch: false,
  codeInterpreter: true,
  fileSearch: false,
  imageAgent: true,
};

interface ToolDef {
  key: keyof ToolsState;
  label: string;
  sub: string;
  icon: string;
  available: (c: CapabilityMatrix) => boolean;
  hint?: string;
}

// Image / code / file search are per-chat capability toggles. Web search is rendered separately
// (see the menu body) because its switch is the presence of a Tavily key (managed in
// Settings -> Tools), not a per-chat capability — but it appears here too so the tool list is
// identical in all places.
const TOOL_DEFS: ToolDef[] = [
  { key: 'imageAgent', label: 'Image generation', sub: 'Create images from chat', icon: 'image', available: () => true },
  {
    key: 'codeInterpreter',
    label: 'Code interpreter',
    sub: 'Run Python for math & data',
    icon: 'code',
    available: (c) => c.codeInterpreter,
    hint: 'Needs a Responses endpoint',
  },
  {
    key: 'fileSearch',
    label: 'File search',
    sub: 'Answer from your documents',
    icon: 'database',
    available: (c) => c.fileSearch,
    hint: 'Needs a Foundry project',
  },
];

const MOCK_CAPS: CapabilityMatrix = {
  chat: true,
  chatStreaming: true,
  vision: true,
  transcribe: true,
  transcribeStreaming: false,
  image: true,
  imageEdit: true,
  tts: true,
  responses: true,
  functions: true,
  codeInterpreter: true,
  webSearch: true,
  fileSearch: true,
};

/** In-composer tool toggles (image / code / web search / file search). Image/code/file are
 *  per-chat capability toggles writing Settings.tools; web search reflects the Tavily key (its
 *  single switch). The composer and Settings are never co-visible, so there is no drift, and the
 *  tool list is identical in both. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState<CapabilityMatrix | null>(null);
  const [tools, setTools] = useState<ToolsState>(DEFAULTS);
  const [tavilyHasKey, setTavilyHasKey] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const mockAi = useUi((s) => s.mockAi);
  const pushToast = useUi((s) => s.pushToast);
  const requestConfirm = useUi((s) => s.requestConfirm);

  useEffect(() => {
    let live = true;
    void (async () => {
      const s = await repo.getSettings();
      if (live && s.tools) setTools(s.tools);
      const key = await getTavilyKey().catch(() => null);
      if (live) setTavilyHasKey(mockAi ? true : !!key);
      if (mockAi) {
        if (live) setCaps(MOCK_CAPS);
        return;
      }
      const c = await getApiConfig();
      if (!live) return;
      if (c) {
        detectCapabilities(c)
          .then((m) => live && setCaps(m))
          .catch(() => undefined);
      }
    })();
    return () => {
      live = false;
    };
  }, [mockAi]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!caps?.responses) return null;

  const activeCount =
    TOOL_DEFS.filter((d) => d.available(caps) && tools[d.key]).length + (tavilyHasKey ? 1 : 0);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 8 });
    setOpen((o) => !o);
  };

  const save = async (next: ToolsState) => {
    setTools(next);
    const s = await repo.getSettings();
    await repo.saveSettings({ ...s, tools: next });
  };

  const toggle = async (d: ToolDef) => {
    if (!caps || !d.available(caps)) return;
    await save({ ...tools, [d.key]: !tools[d.key] });
  };

  // Web search's switch is the Tavily key. Turning it on without a key points to Settings (the
  // composer has no key field); turning it off removes the key (with confirmation).
  const toggleWebSearch = async (v: boolean) => {
    if (v) {
      if (!tavilyHasKey) pushToast('Add a Tavily key in Settings \u2192 Tools to turn on web search', 'info');
      return;
    }
    if (!tavilyHasKey) return;
    const ok = await requestConfirm({
      title: 'Turn off web search',
      message: 'This removes your saved Tavily key. You can add it again anytime.',
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (ok) {
      await saveTavilyKey('');
      setTavilyHasKey(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`composer-tools-btn ${activeCount ? 'is-active' : ''}`}
        aria-label={activeCount ? `Tools — ${activeCount} active` : 'Tools'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tools"
        onClick={openMenu}
      >
        <Icon name="tune" size={20} />
        {activeCount > 0 && <span className="composer-tools-btn__count">{activeCount}</span>}
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={popRef}
            className="tools-pop"
            style={{ left: Math.min(anchor.left, window.innerWidth - 312), bottom: anchor.bottom }}
            role="menu"
            aria-label="Tools"
          >
            <div className="tools-pop__title">Tools</div>
            {TOOL_DEFS.map((d) => {
              const available = d.available(caps);
              const on = available && !!tools[d.key];
              return (
                <Fragment key={d.key}>
                  {/* Web search sits before File search to match the Settings order. */}
                  {d.key === 'fileSearch' && (
                    <div className="tools-pop__row">
                      <span className={`tools-pop__icon ${tavilyHasKey ? 'is-on' : ''}`}>
                        <Icon name="globe" size={18} />
                      </span>
                      <span className="tools-pop__text">
                        <span className="tools-pop__label">Web search</span>
                        <span className="tools-pop__sub">
                          {tavilyHasKey ? 'Search the web and cite sources' : 'Add a Tavily key in Settings'}
                        </span>
                      </span>
                      <Switch checked={tavilyHasKey} onChange={(v) => void toggleWebSearch(v)} label="Web search" />
                    </div>
                  )}
                  <div className="tools-pop__row">
                    <span className={`tools-pop__icon ${on ? 'is-on' : ''}`}>
                      <Icon name={d.icon} size={18} />
                    </span>
                    <span className="tools-pop__text">
                      <span className="tools-pop__label">{d.label}</span>
                      <span className="tools-pop__sub">{available ? d.sub : (d.hint ?? 'Unavailable')}</span>
                    </span>
                    {available ? (
                      <Switch checked={!!tools[d.key]} onChange={() => void toggle(d)} label={d.label} />
                    ) : (
                      <span className="badge">Off</span>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
