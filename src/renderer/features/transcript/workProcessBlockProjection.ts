import { supersededAnswerLoopIds } from '@shared/conversation/loopItems';
import { projectLlmTurn } from './workProcessLlmProjection';
import { pushStandaloneBlock } from './workProcessStandaloneProjection';
import type { LocalizedTranslator } from '../../i18n/messages';
import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationReasoningState,
  ConversationThinkingItem,
  ConversationThinkingStatus,
  ConversationWorkBlock,
} from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';
import type { PresentationUnit } from './workProcessUnits';
import type { WorkProcessRow } from './workProcessTypes';

export type { LoopPresentationUnit, PresentationUnit, StandalonePresentationUnit } from './workProcessUnits';

export interface BlockProjectionContext {
  t: LocalizedTranslator;
  visibleThinkingKeys: Set<string>;
  hasVisibleProcessEvidence: boolean;
  createToolRow: (call: import('@shared/types/conversation').ConversationToolCall) => WorkProcessRow;
  groupProcessRows: (rows: WorkProcessRow[]) => WorkProcessRow[];
  blocksToDetailRows: (blocks: ConversationWorkBlock[]) => WorkProcessRow[];
}

export interface ThinkingItemPresentation {
  preview: string;
  label: string;
  kind: ThinkingArtifact['kind'];
  visibility: ThinkingArtifact['visibility'];
  status: ConversationThinkingStatus;
  openByDefault: boolean;
}

export interface LoopProjectionDeps {
  resolveOutputPhase: (block: ConversationWorkBlock, hasVisibleProcessEvidence: boolean) => ConversationLoopOutputPhase;
  resolveReasoningState: (block: ConversationWorkBlock) => ConversationReasoningState;
  resolveThinkingItem: (block: ConversationWorkBlock, item: ConversationThinkingItem) => ThinkingItemPresentation | null;
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
  const snapshotsByLoop = new Map<string, ConversationWorkBlock[]>();
  const interactionsByLoop = new Map<string, ConversationWorkBlock[]>();
  const loopIds = new Set(blocks.filter((block) => block.kind === 'llm_turn').map((block) => block.id));
  let previousLoop: string | undefined;
  for (const block of blocks) {
    if (block.kind === 'llm_turn') previousLoop = block.id;
    if (block.kind === 'user_input' || block.kind === 'plan_review') {
      const owner = block.parentLoopId;
      if (owner && loopIds.has(owner)) {
        const owned = interactionsByLoop.get(owner);
        if (owned) owned.push(block);
        else interactionsByLoop.set(owner, [block]);
      }
      continue;
    }
    if (block.kind !== 'task_snapshot') continue;
    const owner = block.parentLoopId ?? previousLoop;
    if (!owner || !loopIds.has(owner)) continue;
    const owned = snapshotsByLoop.get(owner);
    if (owned) owned.push(block);
    else snapshotsByLoop.set(owner, [block]);
  }
  // Answers the runtime sent back read as commentary, also in sessions recorded before the runtime said so.
  const superseded = supersededAnswerLoopIds(blocks);
  const groupedSnapshots = new Set([...snapshotsByLoop.values()].flat().map((block) => block.id));
  const groupedInteractions = new Set([...interactionsByLoop.values()].flat().map((block) => block.id));

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];

    if (block.kind === 'llm_turn') {
      const unit = projectLlmTurn(block, deps, ctx, snapshotsByLoop.get(block.id), interactionsByLoop.get(block.id), superseded.has(block.id));
      if (unit) units.push(unit);
      continue;
    }

    if (!groupedSnapshots.has(block.id) && !groupedInteractions.has(block.id)) pushStandaloneBlock(block, units, deps, ctx);
  }

  return units;
}

export function presentationUnitsToDetailRows(units: PresentationUnit[]): WorkProcessRow[] {
  return units.flatMap((unit) => unit.kind === 'loop' || unit.kind === 'standalone' ? unit.rows : []);
}
