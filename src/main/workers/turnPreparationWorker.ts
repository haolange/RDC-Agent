import { parentPort } from 'node:worker_threads';
import {
  computeTurnPreparation,
  type TurnPreparationComputationInput,
} from './TurnPreparationComputation';

interface WorkerRequest {
  id: number;
  input: TurnPreparationComputationInput;
}

if (!parentPort) throw new Error('Turn preparation worker requires a worker thread parent port.');

parentPort.on('message', async ({ id, input }: WorkerRequest) => {
  try {
    const result = await computeTurnPreparation(input);
    parentPort!.postMessage({ id, result });
  } catch (error) {
    parentPort!.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
