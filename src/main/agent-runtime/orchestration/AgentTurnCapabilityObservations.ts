/**
 * AgentTurnCapabilityObservations — what a turn observes about its route: MCP connection failures,
 * the route capability diagnostic, and persisted evidence that structured tool calling works
 * (a successful tool round) or was explicitly rejected by the provider.
 */

import { buildDiagnosticAgentEvent, type AgentEventBridgeContext } from '../AgentEventBridge';
import { describeRouteCapabilityDiagnostic } from '../capabilities/RouteCapabilityResolver';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import {
  recordObservedToolCallingSupport,
  recordObservedToolCallingUnsupported,
} from '../../settings/provider-catalog/ObservedModelEvidence';
import { settingsService } from '../../settings/settings-core/SettingsService';
import type { AgentTurnRun } from './AgentTurnRunner';

/** MCP connection failures and the route capability diagnostic, before the first request. */
export function reportRouteDiagnostics(
  run: AgentTurnRun,
  sharedEventContext: AgentEventBridgeContext,
  toolDefinitionCount: number,
): void {
  const { input, preparedRuntime, requestPlan, effectiveModel, executionScopeId } = run;
  const { routeCapability } = preparedRuntime;
  const { mcpConnectionErrors } = preparedRuntime;
  const routeDiagnostic = describeRouteCapabilityDiagnostic(routeCapability, toolDefinitionCount);
  if (mcpConnectionErrors.length > 0) {
    input.options?.onEvent?.(
      buildDiagnosticAgentEvent(sharedEventContext, {
        code: 'mcp_connection_failed',
        severity: 'warning',
        message: 'One or more configured MCP servers could not be connected. MCP tools are unavailable for this turn.',
        technicalMessage: mcpConnectionErrors.join('\n'),
      }),
    );
  }
  if (!routeDiagnostic) return;
  if (routeDiagnostic.surface === 'runtime-log') {
    runtimeLogService.log({
      scope: 'session',
      namespace: 'agent',
      severity: routeDiagnostic.severity,
      title: 'Model route capability',
      summary: routeDiagnostic.message,
      sessionId: executionScopeId,
      projectId: input.projectId,
      runId: input.runId,
      raw: {
        code: routeDiagnostic.code,
        surface: routeDiagnostic.surface,
        providerId: input.providerId,
        modelId: effectiveModel?.modelId ?? input.modelId,
        protocol: requestPlan.route.protocol,
      },
    });
  } else {
    input.options?.onEvent?.(
      buildDiagnosticAgentEvent(sharedEventContext, {
        code: routeDiagnostic.code,
        severity: routeDiagnostic.severity,
        message: routeDiagnostic.message,
        technicalMessage: JSON.stringify(routeCapability),
      }),
    );
  }
}

export function persistToolCallingSupport(run: AgentTurnRun): void {
  const { input, requestPlan, effectiveModel, executionScopeId } = run;
  try {
    recordObservedToolCallingSupport(
      input.providerId,
      effectiveModel?.modelId ?? input.modelId,
      settingsService.providerConnections,
      requestPlan.route.protocol,
    );
  } catch (error) {
    runtimeLogService.log({
      scope: 'session',
      namespace: 'agent',
      severity: 'warning',
      title: 'Tool capability evidence was not persisted',
      summary: error instanceof Error ? error.message : String(error),
      sessionId: executionScopeId,
      projectId: input.projectId,
      runId: input.runId,
      raw: {
        providerId: input.providerId,
        modelId: effectiveModel?.modelId ?? input.modelId,
        protocol: requestPlan.route.protocol,
      },
    });
  }
}

export function persistToolCallingRejection(run: AgentTurnRun, error: unknown): void {
  const { input, requestPlan, effectiveModel, executionScopeId } = run;
  try {
    recordObservedToolCallingUnsupported(
      input.providerId,
      effectiveModel?.modelId ?? input.modelId,
      settingsService.providerConnections,
      requestPlan.route.protocol,
      error instanceof Error ? error.message : String(error),
    );
  } catch (persistError) {
    runtimeLogService.log({
      scope: 'session',
      namespace: 'agent',
      severity: 'warning',
      title: 'Tool capability rejection was not persisted',
      summary: persistError instanceof Error ? persistError.message : String(persistError),
      sessionId: executionScopeId,
      projectId: input.projectId,
      runId: input.runId,
      raw: {
        providerId: input.providerId,
        modelId: effectiveModel?.modelId ?? input.modelId,
        protocol: requestPlan.route.protocol,
      },
    });
  }
}
