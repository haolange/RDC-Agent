import type { ActionEvent } from '@shared/types/evidence';
import type { AppMode, ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type {
  ArtifactsPanelViewModel,
  ContextPanelViewModel,
  ProgressTask,
  ProgressTaskStatus,
  RdxContextDiagnostic,
  TaskContextResource,
  TraceArtifactRecord,
} from '@shared/types/trace';
import { nowIso } from '@shared/utils/id';
import type { TaskRecord } from '../agent-runtime/tasks/TaskRegistry';
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
  const completed = new Set(records.filter((task) => task.status === 'completed').map((task) => task.id));
  return records
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .map((task, order) => {
      const blockers = task.blockedBy.map((id) => byId.get(id)).filter(
        (blocker): blocker is TaskRecord => blocker !== undefined && !completed.has(blocker.id),
      );
      const status: ProgressTaskStatus = task.status === 'completed'
        ? 'completed'
        : task.status === 'cancelled'
          ? 'cancelled'
          : task.status === 'blocked'
            ? 'blocked'
            : task.status === 'in_progress'
              ? 'running'
              : blockers.length > 0 ? 'blocked' : 'pending';
      return {
        id: task.id,
        sessionId,
        traceLaneId: sessionId,
        branchId,
        title: task.subject,
        status,
        order,
        createdAt: toIso(task.createdAt),
        updatedAt: toIso(task.updatedAt),
        completedAt: task.status === 'completed' ? toIso(task.updatedAt) : undefined,
        source: 'runtime',
        activeForm: task.activeForm,
        blockerSummary: task.statusReason ?? (blockers.length ? blockers.map((blocker) => blocker.subject).join(', ') : undefined),
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
const toolName = (event: ActionEvent): string | null => {
  const value = event.payload.toolName ?? event.payload.tool_name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export function buildTaskContext(input: {
  session: SessionRecord;
  project: ProjectRecord | null;
  runs: RunSummary[];
  events: ActionEvent[];
  attachments: SessionArtifactSource[];
  usedToolNames: string[];
  mode: AppMode;
  settings: { agentRuntime: { permissions: { mode: string } }; agents: { definitions: Array<{ id: string; enabled: boolean; skills?: string[]; mcpServers?: string[] }> } };
}): ContextPanelViewModel['task'] {
  const latest = input.runs.slice().sort((left, right) => (right.startedAt ?? 0) - (left.startedAt ?? 0))[0];
  const mode = latest?.mode ?? input.mode;
  const profile = agentProfileRegistry.getForMode(mode);
  const definition = input.settings.agents.definitions.find((entry) => entry.id === mode && entry.enabled);
  const resources: TaskContextResource[] = input.attachments.filter((item) => item.kind === 'attachment').map((item) => ({
    id: `attachment:${item.id}`, kind: 'attachment', label: item.title, summary: item.filePath, path: item.filePath, state: 'active',
  }));
  for (const skill of definition?.skills ?? []) resources.push({ id: `skill:${skill}`, kind: 'skill', label: skill, state: 'preloaded' });
  for (const mcp of definition?.mcpServers ?? []) resources.push({ id: `mcp:${mcp}`, kind: 'mcp', label: mcp, state: 'preloaded' });
  const usedTools = [
    ...input.events.map(toolName).filter((value): value is string => Boolean(value)),
    ...input.usedToolNames,
  ];
  for (const name of Array.from(new Set(usedTools)).slice(-8)) {
    resources.push({ id: `tool:${name}`, kind: 'tool', label: name, state: 'used' });
  }
  for (const reference of Array.from(new Set(input.events.flatMap((event) => event.refs))).slice(-6)) {
    resources.push({ id: `reference:${reference}`, kind: 'reference', label: reference, state: 'used' });
  }
  return {
    projectId: input.session.projectId, projectName: input.project?.name ?? input.session.projectId,
    sessionId: input.session.sessionId, sessionTitle: input.session.title, workingDirectory: input.session.sessionPath,
    configurationPhase: latest && running.has(latest.status) ? 'current_turn' : 'next_turn',
    agentProfile: profile.displayName, permission: input.settings.agentRuntime.permissions.mode,
    resources,
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
