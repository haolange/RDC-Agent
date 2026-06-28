export const ROOT_BRANCH_ID = 'branch-root';

export interface ConversationBranch {
  branchId: string;
  parentBranchId: string | null;
  variantIndex: number;
  /** 该 variant 在分叉点的 user message id。 */
  anchorUserMessageId: string;
  rootTurnId: string;
}

export interface ConversationFork {
  forkId: string;
  anchorMessageId: string;
  activeBranchId: string;
  branches: ConversationBranch[];
}

export interface ConversationBranchState {
  sessionId: string;
  rootBranchId: string;
  activeLeafBranchId: string;
  forks: ConversationFork[];
}

export interface ConversationSwitchBranchRequest {
  sessionId: string;
  forkId: string;
  branchId: string;
}

export interface ConversationSwitchBranchResult {
  success: boolean;
  messages: import('./conversation').ConversationMessage[];
  branchState?: ConversationBranchState;
  tracePresentation?: import('./agenticTrace').AgentRunPresentation | null;
  error?: string;
}

export interface ConversationHistoryResult {
  messages: import('./conversation').ConversationMessage[];
  branchState?: ConversationBranchState | null;
}
