import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AGENT_TOOL_IDS,
  BUILTIN_AGENT_TOOL_TIERS,
  CANONICAL_TOOL_TOKEN_EXPANSIONS,
} from '@shared/constants/agentToolTokens';
import { AGENT_WORKBENCH_TOOL_CATALOG } from '@shared/constants/agentWorkbenchCatalog';
import { createKnowledgeTools } from '../knowledge/KnowledgeTools';
import type { SemanticLaneStatus } from '@shared/types/embedding';
import type { KnowledgeCardRecord, KnowledgeSpace } from '@shared/types/knowledge';
import { StorageIo } from '../sessions/StorageIo';
import { KnowledgeCandidateService } from '../knowledge/KnowledgeCandidateService';
import { KnowledgeCompileService } from '../knowledge/KnowledgeCompileService';
import { KnowledgeIndexService } from '../knowledge/KnowledgeIndexService';
import { KnowledgeQueryService } from '../knowledge/KnowledgeQueryService';
import { KnowledgeWriteService } from '../knowledge/KnowledgeWriteService';
import { KnowledgeHumanConfirmationRequiredError, KnowledgeSemanticLaneClosedError } from '../knowledge/knowledgeErrors';
import { readFile } from 'node:fs/promises';

const FIVE_DEFERRED = [
  'knowledge_browse',
  'knowledge_search',
  'knowledge_read',
  'knowledge_compile',
  'knowledge_candidate_create',
] as const;

const FORBIDDEN_WRITE = [
  'knowledge_write',
  'knowledge_promote',
  'knowledge_update',
  'knowledge_deprecate',
] as const;

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../knowledge/__fixtures__/colddata/hair-adreno-sanitized.yaml',
);

function space(rootPath: string): KnowledgeSpace {
  return { spaceId: 'user', kind: 'user', label: 'User', rootPath };
}

function createStorage(): StorageIo {
  const files = new Map<string, unknown>();
  return {
    ensureDir: () => undefined,
    readJson: (filePath: string) => (files.has(filePath) ? files.get(filePath) : null),
    writeJsonAtomic: (filePath: string, data: unknown) => {
      files.set(filePath, data);
    },
  } as unknown as StorageIo;
}

function status(availability: SemanticLaneStatus['availability'], reason: SemanticLaneStatus['reason']): SemanticLaneStatus {
  return {
    availability,
    reason,
    selectedIdentity: availability === 'unavailable' ? null : 'openai:text-embedding-3-small',
    selectedDimensions: 1536,
    snapshot: null,
  };
}

function draftCard(): KnowledgeCardRecord {
  return {
    cardId: 'user:facts/sample.md',
    spaceId: 'user',
    relativePath: 'facts/sample.md',
    type: 'fact',
    lifecycle: 'draft',
    title: 'Sample fact',
    scope: { api: 'Vulkan' },
    relations: [],
    body: 'A fact.',
  };
}

describe('knowledge system contract', () => {
  it('knowledge.contract.tools.registered-permission-deferred', () => {
    expect.hasAssertions();
    const builtin = BUILTIN_AGENT_TOOL_IDS as readonly string[];
    expect(CANONICAL_TOOL_TOKEN_EXPANSIONS.knowledge).toEqual([...FIVE_DEFERRED]);
    const workbenchIds = new Set(AGENT_WORKBENCH_TOOL_CATALOG.map((tool) => tool.id));
    const tools = createKnowledgeTools('session-contract');
    expect(tools.map((tool) => tool.name)).toEqual([...FIVE_DEFERRED]);
    for (const id of FIVE_DEFERRED) {
      expect(builtin.includes(id)).toBe(true);
      expect(BUILTIN_AGENT_TOOL_TIERS[id as keyof typeof BUILTIN_AGENT_TOOL_TIERS]).toBe('extended');
      expect(workbenchIds.has(id)).toBe(true);
      const tool = tools.find((entry) => entry.name === id);
      expect(tool?.spec?.isReadOnly).toBe(id !== 'knowledge_candidate_create');
      expect(tool?.permissionHint === 'readonly' || tool?.permissionHint === 'session_mutation').toBe(true);
    }
    for (const id of FORBIDDEN_WRITE) {
      expect(builtin.includes(id)).toBe(false);
      expect(tools.some((tool) => tool.name === id)).toBe(false);
    }
  });

  it('knowledge.contract.lanes.semantic-unavailable-stale', async () => {
    expect.hasAssertions();
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-know-sem-'));
    mkdirSync(path.join(root, 'facts'), { recursive: true });
    writeFileSync(path.join(root, 'facts', 'sample.md'), '---\ntype: "fact"\nlifecycle: "draft"\ntitle: "Sample"\n---\n\nBody.\n', 'utf8');
    const index = new KnowledgeIndexService({
      listSpaces: () => [space(root)],
      snapshotPath: () => path.join(root, 'index.json'),
      storage: createStorage(),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const unavailable = new KnowledgeQueryService({
      listSpaces: () => [space(root)],
      resolveSemanticLaneStatus: () => status('unavailable', 'consent-denied'),
      index,
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const stale = new KnowledgeQueryService({
      listSpaces: () => [space(root)],
      resolveSemanticLaneStatus: () => status('stale', 'identity-mismatch'),
      index,
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const closed = await unavailable.query({ text: 'sample', lanes: ['Lexical', 'Semantic'] });
    expect(closed.semantic?.availability).toBe('unavailable');
    expect(closed.lanes.find((lane) => lane.lane === 'Semantic')?.hits).toEqual([]);
    expect(closed.hits.length).toBeGreaterThan(0);
    expect(() => unavailable.requireSemanticReady()).toThrow(KnowledgeSemanticLaneClosedError);
    const staleResult = await stale.query({ lanes: ['Semantic'] });
    expect(staleResult.semantic?.availability).toBe('stale');
    expect(new KnowledgeCompileService().compile(staleResult).semanticClaimed).toBe(false);
  });

  it('knowledge.contract.write.human-only-candidate-fullaccess', async () => {
    expect.hasAssertions();
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-know-write-'));
    const write = new KnowledgeWriteService({
      listSpaces: () => [space(root)],
      writeFile: async (filePath, contents) => {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, contents, 'utf8');
      },
      mkdir: async (dirPath) => {
        mkdirSync(dirPath, { recursive: true });
      },
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    await expect(write.write({
      spaceId: 'user',
      card: draftCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: false } as never,
    })).rejects.toBeInstanceOf(KnowledgeHumanConfirmationRequiredError);
    const saved = await write.write({
      spaceId: 'user',
      card: draftCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    });
    expect(saved.lifecycle).toBe('draft');
    const candidates = new KnowledgeCandidateService();
    expect(candidates.listCandidates('session-1')).toHaveLength(0);
  });

  it('knowledge.contract.colddata.sanitized-import', () => {
    expect.hasAssertions();
    const yaml = readFileSync(fixturePath, 'utf8');
    const candidates = new KnowledgeCandidateService();
    const result = candidates.ingestColdDataToStaging(yaml, {
      sessionId: 'session-cold',
      availableAssetNames: ['symptom-compare-a1b2c3d4.png'],
    });
    expect(result.status).toBe('draft');
    expect(result.candidateCreated).toBe(false);
    expect(result.lifecycle).toBe('draft');
    expect(result.verified).toBe(false);
    expect(result.sourceStatus).toBe('fixed');
    expect(result.record?.lifecycle).toBe('draft');
    expect(yaml).not.toMatch(/[A-Za-z]:\\/);
    expect(candidates.listCandidates('session-cold')).toHaveLength(0);
    expect(candidates.listStagedDrafts('session-cold')).toHaveLength(1);
  });
});
