import type { KnowledgeCardRecord } from './knowledge';

/**
 * Single-file YAML knowledge package. It is the only export format that can be
 * imported again; Markdown export is for reading and is not re-importable.
 */
export const KNOWLEDGE_PACKAGE_SCHEMA = 'rdc.knowledge-package/1';

export const KNOWLEDGE_EXPORT_FORMATS = ['package', 'markdown'] as const;
export type KnowledgeExportFormat = (typeof KNOWLEDGE_EXPORT_FORMATS)[number];

export const KNOWLEDGE_EXPORT_SCOPES = ['selected', 'filtered', 'space'] as const;
export type KnowledgeExportScope = (typeof KNOWLEDGE_EXPORT_SCOPES)[number];

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

export interface KnowledgeExportRequest {
  format: KnowledgeExportFormat;
  scope: KnowledgeExportScope;
  /** Absolute destination chosen through the native save dialog. */
  targetPath: string;
  /** `selected` scope: exactly these cards. */
  cardRefs?: Array<{ spaceId: string; relativePath: string }>;
  /** `space` scope: every card in this space. */
  spaceId?: string;
}

export interface KnowledgeExportResult {
  /** Cards actually written. */
  cardCount: number;
  /** Cards dropped because they still carried a secret or an absolute path. */
  excludedCount: number;
  bytes: number;
  targetPath: string;
}
