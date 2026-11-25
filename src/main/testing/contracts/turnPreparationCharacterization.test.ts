import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Isolated user data and user resource roots, fixed before any module resolves its paths.
const roots = vi.hoisted(() => {
  const nodeFs = require('node:fs') as typeof import('node:fs');
  const nodePath = require('node:path') as typeof import('node:path');
  const base = nodeFs.mkdtempSync(nodePath.join(require('node:os').tmpdir(), 'rdc-turn-char-'));
  process.env.RDC_AGENT_USER_DATA = nodePath.join(base, 'user-data');
  const home = nodePath.join(base, 'home');
  (require('node:os') as typeof import('node:os')).homedir = () => home;
  return { base, project: nodePath.join(base, 'project') };
});
const offer = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('electron', () => ({
  app: { getPath: () => roots.base, getAppPath: () => process.cwd(), getVersion: () => '0.0.0-test' },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (value: string) => Buffer.from(value) },
}));
vi.mock('../../runtime/AuditLog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../runtime/AuditLog')>(),
  auditLog: { record: vi.fn() },
}));
vi.mock('../../sessions/run/handoffSkills', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../sessions/run/handoffSkills')>(),
  approvedExecutionOfferForAgent: () => offer.current,
}));

import { EXECUTION_OFFER_SCHEMA } from '@shared/types/executionOffer';
import { renderInvestigationPlanContract } from '@shared/types/planInvestigation';
import { agentAccessCeiling } from '@shared/types/agentManifest';
import { getLoadedProviderSurface, loadProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { parseOllamaInstalledModels } from '../../settings/provider-catalog/LiveProviderCatalogParsers';
import {
  planEffectiveModelRequest,
  refreshEffectiveCatalogDiscovery,
  resolveEffectiveModel,
} from '../../settings/provider-catalog/EffectiveModelResolver';
import { resolveAgentRouteCapability } from '../../agent-runtime/capabilities/RouteCapabilityResolver';
import { AgentOrchestrator } from '../../agent-runtime/orchestration/AgentOrchestrator';
import { PromptPlanForTurn } from '../../agent-runtime/orchestration/PromptPlanForTurn';
import { agentManifestService } from '../../settings/agent-manifests/AgentManifestService';
import { appPathService } from '../../runtime/AppPathService';
import { storageAdapter } from '../../sessions/store/StorageAdapter';
import { planArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import { resolveAgentToolAllowlistFromDefinition } from '../../agent-runtime/orchestration/RuntimeToolPolicy';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { PreparedAgentTurnContext } from '../../agent-runtime/orchestration/orchestratorTypes';

/**
 * Characterization of turn preparation: for each built-in top-level Agent and each kind of turn, the frozen plan
 * fingerprint, the prepared-context summary and the request plan are pinned. Refactors of settings access, prompt
 * assembly and turn preparation must leave these unchanged; an intended change updates the inline snapshot in the
 * same commit.
 */

const AGENTS = ['general', 'debugger', 'analyzer', 'optimizer'] as const;
const MODEL_ID = 'local-model';
const provider = {
  id: 'ollama', protocol: 'OllamaOpenAICompatibleChatCompletions', catalogOwnership: 'user-managed',
  enabled: true, isConfigured: true, status: 'verified',
  baseUrl: 'http://127.0.0.1:11434/v1', models: [{ id: MODEL_ID, label: 'Local model', enabled: true, defaultBudgetTokens: 65_536 }],
} as unknown as LlmProviderEntry;
const providers = { get: (providerId: string) => (providerId === provider.id ? provider : undefined) };

type Scenario = 'no-session' | 'session' | 'attachment' | 'approved-plan' | 'subagent';
const SCENARIOS: Scenario[] = ['no-session', 'session', 'attachment', 'approved-plan', 'subagent'];

let sessionId = '';
let projectId = '';
let approvedPlan = { uri: '', hash: '' };

beforeAll(async () => {
  vi.useFakeTimers({ now: new Date('2026-11-25T00:00:00.000Z'), toFake: ['Date'] });
  fs.mkdirSync(roots.project, { recursive: true });
  await loadProviderSurface('ollama');
  await refreshEffectiveCatalogDiscovery(provider, [], parseOllamaInstalledModels(
    { models: [{ name: MODEL_ID }] }, new Map([[MODEL_ID, { capabilities: ['tools', 'vision'] }]]), getLoadedProviderSurface('ollama')!,
  ).contributions);
  await storageAdapter.initializeWorkspace();
  const project = await storageAdapter.createProject(roots.project);
  projectId = project.projectId;
  sessionId = storageAdapter.createSession(projectId, 'Characterization').sessionId;
  const written = planArtifactWriter.writeLivePlan(sessionId,
    `# Plan\n\n1. Read the hair pass.\n\n${renderInvestigationPlanContract({ schemaVersion: 1, mission: 'debugger' })}`);
  approvedPlan = { uri: written.uri, hash: written.hash };
});

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(roots.base, { recursive: true, force: true });
});

async function prepare(agentId: (typeof AGENTS)[number], scenario: Scenario): Promise<PreparedAgentTurnContext> {
  // A Debugger plan approved for General: only General receives the offer, as approvedExecutionOfferForAgent decides.
  offer.current = scenario === 'approved-plan' && agentId === 'general' ? {
    schemaVersion: EXECUTION_OFFER_SCHEMA, sourceAgentId: 'debugger', targetAgentId: 'general', plan: approvedPlan,
    requiredSkillIds: [], label: 'Execute', prompt: 'Execute the approved plan.', approvedAt: Date.parse('2026-11-25T00:00:00.000Z'),
  } : null;
  const profiles = agentManifestService.getEffectiveProfiles(appPathService.getUserRdcPaths(), roots.project);
  const profile = profiles.find((entry) => entry.id === agentId)!;
  const planning = planEffectiveModelRequest({ providerId: 'ollama', modelId: MODEL_ID, providers, controls: {} });
  if (!planning.ok) throw new Error(`${planning.code}: ${planning.message}`);
  const effectiveModel = resolveEffectiveModel('ollama', MODEL_ID, providers)!;
  const toolAllowlist = resolveAgentToolAllowlistFromDefinition(agentId, profile.tools, agentAccessCeiling(profile));
  const scoped = scenario === 'session' || scenario === 'attachment' || scenario === 'approved-plan';
  const promptPlan = new PromptPlanForTurn().buildPromptPlanForAgentTurn({
    agentId, sessionId: scoped ? sessionId : null, projectRootPath: roots.project, providerId: 'ollama', modelId: MODEL_ID,
    toolAllowlist, contextWindowTokens: planning.plan.contextWindowTokens, capability: effectiveModel, requestPlan: planning.plan,
    systemPrompt: profile.instructions, messageText: 'Why is the hair black?', effectiveProfile: profile, effectiveProfiles: profiles,
  })!;
  const content = scenario === 'attachment'
    ? [{ type: 'text' as const, text: 'Why is the hair black?' }, { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' }]
    : 'Why is the hair black?';
  return new AgentOrchestrator().prepareTurnContext({
    requestId: `request-${agentId}-${scenario}`, credentialHandle: 'credential', turnId: `turn-${agentId}-${scenario}`, agentId,
    content: content as never, imageTokenAdjustment: scenario === 'attachment' ? 85 : 0,
    providerId: 'ollama', selectedModelId: MODEL_ID, effectiveModel,
    routeCapability: resolveAgentRouteCapability(provider, MODEL_ID, effectiveModel, planning.plan),
    requestPlan: planning.plan, turnControls: planning.controls, promptPlan, effectiveProfile: profile,
    effectiveProfileIds: profiles.filter((entry) => entry.enabled).map((entry) => entry.id), toolAllowlist,
    projectRootPath: roots.project, projectId: scoped ? projectId : null, sessionId: scoped ? sessionId : null,
    visibleTurnIds: [], activeBranchId: 'root',
    ...(scenario === 'subagent' ? {
      subagentDepth: 1,
      frozenDelegationCapsule: { inputArtifactRefs: [], challengeRefs: [], acceptedFacts: [] } as never,
    } : {}),
  });
}

/** Every spelling a host may use for a directory: as given, resolved, with forward slashes, and case-folded (Windows). */
function pathForms(raw: string): string[] {
  const forms = [raw, fs.realpathSync.native(raw)].flatMap((form) => [form, form.replace(/\\/g, '/')]);
  return [...new Set([...forms, ...forms.map((form) => form.toLowerCase())])].sort((left, right) => right.length - left.length);
}

/** Machine-specific values (fixture root, checkout path, generated ids) are replaced so the result is the same on every host. */
function normalize(value: unknown): unknown {
  if (typeof value === 'string') {
    let text = value;
    for (const [raw, token] of [[roots.base, '<root>'], [process.cwd(), '<repo>']] as const) {
      for (const form of pathForms(raw)) text = text.split(form).join(token);
    }
    for (const [id, token] of [[projectId, '<project>'], [sessionId, '<session>']] as const) text = text.split(id).join(token);
    return text.includes('<root>') || text.includes('<repo>') ? text.replace(/\\/g, '/') : text;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
  return value;
}

/**
 * The frozen plan without its per-run identity and its hashes over path- or host-dependent sources (the system prompt
 * carries host facts; the policy and RDC CLI binding fingerprints cover file locations), the prompt's segment
 * structure, the prepared-context summary and the request plan identity.
 */
const HOST_DEPENDENT_HASHES = new Set(['promptPlanFingerprint', 'rdcBindingFingerprint']);

function characterize(prepared: PreparedAgentTurnContext) {
  const { planId: _planId, fingerprint: _fingerprint, policyFingerprint: _policyFingerprint, routeCapability, profileProvenance, policy, ...plan } =
    prepared.runtime.effectivePlan as unknown as Record<string, unknown> & {
      routeCapability: { toolCallingMode: string }; profileProvenance: { scope: string; sourceHash: string } | null;
      policy: Record<string, unknown>;
    };
  const { sourceFingerprint: _sourceFingerprint, ...policyFields } = policy;
  const { summary } = prepared;
  return normalize({
    plan: {
      ...Object.fromEntries(Object.entries(plan).filter(([key]) => !HOST_DEPENDENT_HASHES.has(key))),
      profileProvenance: profileProvenance && { scope: profileProvenance.scope, sourceHash: profileProvenance.sourceHash },
      policy: policyFields,
      toolCallingMode: routeCapability.toolCallingMode,
    },
    promptSegments: prepared.runtime.promptPlan.segments.map((segment) => `${segment.kind}:${segment.id}`),
    summary: {
      promptBudgetTokens: summary.promptBudgetTokens, contextWindowTokens: summary.contextWindowTokens,
      contextMode: summary.contextMode, compactionApplied: summary.compactionApplied, route: summary.route,
    },
  });
}

describe('turn preparation characterization', () => {
  it.each(AGENTS.flatMap((agentId) => SCENARIOS.map((scenario) => [agentId, scenario] as const)))(
    '%s · %s',
    async (agentId, scenario) => {
      expect(characterize(await prepare(agentId, scenario))).toMatchSnapshot();
    },
  );
});


describe('turn preparation budget', () => {
  /**
   * Preparing one turn may read the committed settings at most once; every further read would re-parse and rebuild
   * the whole configuration on the turn's critical path. Settings are served from the in-memory snapshot.
   */
  it('reads the settings file at most once while preparing a turn', async () => {
    const settingsPath = appPathService.getRuntimePaths().settingsPath;
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      await prepare('general', 'session');
      const settingsReads = read.mock.calls.filter(([file]) => typeof file === 'string' && file === settingsPath).length;
      expect(settingsReads).toBeLessThanOrEqual(1);
    } finally {
      read.mockRestore();
    }
  });
});
