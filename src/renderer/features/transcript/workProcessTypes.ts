import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationDiagnosticSeverity,
  ConversationToolExecutionEvidence,
  ConversationWorkBlock,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';

export type WorkProcessRowStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';

/** Per-builtin Work Process header glyph. Each catalog tool maps to a unique key. */
export type WorkProcessIconKey =
  | 'fileRead'
  | 'artifactRead'
  | 'fileWrite'
  | 'fileEdit'
  | 'fileDelete'
  | 'fileMove'
  | 'fileCopy'
  | 'fileGlob'
  | 'codeSearch'
  | 'notebookEdit'
  | 'webFetch'
  | 'webSearch'
  | 'terminal'
  | 'gitStatus'
  | 'gitDiff'
  | 'gitLog'
  | 'gitAdd'
  | 'gitUnstage'
  | 'gitCommit'
  | 'question'
  | 'toolSearch'
  | 'handoff'
  | 'planArtifact'
  | 'outputPublish'
  | 'memorySearch'
  | 'memoryRead'
  | 'memoryWrite'
  | 'memoryDelete'
  | 'skillsList'
  | 'skillRead'
  | 'plug'
  | 'monitor'
  | 'rdxProbe'
  | 'brain'
  | 'subagentReport'
  | 'taskCreate'
  | 'taskUpdate'
  | 'taskGet'
  | 'taskList'
  | 'taskStop'
  | 'turnComplete'
  | 'backgroundQuery'
  | 'backgroundWait'
  | 'backgroundResult'
  | 'backgroundMessage'
  | 'backgroundCancel'
  | 'backgroundJoin'
  | 'imageRead'
  | 'interpreter'
  | 'knowledgeBrowse'
  | 'knowledgeSearch'
  | 'knowledgeRead'
  | 'knowledgeCompile'
  | 'knowledgeCandidate'
  | 'investigationRead'
  | 'investigationWrite'
  | 'investigationList'
  | 'spark'
  | 'tool';

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
    id: string;
    status: WorkProcessRowStatus;
    verb: string;
    category: string;
    icon: WorkProcessIconKey;
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
    approval?: WorkProcessToolApproval;
    sourcePills?: Array<{ domain: string; url?: string; title?: string }>;
    /** Single-page chip for web_fetch (distinct from search source pills). */
    pageChip?: {
      domain: string;
      url: string;
      pathLabel?: string;
      title?: string;
      status?: number;
      bytes?: number;
    };
    imagePreviews?: import('@shared/types/conversation').ConversationToolImagePreviewRef[];
    chips?: string[];
  }
  | {
    type: 'taskSnapshot';
    id: string;
    status: WorkProcessRowStatus;
    completed: number;
    total: number;
    items: import('@shared/types/conversation').ConversationTaskSnapshotItem[];
    duration: string;
  }
  | {
    type: 'toolAggregate';
    id: string;
    status: WorkProcessRowStatus;
    summary: string;
    duration: string;
    children: Extract<WorkProcessRow, { type: 'tool' }>[];
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
    type: 'diagnostic';
    id: string;
    status: WorkProcessRowStatus;
    severity: ConversationDiagnosticSeverity;
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
    type: 'section';
    id: string;
    status: WorkProcessRowStatus;
    /** Loop commentary rendered as markdown prose (never in the thinking slot). */
    proseText: string;
    proseStreaming: boolean;
    thinkingPreview: string;
    thinkingLabel: string;
    thinkingKind?: ThinkingArtifact['kind'];
    thinkingSource?: string;
    thinkingVisibility?: ThinkingArtifact['visibility'];
    thinkingStatus?: ConversationWorkBlock['thinkingStatus'];
    thinkingExpandable: boolean;
    /** Policy hint: expand while loop is live; fold after settle. UI may sticky-override. */
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
  };

export interface WorkProcessPresentation {
  rows: WorkProcessRow[];
  stepCount: number;
  toolCount: number;
  summary: string;
  toolEvidence?: ConversationToolExecutionEvidence;
  duration: string;
  actionCount: number;
  defaultExpanded: boolean;
  important: boolean;
}
