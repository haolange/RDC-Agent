import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }));

describe('PromptPlanBuilder', () => {
  it('builds a provenance-carrying plan without memory injection or hardcoded capabilities', async () => {
    const { PromptPlanBuilder } = await import('./PromptPlanBuilder');
    const profile = {
      id: 'ask', fileName: 'ask.agent.md', filePath: 'C:/User/.rdx/agents/ask.agent.md', name: 'Ask', description: 'Read-only answers', argumentHint: '', target: 'rdc-agent', models: [], icon: 'message-orbit', accent: '#38c6f4', disableModelInvocation: false, userInvocable: true, tools: ['read_file'], skills: ['debug'], mcpServers: [], agents: [], handoffs: [], metadata: {}, instructions: 'Answer from current evidence.', builtin: false, enabled: true,
    } satisfies AgentManifestDefinition;
    const skillPath = path.join(process.cwd(), 'resources', 'agent-runtime', 'skills', 'debug', 'SKILL.md');
    const plan = new PromptPlanBuilder().build({
      profile,
      scopedInstructions: { sources: [{ id: 'project:RDX.md', scope: 'project', sourcePath: 'D:/Project/RDX.md', sourceHash: 'hash', content: 'Project instruction', byteLength: 19, precedence: 0 }], totalBytes: 19, diagnostics: [] },
      preloadedSkills: [{ id: 'debug', name: 'debug', description: 'Debug', allowedTools: ['read_file'], scope: 'builtin', sourcePath: skillPath, sourceHash: 'skill-hash', effectiveStatus: 'effective', instructions: fs.readFileSync(skillPath, 'utf8') }],
      skillCatalog: [],
      tools: ['read_file'], workDir: 'D:/Project', routeCapability: { providerId: 'deepseek', modelId: 'deepseek-v4', toolCallingMode: 'native-structured', reasoningVisibility: 'none', reasoningDelivery: 'stream-full', reasoningContract: { semantic: 'raw', source: 'deepseek-reasoning-content', displayLabel: 'Raw reasoning', carrier: 'reasoning-content', artifactFormat: 'deepseek.reasoning-content', artifactVersion: 'v1', compatibilityGroup: 'test', continuation: 'exact-execution' }, supportsStreaming: true, supportsToolResults: true, toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'native' },
      permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
      currentDate: '2026-07-11', timeZone: 'Asia/Shanghai',
    });
    expect(plan.segments.some((segment) => segment.kind === 'scoped-instruction')).toBe(true);
    expect(plan.segments.some((segment) => segment.kind === 'preloaded-skill')).toBe(true);
    expect(plan.systemPrompt).toContain('Effective Tools\n- read_file');
    expect(plan.systemPrompt).not.toContain('MEMORY.md');
    expect(plan.systemPrompt).not.toContain('Read and write files in the workspace');
    // 空 skill catalog 时省略 skill-catalog 段。
    expect(plan.segments.some((segment) => segment.kind === 'skill-catalog')).toBe(false);
    expect(plan.systemPrompt).not.toContain('# Available Skills');
    expect(plan.systemPrompt).toContain('Do not invent progress from stages or UI state.');
    expect(plan.systemPrompt).toContain('No Tasks tools are available in this turn.');
  });

  it('describes Ask Tasks as read-only and tool_search no-match as authoritative', async () => {
    const { PromptPlanBuilder } = await import('./PromptPlanBuilder');
    const profile = {
      id: 'ask', fileName: 'ask.agent.md', filePath: 'C:/User/.rdx/agents/ask.agent.md', name: 'Ask', description: 'Read-only answers', argumentHint: '', target: 'rdc-agent', models: [], icon: 'message-orbit', accent: '#38c6f4', disableModelInvocation: false, userInvocable: true, tools: ['task_list', 'task_get', 'tool_search'], skills: [], mcpServers: [], agents: [], handoffs: [], metadata: {}, instructions: 'Answer from current evidence.', builtin: false, enabled: true,
    } satisfies AgentManifestDefinition;
    const plan = new PromptPlanBuilder().build({
      profile,
      scopedInstructions: { sources: [], totalBytes: 0, diagnostics: [] },
      preloadedSkills: [],
      skillCatalog: [],
      tools: ['task_list', 'task_get', 'tool_search'],
      workDir: 'D:/Project',
      routeCapability: { providerId: 'deepseek', modelId: 'deepseek-v4', toolCallingMode: 'native-structured', reasoningVisibility: 'none', reasoningDelivery: 'stream-full', reasoningContract: { semantic: 'raw', source: 'deepseek-reasoning-content', displayLabel: 'Raw reasoning', carrier: 'reasoning-content', artifactFormat: 'deepseek.reasoning-content', artifactVersion: 'v1', compatibilityGroup: 'test', continuation: 'exact-execution' }, supportsStreaming: true, supportsToolResults: true, toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'native' },
      permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
      currentDate: '2026-08-01',
      timeZone: 'Asia/Shanghai',
    });
    expect(plan.systemPrompt).toContain('Tasks are read-only in this turn.');
    expect(plan.systemPrompt).toContain('Use Plan or Edit');
    expect(plan.systemPrompt).toContain('cannot reveal or activate tools denied');
    expect(plan.systemPrompt).toContain('must not be repeated');
  });

  it('describes Plan/Edit task mutation capability only when mutation tools are effective', async () => {
    const { PromptPlanBuilder } = await import('./PromptPlanBuilder');
    const profile = {
      id: 'edit', fileName: 'edit.agent.md', filePath: 'C:/User/.rdx/agents/edit.agent.md', name: 'Edit', description: 'Edit files', argumentHint: '', target: 'rdc-agent', models: [], icon: 'pencil-edit', accent: '#38c6f4', disableModelInvocation: false, userInvocable: true, tools: ['task_create', 'task_update', 'task_stop'], skills: [], mcpServers: [], agents: [], handoffs: [], metadata: {}, instructions: 'Execute.', builtin: false, enabled: true,
    } satisfies AgentManifestDefinition;
    const plan = new PromptPlanBuilder().build({
      profile,
      scopedInstructions: { sources: [], totalBytes: 0, diagnostics: [] },
      preloadedSkills: [],
      skillCatalog: [],
      tools: ['task_create', 'task_update', 'task_stop'],
      workDir: 'D:/Project',
      routeCapability: { providerId: 'deepseek', modelId: 'deepseek-v4', toolCallingMode: 'native-structured', reasoningVisibility: 'none', reasoningDelivery: 'stream-full', reasoningContract: { semantic: 'raw', source: 'deepseek-reasoning-content', displayLabel: 'Raw reasoning', carrier: 'reasoning-content', artifactFormat: 'deepseek.reasoning-content', artifactVersion: 'v1', compatibilityGroup: 'test', continuation: 'exact-execution' }, supportsStreaming: true, supportsToolResults: true, toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'native' },
      permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
      currentDate: '2026-08-01',
      timeZone: 'Asia/Shanghai',
    });
    expect(plan.systemPrompt).toContain('Tasks are writable in this turn.');
    expect(plan.systemPrompt).not.toContain('Tasks are read-only in this turn.');
  });

  it('projects no effective Tasks tools when the selected route cannot execute structured tools', async () => {
    const { PromptPlanBuilder } = await import('./PromptPlanBuilder');
    const profile = {
      id: 'plan', fileName: 'plan.agent.md', filePath: 'C:/User/.rdx/agents/plan.agent.md', name: 'Plan', description: 'Plan work', argumentHint: '', target: 'rdc-agent', models: [], icon: 'route-plan', accent: '#8d8bff', disableModelInvocation: false, userInvocable: true, tools: ['task_create', 'task_update', 'task_list'], skills: [], mcpServers: [], agents: [], handoffs: [], metadata: {}, instructions: 'Plan from evidence.', builtin: false, enabled: true,
    } satisfies AgentManifestDefinition;
    const plan = new PromptPlanBuilder().build({
      profile,
      scopedInstructions: { sources: [], totalBytes: 0, diagnostics: [] },
      preloadedSkills: [],
      skillCatalog: [],
      tools: ['task_create', 'task_update', 'task_list', 'tool_search'],
      workDir: 'D:/Project',
      routeCapability: { providerId: 'cline-pass', modelId: 'glm-5.2', toolCallingMode: 'text-only', reasoningVisibility: 'none', reasoningDelivery: 'none', reasoningContract: { semantic: 'none', source: 'none', displayLabel: 'None', carrier: 'none', artifactFormat: 'none', artifactVersion: 'v1', compatibilityGroup: 'test', continuation: 'none' }, supportsStreaming: true, supportsToolResults: false, toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'prompt-fallback' },
      permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
      currentDate: '2026-08-01',
      timeZone: 'Asia/Shanghai',
    });

    expect(plan.systemPrompt).toContain('No runtime tools are available for this turn.');
    expect(plan.systemPrompt).toContain('No Tasks tools are available in this turn.');
    expect(plan.systemPrompt).toContain('Do not imitate tool calls in text.');
    expect(plan.systemPrompt).not.toContain('- task_create');
    expect(plan.systemPrompt).not.toContain('Tasks are writable in this turn.');
  });

  it('includes the skill catalog for large and small windows when non-empty', async () => {
    const { PromptPlanBuilder } = await import('./PromptPlanBuilder');
    const baseProfile = {
      id: 'ask', fileName: 'ask.agent.md', filePath: 'C:/User/.rdx/agents/ask.agent.md', name: 'Ask', description: 'Read-only answers', argumentHint: '', target: 'rdc-agent', models: [], icon: 'message-orbit', accent: '#38c6f4', disableModelInvocation: false, userInvocable: true, tools: ['read_file'], skills: [], mcpServers: [], agents: [], handoffs: [], metadata: {}, instructions: 'Answer from current evidence.', builtin: false, enabled: true,
    } satisfies AgentManifestDefinition;
    const buildWith = (contextWindowTokens?: number) => new PromptPlanBuilder().build({
      profile: baseProfile,
      scopedInstructions: { sources: [], totalBytes: 0, diagnostics: [] },
      preloadedSkills: [],
      skillCatalog: [{ id: 'debug', name: 'debug', description: 'Debug workflows', allowedTools: [], scope: 'builtin', sourcePath: 'skill://debug', sourceHash: 'h', effectiveStatus: 'effective' }],
      tools: ['read_file'], workDir: 'D:/Project',
      routeCapability: { providerId: 'deepseek', modelId: 'deepseek-v4', toolCallingMode: 'native-structured', reasoningVisibility: 'none', reasoningDelivery: 'stream-full', reasoningContract: { semantic: 'raw', source: 'deepseek-reasoning-content', displayLabel: 'Raw reasoning', carrier: 'reasoning-content', artifactFormat: 'deepseek.reasoning-content', artifactVersion: 'v1', compatibilityGroup: 'test', continuation: 'exact-execution' }, supportsStreaming: true, supportsToolResults: true, toolCallingUnverified: false, visionInputMode: 'disabled', structuredOutputMode: 'native' },
      permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
      currentDate: '2026-07-11', timeZone: 'Asia/Shanghai',
      ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
    });

    expect(buildWith(200_000).segments.some((segment) => segment.kind === 'skill-catalog')).toBe(true);
    expect(buildWith(32_000).segments.some((segment) => segment.kind === 'skill-catalog')).toBe(true);
    expect(buildWith(32_000).systemPrompt).toContain('# Available Skills');
  });
});
