import { sessionRecordStore } from '../sessions/store/sessionStores';
import { debuggerLlmService } from '../agent-runtime/context/DebuggerLlmService';
import type { RunContextUsageReadResult, RunContextUsageRequest } from '@shared/types/session';

export function readRunContextUsage(request: RunContextUsageRequest): RunContextUsageReadResult {
  if (!sessionRecordStore.readSession(request.sessionId)) {
    return { usage: null, stale: false };
  }
  return debuggerLlmService.getSessionContextUsage(request);
}
