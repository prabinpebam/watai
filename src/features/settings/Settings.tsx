import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from './useSettings';
import { SkillsBody } from '../skills/SkillsBody';
import { Avatar, Button, Field, IconButton, InlineAlert, Segmented, SelectMenu, Spinner, Switch, TextAreaField } from '../../design/ui';
import { Icon } from '../../design/icons';
import { Logo } from '../../design/Logo';
import { ConfirmDialog } from '../../design/overlays';
import { useUi } from '../../state/store';
import { useIsExpanded } from '../../lib/hooks';
import { formatBytes } from '../../lib/format';
import { repo, cloudApi, realtime } from '../../data';
import { kvGet } from '../../data/db';
import { signOut, getSignedInAccount } from '../../auth/cloudAuth';
import { useMe } from '../../auth/access';
import type { CredentialCapabilities, CredentialStatus, InviteRecord, MeInfo, MemoryModelConfig, MemoryProfileItem, MemoryProfileView, MemoryRecord, MemoryStatus } from '../../data/cloud/types';
import { normalizeBaseUrl } from '../../data/secureStore';
import { normalizeChatModelOptions } from '../../lib/modelOptions';
import { DEFAULT_SETTINGS, effectiveMemorySettings } from '../../lib/types';
import type { ImageRef, MemoryKind, MemorySettings, Settings as SettingsModel, TextScale } from '../../lib/types';

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
  skills: {
    id: 'skills',
    label: 'Skills',
    icon: 'puzzle',
    sub: 'Reusable, file-based abilities the assistant loads on demand',
  },
  appearance: { id: 'appearance', label: 'Appearance', icon: 'palette', sub: 'Theme, text size, and density' },
  data: { id: 'data', label: 'Data controls', icon: 'database', sub: 'Sync, export, retention, and deletion' },
  invites: { id: 'invites', label: 'Invites', icon: 'user-add', sub: 'Manage who can sign in', adminOnly: true },
  memoryModels: { id: 'memoryModels', label: 'Memory model', icon: 'tune', sub: 'Server model that learns memories', adminOnly: true },
  about: { id: 'about', label: 'About', icon: 'info', sub: 'Version and links' },
};

const GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Assistant', ids: ['models', 'tools', 'skills', 'personalization', 'voice'] },
  { label: 'App', ids: ['appearance', 'data', 'about'] },
  { label: 'Admin', ids: ['invites', 'memoryModels'] },
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
  tavilyConfigured: boolean;
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
      return effectiveMemorySettings(s).enabled ? 'Memory on' : 'Memory off';
    case 'voice':
      return `${s.voice.autoSend ? 'Auto-send on' : 'Auto-send off'} · ${s.voice.rate.toFixed(1)}×`;
    case 'tools': {
      const tl = s.tools;
      if (!tl?.agenticMode) return 'Off';
      const on = [ctx.tavilyConfigured && 'Web', tl.codeInterpreter && 'Code', tl.fileSearch && 'Files'].filter(
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
  const [tavilyConfigured, setTavilyConfigured] = useState(false);
  useEffect(() => {
    cloudApi
      .getCredentialStatus()
      .then((s) => {
        setChatModel(s.models?.chat ?? null);
        setTavilyConfigured(!!s.tavilyConfigured);
      })
      .catch(() => undefined);
  }, [section]);

  const ctx: SettingsCtx = {
    settings,
    setSettings,
    loaded,
    account,
    me,
    stats,
    chatModel,
    onModelSaved: setChatModel,
    tavilyConfigured,
  };

  const current = section && SECTIONS[section] ? section : null;

  // Pop within the app when there's history to pop, else navigate to a deterministic fallback.
  // This avoids the section<->hub loop that arose from mixing navigate('/settings') (push) with
  // navigate(-1) (pop), which left no way out of Settings.
  const back = (fallback: string) => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };

  if (expanded) {
    return (
      <SettingsDesktop
        active={current ?? 'account'}
        ctx={ctx}
        // Desktop is master/detail (no drill-in), so switching sections REPLACES rather than
        // pushes — keeping a single Settings entry in history so Close exits cleanly.
        onSelect={(id) => navigate(`/settings/${id}`, { replace: true })}
        onClose={() => back('/')}
      />
    );
  }

  if (!current) {
    return <SettingsHub ctx={ctx} onOpen={(id) => navigate(`/settings/${id}`)} onClose={() => back('/')} />;
  }

  return (
    <Section id={current} onBack={() => back('/settings')}>
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
  onClose,
}: {
  active: string;
  ctx: SettingsCtx;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  return (
    <>
      <div className="appbar">
        <IconButton name="sidebar" label="Toggle sidebar" onClick={() => toggleSidebar()} />
        <div className="appbar__title" style={{ textAlign: 'left' }}>
          Settings
        </div>
        <IconButton name="close" label="Close settings" onClick={onClose} />
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
      <Avatar size="md">{name.slice(0, 1).toUpperCase()}</Avatar>
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
    case 'skills':
      return <SkillsBody codeInterpreterOff={ctx.settings.tools?.codeInterpreter === false} />;
    case 'appearance':
      return <AppearanceBody ctx={ctx} />;
    case 'data':
      return <DataBody ctx={ctx} />;
    case 'invites':
      return <InvitesBody />;
    case 'memoryModels':
      return <MemoryModelsBody />;
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
            <Avatar size="lg">{name.slice(0, 1).toUpperCase()}</Avatar>
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
                      <Avatar size="md" variant="assistant">
                        <Icon name={meta.icon} size={18} />
                      </Avatar>
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
        <Avatar size="lg">{name.slice(0, 1).toUpperCase()}</Avatar>
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
            <Avatar size="md" variant="assistant">
              <Icon name="check-circle" size={18} />
            </Avatar>
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
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [models, setModels] = useState<{ chat: string; chatOptions: string[]; image?: string; transcribe?: string; tts?: string }>({
    chat: 'model-router',
    chatOptions: normalizeChatModelOptions('model-router'),
  });
  const [tavilyKey, setTavilyKey] = useState('');
  const [kbStore, setKbStore] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cloudApi
      .getCredentialStatus()
      .then((s) => {
        setStatus(s);
        setBaseUrl(s.baseUrl ?? '');
        setModels({
          chat: s.models?.chat ?? 'model-router',
          chatOptions: normalizeChatModelOptions(s.models?.chat, s.models?.chatOptions),
          image: s.models?.image,
          transcribe: s.models?.transcribe,
          tts: s.models?.tts,
        });
        setKbStore(s.knowledgeBaseVectorStoreId ?? '');
      })
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading…</p>;

  const updateModels = (patch: Partial<typeof models>) => setModels((m) => ({ ...m, ...patch }));
  const updateChatOption = (index: number, value: string) =>
    setModels((m) => ({ ...m, chatOptions: m.chatOptions.map((option, i) => (i === index ? value : option)) }));
  const addChatOption = () => setModels((m) => ({ ...m, chatOptions: [...m.chatOptions, ''] }));
  const removeChatOption = (index: number) =>
    setModels((m) => ({ ...m, chatOptions: m.chatOptions.filter((_, i) => i !== index) }));

  // Everything is stored encrypted in the server vault; the key is write-only (never returned), so
  // leaving it blank on an update keeps the saved key.
  const save = async () => {
    if (!baseUrl.trim()) return pushToast('Enter your endpoint.', 'error');
    if (!models.chat.trim()) return pushToast('Enter a chat model.', 'error');
    if (!status?.configured && !key.trim()) return pushToast('Enter your API key.', 'error');
    setSaving(true);
    try {
      const next = await cloudApi.putCredentials({
        baseUrl: normalizeBaseUrl(baseUrl),
        models: {
          chat: models.chat.trim(),
          chatOptions: normalizeChatModelOptions(models.chat, models.chatOptions),
          ...(models.image?.trim() ? { image: models.image.trim() } : {}),
          ...(models.transcribe?.trim() ? { transcribe: models.transcribe.trim() } : {}),
          ...(models.tts?.trim() ? { tts: models.tts.trim() } : {}),
        },
        ...(key.trim() ? { key: key.trim() } : {}),
        ...(tavilyKey.trim() ? { tavilyKey: tavilyKey.trim() } : {}),
        ...(kbStore.trim() ? { knowledgeBaseVectorStoreId: kbStore.trim() } : {}),
      });
      setStatus(next);
      setKey('');
      setTavilyKey('');
      ctx.onModelSaved(next.models?.chat ?? models.chat);
      pushToast('Saved', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
        <div className="col" style={{ gap: 'var(--space-5)' }}>
          <Field
            label="Resource name or base URL"
            hint="Azure AI Foundry resource name or a full base URL."
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
          <Field
            label="API key"
            type="password"
            placeholder={status?.configured ? `Saved ·••${status.keyHint ?? ''} — leave blank to keep` : ''}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
          <Field
            label="Default chat model"
            hint="Used when no per-chat model is selected. Use model-router for Auto."
            value={models.chat}
            onChange={(e) => updateModels({ chat: e.target.value })}
          />
          <div className="model-options-editor">
            <div className="field__label">Chat model options</div>
            <div className="field__hint">These appear in the chat header selector. Auto is model-router.</div>
            <div className="model-options-editor__list">
              {models.chatOptions.map((model, index) => (
                <div key={index} className="model-option-row">
                  <input
                    className="input"
                    value={model}
                    placeholder={index === 0 ? 'model-router' : 'deployment-name'}
                    onChange={(e) => updateChatOption(index, e.target.value)}
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <IconButton name="trash" label="Remove model option" onClick={() => removeChatOption(index)} />
                </div>
              ))}
            </div>
            <Button variant="secondary" onClick={addChatOption}>Add model option</Button>
          </div>
          <Field
            label="Transcription model"
            value={models.transcribe ?? ''}
            onChange={(e) => updateModels({ transcribe: e.target.value })}
          />
          <Field
            label="Image model"
            value={models.image ?? ''}
            onChange={(e) => updateModels({ image: e.target.value })}
          />
          <Field
            label="TTS model"
            value={models.tts ?? ''}
            onChange={(e) => updateModels({ tts: e.target.value })}
          />
          <Field
            label="Web search key (Tavily) — optional"
            type="password"
            placeholder={
              status?.tavilyConfigured ? `Saved ·••${status.tavilyHint ?? ''} — leave blank to keep` : ''
            }
            hint="Enables server-side web search."
            value={tavilyKey}
            onChange={(e) => setTavilyKey(e.target.value)}
            autoComplete="off"
          />
          <Field
            label="Account knowledge base (vector store id) — optional"
            hint="Searched as a fallback alongside each chat's own files."
            value={kbStore}
            onChange={(e) => setKbStore(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--space-6)', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={save} loading={saving}>
          Save
        </Button>
      </div>
    </>
  );
}

export function PersonalizationBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings } = ctx;
  const pushToast = useUi((s) => s.pushToast);
  const p = settings.personalization;
  const memory = effectiveMemorySettings(settings);
  const setMemory = (patch: Partial<MemorySettings>) => {
    const nextMemory = { ...memory, ...patch };
    setSettings({ ...settings, personalization: { ...p, memoryEnabled: nextMemory.enabled, memory: nextMemory } });
  };
  return (
    <>
      <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
        <div className="settings-group__label" style={{ marginTop: 0, paddingLeft: 0 }}>Custom instructions</div>
        <p className="setting-row__sub" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>
          Explicit instructions you write here are applied directly. Memory below is learned or saved context you can inspect.
        </p>
        <div className="col" style={{ gap: 'var(--space-4)' }}>
          <TextAreaField
            label="About you"
            hint="What should Watai know about you?"
            value={p.aboutYou ?? ''}
            rows={3}
            onChange={(e) => setSettings({ ...settings, personalization: { ...p, aboutYou: e.target.value } })}
          />
          <TextAreaField
            label="How should Watai respond?"
            hint="Tone, format, and style preferences."
            value={p.howRespond ?? ''}
            rows={3}
            onChange={(e) => setSettings({ ...settings, personalization: { ...p, howRespond: e.target.value } })}
          />
        </div>
      </div>
      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Memory</div>
            <div className="setting-row__sub">Saved and learned context, shown as a structured profile and evidence list.</div>
          </div>
          <Switch
            checked={memory.enabled}
            onChange={(v) => {
              setMemory({ enabled: v, referenceSaved: v ? memory.referenceSaved : false, autoExtract: v ? memory.autoExtract : false, referenceHistory: v ? memory.referenceHistory : false });
              pushToast(v ? 'Memory enabled' : 'Memory disabled');
            }}
            label="Memory"
          />
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Use saved memories</div>
            <div className="setting-row__sub">Include relevant saved memories in future server-generated replies.</div>
          </div>
          <Switch checked={memory.enabled && memory.referenceSaved} disabled={!memory.enabled} onChange={(v) => setMemory({ referenceSaved: v })} label="Use saved memories" />
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Learn from chats</div>
            <div className="setting-row__sub">After each completed reply, Watai asks your configured model what should become durable memory.</div>
          </div>
          <Switch checked={memory.enabled && memory.autoExtract && memory.referenceHistory} disabled={!memory.enabled} onChange={(v) => setMemory({ autoExtract: v, referenceHistory: v })} label="Learn from chats" />
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Pause learning</div>
            <div className="setting-row__sub">Keep existing memory available, but stop creating automatic memories.</div>
          </div>
          <Switch checked={memory.enabled && memory.paused} disabled={!memory.enabled} onChange={(v) => setMemory({ paused: v })} label="Pause learning" />
        </div>
      </div>
      <MemoryManager enabled={memory.enabled} />
    </>
  );
}

const MANUAL_MEMORY_KINDS: Array<Exclude<MemoryKind, 'thread_summary' | 'entity'>> = [
  'fact',
  'preference',
  'instruction',
  'work_style',
  'project_context',
  'avoidance',
  'procedure',
];

function memoryKindLabel(kind: MemoryKind): string {
  return kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const MEMORY_KIND_VALUES = new Set<MemoryKind>(['fact', 'preference', 'instruction', 'work_style', 'project_context', 'thread_summary', 'avoidance', 'entity', 'procedure']);
const MEMORY_STATUS_VALUES = new Set<string>(['active', 'suppressed', 'invalidated']);
const MEMORY_VISIBILITY_VALUES = new Set<string>(['normal', 'top_of_mind', 'background']);

/** Serialize memories to the editable raw-JSON shape (only fields the API can round-trip). */
function memoryToEditableJson(items: MemoryRecord[]): string {
  return JSON.stringify(
    items.map((i) => ({ id: i.id, kind: i.kind, text: i.text, status: i.status, visibility: i.visibility, pinned: i.pinned, salience: Number(i.salience.toFixed(2)) })),
    null,
    2,
  );
}

/** Lenient JSON parse for the manual editor: strips code fences and trailing commas before parsing. */
function lenientJsonParse(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return JSON.parse(cleaned.replace(/,(\s*[}\]])/g, '$1'));
  }
}

export function MemoryManager({ enabled }: { enabled: boolean }) {
  const pushToast = useUi((s) => s.pushToast);
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [profile, setProfile] = useState<MemoryProfileView | null>(null);
  const [view, setView] = useState<'structured' | 'evidence' | 'json'>('structured');
  const [status, setStatus] = useState<Extract<MemoryStatus, 'active' | 'suppressed' | 'invalidated'>>('active');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Exclude<MemoryKind, 'thread_summary' | 'entity'>>('fact');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editKind, setEditKind] = useState<Exclude<MemoryKind, 'thread_summary' | 'entity'>>('fact');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [activeById, setActiveById] = useState<Map<string, MemoryRecord>>(new Map());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; text: string } | null>(null);

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const [nextItems, nextProfile] = await Promise.all([
        repo.listMemory({ status: nextStatus, limit: 100 }),
        repo.getMemoryProfile(),
      ]);
      setItems(nextItems);
      setProfile(nextProfile);
      const active = nextStatus === 'active' ? nextItems : await repo.listMemory({ status: 'active', limit: 100 });
      setActiveById(new Map(active.map((m) => [m.id, m])));
      setRemovedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load memory.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  useEffect(() => {
    let off: (() => void) | undefined;
    void realtime.ensure();
    off = realtime.on('memory', () => {
      setStatus('active');
      void load('active');
    });
    return () => off?.();
  }, []);

  const add = async () => {
    const value = text.trim();
    if (!value) return;
    setSaving(true);
    try {
      await repo.addMemory({ text: value, kind });
      setText('');
      setStatus('active');
      await load();
      pushToast('Saved to memory', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save memory.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, update: Parameters<typeof repo.updateMemory>[1], label: string) => {
    try {
      await repo.updateMemory(id, update);
      await load();
      pushToast(label, 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not update memory.', 'error');
    }
  };

  const requestDelete = (ids: string[], text: string) => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length) setPendingDelete({ ids: unique, text });
  };

  /** Optimistically hide the deleted item(s) instead of reloading the whole view. */
  const performDelete = async (ids: string[]) => {
    try {
      for (const id of ids) await repo.removeMemory(id);
      setRemovedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      pushToast(ids.length > 1 ? `Deleted ${ids.length} memories` : 'Deleted memory', 'success');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not delete memory.', 'error');
    }
  };

  const startEdit = (item: MemoryRecord) => {
    setEditingId(item.id);
    setEditText(item.text);
    setEditKind((MANUAL_MEMORY_KINDS as MemoryKind[]).includes(item.kind) ? (item.kind as Exclude<MemoryKind, 'thread_summary' | 'entity'>) : 'fact');
  };

  const saveEdit = async (id: string) => {
    const value = editText.trim();
    if (!value) return;
    await patch(id, { text: value, kind: editKind }, 'Memory updated');
    setEditingId(null);
  };

  useEffect(() => {
    if (view === 'json') {
      setJsonText(memoryToEditableJson(items.filter((i) => !removedIds.has(i.id))));
      setJsonError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const formatJson = () => {
    try {
      setJsonText(JSON.stringify(lenientJsonParse(jsonText), null, 2));
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON.');
    }
  };

  const saveJson = async () => {
    let parsed: unknown;
    try {
      parsed = lenientJsonParse(jsonText);
    } catch (e) {
      setJsonError(`Could not parse JSON: ${e instanceof Error ? e.message : 'invalid'}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setJsonError('The top level must be a JSON array of memory objects.');
      return;
    }
    const edited: Array<{ id?: string; kind: MemoryKind; text: string; status?: MemoryStatus; visibility?: MemoryRecord['visibility']; pinned?: boolean; salience?: number }> = [];
    for (let i = 0; i < parsed.length; i++) {
      const r = parsed[i] as Record<string, unknown>;
      if (!r || typeof r !== 'object') { setJsonError(`Item ${i + 1} is not an object.`); return; }
      const value = typeof r.text === 'string' ? r.text.trim() : '';
      if (!value) { setJsonError(`Item ${i + 1} is missing a non-empty "text".`); return; }
      const itemKind = (typeof r.kind === 'string' ? r.kind : 'fact') as MemoryKind;
      if (!MEMORY_KIND_VALUES.has(itemKind)) { setJsonError(`Item ${i + 1} has an invalid "kind": ${String(r.kind)}.`); return; }
      const itemStatus = r.status as MemoryStatus | undefined;
      if (itemStatus && !MEMORY_STATUS_VALUES.has(itemStatus)) { setJsonError(`Item ${i + 1} has an invalid "status": ${String(r.status)}.`); return; }
      const itemVisibility = r.visibility as MemoryRecord['visibility'] | undefined;
      if (itemVisibility && !MEMORY_VISIBILITY_VALUES.has(itemVisibility)) { setJsonError(`Item ${i + 1} has an invalid "visibility": ${String(r.visibility)}.`); return; }
      edited.push({
        id: typeof r.id === 'string' && r.id ? r.id : undefined,
        kind: itemKind,
        text: value,
        status: itemStatus,
        visibility: itemVisibility,
        pinned: typeof r.pinned === 'boolean' ? r.pinned : undefined,
        salience: typeof r.salience === 'number' ? Math.max(0, Math.min(1, r.salience)) : undefined,
      });
    }
    const currentById = new Map(items.map((i) => [i.id, i]));
    const editedIds = new Set(edited.filter((e) => e.id).map((e) => e.id as string));
    const toDelete = items.filter((i) => !editedIds.has(i.id));
    if (toDelete.length && !window.confirm(`Saving will delete ${toDelete.length} item(s) removed from the JSON. Continue?`)) return;
    setJsonSaving(true);
    setJsonError(null);
    try {
      let created = 0;
      let updated = 0;
      let deleted = 0;
      for (const e of edited) {
        const current = e.id ? currentById.get(e.id) : undefined;
        if (current) {
          const update: Parameters<typeof repo.updateMemory>[1] = {};
          if (e.text !== current.text) update.text = e.text;
          if (e.kind !== current.kind) update.kind = e.kind;
          if (e.status && e.status !== current.status) update.status = e.status as Parameters<typeof repo.updateMemory>[1]['status'];
          if (e.visibility && e.visibility !== current.visibility) update.visibility = e.visibility;
          if (e.pinned !== undefined && e.pinned !== current.pinned) update.pinned = e.pinned;
          if (e.salience !== undefined && Math.abs(e.salience - current.salience) > 1e-6) update.salience = e.salience;
          if (Object.keys(update).length) { await repo.updateMemory(current.id, update); updated++; }
        } else {
          await repo.addMemory({ text: e.text, kind: e.kind as Parameters<typeof repo.addMemory>[0]['kind'], visibility: e.visibility, pinned: e.pinned });
          created++;
        }
      }
      for (const d of toDelete) { await repo.removeMemory(d.id); deleted++; }
      pushToast(`Saved: ${created} created · ${updated} updated · ${deleted} deleted`, 'success');
      await load();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save JSON changes.', 'error');
    } finally {
      setJsonSaving(false);
    }
  };

  const visibleItems = items.filter((i) => !removedIds.has(i.id));
  const structuredActions: StructuredActions = {
    activeById,
    removedIds,
    editingId,
    editText,
    editKind,
    setEditText,
    setEditKind,
    onStartEdit: startEdit,
    onSaveEdit: saveEdit,
    onCancelEdit: () => setEditingId(null),
    onDelete: requestDelete,
  };

  return (
    <>
    <div className="settings-card" style={{ marginTop: 'var(--space-5)', padding: 'var(--space-5)' }}>
      <div className="settings-group__label" style={{ marginTop: 0 }}>Manage memory</div>
      <div className="col" style={{ gap: 'var(--space-3)' }}>
        <TextAreaField
          label="Add memory"
          hint={enabled ? 'Saved memories can be used in future server-generated replies.' : 'Memory is off; saved items are retained but not used in replies.'}
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ alignItems: 'end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180, flex: '0 1 220px' }}>
            <SelectMenu
              value={kind}
              label="Type"
              options={MANUAL_MEMORY_KINDS.map((value) => ({ value, label: memoryKindLabel(value) }))}
              onChange={setKind}
            />
          </div>
          <Button variant="primary" icon="plus" loading={saving} disabled={!text.trim()} onClick={add}>Add</Button>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-5)' }}>
        <Segmented
          value={view}
          options={[
            { value: 'structured', label: 'Structured' },
            { value: 'evidence', label: 'Evidence' },
            { value: 'json', label: 'Raw JSON' },
          ]}
          onChange={setView}
        />
      </div>

      {view === 'structured' ? (
        loading ? (
          <div className="setting-row"><Spinner size="sm" /><div className="setting-row__body"><div className="setting-row__sub">Loading memory…</div></div></div>
        ) : error ? (
          <InlineAlert tone="danger">{error}</InlineAlert>
        ) : (
          <StructuredMemoryView profile={profile} actions={structuredActions} />
        )
      ) : (
        <>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Segmented
              value={status}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'suppressed', label: 'Hidden' },
                { value: 'invalidated', label: 'Outdated' },
              ]}
              onChange={setStatus}
            />
          </div>

          {loading ? (
            <div className="setting-row"><Spinner size="sm" /><div className="setting-row__body"><div className="setting-row__sub">Loading memory…</div></div></div>
          ) : error ? (
            <InlineAlert tone="danger">{error}</InlineAlert>
          ) : view === 'json' ? (
            <div className="col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              <div className="setting-row__sub">
                Editing {visibleItems.length} {status === 'active' ? 'active' : status} item(s) as raw JSON. Editable fields: <code>text</code>, <code>kind</code>, <code>status</code>, <code>visibility</code>, <code>pinned</code>, <code>salience</code>. Remove an object to delete it; omit <code>id</code> to create a new one. Basic formatting (code fences, trailing commas) is corrected on save.
              </div>
              <textarea
                className="memory-json-editor"
                spellCheck={false}
                rows={18}
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setJsonError(null); }}
              />
              {jsonError && <InlineAlert tone="danger">{jsonError}</InlineAlert>}
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Button variant="primary" loading={jsonSaving} onClick={saveJson}>Save JSON</Button>
                <Button variant="outline" onClick={formatJson}>Format</Button>
                <Button variant="outline" onClick={() => { setJsonText(memoryToEditableJson(visibleItems)); setJsonError(null); }}>Reset</Button>
              </div>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="setting-row"><div className="setting-row__body"><div className="setting-row__title">No {status === 'active' ? 'active' : status} memories</div><div className="setting-row__sub">Items you add here appear in this list.</div></div></div>
          ) : (
            <div className="col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              {visibleItems.map((item) => (
                <div key={item.id} className="setting-row" style={{ alignItems: 'flex-start' }}>
                  <Avatar size="md" variant={item.visibility === 'top_of_mind' ? 'assistant' : undefined}>
                    <Icon name={item.pinned || item.visibility === 'top_of_mind' ? 'pin' : 'sparkle'} size={16} />
                  </Avatar>
                  <div className="setting-row__body">
                    {editingId === item.id ? (
                      <div className="col" style={{ gap: 'var(--space-2)' }}>
                        <TextAreaField label="Memory text" value={editText} rows={3} onChange={(e) => setEditText(e.target.value)} />
                        <div className="row" style={{ alignItems: 'end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 180, flex: '0 1 220px' }}>
                            <SelectMenu value={editKind} label="Type" options={MANUAL_MEMORY_KINDS.map((value) => ({ value, label: memoryKindLabel(value) }))} onChange={setEditKind} />
                          </div>
                          <Button size="sm" variant="primary" disabled={!editText.trim()} onClick={() => saveEdit(item.id)}>Save</Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="setting-row__title">{item.text}</div>
                        <div className="setting-row__sub">{memoryKindLabel(item.kind)} · {item.visibility.replace(/_/g, ' ')} · salience {item.salience.toFixed(2)}</div>
                        <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
                          {item.status !== 'active' ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => patch(item.id, { status: 'active' }, 'Memory restored')}>Restore</Button>
                              <Button size="sm" variant="outline" onClick={() => startEdit(item)}>Edit</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" onClick={() => startEdit(item)}>Edit</Button>
                              <Button size="sm" variant="outline" onClick={() => patch(item.id, { visibility: item.visibility === 'top_of_mind' ? 'normal' : 'top_of_mind', pinned: item.visibility !== 'top_of_mind' }, item.visibility === 'top_of_mind' ? 'Memory unpinned' : 'Memory pinned')}>{item.visibility === 'top_of_mind' ? 'Unpin' : 'Pin'}</Button>
                              <Button size="sm" variant="outline" onClick={() => patch(item.id, { status: 'suppressed' }, 'Memory hidden')}>Hide</Button>
                              <Button size="sm" variant="outline" onClick={() => patch(item.id, { status: 'invalidated' }, 'Memory marked outdated')}>Outdated</Button>
                            </>
                          )}
                          <Button size="sm" variant="danger" onClick={() => requestDelete([item.id], item.text)}>Delete</Button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
    {pendingDelete && (
      <ConfirmDialog
        title="Delete memory?"
        message={pendingDelete.ids.length > 1
          ? `"${pendingDelete.text.slice(0, 120)}" and its ${pendingDelete.ids.length} source memories will be permanently deleted.`
          : `"${pendingDelete.text.slice(0, 120)}" will be permanently deleted.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => performDelete(pendingDelete.ids)}
        onClose={() => setPendingDelete(null)}
      />
    )}
    </>
  );
}

interface StructuredActions {
  activeById: Map<string, MemoryRecord>;
  removedIds: Set<string>;
  editingId: string | null;
  editText: string;
  editKind: Exclude<MemoryKind, 'thread_summary' | 'entity'>;
  setEditText: (v: string) => void;
  setEditKind: (v: Exclude<MemoryKind, 'thread_summary' | 'entity'>) => void;
  onStartEdit: (memory: MemoryRecord) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (ids: string[], text: string) => void;
}

function StructuredMemoryView({ profile, actions }: { profile: MemoryProfileView | null; actions: StructuredActions }) {
  if (!profile || profile.evidenceCount === 0) {
    return <div className="setting-row"><div className="setting-row__body"><div className="setting-row__title">No structured memory yet</div><div className="setting-row__sub">As Watai learns, memories will appear as a profile tree.</div></div></div>;
  }
  const user = profile.profile.user;
  const work = profile.profile.work;
  return (
    <div className="col" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
      <TreeSection title="User" icon="user">
        <TreeSection title="Family" compact>
          <TreeList title="Pets" actions={actions} items={user.family.pets.map((pet) => ({ text: `${pet.name}${pet.species ? ` · ${pet.species}` : ''}${pet.inspiredBy.length ? ` · inspired by ${pet.inspiredBy.join(', ')}` : ''}`, confidence: pet.confidence, sourceMemoryIds: pet.sourceMemoryIds }))} />
          <TreeList title="Spouse" actions={actions} items={user.family.spouse} />
          <TreeList title="Children" actions={actions} items={user.family.children} />
        </TreeSection>
        <TreeSection title="Preferences" compact>
          <TreeList title="Communication" actions={actions} items={user.preferences.communication} />
          <TreeList title="Engineering" actions={actions} items={user.preferences.engineering} />
          <TreeList title="Design" actions={actions} items={user.preferences.design} />
          <TreeList title="Tools" actions={actions} items={user.preferences.tools} />
          <TreeList title="Other" actions={actions} items={user.preferences.other} />
        </TreeSection>
        <TreeSection title="Interests" compact>
          <TreeList title="Media" actions={actions} items={user.interests.media.map((interest) => ({ text: interest.name, confidence: 1, sourceMemoryIds: interest.sourceMemoryIds }))} />
        </TreeSection>
      </TreeSection>

      <TreeSection title="Work" icon="code">
        <TreeList title="Projects" actions={actions} items={work.projects} />
        <TreeList title="Repositories" actions={actions} items={work.repositories} />
        <TreeList title="Deployments" actions={actions} items={work.deployments} />
        <TreeList title="Current focus" actions={actions} items={work.currentFocus} />
      </TreeSection>

      <TreeSection title="Recent" icon="history">
        <TreeList title="Today" actions={actions} items={profile.temporal.today.items.map((item) => ({ text: item.text, confidence: 1, sourceMemoryIds: [item.memoryId] }))} />
        <TreeList title="This week" actions={actions} items={profile.temporal.week.items.map((item) => ({ text: item.text, confidence: 1, sourceMemoryIds: [item.memoryId] }))} />
      </TreeSection>

      <TreeSection title="Avoidances" icon="alert">
        <TreeList title="Do not use" actions={actions} items={profile.profile.avoidances} />
      </TreeSection>
    </div>
  );
}

function TreeSection({ title, icon, compact, children }: { title: string; icon?: string; compact?: boolean; children: React.ReactNode }) {
  return (
    <div className={`memory-tree ${compact ? 'memory-tree--compact' : ''}`}>
      <div className="memory-tree__head">
        {icon && <Icon name={icon} size={16} />}
        <span>{title}</span>
      </div>
      <div className="memory-tree__body">{children}</div>
    </div>
  );
}

function TreeList({ title, items, actions }: { title: string; items: MemoryProfileItem[]; actions: StructuredActions }) {
  const visible = items.filter((item) => !item.sourceMemoryIds.length || !item.sourceMemoryIds.every((id) => actions.removedIds.has(id)));
  if (!visible.length) return null;
  return (
    <div className="memory-tree__group">
      <div className="memory-tree__label">{title}</div>
      {visible.map((item, index) => {
        const sourceId = item.sourceMemoryIds[0];
        const record = sourceId ? actions.activeById.get(sourceId) : undefined;
        const isEditing = !!sourceId && actions.editingId === sourceId;
        return (
          <div key={`${title}-${index}-${item.sourceMemoryIds.join('-')}`} className="memory-tree__item">
            {isEditing && record ? (
              <div className="col" style={{ gap: 'var(--space-2)', width: '100%' }}>
                <TextAreaField label="Memory text" value={actions.editText} rows={3} onChange={(e) => actions.setEditText(e.target.value)} />
                <div className="row" style={{ alignItems: 'end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 180, flex: '0 1 220px' }}>
                    <SelectMenu value={actions.editKind} label="Type" options={MANUAL_MEMORY_KINDS.map((value) => ({ value, label: memoryKindLabel(value) }))} onChange={actions.setEditKind} />
                  </div>
                  <Button size="sm" variant="primary" disabled={!actions.editText.trim()} onClick={() => actions.onSaveEdit(sourceId)}>Save</Button>
                  <Button size="sm" variant="outline" onClick={actions.onCancelEdit}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%' }}>
                <span style={{ flex: 1, minWidth: 0 }}>{item.text}</span>
                <span className="memory-tree__item-actions">
                  {record && <IconButton name="edit" label="Edit" size={16} onClick={() => actions.onStartEdit(record)} />}
                  {!!item.sourceMemoryIds.length && <IconButton name="trash" label="Delete" size={16} onClick={() => actions.onDelete(item.sourceMemoryIds, item.text)} />}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
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
      <Switch
        checked={available && checked}
        onChange={onChange}
        disabled={!available}
        label={label}
      />
    </div>
  );
}

function ToolsBody({ ctx }: { ctx: SettingsCtx }) {
  const { settings, setSettings } = ctx;
  const pushToast = useUi((s) => s.pushToast);
  const t = settings.tools ?? DEFAULT_SETTINGS.tools!;
  const [caps, setCaps] = useState<CredentialCapabilities | null>(null);

  useEffect(() => {
    cloudApi
      .getCredentialStatus()
      .then((s) => setCaps(s.capabilities ?? null))
      .catch(() => undefined);
  }, []);

  const setTool = (patch: Partial<NonNullable<SettingsModel['tools']>>) =>
    setSettings({ ...settings, tools: { ...t, ...patch } });

  return (
    <>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Agentic mode</div>
            <div className="setting-row__sub">
              Let the assistant use tools — search, code, images, and your files.
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
          available={caps?.image ?? true}
        />
        <ToolToggle
          label="Code interpreter"
          sub="Run Python for math, data, and charts."
          checked={t.codeInterpreter}
          onChange={(v) => setTool({ codeInterpreter: v })}
          available={caps?.codeInterpreter ?? false}
          hint="Needs an Azure AI Foundry endpoint."
        />
        <ToolToggle
          label="Web search"
          sub="Search the web and cite sources."
          checked={caps?.webSearch ?? false}
          onChange={() => pushToast('Manage the web-search key in Models & keys', 'info')}
          available
        />
        <ToolToggle
          label="File search"
          sub="Answer from each chat's uploaded documents."
          checked={t.fileSearch}
          onChange={(v) => setTool({ fileSearch: v })}
          available={caps?.fileSearch ?? false}
          hint="Needs an Azure AI Foundry endpoint."
        />
      </div>

      <div className="settings-note" style={{ marginTop: 'var(--space-5)' }}>
        <p>
          Your endpoint, keys, and account knowledge base live in <strong>Models &amp; keys</strong>. To
          give a single chat its own documents, open that chat&apos;s <strong>Files</strong> panel.
        </p>
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
        <div className="setting-row setting-row--flush">
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
          <Avatar size="md" variant="assistant">
            <Icon name="check-circle" size={18} />
          </Avatar>
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
          <Avatar size="md" variant="assistant">
            <Icon name="download" size={18} />
          </Avatar>
          <div className="setting-row__body">
            <div className="setting-row__title">Export all data</div>
            <div className="setting-row__sub">Download a JSON archive of your chats and settings.</div>
          </div>
          <Icon name="chevron-right" size={18} className="muted" />
        </button>
        <button className="setting-row" onClick={() => setConfirm(true)}>
          <Avatar size="md" variant="danger">
            <Icon name="trash" size={18} />
          </Avatar>
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

function MemoryModelsBody() {
  const pushToast = useUi((s) => s.pushToast);
  const [config, setConfig] = useState<MemoryModelConfig | null>(null);
  const [base, setBase] = useState('');
  const [deep, setDeep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: MemoryModelConfig) => {
    setConfig(next);
    setBase(next.base.override ?? '');
    setDeep(next.deep.override ?? '');
  };

  const refresh = () => {
    cloudApi
      .getMemoryModelConfig()
      .then(apply)
      .catch(() => setConfig(null));
  };
  useEffect(refresh, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await cloudApi.setMemoryModels({ memoryModel: base.trim(), memoryDeepModel: deep.trim() }));
      pushToast('Memory models updated', 'success');
    } catch {
      setError('Could not update the memory models. Check the deployment names and try again.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      apply(await cloudApi.setMemoryModels({ memoryModel: '', memoryDeepModel: '' }));
      pushToast('Reverted to the server defaults');
    } catch {
      pushToast('Could not reset the memory models', 'error');
    } finally {
      setBusy(false);
    }
  };

  const slotBadge = (slot?: MemoryModelConfig['base']) =>
    slot?.source === 'override'
      ? 'Custom override'
      : slot?.source === 'env'
        ? 'Server default'
        : slot?.source === 'base'
          ? 'Same as routine'
          : 'Each user’s chat model';
  const slotValue = (slot?: MemoryModelConfig['base']) => slot?.model ?? 'Each user’s own chat model';

  const dirty =
    (base.trim() || null) !== (config?.base.override ?? null) || (deep.trim() || null) !== (config?.deep.override ?? null);
  const hasOverride = !!(config?.base.override || config?.deep.override);
  const baseHint = config?.base.envDefault
    ? `Leave blank to use the server default (${config.base.envDefault}).`
    : 'Leave blank to fall back to each user’s own chat model.';
  const deepHint = config?.deep.envDefault
    ? `Used for rebuilds, merges, and conflict resolution. Leave blank to use the server default (${config.deep.envDefault}).`
    : 'Used for rebuilds, merges, and conflict resolution. Leave blank to reuse the routine model.';

  return (
    <>
      <p className="muted" style={{ marginBottom: 'var(--space-5)' }}>
        Memories are learned in the background by separate, server-decided models so the experience
        stays fast and economical. Members never choose these — they do not change the model used for
        chat. A lighter model handles routine learning; a stronger model handles heavier work like
        rebuilds and conflict resolution. Update them here as better or cheaper models become available.
      </p>

      <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
        <div className="setting-row" style={{ paddingTop: 0 }}>
          <div className="setting-row__body">
            <div className="setting-row__title">Routine learning</div>
            <div className="setting-row__sub">{slotValue(config?.base)}</div>
          </div>
          <span className={`badge ${config?.base.source === 'override' ? 'badge--accent' : ''}`}>{slotBadge(config?.base)}</span>
        </div>
        <Field
          label="Routine model deployment"
          placeholder={config?.base.envDefault ?? 'e.g. gpt-5.4-mini'}
          value={base}
          onChange={(e) => setBase(e.target.value)}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          hint={baseHint}
        />

        <div className="setting-row" style={{ marginTop: 'var(--space-4)' }}>
          <div className="setting-row__body">
            <div className="setting-row__title">Deep operations</div>
            <div className="setting-row__sub">{slotValue(config?.deep)}</div>
          </div>
          <span className={`badge ${config?.deep.source === 'override' ? 'badge--accent' : ''}`}>{slotBadge(config?.deep)}</span>
        </div>
        <Field
          label="Deep model deployment"
          placeholder={config?.deep.envDefault ?? config?.base.model ?? 'e.g. gpt-5.4'}
          value={deep}
          onChange={(e) => setDeep(e.target.value)}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          error={error ?? undefined}
          hint={deepHint}
        />

        <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <Button icon="check" loading={busy} disabled={!dirty} onClick={() => void save()}>
            Save models
          </Button>
          {hasOverride ? (
            <Button icon="refresh" variant="outline" loading={busy} onClick={() => void reset()}>
              Reset to defaults
            </Button>
          ) : null}
        </div>
      </div>

      {config?.updatedBy ? (
        <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
          Last changed by {config.updatedBy}
          {config.updatedAt ? ` on ${new Date(config.updatedAt).toLocaleString()}` : ''}.
        </p>
      ) : null}
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
          <div className="text-strong" style={{ fontSize: 'var(--text-title-2-size)' }}>Watai</div>
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
          <Avatar size="md" variant="assistant">
            <Icon name="external" size={18} />
          </Avatar>
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
