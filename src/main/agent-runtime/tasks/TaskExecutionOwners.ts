import type { TaskExecutionRecord } from './TaskContracts';

type CancellationOwner = (execution: TaskExecutionRecord) => Promise<void>;
const owners = new Map<string, CancellationOwner>();

export function registerTaskExecutionCancellationOwner(executionId: string, owner: CancellationOwner): () => void {
  if (owners.has(executionId)) throw new Error(`Task execution already has a cancellation owner: ${executionId}`);
  owners.set(executionId, owner);
  return () => {
    if (owners.get(executionId) === owner) owners.delete(executionId);
  };
}

export async function cancelOwnedTaskExecution(execution: TaskExecutionRecord): Promise<boolean> {
  const owner = owners.get(execution.id);
  if (!owner) return false;
  await owner(execution);
  return true;
}
