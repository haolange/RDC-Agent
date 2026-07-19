import React, { useEffect, useMemo, useState } from 'react';
import type { RdxRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdxRuntime';
import { useI18n } from '../../../../i18n';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { ScopedResourceEditor } from './ScopedResourceEditor';
import { contentFromForm, emptyForm, formFromContent, resourceCardMeta, type ResourceFormState } from './scopedResourceForm';

const templateId = (kind: ScopedResourceKind): string => `new-${kind}`;

export const RuntimeScopePanel: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdxRuntimeOverview) => void;
  showResourceStrip?: boolean;
}> = ({ overview, scope, onScopeChange, kinds, onChanged, showResourceStrip = true }) => {
  const { t } = useI18n();
  const kind = kinds[0];
  const resources = useMemo(
    () => overview?.resources.filter((entry) => entry.scope === scope && kinds.includes(entry.kind)) ?? [],
    [overview, scope, kinds],
  );
  const canProject = Boolean(overview?.projectRoot);
  const addDisabled = scope === 'project' && !canProject;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<ResourceFormState>(() => emptyForm(kind, templateId(kind)));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScopedResourceDocument | null>(null);

  useEffect(() => {
    setSelectedId(null);
    setCreating(false);
    setForm(emptyForm(kind, templateId(kind)));
    setMessage('');
  }, [scope, kind]);

  const selected = resources.find((entry) => entry.id === selectedId) ?? null;
  const editing = creating || Boolean(selected);

  const openResource = (resource: ScopedResourceDocument) => {
    setCreating(false);
    setSelectedId(resource.id);
    setForm(formFromContent(resource.kind, resource.id, resource.content));
    setMessage('');
  };

  const startNew = () => {
    const nextId = templateId(kind);
    setCreating(true);
    setSelectedId(null);
    setForm(emptyForm(kind, nextId));
    setMessage('');
  };

  const patchForm = (patch: Partial<ResourceFormState>) => setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const request = {
        kind,
        scope,
        id: form.id,
        content: contentFromForm(kind, form),
        ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
      };
      const validation = await window.electronAPI.rdxRuntime.validateResource(request);
      if (!validation.valid) {
        setMessage(validation.diagnostics.join('\n'));
        return;
      }
      const next = await window.electronAPI.rdxRuntime.upsertResource(request);
      onChanged?.(next);
      setCreating(false);
      setSelectedId(safeIdPreview(form.id));
      const saved = next.resources.find((entry) => entry.scope === scope && entry.kind === kind && entry.id === safeIdPreview(form.id));
      if (saved) setForm(formFromContent(saved.kind, saved.id, saved.content));
      setMessage(t('settings.scopeSaved'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const target = pendingDelete;
    if (!target) return;
    setBusy(true);
    try {
      onChanged?.(await window.electronAPI.rdxRuntime.deleteResource(
        target.kind,
        target.scope,
        target.id,
        overview?.projectRoot,
      ));
      setSelectedId(null);
      setCreating(false);
      setForm(emptyForm(kind, templateId(kind)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const importResource = async () => {
    setBusy(true);
    setMessage('');
    try {
      const paths = await window.electronAPI.selectFiles();
      const filePath = paths?.[0];
      if (!filePath) return;
      const result = await window.electronAPI.rdxRuntime.importResource({
        kind,
        scope,
        filePath,
        ...(overview?.projectRoot ? { projectRoot: overview.projectRoot } : {}),
      });
      onChanged?.(result.overview);
      const imported = result.overview.resources.find((entry) => entry.scope === scope && entry.kind === kind && entry.id === result.id);
      if (imported) openResource(imported);
      setMessage(t('settings.scopeImported'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setCreating(false);
    if (selected) setForm(formFromContent(selected.kind, selected.id, selected.content));
    else {
      setSelectedId(null);
      setForm(emptyForm(kind, templateId(kind)));
    }
    setMessage('');
  };

  return (
    <section className="settings-runtime-scope" data-testid="settings-runtime-scope">
      <div className="settings-runtime-scope-head">
        <div className="settings-runtime-scope-switch settings-inline-pills" role="group" aria-label={t('settings.resourceScope')}>
          <button type="button" className={`user-menu-pill ${scope === 'user' ? 'active' : ''}`} onClick={() => onScopeChange('user')}>{t('settings.scopeUser')}</button>
          <button type="button" className={`user-menu-pill ${scope === 'project' ? 'active' : ''}`} disabled={!canProject} onClick={() => onScopeChange('project')}>{t('settings.scopeProject')}</button>
        </div>
      </div>

      {showResourceStrip ? (
        <div className="settings-runtime-scope-body settings-runtime-scope-body--split">
          <div className="settings-manifest-layout settings-runtime-manifest-layout">
            <div className="settings-manifest-list-column">
              <div className="settings-manifest-toolbar settings-manifest-list-toolbar">
                <div className="settings-manifest-actions">
                  <button type="button" className="button button-secondary" disabled={addDisabled || busy} onClick={() => void importResource()}>
                    {t('settings.scopeImport')}
                  </button>
                  <button type="button" className="button button-secondary" disabled={addDisabled || busy} onClick={startNew}>
                    {t('settings.scopeAdd', { kind })}
                  </button>
                </div>
              </div>
              <div className="settings-manifest-list" aria-label={t('settings.resourceScope')}>
                {resources.length ? resources.map((resource) => {
                  const meta = resourceCardMeta(resource.kind, resource.content);
                  const active = !creating && resource.id === selectedId;
                  return (
                    <button
                      type="button"
                      key={`${resource.kind}:${resource.id}`}
                      className={`settings-manifest-card ${active ? 'active' : ''} status-${resource.effectiveStatus}`}
                      onClick={() => openResource(resource)}
                    >
                      <span>
                        <strong>{resource.id}</strong>
                        {meta ? <small>{meta}</small> : null}
                      </span>
                    </button>
                  );
                }) : (
                  <div className="settings-empty settings-empty-dashed settings-runtime-list-empty">
                    {t('settings.scopeEmpty', { kind })}
                  </div>
                )}
              </div>
            </div>

            {editing ? (
              <ScopedResourceEditor
                kind={kind}
                form={form}
                idLocked={Boolean(selected?.sourcePath) && !creating}
                busy={busy}
                onChange={patchForm}
                onSave={() => void save()}
                onDelete={selected && !creating ? () => setPendingDelete(selected) : undefined}
                onCancel={cancelEdit}
              />
            ) : (
              <div className="settings-runtime-editor-placeholder settings-empty-dashed">
                {t('settings.scopeSelectOrCreate', { kind })}
              </div>
            )}
          </div>
          {message ? <div className="settings-runtime-result">{message}</div> : null}
        </div>
      ) : null}
      {pendingDelete ? (
        <ConfirmationDialog
          title={t('settings.scopeDeleteTitle')}
          message={t('settings.scopeDeleteConfirm', { id: pendingDelete.id })}
          confirmLabel={busy ? t('dialog.deleting') : t('dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          busy={busy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
        />
      ) : null}
    </section>
  );
};

const safeIdPreview = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || value;
