import { useState } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { Button, Field, Segmented } from '../../design/ui';
import { Icon } from '../../design/icons';
import { startSession } from '../../lib/session';
import { normalizeBaseUrl, saveApiConfig, saveApiKey } from '../../data/secureStore';
import { probe } from '../../ai/capabilities';
import { useUi } from '../../state/store';
import { DEFAULT_SETTINGS, type ApiConfig } from '../../lib/types';
import { repo } from '../../data';
import { Logo as BrandLogo } from '../../design/Logo';

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
  const navigate = useNavigate();
  return (
    <div className="onboard">
      <Logo />
      <div>
        <h1 className="onboard__title">Welcome to Watai</h1>
        <p className="onboard__sub">
          Chat and talk with AI using your own Azure OpenAI endpoint. Your key stays on your device.
        </p>
      </div>
      <div className="col" style={{ width: '100%', textAlign: 'left', gap: 12 }}>
        <Feature icon="shield" title="Bring your own key" sub="Calls go directly from your browser to your endpoint." />
        <Feature icon="mic" title="Voice & dictation" sub="Speak your prompts, hear responses read aloud." />
        <Feature icon="image" title="Generate images" sub="Create and save images locally." />
      </div>
      <div className="onboard__actions">
        <Button variant="primary" full size="lg" onClick={() => navigate('/onboarding/auth')}>
          Get started
        </Button>
      </div>
    </div>
  );
}

function Feature({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className="avatar avatar--assistant" style={{ width: 36, height: 36, flex: '0 0 auto' }}>
        <Icon name={icon} size={18} />
      </span>
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="muted" style={{ fontSize: 'var(--text-caption-size)' }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function Auth() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  return (
    <div className="onboard">
      <Logo />
      <div>
        <h1 className="onboard__title">Create your local profile</h1>
        <p className="onboard__sub">Accounts and cloud sync arrive later. For now everything stays on this device.</p>
      </div>
      <div className="onboard__form">
        <Field
          label="Display name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="onboard__actions">
        <Button variant="ghost" onClick={() => navigate('/onboarding/welcome')}>
          Back
        </Button>
        <Button
          variant="primary"
          full
          onClick={() => {
            startSession(name);
            navigate('/onboarding/key');
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

function KeyWizard() {
  const navigate = useNavigate();
  const setMockAi = useUi((s) => s.setMockAi);
  const [step, setStep] = useState(0);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [chat, setChat] = useState('gpt-5.4');
  const [transcribeModel, setTranscribeModel] = useState('gpt-4o-transcribe');
  const [image, setImage] = useState('gpt-image-2');
  const [tts, setTts] = useState('gpt-4o-mini-tts');
  const [effort, setEffort] = useState<'minimal' | 'low' | 'medium' | 'high'>('medium');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; detail?: string } | null>(null);

  const buildConfig = (): ApiConfig => ({
    baseUrl: normalizeBaseUrl(baseUrl),
    models: { chat, transcribe: transcribeModel, image, tts },
    chatDefaults: { reasoningEffort: effort, maxCompletionTokens: 4096 },
    keyEncrypted: false,
  });

  const finish = async () => {
    await saveApiConfig(buildConfig());
    await saveApiKey(apiKey.trim());
    await repo.saveSettings(DEFAULT_SETTINGS);
    setMockAi(false);
    navigate('/onboarding/mic');
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    await saveApiConfig(buildConfig());
    await saveApiKey(apiKey.trim());
    const r = await probe(buildConfig());
    setResult({ ok: r.ok, detail: r.detail });
    setTesting(false);
  };

  const skipWithMock = () => {
    setMockAi(true);
    startMockProfile();
    navigate('/onboarding/mic');
  };

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
              label="Base URL"
              placeholder="https://your-resource.services.ai.azure.com/openai/v1"
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
            <Button variant="ghost" onClick={skipWithMock}>
              Explore in demo mode
            </Button>
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
            <h1 className="onboard__title">Test the connection</h1>
            <p className="onboard__sub">We'll send a tiny request to confirm your key and chat model.</p>
          </div>
          <div className="onboard__form">
            {result && (
              <div className={`alert ${result.ok ? '' : 'alert--danger'}`}>
                <span className="alert__icon">
                  <Icon name={result.ok ? 'check' : 'alert'} size={18} />
                </span>
                <span>
                  {result.ok
                    ? 'Connection successful. You are ready to chat.'
                    : `Couldn't connect. ${result.detail ?? 'Check your URL and key.'}`}
                </span>
              </div>
            )}
            <Button variant="secondary" full loading={testing} onClick={runTest}>
              {testing ? 'Testing…' : 'Test connection'}
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

function startMockProfile() {
  // Ensure a config exists so guards pass; key is a placeholder, mock AI is on.
  saveApiConfig({
    baseUrl: 'https://demo.invalid/openai/v1',
    models: { chat: 'gpt-5.4', transcribe: 'gpt-4o-transcribe', image: 'gpt-image-2', tts: 'gpt-4o-mini-tts' },
    chatDefaults: { reasoningEffort: 'medium', maxCompletionTokens: 4096 },
    keyEncrypted: false,
  });
  saveApiKey('demo-mode');
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
      <span className="avatar avatar--assistant" style={{ width: 72, height: 72 }}>
        <Icon name="mic" size={32} />
      </span>
      <div>
        <h1 className="onboard__title">Enable voice</h1>
        <p className="onboard__sub">
          Allow microphone access to dictate prompts and use hands-free voice mode. You can skip this.
        </p>
      </div>
      {status === 'granted' && (
        <div className="alert">
          <Icon name="check" size={18} /> Microphone enabled.
        </div>
      )}
      {status === 'denied' && (
        <div className="alert alert--warning">
          <Icon name="alert" size={18} /> Microphone blocked. You can enable it later in your browser.
        </div>
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
      <Route path="auth" element={<Auth />} />
      <Route path="key" element={<KeyWizard />} />
      <Route path="mic" element={<MicPriming />} />
      <Route path="*" element={<Navigate to="welcome" replace />} />
    </Routes>
  );
}
