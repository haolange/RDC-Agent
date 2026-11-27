import { fileOperationBoundary } from '../runtime/FileOperationBoundary';
import { assertRdcDiscovery, parseShellRdcInput } from './RdcShellInput';
import { assertRdcBindingOwnership, authorizeRdcOperation } from './RdcOperationPolicy';
import { readRdcHostControls } from './RdcHostControls';
import type {
  AgentPermissionDecision,
  AgentPermissionDecisionInput,
} from '../agent-runtime/permissions/AgentPermissionPolicy';
import type { AgentAccessCeiling } from '@shared/types/agentManifest';
import type { RdcOperationDefinition } from './RdcOperationCatalog';
import type { AgentPermissionMode } from '@shared/types/settings';

function request(
  mode: AgentPermissionMode,
  reason: string,
  risk: AgentPermissionDecision['risk'],
): AgentPermissionDecision {
  if (mode === 'auto-review') return { action: 'auto_review', reason, risk, temporaryPathRoots: [] };
  return { action: 'ask_user', reason, risk, temporaryPathRoots: [] };
}

function denied(reason: string): AgentPermissionDecision {
  return { action: 'deny', reason, risk: 'high', temporaryPathRoots: [] };
}

/** Whether any path argument of the operation names a protected file; such input needs specific authorization. */
export function hasProtectedPathInput(definition: RdcOperationDefinition, args: Record<string, unknown>): boolean {
  return definition.path_inputs.some((entry) => {
    const values = args[entry.name];
    return (Array.isArray(values) ? values : [values]).some(
      (value) => typeof value === 'string' && fileOperationBoundary(value).protected,
    );
  });
}

export function evaluateRdcShellBaseline(
  input: AgentPermissionDecisionInput,
  mode: AgentPermissionMode,
  ceiling: AgentAccessCeiling,
): AgentPermissionDecision {
  let rdcRequest;
  try {
    rdcRequest = parseShellRdcInput(input.toolCall.arguments);
  } catch (error) {
    return denied(`SHELL_INPUT_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!rdcRequest) return denied('SHELL_INPUT_INVALID: shell.rdc payload is missing.');
  if (ceiling !== 'full') return denied('RDC_EXECUTION_DENIED: native RDC execution requires a full access ceiling.');
  if ('discovery' in rdcRequest) {
    if (input.executionContext) {
      try {
        assertRdcBindingOwnership(input.executionContext);
        assertRdcDiscovery(rdcRequest.discovery, input.executionContext.rdcBinding!);
      } catch (error) {
        return denied(error instanceof Error ? error.message : String(error));
      }
    }
    return mode === 'full-access'
      ? { action: 'allow', risk: 'low', temporaryPathRoots: [] }
      : request(
          mode,
          `Frozen RDC catalog ${rdcRequest.discovery.kind}; reads definitions without native execution.`,
          'low',
        );
  }
  if (!input.executionContext)
    return request(mode, `Native RDC operation requires verified execution context: ${rdcRequest.operation}`, 'high');
  try {
    const lease = assertRdcBindingOwnership(input.executionContext);
    const admitted = authorizeRdcOperation(
      rdcRequest.operation,
      rdcRequest.args,
      input.executionContext,
      lease.runtimeContext.replaySessionId!,
      lease.runtimeContext.captureFileId,
    );
    const effects = admitted.definition.effects;
    const changesShader = effects.includes('shader_replacement');
    const protectedPaths = hasProtectedPathInput(admitted.definition, admitted.args);
    const decision =
      mode === 'full-access'
        ? { action: 'allow' as const, risk: 'low' as const, temporaryPathRoots: [] }
        : request(
            mode,
            protectedPaths
              ? 'Protected native filesystem input requires specific authorization.'
              : changesShader
                ? 'Owned replay shader change requires authorization review.'
                : 'Validated operation within the owning replay and workspace.',
            protectedPaths ? 'high' : changesShader ? 'medium' : 'low',
          );
    return {
      ...decision,
      operationFacts: {
        operation: admitted.definition.name,
        scope: admitted.definition.scope,
        operationContract: {
          description: admitted.definition.description,
          inputSchema: admitted.definition.input_schema,
          pathInputs: admitted.definition.path_inputs,
          prerequisites: admitted.definition.prerequisites,
        },
        effects,
        evidenceKind: admitted.definition.evidence_kind,
        arguments: admitted.args,
        experimentId: rdcRequest.experimentId ?? null,
        catalogFingerprint: input.executionContext.rdcBinding!.definitionsFingerprint,
        hostControls:
          changesShader || protectedPaths
            ? readRdcHostControls(
                {
                  sessionId: input.executionContext.sessionId!,
                  projectId: input.executionContext.projectId!,
                  contextId: lease.contextId,
                  leaseVersion: lease.version,
                },
                input.executionContext,
              )
            : undefined,
      },
    };
  } catch (error) {
    return denied(error instanceof Error ? error.message : String(error));
  }
}
