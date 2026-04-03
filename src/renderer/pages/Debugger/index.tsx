import React, { useCallback, useEffect, useState } from 'react';
import { AgentChat } from '../../components/AgentChat';
import { useSessionStore } from '../../stores/sessionStore';
import { useDeviceStore } from '../../stores/deviceStore';
import { assignDefaultCaptureRoles } from '@shared/constants/modes';
import type { CaptureDescriptor, CaptureRole, ReplayBackendHint, DebugSessionStartRequest } from '@shared/types/session';
import './Debugger.css';

const getFileName = (filePath: string): string => filePath.split(/[/\\]/).pop() || filePath;

const addUniquePaths = (current: string[], next: string[]): string[] => {
  const set = new Set(current);
  return [...current, ...next.filter((filePath) => !set.has(filePath))];
};

export const DebuggerPage: React.FC = () => {
  const currentRun = useSessionStore((s) => s.currentRun);
  const setCurrentRun = useSessionStore((s) => s.setCurrentRun);

  const [capturePaths, setCapturePaths] = useState<string[]>([]);
  const [captureRoles, setCaptureRoles] = useState<CaptureRole[]>([]);
  const [captureBackends, setCaptureBackends] = useState<ReplayBackendHint[]>([]);
  const [goal, setGoal] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const selectedDevice = useDeviceStore((s) => s.selectedDevice);
  const devices = useDeviceStore((s) => s.devices);
  const selectedDeviceEntry = devices.find((device) => device.id === selectedDevice);

  useEffect(() => {
    const defaultRoles = assignDefaultCaptureRoles(capturePaths.length);
    setCaptureRoles(defaultRoles);
    setCaptureBackends(capturePaths.map(() => 'local' as ReplayBackendHint));
  }, [capturePaths.length]);

  const handleFileSelect = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.selectRdcFiles) {
      setStartError('File selection is only available inside the Electron shell.');
      return;
    }

    try {
      const selected = await electronAPI.selectRdcFiles();
      if (selected?.length) {
        setCapturePaths((current) => addUniquePaths(current, selected));
        setStartError(null);
      }
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Failed to select .rdc files.');
    }
  }, []);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path || file.name)
      .filter((filePath) => filePath.toLowerCase().endsWith('.rdc'));
    if (paths.length) {
      setCapturePaths((current) => addUniquePaths(current, paths));
      setStartError(null);
    }
  }, []);

  const handleRemovePath = useCallback((filePath: string) => {
    setCapturePaths((current) => current.filter((path) => path !== filePath));
  }, []);

  const handleRoleChange = useCallback((index: number, role: CaptureRole) => {
    setCaptureRoles((current) => current.map((value, currentIndex) => currentIndex === index ? role : value));
  }, []);

  const handleBackendChange = useCallback((index: number, backend: ReplayBackendHint) => {
    setCaptureBackends((current) => current.map((value, currentIndex) => currentIndex === index ? backend : value));
  }, []);

  const hasPrimary = captureRoles.includes('primary');
  const hasRemoteCapture = captureBackends.includes('remote');
  const remoteDeviceReady = Boolean(
    selectedDeviceEntry
    && selectedDeviceEntry.type === 'android'
    && selectedDeviceEntry.status === 'online',
  );
  const remoteReplayBlocked = hasRemoteCapture && !remoteDeviceReady;

  const canStart = capturePaths.length > 0 && hasPrimary && !remoteReplayBlocked && !isStarting;

  const buildCaptureDescriptors = (): CaptureDescriptor[] =>
    capturePaths.map((filePath, index) => ({
      id: `cap-${index}`,
      filePath,
      role: captureRoles[index] ?? 'reference',
      backendHint: captureBackends[index] ?? 'local',
      status: 'pending' as const,
    }));

  const handleStart = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!canStart || !electronAPI?.workflow?.start || !selectedDeviceEntry) {
      setStartError('Workflow backend is unavailable or request is invalid.');
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const descriptors = buildCaptureDescriptors();
      const primaryCapture = descriptors.find((descriptor) => descriptor.role === 'primary');
      if (!primaryCapture) {
        setStartError('At least one capture must be assigned the Primary role.');
        return;
      }

      const request: DebugSessionStartRequest = {
        mode: 'debugger',
        goal: goal.trim() || 'Debug rendering issue',
        captures: descriptors,
        primaryCaptureId: primaryCapture.id,
        replayDevice: selectedDeviceEntry,
      };

      const result = await electronAPI.workflow.start(request) as {
        success: boolean;
        error?: string;
        runId?: string;
        caseId?: string;
        sessionId?: string;
      };

      if (!result.success) {
        setStartError(result.error || 'Failed to start debug session.');
        return;
      }

      setCurrentRun({
        runId: result.runId ?? `run-${Date.now()}`,
        caseId: result.caseId ?? '',
        sessionId: result.sessionId ?? '',
        mode: 'debugger',
        goal: goal.trim() || 'Debug rendering issue',
        captures: descriptors,
        startedAt: Date.now(),
        status: 'running',
        lastStage: 'preflight_pending',
      });
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Failed to start debug session.');
    } finally {
      setIsStarting(false);
    }
  }, [canStart, goal, selectedDeviceEntry, capturePaths, captureRoles, captureBackends, setCurrentRun]);

  if (currentRun) {
    return (
      <div className="debugger-page">
        <AgentChat />
      </div>
    );
  }

  return (
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
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
          onClick={() => void handleFileSelect()}
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
            onClick={(event) => { event.stopPropagation(); void handleFileSelect(); }}
          >
            Select Files
          </button>
        </div>

        {startError && <div className="debugger-inline-error">{startError}</div>}

        <div className="welcome-lower">
          <div className="selected-files">
            <div className="selected-files-header">
              <span className="selected-files-title">Selected Captures</span>
              <span className="selected-files-count">{capturePaths.length}</span>
            </div>

            {capturePaths.length === 0 ? (
              <div className="selected-files-empty">
                No capture files selected yet. Add anomalous and baseline captures to begin.
              </div>
            ) : (
              <div className="file-list">
                {capturePaths.map((filePath, index) => (
                  <div key={filePath} className="file-item">
                    <div className="file-item-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="file-item-info">
                      <div className="file-item-name">{getFileName(filePath)}</div>
                      <div className="file-item-path">{filePath}</div>
                    </div>
                    <select
                      className="capture-role-select"
                      value={captureRoles[index] ?? 'reference'}
                      onChange={(event) => handleRoleChange(index, event.target.value as CaptureRole)}
                    >
                      <option value="primary">Primary</option>
                      <option value="baseline">Baseline</option>
                      <option value="reference">Reference</option>
                      <option value="fix">Fix</option>
                    </select>
                    <select
                      className="capture-backend-select"
                      value={captureBackends[index] ?? 'local'}
                      onChange={(event) => handleBackendChange(index, event.target.value as ReplayBackendHint)}
                    >
                      <option value="local">Local</option>
                      <option value="remote">Remote</option>
                    </select>
                    <button className="file-item-remove" onClick={() => handleRemovePath(filePath)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {capturePaths.length > 0 && !hasPrimary && (
              <div className="debugger-inline-error" style={{ marginTop: 8 }}>
                At least one capture must be assigned the <strong>Primary</strong> role.
              </div>
            )}
            {remoteReplayBlocked && (
              <div className="debugger-inline-error" style={{ marginTop: 8 }}>
                A remote capture is selected, but the current Replay Device is not <strong>Online</strong> yet.
              </div>
            )}
          </div>

          <div className="goal-input-wrapper" style={{ marginTop: 16 }}>
            <input
              type="text"
              className="chat-input"
              placeholder="Describe the debug goal (optional)"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <button className="start-session-btn" onClick={() => void handleStart()} disabled={!canStart}>
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

          <RecentRunsList />
        </div>
      </div>
    </div>
  );
};

const RecentRunsList: React.FC = () => {
  const recentRuns = useSessionStore((s) => s.recentRuns);
  const setCurrentRun = useSessionStore((s) => s.setCurrentRun);

  const handleResume = useCallback(async (runId: string) => {
    const run = recentRuns.find((entry) => entry.runId === runId);
    if (!run) return;
    try {
      await window.electronAPI.session.select(run.sessionId);
      setCurrentRun(run);
    } catch {
      // ignore
    }
  }, [recentRuns, setCurrentRun]);

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const statusLabel: Record<string, string> = {
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };

  return (
    <div className="recent-sessions">
      <div className="recent-sessions-title">Recent Runs</div>
      {recentRuns.length === 0 ? (
        <div className="recent-sessions-empty">
          暂无历史 Run，完成一次调试会话后将显示在这里。
        </div>
      ) : (
        <div className="file-list">
          {recentRuns.slice(0, 6).map((run) => (
            <div key={run.runId} className="file-item" style={{ cursor: 'pointer' }} onClick={() => void handleResume(run.runId)}>
              <div className="file-item-info">
                <div className="file-item-name">{run.goal || run.runId}</div>
                <div className="file-item-path">
                  {run.mode} · {statusLabel[run.status] ?? run.status} · {formatTime(run.startedAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DebuggerPage;
