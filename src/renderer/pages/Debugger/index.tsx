import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkflowPanel } from '../../components/WorkflowPanel';
import { AgentChat } from '../../components/AgentChat';
import { EvidencePanel } from '../../components/EvidencePanel';
import { ArtifactViewer } from '../../components/ArtifactViewer';
import './Debugger.css';

interface DebuggerImportRequest {
  id: number;
  files: string[];
}

interface DebuggerPageProps {
  importRequest?: DebuggerImportRequest | null;
  openPickerSignal?: number;
  resetSignal?: number;
  onSessionStateChange?: (state: { contextLabel: string; sessionLabel: string }) => void;
  onError?: (message: string) => void;
}

const addUniquePaths = (currentPaths: string[], nextPaths: string[]): string[] => {
  const existing = new Set(currentPaths);
  const merged = [...currentPaths];

  nextPaths.forEach((path) => {
    if (!existing.has(path)) {
      existing.add(path);
      merged.push(path);
    }
  });

  return merged;
};

const getPathFileName = (path: string): string => {
  return path.split(/[/\\]/).pop() || path;
};

export const DebuggerPage: React.FC<DebuggerPageProps> = ({
  importRequest,
  openPickerSignal = 0,
  resetSignal = 0,
  onSessionStateChange,
  onError,
}) => {
  const [hasStarted, setHasStarted] = useState(false);
  const [capturePaths, setCapturePaths] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [browserModeNotice, setBrowserModeNotice] = useState<string | null>(null);

  const electronAPI =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI
      : undefined;

  const syncFooterState = useCallback(
    (state?: { caseId?: string; sessionId?: string }) => {
      onSessionStateChange?.({
        contextLabel: state?.caseId ? `Case ${state.caseId}` : '--',
        sessionLabel: state?.sessionId ? state.sessionId : '--',
      });
    },
    [onSessionStateChange]
  );

  useEffect(() => {
    const hydrateWorkflow = async () => {
      if (!electronAPI?.workflow?.getState) return;

      try {
        const workflowState = await electronAPI.workflow.getState();
        if (!workflowState?.sessionId) return;

        setHasStarted(true);
        syncFooterState({
          caseId: workflowState.caseId,
          sessionId: workflowState.sessionId,
        });
      } catch (error) {
        console.warn('Failed to hydrate workflow state:', error);
      }
    };

    hydrateWorkflow();
  }, [electronAPI, syncFooterState]);

  useEffect(() => {
    if (!importRequest?.files?.length) return;
    setCapturePaths((current) => addUniquePaths(current, importRequest.files));
    setStartError(null);
  }, [importRequest]);

  useEffect(() => {
    if (openPickerSignal === 0) return;

    void (async () => {
      if (!electronAPI?.selectRdcFiles) {
        const message = 'File selection is only available inside the Electron shell.';
        setBrowserModeNotice(message);
        onError?.(message);
        return;
      }

      try {
        const selectedPaths = await electronAPI.selectRdcFiles();
        if (selectedPaths?.length) {
          setCapturePaths((current) => addUniquePaths(current, selectedPaths));
          setStartError(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to select .rdc files.';
        setStartError(message);
        onError?.(message);
      }
    })();
  }, [electronAPI, onError, openPickerSignal]);

  useEffect(() => {
    if (resetSignal === 0) return;

    setHasStarted(false);
    setCapturePaths([]);
    setIsDragging(false);
    setIsStarting(false);
    setStartError(null);
    setBrowserModeNotice(null);
    syncFooterState();
  }, [resetSignal, syncFooterState]);

  const handleFileSelect = useCallback(async () => {
    if (!electronAPI?.selectRdcFiles) {
      const message = 'File selection is only available inside the Electron shell.';
      setBrowserModeNotice(message);
      onError?.(message);
      return;
    }

    try {
      const selectedPaths = await electronAPI.selectRdcFiles();
      if (selectedPaths?.length) {
        setCapturePaths((current) => addUniquePaths(current, selectedPaths));
        setStartError(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to select .rdc files.';
      setStartError(message);
      onError?.(message);
    }
  }, [electronAPI, onError]);

  const handleStart = useCallback(async () => {
    if (capturePaths.length === 0 || !electronAPI?.workflow?.start) {
      const message = 'Workflow backend is unavailable. Start this UI from the Electron app.';
      setStartError(message);
      onError?.(message);
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const result = await electronAPI.workflow.start(capturePaths, 'Debug rendering issue');
      if (!result.success) {
        const message = result.error || 'Failed to start debug session.';
        setStartError(message);
        onError?.(message);
        return;
      }

      setHasStarted(true);
      syncFooterState({
        caseId: result.caseId,
        sessionId: 'sessionId' in result && typeof result.sessionId === 'string' ? result.sessionId : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start debug session.';
      setStartError(message);
      onError?.(message);
    } finally {
      setIsStarting(false);
    }
  }, [capturePaths, electronAPI, onError, syncFooterState]);

  const handleRemoveFile = useCallback((pathToRemove: string) => {
    setCapturePaths((current) => current.filter((path) => path !== pathToRemove));
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const nextPaths = Array.from(event.dataTransfer.files)
      .map((file) => {
        const fileWithPath = file as File & { path?: string };
        return fileWithPath.path || file.name;
      })
      .filter((path) => path.toLowerCase().endsWith('.rdc'));

    if (nextPaths.length > 0) {
      setCapturePaths((current) => addUniquePaths(current, nextPaths));
      setStartError(null);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const selectedFiles = useMemo(
    () =>
      capturePaths.map((path) => ({
        path,
        name: getPathFileName(path),
      })),
    [capturePaths]
  );

  return (
    <div className="debugger-page">
      <WorkflowPanel />

      {!hasStarted ? (
        <div className="welcome-screen">
          <div className="welcome-backdrop" />
          <div className="welcome-grid" />

          <div className="welcome-content">
            <div className="welcome-logo">RD</div>
            <div className="welcome-kicker">Debugger Workspace</div>
            <h1 className="welcome-title">
              Welcome to <span>RDC Agent</span>
            </h1>
            <p className="welcome-subtitle">
              Upload one or more RenderDoc captures, then launch a guided multi-agent debug workflow.
            </p>

            <div
              className={`upload-zone ${isDragging ? 'drag-over' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => {
                void handleFileSelect();
              }}
            >
              <svg className="upload-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <div className="upload-zone-text">
                {isDragging ? 'Drop .rdc captures here' : 'Drag and drop .rdc captures'}
              </div>
              <div className="upload-zone-hint">or click to browse your workspace</div>
              <button
                className="button button-primary upload-zone-button"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleFileSelect();
                }}
              >
                Select Files
              </button>
            </div>

            {browserModeNotice && <div className="debugger-inline-notice">{browserModeNotice}</div>}
            {startError && <div className="debugger-inline-error">{startError}</div>}

            <div className="welcome-lower">
              <div className="selected-files">
                <div className="selected-files-header">
                  <span className="selected-files-title">Selected Files</span>
                  <span className="selected-files-count">{selectedFiles.length}</span>
                </div>

                {selectedFiles.length === 0 ? (
                  <div className="selected-files-empty">
                    No capture files selected yet. Add anomalous and baseline captures to begin.
                  </div>
                ) : (
                  <div className="file-list">
                    {selectedFiles.map((file) => (
                      <div key={file.path} className="file-item">
                        <div className="file-item-icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div className="file-item-info">
                          <div className="file-item-name">{file.name}</div>
                          <div className="file-item-path">{file.path}</div>
                        </div>
                        <button className="file-item-remove" onClick={() => handleRemoveFile(file.path)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button className="start-session-btn" onClick={() => void handleStart()} disabled={capturePaths.length === 0 || isStarting}>
                {isStarting ? (
                  <>
                    <span className="start-session-spinner" />
                    Starting Session...
                  </>
                ) : (
                  <>
                    <svg className="start-session-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Start Debug Session
                  </>
                )}
              </button>

              <div className="recent-sessions">
                <div className="recent-sessions-title">Recent Sessions</div>
                <div className="recent-sessions-empty">
                  Recent session history is not wired yet. New sessions will appear here once persistence is available.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="debugger-workspace">
          <div className="workspace-main">
            <AgentChat />
          </div>

          <div className="workspace-center">
            <div className="workspace-center-panel">
              <EvidencePanel />
            </div>
            <div className="workspace-center-panel workspace-center-panel-bottom">
              <ArtifactViewer />
            </div>
          </div>

          <div className="workspace-right">
            <ArtifactViewer />
          </div>
        </div>
      )}
    </div>
  );
};

export default DebuggerPage;
