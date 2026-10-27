import { beforeEach, expect, it, vi } from 'vitest';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { PlanTaskRequirement } from '@shared/types/taskExecution';
import { assertDeclaredHandoffSkillCompatibility, assertDirectTaskSkillPreparation } from './handoffSkillCompatibility';

const mock = vi.hoisted(() => ({ load: vi.fn(), policy: vi.fn() }));
vi.mock('../settings/AgentRuntimeConfigService', () => ({ agentRuntimeConfigService: { loadSkill: mock.load } }));
vi.mock('../agent-runtime/permissions/PolicyCompiler', () => ({ compileEffectivePolicy: mock.policy }));
vi.mock('./handoffSkills', () => ({ approvedExecutionOfferForAgent: () => null }));
vi.mock('./sessionPlanArtifact', () => ({ planArtifactWriter: {} }));

const target = { id: 'general', skills: ['execution-method'], tools: ['artifact_read', 'task', 'subagent'] } as AgentManifestDefinition;
const task = (mode: 'direct' | 'subagent', methods: string[]): PlanTaskRequirement => ({
  taskId: mode, revision: 1, subject: 'Compare document revisions', description: 'Use the frozen comparison method before interpreting results.',
  blockedBy: [], completionRequirements: ['comparison'], executionRequirements: { mode, requiredSkillIds: methods, independentOfTaskIds: [] },
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.load.mockImplementation((id: string) => ({ id, sourceHash: 'a'.repeat(64), instructions: 'Compare both documents.', allowedTools: [] }));
  mock.policy.mockReturnValue({ deniedTools: [] });
});
it('accepts explicit preparation without collecting child methods or modifying declarations', () => {
  const requiredSkillIds = ['comparison-method'];
  const tasks = [task('direct', ['comparison-method']), task('subagent', ['independent-review'])];
  assertDeclaredHandoffSkillCompatibility({ target, requiredSkillIds, tasks, projectRoot: null });
  expect(requiredSkillIds).toEqual(['comparison-method']);
  expect(mock.load.mock.calls.map(call => call[0])).toEqual(['execution-method', 'comparison-method']);
});
it('does not require preloading ordinary guidance and does not load it during preflight', () => {
  const guidance = { ...task('direct', []), description: 'Discover and read terminology-guide before writing the comparison.' };
  assertDeclaredHandoffSkillCompatibility({ target, requiredSkillIds: [], tasks: [guidance], projectRoot: null });
  expect(mock.load.mock.calls.map(call => call[0])).toEqual(['execution-method']);
});
it('reports exact missing methods without silently preparing them', () => {
  expect(() => assertDirectTaskSkillPreparation([task('direct', ['comparison-method'])], ['execution-method'])).toThrow(/direct.*comparison-method/);
  expect(() => assertDeclaredHandoffSkillCompatibility({ target, requiredSkillIds: [], tasks: [task('direct', ['comparison-method'])], projectRoot: null })).toThrow('No methods were added');
  expect(mock.load).not.toHaveBeenCalled();
});
it('rejects unavailable methods and tool intersection or policy conflicts', () => {
  const input = { target, requiredSkillIds: ['comparison-method'], tasks: [task('direct', ['comparison-method'])], projectRoot: null };
  mock.load.mockReturnValue(null);
  expect(() => assertDeclaredHandoffSkillCompatibility(input)).toThrow('SKILL_UNAVAILABLE');
  mock.load.mockReturnValue({ allowedTools: ['read_file'] });
  expect(() => assertDeclaredHandoffSkillCompatibility(input)).toThrow('artifact_read');
  mock.load.mockReturnValue({ allowedTools: [] });
  mock.policy.mockReturnValue({ deniedTools: ['task_update'] });
  expect(() => assertDeclaredHandoffSkillCompatibility(input)).toThrow('task_update');
});
