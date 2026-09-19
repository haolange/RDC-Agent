import type { RdxCliInvokerSettings } from '@shared/types/settings';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { parseRdxNativeResult } from '../tools/RdxNativeProtocol';

/** Read the owning daemon's actual progress; unavailable status never fabricates a stage. */
export async function withRdxOpenProgress<T>(contextId: string, cli: RdxCliInvokerSettings,
  onStage: ((stage: 'opening' | 'transferring') => void) | undefined, operation: () => Promise<T>): Promise<T> {
  if (!onStage) return operation();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const poll = async () => {
    while (!finished) {
      try {
        const result = parseRdxNativeResult(await rdxCliInvokerService.executeCLI('daemon', ['status', '--daemon-context', contextId], {
          contextId, timeout: 5000, settings: cli,
        }));
        const state = result.data.state as Record<string, unknown> | undefined;
        const active = state?.active_operation as Record<string, unknown> | undefined;
        if (!finished && result.result_kind === 'rdx.daemon.status' && state?.context_id === contextId) {
          if (active?.stage === 'capture_transfer_started' || active?.stage === 'capture_transfer_progress') onStage('transferring');
          else if (active?.stage === 'capture_transfer_done' || active?.stage === 'capture_open_done') onStage('opening');
        }
      } catch { /* Open's canonical action result remains the lifecycle authority. */ }
      if (!finished) await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 250); });
    }
  };
  const polling = poll();
  try { return await operation(); }
  finally { finished = true; if (timer) clearTimeout(timer); wake?.(); await polling; }
}
