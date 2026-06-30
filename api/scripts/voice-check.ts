/**
 * voice-check — diagnostic for the dictation/voice features. Lists the models the configured endpoint
 * exposes, then probes candidate transcription (`/audio/transcriptions`) and text-to-speech
 * (`/audio/speech`) deployment names, printing the HTTP status + error body on failure. This pinpoints
 * a "Model or endpoint not found" (404) — usually the transcribe/tts deployment name in Settings →
 * Models & keys doesn't match a real Azure deployment. Reads api/.env (gitignored). Never prints the key.
 *
 *   npm run voice-check
 *   WATAI_PROBE_TRANSCRIBE_MODEL=my-whisper WATAI_PROBE_TTS_MODEL=my-tts npm run voice-check
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v1Url } from '../src/ai/http';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(resolve(HERE, '../.env'));

const base = (process.env.WATAI_PROBE_BASEURL ?? '').trim();
const key = (process.env.WATAI_PROBE_KEY ?? '').trim();

/** A tiny valid 16 kHz mono PCM WAV (a short 440 Hz tone) — enough to exercise a transcription
 *  deployment. A 404 means the deployment name is wrong; a 200/400 means the deployment exists. */
function tinyWav(): Buffer {
  const sampleRate = 16000;
  const seconds = 0.4;
  const n = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 0.3;
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function list(envVar: string, fallback: string): string[] {
  return (process.env[envVar] ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  if (!base || !key) {
    console.error('Set WATAI_PROBE_BASEURL and WATAI_PROBE_KEY in api/.env.');
    process.exit(1);
  }
  console.log(`endpoint host: ${new URL(base).host}\n`);

  // 1) What deployments does this endpoint actually expose?
  try {
    const res = await fetch(v1Url(base, '/models'), { headers: { Authorization: `Bearer ${key}` } });
    console.log(`GET /models -> ${res.status}`);
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (json.data ?? []).map((m) => m.id).filter(Boolean) as string[];
      console.log(`  all (${ids.length}): ${ids.join(', ') || '(none)'}`);
      const audio = ids.filter((id) => /whisper|transcrib|tts|audio|speech/i.test(id));
      console.log(`  audio-like: ${audio.length ? audio.join(', ') : '(none found)'}`);
    } else {
      console.log(`  ${(await res.text()).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`GET /models error: ${(e as Error).message}`);
  }
  console.log('');

  // 2) Transcription deployments.
  const wav = tinyWav();
  for (const model of list('WATAI_PROBE_TRANSCRIBE_MODEL', 'whisper,whisper-1,gpt-4o-transcribe,gpt-4o-mini-transcribe')) {
    try {
      const form = new FormData();
      form.append('model', model);
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
      form.append('response_format', 'json');
      const res = await fetch(v1Url(base, '/audio/transcriptions'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      const txt = await res.text();
      console.log(`POST /audio/transcriptions model=${model} -> ${res.status}${res.ok ? ' OK' : ' ' + txt.slice(0, 200)}`);
    } catch (e) {
      console.log(`POST /audio/transcriptions model=${model} error: ${(e as Error).message}`);
    }
  }
  console.log('');

  // 3) Text-to-speech deployments.
  for (const model of list('WATAI_PROBE_TTS_MODEL', 'tts,tts-1,tts-1-hd,gpt-4o-mini-tts')) {
    try {
      const res = await fetch(v1Url(base, '/audio/speech'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: 'Hello from Watai.', voice: 'alloy', response_format: 'mp3' }),
      });
      if (res.ok) {
        const bytes = (await res.arrayBuffer()).byteLength;
        console.log(`POST /audio/speech model=${model} -> ${res.status} OK, ${bytes} bytes`);
      } else {
        console.log(`POST /audio/speech model=${model} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
    } catch (e) {
      console.log(`POST /audio/speech model=${model} error: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
