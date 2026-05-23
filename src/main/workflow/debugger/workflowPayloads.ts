import type { AgentRole } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { Blocker, PlanPresentation, WorkflowState } from '@shared/types/workflow';
import { normalizeWorkflowStage } from '@shared/constants/stages';

export interface PlanLlmPayload {
  scope: string;
  notes: string[];
  recommended_specialists: AgentRole[];
  verification_focus: string[];
  presentation?: PlanPresentation;
}

export interface InvestigationLlmPayload {
  summary: string;
  evidence: string[];
  next_step: string;
  confidence: number;
  root_cause: string;
  recommendations: string[];
}

export interface SkepticReviewPayload {
  verdict: 'approved' | 'approved_with_warning' | 'rejected';
  summary: string;
}

export interface CuratedReportPayload {
  title: string;
  summary: string;
  root_cause: string;
  fix_description: string;
  evidence_summary: string[];
  recommendations: string[];
  confidence: number;
}

const KNOWN_AGENT_ROLES = new Set<AgentRole>([
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
]);

export function latestStageHistory(events: ActionEvent[]): WorkflowState['previousStages'] {
  return events
    .filter((event) => event.event_type === 'workflow_stage_transition')
    .map((event) => normalizeWorkflowStage(String(event.payload.toStage || 'preflight')));
}

export function dedupeBlockers(blockers: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  const result: Blocker[] = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}:${blocker.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(blocker);
  }
  return result;
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export function toConfidence(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function toRecommendedSpecialists(value: unknown, fallback: AgentRole[]): AgentRole[] {
  const parsed = toStringArray(value).filter((entry): entry is AgentRole => KNOWN_AGENT_ROLES.has(entry as AgentRole));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}
