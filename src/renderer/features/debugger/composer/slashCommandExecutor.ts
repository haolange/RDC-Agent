import type { CommandUiAction } from '@shared/types/command';
import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { AgentPermissionMode, AppTheme } from '@shared/types/settings';
import {
  nextAgentDefinitionClientRevision,
  useAppSettingsStore,
} from '../../../stores/appSettingsStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';

interface SlashCommandContext {
  currentSession: SessionRecord | null;
  currentProject: ProjectRecord | null;
  selectedAgentId: string;
  setSelectedAgentId: (agentId: string) => void;
  setCurrentMode: (mode: AgentMode) => void;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
  openSettings: (section?: string) => void;
  showNotice: (message: string) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object');

const getPayloadString = (action: CommandUiAction, key: string): string | null => {
  if (!('payload' in action) || !isRecord(action.payload)) {
    return null;
  }
  const payload = action.payload as Record<string, unknown>;
  const value = payload[key];
  return typeof value === 'string' ? value : null;
};

const toMarkdown = (messages: ConversationMessage[]): string =>
  messages.map((message) => {
    const timestamp = new Date(message.createdAt).toISOString();
    return `## ${message.role} - ${timestamp}\n\n${message.content || ''}`;
  }).join('\n\n');

const downloadTextFile = (fileName: string, content: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

async function loadSession(sessionId: string, context: SlashCommandContext): Promise<void> {
  const electronAPI = window.electronAPI;
  const result = await electronAPI.session.select(sessionId);
  if (!result.success || !result.session) {
    context.showNotice(result.error ?? `Session not found: ${sessionId}`);
    return;
  }

  const projectStore = useProjectStore.getState();
  const sessionStore = useSessionStore.getState();
  projectStore.setCurrentSession(result.session);
  sessionStore.setCurrentRun(result.currentRun ?? null);

  const [sessionsResult, runsResult, historyResult] = await Promise.all([
    electronAPI.session.list(result.session.projectId),
    electronAPI.run.list(result.session.sessionId),
    electronAPI.conversation.getHistory(result.session.sessionId),
  ]);
  projectStore.setSessions(sessionsResult.sessions);
  sessionStore.setRuns(runsResult.runs);
  context.setConversationMessages(historyResult.messages);
}

async function switchModel(modelId: string, context: SlashCommandContext): Promise<void> {
  const appSettingsStore = useAppSettingsStore.getState();
  const settings = appSettingsStore.settings;
  const matches = settings.agents.modelOptions.filter((option) => (
    option.status === 'ready'
    && (option.canonicalId === modelId || option.modelId === modelId)
  ));
  if (matches.length !== 1) {
    if (matches.length > 1) {
      context.showNotice(`Model id is ambiguous; use provider:model: ${modelId}`);
      return;
    }
    context.showNotice(`Model is not configured or enabled: ${modelId}`);
    context.openSettings('models');
    return;
  }

  const definition = settings.agents.definitions.find((entry) => entry.id === context.selectedAgentId);
  if (!definition) {
    context.showNotice(`Agent definition not found: ${context.selectedAgentId}`);
    return;
  }
  const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...draft } = definition;
  await appSettingsStore.saveAgentDefinition({
    draft: { ...draft, models: [matches[0].canonicalId] },
    clientRevision: nextAgentDefinitionClientRevision(),
  });
}

async function handleUiAction(action: CommandUiAction, context: SlashCommandContext): Promise<void> {
  const electronAPI = window.electronAPI;
  switch (action.type) {
    case 'none':
      return;
    case 'open-settings': {
      context.openSettings(getPayloadString(action, 'section') ?? undefined);
      return;
    }
    case 'switch-mode': {
      const agentId = getPayloadString(action, 'agentId');
      if (!agentId) return;
      context.setSelectedAgentId(agentId);
      context.setCurrentMode(agentId as AgentMode);
      return;
    }
    case 'switch-model': {
      const modelId = getPayloadString(action, 'modelId');
      if (!modelId) return;
      await switchModel(modelId, context);
      return;
    }
    case 'switch-theme': {
      const theme = getPayloadString(action, 'theme');
      if (!theme || !(['dark', 'light', 'system'] as string[]).includes(theme)) {
        context.showNotice('Theme must be dark, light, or system.');
        return;
      }
      await useAppSettingsStore.getState().setTheme(theme as AppTheme);
      return;
    }
    case 'switch-permissions': {
      const mode = getPayloadString(action, 'mode');
      if (!mode || !(['default', 'auto-review', 'full-access', 'custom'] as string[]).includes(mode)) {
        context.showNotice('Permission mode must be default, auto-review, full-access, or custom.');
        return;
      }
      await useAppSettingsStore.getState().setAgentPermissionMode(mode as AgentPermissionMode);
      return;
    }
    case 'resume-session': {
      const sessionId = getPayloadString(action, 'sessionId');
      if (sessionId) {
        await loadSession(sessionId, context);
        return;
      }
      const result = await electronAPI.workflow.resume();
      if (!result.success) {
        context.showNotice(result.error ?? 'No resumable session.');
      }
      return;
    }
    case 'export-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        context.showNotice('No session selected.');
        return;
      }
      const format = getPayloadString(action, 'format') === 'json' ? 'json' : 'markdown';
      const history = await electronAPI.conversation.getHistory(sessionId);
      const content = format === 'json'
        ? JSON.stringify(history.messages, null, 2)
        : toMarkdown(history.messages);
      downloadTextFile(
        `${sessionId}.${format === 'json' ? 'json' : 'md'}`,
        content,
        format === 'json' ? 'application/json' : 'text/markdown',
      );
      return;
    }
    case 'compact-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        context.showNotice('No session selected.');
        return;
      }
      const result = await electronAPI.conversation.compactHistory(sessionId);
      if (result.success) {
        context.setConversationMessages(result.messages);
        context.showNotice(result.contextView
          ? 'Context view created from ' + result.contextView.sourceTurnIds.length + ' earlier turns; transcript preserved.'
          : 'The session is already within the manual compaction threshold.');
      } else {
        context.showNotice(result.error ?? 'Compaction failed.');
      }
      return;
    }
    case 'undo-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        context.showNotice('No session selected.');
        return;
      }
      const result = await electronAPI.conversation.undoLastTurn(sessionId);
      if (result.success) {
        context.setConversationMessages(result.messages);
      } else {
        context.showNotice(result.error ?? 'Undo failed.');
      }
      return;
    }
    case 'clear-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        context.showNotice('No session selected.');
        return;
      }
      const result = await electronAPI.conversation.clearHistory(sessionId);
      if (result.success) {
        context.setConversationMessages(result.messages);
      } else {
        context.showNotice(result.error ?? 'Clear failed.');
      }
      return;
    }
    case 'run-skill': {
      const skillId = getPayloadString(action, 'skillId');
      context.showNotice(skillId ? `Skill execution is available to agent tools: ${skillId}` : 'No skill selected.');
      return;
    }
    default:
      return;
  }
}

export async function executeSlashCommand(input: string, context: SlashCommandContext): Promise<boolean> {
  const electronAPI = window.electronAPI;
  if (!electronAPI) return false;

  try {
    const settings = useAppSettingsStore.getState().settings;
    const currentRoute = settings.llm.agentRoutes.find((route) => route.agentId === context.selectedAgentId);
    const response = await electronAPI.command.execute({
      input,
      context: {
        sessionId: context.currentSession?.sessionId,
        projectId: context.currentProject?.projectId,
        workspaceRoot: context.currentProject?.rootPath,
        agentId: context.selectedAgentId,
        currentMode: context.selectedAgentId,
        currentModelId: currentRoute?.modelId,
        currentTheme: settings.appearance.theme,
      },
    });

    if (response.systemMessage) {
      context.upsertConversationMessages([response.systemMessage]);
    }

    if (response.result.uiAction) {
      await handleUiAction(response.result.uiAction, context);
    }

    if (response.result.invalidateStores?.includes('conversation')) {
      if (context.currentSession?.sessionId) {
        const history = await electronAPI.conversation.getHistory(context.currentSession.sessionId);
        context.setConversationMessages(history.messages);
      }
    }

    if (!response.result.success) {
      context.showNotice(response.result.message);
    }

    return true;
  } catch (error) {
    context.showNotice(error instanceof Error ? error.message : 'Command failed');
    return true;
  }
}
