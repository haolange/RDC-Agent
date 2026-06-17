import React from 'react';
import { Button } from '../../../ui/Button';
import {
  getDiffScope,
  getFileStatusLabel,
  useSourceControlPanel,
} from './useSourceControlPanel';

export const SourceControlPanel: React.FC = () => {
  const panel = useSourceControlPanel();
  const {
    t,
    status,
    files,
    selectedFile,
    diff,
    commitMessage,
    setCommitMessage,
    loading,
    diffLoading,
    busyPath,
    error,
    canCommit,
    branchMeta,
    selectPath,
    refreshStatus,
    goBack,
    stageAll,
    unstageAll,
    stageFile,
    unstageFile,
    commit,
  } = panel;

  return (
    <div className="control-panel source-control-panel">
      <div className="source-control-header">
        <div className="source-control-title-block">
          <div className="source-control-title">{t('control.sourceControl')}</div>
          <div className="source-control-branch" title={branchMeta}>{branchMeta}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={goBack}>
          {t('control.sourceControlBack')}
        </Button>
      </div>

      <div className="source-control-toolbar">
        <Button variant="secondary" size="sm" onClick={() => void refreshStatus()} disabled={loading || Boolean(busyPath)}>
          {t('control.sourceControlRefresh')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void stageAll()} disabled={!files.length || Boolean(busyPath)}>
          {t('control.sourceControlStageAll')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void unstageAll()} disabled={!status?.stagedCount || Boolean(busyPath)}>
          {t('control.sourceControlUnstageAll')}
        </Button>
      </div>

      {status ? (
        <div className="source-control-summary" aria-live="polite">
          <span>{status.clean ? t('control.sourceControlClean') : t('control.sourceControlStaged', { count: status.stagedCount })}</span>
          <span>{t('control.sourceControlUnstaged', { count: status.unstagedCount })}</span>
          <span>{t('control.sourceControlUntracked', { count: status.untrackedCount })}</span>
          {(status.ahead > 0 || status.behind > 0) ? (
            <span>{t('control.sourceControlAheadBehind', { ahead: status.ahead, behind: status.behind })}</span>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="source-control-error">{error}</div> : null}
      {loading ? <div className="source-control-empty">{t('control.sourceControlLoading')}</div> : null}
      {!loading && status?.clean ? <div className="source-control-empty">{t('control.sourceControlClean')}</div> : null}

      {!loading && files.length > 0 ? (
        <div className="source-control-grid">
          <div className="source-control-files" role="list">
            {files.map((file) => {
              const isSelected = selectedFile?.path === file.path;
              return (
                <div className={`source-control-file ${isSelected ? 'is-selected' : ''}`} key={`${file.indexStatus}:${file.workingTreeStatus}:${file.path}`} role="listitem">
                  <button type="button" className="source-control-file-main" onClick={() => selectPath(file.path)} title={file.path}>
                    <span className={`source-control-file-kind kind-${file.kind}`}>{getFileStatusLabel(file)}</span>
                    <span className="source-control-file-path">
                      {file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}
                    </span>
                  </button>
                  <div className="source-control-file-actions">
                    {file.unstaged ? (
                      <Button variant="ghost" size="sm" onClick={() => void stageFile(file)} disabled={Boolean(busyPath)}>+</Button>
                    ) : null}
                    {file.staged ? (
                      <Button variant="ghost" size="sm" onClick={() => void unstageFile(file)} disabled={Boolean(busyPath)}>-</Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="source-control-diff">
            <div className="source-control-diff-title">
              <span>{selectedFile?.path ?? t('control.sourceControlNoDiff')}</span>
              {selectedFile ? <span>{getDiffScope(selectedFile) ? 'staged' : 'working tree'}</span> : null}
            </div>
            <pre className="source-control-diff-body">
              {diffLoading
                ? t('control.sourceControlLoading')
                : diff.success
                  ? diff.patch || diff.stat || t('control.sourceControlNoDiff')
                  : diff.error || t('control.sourceControlNoDiff')}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="source-control-commit">
        <textarea
          className="source-control-commit-input"
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder={t('control.sourceControlMessagePlaceholder')}
          disabled={!status?.stagedCount || Boolean(busyPath)}
          rows={3}
        />
        <Button variant="primary" size="sm" onClick={() => void commit()} disabled={!canCommit}>
          {t('control.sourceControlCommit')}
        </Button>
      </div>
    </div>
  );
};

export default SourceControlPanel;
