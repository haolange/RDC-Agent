import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } }));
import { AgentManifestService } from './AgentManifestService';
import { AGENT_MANIFEST_FIELD_MOVED } from './agentManifestParse';
import { planAgentModelFieldMigration } from './agentModelFieldMigration';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-model-resolution-'));
  roots.push(root);
  return { agentsPath: path.join(root, 'agents'), instructionsPath: path.join(root, 'RDC.md') };
};

it('resolves every builtin from Settings: default first, then a per-Agent field', () => {
  const paths = workspace();
  const service = new AgentManifestService();
  expect(service.resolveEffectiveSnapshot(paths).profiles.find((profile) => profile.id === 'debugger')).toMatchObject({
    compiledRoute: { agentId: 'debugger', providerId: '', modelId: '' },
    modelSource: 'none',
  });

  service.bindAgentModelSettings(() => ({
    default: { model: 'chatgpt-account:gpt-6.1-sol', reasoningLevel: 'medium' },
    byAgent: { verifier: { model: 'openai:gpt-small' } },
  }));
  const profiles = service.resolveEffectiveSnapshot(paths).profiles;
  for (const id of [
    'analyzer',
    'debugger',
    'general',
    'optimizer',
    'generator',
    'knowledge-scout',
    'pass-analyst',
    'pixel-analyst',
    'report-writer',
    'resource-analyst',
    'shader-analyst',
  ]) {
    expect(profiles.find((profile) => profile.id === id)).toMatchObject({
      provenance: { scope: 'builtin' },
      compiledRoute: { agentId: id, providerId: 'chatgpt-account', modelId: 'gpt-6.1-sol' },
      reasoningLevel: 'medium',
      modelSource: 'default',
    });
  }
  expect(profiles.find((profile) => profile.id === 'verifier')).toMatchObject({
    compiledRoute: { providerId: 'openai', modelId: 'gpt-small' },
    reasoningLevel: 'medium',
    modelSource: 'agent',
    accessCeiling: 'read-only',
  });
});

it('records the builtin a copy was taken from and reports when the builtin moved on', async () => {
  const paths = workspace();
  const service = new AgentManifestService();
  const builtin = service.resolveEffectiveSnapshot(paths).profiles.find((profile) => profile.id === 'general')!;
  const saved = await service.saveDefinition(
    paths,
    { ...builtin, instructions: `${builtin.instructions}\nExtra.` },
    { scope: 'user' },
  );
  const file = path.join(paths.agentsPath, 'general.agent.md');
  expect(fs.readFileSync(file, 'utf8')).toContain(`based-on: ${builtin.provenance.sourceHash}`);
  expect(saved.definition).toMatchObject({
    provenance: { scope: 'user' },
    builtinUpdate: { status: 'current', builtinSourceHash: builtin.provenance.sourceHash },
  });

  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(builtin.provenance.sourceHash, 'f'.repeat(64)));
  service.revalidate();
  expect(
    service.resolveEffectiveSnapshot(paths).profiles.find((profile) => profile.id === 'general')?.builtinUpdate?.status,
  ).toBe('updated');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^based-on: .*\n/mu, ''));
  service.revalidate();
  expect(
    service.resolveEffectiveSnapshot(paths).profiles.find((profile) => profile.id === 'general')?.builtinUpdate?.status,
  ).toBe('unknown-base');
  expect(service.readBuiltinComparison(paths, 'general').overrideContent).toContain('Extra.');
});

it('keeps an override that still declares a model inactive and migrates it without touching the body', () => {
  const paths = workspace();
  fs.mkdirSync(paths.agentsPath, { recursive: true });
  const file = path.join(paths.agentsPath, 'general.agent.md');
  const legacy = [
    '---',
    'name: General',
    'tools: [read, search]',
    'model:',
    '  - chatgpt-account:gpt-6.1-sol',
    'reasoning-level: high',
    '# reviewed handoffs',
    'handoffs:',
    '  - label: Verify',
    '    agent: verifier',
    '    prompt: Check it.',
    '    model: openai:gpt-small',
    '---',
    'Body stays as written.',
    '',
  ].join('\n');
  fs.writeFileSync(file, legacy);
  const service = new AgentManifestService();
  const snapshot = service.resolveEffectiveSnapshot(paths);
  expect(snapshot.profiles.find((profile) => profile.id === 'general')?.provenance.scope).toBe('builtin');
  expect(snapshot.diagnostics).toContainEqual(
    expect.objectContaining({ code: AGENT_MANIFEST_FIELD_MOVED, agentId: 'general', scope: 'user' }),
  );
  expect(service.resolveDiagnosedOverride(paths, file, AGENT_MANIFEST_FIELD_MOVED)).toMatchObject({
    agentId: 'general',
    scope: 'user',
  });
  expect(() =>
    service.resolveDiagnosedOverride(paths, path.join(paths.agentsPath, 'other.agent.md'), AGENT_MANIFEST_FIELD_MOVED),
  ).toThrow('AGENT_OVERRIDE_NOT_DIAGNOSED');

  const plan = planAgentModelFieldMigration(legacy);
  expect(plan.binding).toEqual({ model: 'chatgpt-account:gpt-6.1-sol', reasoningLevel: 'high' });
  expect(plan.droppedHandoffModels).toEqual([{ label: 'Verify', agent: 'verifier', model: 'openai:gpt-small' }]);
  expect(plan.content).toContain('# reviewed handoffs\nhandoffs:');
  expect(plan.content).toContain('\ntools: [read, search]\n');
  expect(plan.content).not.toMatch(/model:|reasoning-level:/u);
  expect(plan.content.endsWith('---\nBody stays as written.\n')).toBe(true);
});

it('rejects atomic replacement failure and preserves the previously committed bytes', async () => {
  const paths = workspace();
  const service = new AgentManifestService();
  const builtin = service.resolveEffectiveSnapshot(paths).profiles.find((profile) => profile.id === 'general')!;
  const initial = await service.saveDefinition(paths, { ...builtin }, { scope: 'user' });
  const filename = path.join(paths.agentsPath, 'general.agent.md');
  const before = fs.readFileSync(filename);
  const original = fs.promises.rename;
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
    if (to === filename) throw new Error('injected atomic replace failure');
    return original(from, to);
  });
  const sourceHash = initial.definition!.provenance!.sourceHash;
  await expect(
    service.saveDefinition(paths, { ...builtin, name: 'Renamed', sourceHash }, { scope: 'user', sourceHash }),
  ).rejects.toThrow('injected atomic replace failure');
  expect(fs.readFileSync(filename)).toEqual(before);
});
