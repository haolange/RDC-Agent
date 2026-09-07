import { useCaptureStore } from '../../../stores/captureStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { applySessionSwitchHygiene } from '../../../stores/sessionSwitchHygiene';
import { hydrateComposerAgentFromSession } from '../../../stores/sessionAgentHydration';
import type { TranslationKey } from '../../../i18n';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type {
  LoadProjectsOptions,
  LoadSessionsOptions,
  SelectSessionOptions,
  SelectionSnapshot,
} from './types';

export interface ProjectSelectionLoaderOpsContext {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  setSidebarError: (error: string | null) => void;
  ensureProjectExpanded: (projectId: string) => void;
  loadProjectSessionList: (projectId: string) => Promise<SessionRecord[]>;
  pruneTreeForProjects: (visibleProjectIds: Set<string>) => void;
  resetTree: () => void;
  isLatestSelectionRequest: (requestId?: number) => boolean;
  setProjects: ReturnType<typeof useProjectStore.getState>['setProjects'];
  setSessions: ReturnType<typeof useProjectStore.getState>['setSessions'];
  setCurrentProject: ReturnType<typeof useProjectStore.getState>['setCurrentProject'];
  setCurrentSession: ReturnType<typeof useProjectStore.getState>['setCurrentSession'];
  setProjectInputs: ReturnType<typeof useProjectStore.getState>['setProjectInputs'];
  updateProjectInputs: ReturnType<typeof useProjectStore.getState>['updateProjectInputs'];
  setRightRailTarget: ReturnType<typeof useProjectStore.getState>['setRightRailTarget'];
  setCurrentRun: ReturnType<typeof useSessionStore.getState>['setCurrentRun'];
  setRuns: ReturnType<typeof useSessionStore.getState>['setRuns'];
  setCaptures: ReturnType<typeof useCaptureStore.getState>['setCaptures'];
  getCurrentSession: () => ReturnType<typeof useProjectStore.getState>['currentSession'];
  reloadSettings: () => Promise<unknown>;
}

export async function loadRunsForSession(sessionId: string) {
  const result = await window.electronAPI.run.list(sessionId);
  return result.runs ?? [];
}

export function captureSelectionSnapshot(): SelectionSnapshot {
  const project = useProjectStore.getState();
  const session = useSessionStore.getState();
  const capture = useCaptureStore.getState();
  return {
    currentProject: project.currentProject,
    currentSession: project.currentSession,
    rightRailTarget: project.rightRailTarget,
    currentRun: session.currentRun,
    captures: capture.captures,
    runs: session.runs,
  };
}

export function restoreSelectionSnapshot(
  ctx: ProjectSelectionLoaderOpsContext,
  snapshot: SelectionSnapshot,
) {
  ctx.setCurrentProject(snapshot.currentProject);
  ctx.setCurrentSession(snapshot.currentSession);
  ctx.setRightRailTarget(snapshot.rightRailTarget);
  ctx.setCurrentRun(snapshot.currentRun);
  ctx.setCaptures(snapshot.captures);
  ctx.setRuns(snapshot.runs);
}

export async function selectSessionOp(
  ctx: ProjectSelectionLoaderOpsContext,
  sessionId: string,
  options: SelectSessionOptions = {},
): Promise<boolean> {
  const rollbackState = options.rollbackState ?? captureSelectionSnapshot();
  const previousSessionId = ctx.getCurrentSession()?.sessionId ?? null;

  if (options.optimisticSession) {
    applySessionSwitchHygiene({
      previousSessionId,
      nextSessionId: options.optimisticSession.sessionId,
    });
    ctx.setCurrentSession(options.optimisticSession);
    ctx.setRightRailTarget('session');
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
  }

  const result = await window.electronAPI.session.select(sessionId).catch((error) => ({
    success: false,
    session: undefined,
    currentRun: null,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return false;
  }
  if (!result.success || !result.session) {
    restoreSelectionSnapshot(ctx, rollbackState);
    ctx.setSidebarError(result.error || ctx.t('sidebar.selectSessionFailed'));
    if (options.optimisticSession?.projectId) {
      await ctx.loadProjectSessionList(options.optimisticSession.projectId).catch(() => undefined);
    }
    return false;
  }

  if (!options.optimisticSession || options.optimisticSession.sessionId !== result.session.sessionId) {
    applySessionSwitchHygiene({
      previousSessionId: options.optimisticSession?.sessionId ?? previousSessionId,
      nextSessionId: result.session.sessionId,
    });
  }
  ctx.setCurrentSession(result.session);
  hydrateComposerAgentFromSession(result.session);
  const history = await window.electronAPI.conversation.getHistory(result.session.sessionId).catch(() => null);
  if (history && ctx.isLatestSelectionRequest(options.requestId)) {
    useConversationStore.getState().setConversationSnapshot(history.messages ?? [], history.branchState ?? null);
  }
  const trace = await window.electronAPI.trace.getProjection(result.session.sessionId).catch(() => null);
  if (trace?.presentation && ctx.isLatestSelectionRequest(options.requestId)) {
    useWorkflowStore.getState().setTracePresentation(trace.presentation);
  }
  ctx.setRightRailTarget('session');
  ctx.setCurrentRun(result.currentRun ?? null);
  ctx.setCaptures(result.currentRun?.captures ?? []);
  const nextRuns = await loadRunsForSession(sessionId);
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return false;
  }
  ctx.setRuns(nextRuns);
  return true;
}

export async function loadSessionsOp(
  ctx: ProjectSelectionLoaderOpsContext,
  project: ProjectRecord,
  options: LoadSessionsOptions = {},
) {
  const autoSelectSession = options.autoSelectSession !== false;
  const projectSelection = await window.electronAPI.project.select(project.projectId).catch((error) => ({
    success: false,
    project: undefined,
    currentSession: null,
    currentRun: null,
    error: error instanceof Error ? error.message : String(error),
  }));
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }
  if (!projectSelection.success || !projectSelection.project) {
    ctx.setSidebarError(projectSelection.error || ctx.t('sidebar.selectProjectFailed'));
    return;
  }

  const selectedProject = projectSelection.project;
  const nextSessions = await ctx.loadProjectSessionList(selectedProject.projectId);
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }

  ctx.setSessions(nextSessions);
  await ctx.reloadSettings();
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }
  ctx.setCurrentProject(selectedProject);
  ctx.updateProjectInputs(selectedProject.projectId, selectedProject.inputs ?? []);
  ctx.ensureProjectExpanded(selectedProject.projectId);

  const currentSession = ctx.getCurrentSession();
  if (!autoSelectSession) {
    ctx.setRightRailTarget(options.rightRailTarget ?? 'project');
    if (currentSession?.projectId && currentSession.projectId !== selectedProject.projectId) {
      ctx.setCurrentSession(null);
      ctx.setCurrentRun(null);
      ctx.setCaptures([]);
      ctx.setRuns([]);
    }
    return;
  }

  // 选择目标会话的优先级：当前活跃会话（来自 selection.json / currentSession）
  // 优先于 registry.lastSessionId（持久化、可能 stale）。任何候选 id 都必须仍存在于
  // nextSessions 中，否则回退到剩余会话之首，避免选中已删除的会话导致 "Session not found"。
  const existingSessionIds = new Set(nextSessions.map((session) => session.sessionId));
  const candidateChain = [
    options.preferredSessionId,
    currentSession?.sessionId,
    selectedProject.lastSessionId,
    nextSessions[0]?.sessionId,
  ];
  const targetSessionId = candidateChain.find((id) => id && existingSessionIds.has(id)) ?? null;

  if (!targetSessionId) {
    ctx.setRightRailTarget(options.rightRailTarget ?? 'project');
    ctx.setCurrentSession(null);
    ctx.setCurrentRun(null);
    ctx.setCaptures([]);
    ctx.setRuns([]);
    return;
  }

  const optimisticSession = nextSessions.find((session) => session.sessionId === targetSessionId);
  await selectSessionOp(ctx, targetSessionId, {
    optimisticSession,
    requestId: options.requestId,
    rollbackState: options.rollbackState,
  });
}

export async function loadProjectsOp(
  ctx: ProjectSelectionLoaderOpsContext,
  preferredProjectId?: string | null,
  preferredSessionId?: string | null,
  options: LoadProjectsOptions = {},
) {
  const result = await window.electronAPI.project.list();
  if (!ctx.isLatestSelectionRequest(options.requestId)) {
    return;
  }

  const nextProjects = result.projects ?? [];
  ctx.setProjects(nextProjects);
  const visibleProjectIds = new Set(nextProjects.map((project) => project.projectId));
  ctx.pruneTreeForProjects(visibleProjectIds);

  const targetProject = nextProjects.find((project) => project.projectId === preferredProjectId)
    || nextProjects[0]
    || null;

  if (!targetProject) {
    ctx.setCurrentProject(null);
    useSessionStore.getState().clearUsageSnapshot();
    ctx.setCurrentSession(null);
    ctx.setRightRailTarget('project');
    ctx.setCurrentRun(null);
    ctx.setProjectInputs([]);
    ctx.resetTree();
    ctx.setCaptures([]);
    ctx.setSessions([]);
    ctx.setRuns([]);
    await ctx.reloadSettings();
    return;
  }

  await loadSessionsOp(ctx, targetProject, {
    preferredSessionId,
    autoSelectSession: options.autoSelectSession,
    rightRailTarget: options.rightRailTarget,
    requestId: options.requestId,
  });
}
