import type { RdxActionId, RdxShellActionSettings } from '@shared/types/settings';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { settingsService } from '../settings/SettingsService';
import { appPathService } from '../runtime/AppPathService';
import { shellInvocationService } from './ShellInvocationService';
import { resolveRdxBatchInvocation } from './resolveRdxBatchInvocation';

export interface RdxShellActionVariables {
  [key: string]: string | number | boolean | null | undefined;
}

export interface RdxActionDiagnostic {
  message: string;
  classification?: string;
  fixHint?: string;
  failedStep?: string;
  renderdocStatus?: string;
}

export interface RdxShellActionResult {
  ok: boolean;
  actionId: RdxActionId;
  data: Record<string, unknown>;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
  diagnostic?: RdxActionDiagnostic;
}

interface ParsedActionPayload {
  data: Record<string, unknown>;
  ok?: boolean;
  error?: string;
  diagnostic?: RdxActionDiagnostic;
}

const substitute = (value: string, variables: RdxShellActionVariables): string => (
  value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const replacement = variables[key];
    return replacement == null ? '' : String(replacement);
  })
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const readStringField = (source: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const readNestedRecord = (source: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
};

export const formatRdxActionDiagnostic = (diagnostic: RdxActionDiagnostic): string => {
  const parts = [diagnostic.message.trim()].filter(Boolean);
  if (diagnostic.failedStep) {
    parts.push(`step=${diagnostic.failedStep}`);
  }
  if (diagnostic.classification) {
    parts.push(`classification=${diagnostic.classification}`);
  }
  if (diagnostic.renderdocStatus) {
    parts.push(`renderdoc=${diagnostic.renderdocStatus}`);
  }
  if (diagnostic.fixHint) {
    parts.push(diagnostic.fixHint);
  }
  return parts.join(' · ');
};

export const isLocalReplayUnsupportedDiagnostic = (
  diagnostic: RdxActionDiagnostic | undefined,
  fallbackMessage?: string,
): boolean => {
  const haystack = [
    diagnostic?.message,
    diagnostic?.classification,
    diagnostic?.fixHint,
    diagnostic?.failedStep,
    diagnostic?.renderdocStatus,
    fallbackMessage,
  ].filter(Boolean).join(' ').toLowerCase();

  if (!haystack) {
    return false;
  }

  return diagnostic?.classification === 'rdc_invalid_or_unsupported'
    || haystack.includes('rdc_invalid_or_unsupported')
    || haystack.includes('opencapture')
    || (haystack.includes('open_replay') && haystack.includes('failed'));
};

const parseErrorDiagnostic = (value: unknown): RdxActionDiagnostic | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return { message: value.trim() };
  }
  if (!isRecord(value)) {
    return undefined;
  }

  const message = readStringField(value, ['message', 'error_message', 'code']) ?? 'RDX tool call failed.';
  const details = readNestedRecord(value, ['details']);
  const sourceDetails = details
    ? readNestedRecord(details, ['source_error_details', 'sourceErrorDetails'])
    : undefined;
  const renderdocStatus = sourceDetails
    ? readNestedRecord(sourceDetails, ['renderdoc_status', 'renderdocStatus'])
    : undefined;

  return {
    message,
    classification: readStringField(value, ['classification'])
      ?? (details ? readStringField(details, ['classification']) : undefined),
    fixHint: readStringField(value, ['fix_hint', 'fixHint'])
      ?? (details ? readStringField(details, ['fix_hint', 'fixHint']) : undefined)
      ?? (sourceDetails ? readStringField(sourceDetails, ['fix_hint', 'fixHint']) : undefined),
    failedStep: details
      ? readStringField(details, ['failed_step', 'failedStep', 'stage'])
      : undefined,
    renderdocStatus: renderdocStatus
      ? readStringField(renderdocStatus, ['status_text', 'statusText', 'result_code_name', 'resultCodeName'])
      : undefined,
  };
};

const parseJsonPayload = (stdout: string): ParsedActionPayload => {
  if (!stdout.trim()) throw new Error('RDX action requires canonical JSON stdout.');
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || typeof parsed.ok !== 'boolean'
    || typeof parsed.result_kind !== 'string' || !parsed.result_kind || !isRecord(parsed.data)) {
    throw new Error('RDX action requires a native rdx canonical JSON envelope.');
  }
  const diagnostic = parsed.ok ? undefined : parseErrorDiagnostic(parsed.error);
  return { data: { ...parsed.data, _rdxEnvelope: parsed }, ok: parsed.ok,
    error: diagnostic ? formatRdxActionDiagnostic(diagnostic) : undefined, diagnostic };
};

class RdxShellActionService {
  async runAction(
    actionId: RdxActionId,
    variables: RdxShellActionVariables = {},
    options: { env?: Record<string, string>; abortSignal?: AbortSignal; action?: RdxShellActionSettings } = {},
  ): Promise<RdxShellActionResult> {
    const action = options.action ?? settingsService.getAll().tooling.rdxActions[actionId];
    if (!isActionConfigured(action)) {
      const message = `RDX action "${actionId}" is not configured. Configure it in Settings → Tools → RDX shell actions.`;
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'error',
        title: 'RDX action unavailable',
        summary: message,
        raw: { actionId },
      });
      return {
        ok: false,
        actionId,
        data: {},
        stdout: '',
        stderr: message,
        exitCode: 2,
        error: message,
        diagnostic: {
          message,
          classification: 'action_not_configured',
          fixHint: 'Open Settings → Tools and enable the RDX shell action with a valid command.',
        },
      };
    }

    const paths = appPathService.getRuntimePaths();
    const resolvedVariables: RdxShellActionVariables = {
      workspaceRoot: paths.userRdxRoot,
      logsPath: paths.logsPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      ...variables,
    };

    const args = action.args.map((arg) => substitute(arg, resolvedVariables));
    const env = Object.fromEntries(
      Object.entries({
        ...action.env,
        ...options.env,
      }).map(([key, value]) => [key, substitute(value, resolvedVariables)]),
    );
    const command = substitute(action.command, resolvedVariables);
    const invocation = resolveRdxBatchInvocation(command, args);
    const result = await shellInvocationService.invoke({
      command: invocation.command,
      args: invocation.args,
      cwd: action.workingDirectory ? substitute(action.workingDirectory, resolvedVariables) : undefined,
      env,
      timeoutMs: action.timeoutMs,
      abortSignal: options.abortSignal,
    });

    let data: Record<string, unknown> = {};
    let payloadOk: boolean | undefined;
    let payloadError: string | undefined;
    let diagnostic: RdxActionDiagnostic | undefined;
    let parseError: string | undefined;
    options.abortSignal?.throwIfAborted();
    {
      try {
        const parsedPayload = parseJsonPayload(result.stdout);
        data = parsedPayload.data;
        payloadOk = parsedPayload.ok;
        payloadError = parsedPayload.error;
        diagnostic = parsedPayload.diagnostic;
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
    }

    const ok = result.exitCode === 0 && !parseError && payloadOk === true;
    const error = ok
      ? undefined
      : parseError
        ?? payloadError
        ?? (result.stderr.trim() || result.stdout.trim() || `RDX action "${actionId}" exited with ${result.exitCode}.`);
    const resolvedDiagnostic = ok
      ? undefined
      : diagnostic ?? (error ? { message: error } : undefined);

    runtimeLogService.log({
      scope: 'app',
      namespace: 'context',
      severity: ok ? 'success' : 'error',
      title: ok ? `RDX action ${actionId}` : `RDX action ${actionId} failed`,
      summary: ok ? 'Action completed.' : error ?? 'Action failed.',
      raw: {
        actionId,
        command: action.command,
        args,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        diagnostic: resolvedDiagnostic,
      },
    });

    return {
      ok,
      actionId,
      data,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error,
      diagnostic: resolvedDiagnostic,
    };
  }
}

function isActionConfigured(action: RdxShellActionSettings | undefined): action is RdxShellActionSettings {
  return Boolean(action?.enabled && action.command.trim());
}

export const rdxShellActionService = new RdxShellActionService();
