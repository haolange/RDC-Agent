import type {
  ConversationLoopOutputPhase,
  ConversationLoopStopReason,
  ConversationTextItem,
  ConversationThinkingItem,
  ConversationWorkBlock,
} from '../types/conversation';
import type { ProviderOutputRef, ThinkingArtifact } from '../types/reasoning';

/** Two refs name the same provider block. */
export function sameProviderBlock(left: ProviderOutputRef, right: ProviderOutputRef): boolean {
  return left.providerBlockKey === right.providerBlockKey && left.contentIndex === right.contentIndex;
}

export function loopTextItems(block: Pick<ConversationWorkBlock, 'items'> | undefined): ConversationTextItem[] {
  return (block?.items ?? []).filter((item): item is ConversationTextItem => item.kind === 'text');
}

export function loopThinkingItems(block: Pick<ConversationWorkBlock, 'items'> | undefined): ConversationThinkingItem[] {
  return (block?.items ?? []).filter((item): item is ConversationThinkingItem => item.kind === 'thinking');
}

/** The thinking that decides a loop's reasoning state: the most recent block the provider sent. */
export function lastLoopThinking(block: Pick<ConversationWorkBlock, 'items'> | undefined): ThinkingArtifact | undefined {
  return loopThinkingItems(block).at(-1)?.thinking;
}

/**
 * The one rule for a text block's phase when its loop settles. A provider-declared phase always wins;
 * otherwise a loop that ended its turn with a final answer marks its text final, a loop that stopped
 * for tools marks it commentary, and anything else stays undeclared.
 */
export function settleTextPhase(
  declared: ConversationLoopOutputPhase | undefined,
  loop: { stopReason?: ConversationLoopStopReason; outputPhase?: ConversationLoopOutputPhase },
): ConversationLoopOutputPhase | undefined {
  if (declared) return declared;
  if (loop.stopReason === 'end_turn' && loop.outputPhase === 'final_answer') return 'final_answer';
  if (loop.stopReason === 'tool_use') return 'commentary';
  return undefined;
}

/**
 * Loops whose answer the turn did not end on: the runtime sent them back and another loop followed. Their text
 * reads as commentary; only the last answering loop of a turn is its answer.
 */
export function supersededAnswerLoopIds(blocks: ReadonlyArray<Pick<ConversationWorkBlock, 'id' | 'kind' | 'result'>>): Set<string> {
  const loops = blocks.filter((block) => block.kind === 'llm_turn');
  return new Set(loops.slice(0, -1).filter((block) => block.result?.outputPhase === 'final_answer').map((block) => block.id));
}

/** The phase a text block presents with once its loop is known to be superseded. */
export function presentedTextPhase(phase: ConversationLoopOutputPhase | undefined, superseded: boolean): ConversationLoopOutputPhase | undefined {
  return superseded ? 'commentary' : phase;
}

/**
 * What a stopped turn keeps as its reply: the text the last answering loop had streamed, minus anything
 * already marked as commentary. The person saw it, so it stays the message body.
 */
export function stoppedReplyText(blocks: ReadonlyArray<Pick<ConversationWorkBlock, 'kind' | 'items'>>): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.kind !== 'llm_turn') continue;
    const text = loopTextItems(block)
      .filter((item) => item.phase !== 'commentary')
      .map((item) => item.text)
      .join('')
      .trim();
    if (text) return text;
  }
  return '';
}

/** A settled loop's answer text: its final-phase text blocks, in order. Empty for any other loop. */
export function loopFinalAnswerText(block: Pick<ConversationWorkBlock, 'items' | 'result'> | undefined): string {
  if (block?.result?.outputPhase !== 'final_answer') return '';
  return loopTextItems(block)
    .filter((item) => item.phase === 'final_answer')
    .map((item) => item.text)
    .join('')
    .trim();
}
