export const PLAN_INVESTIGATION_HEADING = '## Investigation execution contract';

/**
 * How an approved intervention must stay recoverable: a rollback must exist in the catalog and the experiment's baseline
 * must be recorded, and with `rollback-before-next` each change must also be reverted before the next one.
 */
export const PLAN_AUTHORIZATION_REVERSIBILITY = ['rollback-available', 'rollback-before-next'] as const;
export type PlanAuthorizationReversibility = (typeof PLAN_AUTHORIZATION_REVERSIBILITY)[number];

/** At most this many changes one authorization item may cover. */
export const PLAN_AUTHORIZATION_MAX_INSTANCES = 16;

/** Which object an approved intervention may change; every named field must equal the action's argument. */
export interface PlanAuthorizationTarget {
  eventId?: number;
  stage?: string;
  shaderId?: string;
}

/**
 * One intervention the user approves with the plan. It only narrows what auto-review may admit without asking: it
 * never lifts the profile ceiling, policy, permission mode or tool metadata.
 */
export interface PlanAuthorization {
  operation: string;
  target: PlanAuthorizationTarget;
  effect: string;
  reversibility: PlanAuthorizationReversibility;
  maxInstances: number;
}
