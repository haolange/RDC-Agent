export const PLAN_REVIEW_STATE_SCHEMA = '1' as const;

export type PlanReviewStatus = 'awaiting' | 'approved' | 'rejected' | 'superseded';

export interface PlanReviewSection {
  heading: string;
  body: string;
}

export interface PlanReviewHandoffOption {
  label: string;
  agent: string;
}

export interface PlanReviewHandoffSuggestion {
  label: string;
  agent: string;
  prompt: string;
  send: boolean;
}

export type PlanReviewDecision =
  | { kind: 'approve'; handoff: PlanReviewHandoffOption }
  | { kind: 'reject'; feedback: string };

export interface ConversationPlanReview {
  planId: string;
  revision: number;
  uri: string;
  hash: string;
  title: string;
  summary: string[];
  sections: PlanReviewSection[];
  status: PlanReviewStatus;
  decision?: PlanReviewDecision;
  handoffOptions: PlanReviewHandoffOption[];
}

export interface PlanReviewStateDocument {
  schemaVersion: typeof PLAN_REVIEW_STATE_SCHEMA;
  planId: string;
  revision: number;
  status: PlanReviewStatus;
  approvedHash?: string;
  frozenUri?: string;
  approvedHandoff?: PlanReviewHandoffOption;
  updatedAt: number;
}

export interface ProjectPlanFrontmatter {
  planId: string;
  revision: number;
  sha256: string;
  agent: string;
  sessionId: string;
  savedAt: string;
}

export interface PlanReadRequest {
  planId: string;
  revision: number;
  sessionId: string;
  uri: string;
  expectedHash: string;
}

export interface PlanReadResult {
  markdown: string;
  hash: string;
  uri: string;
}

export interface PlanSaveToProjectRequest extends PlanReadRequest {
  approvalToken: string;
}

export interface PlanSaveToProjectResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface PlanExportRequest extends PlanReadRequest {
  targetPath: string;
  approvalToken: string;
}

export interface PlanExportResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface PlanApprovalTokenRequest extends PlanReadRequest {
  action: 'plan.saveToProject' | 'plan.export';
}

export interface ConversationAnswerPlanReviewRequest {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  decision: PlanReviewDecision;
}

export interface ConversationAnswerPlanReviewResult {
  success: boolean;
  error?: string;
}

export function isHandoffContinueAction(handoff: { showContinueOn?: boolean }): boolean {
  return handoff.showContinueOn !== false;
}
