import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { startTheme } from './core/theme/theme';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles/global.css';

startTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Studio: missing #root element');

// Hash routes: the Python server serves one index.html for all of /studio/.
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
