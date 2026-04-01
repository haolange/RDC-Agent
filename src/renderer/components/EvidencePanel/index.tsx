import React, { useState, useEffect } from 'react';
import type { ActionEvent, EventType } from '@shared/types/evidence';

interface EvidencePanelProps {
  filterType?: EventType;
}

/**
 * EvidencePanel - 证据链面板
 * 显示action_chain中的事件时间线
 */
export const EvidencePanel: React.FC<EvidencePanelProps> = ({ filterType }) => {
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ActionEvent | null>(null);

  useEffect(() => {
    // 加载证据链
    const loadEvidence = async () => {
      if (window.electronAPI) {
        const chain = await window.electronAPI.evidence.getChain() as { events: ActionEvent[] };
        let filteredEvents = chain.events || [];
        if (filterType) {
          filteredEvents = filteredEvents.filter(e => e.event_type === filterType);
        }
        setEvents(filteredEvents);
      }
    };

    loadEvidence();

    // 监听新事件
    if (window.electronAPI) {
      window.electronAPI.on('evidence:eventAdded', () => {
        loadEvidence();
      });
    }
  }, [filterType]);

  // 事件类型颜色
  const getEventTypeColor = (type: EventType): string => {
    const colors: Record<EventType, string> = {
      dispatch: '#3b82f6',
      tool_execution: '#10b981',
      artifact_write: '#8b5cf6',
      quality_check: '#f59e0b',
      workflow_stage_transition: '#6366f1',
      process_deviation: '#ef4444',
      counterfactual_submitted: '#ec4899',
      counterfactual_reviewed: '#14b8a6',
      conflict_resolved: '#f97316',
    };
    return colors[type] || '#6b6b80';
  };

  // 格式化时间
  const formatTime = (ts: number): string => {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="evidence-panel panel">
      <div className="panel-header">
        <span>Evidence Chain</span>
        <span className="event-count">{events.length} events</span>
      </div>
      <div className="panel-content">
        {events.length === 0 ? (
          <div className="empty-state">
            <p>No evidence events recorded</p>
          </div>
        ) : (
          <div className="event-timeline">
            {events.map((event) => (
              <div
                key={event.event_id}
                className={`event-item ${selectedEvent?.event_id === event.event_id ? 'selected' : ''}`}
                onClick={() => setSelectedEvent(event)}
              >
                <div
                  className="event-type-badge"
                  style={{ backgroundColor: getEventTypeColor(event.event_type) }}
                >
                  {event.event_type.replace(/_/g, ' ').slice(0, 3).toUpperCase()}
                </div>
                <div className="event-info">
                  <span className="event-agent">{event.agent_id}</span>
                  <span className="event-time">{formatTime(event.ts_ms)}</span>
                </div>
                <div className={`event-status ${event.status}`}>
                  {event.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 事件详情 */}
      {selectedEvent && (
        <div className="event-detail">
          <div className="detail-header">
            <span>Event Detail</span>
            <button className="close-btn" onClick={() => setSelectedEvent(null)}>×</button>
          </div>
          <div className="detail-content">
            <div className="detail-row">
              <span className="label">Event ID:</span>
              <span className="value code">{selectedEvent.event_id}</span>
            </div>
            <div className="detail-row">
              <span className="label">Type:</span>
              <span className="value">{selectedEvent.event_type}</span>
            </div>
            <div className="detail-row">
              <span className="label">Agent:</span>
              <span className="value">{selectedEvent.agent_id}</span>
            </div>
            <div className="detail-row">
              <span className="label">Status:</span>
              <span className={`value status-${selectedEvent.status}`}>{selectedEvent.status}</span>
            </div>
            {Object.keys(selectedEvent.payload).length > 0 && (
              <div className="detail-payload">
                <span className="label">Payload:</span>
                <pre>{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EvidencePanel;
