import { describe, expect, it } from 'vitest';
import type { RequestPlan } from '@shared/types/providerCapability';
import { shouldAnnounceContinuationDrop } from './ConversationContinuationNotice';

describe('shouldAnnounceContinuationDrop', () => {
  const next = {
    providerId: 'openai',
    effectiveModelId: 'gpt-5.6-sol',
    adapterId: 'openai-responses',
    catalogRevision: 'catalog',
    routeRevision: 'route',
    route: { protocol: 'OpenAIResponses' },
  } as RequestPlan;

  it('stays silent when the previous turn used the same provider model and protocol', () => {
    expect(shouldAnnounceContinuationDrop({
      providerId: 'openai',
      adapterId: next.adapterId,
      selectedModelId: 'gpt-5.6-sol',
      effectiveModelId: 'gpt-5.6-sol',
      protocol: next.route.protocol,
      catalogRevision: next.catalogRevision,
      routeRevision: next.routeRevision,
      bindingIds: [],
    }, next)).toBe(false);
  });

  it('announces a drop when the effective model or protocol changes', () => {
    expect(shouldAnnounceContinuationDrop({
      providerId: 'openai',
      adapterId: next.adapterId,
      selectedModelId: 'gpt-5.6-terra',
      effectiveModelId: 'gpt-5.6-terra',
      protocol: next.route.protocol,
      catalogRevision: next.catalogRevision,
      routeRevision: next.routeRevision,
      bindingIds: [],
    }, next)).toBe(true);
  });
});
