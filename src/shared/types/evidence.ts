import { z } from 'zod';

/**
 * Evidence Types - 证据链相关类型定义
 */

// 事件类型
type EventType = string;

// 事件状态
type EventStatus =
  | 'ok'
  | 'error'
  | 'sent'
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'entered'
  | 'warning'
  | 'timeout'
  | 'completed';

// Action事件
export interface ActionEvent {
  schema_version: string;
  event_id: string;
  turn_id?: string;
  ts_ms: number;
  run_id: string;
  session_id: string;
  agent_id: string;
  event_type: EventType;
  status: EventStatus;
  duration_ms: number;
  refs: string[];
  payload: Record<string, unknown>;
}

/** An action event as the session's action chain stores it and `evidence:eventAdded` carries it. */
export const ActionEventSchema: z.ZodType<ActionEvent> = z.object({
  schema_version: z.string(),
  event_id: z.string(),
  turn_id: z.string().optional(),
  ts_ms: z.number(),
  run_id: z.string(),
  session_id: z.string(),
  agent_id: z.string(),
  event_type: z.string(),
  status: z.enum(['ok', 'error', 'sent', 'pass', 'fail', 'blocked', 'entered', 'warning', 'timeout', 'completed']),
  duration_ms: z.number(),
  refs: z.array(z.string()),
  payload: z.record(z.string(), z.unknown()),
});
