import fs from 'fs';
import path from 'path';
import { appPathService } from '../../runtime/AppPathService';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type {
  EffectiveAgentProfile,
  PromptPlan,
  PromptSegment,
  ResourceScope,
  ScopedInstructionResolution,
  SkillLoadResult,
  SkillMetadata,
} from '@shared/types/rdxRuntime';
import { charsToTokens } from '@shared/utils/tokens';
import { generateEventId } from '@shared/utils/id';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { resolveSkillCatalogBudget } from '../capabilities/SkillCatalogBudget';
import { formatShellInterpreterLabel } from '../../runtime/ShellResolver';
import { resolveConfiguredShell } from '../../runtime/resolveConfiguredShell';
import { storageAdapter } from '../../sessions/StorageAdapter';

const CORE_FILES = ['identity-collaboration.md', 'agent-loop.md', 'tool-evidence.md', 'completion.md'];

export interface PromptPlanInput {
  /** Prefer EffectiveAgentProfile so provenance.scope is marked correctly. */
  profile: EffectiveAgentProfile | (AgentManifestDefinition & { provenance?: EffectiveAgentProfile['provenance'] });
  scopedInstructions: ScopedInstructionResolution;
  preloadedSkills: SkillLoadResult[];
  skillCatalog: SkillMetadata[];
  tools: string[];
  workDir: string;
  sessionId?: string | null;
  routeCapability: AgentRouteCapability;
  effectiveModel?: EffectiveModel;
  permissionSettings: AgentPermissionSettings;
  currentDate: string;
  timeZone: string;
  contextWindowTokens?: number;
  /** Volatile extra segments (e.g. Delegation Capsule). Appended after runtime-fact. */
  extraSegments?: PromptSegment[];
}

function resolveProfileProvenance(profile: PromptPlanInput['profile']): {
  scope: ResourceScope;
  sourcePath: string;
  sourceHash: string;
} {
  if (profile.provenance) {
    return {
      scope: profile.provenance.scope,
      sourcePath: profile.provenance.sourcePath,
      sourceHash: profile.provenance.sourceHash,
    };
  }
  return {
    scope: 'user',
    sourcePath: profile.filePath,
    sourceHash: hashScopedResource(profile),
  };
}

export class PromptPlanBuilder {
  private coreRoot(): string {
    return path.join(appPathService.getBuiltinAgentRuntimeRoot(), 'prompts');
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

    const fileRouting = 'Use read_file / grep / glob / edit_file / write_file for file I/O. Before editing or overwriting an existing file, successfully read_file the same realpath in this session; after restart read again. shell.command file-tool bypass is denied; use dedicated structured execution for host-owned capabilities.';
    push({ id: 'core:file-tool-routing', kind: 'core-contract', scope: 'builtin', sourcePath: 'runtime:file-tool-routing', sourceHash: hashScopedResource(fileRouting), content: fileRouting });

    const profileContent = [
      `# Effective Agent Profile`,
      `Name: ${input.profile.name}`,
      `Description: ${input.profile.description}`,
      input.profile.instructions,
    ].filter(Boolean).join('\n\n');
    const provenance = resolveProfileProvenance(input.profile);
    push({
      id: `agent:${input.profile.id}`,
      kind: 'agent-profile',
      scope: provenance.scope,
      sourcePath: provenance.sourcePath,
      sourceHash: provenance.sourceHash,
      content: profileContent,
    });

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

    // Progressive Skill 索引：非空 catalog 一律注入；预算仅按窗口缩放。
    const catalogBudget = resolveSkillCatalogBudget({
      skillCatalogCount: input.skillCatalog.length,
      ...(input.contextWindowTokens !== undefined
        ? { contextWindowTokens: input.contextWindowTokens }
        : {}),
    });
    if (catalogBudget.includeSkillCatalog) {
      const catalogLimitChars = catalogBudget.catalogCharBudget;
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

    const effectiveTools = input.routeCapability.toolCallingMode === 'native-structured'
      ? input.tools
      : [];
    const effectiveToolContent = buildEffectiveToolContent(effectiveTools);
    push({
      id: 'runtime:tools',
      kind: 'tool-capability',
      scope: 'runtime',
      sourcePath: 'runtime://tools/effective',
      sourceHash: hashScopedResource(effectiveTools),
      content: effectiveToolContent,
    });

    const permission = input.permissionSettings;
    const runtimeFactsContent = [
      '# Runtime Facts',
      `Agent id: ${input.profile.id}`,
      `Model route: ${input.routeCapability.providerId}/${input.routeCapability.modelId}`,
      `Tool calling: ${input.routeCapability.toolCallingMode}`,
      `Tool calling evidence: ${input.routeCapability.toolCallingEvidence}`,
      `Vision input: ${input.routeCapability.visionInputMode}`,
      `Structured output: ${input.routeCapability.structuredOutputMode}`,
      ...(input.routeCapability.structuredOutputMode === 'prompt-fallback'
        ? ['When a structured response is requested, follow the requested schema in the prompt; no native structured-output contract is available.']
        : []),
      `Project root: ${input.workDir || '(none)'}`,
      `Host OS: ${process.platform}`,
      `Shell: ${resolvePromptShellLabel()}`,
      `Shell cwd: ${resolvePromptShellCwd(input.sessionId, input.workDir)}`,
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

    for (const extra of input.extraSegments ?? []) {
      const content = extra.content.trim();
      if (!content) continue;
      segments.push({
        ...extra,
        content,
        stability: 'volatile',
        precedence: segments.length,
        tokenEstimate: extra.tokenEstimate || charsToTokens(content.length),
      });
    }

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

function resolvePromptShellLabel(): string {
  try {
    const resolved = resolveConfiguredShell();
    return `${formatShellInterpreterLabel(resolved.kind)} ${resolved.version}`.trim();
  } catch {
    return 'unavailable';
  }
}

function resolvePromptShellCwd(sessionId: string | null | undefined, workDir: string): string {
  if (sessionId) {
    try {
      const persisted = storageAdapter.readSessionShellCwd(sessionId);
      if (persisted) return persisted;
    } catch {
      /* session may not exist yet */
    }
  }
  return workDir || '(none)';
}

export const promptPlanBuilder = new PromptPlanBuilder();

function buildEffectiveToolContent(tools: readonly string[]): string {
  const lines = tools.length
    ? ['# Effective Tools', ...tools.map((tool) => `- ${tool}`)]
    : [
        '# Effective Tools',
        'No runtime tools are available for this turn.',
        'Do not imitate tool calls in text. If the user asks for an unavailable tool, state the capability mismatch once; do not search for or retry that tool unless the effective tool set changes.',
      ];
  const toolSet = new Set(tools);
  const readableTasks = toolSet.has('task_list') || toolSet.has('task_get');
  const mutableTasks = toolSet.has('task_create')
    || toolSet.has('task_update')
    || toolSet.has('task_stop');

  if (mutableTasks) {
    lines.push(
      '',
      '## Tasks capability',
      'Tasks are writable in this turn. Create, update, inspect, list, or stop Tasks only through the effective task tools shown above.',
      'Create the full multi-step list in one task_create call. Do not create Tasks one by one.',
      'Before starting a step, mark exactly one task in_progress. When it is done, mark it completed immediately and only then start the next.',
      'blocked requires a statusReason. Do not create Tasks for single-step or trivial work.',
    );
  } else if (readableTasks) {
    lines.push(
      '',
      '## Tasks capability',
      'Tasks are read-only in this turn. You may inspect Tasks with task_list/task_get, but you cannot create, update, or stop them.',
      'Use a profile whose effective tools include task mutations when Tasks must change.',
    );
  } else {
    lines.push('', '## Tasks capability', 'No Tasks tools are available in this turn.');
  }

  if (toolSet.has('tool_search')) {
    lines.push(
      '',
      '## Tool discovery authority',
      'tool_search searches only this effective tool set; it cannot reveal or activate tools denied by the Agent profile, policy, or runtime.',
      'An authoritative no-match must not be repeated until the effective tool set fingerprint changes.',
    );
  }
  return lines.join('\n');
}
