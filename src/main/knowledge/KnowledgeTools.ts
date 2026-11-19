/**
 * KnowledgeTools — five deferred AgentTools over the Knowledge five-service core.
 * Persistent writes stay on KnowledgeWriteService + human confirmation; never exposed here.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  KNOWLEDGE_CARD_TYPES,
  type KnowledgeCardRecord,
  type KnowledgeCardType,
  type KnowledgeRelation,
  type KnowledgeScope,
  type KnowledgeImageRef,
  type KnowledgeReadRequest,
} from '@shared/types/knowledge';
import { pathIdentityKey } from '../agent-runtime/knowledgeReadRoots';
import { knowledgeCandidateService, type KnowledgeCandidateService } from './KnowledgeCandidateService';
import { knowledgeCompileService, type KnowledgeCompileService } from './KnowledgeCompileService';
import { knowledgeQueryProperties, toKnowledgeQueryRequest } from './KnowledgeToolQuery';
import { projectKnowledgeRead } from './KnowledgeReadService';
import { knowledgeQueryService, type KnowledgeQueryService } from './KnowledgeQueryService';
import { isPathInside, resolveWithinRoot } from './knowledgeFs';
import type { AgentTool, AgentToolResult } from '../agent-runtime/agent/AgentTool';

export interface KnowledgeToolDependencies {
  query: KnowledgeQueryService;
  compile: KnowledgeCompileService;
  candidates: KnowledgeCandidateService;
}

const CARD_TYPE_SET = new Set<string>(KNOWLEDGE_CARD_TYPES);

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textResult<TDetails>(text: string, details: TDetails, isError = false): AgentToolResult<TDetails> {
  return { content: [{ type: 'text', text }], isError, details };
}

function errorResult(message: string, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
  return textResult(message, { ...details, ok: false }, true);
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

/** Declared conditions only; an axis the card does not declare is unknown, not a match. */
function formatKnowledgeScope(scope: KnowledgeScope | undefined): string {
  const applies = Object.entries(scope ?? {}).flatMap(([axis, value]) => axis !== 'exclusions' && typeof value === 'string' && value.trim() ? [`${axis}=${value}`] : []);
  const excludes = Object.entries(scope?.exclusions ?? {}).flatMap(([axis, values]) => (values ?? []).map(value => `${axis}=${value}`));
  if (!applies.length && !excludes.length) return 'applies to: not declared';
  return `applies to: ${applies.length ? applies.join(', ') : 'not declared'}${excludes.length ? ` · excludes: ${excludes.join(', ')}` : ''}`;
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
          lines.length > 0 ? `spaces\t${spaces.length}\n${lines.join('\n')}\nSpace list only; pass a spaceId to list its cards.` : 'No Knowledge spaces are available.',
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
    description: 'Search Knowledge cards across the six markdown-first retrieval lanes. Cite matching cardId and contentHash.',
    parameters: {
      type: 'object',
      properties: {
        ...knowledgeQueryProperties,
        offset: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        expectedRevision: { type: 'string' },
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
      const request = toKnowledgeQueryRequest(args, true);
      const result = await deps.query.query(request);
      const lines = result.hits.map((hit, index) => (
        `${(request.offset ?? 0) + index + 1}. ${hit.title} · ${hit.type ?? 'unknown'} · ${hit.lifecycle ?? 'unknown'} · ${hit.lanes.join('+')} · ${hit.cardId} · sha256:${hit.contentHash} · ${hit.spaceId}/${hit.relativePath}${hit.topics?.length ? ` · topics: ${hit.topics.map(topic => topic.label).join(', ')}` : ''}`
        + `\n   ${formatKnowledgeScope(hit.scope)}${hit.preview ? `\n   ${hit.preview.replace(/\s+/gu, ' ')}` : ''}`
      ));
      const header = `${result.total ?? result.hits.length} hits${result.nextOffset !== undefined ? ` · next offset ${result.nextOffset} · revision ${result.revision}` : ''}`;
      const emptyTextHint = request.text && (result.total ?? result.hits.length) === 0
        ? '\nNo matches for the current query and filters. Multiword text queries require all terms; try individual terms or browse a selected space before concluding that related cards are absent.'
        : '';
      const scopedEmptyHint = emptyTextHint && request.spaceIds?.length
        ? '\nOnly the selected spaces were searched; other spaces were not searched. If relevant, omit spaceIds to search accessible spaces.'
        : '';
      return textResult(
        lines.length > 0 ? `${header}\n${lines.join('\n')}` : `${header}${emptyTextHint}${scopedEmptyHint}`,
        {
          count: result.total ?? result.hits.length,
          revision: result.revision,
          nextOffset: result.nextOffset,
          cardIds: result.hits.map((hit) => hit.cardId),
          hits: result.hits.map((hit) => ({ cardId: hit.cardId, contentHash: hit.contentHash, spaceId: hit.spaceId, relativePath: hit.relativePath, preview: hit.preview, topics: hit.topics, scope: hit.scope })),
        },
      );
    },
  };
}

type KnowledgeImageReadRef = KnowledgeImageRef & { readImageArgs?: { path: string }; readError?: string };
async function imageReadRefs(images: KnowledgeImageRef[], spaceRoot: string | undefined, frozenRoots: readonly string[]): Promise<KnowledgeImageReadRef[]> {
  if (!images.length) return [];
  let root: string | undefined;
  try { if (spaceRoot) root = await fs.realpath(spaceRoot); } catch { /* Missing space roots do not grant image access. */ }
  const permitted = root && frozenRoots.some(candidate => pathIdentityKey(candidate) === pathIdentityKey(root!));
  return Promise.all(images.map(async image => {
    if (!permitted || !root) return { ...image, readError: 'KNOWLEDGE_IMAGE_READ_SCOPE_UNAVAILABLE' };
    try {
      if (path.isAbsolute(image.relativePath) || /^[a-z]:[\\/]/i.test(image.relativePath)) throw new Error('Absolute declaration');
      const target = await resolveWithinRoot(root, image.relativePath);
      if (!isPathInside(root, target)) throw new Error('Escaped frozen root');
      return { ...image, readImageArgs: { path: target } };
    } catch { return { ...image, readError: 'KNOWLEDGE_IMAGE_PATH_UNAVAILABLE' }; }
  }));
}

function createKnowledgeReadTool(deps: KnowledgeToolDependencies): AgentTool {
  return {
    name: 'knowledge_read',
    label: 'Read Knowledge',
    description: 'Read one Knowledge card by space and relative path. Summary can be read without a hash; section, range and full (the default) require the contentHash from a current search or summary. If the version changed, refresh it. Returns headings and line count for progressive reads. Declared images include roles and readImageArgs for read_image when inside the frozen Knowledge read scope; otherwise readError. Relative declarations are not workspace paths. Pixels remain unobserved until read_image succeeds.',
    parameters: {
      type: 'object',
      required: ['spaceId', 'relativePath'],
      properties: {
        spaceId: { type: 'string' },
        relativePath: { type: 'string' },
        mode: { type: 'string', enum: ['summary', 'section', 'range', 'full'], description: 'Defaults to full. Summary can be read without contentHash.' },
        heading: { type: 'string' },
        headingLine: { type: 'integer', minimum: 1 },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
        contentHash: { type: 'string', description: 'Required for section, range and full. Use the hash from the current search or summary.' },
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
    async execute(_id, args, _signal, _onUpdate, context) {
      const spaceId = asString(args.spaceId);
      const relativePath = asString(args.relativePath);
      if (!spaceId || !relativePath) return errorResult('spaceId and relativePath are required.');
      const space = deps.query.listSpaces().find(candidate => candidate.spaceId === spaceId);
      const card = await deps.query.getCard(spaceId, relativePath);
      if (!card) return errorResult(`Knowledge card not found: ${spaceId}:${relativePath}`, { spaceId, relativePath });
      let selected: ReturnType<typeof projectKnowledgeRead>;
      try {
        selected = projectKnowledgeRead(card, { ...args, spaceId, relativePath,
          mode: typeof args.mode === 'string' ? args.mode : 'full' } as KnowledgeReadRequest);
      }
      catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
      const headings = selected.headings.map(heading => `- ${heading.title} (line ${heading.line}, level ${heading.level})`);
      const outline = `lineCount: ${selected.lineCount}\nheadings: ${headings.length}${headings.length ? `\n${headings.join('\n')}` : ''}\n\n`;
      const images = await imageReadRefs(card.images ?? [], space?.rootPath, context?.knowledgeReadRoots ?? []);
      const imageLines = images.map(image => `- ${image.role}\t${image.relativePath}\t${image.readImageArgs
        ? `read_image ${JSON.stringify(image.readImageArgs)}` : image.readError}`);
      const imageBlock = imageLines.length > 0
        ? `images\t${images.length}\n${imageLines.join('\n')}\n\n`
        : '';
      return textResult(
        `# ${card.title}\n\ncardId: ${card.cardId}\ncontentHash: ${card.contentHash ? `sha256:${card.contentHash}` : 'unavailable'}\nrange: ${selected.range}\n\n${outline}${imageBlock}${selected.content}`,
        { spaceId, relativePath, cardId: card.cardId, contentHash: card.contentHash, title: card.title, range: selected.range,
          headings: selected.headings, lineCount: selected.lineCount, images },
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
        ...knowledgeQueryProperties,
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
      const query = await deps.query.query(toKnowledgeQueryRequest(args));
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.trunc(args.limit)) : 12;
      const pack = deps.compile.compile(query, { limit });
      const hitLines = pack.hits.map((hit, index) => (
        `${index + 1}. ${hit.title} · ${hit.cardId} · sha256:${hit.contentHash} · ${hit.reasons.join('; ')}`
      ));
      const conflictLines = pack.conflicts.map((conflict) => (
        `conflict ${conflict.kind}: ${conflict.leftCardId} <> ${conflict.rightCardId}`
      ));
      const body = [
        `pack ${pack.packId} · ${pack.hits.length} hits`,
        ...hitLines,
        ...conflictLines,
      ].join('\n');
      return textResult(body, {
        packId: pack.packId,
        count: pack.hits.length,
        cardIds: pack.hits.map((hit) => hit.cardId),
        hits: pack.hits.map((hit) => ({ cardId: hit.cardId, contentHash: hit.contentHash, spaceId: hit.spaceId, relativePath: hit.relativePath })),
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
