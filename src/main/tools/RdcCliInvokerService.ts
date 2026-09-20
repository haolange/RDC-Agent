import { parseRdcNativeResult } from './RdcNativeProtocol';
import { assertRdcCliBinding } from '@shared/utils/rdcCliBinding';
import { canonicalJson, deepFreeze, validateDefinitions, validateApplicationOperations } from './RdcOperationCatalog';
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
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import { settingsService } from '../settings/SettingsService';
import { shellInvocationService, type ShellInvocationService } from './ShellInvocationService';
import { resolveRdcBatchInvocation } from './resolveRdcBatchInvocation';
import { RDC_INTERMEDIATE_ROOT_ENV, withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';

export class RdcCliInvokerService {
  private catalogs = new Map<string, Promise<ToolCatalog>>();
  private validatedCatalogs = new Map<string, ToolCatalog>();
  private versions = new Map<string, string>();
  private traceListeners = new Set<(trace: ToolTraceEntry) => void>();

  constructor(private readonly shell: ShellInvocationService = shellInvocationService) {}

  private getSettings(): RdcCliInvokerSettings {
    return settingsService.getAll().tooling.rdcCli;
  }

  private createRuntimeMetadata(settings = this.getSettings(), catalog?: Partial<ToolCatalog>): ToolRuntimeMetadata {
    const resolved = withRdcHostRuntimeEnv(settings);
    return {
      source: settings.enabled && settings.command.trim() ? 'configured' : 'unconfigured',
      command: settings.command.trim(),
      workingDirectory: settings.workingDirectory.trim(),
      intermediateRoot: resolved.env[RDC_INTERMEDIATE_ROOT_ENV] ?? '',
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
      return 'RDC-Tool CLI invoker is disabled. Configure it in Settings.';
    }
    if (!settings.command.trim()) {
      return 'RDC-Tool CLI command is not configured.';
    }
    const command = settings.command.trim();
    try { assertRdcCliBinding(settings); } catch (error) { return (error as Error).message; }
    if ((path.isAbsolute(command) || command.includes(path.sep) || command.includes('/')) && !fs.existsSync(command)) {
      return `RDC-Tool CLI command not found: ${command}`;
    }
    const root = path.resolve(path.dirname(command), '..', '..', '..', '..');
    const entry = path.resolve(settings.workingDirectory || root, settings.argsPrefix[0]);
    if (!fs.existsSync(entry)) return `RDC_BINDING_INVALID: CLI entry not found: ${entry}`;
    if (fs.realpathSync(command).toLowerCase() !== path.join(fs.realpathSync(root), 'binaries', 'windows', 'x64', 'python', 'python.exe').toLowerCase()
      || fs.realpathSync(entry).toLowerCase() !== path.join(fs.realpathSync(root), 'cli', 'run_cli.py').toLowerCase()) {
      return 'RDC_BINDING_INVALID: Python and CLI must resolve inside the same installation.';
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

  async loadCatalog(settings: RdcCliInvokerSettings = this.getSettings(), refresh = false): Promise<ToolCatalog> {
    const frozen = deepFreeze(structuredClone(settings));
    const key = canonicalJson(frozen);
    const unavailable = this.getAvailabilityFailure(frozen);
    if (unavailable) {
      this.catalogs.delete(key); this.validatedCatalogs.delete(key); this.versions.delete(key);
      throw new Error(unavailable);
    }
    if (refresh) { this.catalogs.delete(key); this.validatedCatalogs.delete(key); this.versions.delete(key); }
    const cached = this.catalogs.get(key);
    if (cached) return cached;
    const loading = (async () => {
      const version = parseRdcNativeResult(await this.executeCLI('version', ['--json'], { settings: frozen }), undefined, 'rdc_tool.version');
      if (version.schema_version !== '3.0.0' || version.data.schema_version !== '3.0.0'
        || typeof version.data.tool_version !== 'string' || !version.data.tool_version.trim()) {
        throw new Error('RDC_UPGRADE_REQUIRED: the configured CLI must provide the current canonical JSON contract.');
      }
      const envelope = parseRdcNativeResult(await this.executeCLI('tools', ['list', '--full', '--json'], { settings: frozen }), undefined, 'rdc_tool.tools.list');
      if (envelope.schema_version !== '3.0.0' || envelope.data.schema_version !== '1') throw new Error('RDC_UPGRADE_REQUIRED: unsupported catalog envelope schema.');
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

  async getRuntimeSummary(refresh = false, draft: RdcCliInvokerSettings = this.getSettings()): Promise<ToolRuntimeSummary> {
    const settings = structuredClone(draft);
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

  private buildCommandArgs(
    settings: RdcCliInvokerSettings,
    command: string,
    args: string[],
    options: { contextId?: string } = {},
  ): string[] {
    const globalArgs: string[] = [];
    const commandArgs: string[] = [];
    let hasOwnerPid = false;

    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];
      if (current === '--daemon-context' || current === '--owner-pid') {
        const value = args[index + 1];
        if (value) {
          globalArgs.push(current, value);
          if (current === '--owner-pid') hasOwnerPid = true;
          index += 1;
          continue;
        }
      }
      commandArgs.push(current);
    }

    if (options.contextId && !hasOwnerPid) {
      globalArgs.push('--owner-pid', String(process.pid));
    }

    const root = path.resolve(path.dirname(settings.command), '..', '..', '..', '..');
    return [
      path.resolve(settings.workingDirectory || root, settings.argsPrefix[0]),
      '--json',
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
      settings?: RdcCliInvokerSettings;
    } = {},
  ): Promise<CLIResult> {
    const startTime = nowMs();
    const incoming = options.settings ?? this.getSettings();
    const settings = withRdcHostRuntimeEnv({
      ...incoming,
      env: { ...incoming.env, ...options.env },
    });
    const unavailableReason = this.getAvailabilityFailure(settings);
    if (unavailableReason) {
      const key = canonicalJson(incoming);
      this.catalogs.delete(key); this.validatedCatalogs.delete(key); this.versions.delete(key);
      return {
        exitCode: 2,
        stdout: '',
        stderr: unavailableReason,
        duration_ms: nowMs() - startTime,
      };
    }

    if (command !== 'version' && !(command === 'tools' && args[0] === 'list')) {
      try { await this.loadCatalog(incoming); } catch (error) {
        return { exitCode: 2, stdout: '', stderr: (error as Error).message, duration_ms: nowMs() - startTime };
      }
    }

    const invocation = resolveRdcBatchInvocation(
      settings.command,
      this.buildCommandArgs(settings, command, args, { contextId: options.contextId }),
    );

    return this.shell.invoke({
      command: invocation.command,
      args: invocation.args,
      cwd: options.cwd || settings.workingDirectory || undefined,
      env: { ...settings.env, PYTHONHOME: '', PYTHONPATH: '', RDC_TOOL_ROOT: path.resolve(path.dirname(settings.command), '..', '..', '..', '..') },
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
      parseRdcNativeResult(result);
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
                message: (errObj.message as string) ?? 'RDC-Tool CLI returned ok:false',
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

export const rdcCliInvokerService = new RdcCliInvokerService();
