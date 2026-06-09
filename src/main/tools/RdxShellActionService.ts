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

const substitute = (value: string, variables: RdxShellActionVariables): string => (
  value.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const replacement = variables[key];
    return replacement == null ? '' : String(replacement);
  })
);

const parseJsonPayload = (stdout: string): Record<string, unknown> => {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('RDX action stdout must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
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
    let parseError: string | undefined;
    if (result.exitCode === 0) {
      try {
        data = parseJsonPayload(result.stdout);
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
    }

    const ok = result.exitCode === 0 && !parseError;
    const error = ok
      ? undefined
      : parseError ?? (result.stderr.trim() || result.stdout.trim() || `RDX action "${actionId}" exited with ${result.exitCode}.`);

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
