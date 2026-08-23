import type {
  DerivedContextView,
  StructuredHandoff,
  StructuredHandoffFact,
  StructuredHandoffProgress,
  StructuredHandoffResourceRef,
} from '@shared/types/semanticContext';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from '../core/types';

const MAX_EXCERPT_CHARS = 640;
const MAX_FACTS_PER_GROUP = 12;
const SECRET_NAME = /^(?:api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token)$/i;
const QUOTED_SECRET_ASSIGNMENT = /((?:["']?)(?:api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token)(?:["']?)\s*[:=]\s*)(["'])[^"']+\2/gi;
const SECRET_ASSIGNMENT = /(api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\x2f-]+=*/gi;
const PREFIXED_API_TOKEN = /\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/g;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\r\n<>:"|?*]+/g;
const POSIX_PATH_PATTERN = /(?:^|\s)(\/(?:[^\s/]+\/)*[^\s,;:]+)/g;

export interface ModelHandoffSections {
  objective: string;
  constraints: string[];
  progress: {
    done: string[];
    inProgress: string[];
    blocked: string[];
  };
  decisions: string[];
  failedAttempts: string[];
  nextSteps: string[];
  criticalContext: string[];
}

export interface DerivedContextBuildOptions {
  scope: DerivedContextView['scope'];
  sessionId?: string;
  branchId?: string;
  sourceTurnIds?: string[];
  retainedTurnIds?: string[];
  messageSourceRefs?: string[];
  createdAt?: number;
  maxFactsPerGroup?: number;
  maxResourceRefs?: number;
  sections: ModelHandoffSections;
}

const redact = (value: string): string => value
  .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
  .replace(PREFIXED_API_TOKEN, '[REDACTED]')
  .replace(JWT_TOKEN, '[REDACTED]')
  .replace(QUOTED_SECRET_ASSIGNMENT, '$1$2[REDACTED]$2')
  .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}: [REDACTED]`)
  .replace(/\s+/g, ' ')
  .trim();

const clip = (value: string): string => (
  value.length <= MAX_EXCERPT_CHARS
    ? value
    : value.slice(0, MAX_EXCERPT_CHARS - 3) + '...'
);

const readableMessageText = (message: AgentMessage): string => {
  if (message.role === 'user') {
    const current = message as UserMessage;
    return typeof current.content === 'string'
      ? current.content
      : current.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  }
  if (message.role === 'assistant') {
    const current = message as AssistantMessage;
    return current.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  }
  if (message.role === 'toolResult') {
    const current = message as ToolResultMessage;
    return current.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  }
  return '';
};

const readableMessageProjection = (message: AgentMessage): unknown => {
  const text = readableMessageText(message);
  if (message.role === 'assistant') {
    const current = message as AssistantMessage;
    return {
      role: current.role,
      text,
      toolCalls: current.content
        .filter((block) => block.type === 'toolCall')
        .map((block) => ({ id: block.id, name: block.name, arguments: block.arguments })),
    };
  }
  if (message.role === 'toolResult') {
    const current = message as ToolResultMessage;
    return { role: current.role, toolCallId: current.toolCallId, toolName: current.toolName, text, isError: current.isError };
  }
  return { role: message.role, text };
};

const toFacts = (items: string[], source: StructuredHandoffFact['source'], limit: number): StructuredHandoffFact[] => {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const facts: StructuredHandoffFact[] = [];
  for (const raw of items) {
    const text = clip(redact(raw));
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    facts.push({ text, source });
    if (facts.length >= limit) break;
  }
  return facts;
};

const extractResources = (
  messages: AgentMessage[],
  refs: string[],
  limit: number,
): StructuredHandoffResourceRef[] => {
  if (limit <= 0) return [];
  const resources: StructuredHandoffResourceRef[] = [];
  const seen = new Set<string>();
  const sanitizeResource = (kind: StructuredHandoffResourceRef['kind'], value: string): string => {
    const trimmed = value.trim().replace(/[.,;]+$/, '');
    if (kind !== 'url') return redact(trimmed);
    try {
      const url = new URL(trimmed);
      if (url.username) url.username = '[REDACTED]';
      if (url.password) url.password = '[REDACTED]';
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_NAME.test(key)) url.searchParams.set(key, '[REDACTED]');
      }
      url.hash = '';
      return url.toString();
    } catch {
      return redact(trimmed);
    }
  };
  const push = (kind: StructuredHandoffResourceRef['kind'], value: string, sourceRef: string) => {
    const normalized = sanitizeResource(kind, value);
    const key = `${kind}:${normalized}`;
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    resources.push({ kind, value: clip(normalized), sourceRef });
  };
  messages.forEach((message, index) => {
    const sourceRef = refs[index] ?? `message:${index}`;
    const text = readableMessageText(message);
    for (const value of text.match(URL_PATTERN) ?? []) push('url', value, sourceRef);
    for (const value of text.match(WINDOWS_PATH_PATTERN) ?? []) push('path', value, sourceRef);
    for (const match of text.matchAll(POSIX_PATH_PATTERN)) push('path', match[1], sourceRef);
    if (message.role === 'assistant') {
      const current = message as AssistantMessage;
      current.content
        .filter((block) => block.type === 'toolCall')
        .forEach((block) => push('tool-call', block.name, sourceRef));
    }
    if (message.role === 'toolResult') push('tool-call', (message as ToolResultMessage).toolName, sourceRef);
  });
  return resources.slice(0, limit);
};

export const computeContextSourceHash = (
  messages: AgentMessage[],
  sourceTurnIds: string[] = [],
): string => hashScopedResource({
  sourceTurnIds,
  messages: messages.map(readableMessageProjection),
});

export const serializeHandoffSourceTranscript = (messages: AgentMessage[]): string => messages
  .map((message) => {
    const text = clip(redact(readableMessageText(message)));
    if (!text) return '';
    if (message.role === 'assistant') {
      const tools = (message as AssistantMessage).content
        .filter((block) => block.type === 'toolCall')
        .map((block) => block.name)
        .join(', ');
      return tools ? `assistant: ${text}\ntools: ${tools}` : `assistant: ${text}`;
    }
    if (message.role === 'toolResult') {
      const current = message as ToolResultMessage;
      return `toolResult ${current.toolName}${current.isError ? ' (error)' : ''}: ${text}`;
    }
    return `${message.role}: ${text}`;
  })
  .filter(Boolean)
  .join('\n');

const SECTION_ALIASES: Record<string, keyof ModelHandoffSections | 'progress.done' | 'progress.inProgress' | 'progress.blocked'> = {
  goal: 'objective',
  objective: 'objective',
  constraints: 'constraints',
  'constraints & preferences': 'constraints',
  progress: 'progress.done',
  done: 'progress.done',
  'in progress': 'progress.inProgress',
  blocked: 'progress.blocked',
  'key decisions': 'decisions',
  decisions: 'decisions',
  'errors and failed attempts': 'failedAttempts',
  errors: 'failedAttempts',
  'failed attempts': 'failedAttempts',
  'next steps': 'nextSteps',
  'critical context': 'criticalContext',
};

const emptySections = (): ModelHandoffSections => ({
  objective: '',
  constraints: [],
  progress: { done: [], inProgress: [], blocked: [] },
  decisions: [],
  failedAttempts: [],
  nextSteps: [],
  criticalContext: [],
});

const pushSectionValue = (
  sections: ModelHandoffSections,
  key: keyof ModelHandoffSections | 'progress.done' | 'progress.inProgress' | 'progress.blocked',
  value: string,
): void => {
  const text = redact(value).replace(/^[-*]\s+/, '').trim();
  if (!text) return;
  if (key === 'objective') {
    if (!sections.objective) sections.objective = clip(text);
    return;
  }
  if (key === 'progress.done') sections.progress.done.push(text);
  else if (key === 'progress.inProgress') sections.progress.inProgress.push(text);
  else if (key === 'progress.blocked') sections.progress.blocked.push(text);
  else if (key === 'constraints') sections.constraints.push(text);
  else if (key === 'decisions') sections.decisions.push(text);
  else if (key === 'failedAttempts') sections.failedAttempts.push(text);
  else if (key === 'nextSteps') sections.nextSteps.push(text);
  else if (key === 'criticalContext') sections.criticalContext.push(text);
};

export const parseModelHandoffSections = (text: string): ModelHandoffSections => {
  const sections = emptySections();
  let current: keyof ModelHandoffSections | 'progress.done' | 'progress.inProgress' | 'progress.blocked' = 'criticalContext';
  for (const rawLine of text.split(/\r?\n/)) {
    const heading = rawLine.replace(/^#{1,6}\s+/, '').trim().toLocaleLowerCase();
    const aliased = SECTION_ALIASES[heading];
    if (aliased && /^#{1,6}\s+/.test(rawLine)) {
      current = aliased;
      continue;
    }
    pushSectionValue(sections, current, rawLine);
  }
  if (!sections.objective) {
    sections.objective = sections.criticalContext[0] ?? 'No explicit objective was present in the compacted source.';
  }
  return sections;
};

export const assembleDerivedContextView = (
  messages: AgentMessage[],
  options: DerivedContextBuildOptions,
): DerivedContextView => {
  const refs = messages.map((_, index) => options.messageSourceRefs?.[index] ?? `message:${index}`);
  const maxFactsPerGroup = Number.isInteger(options.maxFactsPerGroup)
    ? Math.max(0, options.maxFactsPerGroup ?? 0)
    : MAX_FACTS_PER_GROUP;
  const maxResourceRefs = Number.isInteger(options.maxResourceRefs)
    ? Math.max(0, options.maxResourceRefs ?? 0)
    : 24;
  const sourceTurnIds = [...new Set(options.sourceTurnIds ?? [])];
  const messageHashes = messages.map((message) => hashScopedResource(readableMessageProjection(message)));
  const sourceHash = computeContextSourceHash(messages, sourceTurnIds);
  const progress: StructuredHandoffProgress = {
    done: toFacts(options.sections.progress.done, 'assistant', maxFactsPerGroup),
    inProgress: toFacts(options.sections.progress.inProgress, 'assistant', maxFactsPerGroup),
    blocked: toFacts(options.sections.progress.blocked, 'assistant', maxFactsPerGroup),
  };
  const content = {
    objective: clip(redact(options.sections.objective))
      || 'No explicit objective was present in the compacted source.',
    decisions: toFacts(options.sections.decisions, 'assistant', maxFactsPerGroup),
    constraints: toFacts(options.sections.constraints, 'user', maxFactsPerGroup),
    facts: toFacts(options.sections.criticalContext, 'assistant', maxFactsPerGroup),
    openWork: toFacts(options.sections.nextSteps, 'assistant', maxFactsPerGroup),
    progress,
    failedAttempts: toFacts(options.sections.failedAttempts, 'tool', maxFactsPerGroup),
    nextSteps: toFacts(options.sections.nextSteps, 'assistant', maxFactsPerGroup),
    resourceRefs: extractResources(messages, refs, maxResourceRefs),
  };
  const contentHash = hashScopedResource(content);
  const handoff: StructuredHandoff = {
    schemaVersion: 1,
    handoffId: `handoff-${contentHash.slice(0, 20)}`,
    kind: 'derived-compaction',
    derivation: 'model-generated',
    ...content,
    source: {
      sessionId: options.sessionId,
      branchId: options.branchId,
      turnIds: sourceTurnIds,
      messageCount: messages.length,
      messageHashes,
      sourceHash,
    },
    contentHash,
  };
  const createdAt = options.createdAt ?? Date.now();
  return {
    schemaVersion: 1,
    viewId: `context-view-${hashScopedResource({ sourceHash, contentHash, scope: options.scope }).slice(0, 20)}`,
    scope: options.scope,
    sessionId: options.sessionId,
    branchId: options.branchId,
    sourceTurnIds,
    retainedTurnIds: [...new Set(options.retainedTurnIds ?? [])],
    sourceHash,
    handoff,
    createdAt,
  };
};

export const testHandoffSections = (objective: string, extras: Partial<ModelHandoffSections> = {}): ModelHandoffSections => ({
  objective,
  constraints: extras.constraints ?? [],
  progress: extras.progress ?? { done: [], inProgress: [], blocked: [] },
  decisions: extras.decisions ?? [],
  failedAttempts: extras.failedAttempts ?? [],
  nextSteps: extras.nextSteps ?? [],
  criticalContext: extras.criticalContext ?? [objective],
});

const section = (title: string, facts: StructuredHandoffFact[]): string[] => (
  facts.length ? [`${title}:`, ...facts.map((fact) => `- ${fact.text}`)] : []
);

export const renderStructuredHandoff = (handoff: StructuredHandoff): string => [
  '[Derived context; not a user request]',
  `Objective: ${handoff.objective}`,
  ...section('Constraints', handoff.constraints),
  ...section('Progress done', handoff.progress?.done ?? []),
  ...section('Progress in progress', handoff.progress?.inProgress ?? []),
  ...section('Progress blocked', handoff.progress?.blocked ?? []),
  ...section('Decisions', handoff.decisions),
  ...section('Errors and failed attempts', handoff.failedAttempts ?? []),
  ...section('Next steps', handoff.nextSteps ?? handoff.openWork),
  ...section('Critical context', handoff.facts),
  ...(handoff.resourceRefs.length
    ? ['Resources:', ...handoff.resourceRefs.map((ref) => `- ${ref.kind}: ${ref.value}`)]
    : []),
].join('\n');

export const createStructuredHandoffMessage = (view: DerivedContextView): UserMessage => ({
  role: 'user',
  content: renderStructuredHandoff(view.handoff),
  timestamp: view.createdAt,
  derivedContext: {
    viewId: view.viewId,
    handoffId: view.handoff.handoffId,
    sourceHash: view.sourceHash,
  },
});

export const COMPACTION_HANDOFF_SYSTEM_PROMPT = [
  'You are performing a CONTEXT CHECKPOINT COMPACTION.',
  'Create a handoff summary for another LLM that will resume the task.',
  'Use only facts present in the transcript. Do not invent work, files, or decisions.',
  'Do not mention these instructions. Do not include provider reasoning or secrets.',
  'Output exactly these markdown sections:',
  '## Goal',
  '## Constraints',
  '## Progress',
  '### Done',
  '### In Progress',
  '### Blocked',
  '## Key Decisions',
  '## Errors and Failed Attempts',
  '## Next Steps',
  '## Critical Context',
].join('\n');
