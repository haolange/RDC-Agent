import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { CaptureDescriptor, ContextSnapshot } from '@shared/types/session';

export {
  applyActionEventToMessage,
  applyToolTraceToMessage,
  hydrateMessagesWithActionEvents,
} from './conversationMessageMerge';

export const mergeCapturesWithSnapshot = (
  currentCaptures: CaptureDescriptor[],
  snapshot: ContextSnapshot,
): CaptureDescriptor[] => {
  if (!snapshot.captureDescriptors?.length) {
    return currentCaptures;
  }

  const incomingById = new Map(snapshot.captureDescriptors.map((capture) => [capture.id, capture]));
  const merged = currentCaptures.map((capture) => {
    const incoming = incomingById.get(capture.id);
    return incoming ? { ...capture, ...incoming } : capture;
  });

  snapshot.captureDescriptors.forEach((capture) => {
    if (!merged.some((entry) => entry.id === capture.id)) {
      merged.push(capture);
    }
  });

  return merged;
};

export const mapActionEventToTimelineEntry = (event: ActionEvent): AgentTimelineEntry | null => {
  switch (event.event_type) {
    case 'user_message':
      if (String(event.payload.role || 'user') !== 'user') {
        return null;
      }
      return {
        id: event.event_id,
        type: 'user',
        content: String(event.payload.content || ''),
        timestamp: event.ts_ms,
      };
    case 'agent_summary':
      if (String(event.payload.role || '') === 'assistant') {
        return {
          id: event.event_id,
          type: 'agent',
          agentRole: event.agent_id as AgentTimelineEntry['agentRole'],
          content: String(event.payload.content || event.payload.summary || ''),
          actionEvent: event,
          timestamp: event.ts_ms,
        };
      }
      return null;
    case 'system':
      if (!event.payload.message) {
        return null;
      }
      return {
        id: event.event_id,
        type: 'system',
        title: 'System',
        status: event.status,
        content: String(event.payload.message || ''),
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'report_published':
      return {
        id: event.event_id,
        type: 'system',
        title: 'Report',
        content: `调试报告已生成：${String(event.payload.htmlPath || event.payload.markdownPath || 'reports ready')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    default:
      return null;
  }
};
