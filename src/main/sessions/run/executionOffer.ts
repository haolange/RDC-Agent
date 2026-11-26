export interface ExecutionOfferPlanRef {
  uri: string;
  hash: string;
}

export interface ExecutionOffer {
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
