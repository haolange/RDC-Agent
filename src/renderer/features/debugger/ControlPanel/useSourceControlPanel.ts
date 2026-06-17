import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitActionResult, GitDiffResult, GitStatusFile, GitStatusSummary } from '@shared/types/git';
import { useI18n } from '../../../i18n';
import { useProjectStore } from '../../../stores/projectStore';

export const EMPTY_DIFF: GitDiffResult = {
  success: true,
  patch: '',
  stat: '',
  truncated: false,
};

export function getFileStatusLabel(file: GitStatusFile): string {
  const staged = file.indexStatus || ' ';
  const unstaged = file.workingTreeStatus || ' ';
  return `${staged}${unstaged}`;
}

export function getDiffScope(file: GitStatusFile): boolean {
  return file.staged && !file.unstaged;
}

export function useSourceControlPanel() {
  const { t } = useI18n();
  const currentProject = useProjectStore((state) => state.currentProject);
  const setRightRailTarget = useProjectStore((state) => state.setRightRailTarget);
  const [status, setStatus] = useState<GitStatusSummary | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<GitDiffResult>(EMPTY_DIFF);
  const [commitMessage, setCommitMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const files = status?.files ?? [];
  const selectedFile = useMemo(
    () => files.find((file) => file.path === selectedPath) ?? files[0] ?? null,
    [files, selectedPath],
  );

  const setNextStatus = useCallback((nextStatus: GitStatusSummary) => {
    setStatus(nextStatus);
    setSelectedPath((current) => {
      if (current && nextStatus.files.some((file) => file.path === current)) {
        return current;
      }
      return nextStatus.files[0]?.path ?? null;
    });
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!currentProject) {
      setStatus(null);
      setSelectedPath(null);
      setError(t('control.sourceControlNoProject'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.git.getStatus();
      if (!result.success || !result.status) {
        setStatus(null);
        setSelectedPath(null);
        setError(result.error || t('control.sourceControlNoRepo'));
        return;
      }
      setNextStatus(result.status);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : t('control.sourceControlNoRepo'));
    } finally {
      setLoading(false);
    }
  }, [currentProject, setNextStatus, t]);

  const loadDiff = useCallback(async (file: GitStatusFile | null) => {
    if (!file) {
      setDiff(EMPTY_DIFF);
      return;
    }

    setDiffLoading(true);
    try {
      setDiff(await window.electronAPI.git.getDiff({
        path: file.path,
        staged: getDiffScope(file),
        maxBytes: 64 * 1024,
      }));
    } catch (err) {
      setDiff({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDiffLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    void loadDiff(selectedFile);
  }, [loadDiff, selectedFile]);

  const applyAction = useCallback(async (
    busyKey: string,
    action: () => Promise<GitActionResult>,
    afterSuccess?: () => void,
  ) => {
    setBusyPath(busyKey);
    setError(null);
    try {
      const result = await action();
      if (!result.success) {
        setError(result.error || 'Git action failed.');
        return;
      }
      if (result.status) {
        setNextStatus(result.status);
      } else {
        await refreshStatus();
      }
      afterSuccess?.();
    } finally {
      setBusyPath(null);
    }
  }, [refreshStatus, setNextStatus]);

  const canCommit = Boolean(status?.stagedCount) && commitMessage.trim().length > 0 && !busyPath;
  const branchMeta = status
    ? status.upstream
      ? `${status.branch} -> ${status.upstream}`
      : status.branch
    : currentProject?.name ?? 'Git';

  return {
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
    selectPath: setSelectedPath,
    refreshStatus,
    goBack: () => setRightRailTarget('project'),
    stageAll: () => applyAction('stage-all', () => window.electronAPI.git.stageAll()),
    unstageAll: () => applyAction('unstage-all', () => window.electronAPI.git.unstageAll()),
    stageFile: (file: GitStatusFile) => applyAction(file.path, () => window.electronAPI.git.stage({ path: file.path })),
    unstageFile: (file: GitStatusFile) => applyAction(`unstage:${file.path}`, () => window.electronAPI.git.unstage({ path: file.path })),
    commit: () => applyAction('commit', () => window.electronAPI.git.commit({ message: commitMessage }), () => setCommitMessage('')),
  };
}
