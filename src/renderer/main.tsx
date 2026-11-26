import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { RendererFailurePage } from './app/RendererFailurePage';
import { RootErrorBoundary } from './app/RootErrorBoundary';
import { readRendererCrashBoot } from './app/rendererCrashBoot';
import { applyBootTheme } from './app/theme/bootTheme';
import { enablePseudoLocale } from './i18n/pseudoLocale';
import { browserAppBridgeInstalled, installRendererApi } from './platform/rendererApi';
import { installInteractionPerformanceProbe } from './platform/performance/InteractionPerformanceProbe';
import { prefetchMarkdownEnhancers } from './patterns/Markdown/markdownEnhancers';
import { prefetchComposerMarkdownInput } from './features/composer/composerMarkdownLoader';
import { prefetchThinkingMarkdownParser } from './features/transcript/workProcessThinkingContent';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';

applyBootTheme();
installRendererApi();
installInteractionPerformanceProbe();
// Browser QA can render English pseudo-localized (?pseudoLocale) to prove every string is translated and layouts stretch.
if (browserAppBridgeInstalled() && new URLSearchParams(window.location.search).has('pseudoLocale'))
  enablePseudoLocale();

// After repeated renderer crashes main boots this renderer into its failure page, which loads nothing else.
const crashBoot = readRendererCrashBoot(window.location);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {crashBoot ? (
      <RendererFailurePage
        language={crashBoot.language}
        kind="crash"
        facts={crashBoot.facts}
        onReload={() => window.location.replace(crashBoot.reloadUrl)}
      />
    ) : (
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    )}
  </React.StrictMode>,
);

// Code highlighting, math rendering and CodeMirror (the Markdown Composer's editor and the parser that decides which
// thinking text renders) are not needed for the first paint; fetch them once the app is idle.
prefetchMarkdownEnhancers();
prefetchComposerMarkdownInput();
prefetchThinkingMarkdownParser();
