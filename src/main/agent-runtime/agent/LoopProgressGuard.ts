import { createHash } from 'node:crypto';
import type { AssistantMessage, ToolCall, ToolResultMessage } from '../core/types';

export type AgentLoopTerminationCode =
  | 'AGENT_NO_PROGRESS'
  | 'AGENT_MAX_TURNS_EXCEEDED';

export class AgentLoopTerminationError extends Error {
  readonly code: AgentLoopTerminationCode;
  readonly turn: number;
  readonly maxTurns?: number;

  constructor(
    code: AgentLoopTerminationCode,
    message: string,
    options: { turn: number; maxTurns?: number },
  ) {
    super(message);
    this.name = 'AgentLoopTerminationError';
    this.code = code;
    this.turn = options.turn;
    this.maxTurns = options.maxTurns;
  }
}

export const RUNTIME_NO_PROGRESS_INSTRUCTION = [
  '<runtime_no_progress>',
  'The immediately preceding tool round repeated the same ordered tools, arguments, outcomes, and semantic results without changing runtime state.',
  'Do not repeat the same calls while the effective tool set is unchanged. Change the action, use the returned evidence, or provide the canonical final answer.',
  '</runtime_no_progress>',
].join('\n');

export interface LoopProgressObservation {
  fingerprint: string;
  consecutiveMatches: number;
  action: 'continue' | 'inject-guidance' | 'terminate';
}

/**
 * Detects consecutive tool rounds that make no observable progress.
 *
 * The fingerprint deliberately excludes provider call ids and volatile timing
 * metadata. Runtime revision remains part of the fingerprint so deferred tool
 * activation immediately resets the guard.
 */
export class LoopProgressGuard {
  private previousFingerprint: string | null = null;
  private consecutiveMatches = 0;

  observe(
    assistantMessage: AssistantMessage,
    toolResults: readonly ToolResultMessage[],
    runtimeRevision: number,
  ): LoopProgressObservation {
    const fingerprint = createToolRoundFingerprint(
      assistantMessage,
      toolResults,
      runtimeRevision,
    );
    if (fingerprint === this.previousFingerprint) {
      this.consecutiveMatches += 1;
    } else {
      this.previousFingerprint = fingerprint;
      this.consecutiveMatches = 1;
    }

    return {
      fingerprint,
      consecutiveMatches: this.consecutiveMatches,
      action: this.consecutiveMatches >= 3
        ? 'terminate'
        : this.consecutiveMatches === 2
          ? 'inject-guidance'
          : 'continue',
    };
  }
}

export function createToolRoundFingerprint(
  assistantMessage: AssistantMessage,
  toolResults: readonly ToolResultMessage[],
  runtimeRevision: number,
): string {
  const toolCalls = assistantMessage.content.filter(
    (block): block is ToolCall => block.type === 'toolCall',
  );
  const round = {
    runtimeRevision,
    tools: toolCalls.map((toolCall, index) => {
      const result = toolResults[index];
      return {
        name: toolCall.name,
        arguments: normalizeSemanticValue(toolCall.arguments),
        outcome: result?.isError ? 'error' : 'success',
        result: result ? normalizeToolResult(result) : null,
      };
    }),
  };
  return createHash('sha256')
    .update(stableSerialize(round))
    .digest('hex');
}

function normalizeToolResult(result: ToolResultMessage): unknown {
  return {
    content: result.content.map((block) => block.type === 'text'
      ? { type: 'text', text: normalizeText(block.text) }
      : {
          type: 'image',
          mimeType: block.mimeType,
          digest: createHash('sha256').update(block.data).digest('hex'),
        }),
    details: normalizeSemanticValue(result.details),
  };
}

function normalizeSemanticValue(value: unknown, key?: string): unknown {
  if (key && isVolatileKey(key)) return undefined;
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSemanticValue(item));
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedChild = normalizeSemanticValue(child, childKey);
      if (normalizedChild !== undefined) normalized[childKey] = normalizedChild;
    }
    return normalized;
  }
  return value;
}

function isVolatileKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, '').toLowerCase();
  return normalized === 'callid'
    || normalized === 'toolcallid'
    || normalized === 'timestamp'
    || normalized.endsWith('timestamp')
    || normalized === 'duration'
    || normalized.endsWith('duration')
    || normalized === 'durationms'
    || normalized === 'elapsedms'
    || normalized === 'startedat'
    || normalized === 'completedat'
    || normalized === 'createdat'
    || normalized === 'updatedat';
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
