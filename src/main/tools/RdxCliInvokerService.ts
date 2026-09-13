import { parseRdxNativeResult } from './RdxNativeProtocol';
import { canonicalJson, deepFreeze, validateDefinitions, validateApplicationOperations } from './RdxOperationCatalog';
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

export class RdxCliInvokerService {
  private catalogs = new Map<string, Promise<ToolCatalog>>();
  private validatedCatalogs = new Map<string, ToolCatalog>();
  private versions = new Map<string, string>();
  private traceListeners = new Set<(trace: ToolTraceEntry) => void>();

  constructor(private readonly shell: ShellInvocationService = shellInvocationService) {}

  private getSettings(): RdxCliInvokerSettings {
    return settingsService.getAll().tooling.rdxCli;
  }

  private createRuntimeMetadata(settings = this.getSettings(), catalog?: Partial<ToolCatalog>): ToolRuntimeMetadata {
    return {
      source: settings.enabled && settings.command.trim() ? 'configured' : 'unconfigured',
      command: settings.command.trim(),
      workingDirectory: settings.workingDirectory.trim(),
      version: this.versions.get(canonicalJson(settings)) ?? null,
      catalog: {
        path: '',
        exists: !!catalog?.fingerprint,
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
    return this.getAvailabilityFailure() === undefined && this.validatedCatalogs.has(canonicalJson(this.getSettings()));
  }

  getRuntimeMetadata(): ToolRuntimeMetadata {
    const settings = this.getSettings();
    return this.createRuntimeMetadata(settings, this.validatedCatalogs.get(canonicalJson(settings)));
  }

  async loadCatalog(settings: RdxCliInvokerSettings = this.getSettings(), refresh = false): Promise<ToolCatalog> {
    const frozen = deepFreeze(structuredClone(settings));
    const key = canonicalJson(frozen);
    const unavailable = this.getAvailabilityFailure(frozen);
    if (unavailable) throw new Error(unavailable);
    if (refresh) { this.catalogs.delete(key); this.validatedCatalogs.delete(key); this.versions.delete(key); }
    const cached = this.catalogs.get(key);
    if (cached) return cached;
    const loading = (async () => {
      const version = parseRdxNativeResult(await this.executeCLI('version', ['--json'], { settings: frozen }), undefined, 'rdx.version');
      if (version.schema_version !== '3.0.0' || version.data.schema_version !== '3.0.0'
        || typeof version.data.tool_version !== 'string' || !version.data.tool_version.trim()) {
        throw new Error('RDX_UPGRADE_REQUIRED: the configured CLI must provide the current canonical JSON contract.');
      }
      const envelope = parseRdxNativeResult(await this.executeCLI('tools', ['list', '--full', '--json'], { settings: frozen }), undefined, 'rdx.tools.list');
      if (envelope.schema_version !== '3.0.0' || envelope.data.schema_version !== '1') throw new Error('RDX_UPGRADE_REQUIRED: unsupported catalog envelope schema.');
      const tools = validateDefinitions(envelope.data.tools, envelope.data.tool_count, envelope.data.fingerprint);
      validateApplicationOperations(tools);
      const namespaces: ToolCatalog['namespaces'] = {};
      for (const tool of tools) namespaces[tool.namespace] ??= { description: '', groups: [] };
      this.versions.set(key, version.data.tool_version);
      const catalog: ToolCatalog = deepFreeze({ schema_version: '1', fingerprint: String(envelope.data.fingerprint), tools,
        tool_count: tools.length, namespaces, runtime: this.createRuntimeMetadata(frozen, { tool_count: tools.length, schema_version: '1', fingerprint: String(envelope.data.fingerprint) }) });
      this.validatedCatalogs.set(key, catalog);
      return catalog;
    })();
    this.catalogs.set(key, loading);
    try { return await loading; } catch (error) { this.catalogs.delete(key); this.validatedCatalogs.delete(key); this.versions.delete(key); throw error; }
  }

  async getRuntimeSummary(refresh = false): Promise<ToolRuntimeSummary> {
    const settings = structuredClone(this.getSettings());
    if (refresh) {
      const key = canonicalJson(settings);
      this.catalogs.delete(key); this.validatedCatalogs.delete(key); this.versions.delete(key);
    }
    try {
      const catalog = await this.loadCatalog(settings);
      const counts = new Map<string, number>();
      for (const tool of catalog.tools) counts.set(tool.namespace, (counts.get(tool.namespace) ?? 0) + 1);
      return { runtime: this.createRuntimeMetadata(settings, catalog), cli: { available: true },
        namespaces: [...counts].map(([namespace, toolCount]) => ({ namespace: `rd.${namespace}.*`, toolCount, available: true })) };
    } catch (error) {
      return { runtime: this.createRuntimeMetadata(settings), cli: { available: false, unavailableReason: error instanceof Error ? error.message : String(error) }, namespaces: [] };
    }
  }

  private buildCommandArgs(settings: RdxCliInvokerSettings, command: string, args: string[]): string[] {
    const globalArgs: string[] = [];
    const commandArgs: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];
      if (current === '--daemon-context') {
        const value = args[index + 1];
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
      contextId?: string;
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
      outputBufferBytes: 8 * 1024 * 1024,
      runId: options.runId,
      contextId: options.contextId,
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
        contextId: request.contextId,
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
