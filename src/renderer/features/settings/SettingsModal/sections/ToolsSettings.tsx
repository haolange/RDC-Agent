import React, { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { AgentRuntimeMcpDescriptor, AgentRuntimeMcpWriteRequest } from '@shared/types/agentRuntime';
import type { MCPTransport } from '@shared/types/mcp';
import type { AppSettings, RdxActionSettingsMap, RdxCliInvokerSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { AutosizeTextarea } from '../AutosizeTextarea';
import { RdxCliInvokerSettingsFields } from './RdxCliInvokerSettingsFields';

type Translate = ReturnType<typeof useI18n>['t'];

interface ToolsSettingsProps {
  settings: AppSettings;
  enabledMcpDrafts: string[];
  rdxCliDraft: RdxCliInvokerSettings;
  rdxActionsDraft: RdxActionSettingsMap;
  onEnabledMcpDraftsChange: Dispatch<SetStateAction<string[]>>;
  onRdxCliDraftChange: Dispatch<SetStateAction<RdxCliInvokerSettings>>;
  onRdxActionsDraftChange: Dispatch<SetStateAction<RdxActionSettingsMap>>;
  onSaveToolsConfig: () => void | Promise<void>;
  onUpsertMcpServer: (request: AgentRuntimeMcpWriteRequest) => Promise<AppSettings>;
  onDeleteMcpServer: (serverId: string) => Promise<AppSettings>;
  onImportMcpServer: () => Promise<AppSettings>;
  toggleRuntimeId: (values: string[], id: string) => string[];
  t: Translate;
}

interface McpEditorDraft {
  previousId?: string;
  id: string;
  name: string;
  description: string;
  transport: MCPTransport;
  command: string;
  argsText: string;
  url: string;
  envText: string;
}

const toSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-mcp';

const createNewMcpDraft = (servers: AgentRuntimeMcpDescriptor[]): McpEditorDraft => {
  const existing = new Set(servers.map((server) => server.id));
  let index = 1;
  let id = 'custom-mcp';
  while (existing.has(id)) {
    index += 1;
    id = `custom-mcp-${index}`;
  }
  return { id, name: 'Custom MCP', description: '', transport: 'stdio', command: '', argsText: '', url: '', envText: '' };
};

const editDraftFromServer = (server: AgentRuntimeMcpDescriptor): McpEditorDraft => ({
  previousId: server.id,
  id: server.id,
  name: server.name,
  description: server.description,
  transport: server.transport,
  command: server.command ?? '',
  argsText: (server.args ?? []).join('\n'),
  url: server.url ?? '',
  envText: Object.entries(server.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
});

const envTextToRecord = (value: string): Record<string, string> =>
  Object.fromEntries(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return separator === -1 ? [line, ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }).filter(([key]) => Boolean(key)));

const ToolIcon: React.FC<{ kind: 'edit' | 'delete' | 'import' | 'add' }> = ({ kind }) => {
  const content = kind === 'edit'
    ? <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM13.5 6.5l3 3" />
    : kind === 'delete'
      ? <><path d="M5 7h14" /><path d="M10 11v6M14 11v6" /><path d="M9 7l1-2h4l1 2" /><path d="M7 7l1 13h8l1-13" /></>
      : kind === 'import'
        ? <><path d="M12 3v12" /><path d="m8 7 4-4 4 4" /><path d="M5 15v4h14v-4" /></>
        : <><path d="M12 5v14" /><path d="M5 12h14" /></>;
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
};

export const ToolsSettings: React.FC<ToolsSettingsProps> = ({
  settings,
  enabledMcpDrafts,
  rdxCliDraft,
  rdxActionsDraft,
  onEnabledMcpDraftsChange,
  onRdxCliDraftChange,
  onRdxActionsDraftChange,
  onSaveToolsConfig,
  onUpsertMcpServer,
  onDeleteMcpServer,
  onImportMcpServer,
  toggleRuntimeId,
  t,
}) => {
  const [editorDraft, setEditorDraft] = useState<McpEditorDraft | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState('');
  const [status, setStatus] = useState('');
  const servers = settings.configuration.availableMcpServers;
  const enabledIds = useMemo(() => new Set(enabledMcpDrafts), [enabledMcpDrafts]);

  const runAction = async (action: () => Promise<AppSettings> | Promise<void>, message: string) => {
    setStatus(t('settings.saving'));
    await action();
    setStatus(message);
  };

  const saveEditor = async () => {
    if (!editorDraft) return;
    await runAction(() => onUpsertMcpServer({
      previousId: editorDraft.previousId,
      id: toSlug(editorDraft.id),
      name: editorDraft.name,
      description: editorDraft.description,
      transport: editorDraft.transport,
      command: editorDraft.command,
      args: editorDraft.argsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      url: editorDraft.url,
      env: envTextToRecord(editorDraft.envText),
      enabledByDefault: true,
    }), t('settings.mcpSaved'));
    setEditorDraft(null);
  };

  return (
    <section className="settings-page settings-page-tools">
      <div className="settings-tools-card-stack">
        <div className="settings-browser-block settings-tool-card" data-testid="settings-mcp-block">
          <div className="settings-browser-section-head">
            <div>
              <div className="settings-browser-section-title">{t('settings.mcp')}</div>
              <div className="settings-help-text">{t('settings.mcpRealHint')}</div>
            </div>
            <div className="settings-browser-actions">
              <button type="button" className="button button-secondary" onClick={() => void runAction(onImportMcpServer, t('settings.mcpImported'))}>
                <ToolIcon kind="import" />{t('settings.importMcp')}
              </button>
              <button type="button" className="button button-secondary" onClick={() => setEditorDraft(createNewMcpDraft(servers))}>
                <ToolIcon kind="add" />{t('settings.newMcp')}
              </button>
            </div>
          </div>
          <div className="settings-row-list">
            {servers.map((server) => {
              const enabled = enabledIds.has(server.id);
              const isPendingDelete = pendingDeleteId === server.id;
              return (
                <div key={server.id} className={`settings-managed-row ${enabled ? 'active' : ''}`} data-testid={`settings-mcp-${server.id}`}>
                  <button type="button" className={`settings-row-toggle ${enabled ? 'active' : ''}`} onClick={() => onEnabledMcpDraftsChange((current) => toggleRuntimeId(current, server.id))} aria-label={enabled ? t('settings.disableMcp') : t('settings.enableMcp')} />
                  <div className="settings-managed-row-main" data-tooltip={server.description || server.name} title={server.description || server.name}>
                    <strong>{server.name}</strong>
                    <span>{server.description || server.id}</span>
                  </div>
                  <span className="settings-row-badge">{server.transport}</span>
                  <div className="settings-row-actions">
                    <button type="button" className="button button-ghost settings-icon-button" onClick={() => setEditorDraft(editDraftFromServer(server))} aria-label={t('settings.edit')}><ToolIcon kind="edit" /></button>
                    <button type="button" className={`button ${isPendingDelete ? 'button-danger' : 'button-ghost'} settings-icon-button`} onClick={() => {
                      if (!isPendingDelete) {
                        setPendingDeleteId(server.id);
                        return;
                      }
                      void runAction(() => onDeleteMcpServer(server.id), t('settings.mcpDeleted'));
                      setPendingDeleteId('');
                    }} aria-label={t('settings.delete')}><ToolIcon kind="delete" /></button>
                  </div>
                </div>
              );
            })}
            {servers.length === 0 && <div className="settings-browser-empty"><strong>{t('settings.noMcpConfigured')}</strong><span>{t('settings.noMcpConfiguredHint')}</span></div>}
          </div>
        </div>

        <div className="settings-browser-block settings-tool-card" data-testid="settings-rdx-block">
          <RdxCliInvokerSettingsFields rdxCliDraft={rdxCliDraft} rdxActionsDraft={rdxActionsDraft} onRdxCliDraftChange={onRdxCliDraftChange} onRdxActionsDraftChange={onRdxActionsDraftChange} t={t} />
        </div>
      </div>

      {editorDraft && (
        <div className="settings-editor-dialog-backdrop" data-testid="settings-mcp-editor">
          <div className="settings-editor-dialog" role="dialog" aria-modal="true" aria-label={editorDraft.previousId ? t('settings.editMcp') : t('settings.newMcp')}>
            <div className="settings-editor-dialog-head">
              <strong>{editorDraft.previousId ? t('settings.editMcp') : t('settings.newMcp')}</strong>
              <button type="button" className="button button-ghost settings-icon-button" onClick={() => setEditorDraft(null)} aria-label={t('settings.cancel')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="settings-editor-dialog-body scrollbar-thin">
              <div className="settings-mcp-editor-grid">
                <label className="settings-field"><span className="settings-field-label">ID</span><input className="input" value={editorDraft.id} onChange={(event) => setEditorDraft({ ...editorDraft, id: event.currentTarget.value })} /></label>
                <label className="settings-field"><span className="settings-field-label">{t('settings.agentName')}</span><input className="input" value={editorDraft.name} onChange={(event) => setEditorDraft({ ...editorDraft, name: event.currentTarget.value })} /></label>
                <label className="settings-field"><span className="settings-field-label">Transport</span><select className="input" value={editorDraft.transport} onChange={(event) => setEditorDraft({ ...editorDraft, transport: event.currentTarget.value as MCPTransport })}><option value="stdio">stdio</option><option value="sse">sse</option><option value="streamable-http">streamable-http</option></select></label>
                <label className="settings-field"><span className="settings-field-label">{t('settings.rdxActionCommand')}</span><input className="input" value={editorDraft.command} onChange={(event) => setEditorDraft({ ...editorDraft, command: event.currentTarget.value })} /></label>
              </div>
              <label className="settings-field"><span className="settings-field-label">{t('settings.agentDescription')}</span><input className="input" value={editorDraft.description} onChange={(event) => setEditorDraft({ ...editorDraft, description: event.currentTarget.value })} /></label>
              <div className="settings-mcp-editor-grid settings-mcp-editor-grid--wide">
                <label className="settings-field"><span className="settings-field-label">URL</span><input className="input" value={editorDraft.url} onChange={(event) => setEditorDraft({ ...editorDraft, url: event.currentTarget.value })} /></label>
                <label className="settings-field"><span className="settings-field-label">{t('settings.rdxActionArguments')}</span><AutosizeTextarea maxHeight={180} className="input settings-code-textarea" value={editorDraft.argsText} onChange={(event) => setEditorDraft({ ...editorDraft, argsText: event.currentTarget.value })} /></label>
                <label className="settings-field"><span className="settings-field-label">{t('settings.rdxActionEnvironment')}</span><AutosizeTextarea maxHeight={180} className="input settings-code-textarea" value={editorDraft.envText} onChange={(event) => setEditorDraft({ ...editorDraft, envText: event.currentTarget.value })} /></label>
              </div>
            </div>
            <div className="settings-actions settings-editor-dialog-actions">
              <button type="button" className="button button-secondary" onClick={() => setEditorDraft(null)}>{t('settings.cancel')}</button>
              <button type="button" className="button button-primary" onClick={() => void saveEditor()}>{t('settings.save')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="settings-actions settings-actions-split">
        <span className="settings-save-status">{status}</span>
        <button type="button" className="button button-primary" onClick={() => void runAction(async () => { await onSaveToolsConfig(); }, t('settings.toolsSaved'))}>{t('settings.saveTools')}</button>
      </div>
    </section>
  );
};
