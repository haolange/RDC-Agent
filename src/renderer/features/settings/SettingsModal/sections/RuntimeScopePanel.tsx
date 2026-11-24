import React, { useEffect, useRef } from 'react';
import { cn } from '../../../../lib/cn';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { EmptyState } from '../../../../ui/EmptyState';
import { ListRow } from '../../../../ui/ListRow';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { UnsavedChangesDialog } from '../../../../ui/UnsavedChangesDialog';
import { ResourceListDetail, SettingsScopeBar } from '../parts';
import { ScopedResourceEditor } from './ScopedResourceEditor';
import { resourceDisplayName } from './scopedResourceForm';
import { useRuntimeScopePanel } from './useRuntimeScopePanel';
import { revealResourceLocation } from './runtimeScopeActions';
import type { RdcRuntimeOverview, ScopedResourceDocument, ScopedResourceKind } from '@shared/types/rdcRuntime';

const kindLabelKey = (kind: ScopedResourceKind): TranslationKey => `settings.kind.${kind}` as TranslationKey;

export interface RuntimeScopeListContext {
  resources: ScopedResourceDocument[];
  selectedId: string | null;
  select: (resource: ScopedResourceDocument) => void;
}

export interface RuntimeScopeDetailContext {
  resource: ScopedResourceDocument;
  /** Opens the task dialog editor for this resource. */
  edit: () => void;
}

export const RuntimeScopePanel: React.FC<{
  overview: RdcRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdcRuntimeOverview) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** `dialog` opens the editor as a task sub-dialog (MCP / Hook / Policy). */
  editorPresentation?: 'inline' | 'dialog';
  /** Extra toolbar controls placed after import / new / location. */
  toolbarExtra?: React.ReactNode;
  /** Trailing content for a list row (connection / trust badges). */
  renderRowTrailing?: (resource: ScopedResourceDocument) => React.ReactNode;
  /** A second line for a list row, in words (a hook's event). */
  rowDescription?: (resource: ScopedResourceDocument) => string | undefined;
  /** Replaces the default rows when a kind needs controls in the row itself (MCP switches). */
  renderList?: (context: RuntimeScopeListContext) => React.ReactNode;
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
  rowDescription,
  renderList,
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
  const showEmptyScope = panel.resources.length === 0 && (dialogMode || !panel.editing);
  const createActionRef = useRef<HTMLButtonElement>(null);
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
      {!showEmptyScope ? <>
      <Button variant="secondary" disabled={addDisabled || panel.busy} onClick={() => void panel.importResource()}>
        {t('settings.scopeImport')}
      </Button>
      <Button ref={createActionRef} variant="primary" disabled={addDisabled || panel.busy} onClick={panel.startNew}>
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
        <EmptyState variant="page" title={t('settings.scopeSelectOrCreate', { kind: kindLabel })} />
      </div>
    );
  })();

  return (
    <section className="settings-runtime-scope" data-testid="settings-runtime-scope" data-resource-kind={kind}>
      <ResourceListDetail
          testId="settings-resource-frame"
          emptyVariant={kind === 'skill' || kind === 'hook' ? 'panel' : 'inline'}
          isEmpty={showEmptyScope}
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
              <Button ref={createActionRef} variant="primary" size="sm" disabled={addDisabled || panel.busy} onClick={panel.startNew}>
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
          list={!panel.resources.length ? null : renderList ? renderList({
            resources: panel.resources,
            selectedId: panel.creating ? null : panel.selectedId,
            select: panel.openResource,
          }) : panel.resources.map((resource) => (
            <ListRow
              key={`${resource.kind}:${resource.id}`}
              className={cn('settings-scope-row', `status-${resource.effectiveStatus}`)}
              selected={!panel.creating && resource.id === panel.selectedId}
              description={rowDescription?.(resource)}
              onClick={() => {
                panel.openResource(resource);
                if (dialogMode && !renderDetail) panel.openDialogEditor();
              }}
              trailing={renderRowTrailing?.(resource)}
            >
              {resourceDisplayName(resource.kind, resource.id, resource.content)}
            </ListRow>
          ))}
          detail={detail}
        />

      {dialogMode ? (
        <TaskDialog
          open={dialogOpen}
          size={kind === 'policy' || kind === 'skill' ? 'lg' : 'md'}
          className={`settings-resource-dialog${kind === 'mcp' ? ' settings-mcp-dialog' : ''}${kind === 'policy' || kind === 'skill' || kind === 'agent' ? ' settings-document-dialog' : ''}`}
          title={panel.creating
            ? t('settings.scopeAdd', { kind: kindLabel })
            : t('settings.scopeEditTitle', { kind: kindLabel })}
          onClose={panel.closeDialogEditor}
          fallbackFocusRef={createActionRef}
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
