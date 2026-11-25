#!/usr/bin/env node
import { defaultRepoRoot, isDirectInvocation, printForbiddenCheck, runForbiddenCheck } from './lib/forbiddenSourceRules.mjs';

const EMBEDDING_RUNTIME_FORBIDDEN = [
  ['Embedd', 'ingExecutionService'].join(''),
  ['Embedd', 'ingCatalog'].join(''),
  ['llm', '.embedd', 'ing'].join(''),
  ['Semantic', 'LaneStatus'].join(''),
  ['rebuild', 'SemanticIndex'].join(''),
  ['getEmbedd', 'ingCatalog'].join(''),
  ['semantic', 'Chunker'].join(''),
  ['require', 'SemanticReady'].join(''),
].join('|');

const FORBIDDEN_RULES = [
  {
    id: 'knowledge.forbidden.browse.service',
    file: 'src/main/runtime/KnowledgeBrowseService.ts',
    pattern: 'export class KnowledgeBrowseService',
    probe: 'source-pattern',
    note: 'browse-only KnowledgeBrowseService resurrection is forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.ipc',
    file: 'src/main/ipc/knowledgeHandlers.ts',
    pattern: 'knowledgeBrowseService',
    probe: 'source-pattern',
    note: 'browse-only IPC handlers are forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.channels',
    file: 'src/shared/renderer-api/channels.ts',
    pattern: "knowledge:listSpaces",
    probe: 'source-pattern',
    note: 'browse-only renderer channels are forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.dto',
    file: 'src/shared/types/knowledge.ts',
    pattern: 'Knowledge Center browse contract',
    probe: 'source-pattern',
    note: 'browse-only Knowledge DTO contract is forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.ui-doc',
    file: 'docs/ui/knowledge-center.md',
    pattern: 'KnowledgeBrowseService',
    probe: 'source-pattern',
    note: 'UI doc must not describe browse-only Knowledge Center',
  },
  {
    id: 'knowledge.forbidden.browse.coverage-exclusion',
    file: 'vitest.config.ts',
    pattern: "src/main/runtime/KnowledgeBrowseService.ts",
    probe: 'source-pattern',
    note: 'coverage exclusion for browse-only service is forbidden',
  },
  {
    id: 'knowledge.forbidden.candidate.in-memory-map',
    file: 'src/main/knowledge',
    pattern: '(?:this\\.)?(candidates|drafts|reviews)\\s*=\\s*new\\s+Map',
    probe: 'walk-pattern',
    note: 'Candidate/review must not use a process-local Map as the official store',
  },
  {
    id: 'knowledge.forbidden.import.auto-candidate',
    file: 'src/main/knowledge/KnowledgeImportService.ts',
    pattern: 'putCandidate|createCandidate',
    probe: 'source-pattern',
    note: 'knowledge import must not create a Candidate',
  },
  {
    id: 'knowledge.forbidden.import.session-inbox',
    file: 'src/main/knowledge/KnowledgeCandidateService.ts',
    pattern: 'ingestToStaging|ingestPathToStaging|persistDraftResult|putDraft|listStagedDrafts',
    probe: 'source-pattern',
    note: 'session inbox ingest helpers are forbidden',
  },
  {
    id: 'knowledge.forbidden.skill.scout-write',
    file: 'resources/agent-runtime/skills/knowledge-scout/SKILL.md',
    pattern: 'knowledge_candidate_create|knowledge_write|knowledge_promote',
    probe: 'source-pattern',
    note: '$knowledge-scout must not declare write, promote, or candidate tools',
  },
  {
    id: 'knowledge.forbidden.skill.full-library-inject',
    file: 'resources/agent-runtime/skills',
    pattern: 'knowledge-state\\.json|~/?\\.rdc-agent/knowledge[\\s\\S]{0,80}inject',
    probe: 'walk-pattern',
    note: 'Knowledge skills must not inject the durable store or full library into the prompt',
  },
  {
    id: 'knowledge.forbidden.embedding-runtime',
    file: 'src',
    roots: ['src', 'scripts'],
    includeTests: true,
    pattern: EMBEDDING_RUNTIME_FORBIDDEN,
    probe: 'walk-path-and-content',
    unlessPattern: "NON_AGENT_MODALITIES[\\s\\S]{0,120}'embedding'[\\s\\S]{0,40}'embeddings'|\\*embedding\\*|semanticContext|Semantic Token|图形学 Semantics",
    note: 'Embedding capability and Semantic lane runtime must be absent from source, tests, scripts, file paths, and export lists',
  },
];

export function runKnowledgeSystemCheck(overrides = {}) {
  return runForbiddenCheck({ name: 'knowledge-system', repoRoot: overrides.repoRoot || defaultRepoRoot(), rules: FORBIDDEN_RULES });
}

if (isDirectInvocation(import.meta.url)) {
  process.exit(printForbiddenCheck(runKnowledgeSystemCheck()));
}
