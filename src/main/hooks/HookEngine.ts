/**
 * HookEngine — 生命周期 Hook 系统。
 *
 * 支持的事件:
 *  - PreToolUse / PostToolUse / PostToolUseFailure
 *  - SessionStart / SessionEnd
 *  - PreCompact / PostCompact
 *  - Stop / Setup
 *
 * Hook 类型:
 *  - ShellHook: 执行 shell 命令，stdin 接收 JSON 事件，stdout 返回决策
 *  - PromptHook: 注入额外上下文到 LLM 提示
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';

// =====================================================================
// 类型
// =====================================================================

export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'SessionStart'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact'
  | 'Stop'
  | 'Setup'
  | 'PermissionDenied'
  | 'SubagentStart'
  | 'SubagentStop';

export interface HookDefinition {
  name: string;
  event: HookEvent;
  type: 'shell' | 'prompt';
  command?: string;
  promptTemplate?: string;
  timeoutMs?: number;
  matcher?: string; // glob/regex match (e.g. tool name)
}

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  sessionId?: string;
  workspaceRoot?: string;
  [key: string]: unknown;
}

export interface HookResult {
  allowed: boolean;
  reason?: string;
  modifiedArgs?: Record<string, unknown>;
  injectedContext?: string;
}

// =====================================================================
// HookEngine
// =====================================================================

const DEFAULT_HOOK_TIMEOUT = 30_000;

export class HookEngine {
  private hooks: HookDefinition[] = [];

  /** 从目录加载 YAML hook 文件。 */
  async loadFromDir(dir: string): Promise<void> {
    let entries: string[];
    try { entries = await fs.readdir(dir); } catch { return; }
    for (const entry of entries) {
      if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf8');
        const parsed = yaml.parse(raw) as HookDefinition | HookDefinition[];
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const hook of items) {
          if (hook.name && hook.event && hook.type) {
            this.register(hook);
          }
        }
      } catch { /* skip bad files */ }
    }
  }

  /** 注册单个 hook。 */
  register(hook: HookDefinition): void {
    this.hooks.push(hook);
  }

  /** 触发指定事件的所有匹配 hook。 */
  async trigger(event: HookEvent, context: HookContext): Promise<HookResult> {
    const matching = this.hooks.filter((h) => h.event === event && this.matches(h, context));
    let result: HookResult = { allowed: true };

    for (const hook of matching) {
      if (hook.type === 'shell' && hook.command) {
        const shellResult = await this.runShellHook(hook, context);
        if (!shellResult.allowed) return shellResult;
        result = { ...result, ...shellResult, allowed: true };
      } else if (hook.type === 'prompt' && hook.promptTemplate) {
        result.injectedContext = (result.injectedContext ?? '') + '\n' + hook.promptTemplate;
      }
    }

    return result;
  }

  /** 重新加载所有 hook。 */
  async reload(dir: string): Promise<void> {
    this.hooks = [];
    await this.loadFromDir(dir);
  }

  /** 列出已注册的 hook。 */
  listHooks(): HookDefinition[] {
    return [...this.hooks];
  }

  // ── 内部 ──

  private matches(hook: HookDefinition, ctx: HookContext): boolean {
    if (!hook.matcher) return true;
    const target = ctx.toolName ?? '';
    return target.includes(hook.matcher) || new RegExp(hook.matcher.replace(/\*/g, '.*')).test(target);
  }

  private async runShellHook(hook: HookDefinition, ctx: HookContext): Promise<HookResult> {
    const timeout = hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT;
    const input = JSON.stringify(ctx);

    return new Promise<HookResult>((resolve) => {
      const proc = spawn(hook.command!, [], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, RDC_HOOK_EVENT: hook.event },
      });

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ allowed: true, reason: `hook "${hook.name}" timed out` });
      }, timeout);

      let stdout = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', () => { /* ignore stderr */ });

      proc.on('close', (code) => {
        clearTimeout(timer);
        try {
          const output = stdout.trim();
          if (!output) {
            resolve({ allowed: code === 0 });
            return;
          }
          const parsed = JSON.parse(output) as HookResult;
          resolve(parsed);
        } catch {
          resolve({ allowed: code === 0 });
        }
      });

      proc.stdin?.write(input);
      proc.stdin?.end();
    });
  }
}
