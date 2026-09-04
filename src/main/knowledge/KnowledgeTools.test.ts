import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeCardRecord, KnowledgeSpace } from '@shared/types/knowledge';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeTools } from './KnowledgeTools';
import { createDisposableCandidateService, KnowledgeCandidateService } from './KnowledgeCandidateService';
import { KnowledgeCompileService } from './KnowledgeCompileService';
import { KnowledgeQueryService } from './KnowledgeQueryService';
import type { KnowledgeQueryResult } from './knowledgeLanes';

const card: KnowledgeCardRecord = {
  cardId: 'user:facts/sample.md',
  spaceId: 'user',
  relativePath: 'facts/sample.md',
  type: 'fact',
  lifecycle: 'draft',
  title: 'Sample fact',
  scope: {},
  relations: [],
  body: 'A fact.',
};

const spaces: KnowledgeSpace[] = [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: '/tmp/knowledge' }];

const queryResult: KnowledgeQueryResult = {
  hits: [{
    cardId: card.cardId,
    spaceId: card.spaceId,
    relativePath: card.relativePath,
    title: card.title,
    type: card.type,
    lifecycle: card.lifecycle,
    score: 5,
    lanes: ['Lexical'],
  }],
  lanes: [{ lane: 'Lexical', hits: [] }],
};

function createTools(candidates: KnowledgeCandidateService = createDisposableCandidateService(
  mkdtempSync(path.join(tmpdir(), 'rdc-knowledge-tools-')),
)) {
  const query = {
    listSpaces: vi.fn(() => spaces),
    listCards: vi.fn(async () => [{ cardId: card.cardId, spaceId: card.spaceId, relativePath: card.relativePath, title: card.title }]),
    getCard: vi.fn(async () => ({ ...card, content: card.body })),
    query: vi.fn(async () => queryResult),
  } as unknown as KnowledgeQueryService;
  const compile = new KnowledgeCompileService({ now: () => new Date('2026-09-01T00:00:00.000Z') });
  const tools = createKnowledgeTools('session-tools', { query, compile, candidates });
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  return { byName, query, candidates };
}

describe('KnowledgeTools', () => {
  it('registers the five deferred Knowledge tools and no persistent write tools', () => {
    const { byName } = createTools();
    expect(Object.keys(byName)).toEqual([
      'knowledge_browse',
      'knowledge_search',
      'knowledge_read',
      'knowledge_compile',
      'knowledge_candidate_create',
    ]);
    expect(byName.knowledge_write).toBeUndefined();
    expect(byName.knowledge_promote).toBeUndefined();
  });

  it('browses spaces and cards through KnowledgeQueryService', async () => {
    const { byName, query } = createTools();
    const spacesResult = await byName.knowledge_browse.execute('c1', {});
    expect(spacesResult.isError).toBeFalsy();
    expect(spacesResult.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('user') });
    const cardsResult = await byName.knowledge_browse.execute('c2', { spaceId: 'user' });
    expect(query.listCards).toHaveBeenCalledWith('user');
    expect(cardsResult.details).toMatchObject({ spaceId: 'user', count: 1 });
  });

  it('searches and compiles sourced packs from markdown-first lanes', async () => {
    const { byName } = createTools();
    const search = await byName.knowledge_search.execute('c3', { query: 'sample' });
    expect(String(search.content[0] && 'text' in search.content[0] ? search.content[0].text : '')).toContain('1 hits');
    const compiled = await byName.knowledge_compile.execute('c4', { query: 'sample' });
    expect(compiled.details).toMatchObject({ packId: expect.stringMatching(/^pack:/), count: 1 });
    expect(compiled.details).not.toHaveProperty('semanticClaimed');
  });

  it('reads one card by space and path', async () => {
    const { byName, query } = createTools();
    const result = await byName.knowledge_read.execute('c5', { spaceId: 'user', relativePath: 'facts/sample.md' });
    expect(query.getCard).toHaveBeenCalledWith('user', 'facts/sample.md');
    expect(result.details).toMatchObject({ cardId: 'user:facts/sample.md' });
  });

  it('creates a session candidate only after explicit intent and never as verified/promoted', async () => {
    const candidates = createDisposableCandidateService(mkdtempSync(path.join(tmpdir(), 'rdc-knowledge-tools-')));
    const writeSpy = vi.fn();
    const { byName } = createTools(candidates);
    const denied = await byName.knowledge_candidate_create.execute('c6', {
      title: 'New fact',
      type: 'fact',
      body: 'Body',
      explicitUserIntent: false,
    });
    expect(denied.isError).toBe(true);
    expect(await candidates.listCandidates('session-tools')).toHaveLength(0);

    const created = await byName.knowledge_candidate_create.execute(
      'c7',
      { title: 'New fact', type: 'fact', body: 'Body', explicitUserIntent: true },
      undefined,
      undefined,
      { workspaceRoot: '.', projectRootPath: null, projectId: null, sessionId: 'session-tools' },
    );
    expect(created.isError).toBeFalsy();
    expect(created.details).toMatchObject({
      lifecycle: 'candidate',
      persisted: false,
      verified: false,
      promoted: false,
    });
    const stored = await candidates.listCandidates('session-tools');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.card.lifecycle).toBe('candidate');
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
