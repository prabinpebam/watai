import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Watai builds into /docs so GitHub Pages can serve it directly
// (Settings -> Pages -> Deploy from branch -> /docs).
// Relative base keeps assets working under the /watai/ project subpath,
// and hash routing keeps deep links refresh-safe on GitHub Pages.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'docs',
    // `prepare-pages-output.mjs` removes the mutable shell while retaining
    // independently addressable `docs/releases/*` rollback artifacts.
    emptyOutDir: false,
    target: 'es2020',
    sourcemap: false,
  },
});
