import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import { installBrowserElectronApiFallback } from './platform/browserElectronApi';
import './styles/tokens/index.css';
import './styles/design-system.css';
import './styles/global.css';

installBrowserElectronApiFallback();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
