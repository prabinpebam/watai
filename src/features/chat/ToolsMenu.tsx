import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../design/icons';
import { Switch } from '../../design/ui';
import { repo } from '../../data';
import { getApiConfig } from '../../data/secureStore';
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

// Web search is intentionally absent here: it is governed solely by the presence of a Tavily
// API key (managed in Settings -> Tools), not a per-chat capability toggle. Keeping it out of
// this menu removes a long-standing conflation with the Foundry server web_search capability.
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

/** In-composer tool toggles (image / code / file search), capability-gated. Edits the global
 *  Settings.tools (the chat composer and the Settings screen are never co-visible, so there is
 *  no drift). Web search is not here — it is governed solely by the Tavily key in Settings. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState<CapabilityMatrix | null>(null);
  const [tools, setTools] = useState<ToolsState>(DEFAULTS);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const mockAi = useUi((s) => s.mockAi);

  useEffect(() => {
    let live = true;
    void (async () => {
      const s = await repo.getSettings();
      if (live && s.tools) setTools(s.tools);
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

  const activeCount = TOOL_DEFS.filter((d) => d.available(caps) && tools[d.key]).length;

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
                <div key={d.key} className="tools-pop__row">
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
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
