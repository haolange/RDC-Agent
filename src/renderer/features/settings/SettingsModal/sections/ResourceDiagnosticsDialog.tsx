import React from 'react';
import type { RdxRuntimeOverview } from '@shared/types/rdxRuntime';
import type { TranslationKey, useI18n } from '../../../../i18n';
import { copyAppText, openAppPath } from '../../../../hooks/appShellBridge';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { TaskDialog } from '../../../../ui/TaskDialog';

type Translate = ReturnType<typeof useI18n>['t'];

const PATH_LABEL_KEYS: Record<string, TranslationKey> = {
  configPath: 'settings.configPath',
  instructionsPath: 'settings.instructionsPath',
  agentsPath: 'settings.agentsPath',
  skillsPath: 'settings.skillsPath',
  mcpPath: 'settings.mcpPath',
  hooksPath: 'settings.hooksPath',
  policiesPath: 'settings.policiesPath',
  knowledgePath: 'settings.knowledgePath',
  memoryPath: 'settings.memoryPath',
  projectMetadataPath: 'settings.projectMetadataPath',
  gitignorePath: 'settings.gitignorePath',
  inputsPath: 'settings.inputsPath',
  artifactsPath: 'settings.artifactsPath',
};

const ROOT_KEYS = new Set(['projectRoot', 'userRdxRoot', 'projectRdxRoot']);

const pathLabel = (t: Translate, key: string): string => {
  const labelKey = PATH_LABEL_KEYS[key];
  return labelKey ? t(labelKey) : key;
};

interface ResourceDiagnosticsDialogProps {
  open: boolean;
  overview: RdxRuntimeOverview | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  t: Translate;
}

/**
 * Read-only view of the local resource roots and the per-kind paths that are
 * currently in effect. Roots are never editable and nothing here migrates data.
 */
export const ResourceDiagnosticsDialog: React.FC<ResourceDiagnosticsDialogProps> = ({
  open,
  overview,
  loading,
  error,
  onClose,
  t,
}) => {
  const placeholder = loading ? t('settings.pathLoading') : t('settings.pathUnavailable');

  const rootRow = (label: string, value: string | undefined) => (
    <div className="settings-path-root" key={label}>
      <span className="settings-path-root-label">{label}</span>
      <code className="settings-path-root-value" title={value}>{value ?? placeholder}</code>
      <div className="settings-path-actions">
        <Button variant="ghost" size="sm" disabled={!value} onClick={() => value && void copyAppText(value)}>
          {t('settings.copy')}
        </Button>
        <Button variant="secondary" size="sm" disabled={!value} onClick={() => value && void openAppPath(value)}>
          {t('settings.reveal')}
        </Button>
      </div>
    </div>
  );

  const pathRows = (scopeLabel: string, paths: Record<string, string> | undefined) => {
    const entries = Object.entries(paths ?? {}).filter(([key]) => !ROOT_KEYS.has(key));
    if (entries.length === 0) return null;
    return (
      <div className="settings-path-group" key={scopeLabel}>
        <div className="settings-path-group-title">{scopeLabel}</div>
        <div className="settings-path-table" role="table">
          {entries.map(([key, value]) => (
            <div className="settings-path-row" role="row" key={key}>
              <span className="settings-path-name" role="cell">{pathLabel(t, key)}</span>
              <code className="settings-path-value" role="cell" title={value}>{value}</code>
              <span className="settings-path-row-actions" role="cell">
                <Button variant="ghost" size="sm" onClick={() => void copyAppText(value)}>
                  {t('settings.copy')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void openAppPath(value)}>
                  {t('settings.reveal')}
                </Button>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <TaskDialog
      open={open}
      size="lg"
      title={t('settings.resourceDiagnosticsTitle')}
      description={t('settings.resourceDiagnosticsDescription')}
      onClose={onClose}
      closeLabel={t('dialog.close')}
      dataTestId="settings-resource-diagnostics"
      footer={<Button variant="secondary" onClick={onClose}>{t('dialog.close')}</Button>}
    >
      <div className="settings-path-roots">
        {rootRow(t('settings.workspaceRuntimeRoot'), overview?.userRoot)}
        {rootRow(t('settings.workspaceProjectScope'), overview?.projectPaths?.projectRdxRoot)}
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      {pathRows(t('settings.workspaceUserScope'), overview?.userPaths)}
      {pathRows(t('settings.workspaceProjectPaths'), overview?.projectPaths)}
      <p className="settings-path-note">{t('settings.resourceDiagnosticsReadOnly')}</p>
    </TaskDialog>
  );
};
