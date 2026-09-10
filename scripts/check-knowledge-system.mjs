#!/usr/bin/env node
import {
  defaultRepoRoot,
  isDirectInvocation,
  printCheckResult,
  runSystemDebtCheck,
} from './system-debt-ratchet.mjs';

const KNOWLEDGE_TOOLS = [
  'knowledge_browse',
  'knowledge_search',
  'knowledge_read',
  'knowledge_compile',
  'knowledge_candidate_create',
];

const KNOWLEDGE_SERVICES = [
  ['Query', 'KnowledgeQueryService'],
  ['Index', 'KnowledgeIndexService'],
  ['Compile', 'KnowledgeCompileService'],
  ['Candidate', 'KnowledgeCandidateService'],
  ['Write', 'KnowledgeWriteService'],
];

const BUILTIN_PROFILES = ['general', 'debugger', 'analyzer', 'optimizer'];

export const KNOWLEDGE_CONTRACT_CASES = [
  { title: 'knowledge.contract.tools.registered-permission-deferred', minAssertions: 1 },
  { title: 'knowledge.contract.write.human-only-candidate-fullaccess', minAssertions: 1 },
  { title: 'knowledge.contract.colddata.sanitized-import', minAssertions: 1 },
  { title: 'knowledge.contract.durable.store-single-source', minAssertions: 1 },
  { title: 'knowledge.contract.tools.skill-intersection-caller', minAssertions: 1 },
  { title: 'knowledge.contract.write.fixed-not-verified', minAssertions: 1 },
];

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
export const KNOWLEDGE_CONTRACT_CASE_IDS = KNOWLEDGE_CONTRACT_CASES.map((entry) => entry.title);

export const KNOWLEDGE_RULE_REGISTRY = [
  {
    id: 'knowledge.missing.token.five-tools',
    kind: 'missing',
    file: 'src/shared/constants/agentToolTokens.ts',
    pattern: "knowledge:\\s*\\[[^\\]]*knowledge_browse[\\s\\S]*knowledge_search[\\s\\S]*knowledge_read[\\s\\S]*knowledge_compile[\\s\\S]*knowledge_candidate_create",
    probe: 'source-pattern',
    note: 'canonical knowledge token must expand to the five Knowledge tools',
  },
  {
    id: 'knowledge.missing.builtin.five-ids',
    kind: 'missing',
    file: 'src/shared/constants/agentToolTokens.ts',
    pattern: KNOWLEDGE_TOOLS.map((id) => `'${id}'`).join('[\\s\\S]*'),
    probe: 'source-pattern',
    note: 'BUILTIN_AGENT_TOOL_IDS must include the five Knowledge tools',
  },
  {
    id: 'knowledge.missing.tiers.extended',
    kind: 'missing',
    file: 'src/shared/constants/agentToolTokens.ts',
    pattern: KNOWLEDGE_TOOLS.map((id) => `${id}:\\s*'extended'`).join('[\\s\\S]*'),
    probe: 'source-pattern',
    note: 'Knowledge tools belong on the extended builtin tier',
  },
  {
    id: 'knowledge.missing.workbench.catalog',
    kind: 'missing',
    file: 'src/shared/constants/agentWorkbenchCatalog.ts',
    pattern: KNOWLEDGE_TOOLS.map((id) => `id:\\s*'${id}'`).join('[\\s\\S]*'),
    probe: 'source-pattern',
    note: 'AGENT_WORKBENCH_TOOL_CATALOG must declare the five Knowledge tools',
  },
  ...KNOWLEDGE_SERVICES.map(([lane, className]) => ({
    id: `knowledge.missing.service.${lane.toLowerCase()}`,
    kind: 'missing',
    file: `src/main/knowledge/${className}.ts`,
    pattern: `export class ${className}`,
    probe: 'source-pattern',
    note: `five-service ${lane} implementation ${className}`,
  })),
  {
    id: 'knowledge.missing.lanes.six',
    kind: 'missing',
    file: 'src/main/knowledge',
    pattern: "Identity/Path[\\s\\S]*Scope/Metadata[\\s\\S]*Lexical[\\s\\S]*Structural',[\\s\\n]*'Relation/Graph[\\s\\S]*Temporal/Version",
    probe: 'walk-pattern',
    note: 'six markdown-first retrieval lanes must exist under src/main/knowledge',
  },
  {
    id: 'knowledge.missing.read-roots-contract',
    kind: 'missing',
    file: 'src/main/agent-runtime/knowledgeReadRoots.ts',
    pattern: "KNOWLEDGE_READ_FILE_TOOLS[\\s\\S]*read_file[\\s\\S]*read_image[\\s\\S]*glob[\\s\\S]*grep[\\s\\S]*resolveKnowledgeReadRoots",
    probe: 'source-pattern',
    note: 'canonical knowledge read roots freeze user + project knowledge directories for the four read-only file tools',
  },
  ...BUILTIN_PROFILES.map((profile) => ({
    id: `knowledge.missing.profile.ceiling.${profile}`,
    kind: 'missing',
    file: `resources/agent-runtime/agents/${profile}.agent.md`,
    pattern: 'tools contains canonical token knowledge, or the complete five-tool expansion',
    probe: 'profile-knowledge-ceiling',
    note: `four builtin profiles must grant canonical token knowledge (${profile}); a single knowledge_* cannot clear this debt`,
  })),
  {
    id: 'knowledge.missing.durable.store-class',
    kind: 'missing',
    file: 'src/main/knowledge/KnowledgeDurableStore.ts',
    pattern: 'export class KnowledgeDurableStore',
    probe: 'source-pattern',
    note: 'Draft/Candidate/review must persist through KnowledgeDurableStore',
  },
  {
    id: 'knowledge.missing.durable.state-file',
    kind: 'missing',
    file: 'src/main/knowledge/knowledgeStateSchema.ts',
    pattern: "KNOWLEDGE_STATE_FILE = 'knowledge-state.json'",
    probe: 'source-pattern',
    note: 'durable session fact file is <sessionPath>/knowledge-state.json',
  },
  {
    id: 'knowledge.missing.candidate.durable-store',
    kind: 'missing',
    file: 'src/main/knowledge/KnowledgeCandidateService.ts',
    pattern: 'KnowledgeDurableStore[\\s\\S]*knowledgeDurableStore[\\s\\S]*this\\.store',
    probe: 'source-pattern',
    note: 'Candidate/Draft/review service must read and write KnowledgeDurableStore',
  },
  {
    id: 'knowledge.missing.colddata.draft-only',
    kind: 'missing',
    file: 'src/main/knowledge/KnowledgeCandidateService.ts',
    pattern: 'never creates a Candidate[\\s\\S]*persistDraftResult[\\s\\S]*putDraft',
    probe: 'source-pattern',
    note: 'ColdData ingest must persist session Draft only',
  },
  {
    id: 'knowledge.missing.write.fixed-not-verified',
    kind: 'missing',
    file: 'src/main/knowledge/KnowledgeWriteService.ts',
    pattern: "sourceStatus === 'fixed'[\\s\\S]*fixed is not verified",
    probe: 'source-pattern',
    note: 'sourceStatus=fixed must not become verified',
  },
  {
    id: 'knowledge.missing.ipc.five-services',
    kind: 'missing',
    file: 'src/main/ipc/knowledgeHandlers.ts',
    pattern: 'knowledgeCandidateService[\\s\\S]*knowledgeCompileService[\\s\\S]*knowledgeIndexService[\\s\\S]*knowledgeQueryService[\\s\\S]*knowledgeWriteService',
    probe: 'source-pattern',
    note: 'Knowledge Center IPC must map to the five services, not a browse-only resolver',
  },
  {
    id: 'knowledge.missing.tools.deferred-singletons',
    kind: 'missing',
    file: 'src/main/knowledge/KnowledgeTools.ts',
    pattern: 'knowledgeQueryService[\\s\\S]*knowledgeCompileService[\\s\\S]*knowledgeCandidateService[\\s\\S]*context\\?\\.sessionId',
    probe: 'source-pattern',
    note: 'deferred Knowledge tools must use the five-service singletons and the real caller session',
  },
  {
    id: 'knowledge.missing.skill.scout-readonly',
    kind: 'missing',
    file: 'resources/agent-runtime/skills/knowledge-scout/SKILL.md',
    pattern: 'allowed-tools:\\s*\\[subagent_report,\\s*turn_complete,\\s*artifact_read,\\s*knowledge_browse,\\s*knowledge_search,\\s*knowledge_read,\\s*knowledge_compile\\]',
    probe: 'source-pattern',
    note: '$knowledge-scout may report meaningful child progress and declare four read Knowledge tools, scoped artifact reads, and structured completion',
  },
  {
    id: 'knowledge.missing.skill.candidate-intent',
    kind: 'missing',
    file: 'resources/agent-runtime/skills/knowledge-candidate/SKILL.md',
    pattern: 'allowed-tools:\\s*\\[knowledge_candidate_create\\]',
    probe: 'source-pattern',
    note: '$knowledge-candidate may only declare knowledge_candidate_create',
  },
  {
    id: 'knowledge.missing.contract.suite',
    kind: 'missing',
    file: 'src/main/testing/knowledgeSystemContract.test.ts',
    pattern: KNOWLEDGE_CONTRACT_CASE_IDS.join('|'),
    probe: 'contract-suite',
    note: 'executable Knowledge contract suite: durable store, deferred tools, skill intersection, human-only write, ColdData, six lanes, fixed≠verified',
    requiredCases: KNOWLEDGE_CONTRACT_CASES,
    minTests: KNOWLEDGE_CONTRACT_CASES.length,
    minAssertions: KNOWLEDGE_CONTRACT_CASES.length,
  },
  {
    id: 'knowledge.forbidden.browse.service',
    kind: 'forbidden',
    file: 'src/main/runtime/KnowledgeBrowseService.ts',
    pattern: 'export class KnowledgeBrowseService',
    probe: 'source-pattern',
    note: 'browse-only KnowledgeBrowseService resurrection is forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.ipc',
    kind: 'forbidden',
    file: 'src/main/ipc/knowledgeHandlers.ts',
    pattern: 'knowledgeBrowseService',
    probe: 'source-pattern',
    note: 'browse-only IPC handlers are forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.channels',
    kind: 'forbidden',
    file: 'src/shared/renderer-api/channels.ts',
    pattern: "knowledge:listSpaces",
    probe: 'source-pattern',
    note: 'browse-only renderer channels are forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.dto',
    kind: 'forbidden',
    file: 'src/shared/types/knowledge.ts',
    pattern: 'Knowledge Center browse contract',
    probe: 'source-pattern',
    note: 'browse-only Knowledge DTO contract is forbidden',
  },
  {
    id: 'knowledge.forbidden.browse.ui-doc',
    kind: 'forbidden',
    file: 'docs/ui/knowledge-center.md',
    pattern: 'KnowledgeBrowseService',
    probe: 'source-pattern',
    note: 'UI doc must not describe browse-only Knowledge Center',
  },
  {
    id: 'knowledge.forbidden.browse.coverage-exclusion',
    kind: 'forbidden',
    file: 'vitest.config.ts',
    pattern: "src/main/runtime/KnowledgeBrowseService.ts",
    probe: 'source-pattern',
    note: 'coverage exclusion for browse-only service is forbidden',
  },
  {
    id: 'knowledge.forbidden.candidate.in-memory-map',
    kind: 'forbidden',
    file: 'src/main/knowledge',
    pattern: '(?:this\\.)?(candidates|drafts|reviews)\\s*=\\s*new\\s+Map',
    probe: 'walk-pattern',
    note: 'Candidate/Draft/review must not use a process-local Map as the official store',
  },
  {
    id: 'knowledge.forbidden.colddata.auto-candidate',
    kind: 'forbidden',
    file: 'src/main/knowledge/KnowledgeCandidateService.ts',
    pattern: 'persistDraftResult[\\s\\S]*putCandidate',
    probe: 'source-pattern',
    note: 'ColdData persistDraftResult must not create a Candidate',
  },
  {
    id: 'knowledge.forbidden.skill.scout-write',
    kind: 'forbidden',
    file: 'resources/agent-runtime/skills/knowledge-scout/SKILL.md',
    pattern: 'knowledge_candidate_create|knowledge_write|knowledge_promote',
    probe: 'source-pattern',
    note: '$knowledge-scout must not declare write, promote, or candidate tools',
  },
  {
    id: 'knowledge.forbidden.skill.full-library-inject',
    kind: 'forbidden',
    file: 'resources/agent-runtime/skills',
    pattern: 'knowledge-state\\.json|~/?\\.rdx/knowledge[\\s\\S]{0,80}inject',
    probe: 'walk-pattern',
    note: 'Knowledge skills must not inject the durable store or full library into the prompt',
  },
  {
    id: 'knowledge.forbidden.embedding-runtime',
    kind: 'forbidden',
    file: 'src',
    roots: ['src', 'scripts'],
    includeTests: true,
    pattern: EMBEDDING_RUNTIME_FORBIDDEN,
    probe: 'walk-path-and-content',
    unlessPattern: "NON_AGENT_MODALITIES[\\s\\S]{0,120}'embedding'[\\s\\S]{0,40}'embeddings'|\\*embedding\\*|semanticHash|semanticContext|Semantic Token|图形学 Semantics|provider deprecated",
    note: 'Embedding capability and Semantic lane runtime must be absent from source, tests, scripts, file paths, and export lists',
  },
];

export function runKnowledgeSystemCheck(overrides = {}) {
  return runSystemDebtCheck({
    name: 'knowledge-system',
    repoRoot: overrides.repoRoot || defaultRepoRoot(),
    registry: KNOWLEDGE_RULE_REGISTRY,
    debtRelativePath: 'scripts/fidelity/knowledge-system-debt.json',
    argv: overrides.argv || process.argv.slice(2),
    env: overrides.env || process.env,
    ...overrides,
  });
}

if (isDirectInvocation(import.meta.url)) {
  const result = runKnowledgeSystemCheck();
  process.exit(printCheckResult('knowledge-system', result));
}
