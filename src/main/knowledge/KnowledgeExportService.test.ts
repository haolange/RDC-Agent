import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';
import { KNOWLEDGE_PACKAGE_SCHEMA } from '@shared/types/knowledgeExport';
import { ingestKnowledge } from './knowledgeIngest';
import { KnowledgeExportService, isExportable, toPackageCard } from './KnowledgeExportService';

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

function createService(cards: KnowledgeCardDetail[]) {
  const written = new Map<string, string>();
  const service = new KnowledgeExportService({
    getCard: async (spaceId, relativePath) => (
      cards.find((card) => card.spaceId === spaceId && card.relativePath === relativePath) ?? null
    ),
    listCards: async (spaceId) => cards
      .filter((card) => card.spaceId === spaceId)
      .map((card) => ({ spaceId: card.spaceId, relativePath: card.relativePath })),
    writeFile: async (targetPath, contents) => {
      written.set(targetPath, contents);
    },
  });
  return { service, written };
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

  it('writes a package whose cards survive a round trip back through import', async () => {
    const { service, written } = createService([detail()]);
    const result = await service.export({
      format: 'package',
      scope: 'space',
      spaceId: 'user',
      targetPath: 'C:/exports/knowledge.yaml',
    });

    expect(result.cardCount).toBe(1);
    expect(result.excludedCount).toBe(0);

    const contents = written.get('C:/exports/knowledge.yaml') ?? '';
    const parsed = parseYaml(contents) as { schema: string; cards: Array<{ title: string }> };
    expect(parsed.schema).toBe(KNOWLEDGE_PACKAGE_SCHEMA);
    expect(parsed.cards[0].title).toBe('Material sampling triage');

    const reimported = ingestKnowledge(contents, { spaceId: 'user' });
    expect(reimported.status).toBe('draft');
    // A package can claim any lifecycle; re-import always lands unverified.
    expect(reimported.verified).toBe(false);
    expect(reimported.candidateCreated).toBe(false);
    expect(reimported.record?.lifecycle).toBe('draft');
    expect(reimported.record?.title).toBe('Material sampling triage');
    expect(reimported.record?.body).toBe('# Material sampling triage\n\nBody.');
    expect(reimported.record?.relativePath).toBe('cases/aird-1.md');
  });

  it('reports a duplicate cardId through the existing conflict path', async () => {
    const { service, written } = createService([detail()]);
    await service.export({
      format: 'package',
      scope: 'space',
      spaceId: 'user',
      targetPath: 'C:/exports/knowledge.yaml',
    });
    const contents = written.get('C:/exports/knowledge.yaml') ?? '';

    const conflict = ingestKnowledge(contents, {
      spaceId: 'user',
      existingCaseIds: ['user:cases/aird-1.md'],
    });
    expect(conflict.status).toBe('conflict');
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
      targetPath: 'C:/exports/knowledge.yaml',
    });
    expect(result.cardCount).toBe(1);
    expect(result.excludedCount).toBe(1);
  });

  it('writes readable markdown that is not a package', async () => {
    const { service, written } = createService([detail()]);
    await service.export({
      format: 'markdown',
      scope: 'selected',
      cardRefs: [{ spaceId: 'user', relativePath: 'cases/aird-1.md' }],
      targetPath: 'C:/exports/knowledge.md',
    });
    const contents = written.get('C:/exports/knowledge.md') ?? '';
    expect(contents).toContain('# Material sampling triage');
    expect(contents).not.toContain(KNOWLEDGE_PACKAGE_SCHEMA);
  });

  it('fails closed on a relative target path and on an empty selection', async () => {
    const { service } = createService([detail()]);
    await expect(service.export({
      format: 'package',
      scope: 'selected',
      cardRefs: [{ spaceId: 'user', relativePath: 'cases/aird-1.md' }],
      targetPath: 'relative/knowledge.yaml',
    })).rejects.toThrow('KNOWLEDGE_EXPORT_TARGET_INVALID');

    await expect(service.export({
      format: 'package',
      scope: 'selected',
      cardRefs: [],
      targetPath: 'C:/exports/knowledge.yaml',
    })).rejects.toThrow('KNOWLEDGE_EXPORT_EMPTY_SELECTION');
  });
});
