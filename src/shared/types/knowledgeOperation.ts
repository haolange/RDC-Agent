/**
 * A long Knowledge Center task (import, export, index rebuild) that the renderer follows and can cancel. The renderer
 * names each run with its own `operationId`; main reports progress under that id and cancels it on request.
 */
export const KNOWLEDGE_OPERATION_PHASES = ['reading', 'writing', 'indexing'] as const;
export type KnowledgeOperationPhase = (typeof KNOWLEDGE_OPERATION_PHASES)[number];

export interface KnowledgeOperationRef {
  operationId: string;
}

/** `done` of `total` items finished in `phase`; phases run in the order listed and `done` never goes back. */
export interface KnowledgeOperationProgress extends KnowledgeOperationRef {
  phase: KnowledgeOperationPhase;
  done: number;
  total: number;
}
