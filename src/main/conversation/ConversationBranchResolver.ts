/**
 * Re-export shared conversation branch resolver for main-process call sites.
 * Source of truth: `@shared/conversation/conversationBranchResolver`.
 */
export {
  createDefaultBranchState,
  findForkForMessage,
  findForkForVisibleUserMessage,
  getConcreteForkBranches,
  getForkNavigator,
  normalizeBranchId,
  repairConversationBranchState,
  resolveVisibleConversationMessages,
  shouldShowForkNavigatorForMessage,
} from '@shared/conversation/conversationBranchResolver';
