import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { parseShellRdcInput } from './RdcShellInput';
import { reviewableEffects, rollbackFor, targetMatches } from './rdcInterventionAuthorization';
import { readReplayIsolation } from './RdcHostControls';
import { rdcExecutionReceipts, type RdcExecutionReceipts } from './RdcExecutionReceipts';
import { hasProtectedPathInput } from './rdcShellPermission';
import type { RdcOperationDefinition } from './RdcOperationCatalog';
import type {
  AdmissionAdapter,
  AdmissionAssessment,
  AdmissionFact,
  AdmissionRequest,
  AdmissionTurn,
} from '../agent-runtime/permissions/PermissionAdmission';

const SHA256 = /^[a-f0-9]{64}$/i;

const fact = (check: AdmissionFact['check'], holds: boolean, basis: string): AdmissionFact => ({
  check,
  state: holds ? 'holds' : 'fails',
  basis,
});

/**
 * Host facts for a reversible intervention such as a shader replacement: the owning replay is exclusively held, the
 * experiment's baseline was measured on this replay, the edit is bound to the source it changes and the frozen catalog
 * can revert it. When the approved plan authorizes the operation, the target, effects, approved count and, if asked,
 * the revert of the previous change are checked against it.
 */
function assessIntervention(
  request: AdmissionRequest,
  turn: AdmissionTurn,
  host: RdcAdmissionHost,
): AdmissionAssessment | null {
  if (!request.tool.spec.capture?.nativeOperation?.(request.toolCall.arguments)) return null;
  const context = request.executionContext;
  const binding = context?.rdcBinding;
  const identity = binding?.identity;
  const input = parseShellRdcInput(request.toolCall.arguments);
  if (!context?.sessionId || !context.projectId || !binding || !identity || !input || 'discovery' in input) return null;
  const definitions = binding.definitions as readonly RdcOperationDefinition[];
  const definition = definitions.find((item) => item.name === input.operation);
  const effects = definition ? reviewableEffects(definition) : [];
  if (
    !definition ||
    definition.evidence_kind !== 'intervention' ||
    !effects.length ||
    hasProtectedPathInput(definition, input.args)
  )
    return null;
  const receipts = host.receipts.list(context.sessionId);
  const replaySessionId = identity.runtimeContext?.replaySessionId;
  const isolation = host.replayIsolation(
    {
      sessionId: context.sessionId,
      projectId: context.projectId,
      contextId: identity.contextId,
      leaseVersion: identity.version,
    },
    context,
  );
  const experimentId = input.experimentId;
  const baseline =
    experimentId !== undefined &&
    receipts.some(
      (receipt) =>
        receipt.evidence.kind === 'measurement' &&
        receipt.experimentId === experimentId &&
        receipt.contextId === identity.contextId &&
        receipt.leaseVersion === identity.version &&
        receipt.replaySessionId === replaySessionId,
    );
  const rollback = effects.every((effect) => rollbackFor(definitions, effect));
  const facts: AdmissionFact[] = [
    fact(
      'identity-current',
      isolation.available,
      isolation.available
        ? 'This turn holds the owning replay exclusively.'
        : 'This turn does not hold the owning replay exclusively.',
    ),
    fact(
      'baseline-recorded',
      baseline,
      baseline
        ? 'A signed baseline measurement of this experiment exists on the current replay.'
        : experimentId === undefined
          ? 'The intervention names no experiment; record its baseline under an experiment first.'
          : 'No signed baseline measurement of this experiment exists on the current replay.',
    ),
    fact(
      'rollback-available',
      rollback,
      rollback ? 'The frozen catalog can revert this change.' : 'The frozen catalog has no way to revert this change.',
    ),
  ];
  const properties = (definition.input_schema as { properties?: Record<string, unknown> }).properties ?? {};
  if ('expected_source_hash' in properties) {
    const sourceHash = input.args.expected_source_hash;
    const bound = typeof sourceHash === 'string' && SHA256.test(sourceHash);
    facts.push(
      fact(
        'source-bound',
        bound,
        bound
          ? 'The edit names the hash of the source it replaces; a different source is refused before any change.'
          : 'The edit does not name the hash of the source it replaces.',
      ),
    );
  }
  const approved = turn.approved;
  const authorizations = (approved?.contract?.authorizations ?? []).filter(
    (item) => item.operation === input.operation,
  );
  // No authorization, or one for another target: the plan could not name this draw in advance, so whether the change
  // is within what the user approved is the semantic remainder the review model decides, with these facts.
  const authorization = authorizations.find((item) => targetMatches(item.target, input.args));
  if (!approved || !authorization) return { coverage: 'uncovered', facts };
  const applied = receipts.filter(
    (receipt) =>
      receipt.evidence.kind === 'intervention' &&
      receipt.operation === authorization.operation &&
      receipt.completedAt >= approved.approvedAt &&
      targetMatches(authorization.target, receipt.args),
  );
  const reverted = new Set(
    receipts.flatMap((receipt) => (receipt.evidence.kind === 'rollback' ? [receipt.evidence.replacementId] : [])),
  );
  const bounded = effects.every((effect) => effect === authorization.effect);
  facts.push(
    fact('authorized', true, 'The approved plan authorizes this intervention.'),
    fact('target-matches', true, 'The action changes the target the approved plan names.'),
    fact(
      'effects-bounded',
      bounded,
      bounded ? 'The change stays within the approved effect.' : 'The change reaches beyond the approved effect.',
    ),
    fact(
      'instances-remaining',
      applied.length < authorization.maxInstances,
      `${applied.length} of ${authorization.maxInstances} approved changes have been made.`,
    ),
  );
  if (authorization.reversibility === 'rollback-before-next') {
    const outstanding = applied.some(
      (receipt) => receipt.evidence.kind === 'intervention' && !reverted.has(receipt.evidence.replacementId),
    );
    facts.push(
      fact(
        'prior-reverted',
        !outstanding,
        outstanding
          ? 'The previous approved change is still applied; revert it before the next one.'
          : 'No earlier approved change is still applied.',
      ),
    );
  }
  return { coverage: 'covered', facts };
}

/**
 * Host facts for changing the owning replay. The approved plan's capture scope is the authorization; whether the
 * replay can change now is the controller's readiness, the same answer execution and the Capture panel read. Selecting
 * a scoped input, restoring the signed entry position and recovering the same capture are all within the scope.
 */
function assessReplayLifecycle(request: AdmissionRequest, turn: AdmissionTurn): AdmissionAssessment | null {
  const step = request.tool.spec.capture?.replayLifecycle?.(request.toolCall.arguments) ?? null;
  if (!step) return null;
  const scope = turn.approved?.contract?.captureScope?.inputs.map((entry) => entry.inputId) ?? null;
  const owner = turn.agentId === GENERAL_AGENT_ID && turn.accessCeiling === 'full';
  const readiness = turn.captureReadiness();
  // A quarantine blocks every change but the recovery that acts on it.
  const usable =
    readiness !== null &&
    (readiness.state === 'ready' || (readiness.exit === 'agent-recover' && step === 'capture_recover'));
  const facts: AdmissionFact[] = [
    fact(
      'authorized',
      scope !== null,
      scope
        ? "The approved plan's capture scope covers changing the owning replay."
        : 'No approved plan with a capture scope belongs to this execution.',
    ),
    fact(
      'identity-current',
      owner && usable,
      !owner
        ? 'Only the owning execution turn with a full access ceiling changes the replay.'
        : usable
          ? 'This is the owning execution turn and its replay can change now.'
          : readiness === null
            ? 'This turn owns no approved capture.'
            : `The replay cannot change now (${readiness.state === 'blocked' ? readiness.code : 'ready'}).`,
    ),
  ];
  if (step === 'capture_select' && scope) {
    const inputId = request.toolCall.arguments.inputId;
    const inScope = typeof inputId === 'string' && scope.includes(inputId);
    facts.push(
      fact(
        'target-matches',
        inScope,
        inScope
          ? 'The selected input is in the approved capture scope.'
          : 'The selected input is outside the approved capture scope.',
      ),
    );
  }
  return { coverage: 'covered', facts };
}

/** What the adapter reads from the host: the session's signed receipts and the turn's hold on the owning replay. */
export interface RdcAdmissionHost {
  receipts: Pick<RdcExecutionReceipts, 'list'>;
  replayIsolation: typeof readReplayIsolation;
}

export function createRdcAdmissionAdapter(
  host: RdcAdmissionHost = { receipts: rdcExecutionReceipts, replayIsolation: readReplayIsolation },
): AdmissionAdapter {
  return (request, turn) => assessReplayLifecycle(request, turn) ?? assessIntervention(request, turn, host);
}
