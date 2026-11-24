import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationDiagnosticSeverity,
  ConversationThinkingStatus,
  ConversationToolExecutionEvidence,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type { IconName } from '../../ui/Icon';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped' | 'cancelled';

/** One web page as a pill: where it is, what it is called, and whether it loaded (and, for a search result, was read later). */
export interface WorkProcessWebPage {
  url?: string;
  domain: string;
  title?: string;
  snippet?: string;
  state: 'pending' | 'done' | 'failed';
  /** A search result whose page a later read in the same turn opened. */
  read?: boolean;
}


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

/** Presentation family that drives the unified tool card body/detail templates. */
export type WorkProcessToolFamily =
  | 'file'
  | 'search'
  | 'shell'
  | 'git'
  | 'web'
  | 'memory'
  | 'skill'
  | 'mcp'
  | 'runtime'
  | 'interpreter'
  | 'generic';

export interface WorkProcessToolApproval {
  status: import('@shared/types/conversation').ConversationToolApprovalStatus;
  verb: string;
  message: string;
  metaLines: string[];
}

export interface WorkProcessUserInputItem {
  questionId: string;
  prompt: string;
  answer?: string;
}

export type WorkProcessRow =
  | {
    type: 'thinking';
    id: string;
    status: WorkProcessRowStatus;
    duration: string;
    preview: string;
    label: string;
    kind?: ThinkingArtifact['kind'];
    visibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationThinkingStatus;
    openByDefault: boolean;
  }
  | {
    type: 'output';
    id: string;
    status: WorkProcessRowStatus;
    duration: string;
    text: string;
    phase?: ConversationLoopOutputPhase;
  }
  | {
    type: 'summary';
    id: string;
    status: WorkProcessRowStatus;
    text: string;
    detailLines: string[];
    duration: string;
    compactionProvenance?: import('@shared/types/conversation').ConversationCompactionProvenance;
  }
  | {
    type: 'tool';
    /** Renderer-only image group; source calls and receipts remain unchanged. */
    imageCalls?: Array<Extract<WorkProcessRow, { type: 'tool' }>>;
    planReview?: import('@shared/types/planReview').ConversationPlanReview;
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    category: string;
    icon: IconName;
    groupKind: WorkProcessToolGroupKind;
    /** Unified card family for body/detail templates. */
    family: WorkProcessToolFamily;
    toolName: string;
    target: string;
    duration: string;
    argsLines: string[];
    previewLines: string[];
    rawLines: string[];
    /**
     * Outcome-first collapsed summary (e.g. `42 files`, `12 matches · 3 files`).
     * When absent, the card falls back to args target / path / command.
     */
    bodyText?: string;
    outcome?: import('./workProcessOutcome').ToolOutcome;
    /** Optional short result sample shown under bodyText while collapsed (search family). */
    bodyLines?: string[];
    /** Content-layer preview shape; family drives the card template. */
    previewKind?: 'shell' | 'skill' | 'file' | 'web' | 'generic';
    /** Shell command for the two-pane terminal header (`$ cmd`). */
    commandText?: string;
    /** Skill / file path chip shown beside a short description. */
    pathChip?: string;
    /** Human-readable one-line diagnostic for failed tools (never the raw JSON envelope). */
    diagnosticCaption?: string;
    hookDiagnostics?: import('@shared/types/conversation').ConversationToolCall['hookDiagnostics'];
    approval?: WorkProcessToolApproval;
    /** Search results, or the one page a read targets; each renders as a pill (favicon + title). */
    webPages?: WorkProcessWebPage[];
    /** The query a search ran. */
    webQuery?: string;
    /** Technical facts of a read (path, HTTP status, bytes), shown only in the expanded detail. */
    webMeta?: { path?: string; status?: number; bytes?: number };
    /** Execution window in epoch ms, so grouped reads can show the whole span. */
    startedAt?: number;
    completedAt?: number;
    imagePreviews?: import('@shared/types/conversation').ConversationToolImagePreviewRef[];
    chips?: string[];
  }
  | {
    /** Consecutive web reads shown as one card with one pill per page; each member keeps its own receipt. */
    type: 'webGroup';
    id: string;
    status: WorkProcessRowStatus;
    members: Extract<WorkProcessRow, { type: 'tool' }>[];
    pages: WorkProcessWebPage[];
    duration: string;
  }
  | {
    type: 'taskSnapshot';
    id: string;
    status: WorkProcessRowStatus;
    change?: 'created' | 'updated';
    completed: number;
    total: number;
    items: import('@shared/types/conversation').ConversationTaskSnapshotItem[];
    duration: string;
  }
  | {
    type: 'userInput';
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    questionCount: number;
    items: WorkProcessUserInputItem[];
    answeredCount: number;
    incomplete: boolean;
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
    type: 'planReview';
    id: string;
    status: WorkProcessRowStatus;
    plan: import('@shared/types/planReview').ConversationPlanReview;
    duration: string;
  }
  | {
    type: 'diagnostic';
    id: string;
    status: WorkProcessRowStatus;
    severity: ConversationDiagnosticSeverity;
    isHookDiagnostic?: boolean;
    message: string;
    detailLines: string[];
    duration: string;
  }
  | {
    type: 'subagent';
    id: string;
    status: WorkProcessRowStatus;
    profile: string;
    task: string;
    mode: 'wait' | 'background';
    argsPreview: string;
    resultPreview: string;
    executionId?: string;
    generation?: number;
    duration: string;
  }
  | {
    type: 'section';
    id: string;
    status: WorkProcessRowStatus;
    /** Activity of task lifecycle calls represented by their snapshots rather than separate tool rows. */
    hasActiveTools?: boolean;
    stepCount: number;
    duration: string;
    steps: WorkProcessRow[];
    visibleSteps: WorkProcessRow[];
    outputPhase?: ConversationLoopOutputPhase;
    stopReason?: ConversationLoopStopReason;
    loopId: string;
  };

export interface WorkProcessPresentation {
  rows: WorkProcessRow[];
  stepCount: number;
  toolCount: number;
  summary: string;
  toolEvidence?: ConversationToolExecutionEvidence;
  duration: string;
  actionCount: number;
  important: boolean;
}
