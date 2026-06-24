// Base URL for the Watai persistence API. Overridable via the Vite env var
// VITE_WATAI_API_BASE (e.g. for local/staging APIs); defaults to the deployed Function App.
const DEFAULT_API_BASE = 'https://func-watai-cbroocyg3omrk.azurewebsites.net/api';

export function apiBaseUrl(): string {
  const fromEnv = import.meta.env?.VITE_WATAI_API_BASE as string | undefined;
  const base = fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_API_BASE;
  return base.replace(/\/+$/, '');
}
