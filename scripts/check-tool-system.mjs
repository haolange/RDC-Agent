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
    CANONICAL_TOOL_TOKEN_EXPANSIONS,
    REJECTED_TOOL_TOKENS,
  } = require('../src/shared/constants/agentToolTokens.ts');
  const { AGENT_WORKBENCH_TOOL_CATALOG } = require('../src/shared/constants/agentWorkbenchCatalog.ts');
  const { WORK_PROCESS_TOOL_DISPLAY_CATALOG } = require('../src/renderer/features/debugger/AgentChat/workProcessToolCatalog.ts');

  assert(
    BUILTIN_AGENT_TOOL_IDS.length === 36,
    `BUILTIN_AGENT_TOOL_IDS.length must be 36, got ${BUILTIN_AGENT_TOOL_IDS.length}`,
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
      if (relative.startsWith('docs/handover/')) continue;
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
  const seedDefinition = /const createSeedDefinition[\s\S]*?\n\};/m.exec(agentManifestService)?.[0];
  assert(seedDefinition, 'AgentManifestService must keep createSeedDefinition');
  assert(seedDefinition.includes("'task'"), 'AgentManifestService seed must include task');
  assert(!seedDefinition.includes("'todo'"), 'AgentManifestService seed must not include todo');
  assert(!seedDefinition.includes("'search_codebase'"), 'AgentManifestService seed must not include search_codebase');

  assert(
    Array.isArray(CANONICAL_TOOL_TOKEN_EXPANSIONS.task)
      && CANONICAL_TOOL_TOKEN_EXPANSIONS.task.includes('task_stop'),
    'CANONICAL_TOOL_TOKEN_EXPANSIONS.task must include task_stop',
  );
  assert(REJECTED_TOOL_TOKENS.todo, 'REJECTED_TOOL_TOKENS must include todo');
  assert(REJECTED_TOOL_TOKENS.search_codebase, 'REJECTED_TOOL_TOKENS must include search_codebase');

  // Context Window Phase 2：MCP deferred loading 计量 id 与前缀规则。
  const sessionTypes = fs.readFileSync(
    path.join(repoRoot, 'src/shared/types/session.ts'),
    'utf8',
  );
  assert(
    /ContextUsageBreakdownId\s*=[\s\S]*?'mcp_tools_deferred'/.test(sessionTypes),
    'ContextUsageBreakdownId must include mcp_tools_deferred',
  );

  const mcpDeferredTools = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/mcpDeferredTools.ts'),
    'utf8',
  );
  assert(
    /export const MCP_TOOL_NAME_PREFIX\s*=\s*['"]mcp__['"]/.test(mcpDeferredTools),
    'mcpDeferredTools MCP_TOOL_NAME_PREFIX must be mcp__',
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
    mcpDeferredTools.includes("startsWith(MCP_TOOL_NAME_PREFIX)")
      || /startsWith\(['"]mcp__['"]\)/.test(mcpDeferredTools),
    'mcpDeferredTools isMcpPrefixedToolName must match MCPManager mcp__ prefix',
  );

  const orchestrator = fs.readFileSync(
    path.join(repoRoot, 'src/main/workflow/debugger/AgentOrchestrator.ts'),
    'utf8',
  );
  assert(
    orchestrator.includes('partitionDeferredMcpTools'),
    'AgentOrchestrator must use partitionDeferredMcpTools for MCP deferred loading',
  );
  assert(
    orchestrator.includes('mcp_tools_deferred'),
    'AgentOrchestrator breakdown must emit mcp_tools_deferred',
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
