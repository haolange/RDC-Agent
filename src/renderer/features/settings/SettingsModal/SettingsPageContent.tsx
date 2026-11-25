import { GeneralSettings } from './sections/GeneralSettings';
import { AppearanceSettings } from './sections/AppearanceSettings';
import { ModelsSettings } from './sections/ModelsSettings';
import { AgentsSettings } from './sections/AgentsSettings';
import { ToolsSettings } from './sections/ToolsSettings';
import { McpServicesPanel } from './sections/McpServicesPanel';
import { RuntimeScopePanel } from './sections/RuntimeScopePanel';
import { HooksSettings } from './sections/HooksSettings';
import { PolicySettings } from './sections/PolicySettings';
import type { AppSettings } from '@shared/types/settings';
import type { useSettingsModal } from './useSettingsModal';
import type { useRdcRuntimeOverview } from './useRdcRuntimeOverview';

type PageState = Pick<ReturnType<typeof useSettingsModal>,
  'activeSection' | 't' | 'currentProjectId' | 'accountDraft' | 'setAccountDraft' | 'handleAvatarSelect' |
  'handleAccountSave' | 'setLanguage' | 'globalInstructionsDraft' | 'setGlobalInstructionsDraft' | 'handleSavePersonalization' |
  'setTheme' | 'setFontScale' | 'setComposerMarkdown' |
  'setChromeTheme' | 'accountProviders' | 'providerCatalog' | 'providerCatalogCategories' | 'getResolvedProviderLabel' |
  'openProviderConnection' | 'handleDisconnectProvider' | 'agentManifestDrafts' | 'setAgentManifestDrafts' | 'agentManifestContextReady' |
  'handleSaveAgentManifests' | 'handleImportAgentManifest' | 'agentManifestSaveState' | 'agentManifestSaveMessage' | 'agentManifestSaveBlocked' |
  'handleAgentModelOps' | 'previewAgentModelMigration' | 'handleCommitAgentOverrideFile' | 'loadAgentBuiltinComparison' |
  'previewProjectAgentTrust' | 'handleTrustProjectAgent' |
  'rdcCliDraft' | 'codeInterpreterDraft' | 'shellDraft' | 'setRdcCliDraft' |
  'setCodeInterpreterDraft' | 'setShellDraft' | 'handleSaveToolsConfig' | 'dirty'>;
interface SettingsPageContentProps {
  modal: PageState;
  settings: AppSettings;
  runtime: Pick<ReturnType<typeof useRdcRuntimeOverview>, 'overview' | 'setOverview'>;
  resourceScope: 'user' | 'project';
  setResourceScope: (scope: 'user' | 'project') => void;
  setResourceDraftDirty: (dirty: boolean) => void;
}
export function SettingsPageContent({ modal, settings, runtime, resourceScope, setResourceScope,
  setResourceDraftDirty }: SettingsPageContentProps) {
  const {
    activeSection,
    t,
    currentProjectId,
    accountDraft,
    setAccountDraft,
    handleAvatarSelect,
    handleAccountSave,
    setLanguage,
    globalInstructionsDraft,
    setGlobalInstructionsDraft,
    handleSavePersonalization,
    setTheme,
    setFontScale,
    setComposerMarkdown,
    setChromeTheme,
    accountProviders,
    providerCatalog,
    providerCatalogCategories,
    getResolvedProviderLabel,
    openProviderConnection,
    handleDisconnectProvider,
    agentManifestDrafts,
    agentManifestContextReady,
    setAgentManifestDrafts,
    handleSaveAgentManifests,
    handleImportAgentManifest,
    agentManifestSaveState,
    agentManifestSaveMessage,
    agentManifestSaveBlocked,
    handleAgentModelOps,
    previewAgentModelMigration,
    handleCommitAgentOverrideFile,
    previewProjectAgentTrust,
    handleTrustProjectAgent,
    loadAgentBuiltinComparison,
    rdcCliDraft,
    codeInterpreterDraft,
    shellDraft,
    setRdcCliDraft,
    setCodeInterpreterDraft,
    setShellDraft,
    handleSaveToolsConfig,
    dirty,
  } = modal;
  return <>
    {activeSection === 'general' && (
      <GeneralSettings
        settings={settings}
        accountDraft={accountDraft}
        onAccountDraftChange={setAccountDraft}
        onAvatarSelect={handleAvatarSelect}
        onAccountSave={handleAccountSave}
        onLanguageChange={setLanguage}
        globalInstructionsDraft={globalInstructionsDraft}
        onGlobalInstructionsDraftChange={setGlobalInstructionsDraft}
        onSavePersonalization={handleSavePersonalization}
      />
    )}

    {activeSection === 'appearance' && (
      <AppearanceSettings
        settings={settings}
        onThemeChange={setTheme}
        onFontScaleChange={setFontScale}
        onComposerMarkdownChange={setComposerMarkdown}
        onChromeThemeChange={setChromeTheme}
      />
    )}

    {activeSection === 'models' && (
      <ModelsSettings
        accountProviders={accountProviders}
        providerCatalog={providerCatalog}
        providerCatalogCategories={providerCatalogCategories}
        getResolvedProviderLabel={getResolvedProviderLabel}
        onDisconnectProvider={handleDisconnectProvider}
        onOpenProviderConnection={openProviderConnection}
      />
    )}

    {activeSection === 'skills' && (
      <section className="settings-page settings-page-skills" data-settings-search="skills">
        <RuntimeScopePanel overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} kinds={['skill']} onChanged={runtime.setOverview} onDirtyChange={setResourceDraftDirty} />
      </section>
    )}

    {activeSection === 'agents' && (
      <section className="settings-page settings-page-agents" data-settings-search="agents">
      <AgentsSettings
        canProject={Boolean(currentProjectId && runtime.overview?.projectRoot)}
        currentProjectId={currentProjectId}
        settings={settings}
        agentManifestDrafts={agentManifestDrafts}
        agentManifestContextReady={agentManifestContextReady}
        onAgentManifestDraftsChange={setAgentManifestDrafts}
        onRetrySaveAgentManifests={handleSaveAgentManifests}
        onImportAgentManifest={handleImportAgentManifest}
        agentManifestSaveState={agentManifestSaveState}
        agentManifestSaveMessage={agentManifestSaveMessage}
        agentManifestSaveBlocked={agentManifestSaveBlocked}
        onAgentModelOps={handleAgentModelOps}
        onPreviewAgentModelMigration={previewAgentModelMigration}
        onCommitAgentOverrideFile={handleCommitAgentOverrideFile}
        onPreviewProjectAgentTrust={previewProjectAgentTrust}
        onTrustProjectAgent={handleTrustProjectAgent}
        onLoadAgentBuiltinComparison={loadAgentBuiltinComparison}
      /></section>
    )}

    {activeSection === 'tools' && (
      <section className="settings-page settings-page-tools" data-settings-search="tools">
      <header className="settings-section-header">
        <div className="settings-section-title">{t('settings.mcpServicesTitle')}</div>
        <p className="settings-section-description">{t('settings.mcpServicesHint')}</p>
      </header>
      <McpServicesPanel overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} onChanged={runtime.setOverview} />
      <ToolsSettings
        rdcCliDraft={rdcCliDraft}
        codeInterpreterDraft={codeInterpreterDraft}
        shellDraft={shellDraft}
        onRdcCliDraftChange={setRdcCliDraft}
        onCodeInterpreterDraftChange={setCodeInterpreterDraft}
        onShellDraftChange={setShellDraft}
        onSaveToolsConfig={handleSaveToolsConfig}
        dirty={dirty.tools}
      /></section>
    )}

    {activeSection === 'hooks' && (
      <HooksSettings overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} onChanged={runtime.setOverview} />
    )}

    {activeSection === 'policy' && (
      <PolicySettings overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} onChanged={runtime.setOverview} />
    )}
  </>;
}
