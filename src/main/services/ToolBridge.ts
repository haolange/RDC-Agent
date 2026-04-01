/**
 * ToolBridge - 工具层桥接服务
 * 负责与RDC-Agent-Tools CLI/MCP接口通信
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import type { ToolCallRequest, ToolCallResult, ToolCatalog, CLIResult } from '@shared/types/tool';
import { nowMs, generateEventId } from '@shared/utils/id';

export class ToolBridge {
  private toolsPath: string;
  private catalog: ToolCatalog | null = null;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor() {
    // 确定工具路径
    if (app.isPackaged) {
      this.toolsPath = path.join(path.dirname(app.getPath('exe')), 'resources', 'tools');
    } else {
      // 开发模式：相对于项目根目录
      this.toolsPath = path.resolve(__dirname, '../../../../resources/tools');
    }
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

  /**
   * 检查工具是否可用
   */
  isAvailable(): boolean {
    const rdxPath = this.getRdxPath();
    return fs.existsSync(rdxPath);
  }

  /**
   * 加载工具目录
   */
  async loadCatalog(): Promise<ToolCatalog> {
    if (this.catalog) {
      return this.catalog;
    }

    const catalogPath = path.join(this.toolsPath, 'spec', 'tool_catalog.json');
    if (!fs.existsSync(catalogPath)) {
      throw new Error(`Tool catalog not found at: ${catalogPath}`);
    }

    const content = await fs.promises.readFile(catalogPath, 'utf-8');
    this.catalog = JSON.parse(content);
    return this.catalog!;
  }

  /**
   * 执行CLI命令
   */
  async executeCLI(
    command: string,
    args: string[] = [],
    options: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    } = {}
  ): Promise<CLIResult> {
    const startTime = nowMs();
    const rdxPath = this.getRdxPath();

    return new Promise((resolve, reject) => {
      const proc = spawn('cmd.exe', ['/c', rdxPath, '--non-interactive', 'cli', command, ...args], {
        cwd: options.cwd || this.toolsPath,
        env: {
          ...process.env,
          ...options.env,
          PYTHONIOENCODING: 'utf-8',
        },
        windowsHide: true,
      });

      const procId = generateEventId('proc');
      this.activeProcesses.set(procId, proc);

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | null = null;

      if (options.timeout) {
        timeoutId = setTimeout(() => {
          proc.kill();
          this.activeProcesses.delete(procId);
          reject(new Error(`Process timeout after ${options.timeout}ms`));
        }, options.timeout);
      }

      proc.stdout.on('data', (data) => {
        stdout += data.toString('utf-8');
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
      });

      proc.on('close', (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);

        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          duration_ms: nowMs() - startTime,
        });
      });

      proc.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        reject(error);
      });
    });
  }

  /**
   * 调用rd.*工具
   */
  async call(request: ToolCallRequest): Promise<ToolCallResult> {
    const startTime = nowMs();

    try {
      // 构建CLI命令
      const args = ['call', request.toolName];

      if (request.args && Object.keys(request.args).length > 0) {
        const argsJson = JSON.stringify(request.args);
        args.push('--args-json', argsJson);
      }

      const result = await this.executeCLI(args.join(' '), [], {
        timeout: 60000, // 60秒超时
      });

      // 解析结果
      if (result.exitCode === 0 && result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout);
          return {
            ok: parsed.ok ?? true,
            data: parsed.data || parsed,
            artifacts: parsed.artifacts,
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId('tool'),
          };
        } catch {
          // 如果不是JSON，返回原始输出
          return {
            ok: true,
            data: { raw: result.stdout },
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId('tool'),
          };
        }
      } else {
        return {
          ok: false,
          error: {
            code: 'CLI_ERROR',
            message: result.stderr || `Exit code: ${result.exitCode}`,
            category: 'execution',
            details: { stdout: result.stdout, stderr: result.stderr },
          },
          duration_ms: nowMs() - startTime,
          trace_id: generateEventId('tool'),
        };
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          category: 'internal',
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId('tool'),
      };
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
      toolName: 'rd.session.status',
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
    for (const [id, proc] of this.activeProcesses) {
      try {
        proc.kill();
      } catch (error) {
        console.error(`Failed to terminate process ${id}:`, error);
      }
    }
    this.activeProcesses.clear();
  }
}

// 单例导出
export const toolBridge = new ToolBridge();
