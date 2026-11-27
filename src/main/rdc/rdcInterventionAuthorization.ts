import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { validateRdcArguments, rdcOperationCapability } from './RdcOperationPolicy';
import type { RdcOperationDefinition } from './RdcOperationCatalog';
import type { PlanAuthorization, PlanAuthorizationTarget } from '@shared/types/planInvestigation';

/** Effects every replay operation may have; a reversible intervention is authorized for its other effects. */
const ROUTINE_REPLAY_EFFECTS: ReadonlySet<string> = new Set([
  'replay_position',
  'replay_position_temporary',
  'artifact_write',
]);

/** Each target field names the catalog argument it must equal. */
const TARGET_ARGUMENT: Readonly<Record<keyof PlanAuthorizationTarget, string>> = {
  eventId: 'event_id',
  stage: 'stage',
  shaderId: 'shader_id',
};

/** The effects an intervention changes beyond the routine ones every replay operation may have. */
export function reviewableEffects(definition: RdcOperationDefinition): string[] {
  return definition.effects.filter((effect) => !ROUTINE_REPLAY_EFFECTS.has(effect));
}

/** An available catalog rollback that reverts the given effect. */
export function rollbackFor(
  definitions: readonly RdcOperationDefinition[],
  effect: string,
): RdcOperationDefinition | undefined {
  return definitions.find(
    (item) =>
      item.evidence_kind === 'rollback' && item.effects.includes(effect) && rdcOperationCapability(item).available,
  );
}

/** Whether the action's arguments equal every field the authorization names. */
export function targetMatches(target: PlanAuthorizationTarget, args: Record<string, unknown>): boolean {
  return (Object.keys(target) as (keyof PlanAuthorizationTarget)[]).every(
    (field) => args[TARGET_ARGUMENT[field]] === target[field],
  );
}

const ProposalSchema = z
  .array(
    z
      .object({
        operation: z.string().trim().min(1).max(128),
        target: z
          .object({
            eventId: z.number().int().nonnegative().optional(),
            stage: z.string().trim().min(1).max(32).optional(),
            shaderId: z.string().trim().min(1).max(256).optional(),
          })
          .strict(),
        effect: z.string().trim().min(1).max(64),
        reversibility: z.enum(['rollback-available', 'rollback-before-next']),
        maxInstances: z.number().int().min(1).max(16),
      })
      .strict(),
  )
  .min(1)
  .max(16);

const invalid = (message: string): never => {
  throw new AppError('PLAN_AUTHORIZATION_INVALID', message);
};

/**
 * Validates the interventions a plan asks the user to approve against the static boundary they can only narrow: the
 * execution profiles' ceiling, the policy, the frozen catalog's contracts and the plan's capture scope. Any item that
 * would exceed it refuses the whole plan, with the reason.
 */
export function preparePlanAuthorizations(input: {
  proposals: unknown;
  definitions: readonly RdcOperationDefinition[];
  /** Every declared execution target runs with a full access ceiling, which native replay changes require. */
  targetsHaveFullCeiling: boolean;
  /** The policy neither denies native operations nor always requires the user for them. */
  policyAllowsReview: boolean;
  hasCaptureScope: boolean;
}): PlanAuthorization[] {
  const parsed = ProposalSchema.safeParse(input.proposals);
  if (!parsed.success) return invalid(z.prettifyError(parsed.error));
  if (!input.hasCaptureScope) return invalid('authorized interventions need the capture scope they change.');
  if (!input.targetsHaveFullCeiling)
    return invalid('the execution profile cannot change a replay, so an intervention cannot be authorized for it.');
  if (!input.policyAllowsReview)
    return invalid('policy denies native operations or always requires your approval for them.');
  const seen = new Set<string>();
  return parsed.data.map((item) => {
    const definition = input.definitions.find((candidate) => candidate.name === item.operation);
    if (!definition) return invalid(`${item.operation} is not in the frozen tool catalog.`);
    if (definition.evidence_kind !== 'intervention' || definition.scope !== 'replay')
      return invalid(`${item.operation} is not a replay intervention.`);
    if (!rdcOperationCapability(definition).available) return invalid(`${item.operation} is unavailable to General.`);
    const effects = reviewableEffects(definition);
    if (!effects.includes(item.effect) || effects.some((effect) => effect !== item.effect))
      return invalid(
        `${item.operation} changes ${effects.join(', ') || 'no reviewable effect'}, not only ${item.effect}.`,
      );
    if (!rollbackFor(input.definitions, item.effect)) return invalid(`no catalog rollback reverts ${item.effect}.`);
    const { target } = item;
    if (!Object.keys(target).length) return invalid(`${item.operation} needs at least one target field.`);
    const args = Object.fromEntries(
      Object.entries(target).map(([field, value]) => [TARGET_ARGUMENT[field as keyof PlanAuthorizationTarget], value]),
    );
    const properties = (definition.input_schema as { properties?: Record<string, unknown> }).properties ?? {};
    if (Object.keys(args).some((argument) => !(argument in properties)))
      return invalid(`${item.operation} has no argument for one of the target fields.`);
    try {
      for (const [argument, value] of Object.entries(args))
        validateRdcArguments(value, properties[argument] as Record<string, unknown>, `target ${argument}`);
    } catch (error) {
      return invalid(`${item.operation} target: ${error instanceof Error ? error.message : String(error)}`);
    }
    const key = JSON.stringify([item.operation, target]);
    if (seen.has(key)) return invalid(`${item.operation} is authorized twice for the same target.`);
    seen.add(key);
    return { ...item, target };
  });
}
