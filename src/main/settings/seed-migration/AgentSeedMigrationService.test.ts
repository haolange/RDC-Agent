import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from '../../sessions/StorageIo';
import { serializeAgentMarkdown } from '../agentManifestParse';
import {
  AgentSeedMigrationService,
  SEED_MIGRATION_RULE_VERSION,
  SEED_PURGE_ISOLATION_DIR_NAME,
  SEED_PURGE_ISOLATION_MANIFEST_NAME,
  type SeedMigrationAction,
  type SeedMigrationMarker,
} from './AgentSeedMigrationService';
import YAML from 'yaml';
import { officialSeedHashIndex, OFFICIAL_SEED_GENERATIONS } from './officialSeedGenerations';
import {
  extractSeedSemanticManifest,
  hashCanonicalAgentSemantics,
  hashSeedSemanticManifest,
} from './semanticHash';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const BUILTIN_AGENTS = path.resolve(process.cwd(), 'resources', 'agent-runtime', 'agents');

const toDraft = (manifest: ReturnType<typeof extractSeedSemanticManifest>) => ({
  id: manifest.id,
  fileName: `${manifest.id}.agent.md`,
  name: manifest.name,
  description: manifest.description,
  argumentHint: manifest.argumentHint,
  target: manifest.target,
  models: manifest.models,
  icon: (manifest.icon ?? 'message-orbit') as 'message-orbit',
  accent: manifest.accent ?? '#33d1ff',
  disableModelInvocation: manifest.disableModelInvocation,
  userInvocable: manifest.userInvocable,
  tools: manifest.tools,
  skills: manifest.skills,
  mcpServers: manifest.mcpServers,
  agents: manifest.agents,
  handoffs: manifest.handoffs,
  metadata: manifest.metadata,
  instructions: manifest.instructions,
  enabled: manifest.enabled,
  ...(manifest.maxTurns ? { maxTurns: manifest.maxTurns } : {}),
});

const readBuiltinRaw = (id: string): string =>
  fs.readFileSync(path.join(BUILTIN_AGENTS, `${id}.agent.md`), 'utf8');

const actionsOf = (marker: SeedMigrationMarker | null, action: SeedMigrationAction) =>
  (marker?.actions ?? []).filter((entry) => entry.action === action);

function serializeOfficialSeedFixture(
  manifest: ReturnType<typeof extractSeedSemanticManifest>,
  frontmatterId: string,
): string {
  const frontmatter: Record<string, unknown> = {
    id: frontmatterId,
    name: manifest.name,
    description: manifest.description,
    'argument-hint': manifest.argumentHint,
    target: manifest.target,
    model: manifest.models,
    'disable-model-invocation': manifest.disableModelInvocation,
    'user-invocable': manifest.userInvocable,
    enabled: manifest.enabled,
    ...(manifest.maxTurns ? { 'max-turns': manifest.maxTurns } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    ...(manifest.accent ? { accent: manifest.accent } : {}),
    tools: manifest.tools,
    skills: manifest.skills,
    'mcp-servers': manifest.mcpServers,
    agents: manifest.agents,
    handoffs: manifest.handoffs,
    metadata: manifest.metadata,
  };
  return `---\n${YAML.stringify(frontmatter).trim()}\n---\n\n${manifest.instructions.trim()}\n`;
}

describe('seed semantic hash', () => {
  it('indexes every official generation without colliding across ids in the same generation', () => {
    const index = officialSeedHashIndex();
    expect(index.size).toBeGreaterThan(0);
    for (const generation of OFFICIAL_SEED_GENERATIONS) {
      const hashes = generation.manifests.map((manifest) => hashSeedSemanticManifest(manifest));
      expect(new Set(hashes).size).toBe(hashes.length);
    }
  });

  it('keeps full-hash indexing sensitive to model/icon/accent', () => {
    const official = OFFICIAL_SEED_GENERATIONS.at(-1)!.manifests.find((entry) => entry.id === 'ask')!;
    const modified = { ...official, models: ['openrouter/anthropic/claude-3-sonnet'] };
    expect(hashSeedSemanticManifest(modified)).not.toBe(hashSeedSemanticManifest(official));
    expect(officialSeedHashIndex().has(hashSeedSemanticManifest(modified))).toBe(false);
  });

  it('hashCanonicalAgentSemantics ignores only model/icon/accent and handoff.model', () => {
    const builtin = extractSeedSemanticManifest(readBuiltinRaw('general'), 'general');
    const baseline = hashCanonicalAgentSemantics(builtin);
    expect(hashCanonicalAgentSemantics({ ...builtin, models: ['openrouter/x'] })).toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, icon: 'spark' })).toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, accent: '#ff00aa' })).toBe(baseline);
    expect(hashCanonicalAgentSemantics({
      ...builtin,
      handoffs: builtin.handoffs.map((handoff) => ({ ...handoff, model: 'openrouter:x' })),
    })).toBe(baseline);

    expect(hashCanonicalAgentSemantics({ ...builtin, tools: [...builtin.tools, 'extra-tool'] })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, instructions: `${builtin.instructions}\nchanged` })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({
      ...builtin,
      handoffs: builtin.handoffs.map((handoff, index) => (
        index === 0 ? { ...handoff, agent: 'other-agent' } : handoff
      )),
    })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({
      ...builtin,
      handoffs: builtin.handoffs.map((handoff, index) => (
        index === 0 ? { ...handoff, prompt: 'changed prompt' } : handoff
      )),
    })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, metadata: { extra: true } })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, name: `${builtin.name} X` })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, skills: [...builtin.skills, 'extra'] })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({ ...builtin, agents: [...builtin.agents, 'extra'] })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({
      ...builtin,
      handoffs: builtin.handoffs.map((handoff, index) => (
        index === 0 ? { ...handoff, send: false } : handoff
      )),
    })).not.toBe(baseline);
    expect(hashCanonicalAgentSemantics({
      ...builtin,
      handoffs: [...builtin.handoffs].reverse(),
    })).not.toBe(baseline);
  });
});

describe('AgentSeedMigrationService v2', () => {
  it('purges historical ask/plan/edit even when the user rewrote the body', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-hist-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    await writeFile(path.join(root, 'ask.agent.md'), serializeAgentMarkdown({
      ...toDraft(s9Ask),
      instructions: 'I changed the official Ask seed on purpose',
    }), 'utf8');
    await writeFile(path.join(root, 'plan.agent.md'), serializeOfficialSeedFixture(
      OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'plan')!,
      'plan',
    ), 'utf8');
    await writeFile(path.join(root, 'edit.agent.md'), serializeAgentMarkdown({
      ...toDraft(s9Ask),
      id: 'edit',
      fileName: 'edit.agent.md',
      models: ['openrouter/x'],
    }), 'utf8');

    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.alreadyComplete).toBe(false);
    expect(result.marker?.schemaVersion).toBe('2');
    expect(result.marker?.ruleVersion).toBe(SEED_MIGRATION_RULE_VERSION);
    expect(actionsOf(result.marker, 'purged-historical').map((entry) => entry.filenameId).sort()).toEqual([
      'ask',
      'edit',
      'plan',
    ]);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'plan.agent.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'edit.agent.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });

  it('purges S0 specialist ids as purged-historical', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-s0-'));
    roots.push(root);
    const s0 = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's0')!.manifests
      .find((entry) => entry.id === 'triage_agent')!;
    await writeFile(
      path.join(root, 'triage-agent.agent.md'),
      serializeOfficialSeedFixture({ ...s0, id: 'triage-agent' }, 'triage-agent'),
      'utf8',
    );
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'purged-historical').some((entry) => entry.filenameId === 'triage-agent')).toBe(true);
    expect(fs.existsSync(path.join(root, 'triage-agent.agent.md'))).toBe(false);
  });

  it('purges builtin shadows that match current canonical hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-shadow-'));
    roots.push(root);
    await writeFile(path.join(root, 'general.agent.md'), readBuiltinRaw('general'), 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'purged-shadow').some((entry) => entry.filenameId === 'general')).toBe(true);
    expect(fs.existsSync(path.join(root, 'general.agent.md'))).toBe(false);
  });

  it('purges builtin copies that only differ in model/icon/accent/handoff.model', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-cosmetic-'));
    roots.push(root);
    let raw = readBuiltinRaw('general');
    raw = raw.replace('model: []', 'model:\n  - openrouter/x');
    raw = raw.replace('icon: nodes', 'icon: spark');
    raw = raw.replace('accent: "#33d1ff"', 'accent: "#ff00aa"');
    raw = raw.replace(
      '    prompt: Investigate the current failure, isolate the responsible component, and produce a verifiable plan.\n    send: true',
      '    prompt: Investigate the current failure, isolate the responsible component, and produce a verifiable plan.\n    model: openrouter:x\n    send: true',
    );
    await writeFile(path.join(root, 'general.agent.md'), raw, 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'purged-shadow').some((entry) => entry.filenameId === 'general')).toBe(true);
    expect(fs.existsSync(path.join(root, 'general.agent.md'))).toBe(false);
  });

  it('retains a builtin-id copy that differs in tools or instructions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-override-'));
    roots.push(root);
    const raw = `${readBuiltinRaw('debugger').trimEnd()}\n\nUser changed instructions.\n`;
    await writeFile(path.join(root, 'debugger.agent.md'), raw, 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'retained-override').some((entry) => entry.filenameId === 'debugger')).toBe(true);
    expect(fs.existsSync(path.join(root, 'debugger.agent.md'))).toBe(true);
  });

  it('retains unrelated custom ids', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-custom-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    await writeFile(path.join(root, 'my-custom.agent.md'), serializeAgentMarkdown({
      ...toDraft(s9Ask),
      id: 'my-custom',
      fileName: 'my-custom.agent.md',
      name: 'Custom',
      instructions: 'user owned',
    }), 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'retained-custom').some((entry) => entry.filenameId === 'my-custom')).toBe(true);
    await expect(readFile(path.join(root, 'my-custom.agent.md'), 'utf8')).resolves.toContain('user owned');
  });

  it('keeps filename/frontmatter mismatches as invalid-id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-mismatch-'));
    roots.push(root);
    const s0Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's0')!.manifests
      .find((entry) => entry.id === 'ask_agent')!;
    await writeFile(path.join(root, 'ask-agent.agent.md'), serializeOfficialSeedFixture(s0Ask, 'ask_agent'), 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'invalid-id').some((entry) => (
      entry.file === 'ask-agent.agent.md' && entry.filenameId === 'ask-agent' && entry.frontmatterId === 'ask_agent'
    ))).toBe(true);
    expect(result.diagnostics.some((entry) => entry.includes('SEED_MIGRATION_INVALID_ID'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ask-agent.agent.md'))).toBe(true);
  });

  it('treats a v1 marker as incomplete and rewrites it to v2', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-v1-'));
    roots.push(root);
    await writeFile(path.join(root, '.seed-migration.json'), JSON.stringify({
      schemaVersion: '1',
      completedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [],
      purged: [],
      retained: [{ id: 'ask', reason: 'user-modified', sourceHash: 'x' }],
    }), 'utf8');
    await writeFile(path.join(root, 'ask.agent.md'), serializeOfficialSeedFixture(
      OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!,
      'ask',
    ), 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.alreadyComplete).toBe(false);
    expect(result.marker?.schemaVersion).toBe('2');
    expect(actionsOf(result.marker, 'purged-historical').some((entry) => entry.filenameId === 'ask')).toBe(true);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(false);
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.seed-migration.json'), 'utf8')) as SeedMigrationMarker;
    expect(persisted.schemaVersion).toBe('2');
  });

  it('fail-closes a handwritten schemaVersion 3 marker and does not touch files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-v3-'));
    roots.push(root);
    const markerPath = path.join(root, '.seed-migration.json');
    await writeFile(markerPath, JSON.stringify({
      schemaVersion: '3',
      ruleVersion: 'future',
      directoryContentHash: 'nope',
      completedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [],
      actions: [],
    }), 'utf8');
    await writeFile(path.join(root, 'ask.agent.md'), '---\nname: Ask\n---\nkeep me\n', 'utf8');
    const before = fs.readFileSync(markerPath, 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.alreadyComplete).toBe(true);
    expect(result.marker).toBeNull();
    expect(result.diagnostics.some((entry) => entry.includes('SEED_MIGRATION_SCHEMA_UNSUPPORTED'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(true);
    expect(fs.readFileSync(markerPath, 'utf8')).toBe(before);
  });

  it('does not remove leftover .migrated when schemaVersion is 3', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-v3-migrated-'));
    roots.push(root);
    const markerPath = path.join(root, '.seed-migration.json');
    const migratedArchive = path.join(root, '.migrated', 's9', 'ask.agent.md');
    await mkdir(path.join(root, '.migrated', 's9'), { recursive: true });
    await writeFile(migratedArchive, 'stale archive\n', 'utf8');
    await writeFile(markerPath, JSON.stringify({
      schemaVersion: '3',
      ruleVersion: 'future',
      directoryContentHash: 'nope',
      completedAt: '2026-01-01T00:00:00.000Z',
      diagnostics: [],
      actions: [],
    }), 'utf8');
    await writeFile(path.join(root, 'ask.agent.md'), '---\nname: Ask\n---\nkeep me\n', 'utf8');
    const beforeMarker = fs.readFileSync(markerPath, 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.alreadyComplete).toBe(true);
    expect(result.marker).toBeNull();
    expect(result.diagnostics.some((entry) => entry.includes('SEED_MIGRATION_SCHEMA_UNSUPPORTED'))).toBe(true);
    expect(fs.existsSync(migratedArchive)).toBe(true);
    expect(fs.readFileSync(migratedArchive, 'utf8')).toBe('stale archive\n');
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'ask.agent.md'), 'utf8')).toContain('keep me');
    expect(fs.readFileSync(markerPath, 'utf8')).toBe(beforeMarker);
  });

  it('no-ops when a v2 marker exists and the directory hash is unchanged', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-noop-'));
    roots.push(root);
    await writeFile(path.join(root, 'my-custom.agent.md'), '---\nname: Custom\n---\nkeep\n', 'utf8');
    const first = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(first.alreadyComplete).toBe(false);
    const second = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(second.alreadyComplete).toBe(true);
    expect(second.marker?.directoryContentHash).toBe(first.marker?.directoryContentHash);
    expect(fs.existsSync(path.join(root, 'my-custom.agent.md'))).toBe(true);
  });

  it('re-evaluates new shadows but never deletes previously retained-override files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-reeval-'));
    roots.push(root);
    await writeFile(
      path.join(root, 'debugger.agent.md'),
      `${readBuiltinRaw('debugger').trimEnd()}\n\nUser override.\n`,
      'utf8',
    );
    const first = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(first.marker, 'retained-override').some((entry) => entry.file === 'debugger.agent.md')).toBe(true);

    await writeFile(path.join(root, 'general.agent.md'), readBuiltinRaw('general'), 'utf8');
    await writeFile(path.join(root, 'debugger.agent.md'), readBuiltinRaw('debugger'), 'utf8');
    const second = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(second.alreadyComplete).toBe(false);
    expect(actionsOf(second.marker, 'purged-shadow').some((entry) => entry.file === 'general.agent.md')).toBe(true);
    expect(fs.existsSync(path.join(root, 'general.agent.md'))).toBe(false);
    expect(actionsOf(second.marker, 'retained-override').some((entry) => entry.file === 'debugger.agent.md')).toBe(true);
    expect(fs.existsSync(path.join(root, 'debugger.agent.md'))).toBe(true);
  });

  it('restores isolated files when builtin verification fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-verify-'));
    roots.push(root);
    const missingBuiltins = path.join(root, 'missing-builtins');
    await mkdir(missingBuiltins, { recursive: true });
    await writeFile(path.join(root, 'ask.agent.md'), serializeOfficialSeedFixture(
      OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!,
      'ask',
    ), 'utf8');
    expect(() => new AgentSeedMigrationService(new StorageIo(), { builtinAgentsPath: missingBuiltins }).migrateUserAgents(root))
      .toThrow(/SEED_MIGRATION_VERIFY_FAILED/);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, SEED_PURGE_ISOLATION_MANIFEST_NAME))).toBe(false);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });

  it('fail-closes a corrupt isolation manifest without dropping unrelated files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-isol-'));
    roots.push(root);
    await writeFile(path.join(root, 'my-custom.agent.md'), '---\nname: Custom\n---\nkeep custom\n', 'utf8');
    await mkdir(path.join(root, SEED_PURGE_ISOLATION_DIR_NAME), { recursive: true });
    await writeFile(
      path.join(root, SEED_PURGE_ISOLATION_DIR_NAME, 'stranded.agent.md'),
      '---\nname: Stranded\n---\nrestore me\n',
      'utf8',
    );
    await writeFile(path.join(root, SEED_PURGE_ISOLATION_MANIFEST_NAME), '{not-json', 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.alreadyComplete).toBe(false);
    expect(result.marker).toBeNull();
    expect(result.diagnostics.some((entry) => entry.includes('SEED_MIGRATION_ISOLATION_CORRUPT'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'my-custom.agent.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(root, 'stranded.agent.md'))
      || fs.existsSync(path.join(root, SEED_PURGE_ISOLATION_DIR_NAME, 'stranded.agent.md')),
    ).toBe(true);
  });

  it('does not delete a source file when a live lock is held', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-lock-'));
    roots.push(root);
    const sourcePath = path.join(root, 'ask.agent.md');
    await writeFile(sourcePath, serializeOfficialSeedFixture(
      OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!,
      'ask',
    ), 'utf8');
    await writeFile(path.join(root, '.seed-migration.lock'), JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    }), 'utf8');
    expect(() => new AgentSeedMigrationService(new StorageIo(), { maxAttempts: 2 }).migrateUserAgents(root))
      .toThrow(/SEED_MIGRATION_LOCK_TIMEOUT/);
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain('Ask');
  });

  it('removes a leftover .migrated directory after a successful purge', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-leftover-'));
    roots.push(root);
    await mkdir(path.join(root, '.migrated', 's9'), { recursive: true });
    await writeFile(path.join(root, '.migrated', 's9', 'ask.agent.md'), 'stale archive\n', 'utf8');
    await writeFile(path.join(root, 'ask.agent.md'), serializeOfficialSeedFixture(
      OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!,
      'ask',
    ), 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(actionsOf(result.marker, 'purged-historical').some((entry) => entry.filenameId === 'ask')).toBe(true);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });

  it('restores the exact prior user file when explicit override ownership cannot be committed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-explicit-rollback-'));
    roots.push(root);
    const fileName = 'custom.agent.md';
    const filePath = path.join(root, fileName);
    const original = Buffer.from('---\nid: custom\nname: Original\n---\noriginal bytes\r\n', 'utf8');
    await writeFile(filePath, original);
    new AgentSeedMigrationService().migrateUserAgents(root);

    class FailingMarkerIo extends StorageIo {
      override writeJsonAtomic(): void {
        throw new Error('marker write failed');
      }
    }
    const service = new AgentSeedMigrationService(new FailingMarkerIo());
    expect(() => service.writeExplicitUserOverride(
      root,
      fileName,
      '---\nid: custom\nname: Replacement\n---\nreplacement\n',
    )).toThrow(/marker write failed/);
    expect(fs.readFileSync(filePath)).toEqual(original);
  });
});
