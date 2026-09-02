import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import type { HookDefinition, HookEvent, HookTrustState, ScopedResourceCandidate } from '@shared/types/rdxRuntime';
import { appPathService } from '../runtime/AppPathService';
import { scopedResourceResolver } from '../runtime/ScopedResourceResolver';
import { processSupervisor } from '../runtime/ProcessSupervisor';
import { resolveHookCwd, resolveHookSpawn } from './hookResolve';
import { canonicalRealpath, computeHookTrustFingerprint } from './hookTrustFingerprint';
import {
  hookTrustKey,
  readHookTrustStore,
  writeHookTrustStore,
  type HookTrustStoreV2,
} from './hookTrustStore';

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
  scope: 'builtin' | 'user' | 'project';
  sourcePath: string;
  sourceHash: string;
  trustFingerprint: string;
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

const untrustedReason = (scope: 'user' | 'project'): string => (
  `${scope === 'project' ? 'Project' : 'User'} hook requires explicit trust for its current trust fingerprint.`
);

export class HookEngine {
  constructor(private readonly trustStorePath = path.join(appPathService.getAppStatePaths().appStateRoot, 'hook-trust.json')) {}

  private loaded: LoadedHook[] = [];

  load(
    userHooksPath: string,
    projectRoot?: string,
    builtinHooksPath = appPathService.getBuiltinHooksPath(),
  ): LoadedHook[] {
    const candidates: Array<ScopedResourceCandidate<HookDefinition>> = [];
    const addDirectory = (root: string, scope: 'builtin' | 'user' | 'project') => {
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
    addDirectory(builtinHooksPath, 'builtin');
    addDirectory(userHooksPath, 'user');
    if (projectRoot) addDirectory(appPathService.getProjectRdxPaths(projectRoot).hooksPath, 'project');

    const trustStore = this.readTrustStore();
    this.loaded = scopedResourceResolver.resolve(candidates).resources.map((resource) => {
      const scope = resource.provenance.scope;
      const trustFingerprint = computeHookTrustFingerprint({
        definition: resource.value,
        scope,
        sourcePath: resource.provenance.sourcePath,
        projectRoot,
      });
      const ownerRoot = scope === 'project' && projectRoot
        ? canonicalRealpath(projectRoot)
        : canonicalRealpath(path.dirname(resource.provenance.sourcePath));
      const trustKey = scope === 'builtin' ? '' : hookTrustKey(scope, ownerRoot, resource.id);
      const record = trustKey ? trustStore.records[trustKey] : undefined;
      const trusted = scope === 'builtin' || record?.trustFingerprint === trustFingerprint;
      return {
        definition: resource.value,
        scope,
        sourcePath: resource.provenance.sourcePath,
        sourceHash: resource.provenance.sourceHash,
        trustFingerprint,
        trust: {
          trusted,
          needsRetrust: scope !== 'builtin' && !trusted,
          ...(scope === 'project' && projectRoot ? { projectRoot: path.resolve(projectRoot) } : {}),
          sourceHash: resource.provenance.sourceHash,
          trustFingerprint,
          ...(trusted && record?.trustedAt ? { trustedAt: record.trustedAt } : {}),
        },
      };
    });
    return this.list();
  }

  list(): LoadedHook[] {
    return this.loaded.map((hook) => ({
      ...hook,
      definition: { ...hook.definition },
      trust: { ...hook.trust },
    }));
  }

  trustProjectHook(projectRoot: string, hookId: string): HookTrustState {
    return this.trustHook(hookId, projectRoot);
  }

  trustUserHook(hookId: string): HookTrustState {
    return this.trustHook(hookId);
  }

  trustHook(hookId: string, projectRoot?: string): HookTrustState {
    const hook = this.requireMutableHook(hookId, projectRoot);
    if (hook.scope === 'builtin') {
      throw new Error('Builtin hooks are trusted by default and cannot be stored in the trust store.');
    }
    const ownerRoot = hook.scope === 'project'
      ? canonicalRealpath(projectRoot ?? hook.trust.projectRoot ?? '')
      : canonicalRealpath(path.dirname(hook.sourcePath));
    const trustedAt = new Date().toISOString();
    const store = this.readTrustStore();
    store.records[hookTrustKey(hook.scope, ownerRoot, hookId)] = {
      trustFingerprint: hook.trustFingerprint,
      trustedAt,
      scope: hook.scope,
      hookId,
      ownerRoot,
    };
    this.writeTrustStore(store);
    hook.trust = {
      trusted: true,
      needsRetrust: false,
      ...(hook.scope === 'project' ? { projectRoot: path.resolve(projectRoot ?? ownerRoot) } : {}),
      sourceHash: hook.sourceHash,
      trustFingerprint: hook.trustFingerprint,
      trustedAt,
    };
    return { ...hook.trust };
  }

  revokeProjectHook(projectRoot: string, hookId: string): void {
    this.revokeHook(hookId, projectRoot);
  }

  revokeUserHook(hookId: string): void {
    this.revokeHook(hookId);
  }

  revokeHook(hookId: string, projectRoot?: string): void {
    const store = this.readTrustStore();
    const requestedOwnerRoot = projectRoot ? canonicalRealpath(projectRoot) : undefined;
    if (requestedOwnerRoot) {
      delete store.records[hookTrustKey('project', requestedOwnerRoot, hookId)];
    } else {
      for (const [key, record] of Object.entries(store.records)) {
        if (record.hookId === hookId && record.scope === 'user') delete store.records[key];
      }
    }
    this.writeTrustStore(store);
    const hook = this.loaded.find((entry) => (
      entry.definition.id === hookId
      && (requestedOwnerRoot
        ? entry.scope === 'project'
          && hookTrustKey('project', canonicalRealpath(entry.trust.projectRoot ?? ''), hookId)
            === hookTrustKey('project', requestedOwnerRoot, hookId)
        : entry.scope === 'user')
    ));
    if (hook && hook.scope !== 'builtin') {
      hook.trust = {
        trusted: false,
        needsRetrust: true,
        ...(hook.scope === 'project' ? { projectRoot: path.resolve(projectRoot ?? hook.trust.projectRoot ?? '') } : {}),
        sourceHash: hook.sourceHash,
        trustFingerprint: hook.trustFingerprint,
      };
    }
  }

  async trigger(event: HookEvent, context: HookContext): Promise<HookExecutionResult[]> {
    const results: HookExecutionResult[] = [];
    for (const hook of this.loaded.filter((entry) => entry.definition.enabled && entry.definition.event === event && this.matches(entry.definition, context))) {
      if (hook.scope !== 'builtin' && !hook.trust.trusted) {
        results.push({
          hookId: hook.definition.id,
          allowed: false,
          status: 'untrusted',
          stdout: '',
          stderr: '',
          reason: untrustedReason(hook.scope),
        });
        if (hook.definition.failurePolicy === 'block') break;
        continue;
      }
      let result: HookExecutionResult;
      try {
        result = await this.run(hook, context);
      } catch (error) {
        result = {
          hookId: hook.definition.id,
          allowed: hook.definition.failurePolicy === 'warn',
          status: 'failed',
          stdout: '',
          stderr: '',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      results.push(result);
      if (!result.allowed) break;
    }
    return results;
  }

  async test(hookId: string, context: HookContext): Promise<HookExecutionResult> {
    const hook = this.loaded.find((entry) => entry.definition.id === hookId);
    if (!hook) throw new Error(`Hook not loaded: ${hookId}`);
    if (hook.scope !== 'builtin' && !hook.trust.trusted) {
      return {
        hookId,
        allowed: false,
        status: 'untrusted',
        stdout: '',
        stderr: '',
        reason: untrustedReason(hook.scope),
      };
    }
    try {
      return await this.run(hook, { ...context, event: hook.definition.event });
    } catch (error) {
      return {
        hookId,
        allowed: hook.definition.failurePolicy === 'warn',
        status: 'failed',
        stdout: '',
        stderr: '',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private requireMutableHook(hookId: string, projectRoot?: string): LoadedHook {
    const hook = this.loaded.find((entry) => entry.definition.id === hookId);
    if (!hook) throw new Error(`Hook not loaded: ${hookId}`);
    if (hook.scope === 'project') {
      if (!projectRoot) throw new Error(`Project hook requires a project root: ${hookId}`);
      if (path.resolve(hook.trust.projectRoot ?? '') !== path.resolve(projectRoot)) {
        throw new Error(`Project hook not loaded: ${hookId}`);
      }
    }
    return hook;
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
    const cwd = resolveHookCwd(definition, context.projectRoot);
    const spawnSpec = resolveHookSpawn(definition, hook.scope, hook.sourcePath, cwd);
    if ('unresolvedArg' in spawnSpec) {
      return {
        hookId: definition.id,
        allowed: false,
        status: 'failed',
        stdout: '',
        stderr: '',
        reason: `Builtin hook script was not found in the official hook directory: ${spawnSpec.unresolvedArg}`,
      };
    }
    if (spawnSpec.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    const supervised = processSupervisor.spawn('hook', spawnSpec.command, spawnSpec.args, {
      shell: false,
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeoutMs: definition.timeoutMs,
      ringBufferBytes: MAX_OUTPUT_BYTES,
    });
    const child = supervised.child;
    try {
      child.stdin?.end(JSON.stringify(context));
    } catch {
      // ignore broken stdin
    }
    const info = await supervised.join(definition.timeoutMs ?? 120_000);
    const stdout = supervised.stdout.toString().slice(0, MAX_OUTPUT_BYTES);
    const stderr = supervised.stderr.toString().slice(0, MAX_OUTPUT_BYTES);
    if (info.reason === 'unconfirmed_orphan') {
      return {
        hookId: definition.id,
        allowed: false,
        status: 'failed',
        stdout,
        stderr,
        reason: 'Hook process termination was not confirmed; execution was denied.',
      };
    }
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

  private readTrustStore(): HookTrustStoreV2 {
    return readHookTrustStore(this.trustStorePath);
  }

  private writeTrustStore(store: HookTrustStoreV2): void {
    writeHookTrustStore(this.trustStorePath, store);
  }
}

export const hookEngine = new HookEngine();
