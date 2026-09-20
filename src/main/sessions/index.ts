/**
 * Session-layer service exports.
 * Instantiating rdcSessionService here breaks the ConversationService ↔ index.ts cycle.
 */

import { RdcSessionService } from './RdcSessionService';

export { RdcSessionService } from './RdcSessionService';
export { storageAdapter } from './StorageAdapter';

export const rdcSessionService = new RdcSessionService();
