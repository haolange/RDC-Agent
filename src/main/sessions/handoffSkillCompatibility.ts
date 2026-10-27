import { approvedExecutionOfferForAgent } from './handoffSkills';
import { combineActiveSkillAllowlists, isToolAllowedByFrozenAllowlist, resolveAgentToolAllowlistFromDefinition } from '../workflow/debugger/DebuggerRuntimePolicy';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import { parsePlanTaskRequirements, type PlanTaskRequirement } from '@shared/types/taskExecution';
import { agentRuntimeConfigService } from '../settings/AgentRuntimeConfigService';
import { compileEffectivePolicy } from '../agent-runtime/permissions/PolicyCompiler';
import { planArtifactWriter } from './sessionPlanArtifact';

/** Compare explicit contracts only. Never add methods or infer them from prose. */
export function assertDirectTaskSkillPreparation(tasks: readonly PlanTaskRequirement[], skillIds: readonly string[]): void {
  for (const task of tasks) {
    if (task.executionRequirements?.mode !== 'direct') continue;
    const missing = task.executionRequirements.requiredSkillIds.filter(id => !skillIds.includes(id));
    if (missing.length) throw new Error(`TASK_EXECUTION_REQUIREMENTS: Task ${task.taskId} requires preloaded methods missing from the target preparation: ${missing.join(', ')}. If these are reading guidance, revise the same Task through plan_artifact; otherwise explicitly prepare them through the declared handoff/profile. No methods were added.`);
  }
}

/** Preflight the existing target profile and declared handoff, not a future execution proof. */
export function assertDeclaredHandoffSkillCompatibility(input: {
  target: AgentManifestDefinition;
  requiredSkillIds: readonly string[];
  tasks: readonly PlanTaskRequirement[];
  projectRoot: string | null;
}): void {
  const ids = [...new Set([...input.target.skills, ...input.requiredSkillIds])];
  assertDirectTaskSkillPreparation(input.tasks, ids);
  const skills = ids.map(id => {
    const skill = agentRuntimeConfigService.loadSkill(id, input.projectRoot ?? undefined, input.target.id);
    if (!skill) throw new Error(`SKILL_UNAVAILABLE: ${id} is unavailable to ${input.target.id}; no execution was prepared.`);
    return skill;
  });
  const tools = resolveAgentToolAllowlistFromDefinition(input.target.id, input.target.tools);
  const intersection = combineActiveSkillAllowlists(tools, skills.map(skill => skill.allowedTools ?? []));
  const policy = compileEffectivePolicy(input.projectRoot);
  const requiredTools = ['artifact_read',
    ...(input.tasks.some(task => task.executionRequirements?.mode !== 'subagent') ? ['task_update'] : []),
    ...(input.tasks.some(task => task.executionRequirements?.mode === 'subagent') ? ['subagent'] : [])];
  for (const tool of requiredTools) {
    if (policy.deniedTools.includes(tool) || !isToolAllowedByFrozenAllowlist(tool, input.target.id, tools)
      || (intersection !== null && !isToolAllowedByFrozenAllowlist(tool, input.target.id, intersection))) {
      throw new Error(`EXECUTION_OFFER_SKILL_CONFLICT: ${input.target.id} cannot use ${tool} under the declared profile, methods and policy. Revise the explicit preparation or plan before approval.`);
    }
  }
}

export function assertExecutionOfferSkillCompatibility(input: {
  sessionId?: string | null;
  agentId: string;
  tools: readonly string[];
  intersection: readonly string[] | null;
  deniedTools: readonly string[];
  preloadedSkillIds: readonly string[];
}): void {
  const offer = approvedExecutionOfferForAgent(input.sessionId, input.agentId);
  if (!offer) return;
  const plan = planArtifactWriter.readMarkdown(input.sessionId!, offer.plan.uri, offer.plan.hash);
  assertDirectTaskSkillPreparation(parsePlanTaskRequirements(plan.markdown), input.preloadedSkillIds);
  const missing = offer.requiredSkillIds.filter(id => !input.preloadedSkillIds.includes(id));
  if (missing.length) throw new Error(`EXECUTION_OFFER_SKILL_CONFLICT: declared methods were not actually preloaded: ${missing.join(', ')}`);
  const tool = 'artifact_read';
  if (
    input.deniedTools.includes(tool)
    || !isToolAllowedByFrozenAllowlist(tool, input.agentId, input.tools)
    || (input.intersection !== null && !isToolAllowedByFrozenAllowlist(tool, input.agentId, input.intersection))
  ) {
    throw new Error('EXECUTION_OFFER_SKILL_CONFLICT: bound execution cannot read its plan under the prepared tool permissions.');
  }
}
