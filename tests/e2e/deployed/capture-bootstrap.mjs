import { build } from 'vite';
import { fileURLToPath } from 'node:url';

export async function buildCaptureRuntime() {
  const result = await build({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, minify: false, emptyOutDir: false,
      lib: { entry: fileURLToPath(new URL('./capture-entry.mjs', import.meta.url)), name: 'WataiCaptureRuntime', formats: ['iife'] } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  if (outputs.length !== 1 || outputs[0].type !== 'chunk' || Buffer.byteLength(outputs[0].code) > 1048576) throw new Error('INVALID_CAPTURE_RUNTIME_BUNDLE');
  return outputs[0].code;
}