import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { PromptPlanBuilder } from '../agent-runtime/prompt/PromptPlanBuilder';
import { parseAgentMarkdownStrict } from '../settings/agentManifestParse';
import { appPathService } from '../runtime/AppPathService';
vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }));
vi.mock('../runtime/resolveConfiguredShell', () => ({ resolveConfiguredShell: () => { throw new Error('Offline fixed environment'); } }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: { readSessionShellCwd: () => null } }));
const model = 'offline-fixture';
const headSources = new Map<string, string>();
let headSkillFiles: string[] | undefined;
let baselineHead: string;
function source(file: string, version: 'before' | 'after'): string {
  if (version === 'after') return readFileSync(file, 'utf8');
  if (!headSources.has(file)) headSources.set(file, execFileSync('git', ['show', baselineHead + ':' + file], { encoding: 'utf8' }));
  return headSources.get(file)!;
}
function plan(version: 'before' | 'after', id: string, extra: string[] = []) {
  const profileFile = 'resources/agent-runtime/agents/' + id + '.agent.md';
  const profile = parseAgentMarkdownStrict(source(profileFile, version), path.resolve(profileFile), id, '2026-09-09', true);
  if (!profile.ok) throw new Error(profile.reason);
  const files = version === 'before' ? (headSkillFiles ??= execFileSync('git', ['ls-tree', '-r', '--name-only', baselineHead, 'resources/agent-runtime/skills'], { encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('/SKILL.md'))) : readdirSync('resources/agent-runtime/skills').map(id => 'resources/agent-runtime/skills/' + id + '/SKILL.md');
  const catalog = files.map(file => {
    const parsed = source(file, version).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)!;
    const metadata = parseYaml(parsed[1]) as { name: string; description: string };
    return { id: file.split('/').at(-2)!, name: metadata.name, description: metadata.description, allowedTools: [], scope: 'builtin' as const, sourcePath: file, sourceHash: version, effectiveStatus: 'effective' as const, instructions: parsed[2] };
  });
  const ids = new Set([...profile.definition.skills, ...extra]);
  const preloaded = catalog.filter(skill => ids.has(skill.id));
  return new PromptPlanBuilder().build({
    profile: profile.definition,
    scopedInstructions: { sources: [], totalBytes: 0, diagnostics: [] },
    preloadedSkills: preloaded,
    skillCatalog: catalog, tools: ['read_file', 'search', 'shell', 'plan_artifact', 'skill_read', 'artifact_read'], workDir: 'C:/qa/inline-code',
    routeCapability: { providerId: 'deepseek', modelId: model, toolCallingMode: 'native-structured', reasoningVisibility: 'none', reasoningDelivery: 'none',
      reasoningContract: { semantic: 'raw', source: 'deepseek-reasoning-content', displayLabel: 'Raw reasoning', carrier: 'reasoning-content',
        artifactFormat: 'deepseek.reasoning-content', artifactVersion: 'v1', compatibilityGroup: 'comparison', continuation: 'exact-execution' },
      supportsStreaming: true, supportsToolResults: true, toolCallingEvidence: 'supported', toolCallingUnverified: false,
      visionInputMode: 'disabled', structuredOutputMode: 'native' },
    permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
    currentDate: '2026-09-09', timeZone: 'Asia/Shanghai',
  });
}


describe('offline complete PromptPlan comparison', () => {
  it('measures identical task settings with HEAD core/profile/catalog/methods versus working tree, no provider', { timeout: 30000 }, () => {
    headSources.clear(); headSkillFiles = undefined;
    baselineHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-prompt-cost-'));
    mkdirSync(path.join(root, 'prompts'));
    for (const file of ['identity-collaboration.md', 'agent-loop.md', 'tool-evidence.md', 'completion.md']) writeFileSync(path.join(root, 'prompts', file), source('resources/agent-runtime/prompts/' + file, 'before'));
    const rootSpy = vi.spyOn(appPathService, 'getBuiltinAgentRuntimeRoot');
    try {
      const cases = [ { task: '聊天问答', id: 'general', extra: [] }, { task: '轻量 coding', id: 'general', extra: [] },
        { task: 'Debugger 规划', id: 'debugger', extra: [] }, { task: 'Analyzer 规划', id: 'analyzer', extra: [] }, { task: 'Optimizer 规划', id: 'optimizer', extra: [] },
        { task: 'General 调查执行', id: 'general', extra: ['renderdoc-execution', 'debugger-causal-method', 'rdc-tool-shell'] } ];
      const rows = cases.map(test => {
        rootSpy.mockReturnValue(root); const before = plan('before', test.id, test.extra);
        rootSpy.mockReturnValue(path.resolve('resources/agent-runtime')); const after = plan('after', test.id, test.extra);
        expect(after.segments.some(segment => segment.kind === 'skill-catalog')).toBe(true);
        expect(after.segments.some(segment => segment.kind === 'tool-capability')).toBe(true);
        if (test.id === 'general' && !test.extra.length) {
          const resident = after.segments.filter(segment => ['core-contract', 'agent-profile', 'preloaded-skill'].includes(segment.kind)).map(segment => segment.content).join('\n');
          expect(resident).not.toMatch(/RDC|RenderDoc|Checkpoint/);
          expect(resident).toContain('When this turn is executing an approved Mission plan');
          expect(resident).toContain('General finishes in place');
        }
        return { ...test, beforeChars: before.systemPrompt.length, afterChars: after.systemPrompt.length, deltaChars: after.systemPrompt.length - before.systemPrompt.length,
          beforeEstimatedTokens: before.totalTokenEstimate, afterEstimatedTokens: after.totalTokenEstimate, segments: after.segments.map(segment => ({ id: segment.id, chars: segment.content.length })) };
      });
      const report = { baseline: baselineHead, note: 'HEAD is historical baseline, not the start of this phase. Full system PromptPlan with identical tools and empty external context; estimates are not billed tokens. No LLM requests.', rows };
      console.info(JSON.stringify(report));
      if (process.env.RDC_AGENT_OFFLINE_COST_OUTPUT) writeFileSync(process.env.RDC_AGENT_OFFLINE_COST_OUTPUT, JSON.stringify(report, null, 2));
    } finally { rootSpy.mockRestore(); rmSync(root, { recursive: true, force: true }); }
  });
});
