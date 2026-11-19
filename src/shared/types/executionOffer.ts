export const EXECUTION_OFFER_SCHEMA = '1' as const;

export interface ExecutionOfferPlanRef {
  uri: string;
  hash: string;
}

export interface ExecutionOffer {
  schemaVersion: typeof EXECUTION_OFFER_SCHEMA;
  /** Identity of this explicit offer; absent on older saved offers. */
  offerId?: string;
  sourceAgentId: string;
  targetAgentId: string;
  plan: ExecutionOfferPlanRef;
  requiredSkillIds: string[];
  requiredToolIds?: string[];
  label: string;
  prompt: string;
  approvedAt: number;
}

export interface CompletionArtifactRef {
  uri: string;
  hash: string;
}
