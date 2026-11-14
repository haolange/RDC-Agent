import type { Translator } from '../../i18n/messages';
import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationReasoningState,
  ConversationWorkBlock,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type { PresentationUnit } from './workProcessUnits';
import { aggregateSectionSteps } from './workProcessToolAggregate';
import { projectLlmTurn } from './workProcessLlmProjection';
import { pushStandaloneBlock } from './workProcessStandaloneProjection';
import type { WorkProcessRow } from './workProcessTypes';

export type { LoopPresentationUnit, PresentationUnit, StandalonePresentationUnit } from './workProcessUnits';

export interface BlockProjectionContext {
  t: Translator;
  visibleThinkingKeys: Set<string>;
  hasVisibleProcessEvidence: boolean;
  createToolRow: (call: import('@shared/types/conversation').ConversationToolCall) => WorkProcessRow;
  groupProcessRows: (rows: WorkProcessRow[]) => WorkProcessRow[];
  blocksToDetailRows: (blocks: ConversationWorkBlock[]) => WorkProcessRow[];
}

export interface LoopProjectionDeps {
  resolveOutputPhase: (block: ConversationWorkBlock, hasVisibleProcessEvidence: boolean) => ConversationLoopOutputPhase;
  resolveReasoningState: (block: ConversationWorkBlock) => ConversationReasoningState;
  resolveSectionProse: (
    block: ConversationWorkBlock,
    outputPhase: ConversationLoopOutputPhase,
  ) => {
    proseText: string;
    proseStreaming: boolean;
  };
  resolveSectionThinking: (
    block: ConversationWorkBlock,
    hasVisibleEvidence: boolean,
  ) => {
    preview: string;
    label: string;
    kind?: ThinkingArtifact['kind'];
    source?: string;
    visibility?: ThinkingArtifact['visibility'];
    status?: ConversationWorkBlock['thinkingStatus'];
    expandable: boolean;
    openByDefault: boolean;
  };
  resolveResponseThinking: (block: ConversationWorkBlock) => {
    preview: string;
    label: string;
    kind?: ThinkingArtifact['kind'];
    visibility?: ThinkingArtifact['visibility'];
    status?: ConversationWorkBlock['thinkingStatus'];
    expandable: boolean;
    openByDefault: boolean;
  };
  isNonFinalStopReason: (stopReason?: ConversationLoopStopReason) => boolean;
  normalizeThinkingDedupKey: (value: string) => string;
  createApprovalRow: (block: ConversationWorkBlock) => WorkProcessRow;
  createDiagnosticRow: (block: ConversationWorkBlock) => WorkProcessRow;
  shouldSkipBlock: (block: ConversationWorkBlock) => boolean;
  getMeaningfulBlockSummary: (block: ConversationWorkBlock) => string;
  countToolSteps: (rows: WorkProcessRow[]) => number;
}

export function buildPresentationUnits(
  blocks: ConversationWorkBlock[],
  deps: LoopProjectionDeps,
  ctx: BlockProjectionContext,
): PresentationUnit[] {
  const units: PresentationUnit[] = [];
  const { t } = ctx;
  const snapshotsByLoop = new Map<string, ConversationWorkBlock[]>();
  const interactionsByLoop = new Map<string, ConversationWorkBlock[]>();
  let previousLoop: string | undefined;
  for (const block of blocks) {
    if (block.kind === 'llm_turn') previousLoop = block.id;
    if (block.kind === 'user_input' || block.kind === 'plan_review') {
      const owner = block.parentLoopId;
      if (owner && blocks.some((candidate) => candidate.kind === 'llm_turn' && candidate.id === owner)) {
        interactionsByLoop.set(owner, [...(interactionsByLoop.get(owner) ?? []), block]);
      }
      continue;
    }
    if (block.kind !== 'task_snapshot') continue;
    const owner = block.parentLoopId ?? previousLoop;
    if (!owner || !blocks.some((candidate) => candidate.kind === 'llm_turn' && candidate.id === owner)) continue;
    snapshotsByLoop.set(owner, [...(snapshotsByLoop.get(owner) ?? []), block]);
  }
  const groupedSnapshots = new Set([...snapshotsByLoop.values()].flat().map((block) => block.id));
  const groupedInteractions = new Set([...interactionsByLoop.values()].flat().map((block) => block.id));

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];

    if (block.kind === 'llm_turn') {
      const unit = projectLlmTurn(block, deps, ctx, snapshotsByLoop.get(block.id), interactionsByLoop.get(block.id));
      if (unit) units.push(unit);
      continue;
    }

    if (!groupedSnapshots.has(block.id) && !groupedInteractions.has(block.id)) pushStandaloneBlock(block, units, deps, ctx);
    }

  const sources = new Map(blocks.map((block) => [block.id, block]));
  for (const unit of units) {
    if (unit.kind !== 'loop') continue;
    const source = sources.get(unit.loopId);
    const settled = !source?.toolCalls.some((call) => call.status === 'pending' || call.status === 'running');
    for (const row of unit.rows) {
      if (row.type === 'section') row.visibleSteps = aggregateSectionSteps(row.steps, t, settled);
    }
  }
  return units;
}

export function markLastSectionOpen(rows: WorkProcessRow[]): void {
  let lastSectionIndex = -1;
  rows.forEach((row, index) => {
    if (row.type === 'section') lastSectionIndex = index;
  });
  if (lastSectionIndex < 0) return;
  const lastSection = rows[lastSectionIndex];
  if (lastSection.type === 'section' && lastSection.status !== 'complete') lastSection.defaultOpen = true;
}

export function presentationUnitsToDetailRows(units: PresentationUnit[]): WorkProcessRow[] {
  const rows = units.flatMap((unit) => unit.kind === 'loop' || unit.kind === 'standalone' ? unit.rows : []);
  markLastSectionOpen(rows);
  return rows;
}
