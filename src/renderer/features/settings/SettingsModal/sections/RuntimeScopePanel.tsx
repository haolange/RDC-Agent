import React, { useEffect } from 'react';
import { cn } from '../../../../lib/cn';
import type { RdxRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdxRuntime';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { EmptyState } from '../../../../ui/EmptyState';
import { ListRow } from '../../../../ui/ListRow';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { UnsavedChangesDialog } from '../../../../ui/UnsavedChangesDialog';
import { ResourceListDetail, SettingsScopeBar } from '../parts';
import { ScopedResourceEditor } from './ScopedResourceEditor';
import { McpResourceTable } from './McpResourceTable';
import { resourceCardMeta } from './scopedResourceForm';
import { useRuntimeScopePanel } from './useRuntimeScopePanel';
import { revealResourceLocation } from './runtimeScopeActions';

const kindLabelKey = (kind: ScopedResourceKind): TranslationKey => `settings.kind.${kind}` as TranslationKey;

export interface RuntimeScopeDetailContext {
  resource: ScopedResourceDocument;
  /** Opens the task dialog editor for this resource. */
  edit: () => void;
}

export const RuntimeScopePanel: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdxRuntimeOverview) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** `dialog` opens the editor as a task sub-dialog (MCP / Hook / Policy). */
  editorPresentation?: 'inline' | 'dialog';
  /** Extra toolbar controls placed after import / new / location. */
  toolbarExtra?: React.ReactNode;
  /** Trailing content for a list row (connection / trust badges). */
  renderRowTrailing?: (resource: ScopedResourceDocument) => React.ReactNode;
  /** Read-only detail for the selected resource when the editor lives in a dialog. */
  renderDetail?: (context: RuntimeScopeDetailContext) => React.ReactNode;
  /** Description for the empty state below the default hint. */
  emptyDescriptionExtra?: React.ReactNode;
}> = ({
  overview,
  scope,
  onScopeChange,
  kinds,
  onChanged,
  onDirtyChange,
  editorPresentation = 'inline',
  toolbarExtra,
  renderRowTrailing,
  renderDetail,
  emptyDescriptionExtra,
}) => {
  const { t } = useI18n();
  const kind = kinds[0];
  const kindLabel = t(kindLabelKey(kind));
  const canProject = Boolean(overview?.projectRoot);
  const addDisabled = scope === 'project' && !canProject;
  const panel = useRuntimeScopePanel({ overview, scope, kind, kinds, onChanged });
  useEffect(() => {
    onDirtyChange?.(panel.dirty);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange, panel.dirty]);
  const dialogMode = editorPresentation === 'dialog';
  // In dialog mode the selection also drives the read-only detail; the dialog only opens on explicit edit.
  const dialogOpen = dialogMode && (panel.creating || panel.dialogEditing);

  const locationPath = scope === 'project'
    ? overview?.projectPaths?.[`${kind}sPath`] ?? overview?.projectRoot
    : overview?.userPaths?.[`${kind}sPath`] ?? overview?.userRoot;

  const editor = (
    <ScopedResourceEditor
      kind={kind}
      scope={scope}
      form={panel.form}
      idLocked={Boolean(panel.selected?.sourcePath) && !panel.creating}
      busy={panel.busy}
      dirty={panel.dirty}
      message={dialogMode ? panel.message : null}
      showHeader={!dialogMode}
      onChange={panel.patchForm}
      onSave={() => void panel.save()}
      onDelete={panel.selected && !panel.creating ? () => panel.setPendingDelete(panel.selected) : undefined}
      onCancel={panel.closeEditor}
    />
  );

  const actions = (
    <div className="settings-resource-toolbar-actions">
      {panel.resources.length > 0 || panel.editing ? <>
      <Button variant="secondary" disabled={addDisabled || panel.busy} onClick={() => void panel.importResource()}>
        {t('settings.scopeImport')}
      </Button>
      <Button variant="primary" disabled={addDisabled || panel.busy} onClick={panel.startNew}>
        {t('settings.scopeAdd', { kind: kindLabel })}
      </Button>
      </> : null}
      {locationPath ? (
        <Button variant="ghost" onClick={() => void revealResourceLocation(locationPath)}>
          {t('settings.scopeResourceLocation')}
        </Button>
      ) : null}
      {toolbarExtra}
    </div>
  );

  const detail = (() => {
    if (!dialogMode && panel.editing) return editor;
    if (dialogMode && panel.selected && renderDetail) {
      return renderDetail({ resource: panel.selected, edit: panel.openDialogEditor });
    }
    if (kind === 'mcp') return null;
    return (
      <div className="settings-runtime-editor-placeholder">
        <EmptyState title={t('settings.scopeSelectOrCreate', { kind: kindLabel })} />
      </div>
    );
  })();

  return (
    <section className="settings-runtime-scope" data-testid="settings-runtime-scope" data-resource-kind={kind}>
      <ResourceListDetail
          testId="settings-resource-frame"
          isEmpty={panel.resources.length === 0 && !panel.editing}
          emptyTitle={t('settings.scopeEmpty', { kind: kindLabel })}
          emptyDescription={emptyDescriptionExtra ? (
            <>
              {t('settings.scopeEmptyHint')}
              <br />
              {emptyDescriptionExtra}
            </>
          ) : t('settings.scopeEmptyHint')}
          emptyActions={(
            <>
              <Button variant="primary" size="sm" disabled={addDisabled || panel.busy} onClick={panel.startNew}>
                {t('settings.scopeAdd', { kind: kindLabel })}
              </Button>
              <Button variant="secondary" size="sm" disabled={addDisabled || panel.busy} onClick={() => void panel.importResource()}>
                {t('settings.scopeImport')}
              </Button>
            </>
          )}
          status={dialogMode && dialogOpen ? null : (panel.message || null)}
          toolbar={(
            <>
              <SettingsScopeBar
                scope={scope}
                onScopeChange={(next) => panel.guard(() => onScopeChange(next))}
                canProject={canProject}
                userLabel={t('settings.scopeUser')}
                projectLabel={t('settings.scopeProject')}
                groupLabel={t('settings.resourceScope')}
              />
              {actions}
            </>
          )}
          list={kind === 'mcp' && panel.resources.length ? (
            <McpResourceTable
              resources={panel.resources}
              selectedId={panel.creating ? null : panel.selectedId}
              onSelect={panel.openResource}
              onEdit={(resource) => {
                panel.openResource(resource);
                panel.openDialogEditor();
              }}
              renderStatus={renderRowTrailing}
            />
          ) : panel.resources.length ? panel.resources.map((resource) => {
            const meta = resourceCardMeta(resource.kind, resource.content);
            return (
              <ListRow
                key={`${resource.kind}:${resource.id}`}
                className={cn('settings-scope-row', `status-${resource.effectiveStatus}`)}
                selected={!panel.creating && resource.id === panel.selectedId}
                onClick={() => {
                  panel.openResource(resource);
                  if (dialogMode && !renderDetail) panel.openDialogEditor();
                }}
                trailing={renderRowTrailing?.(resource)}
              >
                <span className="settings-scope-row-copy">
                  <strong>{resource.id}</strong>
                  {meta ? <small>{meta}</small> : null}
                </span>
              </ListRow>
            );
          }) : null}
          detail={detail}
        />

      {dialogMode ? (
        <TaskDialog
          open={dialogOpen}
          size="md"
          className={`settings-resource-dialog${kind === 'mcp' ? ' settings-mcp-dialog' : ''}`}
          title={panel.creating
            ? t('settings.scopeAdd', { kind: kindLabel })
            : t('settings.scopeEditTitle', { kind: kindLabel })}
          onClose={panel.closeDialogEditor}
          closeLabel={t('settings.scopeCancel')}
          busy={panel.busy}
          dataTestId="settings-resource-dialog"
          footer={(
            <>
              <span className="task-dialog-footer-spacer settings-runtime-dialog-status" data-testid="settings-resource-dialog-status">
                {panel.dirty ? t('settings.unsaved') : null}
              </span>
              {panel.selected && !panel.creating ? (
                <Button
                  variant="danger"
                  disabled={panel.busy}
                  onClick={() => panel.setPendingDelete(panel.selected)}
                >
                  {t('settings.delete')}
                </Button>
              ) : null}
              <Button variant="ghost" disabled={panel.busy} onClick={panel.closeDialogEditor}>
                {t('settings.scopeCancel')}
              </Button>
              <Button variant="primary" disabled={panel.busy} onClick={() => void panel.save()}>
                {t('settings.scopeSave')}
              </Button>
            </>
          )}
        >
          {editor}
        </TaskDialog>
      ) : null}

      {panel.pendingDelete ? (
        <ConfirmationDialog
          title={t('settings.scopeDeleteTitle')}
          message={`${t('settings.scopeDeleteConfirm', { id: panel.pendingDelete.id })}\n${t('settings.scopeDeleteImpact')}`}
          details={[
            { label: t('settings.scopeDeleteName', { kind: kindLabel }), value: panel.pendingDelete.id },
            {
              label: t('settings.resourceScope'),
              value: panel.pendingDelete.scope === 'project' ? t('settings.scopeProject') : t('settings.scopeUser'),
            },
          ]}
          confirmLabel={panel.busy ? t('dialog.deleting') : t('dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          busy={panel.busy}
          onCancel={() => panel.setPendingDelete(null)}
          onConfirm={panel.remove}
        />
      ) : null}

      {panel.pendingDiscard ? (
        <UnsavedChangesDialog
          title={t('settings.unsavedExitTitle')}
          message={t('settings.unsavedExitMessage')}
          keepEditingLabel={t('settings.keepEditing')}
          discardLabel={t('settings.discardChanges')}
          onKeepEditing={() => panel.resolveDiscard(false)}
          onDiscard={() => panel.resolveDiscard(true)}
        />
      ) : null}
    </section>
  );
};
