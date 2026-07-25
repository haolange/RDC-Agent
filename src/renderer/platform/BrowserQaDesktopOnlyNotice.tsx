import React from 'react';
import { useI18n } from '../i18n';
import { isBrowserAppBridge } from './browserAppBridge/BrowserAppBridge';
import './BrowserQaDesktopOnlyNotice.css';

type NoticeKind = 'settingsWrite' | 'secret' | 'mcpTrust' | 'memory' | 'generic';

const KIND_KEYS: Record<NoticeKind, string> = {
  settingsWrite: 'browserQa.desktopOnlySettingsWrite',
  secret: 'browserQa.desktopOnlySecret',
  mcpTrust: 'browserQa.desktopOnlyMcpTrust',
  memory: 'browserQa.desktopOnlyMemory',
  generic: 'browserQa.desktopOnlyGeneric',
};

/** Honest unavailable banner for Browser QA permanent-deny capabilities. */
export const BrowserQaDesktopOnlyNotice: React.FC<{
  kind?: NoticeKind;
  testId?: string;
}> = ({ kind = 'generic', testId = 'browser-qa-desktop-only' }) => {
  const { t } = useI18n();
  if (!isBrowserAppBridge()) return null;
  return (
    <div className="browser-qa-desktop-only" role="status" data-testid={testId}>
      {t(KIND_KEYS[kind])}
    </div>
  );
};

export function isBrowserQaDesktopOnlySurface(): boolean {
  return isBrowserAppBridge();
}
