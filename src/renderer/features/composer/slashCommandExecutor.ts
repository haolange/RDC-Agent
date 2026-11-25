import { translate, type TranslationKey } from '../../i18n';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { acceptSessionSnapshot, receiveSessionList } from '../../stores/sessionRecordStore';
import { useSessionStore } from '../../stores/sessionStore';
import { applySessionSwitchHygiene } from '../../stores/sessionSwitchHygiene';
import { hydrateLoadedSessionSurface } from '../../stores/sessionProjectionHydration';
import { readCompiledComposerRoute } from '../../lib/composerEffectiveModel';
import { readComposerEffectiveModel } from '../../hooks/useComposerEffectiveModel';
import { notify } from '../../stores/notificationStore';
import { resolveComposerModelOverride } from './resolveComposerModelOverride';
import { clearComposerModelChoice, commitComposerModelChoice } from './sessionModelOverride';
import {
  isComposerAgentDefaultToken,
  resolveComposerAgentDefaultState,
} from './composerAgentDefaultModel';
import { loadComposerModelPickerOptions } from './useComposerModelPickerOptions';
import type { ConversationMessage } from '@shared/types/conversation';
import type { CommandUiAction } from '@shared/types/command';
import type { AgentPermissionMode, AppTheme } from '@shared/types/settings';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';

const currentText = (key: TranslationKey, params?: Record<string, string | number>) => translate(useAppSettingsStore.getState().settings.appearance.language, key, params);

interface SlashCommandContext {
  currentSession: SessionRecord | null;
  currentProject: ProjectRecord | null;
  selectedAgentId: string;
  setSelectedAgentId: (agentId: string) => void;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
  openSettings: (section?: string) => void;
  armPendingSkill?: (skillId: string, skillName?: string) => void;
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

async function loadSession(sessionId: string): Promise<void> {
  const electronAPI = window.electronAPI;
  const projectStore = useProjectStore.getState();
  const previousSessionId = projectStore.currentSessionId;
  const result = await electronAPI.session.open(sessionId);
  if (!result.success) {
    notify.failure(result.error, currentText, 'composer.commandSessionMissing');
    return;
  }

  const opened = result.session.record;
  if (previousSessionId !== opened.sessionId) {
    applySessionSwitchHygiene({ previousSessionId, nextSessionId: opened.sessionId });
  }
  acceptSessionSnapshot(result.session);
  projectStore.setCurrentSessionId(opened.sessionId);
  const sessionStore = useSessionStore.getState();
  sessionStore.setCurrentRun(result.currentRun);
  hydrateLoadedSessionSurface({
    sessionId: opened.sessionId,
    messages: result.history.messages,
    branchState: result.history.branchState ?? null,
    planReview: result.history.planReview,
    tracePresentation: result.trace.presentation ?? null,
    applyTrace: Boolean(result.trace.presentation),
  });
  const sessionsResult = await electronAPI.session.list(opened.projectId);
  projectStore.setSessions(receiveSessionList(sessionsResult.sessions));
}

async function switchModel(modelId: string, context: SlashCommandContext): Promise<void> {
  const { settings } = useAppSettingsStore.getState();
  const language = settings.appearance.language;
  const route = readCompiledComposerRoute(settings, context.selectedAgentId);
  const options = await loadComposerModelPickerOptions(settings.llm.providers);
  if (isComposerAgentDefaultToken(modelId)) {
    const state = resolveComposerAgentDefaultState(route, options, true);
    if (!state.selectable) {
      notify.warning(translate(
        language,
        state.kind === 'unset' ? 'composer.model.agentDefaultUnset' : 'composer.model.agentDefaultUnavailable',
      ));
      return;
    }
    const cleared = await clearComposerModelChoice(
      context.currentSession?.sessionId,
      context.currentProject?.projectId,
    );
    if (!cleared.ok) notify.error(translate(language, 'composer.model.saveFailed'));
    return;
  }
  const override = resolveComposerModelOverride(modelId, options);
  if (!override) {
    notify.warning(translate(language, 'composer.model.invalidArg'));
    return;
  }
  const result = await commitComposerModelChoice(
    override,
    context.currentSession?.sessionId,
    context.currentProject?.projectId,
  );
  if (!result.ok) notify.error(translate(language, 'composer.model.saveFailed'));
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
        notify.warning(currentText('composer.commandThemeInvalid'));
        return;
      }
      await useAppSettingsStore.getState().setTheme(theme as AppTheme);
      return;
    }
    case 'switch-permissions': {
      const mode = getPayloadString(action, 'mode');
      if (!mode || !(['default', 'auto-review', 'full-access', 'custom'] as string[]).includes(mode)) {
        notify.warning(currentText('composer.commandPermissionInvalid'));
        return;
      }
      await useAppSettingsStore.getState().setAgentPermissionMode(mode as AgentPermissionMode);
      return;
    }
    case 'resume-session': {
      const sessionId = getPayloadString(action, 'sessionId');
      if (sessionId) {
        await loadSession(sessionId);
        return;
      }
      const result = await electronAPI.workflow.resume();
      if (!result.success) {
        notify.failure(result.error, currentText, 'composer.commandNoResumable');
      }
      return;
    }
    case 'export-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        notify.warning(currentText('composer.commandNoSession'));
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
    case 'undo-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        notify.warning(currentText('composer.commandNoSession'));
        return;
      }
      const result = await electronAPI.conversation.undoLastTurn(sessionId);
      if (result.success) {
        context.setConversationMessages(result.messages);
      } else {
        notify.failure(result.error, currentText, 'composer.commandUndoFailed');
      }
      return;
    }
    case 'clear-session': {
      const sessionId = getPayloadString(action, 'sessionId') || context.currentSession?.sessionId;
      if (!sessionId) {
        notify.warning(currentText('composer.commandNoSession'));
        return;
      }
      const result = await electronAPI.conversation.clearHistory(sessionId);
      if (result.success) {
        context.setConversationMessages(result.messages);
      } else {
        notify.failure(result.error, currentText, 'composer.commandClearFailed');
      }
      return;
    }
    case 'run-skill': {
      const skillId = getPayloadString(action, 'skillId');
      if (!skillId) {
        notify.warning(currentText('composer.commandNoSkill'));
        return;
      }
      const skillName = getPayloadString(action, 'skillName') || skillId;
      context.armPendingSkill?.(skillId, skillName);
      notify.info(currentText('composer.commandSkillArmed', { skill: skillName }));
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
    const effectiveModel = readComposerEffectiveModel(
      context.selectedAgentId,
      context.currentSession,
      context.currentProject?.projectId,
    );
    const response = await electronAPI.command.execute({
      input,
      context: {
        sessionId: context.currentSession?.sessionId,
        projectId: context.currentProject?.projectId,
        workspaceRoot: context.currentProject?.rootPath,
        agentId: context.selectedAgentId,
        currentMode: context.selectedAgentId,
        currentModelId: effectiveModel
          ? `${effectiveModel.providerId}:${effectiveModel.modelId}`
          : undefined,
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
      notify.failure(response.result.message, currentText, 'composer.commandFailed');
    }

    return true;
  } catch (error) {
    notify.failure(error, currentText, 'composer.commandFailed');
    return true;
  }
}
