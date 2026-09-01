import { describe, expect, it } from 'vitest';
import type { ContextSnapshot, OpenedCaptureState, RunSummary } from '@shared/types/session';
import type { TraceArtifactRecord } from '@shared/types/trace';
import type { TaskRecord } from '../agent-runtime/tasks/TaskRegistry';
import { dedupeSessionArtifactSources, type SessionArtifactSource } from '../sessions/SessionArtifactSource';
import { buildRdxContext, buildTaskContext, mapRightRailArtifacts, mapRightRailProgress } from './rightRailProjectionMappers';

const task = (id: string, status: TaskRecord['status'], createdAt: number, statusReason?: string): TaskRecord => ({
  id, subject: id, description: '', status, statusReason, blockedBy: [], blocks: [], createdAt, updatedAt: createdAt,
});

const source = (
  id: string,
  kind: SessionArtifactSource['kind'],
  runId?: string,
  exists = true,
  category: TraceArtifactRecord['source'] = 'document',
): SessionArtifactSource => ({
  id, kind, runId, title: `${id}.txt`, fileName: `${id}.txt`, filePath: `D:/rail/${id}.txt`, source: category,
  mimeType: 'text/plain', sizeBytes: 12, createdAt: 1, updatedAt: 1, exists,
});

const run = (runId: string, startedAt: number): RunSummary => ({ runId, startedAt } as RunSummary);

const openedCapture = {
  projectId: 'project-a', ownerSessionId: 'session-a', inputId: 'input-a', filePath: 'D:/captures/WhiteHair.rdc',
  captureId: 'capture-a', captureFileId: 'capture-file-a', sessionId: 'rdx-session-a', contextId: 'context-a',
  replaySessionId: 'rdx-session-a', backend: 'remote', deviceId: 'android-a', deviceLabel: 'Android GPU', status: 'open', openedAt: 10,
  runtimeContext: { contextId: 'context-a', replaySessionId: 'rdx-session-a', runtimeOwner: 'rdc-agent', ownerLeaseId: 'lease-a', backend: 'remote', deviceLabel: 'Android GPU', remoteId: 'remote-a', remoteStatus: 'connected', updatedAt: 11 },
} satisfies OpenedCaptureState;

const contextSnapshot = {
  contextId: 'context-a', sessionId: 'rdx-session-a', ownerSessionId: 'session-a', backend: 'remote', remoteStatus: 'connected',
  runtimeOwner: 'rdc-agent', ownerLeaseId: 'lease-a', captureDescriptors: [], activeCapture: 'capture-a', deviceLabel: 'Android GPU',
  runtimeContext: openedCapture.runtimeContext,
} satisfies ContextSnapshot;

describe('right rail projection mappers', () => {
  it('projects only real task records and preserves lifecycle status', () => {
    const rows = mapRightRailProgress('session-a', 'branch-a', [
      task('done', 'completed', 1), task('active', 'in_progress', 2), task('blocked', 'blocked', 3, 'Waiting for device'), task('cancel', 'cancelled', 4),
    ]);
    expect(rows.map((entry) => entry.status)).toEqual(['completed', 'in_progress', 'blocked', 'cancelled']);
    expect(rows.map((entry) => entry.order)).toEqual([0, 1, 2, 3]);
    expect(rows.find((entry) => entry.id === 'blocked')?.blockerSummary).toBe('Waiting for device');
  });

  it('projects explicit user-facing outputs without pinning plans or exposing internal producers', () => {
    const result = mapRightRailArtifacts({
      sessionId: 'session-a', branchId: 'branch-a', runs: [run('run-old', 1), run('run-current', 2)],
      sources: [
        source('current', 'output', 'run-current', true, 'report'),
        source('old', 'output', 'run-old', false, 'evidence'),
        source('input', 'attachment'),
      ],
    });
    expect(result.current.map((entry) => entry.id)).toEqual(['current']);
    expect(result.current[0]).toMatchObject({ type: 'report', status: 'ready', source: 'report' });
    expect(result.previous).toEqual([expect.objectContaining({ id: 'old', source: 'evidence', status: 'failed' })]);
    expect([...result.current, ...result.previous].some((entry) => entry.id === 'input')).toBe(false);
  });

  it('deduplicates normalized output paths without hiding task-context attachments', () => {
    const input = { ...source('input', 'attachment'), filePath: 'D:/rail/report.md' };
    const first = { ...source('first', 'output'), filePath: 'D:/rail/reports/../report.md' };
    const duplicate = { ...source('duplicate', 'output'), filePath: 'D:/rail/report.md' };
    expect(dedupeSessionArtifactSources([input, first, duplicate]).map((entry) => entry.id)).toEqual(['input', 'first']);
  });

  it('fails closed without an owned capture and does not invent CLI diagnostics', () => {
    const result = buildRdxContext({ openedCapture: null, contextSnapshot: null, availableCaptures: [] });
    expect(result.capture).toBeNull();
    expect(result.runtime).toEqual({});
    expect(result.diagnostics).toEqual([]);
  });

  it('projects the owner session RDX runtime identifiers for agent consumption', () => {
    const result = buildRdxContext({ openedCapture, contextSnapshot, availableCaptures: [] });
    expect(result.capture).toMatchObject({ inputId: 'input-a', captureId: 'capture-a', captureFileId: 'capture-file-a', replaySessionId: 'rdx-session-a' });
    expect(result.runtime).toMatchObject({ contextId: 'context-a', replaySessionId: 'rdx-session-a', runtimeOwner: 'rdc-agent', ownerLeaseId: 'lease-a', remoteId: 'remote-a', remoteStatus: 'connected' });
  });

  it('projects concrete resources and deduplicates attachments by canonical path', () => {
    const attachment = { ...source('input', 'attachment'), title: 'DESIGN.md', filePath: 'D:/project/DESIGN.md' };
    const result = buildTaskContext({
      session: { sessionId: 'session-a', projectId: 'project-a', title: 'Session', sessionPath: 'D:/session' } as never,
      project: { projectId: 'project-a', name: 'Project' } as never,
      runs: [],
      attachments: [attachment],
      resources: [
        { id: 'file:duplicate', kind: 'file', label: 'DESIGN.md', path: 'D:/project/DESIGN.md', state: 'used' },
        { id: 'mcp:renderdoc:inspect', kind: 'mcp', label: 'inspect', summary: 'renderdoc', state: 'used' },
      ],
      profileId: 'debugger',
      permissionMode: 'default',
    });
    expect(result.resources.map((resource) => resource.label)).toEqual(['DESIGN.md', 'inspect']);
    expect(result.resources.every((resource) => resource.kind !== ('tool' as never))).toBe(true);
  });
});
