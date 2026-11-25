/**
 * TurnControlTools — tools that read or declare the state of the running turn: turn_complete
 * records the structured completion declaration; runtime_context reports the execution's
 * identity, live permission mode and owning capture context.
 */

import { AppError } from '@shared/errors/appError';
import { UNRESOLVED_BLOCKERS, parseUnresolvedItems } from '@shared/types/unresolvedWork';
import { isEphemeralScopeId, isSubagentScopeId } from '@shared/utils/executionScope';
import { runtimePermissionStateService } from '../permissions/RuntimePermissionStateService';
import { assertRdcContextLeaseOwnership, getRdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { rdcSessionService } from '../../sessions';
import { storageAdapter } from '../../sessions/store/StorageAdapter';
import { readRdcHostControls } from '../../rdc/RdcHostControls';
import type { TurnCompletionDeclaration, TurnHandle } from './TurnCoordinator';
import type { AgentTool, AgentToolSpec } from '../agent/AgentTool';

/** Main-owned context controls: small results still keep a durable URI/hash as evidence. */
export const RUNTIME_CONTEXT_TOOL_SPEC: AgentToolSpec = {
  isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: false,
  presentation: { pinEvidence: () => true },
};

export function createTurnCompletionTool(turnHandle?: TurnHandle | null, validate?: (value: TurnCompletionDeclaration) => void | Promise<void>): AgentTool {
  return {
    name: 'turn_complete',
    label: 'Complete Turn',
    description: 'Declare structured turn completion. For partial or blocked work, identify the remaining checks and the actual reason they cannot proceed now; an unknown or unfinished result alone is not a blocker. Continue useful, authorized checks when possible. Preserve genuine cancellation, limits, failures, and no-progress stops.',
    parameters: {
      type: 'object',
      required: ['disposition'],
      properties: {
        disposition: { type: 'string', enum: ['completed', 'partial', 'blocked', 'cancelled', 'budget_paused'] },
        evidenceRefs: {
          type: 'array', description: 'Exact URI and hash of artifacts supporting this declaration; use the values returned by the artifact tools.',
          items: { type: 'object', required: ['uri', 'hash'], properties: { uri: { type: 'string' }, hash: { type: 'string' } } },
        },
        result: {
          type: 'object', required: ['summary', 'outputs', 'counterevidence', 'unresolved', 'scope', 'sideEffects', 'recoveryState'], additionalProperties: false,
          properties: {
            summary: { type: 'string', maxLength: 4000 }, outputs: { type: 'object', description: 'Named string outputs matching the Task completion requirements. Serialize structured values as strings.' },
            counterevidence: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
            unresolved: { type: 'array', maxItems: 32, description: 'One item per remaining piece of work. An item with no real blocker is work to continue now, not a reason to stop; use not_required only for work outside what the goal needs.',
              items: { type: 'object', required: ['gap', 'attempted', 'blocker', 'resumeWhen'], additionalProperties: false, properties: {
                gap: { type: 'string', maxLength: 1000, description: 'What remains unknown or undone.' },
                attempted: { type: 'string', maxLength: 1000, description: 'What was tried, including failed attempts, or that nothing was tried and why.' },
                blocker: { type: 'string', enum: [...UNRESOLVED_BLOCKERS], description: 'What prevents it now: capability, permission, budget (limit or deadline), strategy (outside the approved strategy or scope), external (input, device or condition outside this session), or not_required.' },
                resumeWhen: { type: 'string', maxLength: 1000, description: 'The concrete condition under which it can proceed.' },
              } } },
            scope: { type: 'string', maxLength: 4000 }, sideEffects: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
            recoveryState: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
          },
        },
      },
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'session', category: 'task', requiresApproval: false },
    async execute(_toolCallId, args) {
      const disposition = args.disposition;
      if (!['completed', 'partial', 'blocked', 'cancelled', 'budget_paused'].includes(String(disposition))) {
        throw new AppError('TURN_COMPLETION_INVALID', 'disposition is not supported.');
      }
      const refs = Array.isArray(args.evidenceRefs) ? args.evidenceRefs : [];
      const evidenceRefs = refs.filter((ref): ref is { uri: string; hash: string } => (
        !!ref && typeof ref === 'object' && typeof (ref as Record<string, unknown>).uri === 'string'
          && typeof (ref as Record<string, unknown>).hash === 'string'
      ));
      if (turnHandle) {
        const supplied = args.result as (Omit<NonNullable<TurnCompletionDeclaration['result']>, 'unresolved'> & { unresolved?: unknown }) | undefined;
        if (supplied && Object.values(supplied.outputs ?? {}).some((value) => typeof value !== 'string')) {
          throw new AppError('TURN_COMPLETION_INVALID', 'result.outputs values must be strings.');
        }
        const rawResult = supplied ? { ...supplied, unresolved: parseUnresolvedItems(supplied.unresolved ?? []) } : undefined;
        const declaration = { disposition: disposition as TurnCompletionDeclaration['disposition'], evidenceRefs, ...(rawResult ? { result: rawResult } : {}) };
        await validate?.(declaration);
        turnHandle.completionDeclaration = declaration;
        const review = await turnHandle.reviewCompletionDeclaration?.(declaration);
        return { content: [{ type: 'text', text: `Turn completion recorded: ${String(disposition)}.${review ? `\n\n${review}` : ''}` }],
          details: { disposition, unresolved: declaration.result?.unresolved ?? [] } };
      }
      return { content: [{ type: 'text', text: `Turn completion recorded: ${String(disposition)}.` }] };
    },
  };
}

export function createRuntimeContextTool(sessionId?: string | null, projectId?: string | null): AgentTool<Record<string, never>, { available: boolean }> {
  return {
    name: 'runtime_context',
    label: 'Runtime Context',
    description: 'Read this execution\'s session, scope, working directory, and live permission mode and revision. The owning session can see registered capture IDs and its selected device for a plan. When it owns a capture lease, rdc contains replay identity, captureContentSha256, artifact capacity, and frozen CLI deadline controls. An approved owning General turn may also see captureRestoration, its signed frozen entry baseline, which is not the live replay position. Use rdc_probe for current observations. Offline children omit rdc and the baseline. Capacity is a point-in-time snapshot, not a future reservation.',
    pollable: true,
    parameters: {
      type: 'object',
      properties: {},
    },
    permissionHint: 'readonly',
    spec: RUNTIME_CONTEXT_TOOL_SPEC,
    async execute(_toolCallId, _args, _signal, _onUpdate, executionContext) {
      const permission = runtimePermissionStateService.getSnapshot();
      const scopeId = sessionId ?? null;
      const identity = {
        sessionId: scopeId,
        scopeId,
        scopeKind: !scopeId ? 'none' : isSubagentScopeId(scopeId) ? 'subagent' : isEphemeralScopeId(scopeId) ? 'ephemeral' : 'session',
        projectId: projectId ?? null,
        cwd: executionContext?.workspaceRoot ?? null,
        permissionMode: permission.mode,
        permissionRevision: permission.revision,
      };
      if (executionContext?.excludeRdcLeaseTools) {
        return { content: [{ type: 'text' as const, text: JSON.stringify(identity, null, 2) }], details: { available: true } };
      }
      const baseline = executionContext?.sessionId === sessionId && executionContext?.projectId === projectId
        ? executionContext?.captureControl?.restorationBaselineFor(executionContext) : null;
      const captureRestoration = baseline ? { captureRestoration: baseline } : {};
      const ownedProject = sessionId && projectId && !isSubagentScopeId(sessionId)
        && storageAdapter.sessions.readSession(sessionId)?.projectId === projectId
        ? storageAdapter.getProjectById(projectId) : null;
      const state = ownedProject && sessionId && projectId
        ? rdcSessionService.snapshotReplayForSession({ sessionId, projectId }) : null;
      const capturePlanning = ownedProject ? {
        inputs: ownedProject.inputs.map(input => ({ inputId: input.inputId, fileName: input.fileName,
          contentSha256: input.contentSha256 ?? null, source: input.source })),
        deviceId: state?.replayDeviceId ?? state?.preparation.targetDeviceId ?? null,
        devicePreparation: state?.preparation.phase ?? 'idle',
      } : null;
      const lease = assertRdcContextLeaseOwnership({
        sessionId,
        projectId,
      });
      const runtimeContext = lease?.runtimeContext ?? null;
      if (!runtimeContext || !lease) {
        const retainedLease = sessionId ? getRdcContextLease(sessionId) : null;
        const requiresRecovery = !!retainedLease && retainedLease.ownerSessionId === sessionId
          && retainedLease.ownerProjectId === projectId && !!retainedLease.quarantineReason;
        const note = requiresRecovery
          ? 'The capture is open, but replay requires controlled recovery. Close it in Capture, confirm that close succeeds, then reopen before further RDC operations. Preserve the confirmed goal and earlier evidence.'
          : sessionId
            ? 'The capture is not open in this session. Ask the user to select the capture and click Open in the Capture section. Preserve the confirmed goal; do not describe internal leases or diagnose a rendering cause.'
            : 'RDC replay identity requires an owning sessionId (no global fallback).';
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...identity, capturePlanning, ...captureRestoration, rdc: { available: false, requiresRecovery, note } }, null, 2) }],
          details: { available: false, requiresRecovery },
        };
      }
      const ownerSessionId = lease?.delegatedFrom ?? sessionId;
      const scope = ownerSessionId && projectId ? { sessionId: ownerSessionId, projectId } : null;
      const opened = scope ? rdcSessionService.snapshotOpenedCaptureForSession(scope) : null;
      const binding = scope ? rdcSessionService.listBindingsForProject(scope.projectId).find(item =>
        item.scope.sessionId === scope.sessionId && item.scope.projectId === scope.projectId
        && item.contextId === runtimeContext.contextId) : undefined;
      const captureContentSha256 = opened?.status === 'open' && binding && ['ready', 'applying'].includes(binding.phase)
        && runtimeContext.captureFileId && runtimeContext.replaySessionId
        && opened.contextId === runtimeContext.contextId && opened.captureFileId === runtimeContext.captureFileId
        && opened.replaySessionId === runtimeContext.replaySessionId && /^[a-f0-9]{64}$/.test(binding?.captureHash ?? '')
        ? binding!.captureHash : null;
      const { raw: _openTimePayload, ...runtimeIdentity } = runtimeContext;
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...identity, capturePlanning, ...captureRestoration, rdc: { ...runtimeIdentity, captureContentSha256,
          hostControls: ownerSessionId && projectId ? readRdcHostControls({ sessionId: ownerSessionId,
            projectId, contextId: runtimeContext.contextId, leaseVersion: lease.version }, executionContext) : null,
        } }, null, 2) }],
        details: { available: true },
      };
    },
  };
}
