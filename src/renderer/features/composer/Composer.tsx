import React, { useEffect, useMemo, useState } from 'react';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { ResolvedTheme } from '@shared/types/settings';
import { deriveComposeAccentVars } from '@shared/theme/composeAccent';
import { useI18n } from '../../i18n';
import { COMPOSER_PROMPT_MAX_HEIGHT, COMPOSER_PROMPT_MIN_HEIGHT } from './composerPromptGeometry';
import { useDynStyle } from '../../lib/useDynStyle';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import type { ComposerController } from './useComposer';
import { useComposerPendingRequest } from './useComposerPendingRequest';
import { ComposerPendingRequest } from './ComposerPendingRequest';
import { ComposerEditor } from './ComposerEditor';
import { ComposerFooter } from './ComposerFooter';
import { useSlashCommand } from './useSlashCommand';
import { type ComposerMarkdownMode } from './ComposerMarkdownInput';
import { ComposerMarkdownModeTabs } from './ComposerMarkdownModeTabs';
import { ComposerMenuRegistryProvider } from './useComposerMenuRegistry';
import { ComposerAttachIngest } from './ComposerAttachIngest';
import { ComposerAttachmentTray } from './ComposerAttachmentTray';
import { buildComposerSessionScopeKey } from '../../lib/composerSessionScope';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useComposerAttachmentDrop } from './useComposerAttachmentDrop';
import { useComposerVisionCapability } from './useComposerVisionCapability';
import './composer-pending-requests.css';
import './composer-chrome.css';
import './composer-effort.css';
import './composer-attachments.css';
import './composer-plan-review.css';

export interface ComposerProps {
  composer: ComposerController;
}

function getAgentCapability(agentId: string, definitions: AgentManifestDefinition[]): string {
  const manifest = definitions.find((d) => d.id === agentId);
  return manifest?.description ?? '';
}

export const Composer: React.FC<ComposerProps> = ({
  composer,
}) => {
  const { t } = useI18n();
  const composerMarkdown = useAppSettingsStore((state) => state.settings.appearance.composerMarkdown);
  const [markdownMode, setMarkdownMode] = useState<ComposerMarkdownMode>('write');
  const appearanceTheme = useAppSettingsStore((state) => state.settings.appearance.theme);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const resolvedTheme: ResolvedTheme = appearanceTheme === 'system' ? systemTheme : appearanceTheme;
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const activeAgentId = useComposerSessionContextStore((state) => (
    state.activeTurn?.sessionId === (currentSession?.sessionId ?? 'no-session')
      ? state.activeTurn.agentId
      : null
  ));
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const composerScopeKey = useMemo(
    () => buildComposerSessionScopeKey(currentProject?.projectId, currentSession?.sessionId),
    [currentProject?.projectId, currentSession?.sessionId],
  );
  const slashCommand = useSlashCommand(
    composer.promptValue,
    composer.setPromptValueDirect,
    (commandName) => composer.setPromptValueDirect(`/${commandName} `),
  );

  const {
    promptValue,
    setPromptValue,
    pendingAttachments,
    pendingSkillIds,
    removePendingSkill,
    promptInputRef,
    currentMode,
    currentModeConfig,
    currentModeLabel,
    selectedAgentId,
    userInvocableAgents,
    setSelectedAgentId,
    lastKnownUsage,
    usageEstimated,
    usageStale,
    preparedTurnContext,
    conversationPreparationPhase,
    selectedContextProfile,
    isComposerBusy,
    promptPlaceholder,
    attachButtonLabel,
    primaryButtonDisabled,
    primaryButtonDescription,
    handlePrimaryStop,
    handleAttachmentSelect,
    handleFilesIngest,
    handlePendingAttachmentRemove,
    fileInputRef,
    isDropActive,
    setIsDropActive,
    handlePromptSend,
    handlePromptKeyDown,
  } = composer;
  const visionSupported = useComposerVisionCapability(selectedAgentId, currentSession);
  const attachmentDrop = useComposerAttachmentDrop({
    disabled: isComposerBusy,
    setIsDropActive,
    handleFilesIngest,
  });
  const selectedAgentDefinition = userInvocableAgents.find((agent) => agent.id === selectedAgentId);
  const selectedAgentCapability = getAgentCapability(selectedAgentId, userInvocableAgents);
  const composeAccentVars = useMemo(
    () => deriveComposeAccentVars(currentModeConfig.accentColor, resolvedTheme),
    [currentModeConfig.accentColor, resolvedTheme],
  );
  const composeAccentStyle = useDynStyle({
    ...composeAccentVars,
    '--composer-prompt-min-height': `${COMPOSER_PROMPT_MIN_HEIGHT}px`,
    '--composer-prompt-max-height': `${COMPOSER_PROMPT_MAX_HEIGHT}px`,
  });

  useEffect(() => {
    if (!composerMarkdown || isComposerBusy) {
      setMarkdownMode('write');
    }
  }, [composerMarkdown, isComposerBusy]);

  const pendingRequest = useComposerPendingRequest();
  if (pendingRequest) return <ComposerPendingRequest pending={pendingRequest} composeAccentStyle={composeAccentStyle} />;

  return (
    <ComposerMenuRegistryProvider key={composerScopeKey}>
    <div
      className={`composer-shell ${isComposerBusy ? 'is-running' : ''}${composerMarkdown ? ' has-markdown-mode' : ''}${isDropActive ? ' is-drop-active' : ''}`}
      {...composeAccentStyle}
      onDragOver={attachmentDrop.handleDragOver}
      onDragLeave={attachmentDrop.handleDragLeave}
      onDrop={attachmentDrop.handleDrop}
      onPaste={attachmentDrop.handlePaste}
    >
      <ComposerAttachIngest
        fileInputRef={fileInputRef}
        isDropActive={isDropActive}
        dropHint={t('app.attachDropHint')}
        onFiles={(files) => void handleFilesIngest(files)}
      />
      {composerMarkdown ? (
        <ComposerMarkdownModeTabs
          mode={markdownMode}
          onModeChange={setMarkdownMode}
          disabled={isComposerBusy}
        />
      ) : null}
      <ComposerAttachmentTray
        onMaterialChange={(id, material) => composer.setPendingAttachments(current => current.map(item => item.id === id ? { ...item, material } : item))}
        pendingSkillIds={pendingSkillIds}
        pendingAttachments={pendingAttachments}
        composerScopeKey={composerScopeKey}
        visionUnsupported={!visionSupported}
        removePendingSkill={removePendingSkill}
        handlePendingAttachmentRemove={handlePendingAttachmentRemove}
        armedSkillMeta={t('app.armedSkillMeta')}
        removeArmedSkillLabel={(skillId) => t('app.removeArmedSkill', { skillId })}
        removeAttachmentLabel={(fileName) => t('app.removeAttachment', { fileName })}
        visionUnsupportedLabel={t('app.attachVisionUnsupported')}
      />
      <ComposerEditor
        promptValue={promptValue}
        setPromptValue={setPromptValue}
        promptInputRef={promptInputRef}
        isComposerBusy={isComposerBusy}
        promptPlaceholder={promptPlaceholder}
        handlePromptSend={handlePromptSend}
        handleFilesIngest={handleFilesIngest}
        handlePromptKeyDown={handlePromptKeyDown}
        composerMarkdown={composerMarkdown}
        composerScopeKey={composerScopeKey}
        markdownMode={markdownMode}
        slashCommand={slashCommand}
      />
      <ComposerFooter
        currentMode={currentMode}
        currentModeConfig={currentModeConfig}
        currentModeLabel={currentModeLabel}
        selectedAgentId={selectedAgentId}
        userInvocableAgents={userInvocableAgents}
        setSelectedAgentId={setSelectedAgentId}
        lastKnownUsage={lastKnownUsage}
        usageEstimated={usageEstimated}
        usageStale={usageStale}
        preparedTurnContext={preparedTurnContext}
        conversationPreparationPhase={conversationPreparationPhase}
        selectedContextProfile={selectedContextProfile}
        isComposerBusy={isComposerBusy}
        attachButtonLabel={attachButtonLabel}
        primaryButtonDisabled={primaryButtonDisabled}
        primaryButtonDescription={primaryButtonDescription}
        handlePrimaryStop={handlePrimaryStop}
        handleAttachmentSelect={handleAttachmentSelect}
        handlePromptSend={handlePromptSend}
        selectedAgentDefinition={selectedAgentDefinition}
        selectedAgentCapability={selectedAgentCapability}
        activeAgentId={activeAgentId}
        setCurrentMode={setCurrentMode}
        currentSession={currentSession}
      />
    </div>
    </ComposerMenuRegistryProvider>
  );
};
