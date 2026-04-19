import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { ControlPanel } from './components/ControlPanel';
import { DeviceSelector } from './components/DeviceSelector';
import { Sidebar } from './components/Sidebar';
import { UserMenu } from './components/UserMenu';
import { SettingsModal } from './components/SettingsModal';
import { TerminalDrawer } from './components/TerminalDrawer';
import { ModeGlyph } from './components/ModeGlyph';
import { useLayoutStore } from './stores/layoutStore';
import { useSessionStore } from './stores/sessionStore';
import { useDeviceStore } from './stores/deviceStore';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { useTerminalStore } from './stores/terminalStore';
import { useI18n } from './i18n';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type {
  ConversationAttachmentInput,
  ConversationMessage,
  ConversationReasoningTrace,
  ConversationStreamEvent,
} from '@shared/types/conversation';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { AppSettings, ResolvedTheme } from '@shared/types/settings';
import type { ActionEvent } from '@shared/types/evidence';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { WorkflowState } from '@shared/types/workflow';
import { AGENT_MODES } from '@shared/constants/agents';
import {
  APP_MIN_MAIN_WIDTH,
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '@shared/constants/layout';

type DragSide = 'left' | 'right';
type RightRailMode = 'hidden' | 'project' | 'session';

interface PendingAttachmentDraft extends ConversationAttachmentInput {
  id: string;
  kind: SessionAttachmentRecord['kind'];
  isCapture: boolean;
}

interface WorkbenchSeedState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  currentRunUsage?: RunContextUsageSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  conversationMessages?: ConversationMessage[];
  timeline: AgentTimelineEntry[];
  actionEvents?: ActionEvent[];
  workflowState?: WorkflowState | null;
  runs?: RunSummary[];
}

type E2EWindow = Window & {
  __RDC_AGENT_E2E__?: {
    seedWorkbenchState: (state: WorkbenchSeedState) => void;
    resetWorkbenchState: () => void;
    getWorkbenchState: () => WorkbenchSeedState;
    setAppSettings: (settings: AppSettings) => void;
    setComposerDraftState: (state: {
      promptValue?: string;
      pendingAttachments?: PendingAttachmentDraft[];
      currentMode?: 'debugger' | 'analyzer' | 'optimizer';
    }) => void;
  };
};

const reduceOverflow = (
  desired: number,
  minimum: number,
  overflow: number,
): { width: number; remainingOverflow: number } => {
  const reducible = Math.max(0, desired - minimum);
  const reduction = Math.min(reducible, overflow);
  return {
    width: desired - reduction,
    remainingOverflow: overflow - reduction,
  };
};

const getResponsiveMinMainWidth = (containerWidth: number): number => {
  if (containerWidth <= 420) {
    return 240;
  }
  if (containerWidth <= 720) {
    return 280;
  }
  if (containerWidth <= 960) {
    return 360;
  }
  return APP_MIN_MAIN_WIDTH;
};

const getWorkbenchRailMaxWidth = (
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  rightVisible: boolean,
): string => {
  if (!rightVisible) {
    return leftCollapsed ? 'min(1400px, 94%)' : 'min(1520px, 100%)';
  }

  if (leftCollapsed && rightCollapsed) {
    return 'min(1180px, 64%)';
  }

  if (leftCollapsed || rightCollapsed) {
    return 'min(1320px, 88%)';
  }

  return 'min(1440px, 96%)';
};

const getResizeHandleAllowance = (
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  rightVisible: boolean,
): number => (
  (leftCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH)
  + (!rightVisible || rightCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH)
);

const canFitLayout = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  minMainWidth: number,
  rightVisible: boolean,
): boolean => {
  const desiredLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth;
  const desiredRight = !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth);
  const availableSidebarSpace = Math.max(
    0,
    containerWidth - minMainWidth - getResizeHandleAllowance(leftCollapsed, rightCollapsed, rightVisible),
  );
  return desiredLeft + desiredRight <= availableSidebarSpace;
};

const resolveResponsiveSidebarState = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  rightVisible: boolean,
): { leftCollapsed: boolean; rightCollapsed: boolean; minMainWidth: number } => {
  if (containerWidth <= 0) {
    return {
      leftCollapsed,
      rightCollapsed,
      minMainWidth: APP_MIN_MAIN_WIDTH,
    };
  }

  const minMainWidth = getResponsiveMinMainWidth(containerWidth);
  let nextLeftCollapsed = leftCollapsed;
  let nextRightCollapsed = rightVisible ? rightCollapsed : true;

  if (!canFitLayout(containerWidth, leftWidth, rightWidth, nextLeftCollapsed, nextRightCollapsed, minMainWidth, rightVisible)) {
    nextRightCollapsed = true;
  }

  if (!canFitLayout(containerWidth, leftWidth, rightWidth, nextLeftCollapsed, nextRightCollapsed, minMainWidth, rightVisible)) {
    nextLeftCollapsed = true;
  }

  return {
    leftCollapsed: nextLeftCollapsed,
    rightCollapsed: nextRightCollapsed,
    minMainWidth,
  };
};

const resolveSidebarWidths = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  minMainWidth: number,
  rightVisible: boolean,
): { left: number; right: number } => {
  if (containerWidth <= 0) {
    return {
      left: leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth,
      right: !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth),
    };
  }

  const desiredLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth;
  const desiredRight = !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth);
  const minLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : LEFT_SIDEBAR_MIN_WIDTH;
  const minRight = !rightVisible ? 0 : (rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : RIGHT_PANEL_MIN_WIDTH);
  const availableSidebarSpace = Math.max(
    0,
    containerWidth - minMainWidth - getResizeHandleAllowance(leftCollapsed, rightCollapsed, rightVisible),
  );
  const desiredTotal = desiredLeft + desiredRight;

  if (desiredTotal <= availableSidebarSpace) {
    return { left: desiredLeft, right: desiredRight };
  }

  let overflow = desiredTotal - availableSidebarSpace;
  const leftPass = reduceOverflow(desiredLeft, minLeft, overflow);
  overflow = leftPass.remainingOverflow;
  const rightPass = reduceOverflow(desiredRight, minRight, overflow);
  overflow = rightPass.remainingOverflow;

  if (overflow > 0) {
    const secondLeftPass = reduceOverflow(leftPass.width, minLeft, overflow);
    overflow = secondLeftPass.remainingOverflow;
    const secondRightPass = reduceOverflow(rightPass.width, minRight, overflow);
    return {
      left: Math.round(secondLeftPass.width),
      right: Math.round(secondRightPass.width),
    };
  }

  return {
    left: Math.round(leftPass.width),
    right: Math.round(rightPass.width),
  };
};

const mergeCapturesWithSnapshot = (
  currentCaptures: CaptureDescriptor[],
  snapshot: ContextSnapshot,
): CaptureDescriptor[] => {
  if (!snapshot.captureDescriptors?.length) {
    return currentCaptures;
  }

  const incomingById = new Map(snapshot.captureDescriptors.map((capture) => [capture.id, capture]));
  const merged = currentCaptures.map((capture) => {
    const incoming = incomingById.get(capture.id);
    return incoming ? { ...capture, ...incoming } : capture;
  });

  snapshot.captureDescriptors.forEach((capture) => {
    if (!merged.some((entry) => entry.id === capture.id)) {
      merged.push(capture);
    }
  });

  return merged;
};

const mapActionEventToTimelineEntry = (event: ActionEvent): AgentTimelineEntry | null => {
  switch (event.event_type) {
    case 'user_message':
      if (String(event.payload.role || 'user') !== 'user') {
        return null;
      }
      return {
        id: event.event_id,
        type: 'user',
        content: String(event.payload.content || ''),
        timestamp: event.ts_ms,
      };
    case 'agent_summary':
      if (String(event.payload.role || '') === 'assistant') {
        return {
          id: event.event_id,
          type: 'agent',
          agentRole: event.agent_id as AgentTimelineEntry['agentRole'],
          content: String(event.payload.content || event.payload.summary || ''),
          actionEvent: event,
          timestamp: event.ts_ms,
        };
      }
      return null;
    case 'system':
      if (!event.payload.message) {
        return null;
      }
      return {
        id: event.event_id,
        type: 'system',
        title: 'System',
        status: event.status,
        content: String(event.payload.message || ''),
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'report_published':
      return {
        id: event.event_id,
        type: 'system',
        title: 'Report',
        content: `璋冭瘯鎶ュ憡宸茬敓鎴愶細${String(event.payload.htmlPath || event.payload.markdownPath || 'reports ready')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    default:
      return null;
  }
};

const cloneReasoningTrace = (trace: ConversationReasoningTrace | null | undefined): ConversationReasoningTrace => (
  trace
    ? {
        ...trace,
        steps: trace.steps.map((step) => ({
          ...step,
          toolCalls: step.toolCalls.map((toolCall) => ({ ...toolCall })),
        })),
      }
    : {
        status: 'idle',
        steps: [],
        updatedAt: Date.now(),
      }
);

const upsertReasoningStep = (
  trace: ConversationReasoningTrace | null | undefined,
  stepId: string,
  patch: {
    title: string;
    stage?: string;
    status: 'pending' | 'running' | 'complete' | 'error';
    summary?: string;
    detail?: string;
    completedAt?: number;
  },
): ConversationReasoningTrace => {
  const nextTrace = cloneReasoningTrace(trace);
  const nextIndex = nextTrace.steps.findIndex((step) => step.id === stepId);
  if (nextIndex >= 0) {
    nextTrace.steps[nextIndex] = {
      ...nextTrace.steps[nextIndex],
      ...patch,
    };
  } else {
    nextTrace.steps.push({
      id: stepId,
      title: patch.title,
      stage: patch.stage,
      status: patch.status,
      summary: patch.summary,
      detail: patch.detail,
      toolCalls: [],
      startedAt: Date.now(),
      completedAt: patch.completedAt,
    });
  }
  nextTrace.status = patch.status === 'error' ? 'error' : 'running';
  nextTrace.updatedAt = Date.now();
  return nextTrace;
};

const applyToolTraceToMessage = (message: ConversationMessage, trace: ToolTraceEntry): ConversationMessage => {
  const nextTrace = upsertReasoningStep(message.reasoningTrace, 'tool-execution', {
    title: '工具调用',
    stage: 'investigate',
    status: trace.result.ok ? 'running' : 'error',
    summary: trace.result.ok ? '正在执行工具调用。' : '工具调用失败。',
  });
  const step = nextTrace.steps.find((entry) => entry.id === 'tool-execution');
  if (step) {
    const existingIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === trace.traceId);
    const nextToolCall = {
      id: trace.traceId,
      toolName: trace.toolName,
      status: trace.result.ok ? 'complete' as const : 'error' as const,
      argsPreview: JSON.stringify(trace.args, null, 2),
      resultPreview: trace.result.ok
        ? JSON.stringify(trace.result.data ?? trace.result.artifacts ?? {}, null, 2)
        : trace.result.error?.message,
      error: trace.result.error?.message,
      startedAt: trace.timestamp,
      completedAt: trace.timestamp + trace.result.duration_ms,
    };

    if (existingIndex >= 0) {
      step.toolCalls[existingIndex] = nextToolCall;
    } else {
      step.toolCalls.push(nextToolCall);
    }
    step.status = step.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
    step.summary = step.status === 'error'
      ? '工具调用中出现错误。'
      : `已记录 ${step.toolCalls.length} 个工具调用。`;
    step.completedAt = Date.now();
  }

  nextTrace.status = step?.status === 'error' ? 'error' : 'running';

  return {
    ...message,
    reasoningTrace: nextTrace,
    updatedAt: Date.now(),
  };
};

const applyActionEventToMessage = (message: ConversationMessage, event: ActionEvent): ConversationMessage => {
  if (!event.turn_id || message.turnId !== event.turn_id || message.role !== 'assistant') {
    return message;
  }

  const nextTrace = cloneReasoningTrace(message.reasoningTrace);
  const eventTime = event.ts_ms;

  if (event.event_type === 'tool_execution') {
    const stepTrace = upsertReasoningStep(nextTrace, 'tool-execution', {
      title: '工具调用',
      stage: 'investigate',
      status: event.status === 'error' ? 'error' : 'running',
      summary: event.status === 'error' ? '工具调用失败。' : '正在记录工具调用。',
    });
    const step = stepTrace.steps.find((entry) => entry.id === 'tool-execution');
    if (step) {
      const toolName = String(event.payload.tool_name || 'unknown_tool');
      const existingIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === event.event_id);
      const nextToolCall = {
        id: event.event_id,
        toolName,
        status: event.status === 'error' ? 'error' as const : 'complete' as const,
        argsPreview: JSON.stringify(event.payload.args ?? {}, null, 2),
        resultPreview: event.status === 'error'
          ? String((event.payload.error as { message?: string } | undefined)?.message || event.payload.error || 'Tool execution failed')
          : JSON.stringify(event.payload.data ?? event.payload.result ?? {}, null, 2),
        error: event.status === 'error'
          ? String((event.payload.error as { message?: string } | undefined)?.message || event.payload.error || 'Tool execution failed')
          : undefined,
        startedAt: eventTime,
        completedAt: eventTime + event.duration_ms,
      };
      if (existingIndex >= 0) {
        step.toolCalls[existingIndex] = nextToolCall;
      } else {
        step.toolCalls.push(nextToolCall);
      }
      step.status = step.toolCalls.some((toolCall) => toolCall.status === 'error') ? 'error' : 'complete';
      step.summary = step.status === 'error'
        ? '工具调用中出现错误。'
        : `已记录 ${step.toolCalls.length} 个工具调用。`;
      step.completedAt = eventTime + event.duration_ms;
    }
    return {
      ...message,
      reasoningTrace: stepTrace,
      updatedAt: Date.now(),
    };
  }

  const stage = typeof event.payload.toStage === 'string'
    ? event.payload.toStage
    : typeof event.payload.stage === 'string'
      ? event.payload.stage
      : undefined;
  const stepId = `${event.event_type}:${stage || event.event_id}`;
  const summary = String(
    event.payload.summary
    || event.payload.reason
    || event.payload.objective
    || event.payload.content
    || event.payload.verdict
    || event.payload.toStage
    || event.event_type,
  );
  const nextStepTrace = upsertReasoningStep(nextTrace, stepId, {
    title: stage ? `阶段：${stage}` : event.event_type,
    stage,
    status: event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
      ? 'error'
      : 'complete',
    summary,
    detail: JSON.stringify(event.payload, null, 2),
    completedAt: eventTime + event.duration_ms,
  });
  nextStepTrace.status = event.status === 'error' || event.status === 'blocked' || event.status === 'fail'
    ? 'error'
    : 'running';

  return {
    ...message,
    reasoningTrace: nextStepTrace,
    updatedAt: Date.now(),
  };
};

const hydrateMessagesWithActionEvents = (
  messages: ConversationMessage[],
  events: ActionEvent[],
): ConversationMessage[] => {
  const sortedEvents = events
    .slice()
    .sort((left, right) => left.ts_ms - right.ts_ms);

  return messages.map((message) => (
    sortedEvents.reduce((currentMessage, event) => applyActionEventToMessage(currentMessage, event), message)
  ));
};

const inferAttachmentKind = (filePath: string): SessionAttachmentRecord['kind'] =>
  /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath) ? 'image' : 'file';

const inferAttachmentMimeType = (filePath: string): string => {
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const mimeByExtension: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.7z': 'application/x-7z-compressed',
    '.log': 'text/plain',
    '.rdc': 'application/octet-stream',
  };

  return mimeByExtension[extension] || 'application/octet-stream';
};

const formatBytes = (size: number | null | undefined): string => {
  if (!size || size <= 0) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const formatTokenCount = (value: number): string => new Intl.NumberFormat('en-US').format(value);

const buildUsageCopy = (
  usage: RunContextUsageSummary | null,
  language: string,
): { ariaLabel: string; lineOne: string; lineTwo: string } => {
  const usagePercent = usage?.usagePercent ?? 0;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;

  if (language === 'zh-CN') {
    return {
      ariaLabel: usage?.hasConfiguredContextWindow
        ? `上下文窗口已用 ${usagePercent}%，输入 ${formatTokenCount(inputTokens)}，输出 ${formatTokenCount(outputTokens)}，总计 ${formatTokenCount(totalTokens)}，窗口上限 ${formatTokenCount(usage.contextWindowTokens ?? 0)}`
        : `上下文窗口已用 ${usagePercent}%，输入 ${formatTokenCount(inputTokens)}，输出 ${formatTokenCount(outputTokens)}，总计 ${formatTokenCount(totalTokens)}，当前模型未配置窗口上限`,
      lineOne: usage?.hasConfiguredContextWindow
        ? `已用 ${usagePercent}% · 窗口 ${formatTokenCount(usage.contextWindowTokens ?? 0)}`
        : `已用 ${usagePercent}% · 窗口未配置`,
      lineTwo: `输入 ${formatTokenCount(inputTokens)} · 输出 ${formatTokenCount(outputTokens)} · 总计 ${formatTokenCount(totalTokens)}`,
    };
  }

  return {
    ariaLabel: usage?.hasConfiguredContextWindow
      ? `Context window ${usagePercent}% used. Input ${formatTokenCount(inputTokens)}, output ${formatTokenCount(outputTokens)}, total ${formatTokenCount(totalTokens)}, window ${formatTokenCount(usage.contextWindowTokens ?? 0)}.`
      : `Context window ${usagePercent}% used. Input ${formatTokenCount(inputTokens)}, output ${formatTokenCount(outputTokens)}, total ${formatTokenCount(totalTokens)}. No context window configured for this model.`,
    lineOne: usage?.hasConfiguredContextWindow
      ? `${usagePercent}% used · window ${formatTokenCount(usage.contextWindowTokens ?? 0)}`
      : `${usagePercent}% used · window not set`,
    lineTwo: `In ${formatTokenCount(inputTokens)} · Out ${formatTokenCount(outputTokens)} · Total ${formatTokenCount(totalTokens)}`,
  };
};

const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  language: string;
}> = ({ usage, language }) => {
  const usagePercent = usage?.usagePercent ?? 0;
  const normalizedPercent = Math.max(0, Math.min(100, usagePercent));
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (normalizedPercent / 100));
  const copy = buildUsageCopy(usage, language);

  return (
    <div
      className={`composer-usage-indicator ${usage?.hasConfiguredContextWindow ? 'is-configured' : 'is-unconfigured'}`}
      data-testid="composer-usage-indicator"
      tabIndex={0}
      role="img"
      aria-label={copy.ariaLabel}
    >
      <svg className="composer-usage-ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="composer-usage-ring-track" cx="22" cy="22" r={radius} />
        <circle
          className="composer-usage-ring-progress"
          cx="22"
          cy="22"
          r={radius}
          style={{
            strokeDasharray: `${circumference} ${circumference}`,
            strokeDashoffset: dashOffset,
          }}
        />
      </svg>
      <span className="composer-usage-value">{normalizedPercent}%</span>
      <div className="composer-usage-tooltip" role="tooltip">
        <div className="composer-usage-tooltip-line composer-usage-tooltip-line-strong">{copy.lineOne}</div>
        <div className="composer-usage-tooltip-line">{copy.lineTwo}</div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { t, language } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<DOMRect | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [appBodyWidth, setAppBodyWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [isPromptSending, setIsPromptSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentDraft[]>([]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const appBodyRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ side: DragSide; startX: number; startWidth: number } | null>(null);

  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const currentRunUsage = useSessionStore((state) => state.currentRunUsage);
  const currentMode = useLayoutStore((state) => state.currentMode);
  const leftSidebarCollapsed = useLayoutStore((state) => state.leftSidebarCollapsed);
  const rightPanelCollapsed = useLayoutStore((state) => state.rightPanelCollapsed);
  const leftSidebarWidth = useLayoutStore((state) => state.leftSidebarWidth);
  const rightPanelWidth = useLayoutStore((state) => state.rightPanelWidth);
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const setLeftSidebarWidth = useLayoutStore((state) => state.setLeftSidebarWidth);
  const setRightPanelWidth = useLayoutStore((state) => state.setRightPanelWidth);
  const toggleLeftSidebar = useLayoutStore((state) => state.toggleLeftSidebar);
  const toggleRightPanel = useLayoutStore((state) => state.toggleRightPanel);
  const persistLayout = useLayoutStore((state) => state.persistLayout);
  const hydrateLayout = useLayoutStore((state) => state.hydrateFromSettings);

  const settings = useAppSettingsStore((state) => state.settings);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const hydrateSettings = useAppSettingsStore((state) => state.hydrate);
  const setSystemTheme = useAppSettingsStore((state) => state.setSystemTheme);
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);

  const resolvedTheme: ResolvedTheme = settings.appearance.theme === 'system'
    ? systemTheme
    : settings.appearance.theme;
  const nickname = settings.profile.nickname || t('sidebar.userName');
  const showWorkbenchShell = true;
  const hasActiveDebugRun = Boolean(currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(currentRun.status));
  const rightRailMode: RightRailMode = !currentProject
    ? 'hidden'
    : currentSession
      ? 'session'
      : 'project';
  const isRightRailVisible = rightRailMode !== 'hidden';
  const isTerminalOpen = useTerminalStore((state) => state.isOpen);
  const toggleTerminalOpen = useTerminalStore((state) => state.toggleOpen);

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setCurrentRunUsage = useSessionStore((state) => state.setCurrentRunUsage);
  const setSessions = useSessionStore((state) => state.setSessions);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const addActionEvent = useSessionStore((state) => state.addActionEvent);
  const setWorkflowState = useSessionStore((state) => state.setWorkflowState);
  const setCurrentDebugPlan = useSessionStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useSessionStore((state) => state.setPendingQuestions);
  const setReasoningSummaries = useSessionStore((state) => state.setReasoningSummaries);
  const setConversationMessages = useSessionStore((state) => state.setConversationMessages);
  const upsertConversationMessages = useSessionStore((state) => state.upsertConversationMessages);
  const setActiveTerminalSessionId = useTerminalStore((state) => state.setActiveSessionId);

  const syncCapturesFromSnapshot = useCallback((snapshot: ContextSnapshot) => {
    if (!snapshot.captureDescriptors?.length) {
      return;
    }

    if (useSessionStore.getState().currentRun) {
      useSessionStore.getState().setCaptures(snapshot.captureDescriptors ?? []);
      return;
    }

    useSessionStore.getState().setCaptures(
      mergeCapturesWithSnapshot(useSessionStore.getState().captures, snapshot),
    );
  }, []);
  const responsiveSidebarState = useMemo(
    () => resolveResponsiveSidebarState(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      leftSidebarCollapsed,
      rightPanelCollapsed,
      isRightRailVisible,
    ),
    [appBodyWidth, isRightRailVisible, leftSidebarCollapsed, leftSidebarWidth, rightPanelCollapsed, rightPanelWidth],
  );
  const effectiveLeftCollapsed = responsiveSidebarState.leftCollapsed;
  const effectiveRightCollapsed = isRightRailVisible ? responsiveSidebarState.rightCollapsed : true;
  const bothSidebarsCollapsed = effectiveLeftCollapsed && (!isRightRailVisible || effectiveRightCollapsed);
  const workbenchRailMaxWidth = getWorkbenchRailMaxWidth(
    effectiveLeftCollapsed,
    effectiveRightCollapsed,
    isRightRailVisible,
  );
  const leftAutoCollapsed = !leftSidebarCollapsed && effectiveLeftCollapsed;
  const rightAutoCollapsed = isRightRailVisible && !rightPanelCollapsed && effectiveRightCollapsed;
  const leftToggleDisabled = leftAutoCollapsed;
  const rightToggleDisabled = !isRightRailVisible || rightAutoCollapsed;

  useEffect(() => {
    if (!shellNotice) return;
    const timeoutId = window.setTimeout(() => setShellNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [shellNotice]);

  useEffect(() => {
    setPendingAttachments([]);
  }, [currentProject?.projectId]);

  useEffect(() => {
    if (!modeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!modeMenuRef.current?.contains(target)) {
        setModeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModeMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    const textarea = promptInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [currentMode, promptValue]);

  useEffect(() => {
    setActiveTerminalSessionId(currentSession?.sessionId ?? null);
  }, [currentSession?.sessionId, setActiveTerminalSessionId]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    if (!currentSession?.sessionId) {
      setConversationMessages([]);
      return;
    }

    void (async () => {
      const [historyResult, evidenceResult] = await Promise.all([
        electronAPI.conversation.getHistory(currentSession.sessionId).catch(() => ({ messages: [] })),
        electronAPI.evidence.getChain().catch(() => ({ events: [] as ActionEvent[] })),
      ]);
      setConversationMessages(hydrateMessagesWithActionEvents(
        historyResult.messages ?? [],
        (evidenceResult.events ?? []) as ActionEvent[],
      ));
    })();
  }, [currentSession?.sessionId, setConversationMessages]);

  useEffect(() => {
    if (!navigator.webdriver) return;

    const target = window as E2EWindow;
    target.__RDC_AGENT_E2E__ = {
      seedWorkbenchState: (state) => {
        const store = useSessionStore.getState();
        store.setProjects(state.projects);
        store.setSessions(state.sessions);
        store.setCurrentProject(state.currentProject);
        store.setCurrentSession(state.currentSession);
        store.setCurrentRun(state.currentRun);
        store.setCurrentRunUsage(state.currentRunUsage ?? null);
        store.setContextSnapshot(state.contextSnapshot);
        store.setCaptures(state.captures);
        store.setProjectInputs(state.projectInputs);
        store.setOpenedCapture(state.openedCapture);
        store.setConversationMessages(state.conversationMessages ?? []);
        store.setTimeline(state.timeline);
        store.setActionEvents(state.actionEvents ?? []);
        store.setWorkflowState(state.workflowState ?? null);
        store.setCurrentDebugPlan(state.workflowState?.debugPlan ?? null);
        store.setPendingQuestions(state.workflowState?.pendingQuestions ?? null);
        store.setReasoningSummaries(state.workflowState?.reasoningSummaries ?? []);
        store.setRuns(state.runs ?? []);
      },
      resetWorkbenchState: () => {
        const store = useSessionStore.getState();
        store.setProjects([]);
        store.setSessions([]);
        store.setCurrentProject(null);
        store.setCurrentSession(null);
        store.setCurrentRun(null);
        store.setCurrentRunUsage(null);
        store.setContextSnapshot(null);
        store.setCaptures([]);
        store.setProjectInputs([]);
        store.setOpenedCapture(null);
        store.setConversationMessages([]);
        store.setTimeline([]);
        store.setActionEvents([]);
        store.setWorkflowState(null);
        store.setCurrentDebugPlan(null);
        store.setPendingQuestions(null);
        store.setReasoningSummaries([]);
        store.setRuns([]);
      },
      getWorkbenchState: () => {
        const store = useSessionStore.getState();
        return {
          projects: store.projects,
          sessions: store.sessions,
          currentProject: store.currentProject,
          currentSession: store.currentSession,
          currentRun: store.currentRun,
          currentRunUsage: store.currentRunUsage,
          contextSnapshot: store.contextSnapshot,
          captures: store.captures,
          projectInputs: store.projectInputs,
          openedCapture: store.openedCapture,
          conversationMessages: store.conversationMessages,
          timeline: store.timeline,
          actionEvents: store.actionEvents,
          workflowState: store.workflowState,
          runs: store.runs,
        };
      },
      setAppSettings: (nextSettings) => {
        useAppSettingsStore.getState().hydrate(nextSettings, useAppSettingsStore.getState().systemTheme);
      },
      setComposerDraftState: (state) => {
        if (typeof state.promptValue === 'string') {
          setPromptValue(state.promptValue);
        }
        if (Array.isArray(state.pendingAttachments)) {
          setPendingAttachments(state.pendingAttachments);
        }
        if (state.currentMode) {
          useLayoutStore.getState().setCurrentMode(state.currentMode);
        }
      },
    };

    return () => {
      delete target.__RDC_AGENT_E2E__;
    };
  }, []);

  useEffect(() => {
    if (!showWorkbenchShell) return;
    const node = appBodyRef.current;
    if (!node) return;

    const syncAppBodyWidth = () => {
      setAppBodyWidth(Math.max(0, Math.round(window.innerWidth)));
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAppBodyWidth(Math.max(0, Math.round(entry.contentRect.width)));
      }
    });

    observer.observe(node);
    syncAppBodyWidth();
    window.addEventListener('resize', syncAppBodyWidth);
    const intervalId = window.setInterval(syncAppBodyWidth, 160);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncAppBodyWidth);
      window.clearInterval(intervalId);
    };
  }, [showWorkbenchShell]);

  useEffect(() => {
    document.documentElement.lang = settings.appearance.language;
    document.documentElement.dataset.theme = settings.appearance.theme;
    document.documentElement.dataset.resolvedTheme = resolvedTheme;
    document.documentElement.dataset.fontScale = settings.appearance.fontScale;
  }, [resolvedTheme, settings.appearance]);

  useEffect(() => {
    const initApp = async () => {
      try {
        const electronAPI = window.electronAPI;
        if (!electronAPI) {
          setConnectionStatus('offline');
          return;
        }

        const [appSettings, appMeta, isMaximized] = await Promise.all([
          electronAPI.settings.get(),
          electronAPI.appMeta.get(),
          electronAPI.windowControls.isMaximized(),
        ]);

        hydrateSettings(appSettings, appMeta.systemTheme);
        hydrateLayout(appSettings);
        setWindowMaximized(isMaximized);
        setConnectionStatus('connected');
      } catch (error) {
        console.error('Failed to initialize app shell:', error);
        setConnectionStatus('degraded');
      } finally {
        window.setTimeout(() => setIsLoading(false), 320);
      }
    };

    void initApp();
  }, [hydrateLayout, hydrateSettings]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !currentRun?.runId || !hasActiveDebugRun) {
      setCurrentRunUsage(null);
      return;
    }

    if (navigator.webdriver && currentRunUsage?.runId === currentRun.runId) {
      return;
    }

    let cancelled = false;
    void electronAPI.workflow.getRunUsage(currentRun.runId)
      .then((result) => {
        if (!cancelled) {
          setCurrentRunUsage(result.usage ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentRunUsage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentRun?.runId, currentRunUsage?.runId, hasActiveDebugRun, setCurrentRunUsage]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    electronAPI.events.onRunStatusChanged((rawPayload) => {
      const payload = rawPayload as {
        runId: string;
        sessionId: string;
        status: RunSummary['status'];
        lastStage?: string;
        stopReason?: string;
      };
      const current = useSessionStore.getState().currentRun;
      if (!current || current.runId !== payload.runId) {
        return;
      }
      useSessionStore.getState().setCurrentRun({
        ...current,
        status: payload.status,
        lastStage: payload.lastStage || current.lastStage,
        stopReason: payload.stopReason || current.stopReason,
      });
      if (!['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(payload.status)) {
        useSessionStore.getState().setCurrentRunUsage(null);
      }
    });

    electronAPI.events.onRunUsageChanged((summary) => {
      const activeRun = useSessionStore.getState().currentRun;
      if (activeRun?.runId === summary.runId) {
        useSessionStore.getState().setCurrentRunUsage(summary);
      }
    });

    electronAPI.events.onContextChanged((snapshot) => {
      useSessionStore.getState().setContextSnapshot(snapshot);
      syncCapturesFromSnapshot(snapshot);
    });

    const handleConversationEvent = (event: ConversationStreamEvent) => {
      const store = useSessionStore.getState();
      if (event.type === 'run_linked') {
        store.patchAssistantMessageByTurnId(event.turnId, { runId: event.runId });
        return;
      }
      store.upsertConversationMessage(event.message);
    };

    electronAPI.conversation.onEvent(handleConversationEvent);

    electronAPI.events.onToolExecutionComplete((rawTrace) => {
      const trace = rawTrace as ToolTraceEntry;
      const lastEntry = useSessionStore.getState().timeline[useSessionStore.getState().timeline.length - 1];
      if (lastEntry?.id !== trace.traceId) {
        useSessionStore.getState().addTimelineEntry({
          id: trace.traceId,
          type: 'tool_call',
          content: trace.toolName,
          toolTrace: trace,
          timestamp: trace.timestamp,
        });
      }
      if (trace.turnId) {
        useSessionStore.getState().updateAssistantMessageByTurnId(trace.turnId, (message) => applyToolTraceToMessage(message, trace));
      }
    });

    electronAPI.events.onAgentMessage((rawMsg) => {
      const msg = rawMsg as { id?: string; agentRole?: AgentTimelineEntry['agentRole']; content?: string };
      const entry: AgentTimelineEntry = {
        id: msg.id || Date.now().toString(),
        type: 'agent',
        agentRole: msg.agentRole,
        content: msg.content ?? '',
        timestamp: Date.now(),
      };
      useSessionStore.getState().addTimelineEntry(entry);
    });

    electronAPI.events.onCaptureStatusChanged(() => {
      electronAPI.context.get().then((snapshot) => {
        useSessionStore.getState().setContextSnapshot(snapshot);
        syncCapturesFromSnapshot(snapshot);
      }).catch(() => undefined);
    });

    electronAPI.events.onEvidenceEventAdded((rawEvent) => {
      const event = rawEvent as ActionEvent;
      addActionEvent(event);
      const entry = mapActionEventToTimelineEntry(event);
      if (entry) {
        useSessionStore.getState().addTimelineEntry(entry);
      }
      if (event.turn_id) {
        useSessionStore.getState().updateAssistantMessageByTurnId(event.turn_id, (message) => applyActionEventToMessage(message, event));
      }
    });

    electronAPI.events.onWorkflowStateChanged((rawState) => {
      const state = rawState as WorkflowState;
      setWorkflowState(state);
      setCurrentDebugPlan(state.debugPlan ?? null);
      setPendingQuestions(state.pendingQuestions ?? null);
      setReasoningSummaries(state.reasoningSummaries ?? []);
      const currentProject = useSessionStore.getState().currentProject;
      const currentSession = useSessionStore.getState().currentSession;

      if (currentProject) {
        electronAPI.session.list(currentProject.projectId)
          .then((result) => useSessionStore.getState().setSessions(result.sessions ?? []))
          .catch(() => undefined);
      }

      if (currentSession) {
        electronAPI.run.list(currentSession.sessionId)
          .then((result) => {
            useSessionStore.getState().setRuns(result.runs ?? []);
            const targetRunId = state.runId || useSessionStore.getState().currentRun?.runId;
            const activeRun = result.runs?.find((run) => run.runId === targetRunId)
              ?? result.runs?.[0]
              ?? null;
            if (activeRun) {
              useSessionStore.getState().setCurrentRun(activeRun);
              useSessionStore.getState().setCaptures(activeRun.captures ?? []);
            }
          })
          .catch(() => undefined);

        electronAPI.evidence.getChain()
          .then((result) => {
            useSessionStore.getState().setActionEvents(result.events ?? []);
            const timeline = (result.events ?? [])
              .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
              .filter((entry): entry is AgentTimelineEntry => entry !== null);
            useSessionStore.getState().setTimeline(timeline);
            useSessionStore.getState().setConversationMessages(
              hydrateMessagesWithActionEvents(
                useSessionStore.getState().conversationMessages,
                (result.events ?? []) as ActionEvent[],
              ),
            );
          })
          .catch(() => undefined);
      }
    });

    electronAPI.events.onRunStatusChanged((rawPayload) => {
      const payload = rawPayload as {
        runId: string;
        sessionId: string;
        status: RunSummary['status'];
        lastStage?: string;
        stopReason?: string;
      };
      const store = useSessionStore.getState();
      const current = store.currentRun;
      if (current?.runId === payload.runId) {
        store.setCurrentRun({
          ...current,
          status: payload.status,
          lastStage: payload.lastStage || current.lastStage,
          stopReason: payload.stopReason || current.stopReason,
          stoppedAt: ['cancelled', 'interrupted'].includes(payload.status) ? Date.now() : current.stoppedAt,
        });
        if (!['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(payload.status)) {
          store.setCurrentRunUsage(null);
        }
      }
    });

    electronAPI.events.onDeviceStatusChanged((payload) => {
      useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
    });

    electronAPI.events.onProjectInputsChanged((payload) => {
      const activeProject = useSessionStore.getState().currentProject;
      if (activeProject?.projectId === payload.projectId) {
        useSessionStore.getState().setProjectInputs(payload.inputs);
      }
    });

    electronAPI.events.onOpenedCaptureStateChanged((state) => {
      useSessionStore.getState().setOpenedCapture(state);
    });

    electronAPI.events.onRuntimeLogAppended((entry) => {
      useTerminalStore.getState().appendEntry(entry as RuntimeLogEntry);
    });

    electronAPI.events.onAppThemeChanged((theme) => {
      setSystemTheme(theme);
    });

    void useDeviceStore.getState().loadDevices();
    void electronAPI.capture.getOpenedState()
      .then((state) => useSessionStore.getState().setOpenedCapture(state))
      .catch(() => undefined);
    void electronAPI.context.get()
      .then((snapshot) => useSessionStore.getState().setContextSnapshot(snapshot))
      .catch(() => undefined);

    const handleFileOpen = (paths: unknown) => {
      if (!Array.isArray(paths) || paths.length === 0) return;
      showNotice(t('app.notice.filesReceived', { count: paths.length }));
    };
    const handleCaseNew = () => {
      useSessionStore.getState().reset();
      showNotice(t('app.notice.newWorkspace'));
    };
    const handleSettingsOpen = () => {
      setSettingsModalOpen(true);
    };
    const handleWindowStateChange = (isMaximized: unknown) => {
      setWindowMaximized(Boolean(isMaximized));
    };

    electronAPI.on('file:open', handleFileOpen);
    electronAPI.on('case:new', handleCaseNew);
    electronAPI.on('settings:open', handleSettingsOpen);
    electronAPI.on('window:maximized-changed', handleWindowStateChange);

    return () => {
      electronAPI.conversation.offEvent(handleConversationEvent);
      electronAPI.off('file:open', handleFileOpen);
      electronAPI.off('case:new', handleCaseNew);
      electronAPI.off('settings:open', handleSettingsOpen);
      electronAPI.off('window:maximized-changed', handleWindowStateChange);
      electronAPI.events.removeAllListeners('context:changed');
      electronAPI.events.removeAllListeners('tool:executionComplete');
      electronAPI.events.removeAllListeners('agent:message');
      electronAPI.events.removeAllListeners('capture:statusChanged');
      electronAPI.events.removeAllListeners('workflow:stateChanged');
      electronAPI.events.removeAllListeners('workflow:runStatusChanged');
      electronAPI.events.removeAllListeners('workflow:runUsageChanged');
      electronAPI.events.removeAllListeners('evidence:eventAdded');
      electronAPI.events.removeAllListeners('device:statusChanged');
      electronAPI.events.removeAllListeners('app:themeChanged');
      electronAPI.events.removeAllListeners('project:inputsChanged');
      electronAPI.events.removeAllListeners('capture:openedStateChanged');
      electronAPI.events.removeAllListeners('runtime:logAppended');
      electronAPI.events.removeAllListeners('conversation:event');
    };
  }, [setSystemTheme, showNotice, syncCapturesFromSnapshot, t]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!currentProject) {
      useSessionStore.getState().setProjectInputs([]);
      return;
    }

    if (navigator.webdriver) {
      const seededInputs = currentProject.inputs?.length
        ? currentProject.inputs
        : useSessionStore.getState().projectInputs;
      useSessionStore.getState().setProjectInputs(seededInputs);
      return;
    }

    if (!electronAPI) {
      useSessionStore.getState().setProjectInputs(currentProject.inputs ?? []);
      return;
    }

    void electronAPI.project.inputs.list(currentProject.projectId)
      .then((result) => {
        useSessionStore.getState().setProjectInputs(result.inputs ?? []);
      })
      .catch(() => {
        useSessionStore.getState().setProjectInputs(currentProject.inputs ?? []);
      });
  }, [currentProject]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (navigator.webdriver) {
      return;
    }

    if (!electronAPI || !currentSession) {
      useSessionStore.getState().setTimeline([]);
      return;
    }

    void electronAPI.evidence.getChain()
      .then((result) => {
        useSessionStore.getState().setActionEvents(result.events ?? []);
        const timeline = (result.events ?? [])
          .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
          .filter((entry): entry is AgentTimelineEntry => entry !== null);
        useSessionStore.getState().setTimeline(timeline);
        useSessionStore.getState().setConversationMessages(
          hydrateMessagesWithActionEvents(
            useSessionStore.getState().conversationMessages,
            (result.events ?? []) as ActionEvent[],
          ),
        );
      })
      .catch(() => {
        useSessionStore.getState().setActionEvents([]);
        useSessionStore.getState().setTimeline([]);
      });

    void electronAPI.workflow.getState()
      .then((state) => {
        if (!state) {
          useSessionStore.getState().setWorkflowState(null);
          useSessionStore.getState().setCurrentDebugPlan(null);
          useSessionStore.getState().setPendingQuestions(null);
          useSessionStore.getState().setReasoningSummaries([]);
          return;
        }
        const workflow = state as WorkflowState;
        useSessionStore.getState().setWorkflowState(workflow);
        useSessionStore.getState().setCurrentDebugPlan(workflow.debugPlan ?? null);
        useSessionStore.getState().setPendingQuestions(workflow.pendingQuestions ?? null);
        useSessionStore.getState().setReasoningSummaries(workflow.reasoningSummaries ?? []);
      })
      .catch(() => undefined);
  }, [currentSession?.sessionId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || !appBodyRef.current) return;

      const containerWidth = appBodyRef.current.getBoundingClientRect().width;
      const { left: resolvedLeft, right: resolvedRight } = resolveSidebarWidths(
        containerWidth,
        leftSidebarWidth,
        rightPanelWidth,
        effectiveLeftCollapsed,
        effectiveRightCollapsed,
        getResponsiveMinMainWidth(containerWidth),
        isRightRailVisible,
      );

      if (dragState.side === 'left' && !effectiveLeftCollapsed) {
        const maxByMain = Math.max(
          LEFT_SIDEBAR_MIN_WIDTH,
          Math.min(
            LEFT_SIDEBAR_MAX_WIDTH,
            containerWidth - getResponsiveMinMainWidth(containerWidth) - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedRight,
          ),
        );
        setLeftSidebarWidth(Math.min(maxByMain, dragState.startWidth + (event.clientX - dragState.startX)));
      }

      if (dragState.side === 'right' && !effectiveRightCollapsed) {
        const maxByMain = Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            containerWidth - getResponsiveMinMainWidth(containerWidth) - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedLeft,
          ),
        );
        setRightPanelWidth(Math.min(maxByMain, dragState.startWidth - (event.clientX - dragState.startX)));
      }
    };

    const handlePointerUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setIsResizing(false);
      void persistLayout();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    effectiveLeftCollapsed,
    leftSidebarWidth,
    persistLayout,
    effectiveRightCollapsed,
    isRightRailVisible,
    rightPanelWidth,
    setLeftSidebarWidth,
    setRightPanelWidth,
  ]);

  const devices = useDeviceStore((state) => state.devices);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const selectedDeviceEntry = devices.find((device) => device.id === selectedDevice);
  const showMainPromptBar = true;
  const hasMessageContent = Boolean(promptValue.trim());
  const hasPendingAttachments = pendingAttachments.length > 0;
  const currentModeConfig = AGENT_MODES.find((mode) => mode.id === currentMode) ?? AGENT_MODES[0];
  const modeLabels = useMemo(() => ({
    debugger: t('mode.debugger'),
    analyzer: t('mode.analyzer'),
    optimizer: t('mode.optimizer'),
  }), [t]);
  const currentModeLabel = modeLabels[currentMode];
  const promptPlaceholder = language === 'zh-CN'
    ? `向 ${currentModeLabel} 描述目标、异常或验证需求`
    : `Describe the goal, anomaly, or verification request for ${currentModeLabel}`;
  const attachButtonLabel = !currentProject
    ? (language === 'zh-CN'
      ? '选择项目后可附加图片、文件或 .rdc Capture'
      : 'Select a project before attaching images, files, or .rdc captures')
    : (language === 'zh-CN'
      ? '附加图片、文件或 .rdc Capture'
      : 'Attach images, files, or .rdc captures');
  const sendButtonLabel = hasActiveDebugRun
    ? (language === 'zh-CN' ? '发送' : 'Send')
    : (language === 'zh-CN' ? '开始' : 'Start');
  const sendButtonDescription = language === 'zh-CN'
    ? `${sendButtonLabel}${currentModeLabel}消息`
    : `${sendButtonLabel} ${currentModeLabel} message`;
  const stopButtonLabel = language === 'zh-CN' ? '停止' : 'Stop';
  const leftPanelToggleLabel = effectiveLeftCollapsed ? t('app.leftSidebarExpand') : t('app.leftSidebarCollapse');
  const rightPanelToggleLabel = effectiveRightCollapsed ? t('app.rightPanelExpand') : t('app.rightPanelCollapse');
  const autoCollapsedTitle = t('app.panelAutoCollapsed');
  const resolvedWidths = useMemo(
    () => resolveSidebarWidths(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      responsiveSidebarState.minMainWidth,
      isRightRailVisible,
    ),
    [
      appBodyWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      isRightRailVisible,
      leftSidebarWidth,
      responsiveSidebarState.minMainWidth,
      rightPanelWidth,
    ],
  );

  const handleWindowMinimize = useCallback(async () => {
    await window.electronAPI?.windowControls.minimize();
  }, []);

  const handleWindowToggleMaximize = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    const nextState = await electronAPI.windowControls.toggleMaximize();
    setWindowMaximized(nextState);
  }, []);

  const handleWindowClose = useCallback(async () => {
    await window.electronAPI?.windowControls.close();
  }, []);

  const handleUserMenuOpen = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setUserMenuAnchor(event.currentTarget.getBoundingClientRect());
  }, []);

  const handleUserMenuClose = useCallback(() => {
    setUserMenuAnchor(null);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setUserMenuAnchor(null);
    setSettingsModalOpen(true);
  }, []);

  const handleStopRun = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !currentRun) return;

    try {
      await electronAPI.workflow.stop(currentRun.runId);
      showNotice(t('app.stopRunSent'));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('app.stopRunFailed'));
    }
  }, [currentRun, showNotice, t]);

  const handleAttachmentSelect = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    if (!currentProject) {
      if (effectiveLeftCollapsed && !leftToggleDisabled) {
        void toggleLeftSidebar();
      }
      showNotice(t('app.attachProjectRequired'));
      return;
    }

    const filePaths = await electronAPI.selectFiles();
    if (!filePaths?.length) {
      return;
    }

    const capturePaths = filePaths.filter((filePath) => /\.rdc$/i.test(filePath));
    const regularPaths = filePaths.filter((filePath) => !/\.rdc$/i.test(filePath));

    if (capturePaths.length > 0) {
      const importResult = await electronAPI.project.inputs.importPaths(currentProject.projectId, capturePaths);
      if (!importResult.success) {
        showNotice(importResult.error || t('app.importCaptureFailed'));
      } else {
        showNotice(t('app.importCaptureSuccess', { count: capturePaths.length }));
      }
    }

    if (regularPaths.length > 0) {
      setPendingAttachments((current) => {
        const existingByPath = new Set(current.map((entry) => entry.sourcePath));
        const nextEntries = regularPaths
          .filter((filePath) => !existingByPath.has(filePath))
          .map<PendingAttachmentDraft>((filePath) => ({
            id: `draft-${filePath}-${Date.now()}`,
            sourcePath: filePath,
            fileName: filePath.split(/[\\/]/).pop() || filePath,
            mimeType: inferAttachmentMimeType(filePath),
            size: null,
            kind: inferAttachmentKind(filePath),
            isCapture: false,
          }));
        return current.concat(nextEntries);
      });
      showNotice(t('app.stageFilesSuccess', { count: regularPaths.length }));
    }
  }, [currentProject, effectiveLeftCollapsed, leftToggleDisabled, showNotice, t, toggleLeftSidebar]);

  const handlePendingAttachmentRemove = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => current.filter((entry) => entry.id !== attachmentId));
  }, []);

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    if ((!trimmed && pendingAttachments.length === 0) || isPromptSending) {
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    setIsPromptSending(true);
    try {
      const result = await electronAPI.conversation.sendMessage({
        projectId: currentProject?.projectId ?? null,
        sessionId: currentSession?.sessionId ?? null,
        currentRunId: currentRun?.runId ?? null,
        replayDeviceId: selectedDeviceEntry?.id ?? null,
        mode: currentMode,
        message: trimmed,
        attachments: pendingAttachments.map<ConversationAttachmentInput>((attachment) => ({
          sourcePath: attachment.sourcePath,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
      });

      setPromptValue('');
      setPendingAttachments([]);

      if (result.session?.projectId && currentProject?.projectId !== result.session.projectId) {
        const projectsResult = await electronAPI.project.list();
        const nextProjects = projectsResult.projects ?? [];
        useSessionStore.getState().setProjects(nextProjects);
        const matchedProject = nextProjects.find((project) => project.projectId === result.session?.projectId) ?? null;
        useSessionStore.getState().setCurrentProject(matchedProject);
      }

      if (result.session?.sessionId) {
        setCurrentSession(result.session);
        const sessionsResult = await electronAPI.session.list(result.session.projectId);
        setSessions(sessionsResult.sessions ?? []);
      }

      upsertConversationMessages([
        result.userMessage,
        result.assistantDraftMessage,
      ]);

      if (result.runUpdate) {
        setCurrentRun(result.runUpdate);
        const runsResult = await electronAPI.run.list(result.runUpdate.sessionId);
        setRuns(runsResult.runs ?? []);
      }

      setCurrentDebugPlan(result.debugPlanSummary ?? null);
      setPendingQuestions(result.pendingQuestions ?? null);
    } catch (error) {
      const currentMessages = useSessionStore.getState().conversationMessages ?? [];
      const turnId = `local-turn-${Date.now()}`;
      setConversationMessages(currentMessages.concat([
        {
          id: `local-user-${Date.now()}`,
          turnId,
          sessionId: currentSession?.sessionId ?? null,
          projectId: currentProject?.projectId ?? null,
          runId: currentRun?.runId ?? null,
          modeContext: currentMode,
          role: 'user',
          content: trimmed,
          status: 'complete',
          updatedAt: Date.now(),
          reasoningTrace: null,
          attachments: pendingAttachments.map((attachment) => ({
            attachmentId: `local-${attachment.id}`,
            sessionId: currentSession?.sessionId ?? '',
            projectId: currentProject?.projectId ?? '',
            kind: attachment.kind,
            fileName: attachment.fileName,
            filePath: attachment.sourcePath,
            mimeType: attachment.mimeType || 'application/octet-stream',
            size: attachment.size || 0,
            createdAt: Date.now(),
          })),
          createdAt: Date.now(),
        },
        {
          id: `local-assistant-${Date.now()}`,
          turnId,
          sessionId: currentSession?.sessionId ?? null,
          projectId: currentProject?.projectId ?? null,
          runId: currentRun?.runId ?? null,
          modeContext: currentMode,
          role: 'assistant',
          agentId: 'rdc-debugger',
          content: error instanceof Error ? error.message : t('app.conversationRequestFailed'),
          status: 'error',
          updatedAt: Date.now(),
          reasoningTrace: {
            status: 'error',
            summary: t('app.conversationRequestFailed'),
            steps: [],
            updatedAt: Date.now(),
          },
          createdAt: Date.now(),
        },
      ]));
    } finally {
      setIsPromptSending(false);
    }
  }, [
    currentProject,
    currentMode,
    currentRun,
    currentSession,
    hasActiveDebugRun,
    isPromptSending,
    pendingAttachments,
    promptValue,
    selectedDeviceEntry,
    setConversationMessages,
    setCurrentDebugPlan,
    setCurrentRun,
    setCurrentSession,
    setPendingQuestions,
    setRuns,
    setSessions,
    t,
    upsertConversationMessages,
  ]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handlePromptSend();
    }
  }, [handlePromptSend]);

  const startDragging = useCallback((side: DragSide, startWidth: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      side,
      startX: event.clientX,
      startWidth,
    };
    setIsResizing(true);
  }, []);

  const renderMainPage = () => <DebuggerPage mode={currentMode} />;

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">RD</div>
        <div className="loading-text">{t('app.loadingShell')}</div>
        <div className="loading-bar" />
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-titlebar">
        <div className="app-titlebar-left no-drag">
          <div className="app-logo">
            <div className="app-logo-icon">RD</div>
            <div className="app-logo-copy">
              <span className="app-logo-text">RDC Agent</span>
            </div>
          </div>
          <button
            type="button"
            className="shell-panel-toggle titlebar-panel-toggle"
            data-testid="titlebar-left-panel-toggle"
            onClick={!leftToggleDisabled ? () => void toggleLeftSidebar() : undefined}
            aria-label={leftPanelToggleLabel}
            title={leftToggleDisabled ? autoCollapsedTitle : leftPanelToggleLabel}
            disabled={leftToggleDisabled}
          >
            <span className="shell-panel-toggle-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {effectiveLeftCollapsed ? (
                  <polyline points="9 18 15 12 9 6" />
                ) : (
                  <polyline points="15 6 9 12 15 18" />
                )}
              </svg>
            </span>
          </button>
        </div>
        <div className="app-titlebar-right no-drag">
          {isRightRailVisible && (
            <button
              type="button"
              className="shell-panel-toggle titlebar-panel-toggle"
              data-testid="titlebar-right-panel-toggle"
              onClick={!rightToggleDisabled ? () => void toggleRightPanel() : undefined}
              aria-label={rightPanelToggleLabel}
              title={rightToggleDisabled ? autoCollapsedTitle : rightPanelToggleLabel}
              disabled={rightToggleDisabled}
            >
              <span className="shell-panel-toggle-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {effectiveRightCollapsed ? (
                    <polyline points="15 18 9 12 15 6" />
                  ) : (
                    <polyline points="9 18 15 12 9 6" />
                  )}
                </svg>
              </span>
            </button>
          )}
          <div className="window-controls" role="group" aria-label={t('app.windowControls')}>
            <button
              type="button"
              className="window-control window-control-minimize tooltip"
              data-tooltip={t('app.windowMinimize')}
              aria-label={t('app.windowMinimize')}
              onClick={handleWindowMinimize}
            >
              <span className="minimize" />
            </button>
            <button
              type="button"
              className="window-control window-control-maximize tooltip"
              data-tooltip={windowMaximized ? t('app.windowRestore') : t('app.windowMaximize')}
              aria-label={windowMaximized ? t('app.windowRestore') : t('app.windowMaximize')}
              onClick={handleWindowToggleMaximize}
            >
              <span className={windowMaximized ? 'restore' : 'maximize'} />
            </button>
            <button
              type="button"
              className="window-control close tooltip"
              data-tooltip={t('app.windowClose')}
              aria-label={t('app.windowClose')}
              onClick={handleWindowClose}
            >
              <span className="close-mark" />
            </button>
          </div>
        </div>
      </header>

      {showWorkbenchShell ? (
        <div
          ref={appBodyRef}
          className={`app-body ${isResizing ? 'is-resizing' : ''}`}
          style={{
            ['--left-sidebar-width' as string]: `${resolvedWidths.left}px`,
            ['--right-panel-width' as string]: `${resolvedWidths.right}px`,
            ['--left-resize-handle-width' as string]: `${effectiveLeftCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH}px`,
            ['--right-resize-handle-width' as string]: `${!isRightRailVisible || effectiveRightCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH}px`,
            ['--workbench-rail-max-width' as string]: workbenchRailMaxWidth,
            ['--workbench-inline-mode' as string]: bothSidebarsCollapsed ? 'dual-collapsed' : 'sidebar-open',
          }}
        >
          <aside
            className={`app-sidebar-left ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
            data-testid="app-sidebar-left"
          >
            <nav className="sidebar-nav">
              <Sidebar collapsed={effectiveLeftCollapsed} />
            </nav>
            {!effectiveLeftCollapsed && (
              <div
                className="app-sidebar-footer"
                data-testid="sidebar-footer"
              >
                <button
                  type="button"
                  className="footer-entry footer-user-trigger sidebar-user-trigger sidebar-footer-entry"
                  data-testid="sidebar-user-settings-trigger"
                  onClick={handleUserMenuOpen}
                  title={t('sidebar.userSettings')}
                  aria-label={t('sidebar.userSettings')}
                >
                  <span className="footer-entry-main">
                    <span className="footer-entry-avatar">
                      {nickname.trim().slice(0, 2).toUpperCase()}
                    </span>
                    <span className="footer-entry-copy">
                      <span className="footer-entry-title">{nickname}</span>
                      <span className="footer-entry-subtitle">{t('sidebar.userSubtitle')}</span>
                    </span>
                  </span>
                  <span className="footer-entry-trailing">
                    <span className="footer-entry-chevron">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </span>
                </button>
              </div>
            )}
          </aside>

          <div
            className={`panel-resize-handle panel-resize-handle-left ${effectiveLeftCollapsed ? 'disabled' : ''}`}
            onPointerDown={!effectiveLeftCollapsed ? startDragging('left', resolvedWidths.left) : undefined}
            aria-hidden="true"
          />

          <main className={`app-main ${isTerminalOpen ? 'terminal-open' : ''}`}>
            <div className="main-content">
              {shellNotice && (
                <div className="shell-notice" role="status" aria-live="polite">
                  {shellNotice}
                </div>
              )}
              <div className="main-floating-utilities">
                <DeviceSelector variant="utility" />
                <button
                  type="button"
                  className={`main-utility-toggle terminal-pill ${isTerminalOpen ? 'active' : ''}`}
                  onClick={() => toggleTerminalOpen()}
                  data-testid="terminal-toggle"
                  aria-label={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
                  title={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 17l6-6-6-6" />
                    <path d="M12 19h8" />
                  </svg>
                </button>
              </div>
              <div className="main-page-shell">
                {renderMainPage()}
              </div>
            </div>
            {showMainPromptBar && (
              <div className="main-input-bar">
                <div
                  className="composer-shell"
                  style={{ ['--composer-mode-accent' as string]: currentModeConfig.accentColor }}
                >
                  {pendingAttachments.length > 0 && (
                    <div className="composer-attachments" data-testid="composer-attachments">
                      {pendingAttachments.map((attachment) => (
                        <div key={attachment.id} className={`composer-attachment-chip ${attachment.kind}`}>
                          <span className="composer-attachment-chip-icon" aria-hidden="true">
                            {attachment.kind === 'image' ? 'IMG' : 'FILE'}
                          </span>
                          <span className="composer-attachment-chip-copy">
                            <span className="composer-attachment-chip-name">{attachment.fileName}</span>
                            <span className="composer-attachment-chip-meta">{formatBytes(attachment.size)}</span>
                          </span>
                          <button
                            type="button"
                            className="composer-attachment-chip-remove"
                            onClick={() => handlePendingAttachmentRemove(attachment.id)}
                            aria-label={t('app.removeAttachment', { fileName: attachment.fileName })}
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="composer-input-row">
                    <textarea
                      ref={promptInputRef}
                      className="chat-input composer-textarea"
                      name="debuggerPrompt"
                      value={promptValue}
                      onChange={(event) => setPromptValue(event.target.value)}
                      onKeyDown={handlePromptKeyDown}
                      placeholder={promptPlaceholder}
                      aria-label={promptPlaceholder}
                      rows={1}
                    />
                  </div>
                  <div className="composer-footer-bar" data-testid="composer-footer-bar">
                    <div className="composer-toolbar-group composer-toolbar-group-left">
                      <button
                        type="button"
                        className="composer-attach-button"
                        data-testid="composer-attach-button"
                        onClick={() => void handleAttachmentSelect()}
                        disabled={isPromptSending}
                        title={attachButtonLabel}
                        aria-label={attachButtonLabel}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                      <div ref={modeMenuRef} className="composer-agent-menu">
                        <button
                          type="button"
                          className={`composer-agent-pill ${modeMenuOpen ? 'open' : ''}`}
                          data-testid="composer-mode-pill"
                          onClick={() => setModeMenuOpen((current) => !current)}
                          aria-haspopup="menu"
                          aria-expanded={modeMenuOpen}
                        >
                          <span className="composer-agent-pill-icon" aria-hidden="true">
                            <ModeGlyph mode={currentMode} size={15} strokeWidth={1.9} />
                          </span>
                          <span className="composer-agent-pill-label">{currentModeLabel}</span>
                          <span className="composer-agent-pill-caret" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </span>
                        </button>
                        {modeMenuOpen && (
                          <div className="composer-agent-menu-popup" role="menu">
                            {AGENT_MODES.map((mode) => (
                              <button
                                key={mode.id}
                                type="button"
                                className={`composer-agent-menu-item ${currentMode === mode.id ? 'active' : ''}`}
                                data-testid={`mode-menu-item-${mode.id}`}
                                role="menuitemradio"
                                aria-checked={currentMode === mode.id}
                                onClick={() => {
                                  setCurrentMode(mode.id);
                                  setModeMenuOpen(false);
                                }}
                              >
                                <span className="composer-agent-menu-item-copy">
                                  <span className="composer-agent-menu-item-icon" aria-hidden="true">
                                    <ModeGlyph mode={mode.id} size={15} strokeWidth={1.9} />
                                  </span>
                                  <span className="composer-agent-menu-item-label">{modeLabels[mode.id]}</span>
                                </span>
                                {currentMode === mode.id ? <span className="composer-agent-menu-item-check">●</span> : null}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="composer-toolbar-group composer-toolbar-group-right">
                      <ContextUsageIndicator usage={hasActiveDebugRun ? currentRunUsage : null} language={language} />
                      {hasActiveDebugRun && currentRun && (
                        <button
                          type="button"
                          className="chat-send-button chat-stop-button"
                          data-testid="debugger-stop-button"
                          onClick={() => void handleStopRun()}
                          disabled={currentRun.status === 'stopping'}
                          aria-label={stopButtonLabel}
                          title={stopButtonLabel}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                          <span className="chat-send-button-label">{stopButtonLabel}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="chat-send-button primary"
                        data-testid={hasActiveDebugRun ? 'debugger-send-button' : 'debugger-start-button'}
                        onClick={() => void handlePromptSend()}
                        disabled={(!hasMessageContent && !hasPendingAttachments) || isPromptSending}
                        aria-label={sendButtonDescription}
                        title={sendButtonDescription}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <TerminalDrawer />
          </main>

          {isRightRailVisible && (
            <>
              <div
                className={`panel-resize-handle panel-resize-handle-right ${effectiveRightCollapsed ? 'disabled' : ''}`}
                onPointerDown={!effectiveRightCollapsed ? startDragging('right', resolvedWidths.right) : undefined}
                aria-hidden="true"
              />

              <aside
                className={`app-sidebar-right ${effectiveRightCollapsed ? 'collapsed' : ''}`}
                data-testid="app-sidebar-right"
              >
                <div
                  className={`right-panel-body ${effectiveRightCollapsed ? 'collapsed' : ''}`}
                  data-testid="control-panel-scroll"
                >
                  <ControlPanel />
                </div>
              </aside>
            </>
          )}
        </div>
      ) : (
        <div className="app-main app-mode-placeholder">
          <div className="main-content">
            <div className="main-page-shell">
              {renderMainPage()}
            </div>
          </div>
        </div>
      )}

      <UserMenu
        anchorRect={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        settings={settings}
        onClose={handleUserMenuClose}
        onOpenSettings={handleOpenSettings}
        onThemeChange={(theme) => void setTheme(theme)}
        onLanguageChange={(language) => void setLanguage(language)}
        onFontScaleChange={(fontScale) => void setFontScale(fontScale)}
      />

      <SettingsModal
        open={settingsModalOpen}
        settings={settings}
        onClose={() => setSettingsModalOpen(false)}
      />
    </div>
  );
};

export default App;
