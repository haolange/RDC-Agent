import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { applyBootTheme } from './app/theme/bootTheme';
import { installBrowserAppBridge } from './platform/browserElectronApi';
import { installInteractionPerformanceProbe } from './platform/performance/InteractionPerformanceProbe';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';

applyBootTheme();
installBrowserAppBridge();
installInteractionPerformanceProbe();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
