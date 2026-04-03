import React from 'react';

export type SessionStatus = 'completed' | 'in-progress' | 'error';

export interface SessionItem {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
}

interface SessionListProps {
  sessions: SessionItem[];
  activeSessionId?: string;
  onSelectSession: (session: SessionItem) => void;
}

const EmptyState: React.FC = () => (
  <div className="session-empty">
    <div className="session-empty-icon">
      <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
        <path d="M5 8H11M8 5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
      </svg>
    </div>
    <div className="session-empty-text">暂无 Session</div>
    <div className="session-empty-hint">点击"新任务"开始调试</div>
  </div>
);

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
}) => {
  if (sessions.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="session-section">
      <div className="session-section-header">
        <span className="session-section-title">历史记录</span>
        <button className="session-section-action" title="刷新">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      <div className="session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(session)}
          >
            <div className="session-item-header">
              <span className="session-item-title">{session.title}</span>
              <span className={`session-item-status ${session.status}`} />
            </div>
            <span className="session-item-time">{session.updatedAt}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
