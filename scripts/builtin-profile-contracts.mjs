import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const { parseAgentMarkdownStrict } = require('../src/main/settings/agent-manifests/agentManifestParse.ts');
const { diagnoseManifestToolTokens } = require('../src/shared/constants/agentToolTokens.ts');

export const BUILTIN_AGENT_IDS = ['general', 'debugger', 'analyzer', 'optimizer',
  'generator', 'verifier', 'knowledge-scout', 'report-writer', 'shader-analyst', 'pass-analyst', 'resource-analyst', 'pixel-analyst'];
const INTERNAL_PROFILE_SKILLS = {
  generator: ['renderdoc-investigation', 'artifact-provenance'],
  verifier: ['skeptic-review', 'artifact-provenance'],
  'knowledge-scout': ['knowledge-scout'],
  'report-writer': ['report-composition', 'artifact-provenance'],
  'shader-analyst': ['shader-ir-analysis'],
  'pass-analyst': ['pass-graph-analysis'],
  'resource-analyst': ['resource-versioning', 'cross-capture-alignment'],
  'pixel-analyst': ['pixel-forensics'],
};
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
      assert(false, `${label} handoffs[${index}].showContinueOn was removed; declare surface.`);
    }
    if (handoff.surface !== undefined) {
      assert(['turn-end', 'plan-gate', 'hidden'].includes(handoff.surface), `${label} handoffs[${index}].surface is invalid.`);
    }
    if (handoff.requiredToolIds !== undefined) {
      assert(Array.isArray(handoff.requiredToolIds), `${label} handoffs[${index}].requiredToolIds must be an array.`);
      assert(handoff.requiredToolIds.every((id) => typeof id === 'string' && id.trim()), `${label} handoffs[${index}].requiredToolIds must be non-empty strings.`);
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

  if (Object.hasOwn(INTERNAL_PROFILE_SKILLS, id)) {
    assert(definition.userInvocable === false, `${id} must be an internal Agent`);
    assert(definition.accessCeiling === 'read-only', `${id} must have a read-only ceiling`);
    assertIncludesAll(skills, INTERNAL_PROFILE_SKILLS[id], `${id} skills`);
    assertIncludesNone(tools, ['shell', 'rdc_probe', 'subagent'], `${id} tools`);
    assert(handoffs.length === 0 && agents.length === 0, `${id} must not delegate or hand off`);
    return;
  }

  if (id === 'general') {
    assert(definition.name === 'General', 'general name must be General');
    assertIncludesAll(tools, GENERAL_REQUIRED_TOOLS, 'General tools');
    assert(skills.includes('execution-orchestrator'), 'General must arm execution-orchestrator');
    assert(definition.maxTurns === undefined, 'General must not impose a default max-turns ceiling');
    assertIncludesAll(agents, ['debugger', 'analyzer', 'optimizer'], 'General agents');
    assert(handoffs.length === 0, 'General handoffs must be empty');
    assert(definition.accessCeiling === undefined, 'General omits access-ceiling and therefore keeps the full ceiling');
    assert(definition.completionContract === undefined, 'General omits completion-contract and therefore keeps final-answer');
    return;
  }

  assert(definition.name === MISSION_NAMES[id], `${id} name must be ${MISSION_NAMES[id]}`);
  assertIncludesAll(tools, MISSION_REQUIRED_TOOLS, `${id} tools`);
  assertIncludesNone(tools, MISSION_FORBIDDEN_TOOLS, `${id} tools`);
  assert(skills.includes(MISSION_SKILL[id]), `${id} must arm ${MISSION_SKILL[id]}`);
  assert(agents.includes('general'), `${id} agents must include general`);
  const execute = handoffs.find((entry) => entry.agent === 'general' && entry.label === 'Implement Plan');
  assert(execute, `${id} must declare Implement Plan`);
  assert(execute.labelTranslations?.['zh-CN'] === '执行计划', `${id} must declare its Chinese execution label`);
  assert(execute.send === true, `${id} Implement Plan must send`);
  assert(execute.surface === 'plan-gate', `${id} Implement Plan must be offered only at the plan gate`);
  assert(definition.accessCeiling === 'read-only', `${id} access-ceiling must be read-only`);
  assert(definition.completionContract === 'investigation-report', `${id} completion-contract must be investigation-report`);
  assert(Array.isArray(execute.requiredSkillIds) && execute.requiredSkillIds.length > 0, `${id} Implement Plan must declare requiredSkillIds`);
  assert(Array.isArray(execute.requiredToolIds) && execute.requiredToolIds.includes('investigation_write'), `${id} Implement Plan must preactivate investigation writes`);
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
    if (skillId !== 'execution-orchestrator') {
      assert(extractFrontmatterScalar(source, 'investigation-mission') === skillId.replace('-coordinator', ''), `${skillId} must declare its investigation-mission`);
    }
  }
}
