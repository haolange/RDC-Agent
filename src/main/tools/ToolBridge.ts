/**
 * ToolBridge - bridges RDC-Agent to the bundled rdx-tools CLI runtime.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolCatalog,
  ToolRuntimeSummary,
  ToolRuntimeMetadata,
  CLIResult,
  ToolTraceEntry,
} from '@shared/types/tool';
import { nowMs, generateEventId } from '@shared/utils/id';

interface WindowsLauncherSpec {
  powershellPath: string;
  launcherScriptPath: string;
  systemRoot: string;
  comSpec: string;
}

interface DirectCliSpec {
  pythonPath: string;
  runCliPath: string;
}

interface ToolRuntimeResolution {
  source: ToolRuntimeMetadata['source'];
  toolsRoot: string;
  version: string | null;
  catalogPath: string;
}

export class ToolBridge {
  private toolsPath: string;
  private runtime: ToolRuntimeResolution;
  private catalog: ToolCatalog | null = null;
  private activeProcesses: Map<string, { process: ChildProcess; runId?: string }> = new Map();
  private traceListeners = new Set<(trace: ToolTraceEntry) => void>();

  constructor() {
    this.runtime = this.resolveToolRuntime();
    this.toolsPath = this.runtime.toolsRoot;
  }

  private resolveToolRuntime(): ToolRuntimeResolution {
    const externalRoot = !app.isPackaged ? process.env.RDX_TOOLS_ROOT?.trim() : undefined;
    const toolsRoot = externalRoot
      ? path.resolve(externalRoot)
      : this.resolveBundledToolsRoot();

    return {
      source: externalRoot ? 'external' : 'bundled',
      toolsRoot,
      version: this.readRuntimeVersion(toolsRoot),
      catalogPath: path.join(toolsRoot, 'spec', 'tool_catalog.json'),
    };
  }

  private resolveBundledToolsRoot(): string {
    const appPath = app.getAppPath();
    const candidates = app.isPackaged
      ? [
          path.join(process.resourcesPath, 'resources', 'tools'),
          path.join(process.resourcesPath, 'tools'),
        ]
      : [
          path.join(appPath, 'resources', 'tools'),
          path.join(appPath, '..', 'resources', 'tools'),
          path.join(appPath, '..', '..', 'resources', 'tools'),
          path.join(appPath, '..', '..', '..', 'resources', 'tools'),
          path.join(process.cwd(), 'resources', 'tools'),
        ];

    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }

    return path.resolve(candidates[0]);
  }

  private readRuntimeVersion(toolsRoot: string): string | null {
    const pyprojectPath = path.join(toolsRoot, 'pyproject.toml');
    if (!fs.existsSync(pyprojectPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private createRuntimeMetadata(catalog?: Partial<ToolCatalog>): ToolRuntimeMetadata {
    return {
      source: this.runtime.source,
      toolsRoot: this.runtime.toolsRoot,
      version: this.runtime.version,
      catalog: {
        path: this.runtime.catalogPath,
        exists: fs.existsSync(this.runtime.catalogPath),
        schemaVersion: catalog?.schema_version ?? null,
        generatedAt: catalog?.generated_at ?? null,
        toolCount: catalog?.tool_count ?? (Array.isArray(catalog?.tools) ? catalog.tools.length : null),
      },
    };
  }

  /**
   * 获取工具目录路径
   */
  getToolsPath(): string {
    return this.toolsPath;
  }

  /**
   * 获取rdx.bat路径
   */
  getRdxPath(): string {
    return path.join(this.toolsPath, 'rdx.bat');
  }

  getRuntimeMetadata(): ToolRuntimeMetadata {
    return this.createRuntimeMetadata(this.catalog ?? undefined);
  }

  private resolveDirectCliSpec(): DirectCliSpec {
    const pythonPath = path.join(this.toolsPath, 'binaries', 'windows', 'x64', 'python', 'python.exe');
    const runCliPath = path.join(this.toolsPath, 'cli', 'run_cli.py');
    if (!fs.existsSync(pythonPath)) {
      throw new Error(`RDX python runtime not found: ${pythonPath}`);
    }
    if (!fs.existsSync(runCliPath)) {
      throw new Error(`CLI launcher not found: ${runCliPath}`);
    }
    return {
      pythonPath,
      runCliPath,
    };
  }

  private normalizeCliArgs(args: string[]): string[] {
    const normalized: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];
      if (current === '--context-id') {
        normalized.push('--daemon-context');
        continue;
      }
      normalized.push(current);
    }
    return normalized;
  }

  private buildDirectCliArgs(command: string, args: string[]): string[] {
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
      ...globalArgs,
      command,
      ...commandArgs,
    ];
  }

  private resolveWindowsLauncher(): WindowsLauncherSpec {
    const toolsRoot = path.resolve(this.toolsPath);
    if (!fs.existsSync(toolsRoot)) {
      throw new Error(`RDX tools root not found: ${toolsRoot}`);
    }

    const launcherScriptPath = path.join(toolsRoot, 'scripts', 'rdx_bat_launcher.ps1');
    if (!fs.existsSync(launcherScriptPath)) {
      throw new Error(`RDX launcher script not found: ${launcherScriptPath}`);
    }

    const systemRoot = process.env.SystemRoot?.trim()
      || process.env.windir?.trim()
      || 'C:\\Windows';
    const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!fs.existsSync(powershellPath)) {
      throw new Error(`Windows PowerShell launcher not found: ${powershellPath}`);
    }

    return {
      powershellPath,
      launcherScriptPath,
      systemRoot,
      comSpec: process.env.ComSpec?.trim() || path.join(systemRoot, 'System32', 'cmd.exe'),
    };
  }

  /**
   * 检查工具是否可用
   */
  isAvailable(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const launcher = this.resolveWindowsLauncher();
      return fs.existsSync(launcher.launcherScriptPath);
    } catch {
      return false;
    }
  }

  private getAvailabilityFailure(): string | undefined {
    if (process.platform !== 'win32') {
      return 'RDX CLI is available only through the bundled Windows launcher in this app.';
    }

    try {
      this.resolveWindowsLauncher();
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * 加载工具目录
   */
  async loadCatalog(): Promise<ToolCatalog> {
    if (this.catalog) {
      return this.catalog;
    }

    const catalogPath = this.runtime.catalogPath;
    if (!fs.existsSync(catalogPath)) {
      console.warn('[ToolBridge] Tool catalog not found, starting with empty RDC tool catalog: ' + catalogPath);
      this.catalog = {
        schema_version: '1',
        tools: [],
        namespaces: {} as ToolCatalog['namespaces'],
        runtime: this.createRuntimeMetadata(),
      };
      return this.catalog;
    }

    const content = await fs.promises.readFile(catalogPath, 'utf-8');
    const catalog = JSON.parse(content) as ToolCatalog;
    this.catalog = {
      ...catalog,
      runtime: this.createRuntimeMetadata(catalog),
    };
    return this.catalog!;
  }

  async getRuntimeSummary(): Promise<ToolRuntimeSummary> {
    const catalog = await this.loadCatalog();
    const namespaceCounts = new Map<string, number>();
    for (const tool of catalog.tools ?? []) {
      namespaceCounts.set(tool.namespace, (namespaceCounts.get(tool.namespace) ?? 0) + 1);
    }

    const namespaces = Object.keys(catalog.namespaces ?? {})
      .sort()
      .map((namespace) => ({
        namespace: `rd.${namespace}.*`,
        toolCount: namespaceCounts.get(namespace) ?? 0,
        available: (namespaceCounts.get(namespace) ?? 0) > 0,
      }));

    return {
      runtime: this.createRuntimeMetadata(catalog),
      cli: {
        available: this.isAvailable(),
        unavailableReason: this.getAvailabilityFailure(),
      },
      namespaces,
      recommendedSpecialists: [
        'triage_agent',
        'capture_repro_agent',
        'pass_graph_pipeline_agent',
        'pixel_forensics_agent',
        'shader_ir_agent',
        'skeptic_agent',
        'curator_agent',
      ],
    };
  }

  /**
   * 执行CLI命令（参数数组模式，避免命令字符串注入风险）
   * command: 子命令名称，如 'call', 'daemon'
   * args: 子命令参数数组
   */
  async executeCLI(
    command: string,
    args: string[] = [],
    options: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
      runId?: string;
      abortSignal?: AbortSignal;
    } = {}
  ): Promise<CLIResult> {
    const startTime = nowMs();

    if (process.platform !== 'win32') {
      return {
        exitCode: 2,
        stdout: '',
        stderr: 'RDC-Agent currently supports the bundled Windows launcher only.',
        duration_ms: nowMs() - startTime,
      };
    }

    let directCli: DirectCliSpec | null = null;
    try {
      directCli = this.resolveDirectCliSpec();
    } catch {
      directCli = null;
    }

    return new Promise((resolve, reject) => {
      let proc: ChildProcess;
      if (directCli) {
        proc = spawn(
          directCli.pythonPath,
          [
            directCli.runCliPath,
            ...this.buildDirectCliArgs(command, args),
          ],
          {
            cwd: options.cwd || this.toolsPath,
            env: {
              ...process.env,
              ...options.env,
              RDX_TOOLS_ROOT: this.toolsPath,
              PYTHONIOENCODING: 'utf-8',
              RDX_LAUNCHER_PROG: 'rdx.bat',
            },
            windowsHide: true,
          },
        );
      } else {
        let launcher: WindowsLauncherSpec;
        try {
          launcher = this.resolveWindowsLauncher();
        } catch (error) {
          resolve({
            exitCode: 2,
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            duration_ms: nowMs() - startTime,
          });
          return;
        }

        proc = spawn(
          launcher.powershellPath,
          [
            '-NoProfile',
            '-NoLogo',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            launcher.launcherScriptPath,
            '--non-interactive',
            command,
            ...args,
          ],
          {
            cwd: options.cwd || this.toolsPath,
            env: {
              ...process.env,
              ...options.env,
              RDX_TOOLS_ROOT: this.toolsPath,
              PYTHONIOENCODING: 'utf-8',
              SystemRoot: launcher.systemRoot,
              ComSpec: launcher.comSpec,
            },
            windowsHide: true,
          }
        );
      }

      const procId = generateEventId('proc');
      this.activeProcesses.set(procId, {
        process: proc,
        runId: options.runId,
      });

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;
      let settled = false;

      const finalize = (result: CLIResult) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        if (options.abortSignal && abortHandler) {
          options.abortSignal.removeEventListener('abort', abortHandler);
        }
        resolve(result);
      };

      if (options.timeout) {
        timeoutId = setTimeout(() => {
          proc.kill();
          reject(new Error(`Process timeout after ${options.timeout}ms`));
        }, options.timeout);
      }

      const abortHandler = () => {
        try {
          proc.kill();
        } catch {
          // noop
        }
      };

      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abortHandler();
        } else {
          options.abortSignal.addEventListener('abort', abortHandler, { once: true });
        }
      }

      proc.stdout?.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        finalize({
          exitCode: code || 0,
          stdout,
          stderr,
          duration_ms: nowMs() - startTime,
        });
      });

      proc.on('error', (error) => {
        finalize({
          exitCode: 2,
          stdout,
          stderr: error instanceof Error ? error.message : String(error),
          duration_ms: nowMs() - startTime,
        });
      });
    });
  }

  onToolTrace(listener: (trace: ToolTraceEntry) => void): () => void {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }

  private emitToolTrace(request: ToolCallRequest, result: ToolCallResult): void {
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

  /**
   * 调用rd.*工具
   * 使用参数数组模式，避免命令字符串拼接注入风险
   */
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = nowMs();
    let response: ToolCallResult;

    try {
      // 参数数组模式：'call' <toolName> [--args-json <json>] [--context-id <id>] [--runtime-owner <owner>]
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
        timeout: 60000, // 60秒超时
        runId: request.runId,
        abortSignal: request.abortSignal,
      });

      // 优先解析 canonical JSON，即使 CLI 以非零退出码返回也可能给出结构化错误
      if (result.stdout.trim()) {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          if (result.exitCode === 0) {
            // stdout 不是 JSON，视为裸文本成功
            response = {
              ok: true,
              data: { raw: result.stdout },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId('tool'),
            };
            this.emitToolTrace(request, response);
            return response;
          }
        }

        if (parsed) {
          if (parsed.ok === false) {
            // CLI 层返回结构化错误
            const errObj = (parsed.error ?? {}) as Record<string, unknown>;
            response = {
              ok: false,
              data: null as unknown as Record<string, unknown>,
              artifacts: [],
              error: {
                code: (errObj.code as string) ?? 'TOOL_ERROR',
                message: (errObj.message as string) ?? 'Tool returned ok:false',
                category: (errObj.category as string) ?? 'execution',
                details: (errObj.details as Record<string, unknown>) ?? undefined,
              },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId('tool'),
            };
            this.emitToolTrace(request, response);
            return response;
          }

          response = {
            ok: true,
            data: (parsed.data as Record<string, unknown>) ?? parsed,
            artifacts: parsed.artifacts as ToolCallResult['artifacts'],
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId('tool'),
          };
          this.emitToolTrace(request, response);
          return response;
        }
      }

      // 非零退出码或空 stdout — 结构化错误
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
      this.emitToolTrace(request, response);
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
      this.emitToolTrace(request, response);
      return response;
    }
  }

  abortRun(runId: string): void {
    for (const { process, runId: activeRunId } of this.activeProcesses.values()) {
      if (activeRunId !== runId) {
        continue;
      }

      try {
        process.kill();
      } catch {
        // noop
      }
    }
  }

  /**
   * 打开capture文件
   */
  async openCapture(filePath: string, options: {
    frameIndex?: number;
    preview?: boolean;
  } = {}): Promise<ToolCallResult> {
    const args: Record<string, unknown> = {
      file: filePath,
    };

    if (options.frameIndex !== undefined) {
      args['frame-index'] = options.frameIndex;
    }
    if (options.preview) {
      args['--preview'] = true;
    }

    return this.call({
      toolName: 'rd.capture.open_file',
      args,
    });
  }

  /**
   * 打开replay session
   */
  async openReplay(captureFileId: string, options: {
    remoteId?: string;
  } = {}): Promise<ToolCallResult> {
    const args: Record<string, unknown> = {
      capture_file_id: captureFileId,
    };

    if (options.remoteId) {
      args.options = { remote_id: options.remoteId };
    }

    return this.call({
      toolName: 'rd.capture.open_replay',
      args,
    });
  }

  /**
   * 获取session context
   */
  async getSessionContext(sessionId?: string): Promise<ToolCallResult> {
    return this.call({
      toolName: 'rd.session.get_context',
      args: sessionId ? { session_id: sessionId } : {},
    });
  }

  /**
   * 获取capture状态
   */
  async getCaptureStatus(): Promise<ToolCallResult> {
    return this.call({
      toolName: 'rd.capture.status',
      args: {},
    });
  }

  /**
   * 获取session状态
   */
  async getSessionStatus(): Promise<ToolCallResult> {
    return this.call({
      toolName: 'rd.session.get_context',
      args: {},
    });
  }

  /**
   * 列出可用工具
   */
  async listTools(options: {
    namespace?: string;
    group?: string;
    capability?: string;
  } = {}): Promise<ToolCallResult> {
    return this.call({
      toolName: 'rd.core.list_tools',
      args: options,
    });
  }

  /**
   * 终止所有活动进程
   */
  terminateAll(): void {
    for (const [id, active] of this.activeProcesses) {
      try {
        active.process.kill();
      } catch (error) {
        console.error(`Failed to terminate process ${id}:`, error);
      }
    }
    this.activeProcesses.clear();
  }
}

// 单例导出
export const toolBridge = new ToolBridge();
