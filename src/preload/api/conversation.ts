import { ipcRenderer } from 'electron';
import type { ConversationStreamEvent } from '@shared/types/conversation';
import type { ConversationApi } from '@shared/types/electron-api';
import { registerTrackedListener, removeTrackedListener } from './listeners';

export const createConversationApi = (): ConversationApi => ({
  sendMessage: (request): ReturnType<ConversationApi['sendMessage']> =>
    ipcRenderer.invoke('conversation:sendMessage', request),
  cancelActiveTurn: (request): ReturnType<ConversationApi['cancelActiveTurn']> =>
    ipcRenderer.invoke('conversation:cancelActiveTurn', request),
  answerUserInput: (request): ReturnType<ConversationApi['answerUserInput']> =>
    ipcRenderer.invoke('conversation:answerUserInput', request),
  answerToolApproval: (request): ReturnType<ConversationApi['answerToolApproval']> =>
    ipcRenderer.invoke('conversation:answerToolApproval', request),
  getHistory: (sessionId): ReturnType<ConversationApi['getHistory']> =>
    ipcRenderer.invoke('conversation:getHistory', sessionId),
  onEvent: (callback): void => {
    registerTrackedListener('conversation:event', (payload) => callback(payload as ConversationStreamEvent));
  },
  offEvent: (callback): void => {
    removeTrackedListener('conversation:event', callback as unknown as (...args: unknown[]) => void);
  },
});
