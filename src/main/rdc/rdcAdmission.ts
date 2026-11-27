import { AppError } from '@shared/errors/appError';
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
  if (!approved || !authorizations.length)
    return {
      coverage: 'uncovered',
      facts: [
        {
          check: 'authorized',
          state: 'unavailable',
          basis: 'No approved authorization names this intervention; decide from the user request and approved plan.',
        },
        ...facts,
      ],
    };
  const authorization = authorizations.find((item) => targetMatches(item.target, input.args));
  if (!authorization)
    return {
      coverage: 'covered',
      facts: [
        fact('authorized', true, 'The approved plan authorizes this intervention.'),
        fact('target-matches', false, 'The action changes a different target than the approved plan names.'),
        ...facts,
      ],
    };
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
 * Host facts for changing the owning replay. The approved plan's capture scope is the authorization: selecting a
 * scoped input, restoring the signed entry position and recovering the same capture are all within it.
 */
function assessReplayLifecycle(request: AdmissionRequest, turn: AdmissionTurn): AdmissionAssessment | null {
  const step = request.tool.spec.capture?.replayLifecycle?.(request.toolCall.arguments) ?? null;
  if (!step) return null;
  const scope = turn.approved?.contract?.captureScope?.inputs.map((entry) => entry.inputId) ?? null;
  const facts: AdmissionFact[] = [
    scope
      ? fact('authorized', true, "The approved plan's capture scope covers changing the owning replay.")
      : {
          check: 'authorized',
          state: 'unavailable',
          basis: 'No approved plan with a capture scope belongs to this execution.',
        },
    fact(
      'identity-current',
      turn.agentId === GENERAL_AGENT_ID && turn.accessCeiling === 'full',
      turn.agentId === GENERAL_AGENT_ID && turn.accessCeiling === 'full'
        ? 'This is the owning execution turn with a full access ceiling.'
        : 'Only the owning execution turn with a full access ceiling changes the replay.',
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
  if (step === 'capture_restore') facts.push(entryBaseline(turn));
  return { coverage: scope ? 'covered' : 'uncovered', facts };
}

function entryBaseline(turn: AdmissionTurn): AdmissionFact {
  try {
    const baseline = turn.captureBaseline();
    return baseline.available
      ? fact('baseline-recorded', true, 'The entry position of this turn is signed and owned by it.')
      : {
          check: 'baseline-recorded',
          state: 'unavailable',
          basis: `The entry position of this turn is not verified (${baseline.reason}).`,
        };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return fact('baseline-recorded', false, 'The signed entry position does not match this turn.');
  }
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
