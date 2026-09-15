import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { PromptPlanBuilder } from '../agent-runtime/prompt/PromptPlanBuilder';
import { parseAgentMarkdownStrict } from '../settings/agentManifestParse';

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd() } }));
vi.mock('../runtime/resolveConfiguredShell', () => ({ resolveConfiguredShell: () => { throw new Error('Text-only comparison'); } }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: { readSessionShellCwd: () => null } }));

const output = process.env.RDC_AGENT_LIVE_COST_OUTPUT;
const enabled = process.env.RDC_AGENT_LIVE_COST_REQUESTS === '2' && !!output && !!process.env.DEEPSEEK_API_KEY;
const model = 'deepseek-flash';
const userMessage = '请解释并给出这个 JavaScript 函数的最小修正，不需操作文件：function sumFirst(xs, n) { let sum = 0; for (let i = 0; i <= n; i++) sum += xs[i]; return sum; }。约定 n 是要相加的元素个数，0 <= n <= xs.length；请给出 n=0 和 n=xs.length 的两个边界例子。回答简短。';

function source(file: string, version: 'before' | 'after'): string {
  return version === 'before' ? execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
}
function plan(version: 'before' | 'after', id: string) {
  const profileFile = 'resources/agent-runtime/agents/' + id + '.agent.md';
  const profile = parseAgentMarkdownStrict(source(profileFile, version), path.resolve(profileFile), id, '2026-09-09', true);
  if (!profile.ok) throw new Error(profile.reason);
  const skillId = id === 'general' ? 'execution-orchestrator' : id + '-coordinator';
  const skillFile = 'resources/agent-runtime/skills/' + skillId + '/SKILL.md';
  const skill = source(skillFile, version).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!skill) throw new Error('Missing skill frontmatter');
  const metadata = parseYaml(skill[1]) as { name: string; description: string };
  return new PromptPlanBuilder().build({
    profile: profile.definition,
    scopedInstructions: { sources: [], totalBytes: 0, diagnostics: [] },
    preloadedSkills: [{ id: skillId, name: metadata.name, description: metadata.description, allowedTools: [],
      scope: 'builtin', sourcePath: skillFile, sourceHash: version, effectiveStatus: 'effective', instructions: skill[2] }],
    skillCatalog: [], tools: [], workDir: 'C:/qa/inline-code',
    routeCapability: { providerId: 'deepseek', modelId: model, toolCallingMode: 'text-only', reasoningVisibility: 'none', reasoningDelivery: 'none',
      reasoningContract: { semantic: 'raw', source: 'deepseek-reasoning-content', displayLabel: 'Raw reasoning', carrier: 'reasoning-content',
        artifactFormat: 'deepseek.reasoning-content', artifactVersion: 'v1', compatibilityGroup: 'comparison', continuation: 'exact-execution' },
      supportsStreaming: true, supportsToolResults: true, toolCallingEvidence: 'supported', toolCallingUnverified: false,
      visionInputMode: 'disabled', structuredOutputMode: 'native' },
    permissionSettings: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] },
    currentDate: '2026-09-09', timeZone: 'Asia/Shanghai',
  });
}

describe.skipIf(!enabled)('explicit two-request instruction cost comparison', () => {
  it('uses production PromptPlan with identical controls, never retries or exceeds two requests', { timeout: 180_000 }, async () => {
    mkdirSync(output!, { recursive: true });
    const budgetFile = path.join(output!, 'request-budget.json');
    const metrics = ['general', 'debugger', 'analyzer', 'optimizer'].map((id) => ({
      id, beforeChars: plan('before', id).systemPrompt.length, afterChars: plan('after', id).systemPrompt.length,
    }));
    writeFileSync(path.join(output!, 'prompt-metrics.json'), JSON.stringify(metrics, null, 2));
    for (const version of ['before', 'after'] as const) {
      const resultFile = path.join(output!, version + '.json');
      if (existsSync(resultFile)) continue; // Re-inspection must not spend another request.
      const used = existsSync(budgetFile) ? Number(JSON.parse(readFileSync(budgetFile, 'utf8')).used) : 0;
      if (!Number.isInteger(used) || used < 0 || used >= 2) throw new Error('Live request budget exhausted; no retry.');
      writeFileSync(budgetFile, JSON.stringify({ used: used + 1 })); // Charge before network, including uncertain failures.
      const promptPlan = plan(version, 'general');
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: promptPlan.systemPrompt }, { role: 'user', content: userMessage }],
          max_tokens: 700, temperature: 0, thinking: { type: 'disabled' }, stream: false }),
        signal: AbortSignal.timeout(75_000),
      });
      if (!response.ok) throw new Error('DeepSeek HTTP ' + response.status + '; no retry.');
      const body = await response.json() as { id: string; usage: { prompt_tokens: number; completion_tokens: number }; choices: Array<{ finish_reason: string; message: { content: string } }> };
      writeFileSync(resultFile, JSON.stringify({ version, model, promptPlan, userMessage, ...body }, null, 2));
      expect(body.usage.prompt_tokens).toBeGreaterThan(0);
      expect(body.choices[0]?.finish_reason).toBe('stop');
      expect(body.choices[0]?.message.content.length).toBeGreaterThan(0);
    }
    console.info('Two-request comparison artifacts:', output);
  });
});
