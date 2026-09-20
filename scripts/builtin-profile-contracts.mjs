import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { parseAgentMarkdownStrict } = require('../src/main/settings/agentManifestParse.ts');
const { diagnoseManifestToolTokens } = require('../src/shared/constants/agentToolTokens.ts');

export const BUILTIN_AGENT_IDS = ['general', 'debugger', 'analyzer', 'optimizer'];
export const MISSION_AGENT_IDS = ['debugger', 'analyzer', 'optimizer'];
export const ROOT_SKILL_IDS = [
  'execution-orchestrator',
  'debugger-coordinator',
  'analyzer-coordinator',
  'optimizer-coordinator',
];

const MISSION_SKILL = {
  debugger: 'debugger-coordinator',
  analyzer: 'analyzer-coordinator',
  optimizer: 'optimizer-coordinator',
};

const MISSION_NAMES = {
  debugger: 'Debugger',
  analyzer: 'Analyzer',
  optimizer: 'Optimizer',
};

const FORBIDDEN_TOOL_TOKENS = ['todo', 'bash', 'search_codebase', 'handoff', 'agent', 'agent_handoff'];
const MISSION_FORBIDDEN_TOOLS = [
  'write', 'edit', 'git', 'file-manage',
  'shell', 'interpreter', 'code_interpreter', 'output', 'output_register',
];
const GENERAL_REQUIRED_TOOLS = [
  'read', 'search', 'web', 'shell', 'write', 'edit', 'git', 'file-manage',
  'task', 'output', 'subagent', 'tool_search', 'knowledge', 'investigation',
];
const MISSION_REQUIRED_TOOLS = [
  'read', 'search', 'web', 'askUser', 'task', 'planArtifact',
  'tool_search', 'knowledge', 'investigation', 'rdc_probe',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function extractFrontmatterScalar(source, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(source);
  assert(match, `manifest must declare ${key}`);
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function extractSkillAllowedTools(source) {
  const match = /^allowed-tools:\s*\n([\s\S]*?)(?:\n[a-z][\w-]*:|\n---)/m.exec(source);
  if (!match) return [];
  return Array.from(match[1].matchAll(/-\s+([\w-]+)/g), (entry) => entry[1]);
}

function assertIncludesAll(values, required, label) {
  for (const value of required) {
    assert(values.includes(value), `${label} must include ${value}.`);
  }
}

function assertIncludesNone(values, forbidden, label) {
  for (const value of forbidden) {
    assert(!values.includes(value), `${label} must not include ${value}.`);
  }
}

export function assertParsedHandoffs(handoffs, label) {
  assert(Array.isArray(handoffs), `${label} handoffs must be an array.`);
  for (const [index, handoff] of handoffs.entries()) {
    assert(handoff && typeof handoff === 'object', `${label} handoffs[${index}] must be an object.`);
    assert(typeof handoff.label === 'string' && handoff.label.trim(), `${label} handoffs[${index}].label must be non-empty.`);
    assert(typeof handoff.agent === 'string' && handoff.agent.trim(), `${label} handoffs[${index}].agent must be non-empty.`);
    assert(typeof handoff.prompt === 'string' && handoff.prompt.trim(), `${label} handoffs[${index}].prompt must be non-empty.`);
    if (handoff.send !== undefined) {
      assert(typeof handoff.send === 'boolean', `${label} handoffs[${index}].send must be a boolean.`);
    }
    if (handoff.showContinueOn !== undefined) {
      assert(typeof handoff.showContinueOn === 'boolean', `${label} handoffs[${index}].showContinueOn must be a boolean.`);
    }
    if (handoff.model !== undefined) {
      assert(typeof handoff.model === 'string' && handoff.model.trim(), `${label} handoffs[${index}].model must be a non-empty string.`);
    }
    if (handoff.requiredSkillIds !== undefined) {
      assert(Array.isArray(handoff.requiredSkillIds), `${label} handoffs[${index}].requiredSkillIds must be an array.`);
      assert(handoff.requiredSkillIds.every((id) => typeof id === 'string' && id.trim()), `${label} handoffs[${index}].requiredSkillIds must be non-empty strings.`);
    }
  }
}

export function assertParsedProfileContracts(id, definition) {
  const tools = definition.tools ?? [];
  const skills = definition.skills ?? [];
  const agents = definition.agents ?? [];
  const handoffs = definition.handoffs ?? [];
  const tokenDiagnostics = diagnoseManifestToolTokens(tools);
  assert(tokenDiagnostics.length === 0, `${id} tools failed diagnoseManifestToolTokens: ${tokenDiagnostics.map((entry) => `${entry.token}: ${entry.message}`).join('; ')}`);
  assert(definition.target === 'rdc-agent', `${id} target must be rdc-agent`);
  assertIncludesNone(tools, FORBIDDEN_TOOL_TOKENS, `${id} tools`);
  assertParsedHandoffs(handoffs, id);

  if (id === 'general') {
    assert(definition.name === 'General', 'general name must be General');
    assertIncludesAll(tools, GENERAL_REQUIRED_TOOLS, 'General tools');
    assert(skills.includes('execution-orchestrator'), 'General must arm execution-orchestrator');
    assertIncludesAll(agents, MISSION_AGENT_IDS, 'General agents');
    assert(handoffs.length === 0, 'General handoffs must be empty');
    return;
  }

  assert(definition.name === MISSION_NAMES[id], `${id} name must be ${MISSION_NAMES[id]}`);
  assertIncludesAll(tools, MISSION_REQUIRED_TOOLS, `${id} tools`);
  assertIncludesNone(tools, MISSION_FORBIDDEN_TOOLS, `${id} tools`);
  assert(skills.includes(MISSION_SKILL[id]), `${id} must arm ${MISSION_SKILL[id]}`);
  assert(agents.includes('general'), `${id} agents must include general`);
  const execute = handoffs.find((entry) => entry.agent === 'general' && entry.label === 'Execute with General');
  assert(execute, `${id} must declare Execute with General`);
  assert(execute.send === true, `${id} Execute with General must send`);
  assert(execute.showContinueOn !== false, `${id} Execute with General must show continue`);
  assert(Array.isArray(execute.requiredSkillIds) && execute.requiredSkillIds.length > 0, `${id} Execute with General must declare requiredSkillIds`);
}

export function assertManifestSourceContracts(id, source, filePath) {
  const parsed = parseAgentMarkdownStrict(source, filePath, id, 't', true);
  assert(parsed.ok, `${id} failed strict manifest parse: ${parsed.reason}`);
  assertParsedProfileContracts(id, parsed.definition);
}

export function assertBuiltinProfileContracts(repoRoot) {
  const agentsDir = path.join(repoRoot, 'resources', 'agent-runtime', 'agents');
  const skillsDir = path.join(repoRoot, 'resources', 'agent-runtime', 'skills');

  for (const id of BUILTIN_AGENT_IDS) {
    const filePath = path.join(agentsDir, `${id}.agent.md`);
    assert(fs.existsSync(filePath), `missing builtin agent ${id}`);
    const source = fs.readFileSync(filePath, 'utf8');
    assertManifestSourceContracts(id, source, filePath);
  }

  for (const skillId of ROOT_SKILL_IDS) {
    const filePath = path.join(skillsDir, skillId, 'SKILL.md');
    assert(fs.existsSync(filePath), `missing root skill ${skillId}`);
    const source = fs.readFileSync(filePath, 'utf8');
    const name = extractFrontmatterScalar(source, 'name');
    assert(name === skillId, `${skillId} name must equal its directory id`);
    assertIncludesNone(extractSkillAllowedTools(source), FORBIDDEN_TOOL_TOKENS, `${skillId} allowed-tools`);
  }
}
