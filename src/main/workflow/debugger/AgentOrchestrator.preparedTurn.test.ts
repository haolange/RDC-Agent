import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { EffectiveAgentProfile } from '@shared/types/rdxRuntime';
import { createNoneReasoningContract } from '@shared/provider-catalog/providerContracts';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { pathIdentityKey } from '../../agent-runtime/knowledgeReadRoots';

const { knowledgeFixture } = vi.hoisted(() => ({
  knowledgeFixture: {
    userKnowledgePath: '',
    projectKnowledgePath: '',
  },
}));

vi.mock('../../runtime/AppPathService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtime/AppPathService')>();
  return {
    ...actual,
    appPathService: new Proxy(actual.appPathService, {
      get(target, prop, receiver) {
        if (prop === 'getUserRdxPaths') {
          return () => {
            const paths = target.getUserRdxPaths();
            return knowledgeFixture.userKnowledgePath
              ? { ...paths, knowledgePath: knowledgeFixture.userKnowledgePath }
              : paths;
          };
        }
        if (prop === 'getProjectRdxPaths') {
          return (projectRoot: string) => {
            const paths = target.getProjectRdxPaths(projectRoot);
            return knowledgeFixture.projectKnowledgePath
              ? { ...paths, knowledgePath: knowledgeFixture.projectKnowledgePath }
              : paths;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value),
  },
}));

import { AgentOrchestrator } from './AgentOrchestrator';

const requestPlan = createTestRequestPlan({
  providerId: 'provider',
  adapterId: 'openai-responses',
  catalogRevision: 'test-catalog',
  routeRevision: 'test-route',
  selectedModelId: 'model',
  effectiveModelId: 'model',
  appliedBindingIds: [],
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
  headers: {
    Authorization: 'Bearer must-not-persist',
    'api-key': 'must-not-persist',
    'anthropic-beta': 'context-1m',
  },
  bodyPatch: {},
  contextBudgetTokens: 256_000,
  contextMode: 'normal',
  contextWindowTokens: 500_000,
  activeTierId: 'normal',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: {
      kind: 'none',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
  },
});

const effectiveModel: EffectiveModel = {
  providerId: 'provider',
  modelId: 'model',
  label: 'Model',
  aliases: [],
  enabled: true,
  route: requestPlan.route,
  availability: 'available',
  presencePolicy: 'maintained',
  contextTiers: [{
    id: 'normal',
    label: 'Normal',
    maxPromptTokens: 256_000,
    maxOutputTokens: 244_000,
    activation: { kind: 'implicit' },
    entitlement: 'granted',
  }],
  defaultBudgetTokens: 256_000,
  controls: {
    fast: { state: 'unsupported', fixedValue: false },
    maxContext: { state: 'unsupported', fixedValue: false },
    reasoning: requestPlan.reasoningWire.control,
  },
  toolCalling: { state: 'supported' },
  visionInput: { state: 'supported' },
  structuredOutput: { state: 'supported' },
  provenance: [],
};

const routeCapability = {
  providerId: 'provider',
  modelId: 'model',
  toolCallingMode: 'native-structured' as const,
  reasoningVisibility: 'none' as const,
  reasoningDelivery: 'none' as const,
  reasoningContract: createNoneReasoningContract('test'),
  supportsStreaming: true,
  supportsToolResults: true,
  toolCallingEvidence: 'supported' as const,
  toolCallingUnverified: false,
  visionInputMode: 'native' as const,
  structuredOutputMode: 'native' as const,
};

const baseInput = {
  requestId: 'request-1',
  credentialHandle: 'credential-1',
  turnId: 'turn-1',
  agentId: 'ask' as const,
  content: 'inspect the active capture',
  imageTokenAdjustment: 0,
  providerId: 'provider',
  selectedModelId: 'model',
  effectiveModel,
  routeCapability,
  requestPlan,
  turnControls: { reasoningLevel: 'off' as const, maxContextMode: false, fastModel: false },
  promptPlan: {
    id: 'prompt-plan',
    segments: [],
    systemPrompt: 'system',
    totalTokenEstimate: 20,
    stablePrefix: { fingerprint: 'prefix', segmentIds: [], sourceHashes: [], tokenEstimate: 0, volatileSegmentIds: [] },
    metrics: { systemPrompt: 24, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  },
  toolAllowlist: [],
  projectRootPath: null,
  projectId: null,
  effectiveProfile: {
    id: 'ask',
    skills: [],
    mcpServers: [],
    provenance: { scope: 'builtin', sourcePath: 'test', sourceHash: 'test' },
  } as unknown as EffectiveAgentProfile,
  effectiveProfileIds: ['ask'],
  sessionId: null,
  visibleTurnIds: [],
  activeBranchId: 'root',
};

describe('AgentOrchestrator prepared turn context', () => {
  const tempRoots: string[] = [];
  afterEach(async () => {
    knowledgeFixture.userKnowledgePath = '';
    knowledgeFixture.projectKnowledgePath = '';
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('freezes the effective route and keeps provider window separate from prompt budget', async () => {
    const result = await new AgentOrchestrator().prepareTurnContext(baseInput);
    expect(result.summary).toMatchObject({
      requestId: 'request-1',
      turnId: 'turn-1',
      promptBudgetTokens: 256_000,
      contextWindowTokens: 500_000,
      contextMode: 'normal',
      compactionApplied: false,
      cache: {
        enabled: false,
        breakpoint: 'none',
        stableTokenEstimate: 0,
        stableSegmentCount: 0,
      },
      route: {
        providerId: 'provider',
        selectedModelId: 'model',
        effectiveModelId: 'model',
        protocol: 'OpenAIResponses',
      },
    });
    expect(result.initialMessages).toEqual([]);
    expect(result.runtime.credentialHandle).toBe('credential-1');
    expect(Array.isArray(result.runtime.effectivePlan.knowledgeReadRoots)).toBe(true);
    for (const root of result.runtime.effectivePlan.knowledgeReadRoots) {
      expect(result.runtime.effectivePlan.permissionSettings.readableRoots).not.toContain(root);
    }
    expect(result.summary.wirePatch.headers).toEqual({ 'anthropic-beta': 'context-1m' });
    expect(result.summary.breakdown.some((entry) => entry.id === 'free')).toBe(true);
  });

  it('fails before persistence when fixed prompt overhead leaves no message budget', async () => {
    await expect(new AgentOrchestrator().prepareTurnContext({
      ...baseInput,
      requestPlan: { ...requestPlan, contextBudgetTokens: 100 },
      promptPlan: {
        ...baseInput.promptPlan,
        totalTokenEstimate: 100,
        metrics: { systemPrompt: 400, scopedInstructions: 0, skills: 0 },
      },
    })).rejects.toThrow(/^PROMPT_OVERHEAD_EXCEEDS_BUDGET:/u);
  });

  it('honors cancellation before any runtime preparation work begins', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new AgentOrchestrator().prepareTurnContext({
      ...baseInput,
      signal: controller.signal,
    })).rejects.toThrow(/^REQUEST_CANCELLED:/u);
  });

  it('freezes existing user and project knowledge directories onto the plan', async () => {
    const user = await mkdtemp(path.join(os.tmpdir(), 'rdx-prep-user-'));
    const project = await mkdtemp(path.join(os.tmpdir(), 'rdx-prep-proj-'));
    tempRoots.push(user, project);
    const userKnowledge = path.join(user, 'knowledge');
    const projectKnowledge = path.join(project, '.rdx', 'knowledge');
    await mkdir(userKnowledge, { recursive: true });
    await mkdir(projectKnowledge, { recursive: true });
    knowledgeFixture.userKnowledgePath = userKnowledge;
    knowledgeFixture.projectKnowledgePath = projectKnowledge;

    const result = await new AgentOrchestrator().prepareTurnContext({
      ...baseInput,
      projectRootPath: project,
      projectId: 'proj-kn',
    });
    const roots = result.runtime.effectivePlan.knowledgeReadRoots;
    expect(roots).toHaveLength(2);
    expect(roots.map((root) => pathIdentityKey(root))).toEqual([
      pathIdentityKey(userKnowledge),
      pathIdentityKey(projectKnowledge),
    ]);
    expect(result.runtime.effectivePlan.permissionSettings.readableRoots).toEqual([]);
    expect(result.contextDiagnostic.knowledgeReadRootDiagnostics ?? []).toEqual([]);
  });

  it('excludes a symlink/junction knowledge root and records a diagnostic', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'rdx-prep-link-'));
    tempRoots.push(tmp);
    const real = path.join(tmp, 'real-knowledge');
    const link = path.join(tmp, 'knowledge');
    await mkdir(real, { recursive: true });
    try {
      await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    knowledgeFixture.userKnowledgePath = link;
    knowledgeFixture.projectKnowledgePath = path.join(tmp, 'missing-project-knowledge');

    const result = await new AgentOrchestrator().prepareTurnContext(baseInput);
    expect(result.runtime.effectivePlan.knowledgeReadRoots).toEqual([]);
    expect(result.contextDiagnostic.knowledgeReadRootDiagnostics).toEqual([
      expect.objectContaining({
        reason: 'symlink-or-junction',
      }),
    ]);
  });
});
