/**
 * ProfileTurnPreparation — unique prepare path for sendMessage / sendProfileMessage / subagent.
 * Builds the same frozen prepareTurnContext plan ConversationTurnStarter uses, without conversation commit.
 */

import type { AgentRole } from '@shared/types/agent';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import type { EffectiveAgentProfile, PromptPlan } from '@shared/types/rdcRuntime';
import { generateEventId } from '@shared/utils/id';
import { imageTokenAdjustmentForContent } from '../../conversation/ConversationAttachmentMaterializer';
import {
  resolveAgentRouteCapability,
} from '../../agent-runtime/capabilities/RouteCapabilityResolver';
import {
  planEffectiveModelRequest,
  resolveEffectiveModel,
} from '../../settings/EffectiveModelResolver';
import { settingsService } from '../../settings/SettingsService';
import { compileEffectivePolicy } from '../../agent-runtime/permissions/PolicyCompiler';
import { stripRdcLeaseToolsFromAllowlist } from '@shared/constants/rdcLeaseTools';
import type { TurnPreparationService } from './TurnPreparationService';
import type { AgentProfileTurnOptions, PreparedAgentTurnContext } from './orchestratorTypes';
import { newDelegationBudgetExhausted } from './DelegationAdmission';

export function resolveProfileToolAllowlist(
  allowlist: string[],
  options?: AgentProfileTurnOptions,
  prepared?: PreparedAgentTurnContext | null,
): string[] {
  const leaseFiltered = options?.excludeRdcLeaseTools ? stripRdcLeaseToolsFromAllowlist(allowlist) : allowlist;
  const maxDepth = Math.min(prepared?.runtime.effectivePlan.policy.maxChildDepth
    ?? compileEffectivePolicy(options?.projectRootPath ?? null).maxChildDepth, options?.policyBudget?.maxChildDepth ?? Infinity);
  return (options?.subagentBudget?.depth ?? options?.policyBudget?.childDepth ?? 0) >= maxDepth
    || newDelegationBudgetExhausted(options?.policyBudget, options?.subagentBudget)
    ? leaseFiltered.filter((name) => name.trim().toLowerCase() !== 'subagent') : leaseFiltered;
}

export interface ProfileTurnPreparationInput {
  agentId: AgentRole;
  content: string;
  systemPrompt: string;
  providerId: string;
  modelId: string;
  toolAllowlist: string[];
  promptPlan: PromptPlan;
  effectiveProfile: EffectiveAgentProfile | null;
  effectiveProfileIds: string[];
  projectRootPath?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  turnId?: string;
  credentialHandle: string;
  requestPlan?: RequestPlan;
  turnControls?: ConversationTurnControls;
  temperature?: number;
  visibleTurnIds?: string[];
  activeBranchId?: string | null;
  signal?: AbortSignal;
  /** When true, skip journal materialization (isolated child turns). */
  isolateContext?: boolean;
  excludeRdcLeaseTools?: boolean;
  frozenDelegationCapsule?: import('@shared/types/delegationCapsule').DelegationCapsule;
  subagentDepth?: number;
  inheritedMaxChildDepth?: number;
  excludeSubagent?: boolean;
}

export class ProfileTurnPreparation {
  constructor(private readonly turnPrep: TurnPreparationService) {}

  async prepare(input: ProfileTurnPreparationInput): Promise<{
    prepared: PreparedAgentTurnContext;
    requestPlan: RequestPlan;
    turnControls: ConversationTurnControls;
    effectiveModel: EffectiveModel;
  }> {
    const settings = settingsService.getAll();
    const planning = input.requestPlan
      ? {
          ok: true as const,
          plan: input.requestPlan,
          controls: input.turnControls ?? {
            reasoningLevel: input.requestPlan.reasoningWire.selection === 'unknown'
              ? 'off' as const
              : input.requestPlan.reasoningWire.selection,
            maxContextMode: input.requestPlan.contextMode === 'one-million',
            fastModel: input.requestPlan.fastMode,
          },
          warnings: [] as string[],
        }
      : planEffectiveModelRequest({
          providerId: input.providerId,
          modelId: input.modelId,
          settings,
          controls: {
            ...(input.turnControls ?? {}),
          },
          requestedTemperature: input.temperature,
        });
    if (!planning.ok) {
      throw new Error(`${planning.code}: ${planning.message}`);
    }
    const effectiveModel = resolveEffectiveModel(input.providerId, input.modelId, settings);
    if (!effectiveModel) {
      throw new Error(`MODEL_UNAVAILABLE: ${input.providerId}/${input.modelId}`);
    }
    const routeProvider = settings.llm.providers.find((entry) => entry.id === input.providerId);
    const routeCapability = resolveAgentRouteCapability(
      routeProvider,
      input.modelId,
      effectiveModel,
      planning.plan,
    );
    if (!input.effectiveProfile) {
      throw new Error(`AGENT_PROFILE_UNAVAILABLE: ${input.agentId}`);
    }
    const requestId = generateEventId('profile-prep');
    const turnId = input.turnId ?? generateEventId('turn');
    const prepared = await this.turnPrep.prepareTurnContext({
      requestId,
      credentialHandle: input.credentialHandle,
      turnId,
      agentId: input.agentId,
      content: input.content,
      imageTokenAdjustment: imageTokenAdjustmentForContent(input.content),
      providerId: input.providerId,
      selectedModelId: input.modelId,
      effectiveModel,
      routeCapability,
      requestPlan: planning.plan,
      turnControls: planning.controls,
      promptPlan: input.promptPlan,
      effectiveProfile: input.effectiveProfile,
      effectiveProfileIds: input.effectiveProfileIds,
      toolAllowlist: input.toolAllowlist,
      projectRootPath: input.projectRootPath ?? null,
      projectId: input.projectId ?? null,
      sessionId: input.isolateContext ? null : (input.sessionId ?? null),
      visibleTurnIds: input.isolateContext ? [] : (input.visibleTurnIds ?? []),
      activeBranchId: input.activeBranchId ?? null,
      signal: input.signal,
      excludeRdcLeaseTools: input.excludeRdcLeaseTools,
      frozenDelegationCapsule: input.frozenDelegationCapsule,
      subagentDepth: input.subagentDepth,
      inheritedMaxChildDepth: input.inheritedMaxChildDepth,
      excludeSubagent: input.excludeSubagent,
    });
    return {
      prepared,
      requestPlan: planning.plan,
      turnControls: planning.controls,
      effectiveModel,
    };
  }
}
