import * as os from 'os';
import { matchShellFileToolBypass } from './shellFileToolBypass';
import * as path from 'path';
import type { AgentPermissionMode, AgentPermissionSettings } from '@shared/types/settings';
import type { CompiledPolicy } from '@shared/types/rdcRuntime';
import type { AgentTool } from '../agent/AgentTool';
import type { ToolCall } from '../core/types';
import { settingsService } from '../../settings/SettingsService';
import { matchShellHardDeny } from '../tools/primitives/shellHardDeny';
import {
  matchesDeniedCommandPrefix,
  shellCommandRiskAnalyzer,
} from './ShellCommandRiskAnalyzer';
import { resolveConfiguredShell } from '../../runtime/resolveConfiguredShell';
import type { ShellKind } from '../../runtime/ShellResolver';
import {
  isToolDeniedByPolicy,
  resolvePolicyApprovalFloor,
} from './PolicyCompiler';
import { isMissionForbiddenToolId, isMissionProfileId } from '@shared/constants/missionPlanOnly';
import { isKnowledgeReadFileTool } from '../knowledgeReadRoots';
import { isWithinRootAllowingAliases } from '../tools/primitives/_shared';

/**
 * Agent permission risk classifier for tool / shell calls.
 *
 * This is NOT a security boundary. Hard deny lists, OS permissions, Electron
 * sandbox, and IPC schema validation provide enforcement; this service only
 * classifies risk and routes allow / ask_user / auto_review / deny decisions.
 */
export type AgentPermissionDecisionAction = 'allow' | 'ask_user' | 'auto_review' | 'deny';

export interface AgentPermissionDecision {
  action: AgentPermissionDecisionAction;
  reason?: string;
  risk: 'low' | 'medium' | 'high';
  temporaryPathRoots: string[];
}

export interface AgentPermissionDecisionInput {
  /** Actual tools available to this executor after frozen skill intersection. */
  effectiveToolNames?: readonly string[];
  tool: AgentTool;
  toolCall: ToolCall;
  /** Mission plan-only hard deny uses this; Full access cannot bypass. */
  agentId?: string | null;
  /** 当前激活项目根目录；权限边界以它为准，回退固定 User Scope。 */
  projectRootPath?: string | null;
  /** Turn 冻结的权限快照；缺省时才读 settingsService（兼容旧调用）。 */
  permissionSettings?: AgentPermissionSettings;
  /** Turn 冻结的 CompiledPolicy；缺省视为空策略。 */
  compiledPolicy?: CompiledPolicy;
  /** Current session attachments directory; readable by read-only file tools only. */
  sessionAttachmentsRoot?: string | null;
  /**
   * Frozen plan knowledge read roots. Merged only into READ_ONLY_FILE_TOOLS.
   * Never written into persisted permissionSettings.readableRoots.
   */
  knowledgeReadRoots?: readonly string[];
}

export const READ_ONLY_FILE_TOOLS = new Set(['read_file', 'read_image', 'glob', 'grep']);
const MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'copy_file',
  'move_file',
  'delete_file',
  'notebook_edit',
  'code_interpreter',
]);
const NETWORK_TOOL_NAMES = new Set(['web_fetch', 'web_search']);
const WINDOWS_ROUTINE_COMMAND_PREFIXES = [
  'dir',
  'ls',
  'get-childitem',
  'get-location',
  'pwd',
  'echo',
  'write-output',
  'git status',
  'git diff',
  'git show',
  'git log',
  'node scripts/check-',
  'pnpm run check:',
  'pnpm run typecheck',
];

const POSIX_ROUTINE_COMMAND_PREFIXES = [
  'ls',
  'pwd',
  'echo',
  'which',
  'where',
  'git status',
  'git diff',
  'git show',
  'git log',
  'node scripts/check-',
  'pnpm run check:',
  'pnpm run typecheck',
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

function expandPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.resolve(os.homedir(), trimmed.slice(2));
  }
  return trimmed.replace(/^%USERPROFILE%/i, os.homedir());
}

function resolveConfiguredRoot(value: string): string {
  return path.resolve(expandPath(value));
}

function resolveToolTarget(value: string, workspaceRoot: string): string {
  const expanded = expandPath(value);
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspaceRoot, expanded);
}

function isWithinRoot(target: string, root: string): boolean {
  if (root === '*') return true;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isInsideWorkspace(target: string, workspaceRoot: string): boolean {
  return isWithinRoot(target, workspaceRoot);
}

function extractStringArg(toolCall: ToolCall, key: string): string {
  const value = toolCall.arguments[key];
  return typeof value === 'string' ? value.trim() : '';
}

function inferPathTargetFromGlobPattern(pattern: string): string {
  const expanded = expandPath(pattern);
  if (!path.isAbsolute(expanded)) return '';
  const wildcardIndex = expanded.search(/[*?{[]/);
  if (wildcardIndex < 0) return expanded;
  const sepIndex = Math.max(expanded.lastIndexOf('/', wildcardIndex), expanded.lastIndexOf('\\', wildcardIndex));
  return sepIndex > 0 ? expanded.slice(0, sepIndex) : path.parse(expanded).root;
}

function extractPathTargets(toolName: string, toolCall: ToolCall): string[] {
  if (
    toolName === 'read_file'
    || toolName === 'read_image'
    || toolName === 'write_file'
    || toolName === 'edit_file'
    || toolName === 'delete_file'
  ) {
    const filePath = extractStringArg(toolCall, 'path');
    return filePath ? [filePath] : [];
  }
  if (toolName === 'notebook_edit') {
    const notebookPath = extractStringArg(toolCall, 'notebook_path');
    return notebookPath ? [notebookPath] : [];
  }
  if (toolName === 'copy_file' || toolName === 'move_file') {
    return [
      extractStringArg(toolCall, 'source'),
      extractStringArg(toolCall, 'destination'),
    ].filter(Boolean);
  }
  if (toolName === 'glob' || toolName === 'grep') {
    const cwd = extractStringArg(toolCall, 'cwd') || extractStringArg(toolCall, 'path');
    if (cwd) return [cwd];
    const patternTarget = toolName === 'glob'
      ? inferPathTargetFromGlobPattern(extractStringArg(toolCall, 'pattern'))
      : '';
    return patternTarget ? [patternTarget] : [];
  }
  return [];
}

function commandUsesExternalPath(command: string, workspaceRoot: string, roots: string[]): boolean {
  const normalized = command.replace(/\\/g, '/');
  const home = os.homedir().replace(/\\/g, '/');
  const workspace = workspaceRoot.replace(/\\/g, '/');
  const mentionsHome = normalized.includes('~/') || normalized.toLowerCase().includes(home.toLowerCase());
  const mentionsOtherRoot = roots.some((root) => normalized.toLowerCase().includes(root.replace(/\\/g, '/').toLowerCase()));
  const absoluteMentions = [
    ...normalized.matchAll(/[A-Za-z]:\/[^\s"'|&;]+/g),
    ...normalized.matchAll(/\/(?:Users|home|Desktop|tmp|var|etc|opt)\/[^\s"'|&;]*/g),
    ...normalized.matchAll(/(^|\s)\/(?=\s|$)/g),
  ].map((match) => match[0].trim()).filter(Boolean);
  const mentionsExternalAbsolutePath = absoluteMentions.some((candidate) => !candidate.toLowerCase().startsWith(workspace.toLowerCase()));
  if (!mentionsHome && !mentionsOtherRoot && !mentionsExternalAbsolutePath) return false;
  return !normalized.toLowerCase().includes(workspace.toLowerCase());
}

function isCommandDeniedByRule(command: string, permissions: AgentPermissionSettings): boolean {
  if (!command.trim()) return false;
  return permissions.deniedCommandPrefixes.some((prefix) => matchesDeniedCommandPrefix(command, prefix));
}

function isCommandAllowedByRule(command: string, permissions: AgentPermissionSettings): boolean {
  return permissions.allowedCommandPrefixes.some((prefix) => matchesDeniedCommandPrefix(command, prefix));
}

function routineCommandPrefixes(): string[] {
  const kind = resolveShellKind();
  return kind === 'pwsh' || kind === 'windows-powershell'
    ? WINDOWS_ROUTINE_COMMAND_PREFIXES
    : POSIX_ROUTINE_COMMAND_PREFIXES;
}

function isRoutineCommand(command: string, permissions: AgentPermissionSettings): boolean {
  if (isCommandAllowedByRule(command, permissions)) return true;
  return routineCommandPrefixes().some((prefix) => matchesDeniedCommandPrefix(command, prefix));
}

function resolveShellKind(): ShellKind {
  try {
    return resolveConfiguredShell().kind;
  } catch {
    return process.platform === 'win32' ? 'pwsh' : 'bash';
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
    const settings = input.permissionSettings
      ? null
      : settingsService.getAll();
    const permissions = input.permissionSettings ?? settings!.agentRuntime.permissions;
    const mode = permissions.mode;
    const toolName = normalizeToolName(input.toolCall.name);
    const workspaceRoot = path.resolve(
      input.projectRootPath
      || settings?.paths.userRdcRoot
      || process.cwd(),
    );

    if (input.agentId && isMissionProfileId(input.agentId) && isMissionForbiddenToolId(toolName)) {
      return denied(
        `MISSION_PLAN_ONLY_DENIED: tool "${input.toolCall.name}" is forbidden for ${input.agentId}. Full access cannot bypass.`,
        'high',
      );
    }

    if (input.compiledPolicy && isToolDeniedByPolicy(input.compiledPolicy, toolName)) {
      return denied(`Policy deniedTools blocked tool "${input.toolCall.name}".`, 'high');
    }

    if (toolName === 'shell' && input.toolCall.arguments.rdc && input.agentId !== 'general') {
      return denied('RDC_EXECUTION_DENIED: General only.', 'high');
    }

    // Catastrophic shell patterns are hard-denied in every mode, including full-access.
    if (toolName === 'shell') {
      const command = extractStringArg(input.toolCall, 'command');
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
    workspaceRoot: string,
  ): AgentPermissionDecision {
    if (mode === 'full-access') {
      return { action: 'allow', risk: 'low', temporaryPathRoots: ['*'] };
    }

    if (toolName === 'shell' && isCommandDeniedByRule(extractStringArg(input.toolCall, 'command'), permissions)) {
      return denied('Custom policy denied this command prefix (word-boundary match).');
    }

    const configuredReadableRoots = permissions.readableRoots.map(resolveConfiguredRoot);
    const configuredWritableRoots = permissions.writableRoots.map(resolveConfiguredRoot);
    const sessionAttachmentsRoot = input.sessionAttachmentsRoot
      ? path.resolve(input.sessionAttachmentsRoot)
      : null;
    const knowledgeReadRoots = isKnowledgeReadFileTool(toolName)
      ? (input.knowledgeReadRoots ?? []).map((root) => path.resolve(root))
      : [];
    const readRoots = [
      ...configuredReadableRoots,
      ...(sessionAttachmentsRoot ? [sessionAttachmentsRoot] : []),
    ];

    if (READ_ONLY_FILE_TOOLS.has(toolName)) {
      const targets = extractPathTargets(toolName, input.toolCall).map((target) => resolveToolTarget(target, workspaceRoot));
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
        `Read access is outside the workspace: ${externalTargets.join(', ')}`,
        'medium',
        externalTargets,
      );
    }

    if (toolName === 'shell') {
      const command = extractStringArg(input.toolCall, 'command');
      if (input.toolCall.arguments.rdc) return request(mode, 'Native RDC operation requires review: ' + JSON.stringify(input.toolCall.arguments.rdc), 'high');
      if (!command) return denied('Shell command is empty.', 'medium');
      if (isCommandAllowedByRule(command, permissions)) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      const analysis = shellCommandRiskAnalyzer.analyze(command);
      if (analysis.risk === 'high' || isDangerousCommand(command)) {
        return request(mode, `Shell command requires review: ${command}`, 'high');
      }
      if (commandUsesExternalPath(command, workspaceRoot, configuredReadableRoots)) {
        return request(mode, `Shell command references paths outside the workspace: ${command}`, 'medium');
      }
      if (isRoutineCommand(command, permissions)) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      return request(mode, `Shell command is not in the routine command set: ${command}`, 'medium');
    }

    if (MUTATION_TOOLS.has(toolName) || input.tool.permissionHint === 'mutation' || input.tool.permissionHint === 'destructive') {
      const targets = extractPathTargets(toolName, input.toolCall).map((target) => resolveToolTarget(target, workspaceRoot));
      const externalTargets = targets.filter((target) => !isInsideWorkspace(target, workspaceRoot));
      if (mode === 'custom' && externalTargets.length > 0) {
        const allowedTargets = externalTargets.filter((target) => configuredWritableRoots.some((root) => isWithinRoot(target, root)));
        if (allowedTargets.length === externalTargets.length) {
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

    if (NETWORK_TOOL_NAMES.has(toolName) && mode !== 'custom') {
      return request(mode, `Network tool "${input.toolCall.name}" requires approval in the current permission mode.`, 'medium');
    }

    return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
  }
}

export const agentPermissionPolicyService = new AgentPermissionPolicyService();
