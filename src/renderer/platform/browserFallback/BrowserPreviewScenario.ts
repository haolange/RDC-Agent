import type { ConversationMessage } from '@shared/types/conversation';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { ActionEvent } from '@shared/types/evidence';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type {
  ContextSnapshot,
  OpenedCaptureState,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionOutputRecord,
  SessionRecord,
} from '@shared/types/session';
import type { WorkflowState } from '@shared/types/workflow';
import type { AgentWorkstreamPresentation, AgentWorkstreamSession } from '@shared/types/workstream';

export const DEFAULT_BROWSER_PREVIEW_SCENARIO_ID = 'debugger-session';

export interface BrowserPreviewScenario {
  scenarioId: string;
  label: string;
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  runs: RunSummary[];
  currentProjectId: string | null;
  currentSessionId: string | null;
  workflowState: WorkflowState;
  openedCapture: OpenedCaptureState | null;
  contextSnapshot: ContextSnapshot | null;
  devices: ReplayDeviceEntry[];
  runtimeLogs: RuntimeLogEntry[];
  conversations: Record<string, ConversationMessage[]>;
  attachments?: Record<string, SessionAttachmentRecord[]>;
  outputs?: Record<string, SessionOutputRecord[]>;
  actionEvents?: ActionEvent[];
  workstreamSession?: AgentWorkstreamSession;
  workstreamPresentation?: AgentWorkstreamPresentation;
  usage?: RunContextUsageSummary | null;
}

const SCENARIO_ENDPOINT_ROOT = '/.rdc-preview/scenarios';

const sanitizeScenarioId = (value: string | null): string => {
  const candidate = value?.trim() || DEFAULT_BROWSER_PREVIEW_SCENARIO_ID;
  return /^[a-z0-9][a-z0-9-]*$/i.test(candidate)
    ? candidate
    : DEFAULT_BROWSER_PREVIEW_SCENARIO_ID;
};

const selectedScenarioId = (): string => {
  if (typeof window === 'undefined') {
    return DEFAULT_BROWSER_PREVIEW_SCENARIO_ID;
  }

  const params = new URLSearchParams(window.location.search);
  return sanitizeScenarioId(params.get('preview'));
};

const readScenarioSync = (scenarioId: string): BrowserPreviewScenario | null => {
  if (typeof XMLHttpRequest === 'undefined') {
    return null;
  }

  const request = new XMLHttpRequest();
  try {
    request.open('GET', `${SCENARIO_ENDPOINT_ROOT}/${scenarioId}.json`, false);
    request.send(null);
    if (request.status !== 200 || !request.responseText) {
      return null;
    }
    return JSON.parse(request.responseText) as BrowserPreviewScenario;
  } catch {
    return null;
  }
};

export const loadBrowserPreviewScenarioSync = (now: number): BrowserPreviewScenario => {
  const scenarioId = selectedScenarioId();
  const scenario = readScenarioSync(scenarioId)
    ?? (scenarioId === DEFAULT_BROWSER_PREVIEW_SCENARIO_ID ? null : readScenarioSync(DEFAULT_BROWSER_PREVIEW_SCENARIO_ID));

  return scenario ?? createMinimalBrowserPreviewScenario(now);
};

export const createMinimalBrowserPreviewScenario = (now: number): BrowserPreviewScenario => {
  const capturePath = '.browser-preview/captures/minimal-preview.rdc';
  const projectId = 'browser-preview-project';
  const sessionId = 'browser-preview-session';
  const runId = 'browser-preview-run';
  const captureId = 'browser-preview-capture';
  const contextId = 'browser-preview-context';

  const projects: ProjectRecord[] = [
    {
      projectId,
      name: 'Browser Preview Project',
      rootPath: '.browser-preview/projects/default',
      slug: 'browser-preview-project',
      resourcePath: '.browser-preview/projects/default/resources',
      knowledgePath: '.browser-preview/projects/default/knowledge',
      inputsPath: '.browser-preview/projects/default/inputs',
      inputs: [
        {
          inputId: captureId,
          fileName: 'minimal-preview.rdc',
          filePath: capturePath,
          source: 'project_resource',
          discoveredAt: now - 1000 * 60 * 30,
          lastModifiedAt: now - 1000 * 60 * 15,
          size: 1048576,
        },
      ],
      inputsUpdatedAt: now - 1000 * 60 * 12,
      createdAt: now - 1000 * 60 * 60,
      updatedAt: now - 1000 * 60 * 10,
      lastSessionId: sessionId,
    },
  ];

  const sessions: SessionRecord[] = [
    {
      sessionId,
      projectId,
      title: 'Browser Preview Session',
      goal: 'Preview renderer UI/UX without Electron IPC.',
      sessionPath: '.browser-preview/sessions/default',
      createdAt: now - 1000 * 60 * 50,
      updatedAt: now - 1000 * 60 * 8,
      lastRunId: runId,
    },
  ];

  const captures = [
    {
      id: captureId,
      filePath: capturePath,
      captureFileId: captureId,
      role: 'primary' as const,
      backendHint: 'local' as const,
      status: 'open' as const,
      sessionId,
      replaySessionId: 'browser-preview-replay',
      contextId,
    },
  ];

  const workflowState: WorkflowState = {
    caseId: 'browser-preview-case',
    runId,
    sessionId,
    currentStage: 'plan',
    previousStages: ['preflight', 'entry_gate', 'intake_gate'],
    entryMode: 'mcp',
    backend: 'local',
    orchestrationMode: 'multi_agent',
    coordinationMode: 'staged_handoff',
    blockers: [],
    planReadiness: 'strict_ready',
    approvalState: 'pending_user',
    debugPlan: null,
    pendingQuestions: null,
    reasoningSummaries: [],
    recoveryState: null,
    lastUpdated: new Date(now - 1000 * 60 * 4).toISOString(),
  };

  return {
    scenarioId: DEFAULT_BROWSER_PREVIEW_SCENARIO_ID,
    label: 'Browser Preview',
    projects,
    sessions,
    runs: [
      {
        runId,
        turnId: 'browser-preview-turn',
        projectId,
        sessionId,
        caseId: 'browser-preview-case',
        mode: 'debugger',
        goal: sessions[0].goal,
        captures,
        startedAt: now - 1000 * 60 * 8,
        status: 'awaiting_approval',
        lastStage: 'plan',
        backend: 'local',
      },
    ],
    currentProjectId: projectId,
    currentSessionId: sessionId,
    workflowState,
    openedCapture: {
      projectId,
      inputId: captureId,
      filePath: capturePath,
      captureId,
      captureFileId: captureId,
      sessionId,
      contextId,
      replaySessionId: 'browser-preview-replay',
      backend: 'local',
      deviceId: 'local',
      deviceLabel: 'Local Browser Preview',
      status: 'open',
      openedAt: now - 1000 * 60 * 8,
      preview: null,
    },
    contextSnapshot: {
      contextId,
      sessionId,
      backend: 'local',
      runtimeOwner: 'browser-preview',
      ownerLeaseId: 'browser-preview-lease',
      captureDescriptors: captures,
      activeCapture: captureId,
      deviceLabel: 'Local Browser Preview',
      humanPreview: {
        status: 'closed',
        updatedAt: now - 1000 * 60 * 4,
      },
    },
    devices: [
      {
        id: 'local',
        label: 'Local Browser Preview',
        type: 'local',
        status: 'online',
        transport: 'local',
        detailText: 'Browser preview replay mock',
        lastSeen: now,
      },
    ],
    runtimeLogs: [
      {
        id: 'browser-preview-log',
        timestamp: now - 1000 * 60 * 5,
        scope: 'app',
        namespace: 'system',
        severity: 'info',
        title: 'Browser Preview fallback active',
        summary: 'Renderer is using an in-memory Electron API mock.',
        projectId,
        sessionId: null,
        runId: null,
      },
    ],
    conversations: {
      [sessionId]: [
        {
          id: 'browser-preview-user',
          turnId: 'browser-preview-turn',
          sessionId,
          projectId,
          runId,
          modeContext: 'debugger',
          role: 'user',
          content: 'Open the browser preview session.',
          status: 'complete',
          attachments: [],
          createdAt: now - 1000 * 60 * 6,
          updatedAt: now - 1000 * 60 * 6,
        },
        {
          id: 'browser-preview-assistant',
          turnId: 'browser-preview-turn',
          sessionId,
          projectId,
          runId,
          modeContext: 'debugger',
          role: 'assistant',
          agentId: 'rdc-debugger',
          content: 'Browser Preview is ready. Real Electron IPC is not available in this browser.',
          status: 'complete',
          reasoningTrace: {
            status: 'complete',
            summary: 'Browser preview response',
            steps: [],
            updatedAt: now - 1000 * 60 * 5,
          },
          attachments: [],
          createdAt: now - 1000 * 60 * 5,
          updatedAt: now - 1000 * 60 * 5,
        },
      ],
    },
    actionEvents: [],
    usage: {
      runId,
      providerId: 'browser-preview',
      modelId: 'browser-preview-model',
      inputTokens: 1200,
      outputTokens: 360,
      totalTokens: 1560,
      contextWindowTokens: 8192,
      usagePercent: 19,
      hasConfiguredContextWindow: true,
    },
  };
};
