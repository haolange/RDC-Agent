import type { ManifestTextTranslations } from './agentManifest';
import type { ConversationTurnControls } from './modelCapability';
import type { SessionModelOverride, SessionRecordSnapshot, SessionRevision } from './session';

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

/**
 * Approving a plan is one main transaction: it also commits the Agent switch to the declared target and the model and
 * controls the person approved with. `expectedPlanHash` names the reviewed revision and `baseRevision` the session
 * record the choice was made on; either being stale rejects the approval.
 */
export interface PlanApprovalRequest {
  sessionId: string;
  reviewId: string;
  decision: Extract<PlanReviewDecision, { kind: 'approve' }>;
  expectedPlanHash: string;
  model: SessionModelOverride;
  controls: ConversationTurnControls;
  baseRevision: SessionRevision;
}

interface PlanRejectionRequest {
  sessionId: string;
  reviewId: string;
  decision: Extract<PlanReviewDecision, { kind: 'reject' }>;
}

export type ConversationAnswerPlanReviewRequest = PlanApprovalRequest | PlanRejectionRequest;

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

/** A failed answer throws a registered error through the IPC error exit; a returned result is a committed decision. */
export type ConversationAnswerPlanReviewResult =
  | {
    decision: 'approve';
    session: SessionRecordSnapshot;
    planReview: PlanReviewProjection;
    /** The declared continuation: send it as one execute turn, or prefill it when `send` is false. */
    handoff: { prompt: string; send: boolean };
  }
  | { decision: 'reject'; planReview: PlanReviewProjection; replan?: { agentId: string; source: PlanReadRequest; feedback: string } };
