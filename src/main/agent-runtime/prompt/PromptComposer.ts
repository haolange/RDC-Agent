import type { AgentRole } from '@shared/types/agent';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { AgentPermissionMode, AgentPermissionSettings } from '@shared/types/settings';
import type { AppMode, ProjectInputRecord, SessionAttachmentRecord } from '@shared/types/session';
import type { ConversationMessage } from '@shared/types/conversation';
import {
  AGENT_WORKBENCH_COMMAND_CATALOG,
  AGENT_WORKBENCH_TOOL_CATALOG,
} from '@shared/constants/agentWorkbenchCatalog';

export interface ProfilePromptContext {
  projectId: string | null;
  /** 当前激活项目根目录；工具执行 base 与之一致，LLM 应据此生成相对路径。 */
  projectRootPath: string | null;
  sessionId: string | null;
  activeRunId: string | null;
  openedCapturePath: string | null;
  projectInputs: ProjectInputRecord[];
  importedAttachments: SessionAttachmentRecord[];
}

export interface ProfilePromptDefinition {
  agentId: AgentRole;
  agentLabel: string;
  agentDescription: string;
  baseInstructions?: string;
  globalInstructions?: string;
}

export interface ProfileTurnPromptInput {
  context: ProfilePromptContext;
  history: ConversationMessage[];
  definition: ProfilePromptDefinition;
  requestedMode: AppMode;
  rawMessage: string;
  effectiveMessage: string;
  taskFilePath: string | null;
  taskFileContent: string | null;
}

export interface ProfileSystemPromptInput {
  definition: ProfilePromptDefinition;
  routeCapability: AgentRouteCapability;
  allowedToolNames: string[];
  permissionSettings: AgentPermissionSettings;
  /** 当前激活项目根目录，注入到 system prompt 的 Working Directory 段落。 */
  workspaceRoot: string | null;
}

export function composeProfileTurnPrompt(input: ProfileTurnPromptInput): string {
  const recentHistory = input.history.slice(-6).map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  return JSON.stringify({
    agent_id: input.definition.agentId,
    agent_label: input.definition.agentLabel,
    requested_mode: input.requestedMode,
    requested_mode_label: input.definition.agentLabel,
    user_message: input.rawMessage,
    effective_user_message: input.effectiveMessage,
    task_file_path: input.taskFilePath,
    task_file_content: input.taskFileContent,
    current_project_id: input.context.projectId,
    current_project_root: input.context.projectRootPath,
    current_session_id: input.context.sessionId,
    active_run_id: input.context.activeRunId,
    opened_capture: input.context.openedCapturePath,
    project_inputs: input.context.projectInputs.slice(0, 8).map((entry) => entry.fileName),
    incoming_attachments: input.context.importedAttachments.map((entry) => ({
      file_name: entry.fileName,
      kind: entry.kind,
      mime_type: entry.mimeType,
    })),
    recent_history: recentHistory,
  }, null, 2);
}

export function composeProfileSystemPrompt(input: ProfileSystemPromptInput): string {
  const basePrompt = input.definition.baseInstructions?.trim()
    || `You are ${input.definition.agentLabel}. ${input.definition.agentDescription}`;
  const globalInstructions = input.definition.globalInstructions?.trim();
  const routeInstructions = composeRouteCapabilityPrompt(input.routeCapability, input.allowedToolNames);
  const permissionInstructions = composePermissionPrompt(input.permissionSettings);
  const workspaceInstructions = composeWorkspacePrompt(
    input.workspaceRoot,
    input.permissionSettings.mode,
  );

  return [
    basePrompt,
    '',
    'Show concise visible work summaries and tool results only. Do not reveal hidden chain-of-thought.',
    workspaceInstructions,
    routeInstructions,
    permissionInstructions,
    input.routeCapability.toolCallingMode === 'native-structured'
      ? composeRuntimeCatalogPrompt(input.allowedToolNames)
      : '',
    globalInstructions ? `Global Instructions:\n${globalInstructions}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

function composeWorkspacePrompt(
  workspaceRoot: string | null,
  permissionMode: AgentPermissionMode,
): string {
  if (!workspaceRoot) return '';
  const lines = [
    '# Working Directory',
    `The current project root is ${workspaceRoot}. Use it as the default base for relative file paths, search roots, and shell working directory.`,
  ];
  if (permissionMode === 'full-access') {
    lines.push(
      'You may also access files outside this project root using absolute paths when calling read_file, glob, grep, or shell commands.',
    );
  } else {
    lines.push(
      'Files outside this project root may still be accessible when the runtime permission policy allows it; use absolute paths for those locations.',
    );
  }
  lines.push(
    'When you report a file path, use the absolute path that the tool actually resolved. Do not claim a path that differs from the tool result.',
  );
  return lines.join('\n');
}

function formatConfiguredRoots(
  roots: string[],
  fallback: string,
): string {
  return roots.length > 0 ? roots.join(', ') : fallback;
}

function composePermissionPrompt(permissionSettings: AgentPermissionSettings): string {
  const mode = permissionSettings.mode;
  const lines = [
    '# Runtime Permission Policy',
    `Current permission mode: ${mode}.`,
  ];

  switch (mode) {
    case 'full-access':
      lines.push(
        'Readable roots: entire local machine.',
        'Writable roots: entire local machine.',
        'Use read_file with absolute paths for files outside the current project root.',
        'Do not claim inability to read or write a local path without attempting the tool first.',
      );
      break;
    case 'auto-review':
      lines.push(
        'Readable roots: current project workspace; external read paths are auto-reviewed and usually denied at medium risk.',
        'Writable roots: current project workspace; external write paths are auto-reviewed and usually denied at medium or high risk.',
        'When external access is needed, ask the user to switch to Default or Full access, or add readableRoots in Custom mode settings.',
        'If policy may deny the path, still attempt read_file with an absolute path so the runtime can record the review outcome.',
      );
      break;
    case 'custom':
      lines.push(
        `Readable roots: current project workspace plus ${formatConfiguredRoots(
          permissionSettings.readableRoots,
          'no extra configured paths',
        )}.`,
        `Writable roots: current project workspace plus ${formatConfiguredRoots(
          permissionSettings.writableRoots,
          'no extra configured paths',
        )}.`,
        'Configured readableRoots and writableRoots in settings are allowed without extra approval.',
        'For other external paths, runtime approval rules still apply based on the closest matching policy.',
        'When policy allows access, use read_file with absolute paths and do not refuse without attempting the tool.',
      );
      break;
    default:
      lines.push(
        'Readable roots: current project workspace; external paths require one-time user approval.',
        'Writable roots: current project workspace; external paths require one-time user approval.',
        'When the user asks for a file outside the project, call read_file with its absolute path and wait for runtime approval if prompted.',
        'Do not refuse or guess file contents without attempting the tool first.',
        'External files, network access, file mutation, destructive shell commands, and unrecognized commands may pause for user approval.',
      );
      break;
  }

  lines.push(
    'Routine local inspection commands can run when the runtime policy allows them.',
    'When policy allows external access, use read_file with absolute paths instead of claiming the file is unreachable.',
    'If the runtime denies or requests approval, do not route around the decision with guessed paths or textual tool calls.',
  );

  return lines.join('\n');
}

function composeRouteCapabilityPrompt(
  routeCapability: AgentRouteCapability,
  allowedToolNames: string[],
): string {
  if (routeCapability.toolCallingMode === 'native-structured') {
    const toolCount = allowedToolNames.length;
    return [
      `Route Capability: native structured tool calling is enabled for ${routeCapability.providerId}/${routeCapability.modelId}.`,
      `The runtime registers ${toolCount} tool schema${toolCount === 1 ? '' : 's'} through the provider tool/function-call channel.`,
      'When a tool is needed, use only the provider structured tool/function-call channel.',
      'Do not write textual tool-call syntax in the assistant message.',
    ].join('\n');
  }

  return [
    `Route Capability: ${routeCapability.toolCallingMode} for ${routeCapability.providerId}/${routeCapability.modelId}.`,
    'This route cannot execute runtime tools in the current agent loop.',
    'Do not invent tool calls, tool results, file reads, searches, or command output.',
    'If you need runtime information, explain what information is missing and why.',
  ].join('\n');
}

function composeRuntimeCatalogPrompt(allowedToolNames: string[]): string {
  const allowed = new Set(allowedToolNames);
  const toolLines = AGENT_WORKBENCH_TOOL_CATALOG
    .filter((tool) => allowed.has(tool.id))
    .map((tool) => (
      `- ${tool.id}: ${tool.label}; permission=${tool.permission}; approval=${tool.approvalRequired ? 'required' : 'not required'}; result=${tool.resultSummary}`
    ));
  const commandLines = AGENT_WORKBENCH_COMMAND_CATALOG.map((command) => (
    `- ${command.command}: ${command.description}${command.relatedTools.length ? ` Uses: ${command.relatedTools.join(', ')}` : ''}.`
  ));

  return [
    '# Runtime Catalog',
    'Only use tools exposed to this profile by the runtime. Slash commands are intent hints and never bypass profile permissions.',
    '',
    'Allowed tools:',
    ...(toolLines.length > 0 ? toolLines : ['- None.']),
    '',
    'Slash commands:',
    ...commandLines,
  ].join('\n');
}
