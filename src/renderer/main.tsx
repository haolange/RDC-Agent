import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { applyBootTheme } from './app/theme/bootTheme';
import { enablePseudoLocale } from './i18n/pseudoLocale';
import { browserAppBridgeInstalled, installRendererApi } from './platform/rendererApi';
import { installInteractionPerformanceProbe } from './platform/performance/InteractionPerformanceProbe';
import { prefetchMarkdownEnhancers } from './patterns/Markdown/markdownEnhancers';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';

applyBootTheme();
installRendererApi();
installInteractionPerformanceProbe();
// Browser QA can render English pseudo-localized (?pseudoLocale) to prove every string is translated and layouts stretch.
if (browserAppBridgeInstalled() && new URLSearchParams(window.location.search).has('pseudoLocale'))
  enablePseudoLocale();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Code highlighting and math rendering are not needed for the first paint; fetch them once the app is idle.
prefetchMarkdownEnhancers();
