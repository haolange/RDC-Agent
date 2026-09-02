import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageIo } from '../../sessions/StorageIo';
import { serializeAgentMarkdown } from '../agentManifestParse';
import { AgentSeedMigrationService } from './AgentSeedMigrationService';
import YAML from 'yaml';
import { officialSeedHashIndex, OFFICIAL_SEED_GENERATIONS } from './officialSeedGenerations';
import { extractSeedSemanticManifest, hashSeedSemanticManifest } from './semanticHash';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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

describe('seed semantic hash', () => {
  it('indexes every official generation without colliding across ids in the same generation', () => {
    const index = officialSeedHashIndex();
    expect(index.size).toBeGreaterThan(0);
    for (const generation of OFFICIAL_SEED_GENERATIONS) {
      const hashes = generation.manifests.map((manifest) => hashSeedSemanticManifest(manifest));
      expect(new Set(hashes).size).toBe(hashes.length);
    }
  });

  it('treats model/icon/accent changes as user modifications', () => {
    const official = OFFICIAL_SEED_GENERATIONS.at(-1)!.manifests.find((entry) => entry.id === 'ask')!;
    const modified = { ...official, models: ['openrouter/anthropic/claude-3-sonnet'] };
    expect(hashSeedSemanticManifest(modified)).not.toBe(hashSeedSemanticManifest(official));
    expect(officialSeedHashIndex().has(hashSeedSemanticManifest(modified))).toBe(false);
  });
});

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

describe('AgentSeedMigrationService', () => {
  it('permanently purges unmodified official seeds and retains user-modified files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-mig-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    await writeFile(path.join(root, 'ask.agent.md'), serializeAgentMarkdown(toDraft(s9Ask)), 'utf8');
    const custom = serializeAgentMarkdown({
      ...toDraft(s9Ask),
      id: 'my-custom',
      fileName: 'my-custom.agent.md',
      name: 'Custom',
      instructions: 'user owned',
    });
    await writeFile(path.join(root, 'my-custom.agent.md'), custom, 'utf8');
    const modifiedOfficial = serializeAgentMarkdown({
      ...toDraft(s9Ask),
      id: 'edit',
      fileName: 'edit.agent.md',
      models: ['openrouter/x'],
    });
    await writeFile(path.join(root, 'edit.agent.md'), modifiedOfficial, 'utf8');

    const service = new AgentSeedMigrationService();
    const first = service.migrateUserAgents(root);
    expect(first.alreadyComplete).toBe(false);
    expect(first.marker.purged.some((entry) => entry.id === 'ask' && entry.generationId === 's9')).toBe(true);
    expect(first.marker.retained.some((entry) => entry.id === 'my-custom')).toBe(true);
    expect(first.marker.retained.some((entry) => entry.id === 'edit' && entry.reason === 'user-modified')).toBe(true);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
    await expect(readFile(path.join(root, 'my-custom.agent.md'), 'utf8')).resolves.toContain('user owned');
    await expect(readFile(path.join(root, 'edit.agent.md'), 'utf8')).resolves.toContain('openrouter/x');

    const second = service.migrateUserAgents(root);
    expect(second.alreadyComplete).toBe(true);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(false);
  });

  it('does not delete user files whose hash does not match an official seed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-keep-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    await writeFile(
      path.join(root, 'ask.agent.md'),
      serializeAgentMarkdown({
        ...toDraft(s9Ask),
        instructions: 'I changed the official Ask seed on purpose',
      }),
      'utf8',
    );
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.marker.purged).toEqual([]);
    expect(result.marker.retained.some((entry) => entry.id === 'ask' && entry.reason === 'user-modified')).toBe(true);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });

  it('restores isolated files when builtin verification fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-verify-'));
    roots.push(root);
    const missingBuiltins = path.join(root, 'missing-builtins');
    await mkdir(missingBuiltins, { recursive: true });
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    await writeFile(path.join(root, 'ask.agent.md'), serializeAgentMarkdown(toDraft(s9Ask)), 'utf8');
    expect(() => new AgentSeedMigrationService(new StorageIo(), { builtinAgentsPath: missingBuiltins }).migrateUserAgents(root))
      .toThrow(/SEED_MIGRATION_VERIFY_FAILED/);
    expect(fs.existsSync(path.join(root, 'ask.agent.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });

  it('retains the source when it changes between hash and isolate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-changed-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    const sourcePath = path.join(root, 'ask.agent.md');
    await writeFile(sourcePath, serializeAgentMarkdown(toDraft(s9Ask)), 'utf8');
    const original = fs.readFileSync;
    let sourceReads = 0;
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((file, encoding) => {
      const result = original.call(fs, file, encoding);
      if (String(file) === sourcePath) {
        sourceReads += 1;
        if (sourceReads === 1) {
          fs.writeFileSync(sourcePath, serializeAgentMarkdown({
            ...toDraft(s9Ask),
            instructions: 'user changed this after the first hash',
          }), 'utf8');
        }
      }
      return result as string;
    });
    try {
      const result = new AgentSeedMigrationService().migrateUserAgents(root);
      expect(result.marker.retained.some((entry) => entry.id === 'ask' && entry.reason === 'user-modified')).toBe(true);
      expect(result.marker.diagnostics.some((entry) => entry.includes('SEED_MIGRATION_SOURCE_CHANGED'))).toBe(true);
      expect(fs.existsSync(sourcePath)).toBe(true);
      expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not delete a source file when a live lock is held', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-lock-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    const sourcePath = path.join(root, 'ask.agent.md');
    await writeFile(sourcePath, serializeAgentMarkdown(toDraft(s9Ask)), 'utf8');
    await writeFile(path.join(root, '.seed-migration.lock'), JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    }), 'utf8');
    expect(() => new AgentSeedMigrationService(new StorageIo(), { maxAttempts: 2 }).migrateUserAgents(root))
      .toThrow(/SEED_MIGRATION_LOCK_TIMEOUT/);
    await expect(readFile(sourcePath, 'utf8')).resolves.toContain('Ask');
  });

  it('purges hyphen-filename S0 seeds whose frontmatter id matches the official underscore id', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-s0-hyphen-'));
    roots.push(root);
    const s0Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's0')!.manifests
      .find((entry) => entry.id === 'ask_agent')!;
    const raw = serializeOfficialSeedFixture(s0Ask, 'ask_agent');
    expect(hashSeedSemanticManifest(extractSeedSemanticManifest(raw, 'ask_agent')))
      .toBe(hashSeedSemanticManifest(s0Ask));
    await writeFile(path.join(root, 'ask-agent.agent.md'), raw, 'utf8');

    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.marker.purged.some((entry) => (
      entry.id === 'ask_agent' && entry.generationId === 's0'
    ))).toBe(true);
    expect(result.marker.retained.some((entry) => entry.id === 'ask-agent' || entry.id === 'ask_agent')).toBe(false);
    expect(fs.existsSync(path.join(root, 'ask-agent.agent.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });

  it('retains a hyphen-filename S0 seed after the user changes model, icon, or accent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-s0-modified-'));
    roots.push(root);
    const s0Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's0')!.manifests
      .find((entry) => entry.id === 'ask_agent')!;
    await writeFile(
      path.join(root, 'ask-agent.agent.md'),
      serializeOfficialSeedFixture({
        ...s0Ask,
        models: ['openrouter/anthropic/claude-3-sonnet'],
        icon: 'spark',
        accent: '#ff6a00',
      }, 'ask_agent'),
      'utf8',
    );
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.marker.purged).toEqual([]);
    expect(result.marker.retained.some((entry) => (
      (entry.id === 'ask_agent' || entry.id === 'ask-agent') && entry.reason === 'user-modified'
    ))).toBe(true);
    expect(fs.existsSync(path.join(root, 'ask-agent.agent.md'))).toBe(true);
  });

  it('removes a leftover .migrated directory after a successful purge', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-seed-leftover-'));
    roots.push(root);
    const s9Ask = OFFICIAL_SEED_GENERATIONS.find((entry) => entry.id === 's9')!.manifests.find((entry) => entry.id === 'ask')!;
    await mkdir(path.join(root, '.migrated', 's9'), { recursive: true });
    await writeFile(path.join(root, '.migrated', 's9', 'ask.agent.md'), 'stale archive\n', 'utf8');
    await writeFile(path.join(root, 'ask.agent.md'), serializeAgentMarkdown(toDraft(s9Ask)), 'utf8');
    const result = new AgentSeedMigrationService().migrateUserAgents(root);
    expect(result.marker.purged.some((entry) => entry.id === 'ask')).toBe(true);
    expect(fs.existsSync(path.join(root, '.migrated'))).toBe(false);
  });
});
