import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { HookDefinition, HookEvent, HookTrustState, ScopedResourceCandidate } from '@shared/types/rdxRuntime';
import { appPathService } from '../runtime/AppPathService';
import { scopedResourceResolver } from '../runtime/ScopedResourceResolver';
import { processSupervisor } from '../runtime/ProcessSupervisor';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface HookContext {
  event: HookEvent;
  agentId?: string;
  toolName?: string;
  sessionId?: string;
  projectRoot?: string;
  payload?: Record<string, unknown>;
}

export interface LoadedHook {
  definition: HookDefinition;
  scope: 'user' | 'project';
  sourcePath: string;
  sourceHash: string;
  trust: HookTrustState;
}

export interface HookExecutionResult {
  hookId: string;
  allowed: boolean;
  status: 'completed' | 'failed' | 'timed-out' | 'untrusted' | 'skipped';
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  reason?: string;
}

const parseHookFile = (sourcePath: string): HookDefinition => {
  const value = YAML.parse(fs.readFileSync(sourcePath, 'utf8')) as Partial<HookDefinition>;
  if (!value || typeof value !== 'object') throw new Error(`Invalid hook file: ${sourcePath}`);
  if (!value.id?.trim() || !value.event || !value.command?.trim()) throw new Error(`Hook requires id, event, and command: ${sourcePath}`);
  if (!['block', 'warn'].includes(value.failurePolicy ?? '')) throw new Error(`Hook failurePolicy must be block or warn: ${sourcePath}`);
  return {
    id: value.id.trim(),
    enabled: value.enabled !== false,
    event: value.event,
    command: value.command.trim(),
    args: Array.isArray(value.args) ? value.args.map(String) : [],
    ...(value.cwd?.trim() ? { cwd: value.cwd.trim() } : {}),
    ...(value.env && typeof value.env === 'object' ? { env: value.env } : {}),
    timeoutMs: Number.isFinite(value.timeoutMs) && Number(value.timeoutMs) > 0 ? Number(value.timeoutMs) : DEFAULT_TIMEOUT_MS,
    failurePolicy: value.failurePolicy as 'block' | 'warn',
    ...(value.matcher ? { matcher: value.matcher } : {}),
  };
};

export class HookEngine {
  private loaded: LoadedHook[] = [];

  constructor(private readonly trustStorePath = path.join(appPathService.getAppStatePaths().appStateRoot, 'hook-trust.json')) {}

  load(userHooksPath: string, projectRoot?: string): LoadedHook[] {
    const candidates: Array<ScopedResourceCandidate<HookDefinition>> = [];
    const addDirectory = (root: string, scope: 'user' | 'project') => {
      if (!fs.existsSync(root)) return;
      fs.readdirSync(root)
        .filter((entry) => entry.endsWith('.hook.yml'))
        .sort()
        .forEach((entry) => {
          const sourcePath = path.join(root, entry);
          const value = parseHookFile(sourcePath);
          candidates.push({ id: value.id, kind: 'hook', scope, sourcePath, value, enabled: value.enabled });
        });
    };
    addDirectory(userHooksPath, 'user');
    if (projectRoot) addDirectory(appPathService.getProjectRdxPaths(projectRoot).hooksPath, 'project');

    const trustStore = this.readTrustStore();
    this.loaded = scopedResourceResolver.resolve(candidates).resources.map((resource) => {
      const scope = resource.provenance.scope === 'project' ? 'project' : 'user';
      const trustKey = scope === 'project' && projectRoot ? this.trustKey(projectRoot, resource.id) : '';
      const trusted = scope === 'user' || trustStore[trustKey]?.sourceHash === resource.provenance.sourceHash;
      return {
        definition: resource.value,
        scope,
        sourcePath: resource.provenance.sourcePath,
        sourceHash: resource.provenance.sourceHash,
        trust: {
          trusted,
          ...(scope === 'project' && projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}),
          sourceHash: resource.provenance.sourceHash,
          ...(trusted && trustStore[trustKey]?.trustedAt ? { trustedAt: trustStore[trustKey].trustedAt } : {}),
        },
      };
    });
    return this.list();
  }

  list(): LoadedHook[] {
    return this.loaded.map((hook) => ({ ...hook, definition: { ...hook.definition } }));
  }

  trustProjectHook(projectRoot: string, hookId: string): HookTrustState {
    const hook = this.loaded.find((entry) => entry.scope === 'project' && entry.definition.id === hookId && path.resolve(entry.trust.projectRoot ?? '') === path.resolve(projectRoot));
    if (!hook) throw new Error(`Project hook not loaded: ${hookId}`);
    const store = this.readTrustStore();
    const trustedAt = new Date().toISOString();
    store[this.trustKey(projectRoot, hookId)] = { sourceHash: hook.sourceHash, trustedAt };
    this.writeTrustStore(store);
    hook.trust = { trusted: true, projectRoot: path.resolve(projectRoot), sourceHash: hook.sourceHash, trustedAt };
    return hook.trust;
  }

  revokeProjectHook(projectRoot: string, hookId: string): void {
    const store = this.readTrustStore();
    delete store[this.trustKey(projectRoot, hookId)];
    this.writeTrustStore(store);
    const hook = this.loaded.find((entry) => entry.scope === 'project' && entry.definition.id === hookId);
    if (hook) hook.trust = { trusted: false, projectRoot: path.resolve(projectRoot), sourceHash: hook.sourceHash };
  }

  async trigger(event: HookEvent, context: HookContext): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];
    for (const hook of this.loaded.filter((entry) => entry.definition.enabled && entry.definition.event === event && this.matches(entry.definition, context))) {
      if (hook.scope === 'project' && !hook.trust.trusted) {
        results.push({ hookId: hook.definition.id, allowed: false, status: 'untrusted', stdout: '', stderr: '', reason: 'Project hook requires trust for its current content hash.' });
        if (hook.definition.failurePolicy === 'block') break;
        continue;
      }
      const result = await this.run(hook, context);
      results.push(result);
      if (!result.allowed) break;
    }
    return results;
  }

  async test(hookId: string, context: HookContext): Promise<HookExecutionResult> {
    const hook = this.loaded.find((entry) => entry.definition.id === hookId);
    if (!hook) throw new Error(`Hook not loaded: ${hookId}`);
    if (hook.scope === 'project' && !hook.trust.trusted) {
      return { hookId, allowed: false, status: 'untrusted', stdout: '', stderr: '', reason: 'Project hook requires trust for its current content hash.' };
    }
    return this.run(hook, { ...context, event: hook.definition.event });
  }

  private matches(hook: HookDefinition, context: HookContext): boolean {
    const agentMatch = !hook.matcher?.agents?.length || (context.agentId ? hook.matcher.agents.includes(context.agentId) : false);
    const toolMatch = !hook.matcher?.tools?.length || (context.toolName ? hook.matcher.tools.includes(context.toolName) : false);
    return agentMatch && toolMatch;
  }

  private async run(hook: LoadedHook, context: HookContext): Promise<HookExecutionResult> {
    const definition = hook.definition;
    const env = { ...process.env } as Record<string, string | undefined>;
    for (const [targetName, sourceName] of Object.entries(definition.env ?? {})) env[targetName] = process.env[sourceName];
    const supervised = processSupervisor.spawn('hook', definition.command, definition.args, {
      shell: false,
      cwd: definition.cwd ? path.resolve(context.projectRoot ?? process.cwd(), definition.cwd) : context.projectRoot ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      isolateProcessGroup: false,
      timeoutMs: definition.timeoutMs,
      ringBufferBytes: MAX_OUTPUT_BYTES,
    });
    const child = supervised.child;
    try {
      child.stdin?.end(JSON.stringify(context));
    } catch {
      // ignore broken stdin
    }
    const info = await supervised.exit;
    const stdout = supervised.stdout.toString().slice(0, MAX_OUTPUT_BYTES);
    const stderr = supervised.stderr.toString().slice(0, MAX_OUTPUT_BYTES);
    if (info.reason === 'timeout') {
      return {
        hookId: definition.id,
        allowed: definition.failurePolicy === 'warn',
        status: 'timed-out',
        stdout,
        stderr,
        reason: `Hook timed out after ${definition.timeoutMs}ms.`,
      };
    }
    if (info.reason === 'spawn_failed') {
      return {
        hookId: definition.id,
        allowed: definition.failurePolicy === 'warn',
        status: 'failed',
        stdout,
        stderr,
        reason: info.error?.message ?? 'Hook spawn failed.',
      };
    }
    const code = info.code;
    const succeeded = code === 0;
    return {
      hookId: definition.id,
      allowed: succeeded || definition.failurePolicy === 'warn',
      status: succeeded ? 'completed' : 'failed',
      exitCode: code,
      stdout,
      stderr,
      ...(!succeeded ? { reason: `Hook exited with code ${code}.` } : {}),
    };
  }

  private trustKey(projectRoot: string, hookId: string): string {
    return `${path.resolve(projectRoot).toLowerCase()}::${hookId}`;
  }

  private readTrustStore(): Record<string, { sourceHash: string; trustedAt: string }> {
    try {
      return fs.existsSync(this.trustStorePath) ? JSON.parse(fs.readFileSync(this.trustStorePath, 'utf8')) as Record<string, { sourceHash: string; trustedAt: string }> : {};
    } catch {
      return {};
    }
  }

  private writeTrustStore(store: Record<string, { sourceHash: string; trustedAt: string }>): void {
    fs.mkdirSync(path.dirname(this.trustStorePath), { recursive: true });
    fs.writeFileSync(this.trustStorePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }
}

export const hookEngine = new HookEngine();
