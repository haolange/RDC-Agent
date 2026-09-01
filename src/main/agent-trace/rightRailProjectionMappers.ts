import path from 'path';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type {
  ArtifactsPanelViewModel,
  ContextPanelViewModel,
  ProgressTask,
  RdxContextDiagnostic,
  TaskContextResource,
  TraceArtifactRecord,
} from '@shared/types/trace';
import { nowIso } from '@shared/utils/id';
import type { TaskRecord } from '../agent-runtime/tasks/TaskRegistry';
import { projectTaskItems } from '../agent-runtime/tasks/taskProjection';
import type { SessionArtifactSource } from '../sessions/SessionArtifactSource';
import type { ContextSnapshot, OpenedCaptureState } from '@shared/types/session';
import { agentProfileRegistry } from './manifests/AgentProfileRegistry';

const toIso = (value: number | undefined): string => value ? new Date(value).toISOString() : nowIso();

export function mapRightRailProgress(
  sessionId: string,
  branchId: string,
  records: TaskRecord[],
): ProgressTask[] {
  const byId = new Map(records.map((task) => [task.id, task] as const));
  return projectTaskItems(records).map((item) => {
    const task = byId.get(item.taskId);
    return {
      id: item.taskId,
      sessionId,
      traceLaneId: sessionId,
      branchId,
      title: item.title,
      status: item.status,
      order: item.order,
      createdAt: toIso(task?.createdAt),
      updatedAt: toIso(task?.updatedAt),
      completedAt: item.status === 'completed' ? toIso(task?.updatedAt) : undefined,
      blockerSummary: item.statusReason,
    };
  });
}

const artifactType = (source: SessionArtifactSource): TraceArtifactRecord['type'] => {
  if (source.source === 'report') return 'report';
  if (source.source === 'image') return 'visual_report';
  if (source.source === 'evidence' || source.source === 'data') return 'evidence_bundle';
  return 'other';
};

export function mapRightRailArtifacts(input: {
  sessionId: string;
  branchId: string;
  sources: SessionArtifactSource[];
  runs: RunSummary[];
}): ArtifactsPanelViewModel {
  const latestRunId = input.runs
    .slice().sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0]?.runId;
  const all = input.sources
    .filter((source) => source.kind === 'output')
    .map<TraceArtifactRecord>((source) => ({
      id: source.id,
      sessionId: input.sessionId,
      traceLaneId: source.runId ?? input.sessionId,
      branchId: input.branchId,
      source: source.source,
      runId: source.runId,
      type: artifactType(source),
      status: source.exists ? 'ready' : 'failed',
      displayName: source.title,
      path: source.filePath,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
      rawRef: `output:${source.id}`,
      createdAt: toIso(source.createdAt),
      updatedAt: toIso(source.updatedAt ?? source.createdAt),
    }));
  const current = latestRunId ? all.filter((artifact) => artifact.runId === latestRunId) : all.slice(0, 6);
  const currentIds = new Set(current.map((artifact) => artifact.id));
  return { current, previous: all.filter((artifact) => !currentIds.has(artifact.id)) };
}

const running = new Set<RunSummary['status']>(['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping']);
const dedupeTaskResources = (resources: TaskContextResource[]): TaskContextResource[] => {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const identity = resource.path
      ? 'path:' + path.normalize(resource.path).replaceAll('\\', '/').toLocaleLowerCase()
      : resource.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

export function buildTaskContext(input: {
  session: SessionRecord;
  project: ProjectRecord | null;
  runs: RunSummary[];
  attachments: SessionArtifactSource[];
  resources: TaskContextResource[];
  profileId?: string;
  permissionMode: string;
}): ContextPanelViewModel['task'] {
  const latest = input.runs.slice().sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0];
  const mode = latest?.profileId ?? input.profileId ?? 'general';
  const profile = agentProfileRegistry.getForMode(mode);
  const resources: TaskContextResource[] = input.attachments.filter((item) => item.kind === 'attachment').map((item) => ({
    id: `attachment:${item.id}`, kind: 'attachment', label: item.title, summary: item.filePath, path: item.filePath, state: 'active',
  }));
  resources.push(...input.resources);
  const distinctResources = dedupeTaskResources(resources);
  return {
    projectId: input.session.projectId, projectName: input.project?.name ?? input.session.projectId,
    sessionId: input.session.sessionId, sessionTitle: input.session.title, workingDirectory: input.session.sessionPath,
    configurationPhase: latest && running.has(latest.status) ? 'current_turn' : 'next_turn',
    agentProfile: profile.displayName, permission: input.permissionMode,
    resources: distinctResources,
  };
}

const chooseDiagnosticAction = (summary: string): RdxContextDiagnostic['action'] => {
  const normalized = summary.toLowerCase();
  if (normalized.includes('configured') || normalized.includes('settings')) return 'settings';
  if (normalized.includes('unsupported') || normalized.includes('incompatible') || normalized.includes('replay')) return 'change_device';
  return 'retry';
};

const dedupeDiagnostics = (items: Array<Omit<RdxContextDiagnostic, 'id' | 'repeatCount'>>): RdxContextDiagnostic[] => {
  const grouped = new Map<string, RdxContextDiagnostic>();
  for (const item of items) {
    const key = `${item.code ?? 'unknown'}:${item.summary}`;
    const existing = grouped.get(key);
    if (existing) { existing.repeatCount += 1; continue; }
    grouped.set(key, { ...item, id: `rdx:${grouped.size + 1}`, repeatCount: 1 });
  }
  return [...grouped.values()];
};

export function buildRdxContext(input: {
  openedCapture: OpenedCaptureState | null;
  contextSnapshot: ContextSnapshot | null;
  availableCaptures: ContextPanelViewModel['rdx']['availableCaptures'];
}): ContextPanelViewModel['rdx'] {
  const opened = input.openedCapture;
  const runtimeContext = input.contextSnapshot?.runtimeContext ?? opened?.runtimeContext ?? null;
  const diagnostics: Array<Omit<RdxContextDiagnostic, 'id' | 'repeatCount'>> = [];
  if (opened?.previewError) {
    diagnostics.push({
      code: opened.previewError.code,
      summary: opened.previewError.message,
      detail: opened.previewError.attempts.map((attempt) => attempt.message).filter(Boolean).join('\n') || undefined,
      action: chooseDiagnosticAction(opened.previewError.message),
    });
  }
  return {
    capture: opened ? {
      inputId: opened.inputId,
      captureId: opened.captureId,
      captureFileId: opened.captureFileId,
      displayName: opened.filePath.split(/[\\/]/).filter(Boolean).pop() ?? opened.filePath,
      filePath: opened.filePath,
      status: opened.status,
      backend: opened.backend,
      deviceLabel: opened.deviceLabel,
      replaySessionId: opened.replaySessionId || undefined,
      openedAt: toIso(opened.openedAt),
      previewAvailable: Boolean(opened.preview),
      humanPreviewStatus: input.contextSnapshot?.humanPreview?.status,
      humanPreviewError: input.contextSnapshot?.humanPreview?.lastError,
    } : null,
    availableCaptures: input.availableCaptures,
    runtime: {
      contextId: input.contextSnapshot?.contextId || opened?.contextId || runtimeContext?.contextId || undefined,
      replaySessionId: input.contextSnapshot?.sessionId || opened?.replaySessionId || runtimeContext?.replaySessionId || undefined,
      runtimeOwner: input.contextSnapshot?.runtimeOwner || runtimeContext?.runtimeOwner || undefined,
      ownerLeaseId: input.contextSnapshot?.ownerLeaseId || runtimeContext?.ownerLeaseId || undefined,
      remoteId: runtimeContext?.remoteId,
      remoteStatus: input.contextSnapshot?.remoteStatus ?? runtimeContext?.remoteStatus,
    },
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}
