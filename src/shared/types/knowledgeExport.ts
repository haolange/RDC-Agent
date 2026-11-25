export const KNOWLEDGE_EXPORT_FORMATS = ['package', 'markdown'] as const;
export type KnowledgeExportFormat = (typeof KNOWLEDGE_EXPORT_FORMATS)[number];

export const KNOWLEDGE_EXPORT_SCOPES = ['selected', 'filtered', 'space'] as const;
export type KnowledgeExportScope = (typeof KNOWLEDGE_EXPORT_SCOPES)[number];

export interface KnowledgeExportRequest {
  format: KnowledgeExportFormat;
  scope: KnowledgeExportScope;
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
