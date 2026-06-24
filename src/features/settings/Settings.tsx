import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from './useSettings';
import { Button, Field, IconButton, Segmented, Switch, TextAreaField } from '../../design/ui';
import { Icon } from '../../design/icons';
import { Logo } from '../../design/Logo';
import { ConfirmDialog } from '../../design/overlays';
import { useUi } from '../../state/store';
import { repo, cloudApi } from '../../data';
import { signOut, getSignedInAccount } from '../../auth/cloudAuth';
import { useMe } from '../../auth/access';
import type { InviteRecord } from '../../data/cloud/types';
import {
  getApiConfig,
  saveApiConfig,
  saveApiKey,
  getApiKey,
  clearApiCredentials,
  normalizeBaseUrl,
} from '../../data/secureStore';
import type { ApiConfig, Settings as SettingsModel, TextScale } from '../../lib/types';

const SECTIONS = [
  { id: 'account', label: 'Account', icon: 'user', sub: 'Profile and session' },
  { id: 'models', label: 'Models & keys', icon: 'key', sub: 'Endpoint and deployments' },
  { id: 'personalization', label: 'Personalization', icon: 'sparkle', sub: 'Custom instructions and memory' },
  { id: 'voice', label: 'Voice', icon: 'mic', sub: 'Dictation and read-aloud' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', sub: 'Theme, text size, density' },
  { id: 'data', label: 'Data controls', icon: 'database', sub: 'Export, retention, delete' },
  { id: 'about', label: 'About', icon: 'info', sub: 'Version and links' },
];

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

  if (!section) return <SettingsHub onOpen={(id) => navigate(`/settings/${id}`)} onClose={() => navigate(-1)} />;

  const back = () => navigate('/settings');
  switch (section) {
    case 'account':
      return <AccountSection onBack={back} />;
    case 'models':
      return <ModelsSection onBack={back} />;
    case 'personalization':
      return <PersonalizationSection onBack={back} />;
    case 'voice':
      return <VoiceSection onBack={back} />;
    case 'appearance':
      return <AppearanceSection onBack={back} />;
    case 'data':
      return <DataSection onBack={back} />;
    case 'invites':
      return <InvitesSection onBack={back} />;
    case 'about':
      return <AboutSection onBack={back} />;
    default:
      return <SettingsHub onOpen={(id) => navigate(`/settings/${id}`)} onClose={() => navigate('/new')} />;
  }
}

/** The signed-in cloud account's display name (or username), or null while loading. */
function useCloudAccountName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    getSignedInAccount()
      .then((a) => setName(a?.name ?? a?.username ?? null))
      .catch(() => undefined);
  }, []);
  return name;
}

function SettingsHub({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const account = useCloudAccountName();
  const me = useMe();
  return (
    <>
      <Header title="Settings" onBack={onClose} />
      <div className="page">
        <div className="page__inner">
          <div className="row" style={{ marginBottom: 'var(--space-6)' }}>
            <span className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>
              {(account ?? 'Y').slice(0, 1).toUpperCase()}
            </span>
            <div>
              <div style={{ fontSize: 'var(--text-title-3-size)', fontWeight: 600 }}>{account ?? 'Your account'}</div>
              <div className="muted" style={{ fontSize: 'var(--text-caption-size)' }}>
                Cloud account
              </div>
            </div>
          </div>

          <div className="settings-card">
            {SECTIONS.map((s) => (
              <button key={s.id} className="setting-row" onClick={() => onOpen(s.id)}>
                <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
                  <Icon name={s.icon} size={18} />
                </span>
                <div className="setting-row__body">
                  <div className="setting-row__title">{s.label}</div>
                  <div className="setting-row__sub">{s.sub}</div>
                </div>
                <Icon name="chevron-right" size={18} className="muted" />
              </button>
            ))}
            {me?.isAdmin && (
              <button key="invites" className="setting-row" onClick={() => onOpen('invites')}>
                <span className="avatar avatar--assistant" style={{ width: 36, height: 36 }}>
                  <Icon name="user-add" size={18} />
                </span>
                <div className="setting-row__body">
                  <div className="setting-row__title">Invites</div>
                  <div className="setting-row__sub">Manage who can sign in</div>
                </div>
                <Icon name="chevron-right" size={18} className="muted" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <>
      <Header title={title} onBack={onBack} />
      <div className="page">
        <div className="page__inner">{children}</div>
      </div>
    </>
  );
}

function AccountSection({ onBack }: { onBack: () => void }) {
  const account = useCloudAccountName();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Section title="Account" onBack={onBack}>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Signed in as</div>
            <div className="setting-row__value">{account ?? 'Your account'}</div>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Storage</div>
            <div className="setting-row__sub">
              Your chats and images are synced to your account and cached on this device.
            </div>
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
    </Section>
  );
}

function ModelsSection({ onBack }: { onBack: () => void }) {
  const pushToast = useUi((s) => s.pushToast);
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [key, setKey] = useState('');

  useEffect(() => {
    getApiConfig().then(setConfig);
    getApiKey().then((k) => setKey(k ?? ''));
  }, []);

  if (!config) return <Section title="Models & keys" onBack={onBack}><p className="muted">Loading…</p></Section>;

  const update = (patch: Partial<ApiConfig>) => setConfig({ ...config, ...patch });
  const updateModels = (patch: Partial<ApiConfig['models']>) =>
    setConfig({ ...config, models: { ...config.models, ...patch } });

  const save = async () => {
    await saveApiConfig({ ...config, baseUrl: normalizeBaseUrl(config.baseUrl) });
    await saveApiKey(key.trim());
    pushToast('Saved', 'success');
  };

  return (
    <Section title="Models & keys" onBack={onBack}>
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
    </Section>
  );
}

function PersonalizationSection({ onBack }: { onBack: () => void }) {
  const { settings, setSettings } = useSettings();
  const pushToast = useUi((s) => s.pushToast);
  const p = settings.personalization;
  return (
    <Section title="Personalization" onBack={onBack}>
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
    </Section>
  );
}

function VoiceSection({ onBack }: { onBack: () => void }) {
  const { settings, setSettings } = useSettings();
  const v = settings.voice;
  const set = (patch: Partial<typeof v>) => setSettings({ ...settings, voice: { ...v, ...patch } });
  return (
    <Section title="Voice" onBack={onBack}>
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
    </Section>
  );
}

function AppearanceSection({ onBack }: { onBack: () => void }) {
  const { settings, setSettings } = useSettings();
  const a = settings.appearance;
  const set = (patch: Partial<typeof a>) => setSettings({ ...settings, appearance: { ...a, ...patch } });
  return (
    <Section title="Appearance" onBack={onBack}>
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
            <Switch
              checked={a.reduceMotion === true}
              onChange={(x) => set({ reduceMotion: x })}
              label="Reduce motion"
            />
          </div>
        </div>
      </div>
    </Section>
  );
}

function CloudSyncCard({ loaded }: { loaded: boolean }) {
  const [accountName, setAccountName] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) {
      getSignedInAccount()
        .then((a) => setAccountName(a?.username ?? a?.name ?? null))
        .catch(() => undefined);
    }
  }, [loaded]);

  return (
    <div className="settings-card">
      <div className="setting-row">
        <div className="setting-row__body">
          <div className="setting-row__title">Cloud sync</div>
          <div className="setting-row__sub">
            {accountName
              ? `On · signed in as ${accountName}`
              : 'Your chats and images sync to your account across all your devices.'}
          </div>
        </div>
        <Icon name="check-circle" size={20} style={{ color: 'var(--color-success)' }} />
      </div>
    </div>
  );
}

function DataSection({ onBack }: { onBack: () => void }) {
  const { settings, setSettings, loaded } = useSettings();
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
    <Section title="Data controls" onBack={onBack}>
      <CloudSyncCard loaded={loaded} />
      <div className="settings-card">
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
        <button className="setting-row" onClick={exportData}>
          <div className="setting-row__body">
            <div className="setting-row__title">Export all data</div>
            <div className="setting-row__sub">Download a JSON archive.</div>
          </div>
          <Icon name="download" size={18} className="muted" />
        </button>
        <button className="setting-row" onClick={() => setConfirm(true)}>
          <div className="setting-row__body">
            <div className="setting-row__title" style={{ color: 'var(--color-danger)' }}>
              Delete all conversations
            </div>
            <div className="setting-row__sub">Permanently removes local data.</div>
          </div>
          <Icon name="trash" size={18} style={{ color: 'var(--color-danger)' }} />
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
    </Section>
  );
}

function InvitesSection({ onBack }: { onBack: () => void }) {
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
    <Section title="Invites" onBack={onBack}>
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
    </Section>
  );
}

function AboutSection({ onBack }: { onBack: () => void }) {
  return (
    <Section title="About" onBack={onBack}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 'var(--space-4)', padding: 'var(--space-7) 0' }}>
        <Logo size={64} />
        <div>
          <div style={{ fontSize: 'var(--text-title-2-size)', fontWeight: 600 }}>Watai</div>
          <div className="muted">Version 0.1.0</div>
        </div>
        <p className="muted" style={{ maxWidth: '40ch' }}>
          A privacy-first AI client. Your endpoint, your key, your data — running entirely in your browser.
        </p>
      </div>
    </Section>
  );
}
