/**
 * Knowledge Center browse contract.
 * Read-only projection over scoped `knowledge/` markdown trees.
 * No generation engine, write API, or prompt injection in this surface.
 */

export type KnowledgeSpaceKind = 'user' | 'project';

export interface KnowledgeSpace {
  spaceId: string;
  kind: KnowledgeSpaceKind;
  label: string;
  rootPath: string;
  projectId?: string;
}

export interface KnowledgeCardSummary {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  preview?: string;
  updatedAt?: number;
}

export interface KnowledgeCardDetail extends KnowledgeCardSummary {
  content: string;
}
