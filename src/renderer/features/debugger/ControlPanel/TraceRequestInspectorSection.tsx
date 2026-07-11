import React from 'react';
import { useI18n } from '../../../i18n';
import { RequestInspector } from './RequestInspector';
import { useRequestInspectorTarget } from './useRequestInspectorTarget';

interface TraceRequestInspectorSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

export const TraceRequestInspectorSection: React.FC<TraceRequestInspectorSectionProps> = ({
  expanded,
  onToggle,
}) => {
  const { t } = useI18n();
  const { sessionId, turnId, active } = useRequestInspectorTarget();

  return (
    <div className={`cp-section cp-section-session ${expanded ? 'expanded' : ''}`} data-testid="cp-section-trace-lane-requestInspector">
      <button className="cp-section-header" onClick={onToggle} aria-expanded={expanded}>
        <div className="cp-section-title">
          <span className="cp-section-label">{t('control.requestInspector')}</span>
        </div>
        <div className="cp-section-trailing">
          <span className={`cp-section-arrow ${expanded ? 'expanded' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </button>
      {expanded ? (
        <div className="cp-section-content">
          <div className="cp-section-inner">
            {sessionId && turnId ? (
              <RequestInspector sessionId={sessionId} turnId={turnId} active={active} />
            ) : (
              <div className="request-inspector is-loading" data-testid="request-inspector">
                {t('control.requestInspectorWaiting')}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
