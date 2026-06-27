import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../design/icons';
import { Switch } from '../../design/ui';
import { useDismiss } from '../../lib/hooks';
import { repo, cloudApi } from '../../data';
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

/** In-composer tool toggles (image / code / web search / file search). Image/code/file are
 *  per-chat capability toggles writing Settings.tools; web search reflects the Tavily key (its
 *  single switch). The composer and Settings are never co-visible, so there is no drift, and the
 *  tool list is identical in both. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState<CapabilityMatrix | null>(null);
  const [tools, setTools] = useState<ToolsState>(DEFAULTS);
  const [tavilyHasKey, setTavilyHasKey] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => {
    let live = true;
    void (async () => {
      const s = await repo.getSettings();
      if (live && s.tools) setTools(s.tools);
      const status = await cloudApi.getCredentialStatus().catch(() => null);
      if (!live) return;
      setTavilyHasKey(!!status?.tavilyConfigured);
      const cc = status?.capabilities;
      setCaps({
        chat: cc?.chat ?? false,
        chatStreaming: true,
        vision: true,
        transcribe: cc?.transcribe ?? false,
        transcribeStreaming: false,
        image: cc?.image ?? false,
        imageEdit: cc?.image ?? false,
        tts: cc?.tts ?? false,
        responses: cc?.agentic ?? false,
        functions: cc?.agentic ?? false,
        codeInterpreter: cc?.codeInterpreter ?? false,
        webSearch: cc?.webSearch ?? false,
        fileSearch: cc?.fileSearch ?? false,
      });
    })();
    return () => {
      live = false;
    };
  }, []);

  useDismiss(open, () => setOpen(false), [popRef, btnRef]);

  if (!caps?.responses) return null;

  const activeCount =
    TOOL_DEFS.filter((d) => d.available(caps) && tools[d.key]).length + (tavilyHasKey ? 1 : 0);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.bottom + 8 });
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

  // Web search reflects the vault Tavily key, which is managed in Settings (the composer has no key
  // field). The switch here just points the user there.
  const toggleWebSearch = async (v: boolean) => {
    if (v && !tavilyHasKey) {
      pushToast('Add a web-search (Tavily) key in Settings to turn on web search', 'info');
    } else if (!v && tavilyHasKey) {
      pushToast('Manage the web-search key in Settings', 'info');
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
            style={{ left: Math.min(anchor.left, window.innerWidth - 312), top: anchor.top }}
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
