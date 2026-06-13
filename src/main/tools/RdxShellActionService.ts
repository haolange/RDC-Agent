import type { RdxActionId, RdxShellActionSettings } from '@shared/types/settings';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { settingsService } from '../settings/SettingsService';
import { appPathService } from '../runtime/AppPathService';
import { shellInvocationService } from './ShellInvocationService';

export interface RdxShellActionVariables {
  [key: string]: string | number | boolean | null | undefined;
}

export interface RdxShellActionResult {
  ok: boolean;
  actionId: RdxActionId;
  data: Record<string, unknown>;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

interface ParsedActionPayload {
  data: Record<string, unknown>;
  ok?: boolean;
  error?: string;
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

const readErrorMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (isRecord(value)) {
    const message = value.message ?? value.error_message ?? value.code;
    return typeof message === 'string' && message.trim() ? message : undefined;
  }
  return undefined;
};

const parseJsonPayload = (stdout: string): ParsedActionPayload => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { data: {} };
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('RDX action stdout must be a JSON object.');
  }

  if (typeof parsed.ok === 'boolean' && ('data' in parsed || 'result_kind' in parsed || 'error' in parsed)) {
    const envelopeData = isRecord(parsed.data) ? parsed.data : {};
    return {
      data: {
        ...envelopeData,
        _rdxEnvelope: parsed,
      },
      ok: parsed.ok,
      error: parsed.ok ? undefined : readErrorMessage(parsed.error),
    };
  }

  return { data: parsed };
};

class RdxShellActionService {
  async runAction(
    actionId: RdxActionId,
    variables: RdxShellActionVariables = {},
    options: { env?: Record<string, string>; abortSignal?: AbortSignal } = {},
  ): Promise<RdxShellActionResult> {
    const action = settingsService.getAll().tooling.rdxActions[actionId];
    if (!isActionConfigured(action)) {
      const message = `RDX action "${actionId}" is not configured.`;
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
      };
    }

    const paths = appPathService.getWorkspacePaths();
    const resolvedVariables: RdxShellActionVariables = {
      workspaceRoot: paths.workspaceRoot,
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
    const result = await shellInvocationService.invoke({
      command: substitute(action.command, resolvedVariables),
      args,
      cwd: action.workingDirectory ? substitute(action.workingDirectory, resolvedVariables) : undefined,
      env,
      timeoutMs: action.timeoutMs,
      abortSignal: options.abortSignal,
    });

    let data: Record<string, unknown> = {};
    let payloadOk: boolean | undefined;
    let payloadError: string | undefined;
    let parseError: string | undefined;
    if (result.stdout.trim()) {
      try {
        const parsedPayload = parseJsonPayload(result.stdout);
        data = parsedPayload.data;
        payloadOk = parsedPayload.ok;
        payloadError = parsedPayload.error;
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
    }

    const ok = result.exitCode === 0 && !parseError && payloadOk !== false;
    const error = ok
      ? undefined
      : parseError
        ?? payloadError
        ?? (result.stderr.trim() || result.stdout.trim() || `RDX action "${actionId}" exited with ${result.exitCode}.`);

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
    };
  }
}

function isActionConfigured(action: RdxShellActionSettings | undefined): action is RdxShellActionSettings {
  return Boolean(action?.enabled && action.command.trim());
}

export const rdxShellActionService = new RdxShellActionService();
