import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type { PromptPlan, PromptSegment, ScopedInstructionResolution, SkillLoadResult, SkillMetadata } from '@shared/types/rdxRuntime';
import { charsToTokens } from '@shared/utils/tokens';
import { generateEventId } from '@shared/utils/id';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { resolveHarnessProfile } from '../capabilities/HarnessProfileResolver';

const CORE_FILES = ['identity-collaboration.md', 'agent-loop.md', 'tool-evidence.md', 'completion.md'];

export interface PromptPlanInput {
  profile: AgentManifestDefinition;
  scopedInstructions: ScopedInstructionResolution;
  preloadedSkills: SkillLoadResult[];
  skillCatalog: SkillMetadata[];
  tools: string[];
  workDir: string;
  routeCapability: AgentRouteCapability;
  effectiveModel?: EffectiveModel;
  permissionSettings: AgentPermissionSettings;
  currentDate: string;
  timeZone: string;
  contextWindowTokens?: number;
}

export class PromptPlanBuilder {
  private coreRoot(): string {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'agent-runtime', 'prompts'),
      path.join(process.cwd(), 'resources', 'agent-runtime', 'prompts'),
      path.join(process.resourcesPath ?? '', 'agent-runtime', 'prompts'),
    ];
    return candidates.map((candidate) => path.resolve(candidate)).find((candidate) => fs.existsSync(candidate)) ?? path.resolve(candidates[0]);
  }

  build(input: PromptPlanInput): PromptPlan {
    const diagnostics = [...input.scopedInstructions.diagnostics];
    const segments: PromptSegment[] = [];
    const push = (
      segment: Omit<PromptSegment, 'precedence' | 'tokenEstimate' | 'stability'>
        & { stability?: PromptSegment['stability'] },
    ) => {
      const content = segment.content.trim();
      if (!content) return;
      segments.push({
        ...segment,
        content,
        stability: segment.stability ?? 'stable',
        precedence: segments.length,
        tokenEstimate: charsToTokens(content.length),
      });
    };

    for (const fileName of CORE_FILES) {
      const sourcePath = path.join(this.coreRoot(), fileName);
      const content = fs.readFileSync(sourcePath, 'utf8');
      push({ id: `core:${fileName}`, kind: 'core-contract', scope: 'builtin', sourcePath, sourceHash: hashScopedResource(content), content });
    }

    const profileContent = [
      `# Effective Agent Profile`,
      `Name: ${input.profile.name}`,
      `Description: ${input.profile.description}`,
      input.profile.instructions,
    ].filter(Boolean).join('\n\n');
    push({ id: `agent:${input.profile.id}`, kind: 'agent-profile', scope: 'user', sourcePath: input.profile.filePath, sourceHash: hashScopedResource(input.profile), content: profileContent });

    input.scopedInstructions.sources.forEach((source) => push({
      id: source.id,
      kind: 'scoped-instruction',
      scope: source.scope,
      sourcePath: source.sourcePath,
      sourceHash: source.sourceHash,
      content: `# Scoped Instructions · ${source.scope}\n\n${source.content}`,
    }));

    input.preloadedSkills.forEach((skill) => push({
      id: `skill:${skill.id}`,
      kind: 'preloaded-skill',
      scope: skill.scope,
      sourcePath: skill.sourcePath,
      sourceHash: skill.sourceHash,
      content: `# Preloaded Skill · ${skill.name}\n\n${skill.instructions}`,
    }));

    // Harness 丰俭裁决：显式 `.agent.md` harness 偏好优先，
    // 否则按模型事实（窗口/reasoning）启发；空 catalog 一律省略该段。
    const harness = resolveHarnessProfile({
      ...(input.profile.harness ? { manifestHarness: input.profile.harness } : {}),
      declaredSkillCount: input.profile.skills.length,
      skillCatalogCount: input.skillCatalog.length,
      ...(input.contextWindowTokens !== undefined
        ? { contextWindowTokens: input.contextWindowTokens }
        : {}),
      ...(input.effectiveModel
        ? { reasoningKind: input.effectiveModel.controls.reasoning.kind }
        : {}),
    });
    if (harness.includeSkillCatalog) {
      const catalogLimitChars = harness.catalogCharBudget;
      const catalogLines: string[] = ['# Available Skills', 'Use `skill_read` to load a skill not already preloaded.'];
      for (const skill of input.skillCatalog) {
        const line = `- ${skill.id}: ${skill.description} [${skill.scope}]`;
        if (catalogLines.join('\n').length + line.length + 1 > catalogLimitChars) {
          diagnostics.push({ code: 'skills.catalog.truncated', severity: 'warning', message: `Skill metadata catalog exceeded ${catalogLimitChars} characters.` });
          break;
        }
        catalogLines.push(line);
      }
      push({ id: 'skills:catalog', kind: 'skill-catalog', scope: 'runtime', sourcePath: 'runtime://skills/catalog', sourceHash: hashScopedResource(catalogLines), content: catalogLines.join('\n') });
    }

    push({
      id: 'runtime:tools',
      kind: 'tool-capability',
      scope: 'runtime',
      sourcePath: 'runtime://tools/effective',
      sourceHash: hashScopedResource(input.tools),
      content: input.tools.length ? ['# Effective Tools', ...input.tools.map((tool) => `- ${tool}`)].join('\n') : '# Effective Tools\nNo runtime tools are available for this turn.',
    });

    const permission = input.permissionSettings;
    const runtimeFactsContent = [
      '# Runtime Facts',
      `Agent id: ${input.profile.id}`,
      `Model route: ${input.routeCapability.providerId}/${input.routeCapability.modelId}`,
      `Tool calling: ${input.routeCapability.toolCallingMode}`,
      `Tool calling evidence: ${input.routeCapability.toolCallingUnverified ? 'unverified (fail-open)' : 'verified'}`,
      `Vision input: ${input.routeCapability.visionInputMode}`,
      `Structured output: ${input.routeCapability.structuredOutputMode}`,
      ...(input.routeCapability.structuredOutputMode === 'prompt-fallback'
        ? ['When a structured response is requested, follow the requested schema in the prompt; no native structured-output contract is available.']
        : []),
      `Project root: ${input.workDir || '(none)'}`,
      `Permission mode: ${permission.mode}`,
      `Additional readable roots: ${permission.readableRoots.join(', ') || '(none)'}`,
      `Additional writable roots: ${permission.writableRoots.join(', ') || '(none)'}`,
      `Current date: ${input.currentDate}`,
      `Time zone: ${input.timeZone}`,
    ].join('\n');
    push({
      id: 'runtime:facts',
      kind: 'runtime-fact',
      scope: 'runtime',
      sourcePath: 'runtime://facts',
      sourceHash: hashScopedResource(runtimeFactsContent),
      stability: 'volatile',
      content: runtimeFactsContent,
    });

    const systemPrompt = segments.map((segment) => segment.content).join('\n\n');
    const stableSegments = segments.filter((segment) => segment.stability === 'stable');
    const firstVolatileIndex = segments.findIndex((segment) => segment.stability === 'volatile');
    if (firstVolatileIndex >= 0 && segments.slice(firstVolatileIndex).some((segment) => segment.stability === 'stable')) {
      throw new Error('PromptPlan stable segments must form one contiguous prefix.');
    }
    const stablePrefix = {
      fingerprint: hashScopedResource(stableSegments.map((segment) => ({
        id: segment.id,
        sourceHash: segment.sourceHash,
        content: segment.content,
      }))),
      segmentIds: stableSegments.map((segment) => segment.id),
      sourceHashes: stableSegments.map((segment) => segment.sourceHash),
      tokenEstimate: stableSegments.reduce((sum, segment) => sum + segment.tokenEstimate, 0),
      volatileSegmentIds: segments
        .filter((segment) => segment.stability === 'volatile')
        .map((segment) => segment.id),
    };
    const scopedInstructions = segments.filter((segment) => segment.kind === 'scoped-instruction').reduce((sum, segment) => sum + segment.content.length, 0);
    const skills = segments.filter((segment) => segment.kind === 'preloaded-skill' || segment.kind === 'skill-catalog').reduce((sum, segment) => sum + segment.content.length, 0);
    return {
      id: generateEventId('prompt-plan'),
      segments,
      systemPrompt,
      totalTokenEstimate: segments.reduce((sum, segment) => sum + segment.tokenEstimate, 0),
      stablePrefix,
      metrics: { systemPrompt: Math.max(0, systemPrompt.length - scopedInstructions - skills), scopedInstructions, skills },
      diagnostics,
    };
  }
}

export const promptPlanBuilder = new PromptPlanBuilder();
