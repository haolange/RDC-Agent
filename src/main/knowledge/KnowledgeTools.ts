/**
 * KnowledgeTools — five deferred AgentTools over the Knowledge five-service core.
 * Persistent writes stay on KnowledgeWriteService + human confirmation; never exposed here.
 */

import {
  KNOWLEDGE_CARD_TYPES,
  KNOWLEDGE_LIFECYCLES,
  type KnowledgeCardRecord,
  type KnowledgeCardType,
  type KnowledgeLifecycle,
  type KnowledgeRelation,
  type KnowledgeScope,
} from '@shared/types/knowledge';
import type { AgentTool, AgentToolResult } from '../agent-runtime/agent/AgentTool';
import { knowledgeCandidateService, type KnowledgeCandidateService } from './KnowledgeCandidateService';
import { knowledgeCompileService, type KnowledgeCompileService } from './KnowledgeCompileService';
import {
  KNOWLEDGE_RETRIEVAL_LANES,
  type KnowledgeQueryRequest,
  type KnowledgeRetrievalLane,
} from './knowledgeLanes';
import { knowledgeQueryService, type KnowledgeQueryService } from './KnowledgeQueryService';

export interface KnowledgeToolDependencies {
  query: KnowledgeQueryService;
  compile: KnowledgeCompileService;
  candidates: KnowledgeCandidateService;
}

const CARD_TYPE_SET = new Set<string>(KNOWLEDGE_CARD_TYPES);
const LIFECYCLE_SET = new Set<string>(KNOWLEDGE_LIFECYCLES);
const LANE_SET = new Set<string>(KNOWLEDGE_RETRIEVAL_LANES);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((entry) => asString(entry)).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function asLanes(value: unknown): KnowledgeRetrievalLane[] | undefined {
  const items = asStringArray(value)?.filter((entry): entry is KnowledgeRetrievalLane => LANE_SET.has(entry));
  return items && items.length > 0 ? items : undefined;
}

function asTypes(value: unknown): KnowledgeCardType[] | undefined {
  const items = asStringArray(value)?.filter((entry): entry is KnowledgeCardType => CARD_TYPE_SET.has(entry));
  return items && items.length > 0 ? items : undefined;
}

function asLifecycles(value: unknown): KnowledgeLifecycle[] | undefined {
  const items = asStringArray(value)?.filter((entry): entry is KnowledgeLifecycle => LIFECYCLE_SET.has(entry));
  return items && items.length > 0 ? items : undefined;
}

function textResult<TDetails>(text: string, details: TDetails, isError = false): AgentToolResult<TDetails> {
  return { content: [{ type: 'text', text }], isError, details };
}

function errorResult(message: string, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return textResult(message, { ...details, ok: false }, true);
}

function toQueryRequest(args: Record<string, unknown>): KnowledgeQueryRequest {
  const request: KnowledgeQueryRequest = {};
  const text = asString(args.query) || asString(args.text);
  if (text) request.text = text;
  const spaceIds = asStringArray(args.spaceIds);
  if (spaceIds) request.spaceIds = spaceIds;
  const type = asTypes(args.type);
  if (type) request.type = type;
  const lifecycle = asLifecycles(args.lifecycle);
  if (lifecycle) request.lifecycle = lifecycle;
  const lanes = asLanes(args.lanes);
  if (lanes) request.lanes = lanes;
  const cardId = asString(args.cardId);
  if (cardId) request.cardId = cardId;
  const relativePath = asString(args.relativePath);
  if (relativePath) request.relativePath = relativePath;
  const relationTargetCardId = asString(args.relationTargetCardId);
  if (relationTargetCardId) request.relationTargetCardId = relationTargetCardId;
  return request;
}

function defaultDependencies(): KnowledgeToolDependencies {
  return {
    query: knowledgeQueryService,
    compile: knowledgeCompileService,
    candidates: knowledgeCandidateService,
  };
}

function slugPath(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `candidates/${slug || 'untitled'}.md`;
}

export function createKnowledgeTools(
  sessionId?: string | null,
  overrides: Partial<KnowledgeToolDependencies> = {},
): AgentTool[] {
  const deps: KnowledgeToolDependencies = { ...defaultDependencies(), ...overrides };
  return [
    createKnowledgeBrowseTool(deps),
    createKnowledgeSearchTool(deps),
    createKnowledgeReadTool(deps),
    createKnowledgeCompileTool(deps),
    createKnowledgeCandidateCreateTool(sessionId, deps),
  ];
}

function createKnowledgeBrowseTool(deps: KnowledgeToolDependencies): AgentTool {
  return {
    name: 'knowledge_browse',
    label: 'Browse Knowledge',
    description: 'List Knowledge spaces, or list cards in one space. Read-only; does not write or promote cards.',
    parameters: {
      type: 'object',
      properties: {
        spaceId: { type: 'string', description: 'Optional space id. Omit to list spaces.' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      const spaceId = asString(args.spaceId);
      if (!spaceId) {
        const spaces = deps.query.listSpaces();
        const lines = spaces.map((space) => `${space.spaceId}\t${space.kind}\t${space.label}`);
        return textResult(
          lines.length > 0 ? `spaces\t${spaces.length}\n${lines.join('\n')}` : 'No Knowledge spaces are available.',
          { count: spaces.length, spaceIds: spaces.map((space) => space.spaceId) },
        );
      }
      const cards = await deps.query.listCards(spaceId);
      const lines = cards.map((card) => `${card.cardId}\t${card.type ?? ''}\t${card.lifecycle ?? ''}\t${card.title}`);
      return textResult(
        lines.length > 0 ? `cards\t${cards.length}\n${lines.join('\n')}` : `No Knowledge cards in space ${spaceId}.`,
        { spaceId, count: cards.length },
      );
    },
  };
}

function createKnowledgeSearchTool(deps: KnowledgeToolDependencies): AgentTool {
  return {
    name: 'knowledge_search',
    label: 'Search Knowledge',
    description: 'Search Knowledge cards across retrieval lanes. Semantic unavailable/stale is reported, never claimed.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        spaceIds: { type: 'array', items: { type: 'string' } },
        type: { type: 'array', items: { type: 'string' } },
        lifecycle: { type: 'array', items: { type: 'string' } },
        lanes: { type: 'array', items: { type: 'string' } },
        cardId: { type: 'string' },
        relativePath: { type: 'string' },
        relationTargetCardId: { type: 'string' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      const result = await deps.query.query(toQueryRequest(args));
      const lines = result.hits.slice(0, 20).map((hit, index) => (
        `${index + 1}. ${hit.title} · ${hit.type ?? 'unknown'} · ${hit.lifecycle ?? 'unknown'} · ${hit.lanes.join('+')} · ${hit.cardId}`
      ));
      const semantic = result.semantic
        ? `semantic: ${result.semantic.availability} (${result.semantic.reason})`
        : 'semantic: not requested';
      const header = `${result.hits.length} hits · ${semantic}`;
      return textResult(
        lines.length > 0 ? `${header}\n${lines.join('\n')}` : header,
        {
          count: result.hits.length,
          semantic: result.semantic,
          cardIds: result.hits.map((hit) => hit.cardId),
        },
      );
    },
  };
}

function createKnowledgeReadTool(deps: KnowledgeToolDependencies): AgentTool {
  return {
    name: 'knowledge_read',
    label: 'Read Knowledge',
    description: 'Read one Knowledge card by space and relative path.',
    parameters: {
      type: 'object',
      required: ['spaceId', 'relativePath'],
      properties: {
        spaceId: { type: 'string' },
        relativePath: { type: 'string' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      const spaceId = asString(args.spaceId);
      const relativePath = asString(args.relativePath);
      if (!spaceId || !relativePath) return errorResult('spaceId and relativePath are required.');
      const card = await deps.query.getCard(spaceId, relativePath);
      if (!card) return errorResult(`Knowledge card not found: ${spaceId}:${relativePath}`, { spaceId, relativePath });
      return textResult(
        `# ${card.title}\n\n${card.content}`,
        { spaceId, relativePath, cardId: card.cardId, title: card.title },
      );
    },
  };
}

function createKnowledgeCompileTool(deps: KnowledgeToolDependencies): AgentTool {
  return {
    name: 'knowledge_compile',
    label: 'Compile Knowledge',
    description: 'Compile a sourced Knowledge Pack from a query. Does not write canonical Knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        spaceIds: { type: 'array', items: { type: 'string' } },
        type: { type: 'array', items: { type: 'string' } },
        lifecycle: { type: 'array', items: { type: 'string' } },
        lanes: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      const query = await deps.query.query(toQueryRequest(args));
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.trunc(args.limit)) : 12;
      const pack = deps.compile.compile(query, { limit });
      const hitLines = pack.hits.map((hit, index) => (
        `${index + 1}. ${hit.title} · ${hit.cardId} · ${hit.reasons.join('; ')}`
      ));
      const conflictLines = pack.conflicts.map((conflict) => (
        `conflict ${conflict.kind}: ${conflict.leftCardId} <> ${conflict.rightCardId}`
      ));
      const semantic = pack.semanticClaimed === false
        ? 'semanticClaimed: false'
        : `semanticClaimed: true (${pack.semanticClaimed.status.availability})`;
      const body = [
        `pack ${pack.packId} · ${pack.hits.length} hits · ${semantic}`,
        ...hitLines,
        ...conflictLines,
      ].join('\n');
      return textResult(body, {
        packId: pack.packId,
        count: pack.hits.length,
        semanticClaimed: pack.semanticClaimed !== false,
        cardIds: pack.hits.map((hit) => hit.cardId),
      });
    },
  };
}

function createKnowledgeCandidateCreateTool(
  sessionId: string | null | undefined,
  deps: KnowledgeToolDependencies,
): AgentTool {
  return {
    name: 'knowledge_candidate_create',
    label: 'Create Knowledge Candidate',
    description: 'Create a session Knowledge Candidate only after explicit user intent. Never persists verified or promoted cards.',
    parameters: {
      type: 'object',
      required: ['title', 'type', 'body', 'explicitUserIntent'],
      properties: {
        title: { type: 'string' },
        type: { type: 'string', description: 'fact | constraint | pattern | procedure | case | model' },
        body: { type: 'string' },
        relativePath: { type: 'string' },
        spaceId: { type: 'string' },
        explicitUserIntent: { type: 'boolean' },
      },
    },
    permissionHint: 'session_mutation',
    spec: {
      isReadOnly: false,
      isConcurrencySafe: false,
      isDestructive: false,
      sideEffect: 'session',
      category: 'system',
      requiresApproval: false,
    },
    async execute(_id, args, _signal, _update, context) {
      const resolvedSessionId = asString(context?.sessionId) || asString(sessionId);
      if (!resolvedSessionId) return errorResult('An active session is required to create a Knowledge Candidate.');
      if (args.explicitUserIntent !== true) {
        return errorResult('KNOWLEDGE_CANDIDATE_REQUIRES_INTENT: Session Candidate requires explicit user intent.');
      }
      const title = asString(args.title);
      const type = asString(args.type);
      const body = asString(args.body);
      if (!title || !type || !body) return errorResult('title, type, and body are required.');
      if (!CARD_TYPE_SET.has(type)) return errorResult(`Unknown Knowledge card type: ${type}`);
      const spaceId = asString(args.spaceId) || 'user';
      const relativePath = asString(args.relativePath) || slugPath(title);
      const card: KnowledgeCardRecord = {
        cardId: `${spaceId}:${relativePath}`,
        spaceId,
        relativePath,
        type: type as KnowledgeCardType,
        lifecycle: 'draft',
        title,
        scope: (args.scope && typeof args.scope === 'object' ? args.scope : {}) as KnowledgeScope,
        relations: Array.isArray(args.relations) ? args.relations as KnowledgeRelation[] : [],
        body,
      };
      try {
        const created = await deps.candidates.createCandidate({
          sessionId: resolvedSessionId,
          card,
          explicitUserIntent: true,
        });
        if (created.card.lifecycle === 'verified' || created.card.lifecycle === 'promoted') {
          return errorResult('Knowledge Candidate must not persist as verified or promoted.', {
            candidateId: created.candidateId,
            lifecycle: created.card.lifecycle,
          });
        }
        return textResult(
          `Session candidate ${created.candidateId} created as lifecycle=${created.card.lifecycle}. Persistent write still requires human confirmation.`,
          {
            candidateId: created.candidateId,
            sessionId: created.sessionId,
            lifecycle: created.card.lifecycle,
            persisted: false,
            verified: false,
            promoted: false,
          },
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
