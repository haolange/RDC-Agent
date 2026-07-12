import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  resolveVisibleConversationMessages,
  createDefaultBranchState,
  repairConversationBranchState,
} = require('../src/shared/conversation/conversationBranchResolver.ts');
const { ROOT_BRANCH_ID } = require('../src/shared/types/conversationBranch.ts');

const fail = (message) => {
  console.error(`[conversation-branch] ${message}`);
  process.exit(1);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const now = 1_700_000_000_000;
const sessionId = 'sess-branch-smoke';

const branchState = createDefaultBranchState(sessionId);
const forkId = 'msg-user-1';
branchState.forks.push({
  forkId,
  anchorMessageId: 'msg-user-1',
  activeBranchId: 'branch-v2',
  branches: [
    {
      branchId: ROOT_BRANCH_ID,
      parentBranchId: null,
      variantIndex: 0,
      anchorUserMessageId: 'msg-user-1',
      rootTurnId: 'turn-1',
    },
    {
      branchId: 'branch-v2',
      parentBranchId: ROOT_BRANCH_ID,
      variantIndex: 1,
      anchorUserMessageId: 'msg-user-1b',
      rootTurnId: 'turn-2',
    },
  ],
});
branchState.activeLeafBranchId = 'branch-v2';

const allMessages = [
  {
    id: 'msg-user-1',
    turnId: 'turn-1',
    sessionId,
    projectId: 'proj-1',
    role: 'user',
    content: 'version one question',
    branchId: ROOT_BRANCH_ID,
    forkId,
    variantIndex: 0,
    createdAt: now,
  },
  {
    id: 'msg-assistant-1',
    turnId: 'turn-1',
    sessionId,
    projectId: 'proj-1',
    role: 'assistant',
    content: 'answer one',
    branchId: ROOT_BRANCH_ID,
    createdAt: now + 10,
  },
  {
    id: 'msg-user-2',
    turnId: 'turn-1b',
    sessionId,
    projectId: 'proj-1',
    role: 'user',
    content: 'follow up on v1',
    branchId: ROOT_BRANCH_ID,
    createdAt: now + 20,
  },
  {
    id: 'msg-assistant-2',
    turnId: 'turn-1b',
    sessionId,
    projectId: 'proj-1',
    role: 'assistant',
    content: 'follow up answer v1',
    branchId: ROOT_BRANCH_ID,
    createdAt: now + 30,
  },
  {
    id: 'msg-user-1b',
    turnId: 'turn-2',
    sessionId,
    projectId: 'proj-1',
    role: 'user',
    content: 'version two question',
    branchId: 'branch-v2',
    forkId,
    variantIndex: 1,
    createdAt: now + 40,
  },
  {
    id: 'msg-assistant-1b',
    turnId: 'turn-2',
    sessionId,
    projectId: 'proj-1',
    role: 'assistant',
    content: 'answer two',
    branchId: 'branch-v2',
    createdAt: now + 50,
  },
  {
    id: 'msg-user-2b',
    turnId: 'turn-2b',
    sessionId,
    projectId: 'proj-1',
    role: 'user',
    content: 'follow up on v2',
    branchId: 'branch-v2',
    createdAt: now + 60,
  },
  {
    id: 'msg-assistant-2b',
    turnId: 'turn-2b',
    sessionId,
    projectId: 'proj-1',
    role: 'assistant',
    content: 'follow up answer v2',
    branchId: 'branch-v2',
    createdAt: now + 70,
  },
];

const activeVisible = resolveVisibleConversationMessages(allMessages, branchState);
assert(activeVisible.map((message) => message.id).join(',') === [
  'msg-user-1b',
  'msg-assistant-1b',
  'msg-user-2b',
  'msg-assistant-2b',
].join(','), 'active branch path should exclude sibling downstream');

const corruptedBranchState = JSON.parse(JSON.stringify(branchState));
const corruptedBranch = corruptedBranchState.forks[0].branches.find((entry) => entry.branchId === 'branch-v2');
corruptedBranch.anchorUserMessageId = '';
corruptedBranch.rootTurnId = '';
const repaired = repairConversationBranchState(allMessages, corruptedBranchState);
assert(repaired.repaired, 'empty branch anchor/root should be repaired from the matching user turn');
assert(
  repaired.branchState.forks[0].branches.find((entry) => entry.branchId === 'branch-v2').anchorUserMessageId === 'msg-user-1b',
  'branch repair should restore anchorUserMessageId from the matching variant user message',
);
assert(
  repaired.branchState.forks[0].branches.find((entry) => entry.branchId === 'branch-v2').rootTurnId === 'turn-2',
  'branch repair should restore rootTurnId from the matching variant user message',
);
const repairedVisible = resolveVisibleConversationMessages(allMessages, repaired.branchState);
assert(repairedVisible.map((message) => message.id).join(',') === [
  'msg-user-1b',
  'msg-assistant-1b',
  'msg-user-2b',
  'msg-assistant-2b',
].join(','), 'repaired branch path should keep the rewritten user and paired assistant visible');

const unrecoverableBranchState = JSON.parse(JSON.stringify(branchState));
unrecoverableBranchState.forks[0].activeBranchId = 'branch-empty';
unrecoverableBranchState.activeLeafBranchId = 'branch-empty';
unrecoverableBranchState.forks[0].branches.push({
  branchId: 'branch-empty',
  parentBranchId: ROOT_BRANCH_ID,
  variantIndex: 2,
  anchorUserMessageId: '',
  rootTurnId: '',
});
const unrecoverable = repairConversationBranchState(allMessages, unrecoverableBranchState);
assert(!unrecoverable.repaired, 'unrecoverable branch must fail closed instead of fabricating anchors');
const unrecoverableVisible = resolveVisibleConversationMessages(allMessages, unrecoverable.branchState);
assert(unrecoverableVisible.map((message) => message.id).join(',') === ''.trim(), 'unrecoverable branch should not fabricate visible messages');

branchState.forks[0].activeBranchId = ROOT_BRANCH_ID;
branchState.activeLeafBranchId = ROOT_BRANCH_ID;
const restoredVisible = resolveVisibleConversationMessages(allMessages, branchState);
assert(restoredVisible.map((message) => message.id).join(',') === [
  'msg-user-1',
  'msg-assistant-1',
  'msg-user-2',
  'msg-assistant-2',
].join(','), 'switching branch should restore original downstream conversation');

assert(!restoredVisible.some((message) => message.content.includes('v2')), 'inactive branch messages must stay hidden');

const {
  shouldShowForkNavigatorForMessage,
  getConcreteForkBranches,
  findForkForVisibleUserMessage,
} = require('../src/shared/conversation/conversationBranchResolver.ts');

branchState.forks[0].activeBranchId = 'branch-v2';
branchState.activeLeafBranchId = 'branch-v2';
assert(
  shouldShowForkNavigatorForMessage(branchState, { id: 'msg-user-1b', forkId, role: 'user' }),
  'navigator must only render on the active variant user message',
);
assert(
  !shouldShowForkNavigatorForMessage(branchState, { id: 'msg-user-1', forkId, role: 'user' }),
  'navigator must not render on inactive sibling variants',
);
assert(
  getConcreteForkBranches(branchState.forks[0]).length === 2,
  'navigator totals must only count branches with concrete anchors',
);
assert(
  findForkForVisibleUserMessage(branchState, { id: 'msg-user-1b', forkId, role: 'user' })?.forkId === forkId,
  'visible user messages must resolve to their own fork without cross-matching',
);

const fs = require('node:fs');
const path = require('node:path');
const mainShim = fs.readFileSync(
  path.join(process.cwd(), 'src/main/conversation/ConversationBranchResolver.ts'),
  'utf8',
);
assert(
  mainShim.includes('@shared/conversation/conversationBranchResolver')
    && !mainShim.includes('export function resolveVisibleConversationMessages'),
  'main ConversationBranchResolver must re-export shared resolver only (no dual implementation)',
);
const conversationService = fs.readFileSync(
  path.join(process.cwd(), 'src/main/conversation/ConversationService.ts'),
  'utf8',
);
assert(
  conversationService.includes('sessionContextJournal.append')
    && conversationService.includes('visibleTurnIds')
    && conversationService.includes('await Promise.allSettled')
    && conversationService.includes('Failed to persist conversation snapshot')
    && conversationService.includes('settleStopped()'),
  'rewriteFromMessage must await stopped turns, materialize journal context, settle stop, and classify persistence failures',
);
const stopImplementation = conversationService.match(/stop:\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\n\s*\}\);/)?.[1] ?? '';
const awaitStoppedIndex = conversationService.indexOf('await Promise.allSettled(turnsToStop.map((turn) => turn.stopped))');
assert(
  awaitStoppedIndex >= 0
    && conversationService.indexOf('const history = storageAdapter.readConversationHistory(sessionId);', awaitStoppedIndex) > awaitStoppedIndex
    && conversationService.includes('this.clearActiveTurn(assistantMessage.turnId, abortController);\n      settleStopped();')
    && !stopImplementation.includes('settleStopped()')
    && !stopImplementation.includes('clearActiveTurn('),
  'stopped must resolve only after completeProfileTurn cleanup, and rewrite must re-read history after awaiting it',
);
assert(
  conversationService.includes('turnHadAskPause')
    && conversationService.includes('resolveStreamingOutputPhase')
    && conversationService.includes('syncVisibleResponseForStreaming'),
  'assistant loops must stamp streaming outputPhase and gate bubble writes after ask pauses',
);
const conversationStore = fs.readFileSync(
  path.join(process.cwd(), 'src/renderer/stores/conversationStore.ts'),
  'utf8',
);
assert(
  conversationStore.includes('allConversationMessages')
    && conversationStore.includes('resolveVisibleConversationMessages'),
  'renderer conversationStore must project visible messages from branchState',
);

console.log('[conversation-branch] OK');
