import React from 'react';
import { cn } from '../../../../lib/cn';
import type { RdxRuntimeOverview, ScopedResourceKind } from '@shared/types/rdxRuntime';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { ConfirmationDialog } from '../../../../ui/ConfirmationDialog';
import { EmptyState } from '../../../../ui/EmptyState';
import { ListRow } from '../../../../ui/ListRow';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { UnsavedChangesDialog } from '../../../../ui/UnsavedChangesDialog';
import { ResourceListDetail, SettingsScopeBar } from '../parts';
import { ScopedResourceEditor } from './ScopedResourceEditor';
import { resourceCardMeta } from './scopedResourceForm';
import { useRuntimeScopePanel } from './useRuntimeScopePanel';
import { revealResourceLocation } from './runtimeScopeActions';

const kindLabelKey = (kind: ScopedResourceKind): TranslationKey => `settings.kind.${kind}` as TranslationKey;

export const RuntimeScopePanel: React.FC<{
  overview: RdxRuntimeOverview | null;
  scope: 'user' | 'project';
  onScopeChange: (scope: 'user' | 'project') => void;
  kinds: ScopedResourceKind[];
  onChanged?: (overview: RdxRuntimeOverview) => void;
  showResourceStrip?: boolean;
  /** `dialog` opens the editor as a task sub-dialog (MCP / Hook / Policy). */
  editorPresentation?: 'inline' | 'dialog';
}> = ({
  overview,
  scope,
  onScopeChange,
  kinds,
  onChanged,
  showResourceStrip = true,
  editorPresentation = 'inline',
}) => {
  const { t } = useI18n();
  const kind = kinds[0];
  const kindLabel = t(kindLabelKey(kind));
  const canProject = Boolean(overview?.projectRoot);
  const addDisabled = scope === 'project' && !canProject;
  const panel = useRuntimeScopePanel({ overview, scope, kind, kinds, onChanged });

  const locationPath = scope === 'project'
    ? overview?.projectPaths?.[`${kind}sPath`] ?? overview?.projectRoot
    : overview?.userPaths?.[`${kind}sPath`] ?? overview?.userRoot;

  const editor = (
    <ScopedResourceEditor
      kind={kind}
      form={panel.form}
      idLocked={Boolean(panel.selected?.sourcePath) && !panel.creating}
      busy={panel.busy}
      dirty={panel.dirty}
      showHeader={editorPresentation === 'inline'}
      onChange={panel.patchForm}
      onSave={() => void panel.save()}
      onDelete={panel.selected && !panel.creating ? () => panel.setPendingDelete(panel.selected) : undefined}
      onCancel={panel.closeEditor}
    />
  );

  const actions = (
    <div className="settings-resource-toolbar-actions">
      <Button variant="secondary" disabled={addDisabled || panel.busy} onClick={() => void panel.importResource()}>
        {t('settings.scopeImport')}
      </Button>
      <Button variant="primary" disabled={addDisabled || panel.busy} onClick={panel.startNew}>
        {t('settings.scopeAdd', { kind: kindLabel })}
      </Button>
      {locationPath ? (
        <Button variant="ghost" onClick={() => void revealResourceLocation(locationPath)}>
          {t('settings.scopeResourceLocation')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <section className="settings-runtime-scope" data-testid="settings-runtime-scope" data-resource-kind={kind}>
      {showResourceStrip ? (
        <ResourceListDetail
          testId="settings-resource-frame"
          isEmpty={panel.resources.length === 0 && !panel.editing}
          emptyTitle={t('settings.scopeEmpty', { kind: kindLabel })}
          emptyDescription={t('settings.scopeEmptyHint')}
          status={panel.message || null}
          toolbar={(
            <>
              <SettingsScopeBar
                scope={scope}
                onScopeChange={(next) => onScopeChange(next)}
                canProject={canProject}
                userLabel={t('settings.scopeUser')}
                projectLabel={t('settings.scopeProject')}
                groupLabel={t('settings.resourceScope')}
              />
              {actions}
            </>
          )}
          list={panel.resources.length ? panel.resources.map((resource) => {
            const meta = resourceCardMeta(resource.kind, resource.content);
            return (
              <ListRow
                key={`${resource.kind}:${resource.id}`}
                className={cn('settings-scope-row', `status-${resource.effectiveStatus}`)}
                selected={!panel.creating && resource.id === panel.selectedId}
                onClick={() => panel.openResource(resource)}
              >
                <span className="settings-scope-row-copy">
                  <strong>{resource.id}</strong>
                  {meta ? <small>{meta}</small> : null}
                </span>
              </ListRow>
            );
          }) : (
            <EmptyState
              className="settings-runtime-list-empty"
              title={t('settings.scopeEmpty', { kind: kindLabel })}
            />
          )}
          detail={editorPresentation === 'inline' && panel.editing ? editor : (
            <div className="settings-runtime-editor-placeholder">
              <EmptyState title={t('settings.scopeSelectOrCreate', { kind: kindLabel })} />
            </div>
          )}
        />
      ) : null}

      {editorPresentation === 'dialog' ? (
        <TaskDialog
          open={panel.editing}
          size="md"
          title={panel.creating
            ? t('settings.scopeAdd', { kind: kindLabel })
            : t('settings.scopeEditTitle', { kind: kindLabel })}
          onClose={panel.closeEditor}
          closeLabel={t('settings.scopeCancel')}
          busy={panel.busy}
          dataTestId="settings-resource-dialog"
          footer={(
            <>
              {panel.dirty ? (
                <span className="task-dialog-footer-spacer">{t('settings.unsaved')}</span>
              ) : null}
              {panel.selected && !panel.creating ? (
                <Button
                  variant="danger"
                  disabled={panel.busy}
                  onClick={() => panel.setPendingDelete(panel.selected)}
                >
                  {t('settings.delete')}
                </Button>
              ) : null}
              <Button variant="ghost" disabled={panel.busy} onClick={panel.closeEditor}>
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
