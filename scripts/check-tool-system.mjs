import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function walkSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') continue;
      walkSourceFiles(full, out);
      continue;
    }
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const {
    BUILTIN_AGENT_TOOL_IDS,
    BUILTIN_AGENT_TOOL_TIERS,
    CANONICAL_TOOL_TOKEN_EXPANSIONS,
    REJECTED_TOOL_TOKENS,
  } = require('../src/shared/constants/agentToolTokens.ts');
  const { AGENT_WORKBENCH_TOOL_CATALOG } = require('../src/shared/constants/agentWorkbenchCatalog.ts');
  const { WORK_PROCESS_TOOL_DISPLAY_CATALOG } = require('../src/renderer/features/transcript/workProcessToolCatalog.ts');

  assert(
    BUILTIN_AGENT_TOOL_IDS.length === 57,
    `BUILTIN_AGENT_TOOL_IDS.length must be 57, got ${BUILTIN_AGENT_TOOL_IDS.length}`,
  );

  const builtinSet = new Set(BUILTIN_AGENT_TOOL_IDS);
  const workbenchIds = AGENT_WORKBENCH_TOOL_CATALOG.map((tool) => tool.id);
  const workbenchSet = new Set(workbenchIds);
  assert(workbenchSet.size === workbenchIds.length, 'AGENT_WORKBENCH_TOOL_CATALOG has duplicate ids');
  assert(
    builtinSet.size === workbenchSet.size
      && [...builtinSet].every((id) => workbenchSet.has(id))
      && [...workbenchSet].every((id) => builtinSet.has(id)),
    `AGENT_WORKBENCH_TOOL_CATALOG ids must equal BUILTIN_AGENT_TOOL_IDS. missing=${[...builtinSet].filter((id) => !workbenchSet.has(id)).join(',')} extra=${[...workbenchSet].filter((id) => !builtinSet.has(id)).join(',')}`,
  );

  for (const id of BUILTIN_AGENT_TOOL_IDS) {
    assert(
      WORK_PROCESS_TOOL_DISPLAY_CATALOG[id],
      `WORK_PROCESS_TOOL_DISPLAY_CATALOG must cover ${id}`,
    );
  }

  const scanRoots = [
    path.join(repoRoot, 'src'),
    path.join(repoRoot, 'scripts'),
  ];
  const registrationResidues = [];
  for (const root of scanRoots) {
    for (const file of walkSourceFiles(root)) {
      const relative = path.relative(repoRoot, file).replace(/\\/g, '/');
      if (relative === 'src/shared/constants/agentToolTokens.ts') continue;
      const source = fs.readFileSync(file, 'utf8');
      if (
        /name:\s*['"]search_codebase['"]/.test(source)
        || /['"]search_codebase['"]\s*:\s*\{/.test(source)
        || /register(?:Tool|ed)?\([^)]*search_codebase/.test(source)
        || /tools?\.push\([^)]*search_codebase/.test(source)
      ) {
        registrationResidues.push(relative);
      }
    }
  }
  assert(
    registrationResidues.length === 0,
    `search_codebase tool registration residue found in: ${registrationResidues.join(', ')}`,
  );

  const agentManifestService = fs.readFileSync(
    path.join(repoRoot, 'src/main/settings/AgentManifestService.ts'),
    'utf8',
  );
  assert(!agentManifestService.includes('createSeedDefinition'), 'AgentManifestService must not write user seeds');
  const generalManifest = fs.readFileSync(path.join(repoRoot, 'resources/agent-runtime/agents/general.agent.md'), 'utf8');
  assert(generalManifest.includes('task'), 'General builtin must include task');
  assert(!generalManifest.includes('todo'), 'General builtin must not include todo');
  assert(!generalManifest.includes('search_codebase'), 'General builtin must not include search_codebase');
  assert(/\n  - knowledge\n/.test(generalManifest), 'General builtin must grant canonical knowledge token');
  assert(
    !/\bknowledge_(?:browse|search|read|compile|candidate_create)\b/.test(generalManifest),
    'General builtin must expose Knowledge via token expansion, not individual knowledge_* ids',
  );

  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS.task)
      && CANONICAL_TOOL_TOKEN_EXPANSIONS.task.includes('task_stop'),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.task must include task_stop',
  );
  assert(REJECTED_TOOL_TOKENS.todo, 'REJECTED_TOOL_TOKENS must include todo');
  assert(REJECTED_TOOL_TOKENS.search_codebase, 'REJECTED_TOOL_TOKENS must include search_codebase');
  assert(REJECTED_TOOL_TOKENS.bash, 'REJECTED_TOOL_TOKENS must include bash');
  assert(BUILTIN_AGENT_TOOL_IDS.includes('shell'), 'BUILTIN_AGENT_TOOL_IDS must include shell');
  assert(!BUILTIN_AGENT_TOOL_IDS.includes('bash'), 'BUILTIN_AGENT_TOOL_IDS must not include bash');

  // Core/extended tool tiering contracts.
  for (const id of BUILTIN_AGENT_TOOL_IDS) {
    assert(
      BUILTIN_AGENT_TOOL_TIERS[id] === 'core' || BUILTIN_AGENT_TOOL_TIERS[id] === 'extended',
      `BUILTIN_AGENT_TOOL_TIERS must classify ${id} as core or extended`,
    );
  }
  assert(
    Object.keys(BUILTIN_AGENT_TOOL_TIERS).length === BUILTIN_AGENT_TOOL_IDS.length,
    'BUILTIN_AGENT_TOOL_TIERS must not contain unknown tool ids',
  );
  assert(BUILTIN_AGENT_TOOL_TIERS.tool_search === 'core', 'tool_search must stay core (discovery entry)');
  assert(BUILTIN_AGENT_TOOL_TIERS.skills === 'core', 'skills must stay core (Progressive Skill discovery)');
  assert(BUILTIN_AGENT_TOOL_TIERS.skill_read === 'core', 'skill_read must stay core (Progressive Skill load)');
  assert(BUILTIN_AGENT_TOOL_TIERS.read_file === 'core', 'read_file must stay core');
  assert(BUILTIN_AGENT_TOOL_TIERS.artifact_read === 'core', 'artifact_read must stay core');
  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS.read)
      && CANONICAL_TOOL_TOKEN_EXPANSIONS.read.includes('artifact_read')
      && CANONICAL_TOOL_TOKEN_EXPANSIONS.read.includes('read_file')
      && CANONICAL_TOOL_TOKEN_EXPANSIONS.read.includes('read_image'),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.read must include read_file, read_image, artifact_read',
  );
  for (const orphan of ['delete_file', 'move_file', 'copy_file', 'notebook_edit', 'memory_write', 'memory_delete']) {
    assert(
      BUILTIN_AGENT_TOOL_TIERS[orphan] === 'extended',
      `${orphan} must be extended (discovered via tool_search)`,
    );
  }
  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS['file-manage'])
      && ['delete_file', 'move_file', 'copy_file', 'notebook_edit']
        .every((id) => CANONICAL_TOOL_TOKEN_EXPANSIONS['file-manage'].includes(id)),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.file-manage must cover delete/move/copy/notebook_edit',
  );
  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS['memory-write'])
      && ['memory_write', 'memory_delete']
        .every((id) => CANONICAL_TOOL_TOKEN_EXPANSIONS['memory-write'].includes(id)),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.memory-write must cover memory_write/memory_delete',
  );
  const knowledgeTools = [
    'knowledge_browse',
    'knowledge_search',
    'knowledge_read',
    'knowledge_compile',
    'knowledge_candidate_create',
  ];
  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS.knowledge)
      && knowledgeTools.every((id) => CANONICAL_TOOL_TOKEN_EXPANSIONS.knowledge.includes(id)),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.knowledge must expand to the five Knowledge tools',
  );
  for (const id of knowledgeTools) {
    assert(BUILTIN_AGENT_TOOL_IDS.includes(id), `BUILTIN_AGENT_TOOL_IDS must include ${id}`);
    assert(BUILTIN_AGENT_TOOL_TIERS[id] === 'extended', `${id} must be extended/deferred`);
  }
  const investigationTools = ['investigation_read', 'investigation_write', 'investigation_list'];
  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS.investigation)
      && investigationTools.every((id) => CANONICAL_TOOL_TOKEN_EXPANSIONS.investigation.includes(id)),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.investigation must expand to the Investigation tools',
  );
  for (const id of investigationTools) {
    assert(BUILTIN_AGENT_TOOL_IDS.includes(id), `BUILTIN_AGENT_TOOL_IDS must include ${id}`);
    assert(BUILTIN_AGENT_TOOL_TIERS[id] === 'extended', `${id} must be extended/deferred`);
  }
  assert(
    !['knowledge_write', 'knowledge_promote', 'knowledge_update', 'knowledge_deprecate']
      .some((id) => BUILTIN_AGENT_TOOL_IDS.includes(id)),
    'persistent Knowledge write tools must not be registered as agent tools',
  );

  // Context Window Phase 2：MCP deferred loading 计量 id 与前缀规则。
  const sessionTypes = fs.readFileSync(
    path.join(repoRoot, 'src/shared/types/session.ts'),
    'utf8',
  );
  assert(
    /ContextUsageBreakdownId\s*=[\s\S]*?'mcp_tools_deferred'/.test(sessionTypes),
    'ContextUsageBreakdownId must include mcp_tools_deferred',
  );
  assert(
    /ContextUsageBreakdownId\s*=[\s\S]*?'builtin_tools_deferred'/.test(sessionTypes),
    'ContextUsageBreakdownId must include builtin_tools_deferred',
  );

  const deferredTools = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/deferredTools.ts'),
    'utf8',
  );
  assert(
    /export const MCP_TOOL_NAME_PREFIX\s*=\s*['"]mcp__['"]/.test(deferredTools),
    'deferredTools MCP_TOOL_NAME_PREFIX must be mcp__',
  );
  const mcpManager = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/agent/MCPManager.ts'),
    'utf8',
  );
  assert(
    /return toolName\.startsWith\(['"]mcp__['"]\)/.test(mcpManager)
      || /startsWith\(['"]mcp__['"]\)/.test(mcpManager),
    'MCPManager isMCPTool must use mcp__ prefix',
  );
  assert(
    deferredTools.includes("startsWith(MCP_TOOL_NAME_PREFIX)")
      || /startsWith\(['"]mcp__['"]\)/.test(deferredTools),
    'deferredTools isMcpPrefixedToolName must match MCPManager mcp__ prefix',
  );
  assert(
    deferredTools.includes('getBuiltinToolTier')
      && deferredTools.includes("=== 'extended'"),
    'deferredTools must defer extended builtin tools via BUILTIN_AGENT_TOOL_TIERS',
  );
  assert(
    !fs.existsSync(path.join(repoRoot, 'src/main/workflow/debugger/mcpDeferredTools.ts')),
    'legacy mcpDeferredTools.ts must not exist (converged into deferredTools.ts)',
  );

  const orchestrator = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/AgentOrchestrator.ts'),
    'utf8',
  );
  const turnPreparationService = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/TurnPreparationService.ts'),
    'utf8',
  );
  const runtimeToolAssembly = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/RuntimeToolAssembly.ts'),
    'utf8',
  );
  const toolExecutorFactory = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/ToolExecutorFactory.ts'),
    'utf8',
  );
  const runtimePolicy = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/DebuggerRuntimePolicy.ts'),
    'utf8',
  );
  assert(
    orchestrator.includes('new RuntimeToolAssembly'),
    'AgentOrchestrator must own the RuntimeToolAssembly collaboration boundary',
  );
  assert(
    turnPreparationService.includes('partitionDeferredTools'),
    'TurnPreparationService must partition deferred tools before PromptPlan construction',
  );
  assert(
    turnPreparationService.includes('mcp_tools_deferred'),
    'TurnPreparationService breakdown must emit mcp_tools_deferred',
  );
  assert(
    turnPreparationService.includes('builtin_tools_deferred'),
    'TurnPreparationService breakdown must emit builtin_tools_deferred',
  );
  // tool_search must only discover the allowlist/runtime-policy filtered tool set.
  assert(
    /createToolSearchTool\(\(\)\s*=>\s*\n?\s*Array\.from\(availableTools\.values\(\)\)\.filter/.test(runtimeToolAssembly),
    'RuntimeToolAssembly tool_search closure must filter available tools by allowlist and runtime policy',
  );
  // Skill ∩ is frozen on prepareTurn (`skillIntersection`); executor consumes the
  // frozen set and must not re-narrow from skill_read mid-turn.
  assert(
    turnPreparationService.includes('resolveSkillIntersection')
      && turnPreparationService.includes('skillIntersection'),
    'TurnPreparationService must freeze ∩(skill_i) ∩ runtimeAllowlist as skillIntersection',
  );
  assert(
    runtimePolicy.includes('export function intersectSkillAllowedTools'),
    'DebuggerRuntimePolicy must export intersectSkillAllowedTools for prepareTurn',
  );
  assert(
    toolExecutorFactory.includes('plan?.skillIntersection')
      && toolExecutorFactory.includes('skill_read does not re-narrow mid-turn'),
    'ToolExecutorFactory must consume frozen skillIntersection and not re-narrow mid-turn',
  );

  // Primitive tool convergence contracts.
  const shared = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/tools/primitives/_shared.ts'),
    'utf8',
  );
  assert(shared.includes('function truncateOutput'), 'primitives/_shared must export truncateOutput');
  assert(shared.includes('sliceUtf8Bytes'), 'truncateOutput must use byte-accurate UTF-8 slicing');
  assert(shared.includes('assertTextReadable'), 'primitives/_shared must expose assertTextReadable');
  assert(shared.includes('realpathSync') || shared.includes('realpath'), 'safeResolvePath must realpath targets');

  const readFileTool = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/tools/primitives/ReadFileTool.ts'),
    'utf8',
  );
  assert(readFileTool.includes('assertTextReadable'), 'read_file must gate binary/.rdc via assertTextReadable');
  assert(!readFileTool.includes('session-artifacts'), 'read_file must not gain a session-artifacts allow path');

  const webTools = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/tools/primitives/WebTools.ts'),
    'utf8',
  );
  assert(!/redirect:\s*['"]follow['"]/.test(webTools), 'WebTools must not use redirect: follow');
  assert(webTools.includes("redirect: 'manual'") || webTools.includes('redirect: "manual"'), 'WebTools must use manual redirects');

  const contextManager = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/agent/ContextManager.ts'),
    'utf8',
  );
  assert(
    !contextManager.includes('ToolResultSummarizer') && contextManager.includes('CONTEXT_CANNOT_FIT'),
    'ContextManager must preserve original evidence and reject an unsafe window instead of truncating tool results',
  );

  const permissionPolicy = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/permissions/AgentPermissionPolicy.ts'),
    'utf8',
  );
  assert(
    /READ_ONLY_FILE_TOOLS\s*=\s*new Set\(\['read_file', 'read_image', 'glob', 'grep'\]\)/.test(permissionPolicy),
    'artifact_read must not join READ_ONLY_FILE_TOOLS / attachments auto-auth',
  );
  assert(
    permissionPolicy.includes('matchShellHardDeny'),
    'AgentPermissionPolicy must hard-deny catastrophic shell via matchShellHardDeny',
  );

  const shellTool = fs.readFileSync(
    path.join(repoRoot, 'src/main/agent-runtime/tools/primitives/ShellTool.ts'),
    'utf8',
  );
  assert(
    !shellTool.includes('run_in_background'),
    'shell must not declare a disabled run_in_background parameter',
  );
  assert(
    shellTool.includes("name: 'shell'"),
    'builtin command tool id must be shell',
  );
  assert(
    shellTool.includes("spawn('agent-shell'") || shellTool.includes('spawn(\'agent-shell\''),
    'shell must spawn under the agent-shell process owner',
  );
  assert(
    shellTool.includes('get description()'),
    'shell description must be a dynamic getter',
  );

  console.log('[tool-system] OK');
}

try {
  main();
} catch (error) {
  console.error('[tool-system] FAILED');
  console.error(error);
  process.exitCode = 1;
}
