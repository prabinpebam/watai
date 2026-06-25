import { useEffect, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from './useSettings';
import { Button, Field, IconButton, Segmented, Switch, TextAreaField } from '../../design/ui';
import { Icon } from '../../design/icons';
import { Logo } from '../../design/Logo';
import { ConfirmDialog } from '../../design/overlays';
import { useUi } from '../../state/store';
import { useIsExpanded } from '../../lib/hooks';
import { formatBytes } from '../../lib/format';
import { repo, cloudApi } from '../../data';
import { kvGet } from '../../data/db';
import { signOut, getSignedInAccount } from '../../auth/cloudAuth';
import { useMe } from '../../auth/access';
import type { InviteRecord, MeInfo } from '../../data/cloud/types';
import {
  getApiConfig,
  saveApiConfig,
  saveApiKey,
  getApiKey,
  getTavilyKey,
  saveTavilyKey,
  normalizeBaseUrl,
} from '../../data/secureStore';
import { detectCapabilities, endpointKind, resetAgenticCache } from '../../ai/capabilities';
import { isFoundryHost } from '../../ai/http';
import {
  indexFileIntoStore,
  listStoreFiles,
  removeFileFromStore,
  deleteVectorStore,
} from '../../ai/fileSearch';
import { tavilyUsage, tavilySearch } from '../../ai/tavily';
import { DEFAULT_SETTINGS } from '../../lib/types';
import type {
  ApiConfig,
  CapabilityMatrix,
  ImageRef,
  Settings as SettingsModel,
  TextScale,
} from '../../lib/types';

const APP_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Information architecture: one registry drives the desktop rail, the mobile
// hub, and the section headers so labels/order/grouping stay consistent.
// ---------------------------------------------------------------------------
interface SectionMeta {
  id: string;
  label: string;
  icon: string;
  sub: string;
  adminOnly?: boolean;
}

const SECTIONS: Record<string, SectionMeta> = {
  account: { id: 'account', label: 'Account', icon: 'user', sub: 'Profile, storage, and session' },
  models: { id: 'models', label: 'Models & keys', icon: 'key', sub: 'Endpoint, deployments, and defaults' },
  personalization: {
    id: 'personalization',
    label: 'Personalization',
    icon: 'sparkle',
    sub: 'Custom instructions and memory',
  },
  voice: { id: 'voice', label: 'Voice', icon: 'mic', sub: 'Dictation and read-aloud' },
  tools: { id: 'tools', label: 'Tools', icon: 'code', sub: 'Web search, code, files, and functions' },
  appearance: { id: 'appearance', label: 'Appearance', icon: 'palette', sub: 'Theme, text size, and density' },
  data: { id: 'data', label: 'Data controls', icon: 'database', sub: 'Sync, export, retention, and deletion' },
  invites: { id: 'invites', label: 'Invites', icon: 'user-add', sub: 'Manage who can sign in', adminOnly: true },
  about: { id: 'about', label: 'About', icon: 'info', sub: 'Version and links' },
};

const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Assistant', ids: ['models', 'tools', 'personalization', 'voice'] },
  { label: 'App', ids: ['appearance', 'data', 'about'] },
  { label: 'Admin', ids: ['invites'] },
];

/** Shared, single-source state handed to every section so the rail summaries
 *  and the editors never drift apart. */
interface SettingsCtx {
  settings: SettingsModel;
  setSettings: (s: SettingsModel) => Promise<void> | void;
  loaded: boolean;
  account: { name: string | null; email: string | null };
  me: MeInfo | null;
  stats: UsageStats;
  chatModel: string | null;
  onModelSaved: (model: string) => void;
}

interface UsageStats {
  bytes: number | null;
  chats: number | null;
  images: number | null;
}

// ---- Inline summaries: surface the current value next to each section ----
function summaryFor(id: string, ctx: SettingsCtx): string {
  const s = ctx.settings;
  switch (id) {
    case 'account':
      return ctx.account.email ?? SECTIONS.account.sub;
    case 'models':
      return ctx.chatModel || SECTIONS.models.sub;
    case 'personalization':
      return s.personalization.memoryEnabled ? 'Memory on' : 'Memory off';
    case 'voice':
      return `${s.voice.autoSend ? 'Auto-send on' : 'Auto-send off'} · ${s.voice.rate.toFixed(1)}×`;
    case 'tools': {
      const tl = s.tools;
      if (!tl?.agenticMode) return 'Off';
      const on = [tl.webSearch && 'Web', tl.codeInterpreter && 'Code', tl.fileSearch && 'Files'].filter(
        Boolean,
      );
      return on.length ? on.join(' · ') : 'Functions';
    }
    case 'appearance':
      return appearanceSummary(s.appearance);
    case 'data':
      return dataSummary(s.data);
    case 'about':
      return `Version ${APP_VERSION}`;
    default:
      return SECTIONS[id]?.sub ?? '';
  }
}

function appearanceSummary(a: SettingsModel['appearance']): string {
  const theme = a.theme === 'system' ? 'System' : a.theme === 'dark' ? 'Dark' : 'Light';
  const size =
    a.textScale === 0.9 ? 'Small' : a.textScale === 1.1 ? 'Large' : a.textScale === 1.25 ? 'XL' : 'Default';
  return `${theme} · ${size}`;
}

function dataSummary(d: SettingsModel['data']): string {
  const ret =
    d.retention === 'forever' ? 'Keep forever' : `Keep ${d.retention === '30d' ? '30' : '90'} days`;
  return `${d.sync ? 'Synced' : 'Local only'} · ${ret}`;
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------
function useCloudAccount(): { name: string | null; email: string | null } {
  const [acc, setAcc] = useState<{ name: string | null; email: string | null }>({ name: null, email: null });
  useEffect(() => {
    getSignedInAccount()
      .then((a) => setAcc({ name: a?.name ?? null, email: a?.username ?? null }))
      .catch(() => undefined);
  }, []);
  return acc;
}

function useUsageStats(): UsageStats {
  const [stats, setStats] = useState<UsageStats>({ bytes: null, chats: null, images: null });
  useEffect(() => {
    let live = true;
    void (async () => {
      const threads = await repo.listThreads({ includeArchived: true }).catch(() => []);
      const images = (await kvGet<ImageRef[]>('images').catch(() => undefined)) ?? [];
      let bytes: number | null = null;
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate().catch(() => undefined);
        bytes = est?.usage ?? null;
      }
      if (live) setStats({ bytes, chats: threads.length, images: images.length });
    })();
    return () => {
      live = false;
    };
  }, []);
  return stats;
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="appbar">
      <IconButton name="chevron-left" label="Back" onClick={onBack} />
      <div className="appbar__title">{title}</div>
      <div style={{ width: 40 }} />
    </div>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const { section } = useParams();
  const expanded = useIsExpanded();
  const me = useMe();
  const account = useCloudAccount();
  const stats = useUsageStats();
  const { settings, setSettings, loaded } = useSettings();
  const [chatModel, setChatModel] = useState<string | null>(null);
  useEffect(() => {
    getApiConfig()
      .then((c) => c && setChatModel(c.models.chat))
      .catch(() => undefined);
  }, []);

  const ctx: SettingsCtx = {
    settings,
    setSettings,
    loaded,
    account,
    me,
    stats,
    chatModel,
    onModelSaved: setChatModel,
  };

  const current = section && SECTIONS[section] ? section : null;

  if (expanded) {
    return (
      <SettingsDesktop active={current ?? 'account'} ctx={ctx} onSelect={(id) => navigate(`/settings/${id}`)} />
    );
  }

  if (!current) {
    return <SettingsHub ctx={ctx} onOpen={(id) => navigate(`/settings/${id}`)} onClose={() => navigate(-1)} />;
  }

  return (
    <Section id={current} onBack={() => navigate('/settings')}>
      <SectionBody id={current} ctx={ctx} />
    </Section>
  );
}

// Visible groups, with the Admin group hidden from non-admins.
function visibleGroups(me: MeInfo | null): { label: string; ids: string[] }[] {
  return GROUPS.map((g) => ({
    label: g.label,
    ids: g.ids.filter((id) => !SECTIONS[id]?.adminOnly || me?.isAdmin),
  })).filter((g) => g.ids.length > 0);
}

// ---------------------------------------------------------------------------
// Desktop (>= 1024px): persistent nav rail + detail pane — no drill-in/out.
// ---------------------------------------------------------------------------
function SettingsDesktop({
  active,
  ctx,
  onSelect,
}: {
  active: string;
  ctx: SettingsCtx;
  onSelect: (id: string) => void;
}) {
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  return (
    <>
      <div className="appbar">
        <IconButton name="sidebar" label="Toggle sidebar" onClick={() => toggleSidebar()} />
        <div className="appbar__title" style={{ textAlign: 'left' }}>
          Settings
        </div>
        <div style={{ width: 40 }} />
      </div>
      <div className="settings-shell">
        <nav className="settings-rail" aria-label="Settings sections">
          <AccountMiniCard ctx={ctx} active={active === 'account'} onClick={() => onSelect('account')} />
          {visibleGroups(ctx.me).map((g) => (
            <div key={g.label} className="settings-rail__group">
              <div className="settings-rail__label">{g.label}</div>
              {g.ids.map((id) => {
                const meta = SECTIONS[id];
                return (
                  <button
                    key={id}
                    className={`settings-rail__item ${active === id ? 'is-active' : ''}`}
                    aria-current={active === id ? 'page' : undefined}
                    onClick={() => onSelect(id)}
                  >
                    <span className="settings-rail__icon">
                      <Icon name={meta.icon} size={20} />
                    </span>
                    <span className="settings-rail__text">
                      <span className="settings-rail__title">{meta.label}</span>
                      <span className="settings-rail__sub">{summaryFor(id, ctx)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <div className="page__inner">
            <SectionHeader id={active} />
            <SectionBody id={active} ctx={ctx} />
          </div>
        </div>
      </div>
    </>
  );
}

function AccountMiniCard({ ctx, active, onClick }: { ctx: SettingsCtx; active: boolean; onClick: () => void }) {
  const { account, me } = ctx;
  const name = account.name ?? account.email ?? 'Your account';
  return (
    <button className={`account-card ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="avatar" style={{ width: 44, height: 44, fontSize: 18 }}>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="account-card__body">
        <span className="account-card__name">{name}</span>
        <span className="account-card__email">{me?.isAdmin ? 'Admin' : 'Member'} · Cloud account</span>
      </span>
    </button>
  );
}

// Detail-pane title block (desktop) — gives each section a heading + description.
function SectionHeader({ id }: { id: string }) {
  const meta = SECTIONS[id];
  if (!meta) return null;
  return (
    <div className="settings-head">
      <div className="settings-head__title">{meta.label}</div>
      <div className="settings-head__sub">{meta.sub}</div>
    </div>
  );
}

// Maps a section id to its body. Bodies render cards only (no chrome) so they
// work identically inside the desktop detail pane and the mobile section page.
function SectionBody({ id, ctx }: { id: string; ctx: SettingsCtx }) {
  switch (id) {
    case 'account':
      return <AccountBody ctx={ctx} />;
    case 'models':
      return <ModelsBody ctx={ctx} />;
    case 'personalization':
      return <PersonalizationBody ctx={ctx} />;
    case 'voice':
      return <VoiceBody ctx={ctx} />;
    case 'tools':
      return <ToolsBody ctx={ctx} />;
    case 'appearance':
      return <AppearanceBody ctx={ctx} />;
    case 'data':
      return <DataBody ctx={ctx} />;
    case 'invites':
      return <InvitesBody />;
    case 'about':
      return <AboutBody />;
    default:
      return null;
  }
}

function SettingsHub({
  ctx,
  onOpen,
  onClose,
}: {
  ctx: SettingsCtx;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { account, me } = ctx;
  const name = account.name ?? account.email ?? 'Your account';
  return (
    <>
      <Header title="Settings" onBack={onClose} />
      <div className="page">
        <div className="page__inner">
          <button className="account-hero" onClick={() => onOpen('account')}>
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span className="account-hero__body">
              <span className="account-hero__name">{name}</span>
              <span className="account-hero__email">{account.email ?? 'Cloud account'}</span>
              <span className="profile-hero__badges">
                <span className={`badge ${me?.isAdmin ? 'badge--accent' : ''}`}>
                  {me?.isAdmin ? 'Admin' : 'Member'}
                </span>
              </span>
            </span>
            <Icon name="chevron-right" size={18} className="muted" />
          </button>

          {visibleGroups(me).map((g) => (
            <div key={g.label} className="settings-group">
              <div className="settings-group__label">{g.label}</div>
              <div className="settings-card">
                {g.ids.map((id) => {
                  const meta = SECTIONS[id];
                  return (
                    <button key={id} className="setting-row" onClick={() => onOpen(id)}>
                      <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
                        <Icon name={meta.icon} size={18} />
                      </span>
                      <div className="setting-row__body">
                        <div className="setting-row__title">{meta.label}</div>
                        <div className="setting-row__sub">{summaryFor(id, ctx)}</div>
                      </div>
                      <Icon name="chevron-right" size={18} className="muted" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Section({ id, onBack, children }: { id: string; onBack: () => void; children: React.ReactNode }) {
  const meta = SECTIONS[id];
  return (
    <>
      <Header title={meta?.label ?? 'Settings'} onBack={onBack} />
      <div className="page">
        <div className="page__inner">
          {meta?.sub && (
            <p className="muted" style={{ marginTop: 0, marginBottom: 'var(--space-5)' }}>
              {meta.sub}
            </p>
          )}
          {children}
        </div>
      </div>
    </>
  );
}

function AccountBody({ ctx }: { ctx: SettingsCtx }) {
  const { account, me, stats } = ctx;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = account.name ?? account.email ?? 'Your account';
  const email = account.email ?? me?.email ?? '—';
  return (
    <>
      <div className="profile-hero">
        <span className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <div className="profile-hero__name">{name}</div>
          <div className="profile-hero__email">{email}</div>
          <div className="profile-hero__badges">
            <span className={`badge ${me?.isAdmin ? 'badge--accent' : ''}`}>
              <Icon name={me?.isAdmin ? 'shield' : 'user'} size={13} />
              {me?.isAdmin ? 'Admin' : 'Member'}
            </span>
            <span className="badge badge--success">
              <Icon name="check-circle" size={13} />
              Signed in
            </span>
          </div>
        </div>
      </div>

      <div className="settings-group__label">Profile</div>
      <div className="settings-card">
        <DefRow label="Name" value={account.name ?? '—'} />
        <DefRow label="Email" value={email} />
        <DefRow label="Role" value={me?.isAdmin ? 'Administrator' : 'Member'} />
        <DefRow label="Sign-in" value="Microsoft Entra" />
      </div>

      <div className="settings-group">
        <div className="settings-group__label">Storage & usage</div>
        <div className="stat-grid">
          <Stat value={stats.chats == null ? '—' : String(stats.chats)} label="Chats" />
          <Stat value={stats.images == null ? '—' : String(stats.images)} label="Images" />
          <Stat value={stats.bytes == null ? '—' : formatBytes(stats.bytes)} label="On this device" />
        </div>
        <div className="settings-card" style={{ marginTop: 'var(--space-3)' }}>
          <div className="setting-row">
            <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
              <Icon name="check-circle" size={18} />
            </span>
            <div className="setting-row__body">
              <div className="setting-row__title">Cloud sync</div>
              <div className="setting-row__sub">
                {account.email ? `On · synced to ${account.email}` : 'Synced to your account across devices.'}
              </div>
            </div>
            <Icon name="check-circle" size={20} style={{ color: 'var(--color-success)' }} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        <Button variant="outline" icon="logout" disabled={busy} onClick={() => setConfirm(true)}>
          Sign out
        </Button>
      </div>

      {confirm && (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need to sign in again to use Watai. Your chats and images stay safe in your account."
          confirmLabel="Sign out"
          danger
          onConfirm={async () => {
            setBusy(true);
            try {
              await signOut(); // redirects away to complete sign-out
            } catch {
              setBusy(false);
            }
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  );
}

function DefRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-row">
      <div className="setting-row__body">
        <div className="setting-row__title">{label}</div>
      </div>
      <div className="setting-row__value setting-row__value--strong">{value}</div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function ModelsBody({ ctx }: { ctx: SettingsCtx }) {
  const pushToast = useUi((s) => s.pushToast);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [key, setKey] = useState('');

  useEffect(() => {
    getApiConfig().then(setConfig);
    getApiKey().then((k) => setKey(k ?? ''));
  }, []);

  if (!config) return <p className="muted">Loading…</p>;

  const update = (patch: Partial<ApiConfig>) => setConfig({ ...config, ...patch });
  const updateModels = (patch: Partial<ApiConfig['models']>) =>
    setConfig({ ...config, models: { ...config.models, ...patch } });

  const save = async () => {
    const next = { ...config, baseUrl: normalizeBaseUrl(config.baseUrl) };
    await saveApiConfig(next);
    await saveApiKey(key.trim());
    ctx.onModelSaved(next.models.chat);
    pushToast('Saved', 'success');
  };

  return (
    <>
      <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
        <div className="col" style={{ gap: 'var(--space-5)' }}>
          <Field
            label="Resource name or base URL"
            hint="Azure AI Foundry resource name or a full base URL."
            value={config.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            autoCapitalize="off"
            spellCheck={false}
          />
          <Field label="API key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          <Field label="Chat model" value={config.models.chat} onChange={(e) => updateModels({ chat: e.target.value })} />
          <Field
            label="Transcription model"
            value={config.models.transcribe}
            onChange={(e) => updateModels({ transcribe: e.target.value })}
          />
          <Field label="Image model" value={config.models.image} onChange={(e) => updateModels({ image: e.target.value })} />
          <Field label="TTS model" value={config.models.tts ?? ''} onChange={(e) => updateModels({ tts: e.target.value })} />
          <div className="field">
            <span className="field__label">Reasoning effort</span>
            <Segmented
              value={config.chatDefaults.reasoningEffort ?? 'medium'}
              onChange={(v) => update({ chatDefaults: { ...config.chatDefaults, reasoningEffort: v } })}
              options={[
                { value: 'minimal', label: 'Minimal' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--space-6)', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={save}>
          Save changes
        </Button>
      </div>
    </>
  );
}

function PersonalizationBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings } = ctx;
  const pushToast = useUi((s) => s.pushToast);
  const p = settings.personalization;
  return (
    <>
      <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
        <div className="col" style={{ gap: 'var(--space-5)' }}>
          <TextAreaField
            label="About you"
            hint="What should Watai know about you?"
            value={p.aboutYou ?? ''}
            onChange={(e) => setSettings({ ...settings, personalization: { ...p, aboutYou: e.target.value } })}
          />
          <TextAreaField
            label="How should Watai respond?"
            hint="Tone, format, and style preferences."
            value={p.howRespond ?? ''}
            onChange={(e) => setSettings({ ...settings, personalization: { ...p, howRespond: e.target.value } })}
          />
        </div>
      </div>
      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Memory</div>
            <div className="setting-row__sub">Let Watai remember useful details across chats.</div>
          </div>
          <Switch
            checked={p.memoryEnabled}
            onChange={(v) => {
              setSettings({ ...settings, personalization: { ...p, memoryEnabled: v } });
              pushToast(v ? 'Memory enabled' : 'Memory disabled');
            }}
            label="Memory"
          />
        </div>
      </div>
    </>
  );
}

function ToolToggle({
  label,
  sub,
  checked,
  onChange,
  available,
  hint,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  available: boolean;
  hint?: string;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row__body">
        <div className="setting-row__title">{label}</div>
        <div className="setting-row__sub">{available ? sub : (hint ?? 'Not available on this endpoint.')}</div>
      </div>
      {available ? (
        <Switch checked={checked} onChange={onChange} label={label} />
      ) : (
        <span className="badge">Unavailable</span>
      )}
    </div>
  );
}

function ToolsBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings } = ctx;
  const pushToast = useUi((s) => s.pushToast);
  const t = settings.tools ?? DEFAULT_SETTINGS.tools!;
  const [caps, setCaps] = useState<CapabilityMatrix | null>(null);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [tavilyKeyInput, setTavilyKeyInput] = useState('');
  const [tavilyHasKey, setTavilyHasKey] = useState(false);
  const [tavilyUsageData, setTavilyUsageData] = useState<{ used: number; limit: number | null } | null>(null);
  const [tavilyBusy, setTavilyBusy] = useState(false);
  const [tavilyTesting, setTavilyTesting] = useState(false);

  const kbFiles = config?.tools?.kbFiles ?? [];
  const mapStatus = (s: string): 'ready' | 'indexing' | 'failed' =>
    s === 'completed' ? 'ready' : s === 'failed' || s === 'cancelled' ? 'failed' : 'indexing';

  useEffect(() => {
    getApiConfig().then((c) => {
      setConfig(c);
      if (c) detectCapabilities(c).then(setCaps).catch(() => undefined);
      // Reconcile the local file registry with the live store's indexing status.
      const storeId = c?.tools?.vectorStoreId;
      if (c && storeId && (c.tools?.kbFiles?.length ?? 0) > 0) {
        listStoreFiles(storeId)
          .then((live) => {
            const byId = new Map(live.map((f) => [f.id, mapStatus(f.status)]));
            const merged = (c.tools?.kbFiles ?? []).map((f) =>
              byId.has(f.id) ? { ...f, status: byId.get(f.id)! } : f,
            );
            const next: ApiConfig = { ...c, tools: { ...c.tools, kbFiles: merged } };
            setConfig(next);
            void saveApiConfig(next);
          })
          .catch(() => undefined);
      }
    });
  }, []);

  const setTool = (patch: Partial<NonNullable<SettingsModel['tools']>>) =>
    setSettings({ ...settings, tools: { ...t, ...patch } });

  const detect = async () => {
    if (!config) return;
    setDetecting(true);
    resetAgenticCache();
    try {
      setCaps(await detectCapabilities(config));
      pushToast('Capabilities detected', 'success');
    } finally {
      setDetecting(false);
    }
  };

  // Load the Tavily key presence + usage on open.
  useEffect(() => {
    let live = true;
    getTavilyKey().then(async (k) => {
      if (!live) return;
      setTavilyHasKey(!!k);
      if (k) {
        try {
          const u = await tavilyUsage();
          if (live) setTavilyUsageData({ used: u.key?.usage ?? 0, limit: u.key?.limit ?? null });
        } catch {
          /* usage unavailable */
        }
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const refreshTavilyUsage = async () => {
    setTavilyBusy(true);
    try {
      const u = await tavilyUsage();
      setTavilyUsageData({ used: u.key?.usage ?? 0, limit: u.key?.limit ?? null });
    } catch (err) {
      setTavilyUsageData(null);
      pushToast(err instanceof Error ? err.message : 'Could not load usage', 'error');
    } finally {
      setTavilyBusy(false);
    }
  };

  const saveTavily = async () => {
    const k = tavilyKeyInput.trim();
    if (!k) return;
    await saveTavilyKey(k);
    setTavilyHasKey(true);
    setTavilyKeyInput('');
    // Saving a key is a clear intent to use web search — enable it so there isn't a silent
    // second step the user has to discover. They can still toggle it off above.
    if (!t.webSearch) setTool({ webSearch: true });
    pushToast('Tavily key saved — web search enabled', 'success');
    void refreshTavilyUsage();
  };

  const removeTavily = async () => {
    await saveTavilyKey('');
    setTavilyHasKey(false);
    setTavilyUsageData(null);
    if (t.webSearch) setTool({ webSearch: false });
    pushToast('Tavily key removed', 'info');
  };

  const testTavily = async () => {
    setTavilyTesting(true);
    try {
      const r = await tavilySearch('Tavily connectivity test');
      pushToast(`Web search works — ${r.results.length} results returned`, 'success');
      void refreshTavilyUsage();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Search test failed', 'error');
    } finally {
      setTavilyTesting(false);
    }
  };

  const foundry = config ? isFoundryHost(config.baseUrl) || endpointKind(config) === 'foundry-project' : false;
  const projectHint = 'Needs an Azure AI Foundry endpoint.';

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !config) return;
    setUploading(true);
    try {
      const { vectorStoreId, fileId, indexed } = await indexFileIntoStore(
        file,
        file.name,
        config.tools?.vectorStoreId,
      );
      const status: 'ready' | 'indexing' = indexed ? 'ready' : 'indexing';
      const entry = { id: fileId, name: file.name, status };
      const files = [...(config.tools?.kbFiles ?? []).filter((f) => f.id !== fileId), entry];
      const next: ApiConfig = { ...config, tools: { ...config.tools, vectorStoreId, kbFiles: files } };
      setConfig(next);
      await saveApiConfig(next);
      pushToast(indexed ? 'File indexed' : 'Uploaded; indexing continues', indexed ? 'success' : 'info');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onRemoveFile = async (fileId: string) => {
    const storeId = config?.tools?.vectorStoreId;
    if (!config || !storeId) return;
    setBusyFileId(fileId);
    try {
      await removeFileFromStore(storeId, fileId);
      const files = (config.tools?.kbFiles ?? []).filter((f) => f.id !== fileId);
      const next: ApiConfig = { ...config, tools: { ...config.tools, kbFiles: files } };
      setConfig(next);
      await saveApiConfig(next);
      pushToast('File removed', 'success');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not remove file', 'error');
    } finally {
      setBusyFileId(null);
    }
  };

  const onClearKb = async () => {
    const storeId = config?.tools?.vectorStoreId;
    if (!config || !storeId) return;
    const ok = await useUi.getState().requestConfirm({
      title: 'Clear knowledge base',
      message: 'Delete all indexed documents? The assistant will no longer be able to search them.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteVectorStore(storeId);
    } catch {
      /* store may already be gone; clear local state regardless */
    }
    const next: ApiConfig = { ...config, tools: { ...config.tools, vectorStoreId: undefined, kbFiles: [] } };
    setConfig(next);
    await saveApiConfig(next);
    pushToast('Knowledge base cleared', 'success');
  };

  return (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Agentic mode</div>
            <div className="setting-row__sub">
              Let the assistant use tools — search, code, images, and your saved data.
            </div>
          </div>
          <Switch checked={t.agenticMode} onChange={(v) => setTool({ agenticMode: v })} label="Agentic mode" />
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <ToolToggle
          label="Image generation"
          sub="Create images from the conversation."
          checked={t.imageAgent}
          onChange={(v) => setTool({ imageAgent: v })}
          available
        />
        <ToolToggle
          label="Code interpreter"
          sub="Run Python for math, data, and charts."
          checked={t.codeInterpreter}
          onChange={(v) => setTool({ codeInterpreter: v })}
          available={caps?.codeInterpreter ?? false}
          hint="Needs a Responses-capable endpoint."
        />
        <ToolToggle
          label="Web search"
          sub="Ground answers with cited web results (Tavily)."
          checked={t.webSearch}
          onChange={(v) => setTool({ webSearch: v })}
          available={tavilyHasKey}
          hint="Add a Tavily API key below."
        />
        <ToolToggle
          label="File search"
          sub="Answer from your uploaded documents."
          checked={t.fileSearch}
          onChange={(v) => setTool({ fileSearch: v })}
          available={caps?.fileSearch ?? false}
          hint={projectHint}
        />
      </div>

      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Web search (Tavily)</div>
            <div className="setting-row__sub">
              {tavilyHasKey
                ? 'Your key is saved. The assistant can search the web and cite sources.'
                : 'Add a Tavily API key to enable web search.'}
            </div>
          </div>
          {tavilyHasKey && (
            <button type="button" className="btn btn--ghost btn--danger" onClick={removeTavily}>
              Remove key
            </button>
          )}
        </div>

        <div className="setting-row">
          <input
            className="input grow"
            type="password"
            autoComplete="off"
            placeholder={tavilyHasKey ? '•••••••••••• (saved — paste to replace)' : 'tvly-...'}
            value={tavilyKeyInput}
            onChange={(e) => setTavilyKeyInput(e.target.value)}
            aria-label="Tavily API key"
          />
          <Button onClick={saveTavily} disabled={!tavilyKeyInput.trim()}>
            Save
          </Button>
        </div>

        <div className="setting-row__sub" style={{ paddingLeft: 'var(--space-1)' }}>
          No key?{' '}
          <a href="https://app.tavily.com" target="_blank" rel="noreferrer noopener">
            Get a free one at app.tavily.com
          </a>{' '}
          — sign up, copy your key (starts with <code>tvly-</code>), and paste it above.
        </div>
        <div className="setting-row__sub" style={{ paddingLeft: 'var(--space-1)' }}>
          Web searches send your query to Tavily.
        </div>

        {tavilyHasKey && (
          <div className="setting-row">
            <div className="setting-row__body">
              <div className="setting-row__title">Usage</div>
              <div className="setting-row__sub">
                {tavilyUsageData
                  ? `${tavilyUsageData.used}${
                      tavilyUsageData.limit != null ? ` / ${tavilyUsageData.limit}` : ''
                    } credits used this billing cycle`
                  : 'Usage unavailable.'}
              </div>
            </div>
            <button
              type="button"
              className="btn btn--outline"
              onClick={testTavily}
              disabled={tavilyTesting}
            >
              {tavilyTesting ? <span className="spinner" style={{ width: 16, height: 16 }} /> : null}
              <span>Test search</span>
            </button>
            <IconButton
              name="refresh"
              label="Refresh usage"
              size={18}
              disabled={tavilyBusy}
              onClick={refreshTavilyUsage}
            />
          </div>
        )}
      </div>

      {caps?.fileSearch && (
        <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
          <div className="setting-row">
            <div className="setting-row__body">
              <div className="setting-row__title">Knowledge base</div>
              <div className="setting-row__sub">
                {kbFiles.length
                  ? 'The assistant can search and cite these documents.'
                  : 'Upload documents the assistant can search and cite.'}
              </div>
            </div>
            <label className="btn btn--outline" aria-disabled={uploading}>
              {uploading ? (
                <span className="spinner" style={{ width: 16, height: 16 }} />
              ) : (
                <Icon name="paperclip" size={18} />
              )}
              <span>{uploading ? 'Indexing…' : 'Add file'}</span>
              <input
                type="file"
                hidden
                disabled={uploading}
                onChange={onUpload}
                accept=".pdf,.txt,.md,.markdown,.docx,.json,.csv"
              />
            </label>
          </div>

          {kbFiles.length > 0 && (
            <ul className="kb-list">
              {kbFiles.map((f) => (
                <li key={f.id} className="kb-file">
                  <Icon name="paperclip" size={15} className="kb-file__icon" />
                  <span className="kb-file__name" title={f.name}>
                    {f.name}
                  </span>
                  <span className={`kb-file__status kb-file__status--${f.status}`}>
                    {f.status === 'ready' ? 'Ready' : f.status === 'failed' ? 'Failed' : 'Indexing…'}
                  </span>
                  <IconButton
                    name="trash"
                    label={`Remove ${f.name}`}
                    size={16}
                    disabled={busyFileId === f.id}
                    onClick={() => onRemoveFile(f.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {kbFiles.length > 0 && (
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__sub">
                  {kbFiles.length} {kbFiles.length === 1 ? 'document' : 'documents'} indexed.
                </div>
              </div>
              <button type="button" className="btn btn--ghost btn--danger" onClick={onClearKb}>
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Endpoint</div>
            <div className="setting-row__sub">
              {foundry
                ? 'Azure AI Foundry — the full tool suite is available.'
                : 'Azure OpenAI key — function calling, code, and images.'}
            </div>
          </div>
          <div className="setting-row__value setting-row__value--strong">
            {foundry ? 'Foundry' : 'Standard'}
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Detect capabilities</div>
            <div className="setting-row__sub">Re-probe which tools this endpoint supports.</div>
          </div>
          <Button variant="outline" icon="refresh" loading={detecting} onClick={detect}>
            Detect
          </Button>
        </div>
      </div>
    </>
  );
}

function VoiceBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings } = ctx;
  const v = settings.voice;
  const set = (patch: Partial<typeof v>) => setSettings({ ...settings, voice: { ...v, ...patch } });
  return (
    <div className="settings-card">
      <div className="setting-row">
        <div className="setting-row__body">
          <div className="setting-row__title">Auto-send after dictation</div>
          <div className="setting-row__sub">Send as soon as you stop speaking.</div>
        </div>
        <Switch checked={v.autoSend} onChange={(x) => set({ autoSend: x })} label="Auto-send" />
      </div>
      <div className="setting-row">
        <div className="setting-row__body">
          <div className="setting-row__title">Live captions</div>
          <div className="setting-row__sub">Show text during voice mode.</div>
        </div>
        <Switch checked={v.captions} onChange={(x) => set({ captions: x })} label="Captions" />
      </div>
      <div className="setting-row">
        <div className="setting-row__body">
          <div className="setting-row__title">Speaking rate</div>
          <div className="setting-row__sub">{v.rate.toFixed(1)}x</div>
        </div>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={v.rate}
          onChange={(e) => set({ rate: Number(e.target.value) })}
          aria-label="Speaking rate"
        />
      </div>
    </div>
  );
}

function AppearanceBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings } = ctx;
  const a = settings.appearance;
  const set = (patch: Partial<typeof a>) => setSettings({ ...settings, appearance: { ...a, ...patch } });
  return (
    <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
      <div className="col" style={{ gap: 'var(--space-6)' }}>
        <div className="field">
          <span className="field__label">Theme</span>
          <Segmented
            value={a.theme}
            onChange={(t) => set({ theme: t })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="field">
          <span className="field__label">Text size</span>
          <Segmented
            value={String(a.textScale)}
            onChange={(t) => set({ textScale: Number(t) as TextScale })}
            options={[
              { value: '0.9', label: 'Small' },
              { value: '1', label: 'Default' },
              { value: '1.1', label: 'Large' },
              { value: '1.25', label: 'XL' },
            ]}
          />
        </div>
        <div className="field">
          <span className="field__label">Density</span>
          <Segmented
            value={a.density}
            onChange={(d) => set({ density: d })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </div>
        <div className="setting-row" style={{ padding: 0, borderBottom: 'none' }}>
          <div className="setting-row__body">
            <div className="setting-row__title">Reduce motion</div>
            <div className="setting-row__sub">Minimize animations.</div>
          </div>
          <Switch checked={a.reduceMotion === true} onChange={(x) => set({ reduceMotion: x })} label="Reduce motion" />
        </div>
      </div>
    </div>
  );
}

function DataBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings, account } = ctx;
  const pushToast = useUi((s) => s.pushToast);
  const bump = useUi((s) => s.bumpThreads);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);

  const exportData = async () => {
    const blob = await repo.exportAll();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'watai-export.json';
    a.click();
    URL.revokeObjectURL(url);
    pushToast('Export downloaded', 'success');
  };

  return (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
            <Icon name="check-circle" size={18} />
          </span>
          <div className="setting-row__body">
            <div className="setting-row__title">Cloud sync</div>
            <div className="setting-row__sub">
              {account.email ? `On · synced to ${account.email}` : 'Synced to your account across all your devices.'}
            </div>
          </div>
          <Icon name="check-circle" size={20} style={{ color: 'var(--color-success)' }} />
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Default to temporary chats</div>
            <div className="setting-row__sub">New chats won't be saved to history.</div>
          </div>
          <Switch
            checked={settings.data.temporaryDefault}
            onChange={(v) => setSettings({ ...settings, data: { ...settings.data, temporaryDefault: v } })}
            label="Temporary default"
          />
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Keep history</div>
            <div className="setting-row__sub">How long saved chats are retained.</div>
          </div>
          <Segmented
            value={settings.data.retention}
            onChange={(r) => setSettings({ ...settings, data: { ...settings.data, retention: r } })}
            options={[
              { value: 'forever', label: 'Forever' },
              { value: '30d', label: '30 days' },
              { value: '90d', label: '90 days' },
            ]}
          />
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <button className="setting-row" onClick={exportData}>
          <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
            <Icon name="download" size={18} />
          </span>
          <div className="setting-row__body">
            <div className="setting-row__title">Export all data</div>
            <div className="setting-row__sub">Download a JSON archive of your chats and settings.</div>
          </div>
          <Icon name="chevron-right" size={18} className="muted" />
        </button>
        <button className="setting-row" onClick={() => setConfirm(true)}>
          <span
            className="avatar"
            style={{
              width: 36,
              height: 36,
              background: 'color-mix(in srgb, var(--color-danger) 16%, transparent)',
              color: 'var(--color-danger)',
            }}
          >
            <Icon name="trash" size={18} />
          </span>
          <div className="setting-row__body">
            <div className="setting-row__title" style={{ color: 'var(--color-danger)' }}>
              Delete all conversations
            </div>
            <div className="setting-row__sub">Permanently removes local data on this device.</div>
          </div>
          <Icon name="chevron-right" size={18} className="muted" />
        </button>
      </div>

      {confirm && (
        <ConfirmDialog
          title="Delete all data?"
          message="All conversations, images, and memory on this device will be permanently deleted."
          confirmLabel="Delete everything"
          danger
          onConfirm={async () => {
            await repo.deleteAll();
            localStorage.removeItem('watai.seeded');
            bump();
            pushToast('All data deleted');
            navigate('/new');
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  );
}

function InvitesBody() {
  const pushToast = useUi((s) => s.pushToast);
  const [invites, setInvites] = useState<InviteRecord[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    cloudApi
      .listInvites()
      .then(setInvites)
      .catch(() => setInvites([]));
  };
  useEffect(refresh, []);

  // The public sign-in page. Invitees open this, then sign in with their invited email.
  const SIGNUP_URL = 'https://prabinpebam.github.io/watai/';
  const mailtoFor = (to: string) => {
    const subject = encodeURIComponent('You are invited to Watai');
    const body = encodeURIComponent(
      `Hi,\n\nYou have been invited to Watai. Open the link below and sign in with this email address (${to}):\n\n${SIGNUP_URL}\n\nSee you there.`,
    );
    return `mailto:${to}?subject=${subject}&body=${body}`;
  };

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await cloudApi.createInvite(value);
      setEmail('');
      refresh();
      pushToast('Invite added', 'success');
      // Open the admin's own mail client to actually send the invite.
      window.location.href = mailtoFor(value);
    } catch {
      setError('Could not add that invite. Check the email address and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (to: string) => {
    setBusy(true);
    try {
      await cloudApi.deleteInvite(to);
      refresh();
      pushToast('Invite removed');
    } catch {
      pushToast('Could not remove invite', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted" style={{ marginBottom: 'var(--space-5)' }}>
        Watai is invite-only. Add someone&apos;s email to let them sign in, then send them the
        invite from your mail app.
      </p>

      <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
        <div className="col" style={{ gap: 'var(--space-4)' }}>
          <Field
            label="Invite by email"
            type="email"
            inputMode="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            error={error ?? undefined}
          />
          <div>
            <Button icon="user-add" loading={busy} disabled={!email.trim()} onClick={() => void add()}>
              Add &amp; send invite
            </Button>
          </div>
        </div>
      </div>

      <div className="settings-card" style={{ marginTop: 'var(--space-6)' }}>
        {invites === null ? (
          <div className="setting-row">
            <div className="setting-row__body">
              <div className="setting-row__sub">Loading…</div>
            </div>
          </div>
        ) : invites.length === 0 ? (
          <div className="setting-row">
            <div className="setting-row__body">
              <div className="setting-row__sub">No invites yet.</div>
            </div>
          </div>
        ) : (
          invites.map((inv) => (
            <div key={inv.email} className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__title">{inv.email}</div>
                <div className="setting-row__sub">
                  Invited {new Date(inv.createdAt).toLocaleDateString()}
                </div>
              </div>
              <a
                className="icon-btn"
                href={mailtoFor(inv.email)}
                aria-label={`Send invite email to ${inv.email}`}
                title="Send invite email"
              >
                <Icon name="mail" size={20} />
              </a>
              <IconButton
                name="trash"
                label={`Remove ${inv.email}`}
                disabled={busy}
                onClick={() => void remove(inv.email)}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function AboutBody() {
  return (
    <>
      <div
        className="col"
        style={{ alignItems: 'center', textAlign: 'center', gap: 'var(--space-4)', padding: 'var(--space-7) 0' }}
      >
        <Logo size={64} />
        <div>
          <div style={{ fontSize: 'var(--text-title-2-size)', fontWeight: 600 }}>Watai</div>
          <div className="muted">Version {APP_VERSION}</div>
        </div>
        <p className="muted" style={{ maxWidth: '40ch' }}>
          A privacy-first AI client. Your endpoint, your key, your data — running entirely in your browser.
        </p>
      </div>
      <div className="settings-card">
        <a
          className="setting-row"
          href="https://github.com/prabinpebam/watai"
          target="_blank"
          rel="noreferrer noopener"
        >
          <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
            <Icon name="external" size={18} />
          </span>
          <div className="setting-row__body">
            <div className="setting-row__title">Source code</div>
            <div className="setting-row__sub">github.com/prabinpebam/watai</div>
          </div>
          <Icon name="external" size={18} className="muted" />
        </a>
      </div>
    </>
  );
}
