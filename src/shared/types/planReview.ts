import type { HandoffLabelTranslations } from './agentManifest';

export const PLAN_REVIEW_STATE_SCHEMA = '1' as const;

export type PlanReviewStatus = 'awaiting' | 'approved' | 'rejected' | 'superseded' | 'cancelled';

export interface PlanReviewSection {
  heading: string;
  body: string;
}

export interface PlanReviewHandoffIdentity {
  label: string;
  agent: string;
}

export interface PlanReviewHandoffOption extends PlanReviewHandoffIdentity {
  labelTranslations?: HandoffLabelTranslations;
}

export interface PlanReviewHandoffSuggestion extends PlanReviewHandoffOption {
  prompt: string;
  send: boolean;
}

export type PlanReviewDecision =
  | { kind: 'approve'; handoff: PlanReviewHandoffIdentity }
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
  /** Absence means ownership is unproven; never infer it from the active session. */
  ownerTurnId?: string;
  revision: number;
  status: PlanReviewStatus;
  approvedHash?: string;
  frozenUri?: string;
  approvedHandoff?: PlanReviewHandoffIdentity;
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
  sessionId: string;
  reviewId: string;
  decision: PlanReviewDecision;
}

export interface PlanReviewContext {
  reviewId: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  agentId: string;
  recovered: boolean;
  planReview: ConversationPlanReview;
}

export interface PlanReviewProjection {
  sessionId: string;
  projectionVersion: number;
  review: PlanReviewContext | null;
  recoverable: PlanReadRequest | null;
  error?: string;
  decision?: { reviewId: string; kind: 'approve' | 'reject' | 'cancel' };
}

export interface PlanCancelReviewRequest { sessionId: string; reviewId: string }

export interface ConversationAnswerPlanReviewResult {
  success: boolean;
  error?: string;
  replan?: { agentId: string; source: PlanReadRequest; feedback: string };
}

export function isHandoffContinueAction(handoff: { surface?: 'turn-end' | 'plan-gate' | 'hidden' }): boolean {
  return handoff.surface !== 'hidden';
}
