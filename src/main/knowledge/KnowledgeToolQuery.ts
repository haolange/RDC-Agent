import {
  KNOWLEDGE_CARD_TYPES, KNOWLEDGE_LIFECYCLES, KNOWLEDGE_RETRIEVAL_LANES, KNOWLEDGE_SCOPE_AXES,
  type KnowledgeQueryRequest, type KnowledgeScope,
} from '@shared/types/knowledge';

const stringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
};

const scopeProperties = Object.fromEntries(KNOWLEDGE_SCOPE_AXES.map(axis => [axis, { type: 'string' }]));
export const knowledgeQueryProperties = {
  query: { type: 'string', description: 'All word terms must match. An empty result applies only to the current query and filters; try individual terms or browse a selected space if needed.' },
  spaceIds: { type: 'array', items: { type: 'string' }, description: 'Exact space IDs returned by knowledge_browse; omit to search all accessible spaces.' },
  type: { type: 'array', items: { type: 'string', enum: [...KNOWLEDGE_CARD_TYPES] } },
  lifecycle: { type: 'array', items: { type: 'string', enum: [...KNOWLEDGE_LIFECYCLES] } },
  lanes: { type: 'array', items: { type: 'string', enum: [...KNOWLEDGE_RETRIEVAL_LANES] } },
  cardId: { type: 'string' },
  relativePath: { type: 'string' },
  relationTargetCardId: { type: 'string' },
  scope: { type: 'object', additionalProperties: false, properties: {
    ...scopeProperties,
    exclusions: { type: 'object', additionalProperties: false, properties: Object.fromEntries(
      KNOWLEDGE_SCOPE_AXES.map(axis => [axis, { type: 'array', items: { type: 'string' } }]),
    ) },
  } },
  asOf: { type: 'number', minimum: 0 },
};

export function toKnowledgeQueryRequest(args: Record<string, unknown>, paginate = false): KnowledgeQueryRequest {
  const request: KnowledgeQueryRequest = {};
  const text = typeof args.query === 'string' ? args.query.trim() : '';
  if (text) request.text = text;
  const spaces = stringArray(args.spaceIds); if (spaces) request.spaceIds = spaces;
  const types = stringArray(args.type)?.filter((value): value is typeof KNOWLEDGE_CARD_TYPES[number] => (KNOWLEDGE_CARD_TYPES as readonly string[]).includes(value));
  if (types?.length) request.type = types;
  const lifecycles = stringArray(args.lifecycle)?.filter((value): value is typeof KNOWLEDGE_LIFECYCLES[number] => (KNOWLEDGE_LIFECYCLES as readonly string[]).includes(value));
  if (lifecycles?.length) request.lifecycle = lifecycles;
  const lanes = stringArray(args.lanes)?.filter((value): value is typeof KNOWLEDGE_RETRIEVAL_LANES[number] => (KNOWLEDGE_RETRIEVAL_LANES as readonly string[]).includes(value));
  if (lanes?.length) request.lanes = lanes;
  for (const key of ['cardId', 'relativePath', 'relationTargetCardId'] as const) {
    if (typeof args[key] === 'string' && args[key].trim()) request[key] = args[key].trim();
  }
  if (args.scope && typeof args.scope === 'object' && !Array.isArray(args.scope)) request.scope = args.scope as KnowledgeScope;
  if (typeof args.asOf === 'number') request.asOf = args.asOf;
  if (paginate) {
    request.offset = typeof args.offset === 'number' ? args.offset : 0;
    request.limit = typeof args.limit === 'number' ? args.limit : 20;
    if (typeof args.expectedRevision === 'string' && args.expectedRevision.trim()) request.expectedRevision = args.expectedRevision.trim();
  }
  return request;
}
