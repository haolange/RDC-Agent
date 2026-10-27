import { beforeEach, expect, it, vi } from 'vitest';
import { TurnPreparationService } from './TurnPreparationService';

const mock = vi.hoisted(() => ({ load: vi.fn(), acquire: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP, getAppPath: () => process.cwd() } }));
vi.mock('../../settings/SettingsService', () => ({ settingsService: { getAll: () => ({ tooling: { rdcCli: {} }, agentRuntime: { context: {} } }) } }));
vi.mock('../../settings/AgentRuntimeConfigService', () => ({ agentRuntimeConfigService: { loadSkill: mock.load } }));
vi.mock('../../agent-runtime/permissions/PolicyCompiler', () => ({ compileEffectivePolicy: () => ({ maxTurns: 10, maxChildDepth: 1, contextCompactionPercent: 100, deniedTools: [] }) }));
vi.mock('../../sessions/RdcRuntimeContextRegistry', () => ({ assertRdcContextLeaseOwnership: () => null }));
vi.mock('../../sessions/handoffSkills', () => ({ approvedExecutionOfferForAgent: () => null }));
vi.mock('../../tools/withRdcHostRuntimeEnv', () => ({ withRdcHostRuntimeEnv: (value: unknown) => value }));
vi.mock('../../tools/RdcTurnBindings', () => ({ freezeRdcTurnBinding: () => ({}) }));
vi.mock('../../agent-runtime/prompt/ExecutionLimitFacts', () => ({ applyExecutionLimitFacts: (plan: unknown) => plan }));

beforeEach(() => { vi.clearAllMocks(); mock.load.mockReturnValue({ id: 'document-method', sourceHash: 'a'.repeat(64), allowedTools: [] }); mock.acquire.mockRejectedValue(new Error('PREPARATION_VALIDATED_BEFORE_MCP')); });
function prepare(segments: unknown[]) {
  const service = new TurnPreparationService({ mcp: { acquireConnections: mock.acquire } } as never);
  return service.prepareTurnContext({ requestId: 'request', turnId: 'turn', agentId: 'general', sessionId: null, projectId: null,
    projectRootPath: null, visibleTurnIds: [], requestPlan: { effectiveModelId: 'text-model', route: { protocol: 'OpenAIResponses' } }, effectiveProfile: { id: 'general', skills: ['document-method'], mcpServers: [] },
    promptPlan: { segments }, toolAllowlist: ['read_file'], subagentDepth: 0 } as never);
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
