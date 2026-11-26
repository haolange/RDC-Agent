import { AppError } from '@shared/errors/appError';
import { parseInvestigationPlanContract } from './investigationPlanContract';
import type { InvestigationPlanContract } from './investigationPlanContract';
import type { ExecutionOffer } from './executionOffer';

/** Old approved plans remain readable, but cannot claim the newer Mission completion contract. */
export function approvedInvestigationContract(
  offer: ExecutionOffer,
  markdown: string,
): InvestigationPlanContract | null {
  const contract = parseInvestigationPlanContract(markdown);
  const mission = ['debugger', 'analyzer', 'optimizer'].includes(offer.sourceAgentId) ? offer.sourceAgentId : null;
  if (mission && (!contract || contract.mission !== mission)) {
    throw new AppError(
      'APPROVED_PLAN_REVIEW_REQUIRED',
      'the historical Mission plan lacks a matching execution contract; return to the Mission and approve a current plan.',
    );
  }
  return contract;
}
