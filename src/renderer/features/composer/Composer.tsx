import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deriveComposeAccentVars } from '@shared/theme/composeAccent';
import { agentDescription } from '../../lib/agentDescription';
import { InlineError } from '../../ui/InlineError';
import { useI18n } from '../../i18n';
import { useDynStyle } from '../../lib/useDynStyle';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { buildComposerSessionScopeKey } from '../../lib/composerSessionScope';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useComposerPendingRequest } from './useComposerPendingRequest';
import { ComposerPendingRequest } from './ComposerPendingRequest';
import { composerPendingRequestKey } from './pendingRequestSelection';
import { useComposerRequestReserve } from './useComposerRequestReserve';
import { ComposerEditor } from './ComposerEditor';
import { ComposerFooter } from './ComposerFooter';
import { useSlashCommand } from './useSlashCommand';
import { type ComposerMarkdownMode } from './ComposerMarkdownInput';
import { ComposerMarkdownModeTabs } from './ComposerMarkdownModeTabs';
import { ComposerMenuRegistryProvider } from './useComposerMenuRegistry';
import { ComposerTurnControlsProvider } from './ComposerTurnControlsContext';
import { ComposerAttachIngest } from './ComposerAttachIngest';
import { ComposerAttachmentTray } from './ComposerAttachmentTray';
import { ApprovedPlanHandoff } from './ApprovedPlanHandoff';
import { COMPOSER_PROMPT_MAX_HEIGHT, COMPOSER_PROMPT_MIN_HEIGHT } from './composerPromptGeometry';
import { useComposerAttachmentDrop } from './useComposerAttachmentDrop';
import { useComposerVisionCapability } from './useComposerVisionCapability';
import type { ComposerController } from './useComposer';
import type { ResolvedTheme } from '@shared/types/settings';
import './composer-pending-requests.css';
import './composer-chrome.css';
import './composer-effort.css';
import './composer-attachments.css';
import './composer-plan-review.css';

export interface ComposerProps {
  composer: ComposerController;
  shellRef?: React.Ref<HTMLDivElement>;
}

export const Composer: React.FC<ComposerProps> = ({
  composer,
  shellRef,
}) => {
  const { t, language } = useI18n();
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
    pendingSkills,
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
  const selectedAgentCapability = agentDescription(userInvocableAgents.find(agent => agent.id === selectedAgentId), language);
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
  const [requestShell, setRequestShell] = useState<HTMLDivElement | null>(null);
  const assignRequestShell = useCallback((node: HTMLDivElement | null) => {
    setRequestShell(node);
    if (typeof shellRef === 'function') shellRef(node);
    else if (shellRef) (shellRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [shellRef]);
  const requestReserve = useComposerRequestReserve(pendingRequest, requestShell);
  const requestReserveStyle = useDynStyle({ '--composer-request-reserve': `${requestReserve}px` });
  const handoffPhase = composer.handoff?.phase;
  const transitionLabel = conversationPreparationPhase === 'preparing' || handoffPhase === 'preparing'
    ? t('composer.handoff.preparing')
    : handoffPhase === 'confirming' ? t('composer.handoff.confirming')
      : handoffPhase ? t('composer.handoff.switching') : '';
  return (
    <ComposerTurnControlsProvider agentId={selectedAgentId} currentSession={currentSession}>
    {/* A session switch starts a fresh Composer; a request arriving or settling only changes which menus may be open. */}
    <ComposerMenuRegistryProvider key={composerScopeKey} scope={pendingRequest ? composerPendingRequestKey(pendingRequest) : 'composer'}>
    <div className="composer-frame" {...requestReserveStyle}>
    {pendingRequest ? <ComposerPendingRequest shellRef={assignRequestShell} pending={pendingRequest} composeAccentStyle={composeAccentStyle}
      agentId={pendingRequest.kind === 'plan-review' ? selectedAgentId : activeAgentId ?? selectedAgentId} currentSession={currentSession} onReplan={composer.sendExplicitPrompt} /> : <div
      ref={shellRef} className={`composer-shell ${isComposerBusy ? 'is-running' : ''}${composerMarkdown ? ' has-markdown-mode' : ''}`}
      {...composeAccentStyle}
      onDragOver={attachmentDrop.handleDragOver}
      onDragLeave={attachmentDrop.handleDragLeave}
      onDrop={attachmentDrop.handleDrop}
      onPaste={attachmentDrop.handlePaste}
    >
      <ApprovedPlanHandoff sessionId={currentSession?.sessionId} disabled={isComposerBusy} />
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
        pendingSkills={pendingSkills}
        pendingAttachments={pendingAttachments}
        composerScopeKey={composerScopeKey}
        visionUnsupported={!visionSupported}
        removePendingSkill={removePendingSkill}
        handlePendingAttachmentRemove={handlePendingAttachmentRemove}
        armedSkillMeta={t('app.armedSkillMeta')}
        removeArmedSkillLabel={(skill) => t('app.removeArmedSkill', { skill })}
      />
      {composer.handoff?.error ? (
        <InlineError detail={composer.handoff.error === 'HANDOFF_DELIVERY_UNCONFIRMED' ? undefined : composer.handoff.error}
          onRetry={() => void composer.handoff.retry()}
          retryLabel={t(composer.handoff.checking ? 'app.handoffCheckDelivery' : 'app.handoffRetry')}>
          {t(composer.handoff.error === 'HANDOFF_DELIVERY_UNCONFIRMED' ? 'app.handoffUnconfirmed' : 'app.handoffFailed')}
        </InlineError>
      ) : null}
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
        stopPending={composer.stopPending}
        attachButtonLabel={attachButtonLabel}
        primaryButtonDisabled={primaryButtonDisabled}
        primaryButtonDescription={primaryButtonDescription}
        transitionLabel={transitionLabel}
        handlePrimaryStop={handlePrimaryStop}
        handleAttachmentSelect={handleAttachmentSelect}
        handlePromptSend={handlePromptSend}
        selectedAgentDefinition={selectedAgentDefinition}
        selectedAgentCapability={selectedAgentCapability}
        activeAgentId={activeAgentId}
        setCurrentMode={setCurrentMode}
        currentSession={currentSession}
      />
    </div>}
    </div>
    </ComposerMenuRegistryProvider>
    </ComposerTurnControlsProvider>
  );
};
