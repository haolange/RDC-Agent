/**
 * Session-owned durable Profile Handoff state machine.
 * AgentHandoffDefinition is only a manifest route declaration — not this record.
 */

export type ProfileHandoffLifecycle = 'prepared' | 'committed' | 'consumed' | 'cancelled';

export type ProfileHandoffCancelReason =
  | 'user_stop'
  | 'rewrite'
  | 'branch'
  | 'manual_switch'
  | 'session_close'
  | 'restart_degrade'
  | 'invalid_model'
  | 'depth_exceeded'
  | 'superseded';

export const HANDOFF_CHAIN_LIMIT = 3;

/** Auto-send waits only on turn-idle events while the source turn still occupies the slot. */
export const HANDOFF_AUTO_SEND_MAX_IDLE_OBSERVATIONS = 8;

export const HANDOFF_ERROR = {
  REQUIRES_FROZEN_PLAN: 'HANDOFF_REQUIRES_FROZEN_PLAN',
  NOT_DECLARED: 'HANDOFF_NOT_DECLARED',
  TARGET_DISABLED: 'HANDOFF_TARGET_DISABLED',
  ALREADY_ACTIVE: 'HANDOFF_ALREADY_ACTIVE',
  CHAIN_LIMIT: 'HANDOFF_CHAIN_LIMIT',
  MODEL_INVALID: 'HANDOFF_MODEL_INVALID',
  STATE_CONFLICT: 'HANDOFF_STATE_CONFLICT',
  RESTART_DEGRADED: 'HANDOFF_RESTART_DEGRADED',
} as const;

export type HandoffErrorCode = (typeof HANDOFF_ERROR)[keyof typeof HANDOFF_ERROR];

export interface ProfileHandoffState {
  handoffId: string;
  lifecycle: ProfileHandoffLifecycle;
  sourceTurnId: string;
  sourceRequestId: string;
  sourceAgentId: string;
  toAgentId: string;
  chainRoot: string;
  depth: number;
  prompt: string;
  label: string;
  /** Field is always present; value may be null. Canonical `providerId:modelId` when set. */
  declaredModel: string | null;
  send: boolean;
  preparedAt: number;
  committedAt?: number;
  consumedAt?: number;
  cancelledAt?: number;
  cancelReason?: ProfileHandoffCancelReason;
  /** Target turn that consumed this handoff; only that turn may continue the chain. */
  continuationTurnId?: string;
}

export interface HandoffStateDocument {
  schemaVersion: '1';
  active: ProfileHandoffState | null;
  history?: ProfileHandoffState[];
}

export function isActiveHandoffLifecycle(
  lifecycle: ProfileHandoffLifecycle | undefined,
): lifecycle is 'prepared' | 'committed' {
  return lifecycle === 'prepared' || lifecycle === 'committed';
}

export function isConsumableHandoff(
  pending: Pick<ProfileHandoffState, 'handoffId'>,
  latest: ProfileHandoffState | null | undefined,
): latest is ProfileHandoffState {
  return latest?.lifecycle === 'committed' && latest.handoffId === pending.handoffId;
}
