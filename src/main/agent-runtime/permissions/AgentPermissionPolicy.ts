import * as os from 'os';
import * as path from 'path';
import type { AgentPermissionMode, AgentPermissionSettings } from '@shared/types/settings';
import type { CompiledPolicy } from '@shared/types/rdxRuntime';
import type { AgentTool } from '../agent/AgentTool';
import type { ToolCall } from '../core/types';
import { settingsService } from '../../settings/SettingsService';
import { matchBashHardDeny } from '../tools/primitives/bashHardDeny';
import {
  isToolDeniedByPolicy,
  resolvePolicyApprovalFloor,
} from './PolicyCompiler';

export type AgentPermissionDecisionAction = 'allow' | 'ask_user' | 'auto_review' | 'deny';

export interface AgentPermissionDecision {
  action: AgentPermissionDecisionAction;
  reason?: string;
  risk: 'low' | 'medium' | 'high';
  temporaryPathRoots: string[];
}

export interface AgentPermissionDecisionInput {
  tool: AgentTool;
  toolCall: ToolCall;
  /** 当前激活项目根目录；权限边界以它为准，回退固定 User Scope。 */
  projectRootPath?: string | null;
  /** Turn 冻结的权限快照；缺省时才读 settingsService（兼容旧调用）。 */
  permissionSettings?: AgentPermissionSettings;
  /** Turn 冻结的 CompiledPolicy；缺省视为空策略。 */
  compiledPolicy?: CompiledPolicy;
}

const READ_ONLY_FILE_TOOLS = new Set(['read_file', 'glob', 'grep']);
const MUTATION_TOOLS = new Set([
  'write_file',
  'edit_file',
  'copy_file',
  'move_file',
  'delete_file',
  'notebook_edit',
]);
const NETWORK_TOOL_NAMES = new Set(['web_fetch', 'web_search']);
const DEFAULT_ROUTINE_COMMAND_PREFIXES = [
  'dir',
  'ls',
  'type',
  'cat',
  'pwd',
  'head',
  'tail',
  'findstr',
  'find ',
  'where',
  'echo',
  'git status',
  'git diff',
  'git show',
  'git log',
  'rg',
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
  const normalized = command.trim().toLowerCase();
  return permissions.deniedCommandPrefixes.some((prefix) => normalized.startsWith(prefix.trim().toLowerCase()));
}

function isCommandAllowedByRule(command: string, permissions: AgentPermissionSettings): boolean {
  const normalized = command.trim().toLowerCase();
  return permissions.allowedCommandPrefixes.some((prefix) => normalized.startsWith(prefix.trim().toLowerCase()));
}

function isRoutineCommand(command: string, permissions: AgentPermissionSettings): boolean {
  if (isCommandAllowedByRule(command, permissions)) return true;
  const normalized = command.trim().toLowerCase();
  return DEFAULT_ROUTINE_COMMAND_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function denied(reason: string, risk: AgentPermissionDecision['risk'] = 'high'): AgentPermissionDecision {
  return { action: 'deny', reason, risk, temporaryPathRoots: [] };
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
  evaluate(input: AgentPermissionDecisionInput): AgentPermissionDecision {
    const settings = input.permissionSettings
      ? null
      : settingsService.getAll();
    const permissions = input.permissionSettings ?? settings!.agentRuntime.permissions;
    const mode = permissions.mode;
    const toolName = normalizeToolName(input.toolCall.name);
    const workspaceRoot = path.resolve(
      input.projectRootPath
      || settings?.paths.userRdxRoot
      || process.cwd(),
    );

    if (input.compiledPolicy && isToolDeniedByPolicy(input.compiledPolicy, toolName)) {
      return denied(`Policy deniedTools blocked tool "${input.toolCall.name}".`, 'high');
    }

    // Catastrophic bash patterns are hard-denied in every mode, including full-access.
    if (toolName === 'bash') {
      const command = extractStringArg(input.toolCall, 'command');
      const hardDeny = matchBashHardDeny(command);
      if (hardDeny) {
        return denied(`Shell command hard-denied (matched "${hardDeny}").`, 'high');
      }
    }

    if (input.compiledPolicy) {
      const floor = resolvePolicyApprovalFloor(
        input.compiledPolicy,
        toolName,
        input.tool.permissionHint,
      );
      if (floor === 'user' && mode !== 'full-access') {
        return request(mode, `Compiled policy requires approval for tool "${input.toolCall.name}".`, 'high');
      }
      if (floor === 'auto_review' && mode !== 'full-access') {
        return { action: 'auto_review', reason: `Compiled policy requires auto-review for tool "${input.toolCall.name}".`, risk: 'medium', temporaryPathRoots: [] };
      }
    }

    if (mode === 'full-access') {
      return { action: 'allow', risk: 'low', temporaryPathRoots: ['*'] };
    }

    if (isCommandDeniedByRule(extractStringArg(input.toolCall, 'command'), permissions)) {
      return denied('Custom policy denied this command prefix.');
    }

    const configuredReadableRoots = permissions.readableRoots.map(resolveConfiguredRoot);
    const configuredWritableRoots = permissions.writableRoots.map(resolveConfiguredRoot);

    if (READ_ONLY_FILE_TOOLS.has(toolName)) {
      const targets = extractPathTargets(toolName, input.toolCall).map((target) => resolveToolTarget(target, workspaceRoot));
      const externalTargets = targets.filter((target) => !isInsideWorkspace(target, workspaceRoot));
      if (externalTargets.length === 0) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      const allowedTargets = externalTargets.filter((target) => configuredReadableRoots.some((root) => isWithinRoot(target, root)));
      if (allowedTargets.length === externalTargets.length) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: allowedTargets };
      }
      return request(
        mode,
        `Read access is outside the workspace: ${externalTargets.join(', ')}`,
        'medium',
        externalTargets,
      );
    }

    if (toolName === 'bash') {
      const command = extractStringArg(input.toolCall, 'command');
      if (!command) return denied('Shell command is empty.', 'medium');
      if (isCommandAllowedByRule(command, permissions)) {
        return { action: 'allow', risk: 'low', temporaryPathRoots: [] };
      }
      if (isDangerousCommand(command)) {
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
