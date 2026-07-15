import { ipcRenderer } from 'electron';
import type { ConversationApi } from '@shared/types/electron-api';
import { registerTrackedListener, removeTrackedListener } from './listeners';

export const createConversationApi = (): ConversationApi => ({
  sendMessage: (request): ReturnType<ConversationApi['sendMessage']> =>
    ipcRenderer.invoke('conversation:sendMessage', request),
  rewriteFromMessage: (request): ReturnType<ConversationApi['rewriteFromMessage']> =>
    ipcRenderer.invoke('conversation:rewriteFromMessage', request),
  cancelActiveTurn: (request): ReturnType<ConversationApi['cancelActiveTurn']> =>
    ipcRenderer.invoke('conversation:cancelActiveTurn', request),
  answerUserInput: (request): ReturnType<ConversationApi['answerUserInput']> =>
    ipcRenderer.invoke('conversation:answerUserInput', request),
  answerToolApproval: (request): ReturnType<ConversationApi['answerToolApproval']> =>
    ipcRenderer.invoke('conversation:answerToolApproval', request),
  getHistory: (sessionId): ReturnType<ConversationApi['getHistory']> =>
    ipcRenderer.invoke('conversation:getHistory', sessionId),
  switchBranch: (request): ReturnType<ConversationApi['switchBranch']> =>
    ipcRenderer.invoke('conversation:switchBranch', request),
  clearHistory: (sessionId): ReturnType<ConversationApi['clearHistory']> =>
    ipcRenderer.invoke('conversation:clearHistory', sessionId),
  undoLastTurn: (sessionId): ReturnType<ConversationApi['undoLastTurn']> =>
    ipcRenderer.invoke('conversation:undoLastTurn', sessionId),
  compactHistory: (sessionId): ReturnType<ConversationApi['compactHistory']> =>
    ipcRenderer.invoke('conversation:compactHistory', sessionId),
  onEvent: (callback): void => {
    registerTrackedListener('conversation:event', callback as unknown as (...args: unknown[]) => void);
  },
  offEvent: (callback): void => {
    removeTrackedListener('conversation:event', callback as unknown as (...args: unknown[]) => void);
  },
});
