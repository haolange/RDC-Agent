// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { InvestigationArtifactRow } from '@shared/types/trace';
import type { InvestigationReadIpcResult } from '@shared/types/renderdocInvestigation';
import { SessionRightRail } from './SessionRightRail';
import { readInvestigationArtifact } from './investigationPreviewActions';

const state = vi.hoisted(() => ({
  tracePresentation: null as AgentRunPresentation | null,
  replay: null as CaptureReplayState | null,
  previewUrl: null as string | null,
  reload: vi.fn(), receive: vi.fn(),
}));
vi.mock('../../stores/workflowStore', () => ({ useWorkflowStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (select: (value: { currentSession: { sessionId: string } }) => unknown) => select({ currentSession: { sessionId: 'session' } }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en' }) }));
// Mock data/lifecycle boundaries; render the actual rail, artifact preview, CapturePanel,
// CaptureFrame, CaptureHistory, status chips and callouts throughout these samples.
vi.mock('./useCaptureReplay', () => ({ useCaptureReplay: () => ({ state: state.replay, selection: null, error: null, reload: state.reload, receive: state.receive }) }));
vi.mock('./useCapturePreviewUrl', () => ({ useCapturePreviewUrl: (_scope: unknown, source: { imagePath?: string | null }) => source.imagePath ? state.previewUrl : null }));
vi.mock('./investigationPreviewActions', () => ({ readInvestigationArtifact: vi.fn(async () => ({ ok: false, status: 'error', error: 'Artifact storage unavailable' })) }));

const artifact: InvestigationArtifactRow = {
  artifactId: 'artifact-1', kind: 'claim', recordType: 'ClaimRecord', status: 'stale',
  mission: 'debugger', title: 'Draw 42 requires a fresh baseline', createdAt: '2026-09-22T00:00:00Z',
  contentHash: `sha256:${'a'.repeat(64)}`, contentHashShort: 'aaaaaaaaaaaa',
  sourceRefCount: 2, worldStateId: 'baseline', degraded: false,
};
function presentation(): AgentRunPresentation {
  return {
    projectId: 'project', sessionId: 'session', activeBranchId: 'branch', profileId: 'general',
    updatedAt: '2026-09-22T00:00:00Z', runs: [], rawAuditRefs: [],
    rightPanel: {
      progress: [], artifacts: { rows: [artifact], supersededCount: 1, truncatedCount: 0, storeDegraded: false },
      outputs: { current: [], previous: [] },
      context: {
        task: { projectId: 'project', projectName: 'Project', sessionId: 'session', sessionTitle: 'Session',
          workingDirectory: '/project', configurationPhase: 'current_turn', agentProfile: 'general', permission: 'default', resources: [] },
        rdc: { capture: null, availableCaptures: [{ inputId: 'input', fileName: 'Scene.rdc', filePath: '/captures/Scene.rdc', sizeBytes: 1024 ** 2 }], runtime: {}, diagnostics: [] },
      },
    },
  };
}
function replay(): CaptureReplayState {
  return {
    projectId: 'project', sessionId: 'session', generation: 1, revision: 1, operationId: null,
    phase: 'ready', replayDeviceId: 'local', inputId: 'input', captureHash: null, contextId: 'context',
    requestedEventId: 42, appliedEventId: 42, imageEventId: 42, events: [{ eventId: 21 }, { eventId: 42 }],
    targets: [], target: null, isFinalOutput: false, image: null, observation: null, agentObservation: null,
    devicePresentation: { status: 'not_applicable', eventId: null, textureId: null, sequence: null, reason: null },
    warning: null, interactionLock: null, error: null,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.tracePresentation = presentation(); state.replay = replay(); state.previewUrl = null;
  vi.clearAllMocks();
});

describe('populated session rail', () => {
  it('presents an incomplete typed report as seven readable sections without hiding its limits', async () => {
    const reportRow: InvestigationArtifactRow = { ...artifact, kind: 'report', recordType: 'InvestigationReport', status: 'draft', title: 'Event 1248 assessment' };
    const current = presentation();
    current.rightPanel.artifacts.rows = [reportRow];
    state.tracePresentation = current;
    const payload: InvestigationReadIpcResult = {
      ok: true, status: 'ready', contentHash: reportRow.contentHash,
      manifest: {
        artifactId: reportRow.artifactId, mission: 'debugger', kind: 'report', status: 'draft',
        title: reportRow.title, summary: 'Evidence remains incomplete', contentRef: 'record.json',
        sourceRefs: [], contentHash: reportRow.contentHash, recordType: 'InvestigationReport',
        createdAt: reportRow.createdAt,
      },
      record: {
        title: reportRow.title, mission: 'debugger', summary: 'The root cause remains unknown.',
        claims: [], evidenceIds: ['ev-1248'], experimentIds: [],
        reportContract: {
          conclusion: 'Partial; no causal fix verified.', evidence: 'Event 1248 has a native pixel-history result.',
          verification: 'No intervention or restored-state receipt.', limitations: 'The first bad event is unknown.',
          status: 'partial', links: 'Approved plan: session://plans/example',
          artifactIds: ['ev-1248'], candidateStatus: 'none',
        },
      },
    };
    vi.mocked(readInvestigationArtifact).mockResolvedValueOnce(payload);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(SessionRightRail)));
      const preview = [...host.querySelectorAll<HTMLButtonElement>('.right-rail-investigation-row button')]
        .find((button) => button.textContent === 'control.rightRail.artifacts.preview');
      await act(async () => preview!.click());
      const dialog = document.querySelector('.investigation-preview-dialog');
      expect(dialog?.getAttribute('data-kind')).toBe('report');
      expect(dialog?.querySelectorAll('.investigation-report section')).toHaveLength(7);
      expect(dialog?.textContent).toContain('The root cause remains unknown.');
      expect(dialog?.textContent).toContain('Partial; no causal fix verified.');
      expect(dialog?.textContent).toContain('No intervention or restored-state receipt.');
      expect(dialog?.querySelector('.investigation-preview-source')?.hasAttribute('open')).toBe(false);
      expect(dialog?.querySelector('.investigation-report-index')?.textContent).toContain('ev-1248');
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      expect(document.querySelector('.investigation-preview-dialog')).toBeNull();
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it('renders a typed artifact title/status and opens the real preview with its owning session and hash', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(SessionRightRail)));
      const row = host.querySelector('.right-rail-investigation-row');
      expect(row?.classList.contains('status-stale')).toBe(true);
      expect(row?.textContent).toContain(artifact.title);
      expect(row?.textContent).toContain('control.rightRail.artifacts.status.stale');
      const preview = [...row!.querySelectorAll('button')].find((button) => button.textContent === 'control.rightRail.artifacts.preview');
      await act(async () => preview!.click());
      expect(readInvestigationArtifact).toHaveBeenCalledExactlyOnceWith({ sessionId: 'session', artifactId: artifact.artifactId, expectedHash: artifact.contentHash });
      const dialog = document.querySelector('.investigation-preview-dialog');
      expect(dialog?.textContent).toContain(artifact.title);
      expect(dialog?.getAttribute('data-status')).toBe('error');
      expect(dialog?.textContent).toContain('Artifact storage unavailable');
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      expect(document.querySelector('.investigation-preview-dialog')).toBeNull();
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it('keeps the real Capture controls and frame coherent across opened, loading-image and failure states', () => {
    const host = document.createElement('div'); const root = createRoot(host);
    const render = () => act(() => root.render(createElement(SessionRightRail)));
    const button = (label: string) => [...host.querySelectorAll('button')].find((entry) => entry.textContent === label);
    try {
      render();
      expect(host.querySelectorAll('[data-testid="right-rail-capture"]')).toHaveLength(1);
      expect(host.querySelector('.capture-replay-file-row')?.getAttribute('title')).toBe('/captures/Scene.rdc');
      expect(host.querySelector('.capture-replay-status')?.textContent).toBe('control.replay.ready');
      expect(button('control.replay.close')?.disabled).toBe(false);
      expect(host.querySelector<HTMLInputElement>('.capture-event-input input')?.value).toBe('42');
      state.replay = { ...replay(), phase: 'loading_image', revision: 2 }; render();
      expect(host.querySelector('.capture-replay-image')?.getAttribute('aria-busy')).toBe('true');
      expect(host.querySelector('.capture-replay-image')?.textContent).toContain('control.replay.loading_image');
      expect(button('control.replay.close')?.disabled).toBe(true);
      state.replay = { ...replay(), phase: 'error', revision: 3, error: { code: 'READ_FAILED', message: 'Readback failed', retry: 'image' } }; render();
      expect(host.querySelector('.capture-replay-image')?.getAttribute('aria-busy')).toBe('false');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('Readback failed');
      expect(button('control.replay.retryImage')?.disabled).toBe(false);
      expect(host.querySelector('.capture-replay-status')?.classList.contains('is-error')).toBe(true);
      expect(host.querySelectorAll('section[data-testid]')).toHaveLength(5);
    } finally { act(() => root.unmount()); }
  });
});
