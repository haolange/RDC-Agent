import type { RdxRuntimeContext } from '@shared/types/session';

let currentRuntimeContext: RdxRuntimeContext | null = null;

export function setRdxRuntimeContext(runtimeContext: RdxRuntimeContext | null): void {
  currentRuntimeContext = runtimeContext ? { ...runtimeContext, raw: { ...runtimeContext.raw } } : null;
}

export function getRdxRuntimeContext(): RdxRuntimeContext | null {
  return currentRuntimeContext ? { ...currentRuntimeContext, raw: { ...currentRuntimeContext.raw } } : null;
}
