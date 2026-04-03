import React, { useState } from 'react';
import { NavMenu, NavItemKey } from './NavMenu';
import { useSessionStore } from '../../stores/sessionStore';
import type { RunSummary } from '@shared/types/session';
import './Sidebar.css';

const STATUS_CLASS: Record<string, string> = {
  running: 'in-progress',
  completed: 'completed',
  failed: 'error',
  cancelled: 'error',
};

const MODE_LABELS: Record<string, string> = {
  debugger: 'Debugger',
  analyzer: 'Analyzer',
  optimizer: 'Optimizer',
};

const formatTime = (ts: number): string => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '\u521a\u521a';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} \u5206\u949f\u524d`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} \u5c0f\u65f6\u524d`;
  return `${Math.floor(diff / 86_400_000)} \u5929\u524d`;
};

export const Sidebar: React.FC = () => {
  const [activeNavKey, setActiveNavKey] = useState<NavItemKey>('new-task');
  const recentRuns = useSessionStore((s) => s.recentRuns);
  const setCurrentRun = useSessionStore((s) => s.setCurrentRun);
  const currentRun = useSessionStore((s) => s.currentRun);

  const handleNavSelect = (key: NavItemKey) => {
    setActiveNavKey(key);
    if (key === 'new-task') {
      useSessionStore.getState().reset();
    }
  };

  const handleRunSelect = async (run: RunSummary) => {
    try {
      await window.electronAPI.session.select(run.sessionId);
      setCurrentRun(run);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="sidebar-content">
      <NavMenu activeKey={activeNavKey} onSelect={handleNavSelect} />

      <div className="session-section">
        <div className="session-section-header">
          <span className="session-section-title">\u5386\u53f2\u8bb0\u5f55</span>
          <button
            type="button"
            className="session-section-action"
            title="\u5237\u65b0"
            onClick={() => {
              window.electronAPI?.workflow.listRuns()
                .then((r) => useSessionStore.getState().setRecentRuns(r.runs ?? []))
                .catch(() => undefined);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.65 2.35A8 8 0 1 0 15.94 7H8V9H13.91A6 6 0 1 1 11.13 3.13L8 6.25V2H12L13.65 2.35Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {recentRuns.length === 0 ? (
          <div className="session-empty">
            <div className="session-empty-icon">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
                <path d="M5 8H11M8 5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
              </svg>
            </div>
            <div className="session-empty-text">\u6682\u65e0\u5386\u53f2 Run</div>
            <div className="session-empty-hint">\u5b8c\u6210\u4e00\u6b21\u8c03\u8bd5\u540e\u5c06\u663e\u793a\u5728\u8fd9\u91cc</div>
          </div>
        ) : (
          <div className="session-list">
            {recentRuns.slice(0, 8).map((run) => (
              <button
                key={run.runId}
                type="button"
                className={`session-item ${currentRun?.runId === run.runId ? 'active' : ''}`}
                onClick={() => void handleRunSelect(run)}
              >
                <div className="session-item-header">
                  <span className="session-item-title">{run.goal || run.runId.slice(0, 12)}</span>
                  <span className={`session-item-status ${STATUS_CLASS[run.status] ?? 'completed'}`} />
                </div>
                <span className="session-item-time">
                  {MODE_LABELS[run.mode] ?? run.mode} · {formatTime(run.startedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
