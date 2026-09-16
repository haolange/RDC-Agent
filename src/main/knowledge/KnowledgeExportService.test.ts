import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';
import { KNOWLEDGE_PACKAGE_SCHEMA } from '@shared/types/knowledgeExport';
import { ingestKnowledge, ingestKnowledgeFromPath } from './knowledgeIngest';
import { KnowledgeExportService, isExportable, toPackageCard } from './KnowledgeExportService';
import {
  KNOWLEDGE_PACKAGE_MANIFEST,
  unzipKnowledgeFiles,
  utf8FromZip,
} from './knowledgeZip';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function absoluteTarget(name: string): string {
  return path.join(tempRoot('rdc-know-export-'), name);
}

function detail(overrides: Partial<KnowledgeCardDetail> = {}): KnowledgeCardDetail {
  return {
    cardId: 'user:cases/aird-1.md',
    spaceId: 'user',
    relativePath: 'cases/aird-1.md',
    title: 'Material sampling triage',
    content: '# Material sampling triage\n\nBody.',
    body: '# Material sampling triage\n\nBody.',
    scope: { platform: 'Android', api: 'Vulkan' },
    relations: [],
    type: 'case',
    lifecycle: 'verified',
    caseId: 'aird-1',
    sourceStatus: 'fixed',
    updatedAt: Date.parse('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(
  cards: KnowledgeCardDetail[],
  images: Map<string, Uint8Array> = new Map(),
) {
  const written = new Map<string, Uint8Array>();
  const service = new KnowledgeExportService({
    getCard: async (spaceId, relativePath) => (
      cards.find((card) => card.spaceId === spaceId && card.relativePath === relativePath) ?? null
    ),
    listCards: async (spaceId) => cards
      .filter((card) => card.spaceId === spaceId)
      .map((card) => ({ spaceId: card.spaceId, relativePath: card.relativePath })),
    readImage: async (_spaceId, relativePath) => images.get(relativePath) ?? null,
    writeBytes: async (targetPath, contents) => {
      written.set(targetPath, contents);
    },
  });
  return { service, written };
}

function packageFiles(bytes: Uint8Array): Map<string, Uint8Array> {
  return unzipKnowledgeFiles(bytes);
}

function packageYaml(bytes: Uint8Array): string {
  return utf8FromZip(packageFiles(bytes).get(KNOWLEDGE_PACKAGE_MANIFEST)!);
}

describe('KnowledgeExportService', () => {
  it('strips machine-local provenance from a package card', () => {
    const card = toPackageCard(detail());
    expect(card).not.toHaveProperty('sourceHash');
    expect(card).not.toHaveProperty('sourceMtimeMs');
    expect(card).not.toHaveProperty('sourceSize');
    expect(card).not.toHaveProperty('updatedAt');
    expect(card).not.toHaveProperty('spaceId');
  });

  it('refuses to export a card that still carries a secret or an absolute path', () => {
    expect(isExportable(detail())).toBe(true);
    expect(isExportable(detail({ body: 'api_key: abc123' }))).toBe(false);
    expect(isExportable(detail({ body: 'See C:\\Users\\me\\capture.rdc' }))).toBe(false);
  });

  it('writes a zip whose yaml and images survive a round trip back through import', async () => {
    const imagePath = 'cases/aird-1/observed.png';
    const targetPath = absoluteTarget('knowledge.zip');
    const { service, written } = createService(
      [detail({ images: [{ relativePath: imagePath, role: 'observed' }] })],
      new Map([[imagePath, PNG_1X1]]),
    );
    const result = await service.export({
      format: 'package',
      scope: 'space',
      spaceId: 'user',
      targetPath,
    });

    expect(result.cardCount).toBe(1);
    expect(result.excludedCount).toBe(0);

    const zip = written.get(targetPath);
    expect(zip).toBeDefined();
    const files = packageFiles(zip!);
    expect(files.has(KNOWLEDGE_PACKAGE_MANIFEST)).toBe(true);
    expect(Buffer.from(files.get(imagePath)!).equals(PNG_1X1)).toBe(true);

    const parsed = parseYaml(packageYaml(zip!)) as {
      schema: string;
      cards: Array<{ title: string; images?: Array<{ relativePath: string }> }>;
    };
    expect(parsed.schema).toBe(KNOWLEDGE_PACKAGE_SCHEMA);
    expect(parsed.cards[0].title).toBe('Material sampling triage');
    expect(parsed.cards[0].images).toEqual([{ relativePath: imagePath, role: 'observed' }]);

    writeFileSync(targetPath, zip!);
    const reimported = await ingestKnowledgeFromPath(targetPath, { spaceId: 'user' });
    expect(reimported.items).toHaveLength(1);
    expect(reimported.items[0]?.status).toBe('draft');
    expect(reimported.verified).toBe(false);
    expect(reimported.candidateCreated).toBe(false);
    expect(reimported.items[0]?.record?.lifecycle).toBe('draft');
    expect(reimported.items[0]?.record?.title).toBe('Material sampling triage');
    expect(reimported.items[0]?.record?.body).toBe('# Material sampling triage\n\nBody.');
    expect(reimported.items[0]?.record?.relativePath).toBe('cases/aird-1.md');
    expect(reimported.items[0]?.missingAssets).toEqual([]);
    expect(reimported.stagedImagesByCardId?.get('user:cases/aird-1.md')?.[0]?.relativePath).toBe(imagePath);
  });

  it('omits missing images from the exported yaml instead of declaring them', async () => {
    const targetPath = absoluteTarget('knowledge.zip');
    const { service, written } = createService([
      detail({ images: [{ relativePath: 'cases/aird-1/observed.png', role: 'observed' }] }),
    ]);
    await service.export({
      format: 'package',
      scope: 'space',
      spaceId: 'user',
      targetPath,
    });
    const parsed = parseYaml(packageYaml(written.get(targetPath)!)) as {
      cards: Array<{ images?: unknown }>;
    };
    expect(parsed.cards[0]?.images).toBeUndefined();
    expect(packageFiles(written.get(targetPath)!).has('cases/aird-1/observed.png')).toBe(false);
  });

  it('reports a duplicate cardId through the existing conflict path', async () => {
    const targetPath = absoluteTarget('knowledge.zip');
    const { service, written } = createService([detail()]);
    await service.export({
      format: 'package',
      scope: 'space',
      spaceId: 'user',
      targetPath,
    });
    const conflict = ingestKnowledge(packageYaml(written.get(targetPath)!), {
      spaceId: 'user',
      existingCaseIds: ['user:cases/aird-1.md'],
    });
    expect(conflict.items[0]?.status).toBe('conflict');
    expect(conflict.verified).toBe(false);
  });

  it('excludes unsafe cards instead of exporting them', async () => {
    const { service } = createService([
      detail(),
      detail({ cardId: 'user:cases/aird-2.md', relativePath: 'cases/aird-2.md', body: 'password: hunter2' }),
    ]);
    const result = await service.export({
      format: 'package',
      scope: 'space',
      spaceId: 'user',
      targetPath: absoluteTarget('knowledge.zip'),
    });
    expect(result.cardCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });

  it('writes readable markdown that is not a package and cannot be re-imported', async () => {
    const targetPath = absoluteTarget('knowledge.md');
    const { service, written } = createService([detail()]);
    await service.export({
      format: 'markdown',
      scope: 'selected',
      cardRefs: [{ spaceId: 'user', relativePath: 'cases/aird-1.md' }],
      targetPath,
    });
    const contents = new TextDecoder().decode(written.get(targetPath));
    expect(contents).toContain('# Material sampling triage');
    expect(contents).not.toContain(KNOWLEDGE_PACKAGE_SCHEMA);
    const reimported = ingestKnowledge(contents, { spaceId: 'user' });
    expect(reimported.items[0]?.status).toBe('quarantine');
    expect(reimported.items[0]?.reason).toBe('yaml-broken');
  });

  it('fails closed on a relative target path and on an empty selection', async () => {
    const { service } = createService([detail()]);
    await expect(service.export({
      format: 'package',
      scope: 'selected',
      cardRefs: [{ spaceId: 'user', relativePath: 'cases/aird-1.md' }],
      targetPath: 'relative/knowledge.zip',
    })).rejects.toThrow('KNOWLEDGE_EXPORT_TARGET_INVALID');

    await expect(service.export({
      format: 'package',
      scope: 'selected',
      cardRefs: [],
      targetPath: absoluteTarget('knowledge.zip'),
    })).rejects.toThrow('KNOWLEDGE_EXPORT_EMPTY_SELECTION');
  });
});
