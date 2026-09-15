export const EXECUTION_OFFER_SCHEMA = '1' as const;

export interface ExecutionOfferPlanRef {
  uri: string;
  hash: string;
}

export interface ExecutionOffer {
  schemaVersion: typeof EXECUTION_OFFER_SCHEMA;
  sourceAgentId: string;
  targetAgentId: string;
  plan: ExecutionOfferPlanRef;
  requiredSkillIds: string[];
  label: string;
  prompt: string;
  approvedAt: number;
}

export interface CompletionArtifactRef {
  uri: string;
  hash: string;
}
