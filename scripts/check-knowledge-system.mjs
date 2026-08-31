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
  { title: 'knowledge.contract.lanes.semantic-unavailable-stale', minAssertions: 1 },
  { title: 'knowledge.contract.write.human-only-candidate-fullaccess', minAssertions: 1 },
  { title: 'knowledge.contract.colddata.sanitized-import', minAssertions: 1 },
];
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
    id: 'knowledge.missing.lanes.seven',
    kind: 'missing',
    file: 'src/main/knowledge',
    pattern: 'Identity/Path[\\s\\S]*Scope/Metadata[\\s\\S]*Lexical[\\s\\S]*Structural[\\s\\S]*Semantic[\\s\\S]*Relation/Graph[\\s\\S]*Temporal/Version',
    probe: 'walk-pattern',
    note: 'seven retrieval lanes must exist under src/main/knowledge',
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
    id: 'knowledge.missing.contract.suite',
    kind: 'missing',
    file: 'src/main/testing/knowledgeSystemContract.test.ts',
    pattern: KNOWLEDGE_CONTRACT_CASE_IDS.join('|'),
    probe: 'contract-suite',
    note: 'executable Knowledge contract suite: five tools, seven lanes, human-only write, ColdData import',
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
    note: 'browse-only KnowledgeBrowseService is current debt; delete when Query lands',
  },
  {
    id: 'knowledge.forbidden.browse.ipc',
    kind: 'forbidden',
    file: 'src/main/ipc/knowledgeHandlers.ts',
    pattern: 'knowledgeBrowseService',
    probe: 'source-pattern',
    note: 'browse-only IPC handlers are current debt',
  },
  {
    id: 'knowledge.forbidden.browse.channels',
    kind: 'forbidden',
    file: 'src/shared/renderer-api/channels.ts',
    pattern: "knowledge:listSpaces",
    probe: 'source-pattern',
    note: 'browse-only renderer channels are current debt',
  },
  {
    id: 'knowledge.forbidden.browse.dto',
    kind: 'forbidden',
    file: 'src/shared/types/knowledge.ts',
    pattern: 'Knowledge Center browse contract',
    probe: 'source-pattern',
    note: 'browse-only Knowledge DTO contract is current debt',
  },
  {
    id: 'knowledge.forbidden.browse.ui-doc',
    kind: 'forbidden',
    file: 'docs/ui/knowledge-center.md',
    pattern: 'KnowledgeBrowseService',
    probe: 'source-pattern',
    note: 'UI doc still describes browse-only Knowledge Center',
  },
  {
    id: 'knowledge.forbidden.browse.coverage-exclusion',
    kind: 'forbidden',
    file: 'vitest.config.ts',
    pattern: "src/main/runtime/KnowledgeBrowseService.ts",
    probe: 'source-pattern',
    note: 'coverage exclusion for browse-only service is current debt',
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
