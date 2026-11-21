import type { KnowledgeLifecycle } from '@shared/types/knowledge';
import type { KnowledgeWriteAction } from './knowledgeCenterModel';

export type KnowledgeCardAction = KnowledgeWriteAction | 'create-candidate';

export interface KnowledgeCardActions {
  /** The one step this card is waiting for; null when nothing moves it forward. */
  primary: KnowledgeCardAction | null;
  /** Everything else that is possible, behind 「⋯」. */
  more: KnowledgeWriteAction[];
}

/**
 * One primary action per lifecycle: a draft is submitted as a candidate, a candidate under review is kept as a draft,
 * a stored candidate is verified, a verified card is promoted. Actions that would not change the card are not offered.
 */
export function knowledgeCardActions(lifecycle: KnowledgeLifecycle | undefined, reviewing: boolean): KnowledgeCardActions {
  if (lifecycle === 'draft' && !reviewing) return { primary: 'create-candidate', more: [] };
  const primary: KnowledgeWriteAction = reviewing ? 'persist-draft'
    : lifecycle === 'candidate' ? 'promote-verified'
      : lifecycle === 'verified' ? 'promote-promoted'
        : 'save';
  const possible: KnowledgeWriteAction[] = [
    ...(lifecycle === 'verified' || lifecycle === 'promoted' ? [] : ['promote-verified' as const]),
    ...(lifecycle === 'promoted' ? [] : ['promote-promoted' as const]),
    ...(reviewing ? [] : ['save' as const]),
    ...(lifecycle === 'retired' ? [] : ['retire' as const]),
  ];
  return { primary, more: possible.filter((action) => action !== primary) };
}
