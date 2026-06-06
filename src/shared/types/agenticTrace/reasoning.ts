import type { EvidenceRef } from './base';

export type VisibleReasoningMode =
  | 'task_understanding'
  | 'planning'
  | 'intent'
  | 'hypothesis'
  | 'evidence_need'
  | 'observation_summary'
  | 'decision_update'
  | 'next_action'
  | 'risk_note'
  | 'summary';

export type ReasoningConfidence = 'low' | 'medium' | 'high';

export interface VisibleReasoningPacket {
  mode: VisibleReasoningMode;
  title?: string;
  content: string;
  hypothesis?: string;
  evidenceRefs?: EvidenceRef[];
  nextAction?: string;
  confidence?: ReasoningConfidence;
}
