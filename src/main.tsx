import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './design/tokens.css';
import './design/global.css';
import './design/components.css';
import { App } from './app/App';
import { ThemeProvider } from './app/ThemeProvider';
import { ToastHost } from './app/ToastHost';
import { DevMenu } from './mocks/DevMenu';
import { initAuth } from './auth/cloudAuth';

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <ThemeProvider>
          <App />
          <ToastHost />
          {import.meta.env.DEV && <DevMenu />}
        </ThemeProvider>
      </HashRouter>
    </StrictMode>,
  );
}

// Complete any returning MSAL sign-in redirect BEFORE the HashRouter mounts (so the auth
// response in the URL hash isn't clobbered by the router), then render either way.
void initAuth().finally(mount);
