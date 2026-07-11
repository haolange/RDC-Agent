import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationReasoningState,
  ConversationWorkBlock,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type { WorkProcessSemanticStepKind } from './workProcessSemanticKind';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error';

export type WorkProcessIconKey =
  | 'brain'
  | 'search'
  | 'file'
  | 'edit'
  | 'terminal'
  | 'globe'
  | 'git'
  | 'memory'
  | 'task'
  | 'question'
  | 'handoff'
  | 'spark'
  | 'plug'
  | 'monitor'
  | 'tool'
  | 'warning';

export type WorkProcessToolGroupKind =
  | 'explore'
  | 'search'
  | 'change'
  | 'command'
  | 'web'
  | 'git'
  | 'memory'
  | 'task'
  | 'interaction'
  | 'collaboration'
  | 'runtime'
  | 'mcp'
  | 'diagnostic';

export interface WorkProcessToolApproval {
  status: import('@shared/types/conversation').ConversationToolApprovalStatus;
  verb: string;
  message: string;
  metaLines: string[];
}

export interface WorkProcessGroupThinking {
  preview: string;
  label: string;
  kind?: ThinkingArtifact['kind'];
  visibility?: ThinkingArtifact['visibility'];
  status?: ConversationWorkBlock['thinkingStatus'];
}

export interface WorkProcessUserInputItem {
  questionId: string;
  prompt: string;
  answer?: string;
  selectedOptionId?: string;
}

export type WorkProcessRow =
  | {
    type: 'summary';
    id: string;
    status: WorkProcessRowStatus;
    text: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'tool';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    category: string;
    icon: WorkProcessIconKey;
    groupKind: WorkProcessToolGroupKind;
    toolName: string;
    target: string;
    duration: string;
    argsLines: string[];
    previewLines: string[];
    rawLines: string[];
    approval?: WorkProcessToolApproval;
    compact?: boolean;
    sourcePills?: Array<{ domain: string; url?: string; title?: string }>;
    browseLink?: { label: string; url: string };
  }
  | {
    type: 'userInput';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    questionCount: number;
    items: WorkProcessUserInputItem[];
    error?: string;
    duration: string;
  }
  | {
    type: 'approval';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    message: string;
    duration: string;
    detailLines: string[];
    metaLines: string[];
  }
  | {
    type: 'diagnostic';
    id: string;
    status: WorkProcessRowStatus;
    message: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'subagent';
    id: string;
    status: WorkProcessRowStatus;
    profile: string;
    summary: string;
    duration: string;
    children: WorkProcessRow[];
  }
  | {
    type: 'task';
    id: string;
    /** 与进度泳道 ProgressTask.id 对齐的稳定任务锚点。 */
    taskId: string;
    status: WorkProcessRowStatus;
    title: string;
    taskStatus: string;
    duration: string;
  }
  | {
    type: 'response';
    id: string;
    status: WorkProcessRowStatus;
    title: string;
    summary: string;
    duration: string;
    thinkingPreview: string;
    thinkingLabel: string;
    thinkingKind?: ThinkingArtifact['kind'];
    thinkingVisibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
    thinkingExpandable: boolean;
    thinkingOpenByDefault: boolean;
    outputPhase?: ConversationLoopOutputPhase;
    stopReason?: ConversationLoopStopReason;
  }
  | {
    type: 'section';
    id: string;
    status: WorkProcessRowStatus;
    resultText: string;
    resultToolSummary: string;
    resultStreaming: boolean;
    clampResult: boolean;
    clampable: boolean;
    thinkingPreview: string;
    thinkingLabel: string;
    thinkingKind?: ThinkingArtifact['kind'];
    thinkingSource?: string;
    thinkingVisibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
    thinkingExpandable: boolean;
    thinkingOpenByDefault: boolean;
    stepCount: number;
    stepsDisclosure: 'visible' | 'deferred';
    duration: string;
    defaultOpen: boolean;
    steps: WorkProcessRow[];
    visibleSteps: WorkProcessRow[];
    outputPhase?: ConversationLoopOutputPhase;
    stopReason?: ConversationLoopStopReason;
    loopId: string;
  }
  | {
    type: 'reasoningIndicator';
    id: string;
    status: WorkProcessRowStatus;
    state: Extract<ConversationReasoningState, 'opaque' | 'hidden'>;
    duration: string;
    loopId: string;
  };

export interface WorkProcessStepGroup {
  id: string;
  kind: WorkProcessSemanticStepKind;
  title: string;
  status: WorkProcessRowStatus;
  rows: WorkProcessRow[];
  loopIds: string[];
  groupThinking?: WorkProcessGroupThinking;
}

export interface WorkProcessPresentationOptions {
  view?: 'grouped' | 'detail';
}

export interface WorkProcessPresentation {
  groups: WorkProcessStepGroup[];
  rows: WorkProcessRow[];
  stepCount: number;
  toolCount: number;
  summary: string;
  duration: string;
  actionCount: number;
  defaultExpanded: boolean;
  important: boolean;
}
