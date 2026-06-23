import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettings } from './useSettings';
import { Button, Field, IconButton, Segmented, Switch, TextAreaField } from '../../design/ui';
import { Icon } from '../../design/icons';
import { ConfirmDialog } from '../../design/overlays';
import { useUi } from '../../state/store';
import { repo } from '../../data';
import {
  getApiConfig,
  saveApiConfig,
  saveApiKey,
  getApiKey,
  clearApiCredentials,
  normalizeBaseUrl,
} from '../../data/secureStore';
import { endSession, getSession } from '../../lib/session';
import type { ApiConfig, TextScale } from '../../lib/types';

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
    case 'about':
      return <AboutSection onBack={back} />;
    default:
      return <SettingsHub onOpen={(id) => navigate(`/settings/${id}`)} onClose={() => navigate('/new')} />;
  }
}

function SettingsHub({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const session = getSession();
  return (
    <>
      <Header title="Settings" onBack={onClose} />
      <div className="page">
        <div className="page__inner">
          <div className="row" style={{ marginBottom: 'var(--space-6)' }}>
            <span className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>
              {(session?.name ?? 'Y').slice(0, 1).toUpperCase()}
            </span>
            <div>
              <div style={{ fontSize: 'var(--text-title-3-size)', fontWeight: 600 }}>{session?.name ?? 'You'}</div>
              <div className="muted" style={{ fontSize: 'var(--text-caption-size)' }}>
                Local profile
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
  const navigate = useNavigate();
  const session = getSession();
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title="Account" onBack={onBack}>
      <div className="settings-card">
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Display name</div>
          </div>
          <div className="setting-row__value">{session?.name ?? 'You'}</div>
        </div>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Storage</div>
            <div className="setting-row__sub">Conversations and images are stored locally in this browser.</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Button variant="outline" icon="logout" onClick={() => setConfirm(true)}>
          Sign out of local profile
        </Button>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Sign out?"
          message="This clears your local session. Your conversations remain on this device."
          confirmLabel="Sign out"
          danger
          onConfirm={() => {
            endSession();
            navigate('/onboarding/welcome');
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </Section>
  );
}

function ModelsSection({ onBack }: { onBack: () => void }) {
  const pushToast = useUi((s) => s.pushToast);
  const setMockAi = useUi((s) => s.setMockAi);
  const mockAi = useUi((s) => s.mockAi);
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
            label="Base URL"
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

      <div className="settings-card" style={{ marginTop: 'var(--space-5)' }}>
        <div className="setting-row">
          <div className="setting-row__body">
            <div className="setting-row__title">Demo (mock) mode</div>
            <div className="setting-row__sub">Simulate responses without spending tokens.</div>
          </div>
          <Switch checked={mockAi} onChange={setMockAi} label="Demo mode" />
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

function DataSection({ onBack }: { onBack: () => void }) {
  const { settings, setSettings } = useSettings();
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

function AboutSection({ onBack }: { onBack: () => void }) {
  const setMockAi = useUi((s) => s.setMockAi);
  return (
    <Section title="About" onBack={onBack}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 'var(--space-4)', padding: 'var(--space-7) 0' }}>
        <img src="./favicon.svg" alt="" width={64} height={64} />
        <div>
          <div style={{ fontSize: 'var(--text-title-2-size)', fontWeight: 600 }}>Watai</div>
          <div className="muted">Version 0.1.0</div>
        </div>
        <p className="muted" style={{ maxWidth: '40ch' }}>
          A privacy-first AI client. Your endpoint, your key, your data — running entirely in your browser.
        </p>
      </div>
      <div className="settings-card">
        <button className="setting-row" onClick={() => setMockAi(false)}>
          <div className="setting-row__body">
            <div className="setting-row__title">Use real endpoint</div>
          </div>
          <Icon name="link" size={18} className="muted" />
        </button>
      </div>
    </Section>
  );
}
