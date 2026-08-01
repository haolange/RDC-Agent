import type { RunContextUsageReadResult, RunContextUsageRequest } from '@shared/types/session';
import { storageAdapter } from '../sessions/StorageAdapter';
import { debuggerLlmService } from '../settings/DebuggerLlmService';

export function readRunContextUsage(request: RunContextUsageRequest): RunContextUsageReadResult {
  if (!storageAdapter.readSession(request.sessionId)) {
    return { usage: null, stale: false };
  }
  return debuggerLlmService.getSessionContextUsage(request);
}
