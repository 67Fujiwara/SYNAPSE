import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
import { SettingsProvider } from './features/settings/SettingsProvider';
import { I18nProvider } from './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <SettingsProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </SettingsProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
