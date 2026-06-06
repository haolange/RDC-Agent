import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { installBrowserAppBridge } from './platform/browserElectronApi';
import './styles/tokens/index.css';
import './styles/design-system.css';
import './styles/global.css';

installBrowserAppBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
