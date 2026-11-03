/**
 * Session-layer service exports.
 * Instantiating rdcSessionService here breaks the ConversationService ↔ index.ts cycle.
 */

import { RdcSessionService } from '../rdc/RdcSessionService';

export { RdcSessionService } from '../rdc/RdcSessionService';
export { storageAdapter } from './store/StorageAdapter';

export const rdcSessionService = new RdcSessionService();
