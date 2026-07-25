/**
 * Session-layer service exports.
 * Instantiating rdxSessionService here breaks the ConversationService ↔ index.ts cycle.
 */

import { RdxSessionService } from './RdxSessionService';

export { RdxSessionService } from './RdxSessionService';
export { storageAdapter } from './StorageAdapter';

export const rdxSessionService = new RdxSessionService();
