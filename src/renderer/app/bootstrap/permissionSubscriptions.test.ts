import { afterEach, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import { subscribePermissionState } from './permissionSubscriptions';
import { useRuntimePermissionStore as store } from '../../stores/runtimePermissionStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';

afterEach(() => { store.setState({ snapshot: null, pendingMode: null, error: false }); useWorkflowStore.getState().reset(); });

it('subscribes before the query and ignores its older response and updates after disposal', async () => {
  store.setState({ snapshot: null });
  const order: string[] = [];
  let listener!: (state: RuntimePermissionState) => void;
  let resolve!: (state: RuntimePermissionState) => void;
  const pending = new Promise<RuntimePermissionState>(yes => { resolve = yes; });
  const unsubscribe = vi.fn();
  const api = {
    events: { onPermissionStateChanged: (fn: typeof listener) => { order.push('subscribe'); listener = fn; return unsubscribe; } },
    runtime: { getPermissionState: () => { order.push('query'); return pending; } },
  } as unknown as ElectronAPI;
  const dispose = subscribePermissionState(api);
  expect(order).toEqual(['subscribe', 'query']);
  useWorkflowStore.getState().setTracePresentation(presentation());
  listener({ mode: 'full-access', revision: 2 });
  expect(useWorkflowStore.getState().tracePresentation?.rightPanel.context.task.permission).toBe('full-access');
  resolve({ mode: 'default', revision: 1 });
  await pending;
  expect(store.getState().snapshot).toEqual({ mode: 'full-access', revision: 2 });
  dispose();
  listener({ mode: 'custom', revision: 3 });
  expect(store.getState().snapshot?.revision).toBe(2);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

function presentation(): AgentRunPresentation {
  return { projectId: 'p', sessionId: 'active-chat', activeBranchId: 'main', profileId: 'general', updatedAt: '2026-10-30T00:00:00Z', runs: [], rawAuditRefs: [], rightPanel: {
    progress: [], artifacts: { rows: [], totalCount: 0, storeDegraded: false }, outputs: { current: [], previous: [] },
    context: { task: { projectId: 'p', projectName: 'p', sessionId: 'active-chat', sessionTitle: 'chat', workingDirectory: '.', configurationPhase: 'current_turn', agentProfile: 'general', permission: 'default', resources: [] },
      rdc: { capture: null, availableCaptures: [], runtime: {}, diagnostics: [] } },
  } };
}

it('overlays current permission when an older asynchronous rail projection arrives after the change event', async () => {
  store.setState({ snapshot: { mode: 'default', revision: 1 } });
  const staleProjection = presentation();
  useWorkflowStore.getState().setTracePresentation(staleProjection);
  let deliver!: (value: AgentRunPresentation) => void;
  const deferredProjection = new Promise<AgentRunPresentation>(resolve => { deliver = resolve; });
  const applyProjection = deferredProjection.then(value => useWorkflowStore.getState().setTracePresentation(value));
  let listener!: (state: RuntimePermissionState) => void;
  const api = {
    events: { onPermissionStateChanged: (fn: typeof listener) => { listener = fn; return vi.fn(); } },
    runtime: { getPermissionState: async () => ({ mode: 'default', revision: 1 }) },
  } as unknown as ElectronAPI;
  const dispose = subscribePermissionState(api);
  listener({ mode: 'full-access', revision: 2 });
  expect(useWorkflowStore.getState().tracePresentation?.rightPanel.context.task.permission).toBe('full-access');
  deliver(staleProjection);
  await applyProjection;
  expect(useWorkflowStore.getState().tracePresentation?.rightPanel.context.task.permission).toBe('full-access');
  expect(staleProjection.rightPanel.context.task.permission).toBe('default');
  dispose();
});
