import { beforeEach, expect, it, vi } from 'vitest';
import { TurnPreparationService } from './TurnPreparationService';

const mock = vi.hoisted(() => ({ load: vi.fn(), acquire: vi.fn(), deniedTools: [] as string[] }));
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP, getAppPath: () => process.cwd() } }));
vi.mock('../../settings/settings-core/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdcCli: {} }, agentRuntime: { context: {} } }) } }));
vi.mock('../../settings/agent-manifests/AgentRuntimeConfigService', () => ({ agentRuntimeConfigService: { loadSkill: mock.load } }));
vi.mock('../permissions/PolicyCompiler', () => ({ compileEffectivePolicy: () => ({ maxTurns: 10, maxChildDepth: 1, contextCompactionPercent: 100, deniedTools: mock.deniedTools }) }));
vi.mock('../../rdc/RdcRuntimeContextRegistry', () => ({ assertRdcContextLeaseOwnership: () => null }));
vi.mock('../../sessions/run/handoffSkills', () => ({ approvedExecutionOfferForAgent: () => null }));
vi.mock('../../rdc/withRdcHostRuntimeEnv', () => ({ withRdcHostRuntimeEnv: (value: unknown) => value }));
vi.mock('../../rdc/RdcTurnBindings', () => ({ freezeRdcTurnBinding: () => ({}) }));
vi.mock('../prompt/ExecutionLimitFacts', () => ({ applyExecutionLimitFacts: (plan: unknown) => plan }));

beforeEach(() => { vi.clearAllMocks(); mock.deniedTools = []; mock.load.mockReturnValue({ id: 'document-method', sourceHash: 'a'.repeat(64), allowedTools: [] }); mock.acquire.mockRejectedValue(new Error('PREPARATION_VALIDATED_BEFORE_MCP')); });
function prepare(segments: unknown[], overrides: Record<string, unknown> = {}) {
  const service = new TurnPreparationService({ mcp: { acquireConnections: mock.acquire } } as never);
  return service.prepareTurnContext({ requestId: 'request', turnId: 'turn', agentId: 'general', sessionId: null, projectId: null,
    projectRootPath: null, visibleTurnIds: [], requestPlan: { effectiveModelId: 'text-model', route: { protocol: 'OpenAIResponses' } }, effectiveProfile: { id: 'general', skills: ['document-method'], mcpServers: [] },
    promptPlan: { segments }, toolAllowlist: ['read_file'], subagentDepth: 0, ...overrides } as never);
}
it('rejects a source change between PromptPlan creation and final preparation before acquiring resources', async () => {
  await expect(prepare([{ kind: 'preloaded-skill', id: 'skill:document-method', sourceHash: 'b'.repeat(64) }])).rejects.toThrow('SKILL_SOURCE_CHANGED');
  expect(mock.acquire).not.toHaveBeenCalled();
});
it('rejects a declared method whose actual PromptPlan segment is missing', async () => {
  await expect(prepare([])).rejects.toThrow('SKILL_NOT_PRELOADED');
  expect(mock.acquire).not.toHaveBeenCalled();
});
it('rejects an unavailable method and admits a consistent source to the existing preparation path', async () => {
  mock.load.mockReturnValueOnce(null);
  await expect(prepare([])).rejects.toThrow('SKILL_UNAVAILABLE');
  expect(mock.acquire).not.toHaveBeenCalled();
  await expect(prepare([{ kind: 'preloaded-skill', id: 'skill:document-method', sourceHash: 'a'.repeat(64) }])).rejects.toThrow('PREPARATION_VALIDATED_BEFORE_MCP');
  expect(mock.acquire).toHaveBeenCalledOnce();
});

it('rejects delegated Skill intersections that make required source reads and structured completion impossible before acquiring resources', async () => {
  mock.load.mockImplementation((id: string) => ({ id, sourceHash: 'a'.repeat(64), allowedTools:
    id === 'document-method' ? ['artifact_read', 'turn_complete'] : ['read_file', 'shell'] }));
  const segments = ['document-method', 'other-method'].map(id => ({ kind: 'preloaded-skill', id: 'skill:' + id, sourceHash: 'a'.repeat(64) }));
  const capsule = { inputArtifactRefs: ['session://tool-outputs/source.json'], challengeRefs: [], acceptedFacts: [] };
  const overrides = { effectiveProfile: { id: 'general', skills: ['document-method', 'other-method'], mcpServers: [] },
    toolAllowlist: ['artifact_read', 'turn_complete', 'read_file', 'tool_search'], frozenDelegationCapsule: capsule };
  await expect(prepare(segments, overrides)).rejects.toThrow(/DELEGATION_PREPARATION_CONFLICT:.*turn_complete.*artifact_read/);
  expect(mock.acquire).not.toHaveBeenCalled();

  mock.load.mockImplementation((id: string) => ({ id, sourceHash: 'a'.repeat(64), allowedTools: ['artifact_read', 'turn_complete'] }));
  await expect(prepare(segments, overrides)).rejects.toThrow('PREPARATION_VALIDATED_BEFORE_MCP');
  expect(mock.acquire).toHaveBeenCalledOnce();

  mock.acquire.mockClear();
  mock.deniedTools = ['artifact_read'];
  await expect(prepare(segments, overrides)).rejects.toThrow(/DELEGATION_PREPARATION_CONFLICT:.*artifact_read/);
  expect(mock.acquire).not.toHaveBeenCalled();
});

it('accepts an Investigation-only source when the permitted typed reader is available', async () => {
  mock.load.mockReturnValue({ id: 'document-method', sourceHash: 'a'.repeat(64), allowedTools: ['investigation_read', 'turn_complete'] });
  const segments = [{ kind: 'preloaded-skill', id: 'skill:document-method', sourceHash: 'a'.repeat(64) }];
  await expect(prepare(segments, { toolAllowlist: ['investigation_read', 'turn_complete'], frozenDelegationCapsule: {
    inputArtifactRefs: ['session://investigation/evidence.json'], challengeRefs: [], acceptedFacts: [],
  } })).rejects.toThrow('PREPARATION_VALIDATED_BEFORE_MCP');
  expect(mock.acquire).toHaveBeenCalledOnce();
});

it('does not infer a mandatory read from an accepted-fact provenance reference', async () => {
  mock.load.mockReturnValue({ id: 'document-method', sourceHash: 'a'.repeat(64), allowedTools: ['turn_complete'] });
  const segments = [{ kind: 'preloaded-skill', id: 'skill:document-method', sourceHash: 'a'.repeat(64) }];
  await expect(prepare(segments, { toolAllowlist: ['turn_complete'], frozenDelegationCapsule: {
    inputArtifactRefs: [], challengeRefs: [], acceptedFacts: [{ sourceRefs: ['session://tool-outputs/source.json'] }],
  } })).rejects.toThrow('PREPARATION_VALIDATED_BEFORE_MCP');
  expect(mock.acquire).toHaveBeenCalledOnce();
});
