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
