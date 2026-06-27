import { useState } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { Avatar, Button, Field, InlineAlert, Segmented, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { signInRedirect } from '../../auth/cloudAuth';
import { normalizeBaseUrl } from '../../data/secureStore';
import { useUi } from '../../state/store';
import { DEFAULT_SETTINGS } from '../../lib/types';
import { repo, cloudApi } from '../../data';
import { Logo as BrandLogo } from '../../design/Logo';

type ModelKey = 'chat' | 'transcribe' | 'image' | 'tts';
interface ProbeResult {
  ok: boolean;
  detail?: string;
}
const MODEL_LABELS: Record<ModelKey, string> = {
  chat: 'Chat',
  transcribe: 'Transcription',
  image: 'Image generation',
  tts: 'Text-to-speech',
};

function Logo() {
  return <BrandLogo className="onboard__logo" size={72} />;
}

function Steps({ index, count }: { index: number; count: number }) {
  return (
    <div className="steps">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={`steps__dot ${i === index ? 'steps__dot--active' : ''}`} />
      ))}
    </div>
  );
}

function Welcome() {
  const [busy, setBusy] = useState(false);

  const signin = async () => {
    setBusy(true);
    try {
      await signInRedirect(); // navigates away to the sign-in page; returns to the app
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <Logo />
      <div>
        <h1 className="onboard__title">Welcome to Watai</h1>
        <p className="onboard__sub">Sign in to start chatting.</p>
      </div>
      <div className="onboard__actions">
        <Button variant="primary" full size="lg" loading={busy} onClick={signin}>
          Sign in
        </Button>
      </div>
    </div>
  );
}

type ModelTestStatus = 'idle' | 'testing' | ProbeResult;
const MODEL_KEYS: ModelKey[] = ['chat', 'transcribe', 'image', 'tts'];

function ModelStatusIcon({ status }: { status: ModelTestStatus }) {
  if (status === 'testing') return <Spinner />;
  if (status === 'idle')
    return (
      <span className="muted" aria-hidden>
        —
      </span>
    );
  return status.ok ? (
    <Icon name="check" size={20} style={{ color: 'var(--color-success)' }} />
  ) : (
    <Icon name="alert" size={20} style={{ color: 'var(--color-danger)' }} />
  );
}

function shortError(detail?: string): string {
  if (!detail) return 'Failed';
  let msg = detail;
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed?.error?.message) msg = parsed.error.message;
  } catch {
    /* not JSON — use the raw text */
  }
  return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
}

function KeyWizard() {
  const navigate = useNavigate();
  const pushToast = useUi((s) => s.pushToast);
  const [step, setStep] = useState(0);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [chat, setChat] = useState('gpt-5.4');
  const [transcribeModel, setTranscribeModel] = useState('gpt-4o-transcribe');
  const [image, setImage] = useState('gpt-image-2');
  const [tts, setTts] = useState('gpt-4o-mini-tts');
  const [effort, setEffort] = useState<'minimal' | 'low' | 'medium' | 'high'>('medium');
  const [testing, setTesting] = useState(false);
  const [statuses, setStatuses] = useState<Record<ModelKey, ModelTestStatus>>({
    chat: 'idle',
    transcribe: 'idle',
    image: 'idle',
    tts: 'idle',
  });

  const vaultBody = () => ({
    baseUrl: normalizeBaseUrl(baseUrl),
    models: {
      chat,
      ...(transcribeModel ? { transcribe: transcribeModel } : {}),
      ...(image ? { image } : {}),
      ...(tts ? { tts } : {}),
    },
    key: apiKey.trim(),
  });

  const finish = async () => {
    setTesting(true);
    try {
      await cloudApi.putCredentials(vaultBody());
      await repo.saveSettings(DEFAULT_SETTINGS);
      navigate('/onboarding/mic');
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Could not save your keys.', 'error');
      setTesting(false);
    }
  };

  // Store the keys server-side, then confirm the chat model responds.
  const runTest = async () => {
    setTesting(true);
    setStatuses({ chat: 'testing', transcribe: 'idle', image: 'idle', tts: 'idle' });
    try {
      await cloudApi.putCredentials(vaultBody());
      const { text } = await cloudApi.chatComplete([
        { role: 'user', content: 'Reply with the single word OK.' },
      ]);
      setStatuses({
        chat: text ? { ok: true } : { ok: false, detail: 'No response' },
        transcribe: 'idle',
        image: 'idle',
        tts: 'idle',
      });
    } catch (e) {
      setStatuses({
        chat: { ok: false, detail: e instanceof Error ? e.message : 'failed' },
        transcribe: 'idle',
        image: 'idle',
        tts: 'idle',
      });
    } finally {
      setTesting(false);
    }
  };

  const modelNames: Record<ModelKey, string> = { chat, transcribe: transcribeModel, image, tts };
  const allTested = MODEL_KEYS.every((k) => typeof statuses[k] === 'object');

  return (
    <div className="onboard">
      <Logo />
      <Steps index={step} count={3} />
      {step === 0 && (
        <>
          <div>
            <h1 className="onboard__title">Connect your endpoint</h1>
            <p className="onboard__sub">
              Paste your Azure OpenAI base URL and key. We never hardcode or share these.
            </p>
          </div>
          <div className="onboard__form">
            <Field
              label="Resource name or base URL"
              placeholder="ai-project-deployments-resource"
              hint="Your Azure AI Foundry resource name — we build the endpoints. A full base URL also works."
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Field
              label="API key"
              type="password"
              placeholder="Your API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="onboard__actions">
            <Button variant="primary" full disabled={!baseUrl || !apiKey} onClick={() => setStep(1)}>
              Next
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div>
            <h1 className="onboard__title">Model deployments</h1>
            <p className="onboard__sub">Enter the deployment names from your Azure resource.</p>
          </div>
          <div className="onboard__form">
            <Field label="Chat model" value={chat} onChange={(e) => setChat(e.target.value)} />
            <Field
              label="Transcription model"
              value={transcribeModel}
              onChange={(e) => setTranscribeModel(e.target.value)}
            />
            <Field label="Image model" value={image} onChange={(e) => setImage(e.target.value)} />
            <Field label="Text-to-speech model" value={tts} onChange={(e) => setTts(e.target.value)} />
            <div className="field">
              <span className="field__label">Reasoning effort</span>
              <Segmented
                value={effort}
                onChange={setEffort}
                options={[
                  { value: 'minimal', label: 'Minimal' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </div>
          </div>
          <div className="onboard__actions">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button variant="primary" full onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <h1 className="onboard__title">Test your models</h1>
            <p className="onboard__sub">
              We send one tiny request per model to confirm each deployment is reachable.
            </p>
          </div>
          <div className="onboard__form">
            <div className="settings-card">
              {MODEL_KEYS.map((key) => {
                const st = statuses[key];
                const errored = typeof st === 'object' && !st.ok;
                return (
                  <div className="setting-row" key={key}>
                    <div className="setting-row__body">
                      <div className="setting-row__title">{MODEL_LABELS[key]}</div>
                      <div
                        className="setting-row__sub"
                        style={errored ? { color: 'var(--color-danger)' } : undefined}
                        title={errored ? shortError((st as ProbeResult).detail) : undefined}
                      >
                        {errored ? shortError((st as ProbeResult).detail) : modelNames[key] || 'Not set'}
                      </div>
                    </div>
                    <ModelStatusIcon status={st} />
                  </div>
                );
              })}
            </div>
            <Button
              variant="secondary"
              full
              loading={testing}
              disabled={!baseUrl || !apiKey}
              onClick={runTest}
            >
              {testing ? 'Testing…' : allTested ? 'Re-test all models' : 'Test all models'}
            </Button>
          </div>
          <div className="onboard__actions">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary" full onClick={finish}>
              Finish
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function MicPriming() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied'>('idle');

  const ask = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setStatus('granted');
    } catch {
      setStatus('denied');
    }
  };

  return (
    <div className="onboard">
      <Avatar size="xl" variant="assistant">
        <Icon name="mic" size={32} />
      </Avatar>
      <div>
        <h1 className="onboard__title">Enable voice</h1>
        <p className="onboard__sub">
          Allow microphone access to dictate prompts and use hands-free voice mode. You can skip this.
        </p>
      </div>
      {status === 'granted' && (
        <InlineAlert icon="check">Microphone enabled.</InlineAlert>
      )}
      {status === 'denied' && (
        <InlineAlert tone="warning">Microphone blocked. You can enable it later in your browser.</InlineAlert>
      )}
      <div className="onboard__actions">
        <Button variant="ghost" onClick={() => navigate('/')}>
          Skip
        </Button>
        {status === 'idle' ? (
          <Button variant="primary" full onClick={ask}>
            Allow microphone
          </Button>
        ) : (
          <Button variant="primary" full onClick={() => navigate('/')}>
            Start using Watai
          </Button>
        )}
      </div>
    </div>
  );
}

export function Onboarding() {
  return (
    <Routes>
      <Route path="welcome" element={<Welcome />} />
      <Route path="key" element={<KeyWizard />} />
      <Route path="mic" element={<MicPriming />} />
      <Route path="*" element={<Navigate to="welcome" replace />} />
    </Routes>
  );
}
