export const EMBEDDING_PROTOCOLS = ['OpenAICompatibleEmbeddings'] as const;

export type EmbeddingProtocol = (typeof EMBEDDING_PROTOCOLS)[number];

export type EmbeddingOperationBuilderId = 'openai-embeddings';

export interface EmbeddingAdapterImplementation {
  protocols: readonly EmbeddingProtocol[];
  operationBuilderId: EmbeddingOperationBuilderId;
  transport: 'http';
}

/**
 * Closed registry for embedding adapters. Independent from Agent chat adapters.
 * Manifest facts stay in JSON; transport mechanics stay in TypeScript.
 */
export const EMBEDDING_ADAPTER_IMPLEMENTATIONS = {
  'openai-compatible-embeddings': {
    protocols: ['OpenAICompatibleEmbeddings'],
    operationBuilderId: 'openai-embeddings',
    transport: 'http',
  },
} as const satisfies Record<string, EmbeddingAdapterImplementation>;

export type EmbeddingAdapterId = keyof typeof EMBEDDING_ADAPTER_IMPLEMENTATIONS;

export const EMBEDDING_ADAPTER_IDS = Object.freeze(
  Object.keys(EMBEDDING_ADAPTER_IMPLEMENTATIONS) as EmbeddingAdapterId[],
);

export function getEmbeddingAdapterImplementation(
  adapterId: string,
): EmbeddingAdapterImplementation | undefined {
  return EMBEDDING_ADAPTER_IMPLEMENTATIONS[adapterId as EmbeddingAdapterId];
}

export function embeddingAdapterSupportsProtocol(
  adapterId: string,
  protocol: EmbeddingProtocol,
): boolean {
  return getEmbeddingAdapterImplementation(adapterId)?.protocols.includes(protocol) === true;
}
