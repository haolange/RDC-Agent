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

