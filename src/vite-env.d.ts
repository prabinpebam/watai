/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the persistence API base URL (defaults to the deployed Function App). */
  readonly VITE_WATAI_API_BASE?: string;
  /** Entra External ID SPA client id. */
  readonly VITE_WATAI_CLIENT_ID?: string;
  /** Entra External ID (CIAM) authority URL. */
  readonly VITE_WATAI_AUTHORITY?: string;
  /** API scope requested for the persistence API. */
  readonly VITE_WATAI_API_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
