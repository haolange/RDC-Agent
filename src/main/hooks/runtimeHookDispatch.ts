import type { HookEvent } from '@shared/types/rdcRuntime';
import { appPathService } from '../runtime/AppPathService';
import { hookEngine, type HookContext, type HookExecutionResult } from './HookEngine';

export async function runRuntimeHooks(
  event: HookEvent,
  context: Omit<HookContext, 'event'>,
): Promise<HookExecutionResult[]> {
  hookEngine.load(appPathService.getUserRdcPaths().hooksPath, context.projectRoot);
  return hookEngine.trigger(event, { ...context, event });
}

export async function dispatchRuntimeHooks(
  event: HookEvent,
  context: Omit<HookContext, 'event'>,
): Promise<boolean> {
  const results = await runRuntimeHooks(event, context);
  return results.every((result) => result.allowed);
}
