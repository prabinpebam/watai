// Azure Functions v4 entry point. Importing each module registers its functions
// (via app.http) with the host. esbuild bundles this into dist/index.cjs.
import './functions/health';
import './functions/api';
