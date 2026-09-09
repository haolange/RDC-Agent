import { parseRdxNativeResult } from './RdxNativeProtocol';
import fs from 'fs';
import path from 'path';
import type {
  CLIResult,
  ToolCallRequest,
  ToolCallResult,
  ToolCatalog,
  ToolRuntimeMetadata,
  ToolRuntimeSummary,
  ToolTraceEntry,
} from '@shared/types/tool';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import { settingsService } from '../settings/SettingsService';
import { shellInvocationService, type ShellInvocationService } from './ShellInvocationService';
import { resolveRdxBatchInvocation } from './resolveRdxBatchInvocation';

const EMPTY_NAMESPACES: ToolCatalog['namespaces'] = {
  capture: { description: '', groups: [] },
  session: { description: '', groups: [] },
  event: { description: '', groups: [] },
  replay: { description: '', groups: [] },
  pipeline: { description: '', groups: [] },
  shader: { description: '', groups: [] },
  texture: { description: '', groups: [] },
  resource: { description: '', groups: [] },
  export: { description: '', groups: [] },
  remote: { description: '', groups: [] },
  core: { description: '', groups: [] },
  macro: { description: '', groups: [] },
  vfs: { description: '', groups: [] },
};

const EMPTY_CATALOG: ToolCatalog = {
  schema_version: 'unconfigured',
  tool_count: 0,
  tools: [],
  namespaces: EMPTY_NAMESPACES,
};

export class RdxCliInvokerService {
  private catalog: ToolCatalog | null = null;
  private catalogPath: string | null = null;
  private traceListeners = new Set<(trace: ToolTraceEntry) => void>();

  constructor(private readonly shell: ShellInvocationService = shellInvocationService) {}

  private getSettings(): RdxCliInvokerSettings {
    return settingsService.getAll().tooling.rdxCli;
  }

  private createRuntimeMetadata(settings = this.getSettings(), catalog?: Partial<ToolCatalog>): ToolRuntimeMetadata {
    const catalogPath = settings.catalogPath.trim();
    return {
      source: settings.enabled && settings.command.trim() ? 'configured' : 'unconfigured',
      command: settings.command.trim(),
      workingDirectory: settings.workingDirectory.trim(),
      version: null,
      catalog: {
        path: catalogPath,
        exists: catalogPath ? fs.existsSync(catalogPath) : false,
        schemaVersion: catalog?.schema_version ?? null,
        generatedAt: catalog?.generated_at ?? null,
        toolCount: catalog?.tool_count ?? (Array.isArray(catalog?.tools) ? catalog.tools.length : null),
      },
    };
  }

  private getAvailabilityFailure(settings = this.getSettings()): string | undefined {
    if (!settings.enabled) {
      return 'RDX CLI invoker is disabled. Configure it in Settings.';
    }
    if (!settings.command.trim()) {
      return 'RDX CLI command is not configured.';
    }
    const command = settings.command.trim();
    if ((path.isAbsolute(command) || command.includes(path.sep) || command.includes('/')) && !fs.existsSync(command)) {
      return `RDX CLI command not found: ${command}`;
    }
    return undefined;
  }

  isAvailable(): boolean {
    return this.getAvailabilityFailure() === undefined;
  }

  getRuntimeMetadata(): ToolRuntimeMetadata {
    return this.createRuntimeMetadata(this.getSettings(), this.catalog ?? undefined);
  }

  async loadCatalog(): Promise<ToolCatalog> {
    const settings = this.getSettings();
    const catalogPath = settings.catalogPath.trim();
    if (!catalogPath) {
      this.catalog = { ...EMPTY_CATALOG, runtime: this.createRuntimeMetadata(settings) };
      this.catalogPath = null;
      return this.catalog;
    }
    if (this.catalog && this.catalogPath === catalogPath) {
      return this.catalog;
    }
    if (!fs.existsSync(catalogPath)) {
      this.catalog = { ...EMPTY_CATALOG, runtime: this.createRuntimeMetadata(settings) };
      this.catalogPath = catalogPath;
      return this.catalog;
    }

    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as ToolCatalog;
    this.catalog = {
      ...catalog,
      runtime: this.createRuntimeMetadata(settings, catalog),
    };
    this.catalogPath = catalogPath;
    return this.catalog;
  }

  async getRuntimeSummary(): Promise<ToolRuntimeSummary> {
    const settings = this.getSettings();
    const catalog = await this.loadCatalog();
    const namespaceCounts = new Map<string, number>();
    for (const tool of catalog.tools ?? []) {
      namespaceCounts.set(tool.namespace, (namespaceCounts.get(tool.namespace) ?? 0) + 1);
    }

    const unavailableReason = this.getAvailabilityFailure(settings);
    const namespaces = Array.from(namespaceCounts.entries()).map(([namespace, toolCount]) => ({
      namespace: `rd.${namespace}.*`,
      toolCount,
      available: !unavailableReason,
    }));

    return {
      runtime: this.createRuntimeMetadata(settings, catalog),
      cli: {
        available: !unavailableReason,
        unavailableReason,
      },
      namespaces,
    };
  }

  private normalizeCliArgs(args: string[]): string[] {
    const normalized: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];
      normalized.push(current === '--context-id' ? '--daemon-context' : current);
    }
    return normalized;
  }

  private buildCommandArgs(settings: RdxCliInvokerSettings, command: string, args: string[]): string[] {
    const normalized = this.normalizeCliArgs(args);
    const globalArgs: string[] = [];
    const commandArgs: string[] = [];

    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      if (current === '--daemon-context') {
        const value = normalized[index + 1];
        if (value) {
          globalArgs.push(current, value);
          index += 1;
          continue;
        }
      }
      commandArgs.push(current);
    }

    return [
      ...settings.argsPrefix,
      ...globalArgs,
      command,
      ...commandArgs,
    ];
  }

  async executeCLI(
    command: string,
    args: string[] = [],
    options: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
      runId?: string;
      abortSignal?: AbortSignal;
      settings?: RdxCliInvokerSettings;
    } = {},
  ): Promise<CLIResult> {
    const startTime = nowMs();
    const settings = options.settings ?? this.getSettings();
    const unavailableReason = this.getAvailabilityFailure(settings);
    if (unavailableReason) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: unavailableReason,
        duration_ms: nowMs() - startTime,
      };
    }

    const invocation = resolveRdxBatchInvocation(
      settings.command,
      this.buildCommandArgs(settings, command, args),
    );

    return this.shell.invoke({
      command: invocation.command,
      args: invocation.args,
      cwd: options.cwd || settings.workingDirectory || undefined,
      env: {
        ...settings.env,
        ...options.env,
      },
      timeoutMs: options.timeout ?? settings.timeoutMs,
      runId: options.runId,
      abortSignal: options.abortSignal,
    });
  }

  onInvocationTrace(listener: (trace: ToolTraceEntry) => void): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }

  private emitInvocationTrace(request: ToolCallRequest, result: ToolCallResult): void {
    const trace: ToolTraceEntry = {
      traceId: result.trace_id || generateEventId('tool-trace'),
      turnId: request.turnId,
      toolName: request.toolName,
      args: request.args,
      result,
      timestamp: nowMs(),
      contextId: request.contextId ?? '',
      runtimeOwner: request.runtimeOwner ?? '',
      ownerLeaseId: request.ownerLeaseId,
    };

    for (const listener of this.traceListeners) {
      listener(trace);
    }
  }

  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = nowMs();
    let response: ToolCallResult;

    try {
      const cliArgs: string[] = [request.toolName];
      const effectiveArgs: Record<string, unknown> = {
        ...(request.args || {}),
      };

      if (request.contextId && effectiveArgs['context_id'] === undefined) {
        effectiveArgs['context_id'] = request.contextId;
      }
      if (request.runtimeOwner && effectiveArgs['runtime_owner'] === undefined) {
        effectiveArgs['runtime_owner'] = request.runtimeOwner;
      }
      if (request.ownerLeaseId && effectiveArgs['owner_lease_id'] === undefined) {
        effectiveArgs['owner_lease_id'] = request.ownerLeaseId;
      }

      if (Object.keys(effectiveArgs).length > 0) {
        cliArgs.push('--args-json', JSON.stringify(effectiveArgs));
      }

      if (request.contextId) {
        cliArgs.push('--daemon-context', request.contextId);
      }

      const result = await this.executeCLI('call', cliArgs, {
        timeout: this.getSettings().timeoutMs,
        runId: request.runId,
        abortSignal: request.abortSignal,
      });

      request.abortSignal?.throwIfAborted();
      parseRdxNativeResult(result);
      if (result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

        if (parsed) {
          if (parsed.ok === false) {
            const errObj = (parsed.error ?? {}) as Record<string, unknown>;
            response = {
              ok: false,
              data: null as unknown as Record<string, unknown>,
              artifacts: [],
              error: {
                code: (errObj.code as string) ?? 'TOOL_ERROR',
                message: (errObj.message as string) ?? 'RDX CLI returned ok:false',
                category: (errObj.category as string) ?? 'execution',
                details: (errObj.details as Record<string, unknown>) ?? undefined,
              },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId('tool'),
            };
            this.emitInvocationTrace(request, response);
            return response;
          }

          response = {
            ok: true,
            data: (parsed.data as Record<string, unknown>) ?? parsed,
            artifacts: parsed.artifacts as ToolCallResult['artifacts'],
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId('tool'),
          };
          this.emitInvocationTrace(request, response);
          return response;
        }
      }

      response = {
        ok: false,
        data: null as unknown as Record<string, unknown>,
        artifacts: [],
        error: {
          code: 'CLI_ERROR',
          message: result.stderr.trim() || `Exit code: ${result.exitCode}`,
          category: 'execution',
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          },
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId('tool'),
      };
      this.emitInvocationTrace(request, response);
      return response;
    } catch (error) {
      response = {
        ok: false,
        data: null as unknown as Record<string, unknown>,
        artifacts: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          category: 'internal',
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId('tool'),
      };
      this.emitInvocationTrace(request, response);
      return response;
    }
  }

  abortRun(runId: string): void {
    this.shell.abortRun(runId);
  }

  terminateAll(): void {
    this.shell.terminateAll();
  }
}

export const rdxCliInvokerService = new RdxCliInvokerService();
