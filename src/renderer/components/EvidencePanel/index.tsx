import React, { useEffect, useMemo, useState } from 'react';
import type { ActionEvent, EventType } from '@shared/types/evidence';
import './EvidencePanel.css';

interface EvidencePanelProps {
  filterType?: EventType;
}

const EVENT_TYPE_CONFIG: Record<EventType, { label: string; dotClass: string }> = {
  dispatch: { label: 'Dispatch', dotClass: 'dispatch' },
  tool_execution: { label: 'Tool', dotClass: 'tool_execution' },
  artifact_write: { label: 'Artifact', dotClass: 'artifact_write' },
  quality_check: { label: 'Quality', dotClass: 'quality_check' },
  workflow_stage_transition: { label: 'Stage', dotClass: 'workflow_stage_transition' },
  process_deviation: { label: 'Deviation', dotClass: 'process_deviation' },
  counterfactual_submitted: { label: 'Counter', dotClass: 'counterfactual_submitted' },
  counterfactual_reviewed: { label: 'Review', dotClass: 'counterfactual_reviewed' },
  conflict_resolved: { label: 'Conflict', dotClass: 'conflict_resolved' },
};

const FILTER_OPTIONS: Array<{ type: EventType | 'all'; label: string }> = [
  { type: 'all', label: 'All' },
  { type: 'dispatch', label: 'Dispatch' },
  { type: 'tool_execution', label: 'Tools' },
  { type: 'artifact_write', label: 'Artifacts' },
  { type: 'quality_check', label: 'Quality' },
  { type: 'workflow_stage_transition', label: 'Stages' },
  { type: 'process_deviation', label: 'Deviations' },
];

const toEventTitle = (event: ActionEvent): string => {
  switch (event.event_type) {
    case 'dispatch':
      return `Dispatch to ${String(event.payload.target_agent || event.agent_id)}`;
    case 'tool_execution':
      return `Tool execution: ${String(event.payload.tool_name || 'unknown tool')}`;
    case 'artifact_write':
      return `Artifact write: ${String(event.payload.artifact_name || event.payload.path || 'artifact')}`;
    case 'workflow_stage_transition':
      return `Transition to ${String(event.payload.to_stage || 'next stage')}`;
    case 'process_deviation':
      return `Deviation: ${String(event.payload.reason || 'workflow exception')}`;
    case 'quality_check':
      return `Quality check: ${String(event.payload.check || event.status)}`;
    default:
      return EVENT_TYPE_CONFIG[event.event_type]?.label || event.event_type;
  }
};

export const EvidencePanel: React.FC<EvidencePanelProps> = ({ filterType }) => {
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ActionEvent | null>(null);
  const [activeFilter, setActiveFilter] = useState<EventType | 'all'>(filterType ?? 'all');

  const electronAPI =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI
      : undefined;

  useEffect(() => {
    setActiveFilter(filterType ?? 'all');
  }, [filterType]);

  useEffect(() => {
    const loadEvidence = async () => {
      if (!electronAPI?.evidence?.getChain) return;

      try {
        const chain = await electronAPI.evidence.getChain();
        setEvents(chain.events || []);
      } catch (error) {
        console.warn('Failed to load evidence chain:', error);
      }
    };

    loadEvidence();
  }, [electronAPI]);

  useEffect(() => {
    if (!electronAPI) return;

    const handleEvidenceAdded = (nextEvent: unknown) => {
      setEvents((current) => [...current, nextEvent as ActionEvent]);
    };

    electronAPI.on('evidence:eventAdded', handleEvidenceAdded);

    return () => {
      electronAPI.off('evidence:eventAdded', handleEvidenceAdded);
    };
  }, [electronAPI]);

  const filteredEvents = useMemo(() => {
    if (activeFilter === 'all') return events;
    return events.filter((event) => event.event_type === activeFilter);
  }, [activeFilter, events]);

  const groupedEvents = useMemo(() => {
    return filteredEvents.reduce<Record<string, ActionEvent[]>>((groups, event) => {
      const dateLabel = new Date(event.ts_ms).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      groups[dateLabel] ??= [];
      groups[dateLabel].push(event);
      return groups;
    }, {});
  }, [filteredEvents]);

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="evidence-panel">
      <div className="evidence-panel-header">
        <div className="evidence-panel-title">
          <svg className="evidence-panel-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Evidence Chain</span>
          <span className="evidence-count">{filteredEvents.length}</span>
        </div>

        <button className="icon-button tooltip" data-tooltip="Export unavailable">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>

      <div className="evidence-filter-bar">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.type}
            className={`filter-chip ${activeFilter === option.type ? 'active' : ''}`}
            onClick={() => setActiveFilter(option.type)}
          >
            {option.type !== 'all' && <span className={`filter-chip-dot ${EVENT_TYPE_CONFIG[option.type].dotClass}`} />}
            {option.label}
          </button>
        ))}
      </div>

      <div className="evidence-timeline scrollbar-thin">
        {filteredEvents.length === 0 ? (
          <div className="evidence-empty-state">
            <svg className="evidence-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <div className="evidence-empty-title">No evidence events yet</div>
            <div className="evidence-empty-description">Workflow actions, tool runs, and stage transitions will appear here.</div>
          </div>
        ) : (
          Object.entries(groupedEvents).map(([dateLabel, dateEvents]) => (
            <div key={dateLabel} className="timeline-date-group">
              <div className="timeline-date-header">{dateLabel}</div>

              {dateEvents.map((event, index) => (
                <div
                  key={event.event_id}
                  className={`event-item ${EVENT_TYPE_CONFIG[event.event_type].dotClass} ${
                    selectedEvent?.event_id === event.event_id ? 'selected' : ''
                  }`}
                  onClick={() => setSelectedEvent(event)}
                >
                  <div className="event-timeline-line">
                    {index > 0 && <div className="event-timeline-connector" />}
                    <div className="event-timeline-dot" />
                    {index < dateEvents.length - 1 && <div className="event-timeline-connector" />}
                  </div>

                  <div className="event-content">
                    <div className="event-header">
                      <span className={`event-type-badge ${EVENT_TYPE_CONFIG[event.event_type].dotClass}`}>
                        {EVENT_TYPE_CONFIG[event.event_type].label}
                      </span>
                      <span className="event-time">{formatTime(event.ts_ms)}</span>
                    </div>

                    <div className="event-title">{toEventTitle(event)}</div>
                    <div className="event-agent">{event.agent_id}</div>
                    <span className={`event-status ${event.status}`}>{event.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {selectedEvent && (
        <div className="event-detail-panel">
          <div className="event-detail-header">
            <div className="event-detail-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Event Details
            </div>

            <button className="event-detail-close" onClick={() => setSelectedEvent(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="event-detail-content">
            <div className="detail-row">
              <span className="detail-label">Event</span>
              <span className="detail-value">{selectedEvent.event_id}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Type</span>
              <span className="detail-value highlight">{EVENT_TYPE_CONFIG[selectedEvent.event_type].label}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Agent</span>
              <span className="detail-value">{selectedEvent.agent_id}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span className={`detail-value ${selectedEvent.status}`}>{selectedEvent.status}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Timestamp</span>
              <span className="detail-value">{new Date(selectedEvent.ts_ms).toLocaleString()}</span>
            </div>

            <div className="detail-payload">
              <div className="detail-payload-label">Payload</div>
              <div className="detail-payload-content">
                <pre>{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EvidencePanel;
