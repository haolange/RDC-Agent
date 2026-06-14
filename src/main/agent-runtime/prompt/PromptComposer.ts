import type { AgentRole } from '@shared/types/agent';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type { AppMode, ProjectInputRecord, SessionAttachmentRecord } from '@shared/types/session';
import type { ConversationMessage } from '@shared/types/conversation';
import {
  AGENT_WORKBENCH_COMMAND_CATALOG,
  AGENT_WORKBENCH_TOOL_CATALOG,
} from '@shared/constants/agentWorkbenchCatalog';

export interface ProfilePromptContext {
  projectId: string | null;
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

  return [
    basePrompt,
    '',
    'Show concise visible work summaries and tool results only. Do not reveal hidden chain-of-thought.',
    routeInstructions,
    permissionInstructions,
    input.routeCapability.toolCallingMode === 'native-structured'
      ? composeRuntimeCatalogPrompt(input.allowedToolNames)
      : '',
    globalInstructions ? `Global Instructions:\n${globalInstructions}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

function composePermissionPrompt(permissionSettings: AgentPermissionSettings): string {
  const modeLabel = permissionSettings.mode;
  const readableRoots = permissionSettings.readableRoots.length > 0
    ? permissionSettings.readableRoots.join(', ')
    : 'workspace only unless user approves';
  const writableRoots = permissionSettings.writableRoots.length > 0
    ? permissionSettings.writableRoots.join(', ')
    : 'workspace only unless user approves';

  return [
    '# Runtime Permission Policy',
    `Current permission mode: ${modeLabel}.`,
    `Readable roots: ${readableRoots}.`,
    `Writable roots: ${writableRoots}.`,
    'Routine local inspection commands can run when the runtime policy allows them.',
    'External files, network access, file mutation, destructive shell commands, and unrecognized commands may pause for user approval or auto-review.',
    'If the runtime denies or requests approval, do not route around the decision with guessed paths or textual tool calls.',
  ].join('\n');
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
