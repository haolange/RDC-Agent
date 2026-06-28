import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('./register-ts-source.cjs');

const {
  resolveVisibleConversationMessages,
  createDefaultBranchState,
} = require('../src/main/conversation/ConversationBranchResolver.ts');
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

console.log('[conversation-branch] OK');
