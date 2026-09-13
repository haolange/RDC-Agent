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
import type { useRdxRuntimeOverview } from './useRdxRuntimeOverview';

type PageState = Pick<ReturnType<typeof useSettingsModal>,
  'activeSection' | 't' | 'accountDraft' | 'setAccountDraft' | 'handleAvatarSelect' |
  'handleAccountSave' | 'setLanguage' | 'globalInstructionsDraft' | 'setGlobalInstructionsDraft' | 'handleSavePersonalization' |
  'setTheme' | 'setFontScale' | 'setComposerMarkdown' | 'setUsePointerCursors' | 'setReduceMotion' |
  'setChromeTheme' | 'accountProviders' | 'providerCatalog' | 'providerCatalogCategories' | 'getResolvedProviderLabel' |
  'handleRefreshProviderModels' | 'handleDisconnectProvider' | 'openProviderConnection' | 'agentManifestDrafts' | 'setAgentManifestDrafts' |
  'handleSaveAgentManifests' | 'handleImportAgentManifest' | 'agentManifestSaveState' | 'agentManifestSaveMessage' | 'agentManifestSaveBlocked' |
  'rdxCliDraft' | 'codeInterpreterDraft' | 'shellDraft' | 'setRdxCliDraft' |
  'setCodeInterpreterDraft' | 'setShellDraft' | 'handleSaveToolsConfig' | 'dirty'>;
interface SettingsPageContentProps {
  modal: PageState;
  settings: AppSettings;
  runtime: Pick<ReturnType<typeof useRdxRuntimeOverview>, 'overview' | 'setOverview'>;
  resourceScope: 'user' | 'project';
  setResourceScope: (scope: 'user' | 'project') => void;
  onOpenResourceDiagnostics: () => void;
  setResourceDraftDirty: (dirty: boolean) => void;
}
export function SettingsPageContent({ modal, settings, runtime, resourceScope, setResourceScope,
  onOpenResourceDiagnostics, setResourceDraftDirty }: SettingsPageContentProps) {
  const {
    activeSection,
    t,
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
    setUsePointerCursors,
    setReduceMotion,
    setChromeTheme,
    accountProviders,
    providerCatalog,
    providerCatalogCategories,
    getResolvedProviderLabel,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    openProviderConnection,
    agentManifestDrafts,
    setAgentManifestDrafts,
    handleSaveAgentManifests,
    handleImportAgentManifest,
    agentManifestSaveState,
    agentManifestSaveMessage,
    agentManifestSaveBlocked,
    rdxCliDraft,
    codeInterpreterDraft,
    shellDraft,
    setRdxCliDraft,
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
        onOpenResourceDiagnostics={onOpenResourceDiagnostics}
        t={t}
      />
    )}

    {activeSection === 'appearance' && (
      <AppearanceSettings
        settings={settings}
        onThemeChange={setTheme}
        onFontScaleChange={setFontScale}
        onComposerMarkdownChange={setComposerMarkdown}
        onUsePointerCursorsChange={setUsePointerCursors}
        onReduceMotionChange={setReduceMotion}
        onChromeThemeChange={setChromeTheme}
        t={t}
      />
    )}

    {activeSection === 'models' && (
      <ModelsSettings
        accountProviders={accountProviders}
        providerCatalog={providerCatalog}
        providerCatalogCategories={providerCatalogCategories}
        getResolvedProviderLabel={getResolvedProviderLabel}
        onRefreshProviderModels={handleRefreshProviderModels}
        onDisconnectProvider={handleDisconnectProvider}
        onOpenProviderConnection={openProviderConnection}
        t={t}
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
        canProject={Boolean(runtime.overview?.projectRoot)}
        settings={settings}
        agentManifestDrafts={agentManifestDrafts}
        onAgentManifestDraftsChange={setAgentManifestDrafts}
        onRetrySaveAgentManifests={handleSaveAgentManifests}
        onImportAgentManifest={handleImportAgentManifest}
        agentManifestSaveState={agentManifestSaveState}
        agentManifestSaveMessage={agentManifestSaveMessage}
        agentManifestSaveBlocked={agentManifestSaveBlocked}
        t={t}
      /></section>
    )}

    {activeSection === 'tools' && (
      <section className="settings-page settings-page-tools" data-settings-search="tools">
      <header className="settings-section-header">
        <div>
          <div className="settings-section-title">{t('settings.mcpServicesTitle')}</div>
          <div className="settings-section-subtitle">{t('settings.mcpServicesHint')}</div>
        </div>
      </header>
      <McpServicesPanel overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} onChanged={runtime.setOverview} />
      <ToolsSettings
        rdxCliDraft={rdxCliDraft}
        codeInterpreterDraft={codeInterpreterDraft}
        shellDraft={shellDraft}
        onRdxCliDraftChange={setRdxCliDraft}
        onCodeInterpreterDraftChange={setCodeInterpreterDraft}
        onShellDraftChange={setShellDraft}
        onSaveToolsConfig={handleSaveToolsConfig}
        dirty={dirty.tools}
        t={t}
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
