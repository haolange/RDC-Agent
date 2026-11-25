import * as path from 'path';
import { isToolWithinCeiling, toolAccessOf } from '@shared/constants/toolAccess';
import { agentAccessCeiling, type AgentAccessCeiling } from '@shared/types/agentManifest';
import { expandHomePath } from '../../platform/paths';
import { defaultShellKind } from '../../platform/shell';
import { matchShellHardDeny } from '../tools/primitives/shellHardDeny';
import { resolveConfiguredShell } from '../../tools/resolveConfiguredShell';
import { isWithinRootAllowingAliases } from '../../runtime/toolFiles';
import { safeResolvePath } from '../../runtime/toolFiles';
import { fileOperationBoundary } from '../../runtime/FileOperationBoundary';
import { matchShellFileToolBypass } from './shellFileToolBypass';
import {
  matchesDeniedCommandPrefix,
  shellCommandRiskAnalyzer,
} from './ShellCommandRiskAnalyzer';
import {
  isToolDeniedByPolicy,
  resolvePolicyApprovalFloor,
} from './PolicyCompiler';
import type { AgentPermissionMode, AgentPermissionSettings } from '@shared/types/settings';
import type { CompiledPolicy } from '@shared/types/rdcRuntime';
import type { AgentTool, ReplayLifecycleStep, ToolExecutionContext } from '../agent/AgentTool';
import type { ToolCall } from '@shared/types/tool';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { ShellKind } from '../../runtime/ShellResolver';

/**
 * Agent permission risk classifier for tool / shell calls.
 *
 * This is NOT a security boundary. Hard deny lists, OS permissions, Electron
 * sandbox, and IPC schema validation provide enforcement; this service only
 * classifies risk and routes allow / ask_user / auto_review / deny decisions.
 */
export type AgentPermissionDecisionAction = 'allow' | 'ask_user' | 'auto_review' | 'deny';

/** The operation contract the reviewer receives for each replay lifecycle step a tool declares (`spec.capture`). */
const REPLAY_LIFECYCLE_CONTRACT: Record<ReplayLifecycleStep, string> = {
  capture_select: 'Select the registered input named by inputId on the device frozen in the approved plan.',
  capture_restore: 'Verify the signed entry position and, if needed, restore only its owning replay, event and output target. Reopening can use only the recorded entry input and device. An empty entry position means closing the owning replay.',
  capture_recover: 'Release the faulted lease only after checking its owner and process identity, then reopen the same approved capture and device under a new replay context. The call supplies no replacement target.',
};

export interface AgentPermissionDecision {
  action: AgentPermissionDecisionAction;
  reason?: string;
  risk: 'low' | 'medium' | 'high';
  temporaryPathRoots: string[];
  /** Main-owned operation facts; no executable, environment or credential material. */
  operationFacts?: Record<string, unknown>;
}

export type RdcShellBaseline = (
  input: AgentPermissionDecisionInput,
  mode: AgentPermissionMode,
  ceiling: AgentAccessCeiling,
) => AgentPermissionDecision;

let rdcShellBaseline: RdcShellBaseline | null = null;

/** RDC module registers the shell.rdc decision. The permission lattice stays here. */
export function registerRdcShellBaseline(baseline: RdcShellBaseline): void {
  rdcShellBaseline = baseline;
}

export interface AgentPermissionDecisionInput {
  executionContext?: ToolExecutionContext;
  /** Actual tools available to this executor after frozen skill intersection. */
  effectiveToolNames?: readonly string[];
  tool: AgentTool;
  toolCall: ToolCall;
  /** Profile id, used only to resolve a declared access ceiling when one is not passed. */
  agentId?: string | null;
  /** Frozen profile ceiling. Full access mode cannot exceed it. */
  accessCeiling?: AgentAccessCeiling;
  /** 当前激活项目根目录；权限边界以它为准，回退固定 User Scope。 */
  projectRootPath?: string | null;
  /** Frozen constraints, explicitly supplied by the prepared plan. */
  permissionConstraints: Omit<AgentPermissionSettings, 'mode'>;
  permissionState: RuntimePermissionState;
  /** Turn 冻结的 CompiledPolicy；缺省视为空策略。 */
  compiledPolicy?: CompiledPolicy;
  /** Current session attachments directory; readable by read-only file tools only. */
  sessionAttachmentsRoot?: string | null;
  /**
   * Frozen plan knowledge read roots. Merged only into tools that declare read effects.
   * Never written into persisted permissionConstraints.readableRoots.
   */
  knowledgeReadRoots?: readonly string[];
}

const WINDOWS_ROUTINE_COMMAND_PREFIXES = [
  'dir',
  'ls',
  'get-childitem',
  'get-location',
  'pwd',
  'echo',
  'write-output',
];

const POSIX_ROUTINE_COMMAND_PREFIXES = [
  'ls',
  'pwd',
  'echo',
  'which',
  'where',
];
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\bmove\b/i,
  /\bcopy\b/i,
  /\bren\b/i,
  /\brename\b/i,
  /\bset-content\b/i,
  /\badd-content\b/i,
  /\bremove-item\b/i,
  /\binvoke-webrequest\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\breg\b/i,
  />\s*[^&|]/,
  />>/,
];

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[.-]/g, '_');
}

function resolveConfiguredRoot(value: string): string {
  return path.resolve(expandHomePath(value));
}

/** Without an open project there is no workspace: relative paths resolve where the tool would, and count as external. */
function resolveToolTarget(value: string, workspaceRoot: string | null): string {
  const expanded = expandHomePath(value);
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspaceRoot ?? process.cwd(), expanded);
}

function isWithinRoot(target: string, root: string): boolean {
  if (root === '*') return true;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isInsideWorkspace(target: string, workspaceRoot: string | null): boolean {
  return workspaceRoot !== null && isWithinRoot(target, workspaceRoot);
}

function extractStringArg(toolCall: ToolCall, key: string): string {
  const value = toolCall.arguments[key];
  return typeof value === 'string' ? value.trim() : '';
}

function inferPathTargetFromGlobPattern(pattern: string): string {
  const expanded = expandHomePath(pattern);
  if (!path.isAbsolute(expanded)) return '';
  const wildcardIndex = expanded.search(/[*?{[]/);
  if (wildcardIndex < 0) return expanded;
  const sepIndex = Math.max(expanded.lastIndexOf('/', wildcardIndex), expanded.lastIndexOf('\\', wildcardIndex));
  return sepIndex > 0 ? expanded.slice(0, sepIndex) : path.parse(expanded).root;
}

function argumentAt(toolCall: ToolCall, key: string): string {
  let value: unknown = toolCall.arguments;
  for (const segment of key.split('.')) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[segment] : undefined;
  }
  return typeof value === 'string' ? value.trim() : '';
}

/** Filesystem targets named by the tool's declared effects; a glob prefix counts only when no location is given. */
function effectTargets(tool: AgentTool, toolCall: ToolCall): { reads: string[]; writes: string[] } {
  const effects = tool.effects;
  const reads = (effects?.reads ?? []).map((key) => argumentAt(toolCall, key)).filter(Boolean);
  const writes = (effects?.writes ?? []).map((key) => argumentAt(toolCall, key)).filter(Boolean);
  if (reads.length === 0 && effects?.readPattern) {
    const patternTarget = inferPathTargetFromGlobPattern(argumentAt(toolCall, effects.readPattern));
    if (patternTarget) reads.push(patternTarget);
  }
  return { reads, writes };
}

function declaresReads(tool: AgentTool): boolean {
  return Boolean(tool.effects?.reads?.length || tool.effects?.readPattern);
}

/**
 * Capture inputs, Git metadata and canonical knowledge are never generic write targets in any
 * mode; protected configuration and credential paths need specific approval even under full access.
 */
function classifyWriteTargets(
  writes: readonly string[],
  workspaceRoot: string | null,
  context?: ToolExecutionContext,
): { denied: string } | { protectedTarget: boolean } {
  let protectedTarget = false;
  for (const target of writes) {
    let resolved = resolveToolTarget(target, workspaceRoot);
    if (workspaceRoot && isInsideWorkspace(resolved, workspaceRoot)) {
      try {
        resolved = safeResolvePath(target, workspaceRoot, context);
      } catch (error) {
        return { denied: error instanceof Error ? error.message : String(error) };
      }
    }
    const boundary = fileOperationBoundary(resolved);
    if (boundary.readOnly) return { denied: `FILE_WRITE_PROTECTED: ${boundary.reason}` };
    protectedTarget ||= boundary.protected;
  }
  return { protectedTarget };
}

const POWERSHELL_PROVIDER_DRIVE = /^(?:alias|cert|env|function|hkcu|hklm|variable|wsman):/iu;
const DRIVE_PATH = /^[a-z]:/iu;

/**
 * A routine command may name only workspace paths. Each token (and each `name=value` part) is classified on its own:
 * home references, `..`, PowerShell provider drives (`Env:`, `HKLM:`), and absolute, drive-root, drive-relative or UNC
 * paths outside the workspace make the command external. Mentioning the workspace elsewhere in the command does not
 * excuse another token.
 */
function commandUsesExternalPath(command: string, workspaceRoot: string): boolean {
  const workspace = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
  return command.split(/[\s;|&]+/u).flatMap((token) => token.split('=')).some((raw) => {
    const token = raw.replace(/\\/g, '/');
    if (!token) return false;
    if (token.startsWith('~') || token.split('/').includes('..') || POWERSHELL_PROVIDER_DRIVE.test(token)) return true;
    if (!token.startsWith('/') && !DRIVE_PATH.test(token)) return false;
    const target = token.replace(/\/+$/u, '').toLowerCase();
    return target !== workspace && !target.startsWith(`${workspace}/`);
  });
}

function isCommandDeniedByRule(command: string, permissions: AgentPermissionSettings): boolean {
  if (!command.trim()) return false;
  return permissions.deniedCommandPrefixes.some((prefix) => matchesDeniedCommandPrefix(command, prefix));
}

function isCommandAllowedByRule(command: string, permissions: AgentPermissionSettings): boolean {
  return simpleCommandSegments(command)?.every(segment => permissions.allowedCommandPrefixes.some(prefix => matchesDeniedCommandPrefix(segment, prefix))) ?? false;
}

function routineCommandPrefixes(): string[] {
  const kind = resolveShellKind();
  return kind === 'pwsh' || kind === 'windows-powershell'
    ? WINDOWS_ROUTINE_COMMAND_PREFIXES
    : POSIX_ROUTINE_COMMAND_PREFIXES;
}

function isRoutineCommand(command: string, permissions: AgentPermissionSettings): boolean {
  if (isCommandAllowedByRule(command, permissions)) return true;
  return simpleCommandSegments(command)?.every(segment => routineCommandPrefixes().some(prefix => matchesDeniedCommandPrefix(segment, prefix))) ?? false;
}

/** Only statically simple chains qualify for rule-based allow. Opaque syntax is reviewed. */
function simpleCommandSegments(command: string): string[] | null {
  if (/["'`$(){}<>\\]/.test(command) || /\r|\|&|(^|[^&])&([^&]|$)|--(?:output|ext-diff|textconv|exec-path)/i.test(command)) return null;
  const segments = command.split(/&&|\|\||[;|\n]/).map(segment => segment.trim());
  return segments.length && segments.every(Boolean) ? segments : null;
}

function resolveShellKind(): ShellKind {
  try {
    return resolveConfiguredShell().kind;
  } catch {
    return defaultShellKind();
  }
}

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function denied(reason: string, risk: AgentPermissionDecision['risk'] = 'high'): AgentPermissionDecision {
  return { action: 'deny', reason, risk, temporaryPathRoots: [] };
}

/** Decision strength lattice: allow < auto_review < ask_user < deny. */
const DECISION_STRENGTH: Record<AgentPermissionDecisionAction, number> = {
  allow: 0,
  auto_review: 1,
  ask_user: 2,
  deny: 3,
};

function floorAction(
  floor: 'none' | 'auto_review' | 'user',
  toolName: string,
): AgentPermissionDecision | null {
  if (floor === 'none') return null;
  if (floor === 'auto_review') {
    return {
      action: 'auto_review',
      reason: `Compiled policy requires auto-review for tool "${toolName}".`,
      risk: 'medium',
      temporaryPathRoots: [],
    };
  }
  return {
    action: 'ask_user',
    reason: `Compiled policy requires approval for tool "${toolName}".`,
    risk: 'high',
    temporaryPathRoots: [],
  };
}

function maxDecision(
  baseline: AgentPermissionDecision,
  floor: AgentPermissionDecision | null,
): AgentPermissionDecision {
  if (!floor) return baseline;
  return DECISION_STRENGTH[floor.action] > DECISION_STRENGTH[baseline.action]
    ? {
        ...floor,
        operationFacts: baseline.operationFacts,
        temporaryPathRoots: floor.temporaryPathRoots.length > 0
          ? floor.temporaryPathRoots
          : baseline.temporaryPathRoots,
      }
    : baseline;
}

function request(
  mode: AgentPermissionMode,
  reason: string,
  risk: AgentPermissionDecision['risk'],
  temporaryPathRoots: string[] = [],
): AgentPermissionDecision {
  if (mode === 'auto-review') {
    return { action: 'auto_review', reason, risk, temporaryPathRoots };
  }
  return { action: 'ask_user', reason, risk, temporaryPathRoots };
}

export class AgentPermissionPolicyService {
  /**
   * Classify tool-call risk and return an allow / ask / review / deny decision.
   * Risk classifier only — callers must not treat this as a sandbox.
   * Final action = max(baseline, policy approval floor) on allow<auto_review<ask_user<deny.
   */
  evaluate(input: AgentPermissionDecisionInput): AgentPermissionDecision {
    const permissions = { ...input.permissionConstraints, mode: input.permissionState.mode };
    const mode = permissions.mode;
    const toolName = normalizeToolName(input.toolCall.name);
    const workspaceRoot = input.projectRootPath ? path.resolve(input.projectRootPath) : null;

    const ceiling = agentAccessCeiling({ accessCeiling: input.accessCeiling });
    if (!toolName.endsWith('*') && !isToolWithinCeiling(toolName, ceiling)) {
      return denied(
        `ACCESS_CEILING_DENIED: tool "${input.toolCall.name}" exceeds the ${ceiling} ceiling. Full access cannot bypass.`,
        'high',
      );
    }

    if (input.compiledPolicy && isToolDeniedByPolicy(input.compiledPolicy, toolName)) {
      return denied(`Policy deniedTools blocked tool "${input.toolCall.name}".`, 'high');
    }

    // Tool behaviour comes from the tool's declared spec, never from its name.
    const { spec } = input.tool;
    const replayAction = spec.capture?.replayLifecycle?.(input.toolCall.arguments) ?? null;
    if (replayAction) {
      if (ceiling !== 'full') return denied('RDC_EXECUTION_DENIED: replay lifecycle requires a full access ceiling.');
      const baseline = mode === 'full-access'
        ? { action: 'allow' as const, risk: 'low' as const, temporaryPathRoots: [] }
        : request(mode, 'Changing the owning replay requires authorization under the current permission mode.', 'medium');
      const floor = input.compiledPolicy ? resolvePolicyApprovalFloor(input.compiledPolicy, toolName, 'mutation') : 'none';
      return maxDecision({ ...baseline, operationFacts: {
        operation: replayAction,
        scope: 'owning approved replay',
        operationContract: { description: REPLAY_LIFECYCLE_CONTRACT[replayAction] },
      } }, floorAction(floor, input.toolCall.name));
    }

    if (spec.capture?.nativeOperation?.(input.toolCall.arguments)) {
      if (!rdcShellBaseline) return denied('RDC_PERMISSION_UNREGISTERED: shell.rdc has no registered operation policy.', 'high');
      const rdcBaseline = rdcShellBaseline(input, mode, ceiling);
      if (!input.compiledPolicy) return rdcBaseline;
      const floor = resolvePolicyApprovalFloor(input.compiledPolicy, toolName, input.tool.permissionHint);
      return maxDecision(rdcBaseline, floorAction(floor, input.toolCall.name));
    }

    // Catastrophic shell patterns are hard-denied in every mode, including full-access.
    if (spec.shellCommand) {
      const command = extractStringArg(input.toolCall, spec.shellCommand);
      const hardDeny = matchShellHardDeny(command, resolveShellKind());
      if (hardDeny) {
        return denied(`Shell command hard-denied (matched "${hardDeny}").`, 'high');
      }
      const bypass = matchShellFileToolBypass(command, resolveShellKind(), input.effectiveToolNames ?? []);
      if (bypass) return denied(bypass);
    }

    const baseline = this.evaluateBaseline(input, permissions, mode, toolName, workspaceRoot);
    if (!input.compiledPolicy) return baseline;
    const floor = resolvePolicyApprovalFloor(
      input.compiledPolicy,
      toolName,
      input.tool.permissionHint,
    );
    return maxDecision(baseline, floorAction(floor, input.toolCall.name));
  }

  private evaluateBaseline(
    input: AgentPermissionDecisionInput,
    permissions: AgentPermissionSettings,
    mode: AgentPermissionMode,
    toolName: string,
    workspaceRoot: string | null,
  ): AgentPermissionDecision {
    const { reads, writes } = effectTargets(input.tool, input.toolCall);
    const writeClass = classifyWriteTargets(writes, workspaceRoot, input.executionContext);
    if ('denied' in writeClass) return denied(writeClass.denied);
    if (mode === 'full-access') {
      return writeClass.protectedTarget
        ? { action: 'ask_user', reason: 'Protected configuration or credential-related write requires specific authorization, including under full access.', risk: 'high', temporaryPathRoots: ['*'] }
        : { action: 'allow', risk: 'low', temporaryPathRoots: ['*'] };
    }

    const customRules = mode === 'custom' ? permissions : {
      ...permissions,
      readableRoots: [],
      writableRoots: [],
      allowedCommandPrefixes: [],
      deniedCommandPrefixes: [],
    };
    const commandArgument = input.tool.spec.shellCommand;
    if (commandArgument && isCommandDeniedByRule(extractStringArg(input.toolCall, commandArgument), customRules)) {
      return denied('Custom policy denied this command prefix (word-boundary match).');
    }

    const configuredReadableRoots = customRules.readableRoots.map(resolveConfiguredRoot);
    const configuredWritableRoots = customRules.writableRoots.map(resolveConfiguredRoot);
    const sessionAttachmentsRoot = input.sessionAttachmentsRoot
      ? path.resolve(input.sessionAttachmentsRoot)
      : null;
    const knowledgeReadRoots = input.tool.spec.knowledgeRoots === 'read-access'
      ? (input.knowledgeReadRoots ?? []).map((root) => path.resolve(root))
      : [];
    const readRoots = [
      ...configuredReadableRoots,
      ...(sessionAttachmentsRoot ? [sessionAttachmentsRoot] : []),
    ];

    if (declaresReads(input.tool) && writes.length === 0 && !input.tool.effects?.writes?.length) {
      if (!workspaceRoot && reads.length === 0) {
        return request(mode, `No project is open, so "${input.toolCall.name}" has no workspace to read within.`, 'medium');
      }
      const targets = reads.map((target) => resolveToolTarget(target, workspaceRoot));
      const externalTargets = targets.filter((target) => !isInsideWorkspace(target, workspaceRoot));
      if (externalTargets.length === 0) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      const allowedTargets = externalTargets.filter((target) => (
        readRoots.some((root) => isWithinRoot(target, root))
        || knowledgeReadRoots.some((root) => isWithinRootAllowingAliases(target, root))
      ));
      if (allowedTargets.length === externalTargets.length) {
        const matchingKnowledgeRoots = knowledgeReadRoots.filter((root) => (
          externalTargets.some((target) => isWithinRootAllowingAliases(target, root))
        ));
        return {
          action: 'allow',
          risk: 'low',
          temporaryPathRoots: [...new Set([...allowedTargets, ...matchingKnowledgeRoots])],
        };
      }
      return request(
        mode,
        workspaceRoot
          ? `Read access is outside the workspace: ${externalTargets.join(', ')}`
          : `No project is open; reading requires approval: ${externalTargets.join(', ')}`,
        'medium',
        externalTargets,
      );
    }

    if (commandArgument) {
      const command = extractStringArg(input.toolCall, commandArgument);
      if (!command) return denied('Shell command is empty.', 'medium');
      if (isCommandAllowedByRule(command, customRules)) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      const analysis = shellCommandRiskAnalyzer.analyze(command);
      if (analysis.risk === 'high' || isDangerousCommand(command)) {
        return request(mode, `Shell command requires review: ${command}`, 'high');
      }
      if (!workspaceRoot) {
        return request(mode, `No project is open, so the shell has no workspace to run within: ${command}`, 'medium');
      }
      if (commandUsesExternalPath(command, workspaceRoot)) {
        return request(mode, `Shell command references paths outside the workspace: ${command}`, 'medium');
      }
      if (isRoutineCommand(command, customRules)) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      return request(mode, `Shell command is not in the routine command set: ${command}`, 'medium');
    }

    if (input.tool.effects?.writes?.length || input.tool.permissionHint === 'mutation' || input.tool.permissionHint === 'destructive') {
      const targets = [...reads, ...writes].map((target) => resolveToolTarget(target, workspaceRoot));
      const externalTargets = targets.filter((target) => !isInsideWorkspace(target, workspaceRoot));
      if (input.tool.effects?.writes?.length && externalTargets.length === 0 && targets.length > 0) {
        return writeClass.protectedTarget
          ? request(mode, `Tool "${input.toolCall.name}" writes protected configuration or credential-related paths and requires specific authorization.`, 'high')
          : request(mode, `Tool "${input.toolCall.name}" changes workspace files; runtime read-before-edit and path checks remain enforced.`, 'low');
      }
      if (mode === 'custom' && externalTargets.length > 0) {
        const allowedTargets = externalTargets.filter((target) => configuredWritableRoots.some((root) => isWithinRoot(target, root)));
        if (allowedTargets.length === externalTargets.length && !writeClass.protectedTarget) {
          return { action: 'allow', risk: 'medium', temporaryPathRoots: allowedTargets };
        }
      }
      return request(
        mode,
        externalTargets.length > 0
          ? `Write access is outside the workspace: ${externalTargets.join(', ')}`
          : `Tool "${input.toolCall.name}" can modify workspace files.`,
        'high',
        externalTargets,
      );
    }

    if (input.tool.effects?.network) {
      return request(mode, `Network tool "${input.toolCall.name}" requires approval: fetched content and requested URLs leave this machine.`, 'medium');
    }

    const access = toolAccessOf(toolName);
    if (access === 'mutate' || access === 'execute') {
      return request(mode, `Tool "${input.toolCall.name}" ${access === 'execute' ? 'runs a process or external integration' : 'changes workspace or user resources'}.`, 'medium');
    }

    return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
  }
}

export const agentPermissionPolicyService = new AgentPermissionPolicyService();
