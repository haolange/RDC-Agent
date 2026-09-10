import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../agent-runtime/tasks/sessionTaskStore', () => ({ createSessionTaskStore: () => store }));
vi.mock('../../sessions/StorageAdapter', () => ({ storageAdapter: { handoffs: { readDocument: () => document, getActive: () => (document as { active?: unknown })?.active, cancel: () => { (document as { active?: unknown }).active = undefined; } } } }));
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEMP, getAppPath: () => process.cwd() } }));
import { MemoryTaskStore } from '../../agent-runtime/tasks/TaskStore';
import { TaskRegistry } from '../../agent-runtime/tasks/TaskRegistry';
import { createTaskTools } from '../../agent-runtime/tasks/TaskTools';
import { processSupervisor } from '../../runtime/ProcessSupervisor';
import { TurnHandle } from './TurnCoordinator';
import { createTaskRuntimeTools } from './TaskRuntimeTools';
import { registerPreparedHandoffExecutionOwner, releasePreparedHandoffExecutionOwner, registerReceivingHandoffTurnOwner, settleJoinedTurnTaskExecutions } from './DirectTaskTurnLifecycle';
let store = new MemoryTaskStore();
let document: unknown;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function fixture() {
 store = new MemoryTaskStore(); const registry = new TaskRegistry(store);
 const task = await registry.createTask('handoff work'); const execution = await registry.startExecution(task.id, { mode: 'handoff', frozenPlanRef: 'plan' });
 document = { history: [{ lifecycle: 'consumed', continuationTurnId: 'receiving-turn', taskExecution: { taskId: task.id, executionId: execution.id, generation: execution.generation } }] };
 const turn = new TurnHandle({ sessionKey: 'owner', turnId: 'receiving-turn', generation: 1 });
 const releaseOwner = (await registerReceivingHandoffTurnOwner('owner', turn))!;
 const stop = createTaskTools(registry).find((item) => item.name === 'task_stop')!;
 return { registry, task, execution, turn, releaseOwner, stop };
}
it('task_stop aborts the consumed handoff receiver and waits for its real producer exit', async () => {
 const { registry, task, execution, turn, releaseOwner, stop } = await fixture();
 let exit!: () => void; const exited = new Promise<void>((resolve) => { exit = resolve; }); const abort = vi.fn();
 turn.registerProducer({ id: 'pending-native-operation', abort, join: () => exited });
 try {
  let returned = false; const stopping = stop.execute('stop', { taskId: task.id }).then(() => { returned = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(abort).toHaveBeenCalled(); expect(returned).toBe(false);
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelling');
  exit(); await stopping;
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelled');
  expect((await registry.getTask(task.id))?.status).toBe('cancelled');
 } finally { exit(); releaseOwner(); turn.close(); }
});
it('unconfirmed receiver exit cannot become a cancelled Task after bounded join expires', async () => {
 vi.useFakeTimers(); const { registry, task, execution, turn, releaseOwner, stop } = await fixture();
 let exit!: () => void; const exited = new Promise<void>((resolve) => { exit = resolve; });
 turn.registerProducer({ id: 'orphan', abort: () => undefined, join: () => exited });
 try {
  const stopping = stop.execute('stop', { taskId: task.id }).then(() => 'unexpected', (error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(7000);
  expect(await stopping).toContain('TASK_CANCELLATION_UNCONFIRMED');
  expect(turn.isOrphaned).toBe(true);
  await settleJoinedTurnTaskExecutions({ sessionId: 'owner', turnId: turn.turnId, generation: 1, stopped: true, orphaned: true });
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelling');
  expect((await registry.getTask(task.id))?.status).not.toBe('cancelled');
 } finally { exit(); await vi.advanceTimersByTimeAsync(0); releaseOwner(); turn.close(); }
});

it('waits for supervised OS process exit even when the model loop has no pending producers', async () => {
 const { registry, task, execution, turn, releaseOwner, stop } = await fixture();
 let release!: () => void; const exit = new Promise<void>((resolve) => { release = resolve; }); let stillRunning = true;
 const join = vi.spyOn(processSupervisor, 'joinExecutionProcesses').mockImplementation(async (sessionId) => { expect(sessionId).toBe('owner'); await exit; });
 vi.spyOn(processSupervisor, 'hasUnconfirmedProcesses').mockImplementation(() => stillRunning);
 try {
  let returned = false; const stopping = stop.execute('stop', { taskId: task.id }).then(() => { returned = true; });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(join).toHaveBeenCalledWith('owner'); expect(turn.isOrphaned).toBe(false); expect(returned).toBe(false);
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelling');
  stillRunning = false; release(); await stopping;
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelled');
 } finally { release(); releaseOwner(); turn.close(); }
});

it('cancels a prepared handoff through its exact owner before marking the Task cancelled', async () => {
 const { registry, task, execution, turn, releaseOwner, stop } = await fixture(); releaseOwner();
 document = { active: { handoffId: 'prepared-execute' }, history: [] };
 registerPreparedHandoffExecutionOwner('owner', 'prepared-execute', execution.id);
 try {
  await stop.execute('stop-prepared', { taskId: task.id });
  expect((document as { active?: unknown }).active).toBeUndefined();
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelled');
 } finally { releasePreparedHandoffExecutionOwner(execution.id); turn.close(); }
});
it.each(['task_stop', 'task_update'] as const)('same-turn %s returns before joining itself and persists cancellation only after exit', async (toolName) => {
 const { registry, task, execution, turn, releaseOwner } = await fixture();
 let exit!: () => void; const exited = new Promise<void>((resolve) => { exit = resolve; });
 turn.registerProducer({ id: 'self-loop', abort: () => undefined, join: () => exited });
 const stop = createTaskRuntimeTools({ sessionId: 'owner', turnHandle: turn, getActiveTurn: () => turn }).find((item) => item.name === toolName)!;
 try {
  const response = await stop.execute('self-stop', { taskId: task.id, ...(toolName === 'task_update' ? { status: 'cancelled' } : {}) });
  expect(response.isError).not.toBe(true); expect(turn.isAborted).toBe(true);
  expect((await registry.getExecution(execution.id))?.status).not.toBe('cancelled');
  exit(); await turn.abortAndJoin();
  await settleJoinedTurnTaskExecutions({ sessionId: 'owner', turnId: turn.turnId, generation: 1, stopped: true, orphaned: turn.isOrphaned });
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelled');
 } finally { exit(); releaseOwner(); turn.close(); }
});
it('does not claim cancelled in the consumed-before-receiving-owner transfer gap', async () => {
 const { registry, task, execution, turn, releaseOwner, stop } = await fixture(); releaseOwner();
 registerPreparedHandoffExecutionOwner('owner', 'transferring', execution.id);
 document = { history: [{ handoffId: 'transferring', lifecycle: 'consumed', continuationTurnId: turn.turnId, taskExecution: { taskId: task.id, executionId: execution.id, generation: execution.generation } }] };
 try {
  await expect(stop.execute('stop-transfer', { taskId: task.id })).rejects.toThrow(/TRANSFER_PENDING/);
  expect((await registry.getExecution(execution.id))?.status).toBe('cancelling');
  expect((await registry.getTask(task.id))?.status).not.toBe('cancelled');
  const releaseReceiving = (await registerReceivingHandoffTurnOwner('owner', turn))!;
  try {
   await new Promise<void>((resolve) => setImmediate(resolve));
   expect(turn.isAborted).toBe(true);
   await turn.abortAndJoin();
   await settleJoinedTurnTaskExecutions({ sessionId: 'owner', turnId: turn.turnId, generation: 1, stopped: true, orphaned: turn.isOrphaned });
   expect((await registry.getExecution(execution.id))?.status).toBe('cancelled');
  } finally { releaseReceiving(); }
 } finally { releasePreparedHandoffExecutionOwner(execution.id); turn.close(); }
});
