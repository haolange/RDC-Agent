import type { KnowledgeCardRecord } from '@shared/types/knowledge';
import type { KnowledgeExportFormat } from '@shared/types/knowledgeExport';

/**
 * YAML knowledge package carried inside a zip together with declared images.
 * It is the only export format that can be imported again. Markdown export is
 * for reading and is not re-importable.
 */
export const KNOWLEDGE_PACKAGE_SCHEMA = 'rdc.knowledge-package/1';

export const KNOWLEDGE_EXPORT_EXTENSION: Record<KnowledgeExportFormat, string> = { package: 'zip', markdown: 'md' };

/**
 * Card fields carried by a package. Machine-local provenance (`sourceHash`,
 * `sourceMtimeMs`, `sourceSize`) and absolute paths are always stripped, so a
 * package never asserts anything about the exporting machine.
 */
export interface KnowledgePackageCard {
  cardId: string;
  relativePath: string;
  type: KnowledgeCardRecord['type'];
  /** Retained as metadata only. Re-import always lands as a session draft. */
  lifecycle: KnowledgeCardRecord['lifecycle'];
  title: string;
  scope: KnowledgeCardRecord['scope'];
  relations: KnowledgeCardRecord['relations'];
  body: string;
  sourceStatus?: string;
  caseId?: string;
  chapters?: KnowledgeCardRecord['chapters'];
  images?: KnowledgeCardRecord['images'];
}

export interface KnowledgePackage {
  schema: typeof KNOWLEDGE_PACKAGE_SCHEMA;
  exportedAt: string;
  cards: KnowledgePackageCard[];
}
