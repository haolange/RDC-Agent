import type { ManifestTextTranslations } from './agentManifest';

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
  labelTranslations?: ManifestTextTranslations;
}

export interface PlanReviewHandoffSuggestion extends PlanReviewHandoffOption {
  prompt: string;
  send: boolean;
}

export interface RecoverableApprovedHandoff extends PlanReviewHandoffSuggestion {
  planId: string;
  revision: number;
  planHash: string;
  planUri: string;
  planTitle: string;
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

/**
 * What a user message asks of a reviewed plan. `revise` re-plans from a rejected revision; `execute` is the
 * declared handoff that runs an approved, frozen revision. Main verifies either against plan state before
 * the message is accepted.
 */
export type PlanReferenceRequest =
  | ({ intent: 'revise' } & PlanReadRequest)
  | { intent: 'execute'; sessionId: string; planId: string; revision: number; expectedHash: string };

/** The verified plan a user message refers to, persisted on that message so the transcript can link them. */
export interface ConversationPlanReference {
  intent: PlanReferenceRequest['intent'];
  planId: string;
  revision: number;
  hash: string;
  uri: string;
  title: string;
  /** The Agent the message is addressed to: the executing target, or the planner asked to revise. */
  agentId: string;
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
  approvedHandoff?: RecoverableApprovedHandoff;
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
