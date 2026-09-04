import { existsSync, readFileSync } from 'node:fs';
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
import type { KnowledgeCardRecord, KnowledgeSpace } from '@shared/types/knowledge';
import { createKnowledgeTools } from '../knowledge/KnowledgeTools';
import { createDisposableCandidateService } from '../knowledge/KnowledgeCandidateService';
import { sourceStatusImpliesVerified } from '../knowledge/knowledgeCardSchema';
import { KNOWLEDGE_STATE_FILE } from '../knowledge/knowledgeStateSchema';
import { KnowledgeWriteService } from '../knowledge/KnowledgeWriteService';
import {
  KnowledgeHumanConfirmationRequiredError,
  KnowledgeLifecycleError,
} from '../knowledge/knowledgeErrors';
import {
  combineActiveSkillAllowlists,
  intersectSkillAllowedTools,
} from '../workflow/debugger/DebuggerRuntimePolicy';
import { isDeferredToolName, partitionDeferredTools } from '../workflow/debugger/deferredTools';

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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../knowledge/__fixtures__/colddata/hair-adreno-sanitized.yaml',
);

function readRepo(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

function skillAllowedTools(skillId: string): string[] {
  const match = /allowed-tools:\s*\[([^\]]*)\]/.exec(
    readRepo(`resources/agent-runtime/skills/${skillId}/SKILL.md`),
  );
  return match?.[1]?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function space(rootPath: string): KnowledgeSpace {
  return { spaceId: 'user', kind: 'user', label: 'User', rootPath };
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
    const deferred = partitionDeferredTools(FIVE_DEFERRED.map((name) => ({ name })), new Set());
    expect(deferred.injected).toEqual([]);
    expect(deferred.deferredBuiltin.map((tool) => tool.name)).toEqual([...FIVE_DEFERRED]);
    for (const id of FIVE_DEFERRED) {
      expect(builtin.includes(id)).toBe(true);
      expect(BUILTIN_AGENT_TOOL_TIERS[id as keyof typeof BUILTIN_AGENT_TOOL_TIERS]).toBe('extended');
      expect(isDeferredToolName(id)).toBe(true);
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
    const candidates = createDisposableCandidateService(mkdtempSync(path.join(tmpdir(), 'rdc-know-cand-')));
    expect(await candidates.listCandidates('session-1')).toHaveLength(0);
  });

  it('knowledge.contract.colddata.sanitized-import', async () => {
    expect.hasAssertions();
    const yaml = readFileSync(fixturePath, 'utf8');
    const candidates = createDisposableCandidateService(mkdtempSync(path.join(tmpdir(), 'rdc-know-cold-')));
    const result = await candidates.ingestColdDataToStaging(yaml, {
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
    expect(await candidates.listCandidates('session-cold')).toHaveLength(0);
    expect(await candidates.listStagedDrafts('session-cold')).toHaveLength(1);
  });

  it('knowledge.contract.durable.store-single-source', async () => {
    expect.hasAssertions();
    expect(KNOWLEDGE_STATE_FILE).toBe('knowledge-state.json');
    const candidateSource = readRepo('src/main/knowledge/KnowledgeCandidateService.ts');
    expect(candidateSource).toMatch(/KnowledgeDurableStore/);
    expect(candidateSource).not.toMatch(/(?:this\.)?(candidates|drafts|reviews)\s*=\s*new\s+Map/);
    expect(readRepo('src/main/ipc/knowledgeHandlers.ts')).toMatch(/knowledgeCandidateService/);
    expect(readRepo('src/main/ipc/knowledgeHandlers.ts')).not.toMatch(/knowledgeBrowseService|knowledge:listSpaces/);
    expect(readRepo('src/shared/renderer-api/channels.ts')).not.toMatch(/knowledge:listSpaces/);
    expect(readRepo('src/renderer/features/knowledge/KnowledgeCenterModal/useKnowledgeImport.ts'))
      .toMatch(/window\.electronAPI\.knowledge\.candidates/);
    expect(readRepo('src/renderer/features/knowledge/KnowledgeCenterModal/useKnowledgeCenter.ts'))
      .toMatch(/window\.electronAPI\.knowledge\.(?:overview|query|card)/);
    expect(readRepo('src/main/knowledge/KnowledgeTools.ts')).toMatch(/knowledgeQueryService[\s\S]*knowledgeCandidateService/);

    const root = mkdtempSync(path.join(tmpdir(), 'rdc-know-durable-'));
    const sessionId = 'session-durable';
    const first = createDisposableCandidateService(root);
    await first.createCandidate({
      sessionId,
      card: draftCard(),
      explicitUserIntent: true,
    });
    const yaml = readFileSync(fixturePath, 'utf8');
    await first.ingestColdDataToStaging(yaml, { sessionId });
    const second = createDisposableCandidateService(root);
    expect(await second.listCandidates(sessionId)).toHaveLength(1);
    expect(await second.listStagedDrafts(sessionId)).toHaveLength(1);
    expect(await second.listCandidates(sessionId)).toEqual(await first.listCandidates(sessionId));
    expect(existsSync(path.join(root, sessionId, KNOWLEDGE_STATE_FILE))).toBe(true);
  });

  it('knowledge.contract.tools.skill-intersection-caller', async () => {
    expect.hasAssertions();
    const scoutTools = skillAllowedTools('knowledge-scout');
    const candidateTools = skillAllowedTools('knowledge-candidate');
    expect(scoutTools).toEqual([
      'knowledge_browse',
      'knowledge_search',
      'knowledge_read',
      'knowledge_compile',
    ]);
    expect(candidateTools).toEqual(['knowledge_candidate_create']);
    expect(readRepo('resources/agent-runtime/skills/knowledge-scout/SKILL.md')).not.toMatch(/knowledge_write|knowledge_promote/);
    expect(readRepo('resources/agent-runtime/skills/knowledge-candidate/SKILL.md')).not.toMatch(/knowledge_write|knowledge_promote/);
    expect(readRepo('src/main/agent-runtime/capabilities/SkillCatalogBudget.ts')).toMatch(/短索引/);

    const runtime = [...FIVE_DEFERRED, 'skills', 'skill_read', 'ask_user', 'tool_search', 'read_file'];
    const scoutNarrow = intersectSkillAllowedTools(runtime, scoutTools);
    expect(scoutNarrow).toEqual(expect.arrayContaining([
      'knowledge_browse',
      'knowledge_search',
      'knowledge_read',
      'knowledge_compile',
    ]));
    expect(scoutNarrow).toEqual(expect.arrayContaining(['skills', 'skill_read', 'ask_user', 'tool_search']));
    expect(scoutNarrow).not.toContain('knowledge_candidate_create');
    expect(scoutNarrow).not.toContain('read_file');
    const candidateNarrow = intersectSkillAllowedTools(runtime, candidateTools);
    expect(candidateNarrow).toContain('knowledge_candidate_create');
    expect(candidateNarrow).not.toContain('knowledge_browse');
    const combined = combineActiveSkillAllowlists(runtime, [scoutTools, candidateTools]);
    expect(combined).not.toBeNull();
    expect(combined).not.toContain('knowledge_browse');
    expect(combined).not.toContain('knowledge_candidate_create');
    expect(combined).toEqual(expect.arrayContaining(['skills', 'skill_read', 'ask_user', 'tool_search']));

    const store = createDisposableCandidateService(mkdtempSync(path.join(tmpdir(), 'rdc-know-caller-')));
    const tools = createKnowledgeTools('constructor-session', { candidates: store });
    const create = tools.find((tool) => tool.name === 'knowledge_candidate_create');
    const created = await create?.execute(
      'caller',
      { title: 'Caller fact', type: 'fact', body: 'Body', explicitUserIntent: true },
      undefined,
      undefined,
      { workspaceRoot: '.', projectRootPath: null, projectId: null, sessionId: 'context-session' },
    );
    expect(created?.isError).toBeFalsy();
    expect(await store.listCandidates('constructor-session')).toHaveLength(0);
    expect(await store.listCandidates('context-session')).toHaveLength(1);
  });

  it('knowledge.contract.write.fixed-not-verified', async () => {
    expect.hasAssertions();
    expect(sourceStatusImpliesVerified('fixed')).toBe(false);
    expect(sourceStatusImpliesVerified('verified')).toBe(true);
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-know-fixed-'));
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
    const fixed = { ...draftCard(), sourceStatus: 'fixed' as const };
    const saved = await write.write({
      spaceId: 'user',
      card: fixed,
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    });
    expect(saved.lifecycle).toBe('draft');
    expect(saved.sourceStatus).toBe('fixed');
    await expect(write.write({
      spaceId: 'user',
      card: { ...fixed, lifecycle: 'verified' },
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeLifecycleError);
    await expect(write.promote({
      spaceId: 'user',
      card: { ...fixed, lifecycle: 'candidate' },
      to: 'verified',
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeLifecycleError);
  });
});
