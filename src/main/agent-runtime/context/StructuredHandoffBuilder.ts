import type {
  DerivedContextView,
  StructuredHandoff,
  StructuredHandoffFact,
  StructuredHandoffResourceRef,
} from '@shared/types/semanticContext';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import type { AgentMessage, AssistantMessage, ToolResultMessage, UserMessage } from '../core/types';

const MAX_EXCERPT_CHARS = 640;
const MAX_FACTS_PER_GROUP = 12;
const SECRET_NAME = /^(?:api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token)$/i;
const QUOTED_SECRET_ASSIGNMENT = /((?:["']?)(?:api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token)(?:["']?)\s*[:=]\s*)(["'])[^"']+\2/gi;
const SECRET_ASSIGNMENT = /(api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token)\s*[:=]\s*[^\s,;]+/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const PREFIXED_API_TOKEN = /\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/g;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\r\n<>:"|?*]+/g;
const POSIX_PATH_PATTERN = /(?:^|\s)(\/(?:[^\s/]+\/)*[^\s,;:]+)/g;

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
}

interface ExtractedLine {
  text: string;
  source: StructuredHandoffFact['source'];
  sourceRef: string;
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
const uniqueFacts = (items: ExtractedLine[], limit: number): StructuredHandoffFact[] => {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const facts: StructuredHandoffFact[] = [];
  for (const item of items) {
    const key = item.text.toLocaleLowerCase();
    if (!item.text || seen.has(key)) continue;
    seen.add(key);
    facts.push({ text: item.text, source: item.source, sourceRef: item.sourceRef });
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

export const buildDerivedContextView = (
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
  const lines: ExtractedLine[] = [];
  messages.forEach((message, index) => {
    const source = message.role === 'toolResult' ? 'tool' : message.role === 'assistant' ? 'assistant' : 'user';
    readableMessageText(message)
      .split(/(?:\r?\n)+|(?<=[.!?\u3002\uff01\uff1f])\s+/)
      .map((value) => clip(redact(value)))
      .filter(Boolean)
      .forEach((text) => lines.push({ text, source, sourceRef: refs[index] }));
  });

  const userLines = lines.filter((line) => line.source === 'user');
  const objective = userLines[0]?.text ?? lines[0]?.text ?? 'No explicit objective was present in the compacted source.';
  const decisions = uniqueFacts(
    lines.filter((line) => /(decid|chosen|selected|adopt|\u91c7\u7528|\u51b3\u5b9a|\u9009\u62e9|\u6536\u655b|\u786e\u8ba4)/i.test(line.text)),
    maxFactsPerGroup,
  );
  const constraints = uniqueFacts(
    lines.filter((line) => /(must|must not|cannot|require|constraint|\u7981\u6b62|\u4e0d\u5f97|\u5fc5\u987b|\u8981\u6c42|\u7ea6\u675f|\u9650\u5236)/i.test(line.text)),
    maxFactsPerGroup,
  );
  const openWork = uniqueFacts(
    lines.filter((line) => /(todo|pending|next|remaining|unresolved|\u5f85\u529e|\u4e0b\u4e00\u6b65|\u5c1a\u672a|\u672a\u5b8c\u6210|\u9700\u7ee7\u7eed)/i.test(line.text)),
    maxFactsPerGroup,
  );
  const classified = new Set([...decisions, ...constraints, ...openWork].map((fact) => `${fact.sourceRef}:${fact.text}`));
  const facts = uniqueFacts(
    lines.filter((line) => !classified.has(`${line.sourceRef}:${line.text}`)),
    maxFactsPerGroup,
  );
  const sourceTurnIds = [...new Set(options.sourceTurnIds ?? [])];
  const messageHashes = messages.map((message) => hashScopedResource(readableMessageProjection(message)));
  const sourceHash = computeContextSourceHash(messages, sourceTurnIds);
  const content = {
    objective,
    decisions,
    constraints,
    facts,
    openWork,
    resourceRefs: extractResources(messages, refs, maxResourceRefs),
  };
  const contentHash = hashScopedResource(content);
  const handoff: StructuredHandoff = {
    schemaVersion: 1,
    handoffId: `handoff-${contentHash.slice(0, 20)}`,
    kind: 'derived-compaction',
    derivation: 'deterministic-extractive',
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

const section = (title: string, facts: StructuredHandoffFact[]): string[] => (
  facts.length ? [`${title}:`, ...facts.map((fact) => `- ${fact.text}`)] : []
);

export const renderStructuredHandoff = (handoff: StructuredHandoff): string => [
  '[Derived context; not a user request]',
  `Objective: ${handoff.objective}`,
  ...section('Decisions', handoff.decisions),
  ...section('Constraints', handoff.constraints),
  ...section('Facts', handoff.facts),
  ...section('Open work', handoff.openWork),
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
