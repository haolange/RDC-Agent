import * as path from 'path';
import { writeYaml } from '@shared/utils/yaml';
import { normalizeWorkflowStage } from '@shared/constants/stages';
import type { RunSummary } from '@shared/types/session';
import type { PersistedRunRecord } from './storageTypes';
import type { StorageHost } from './storageHost';
import { readOrMigratePersistedRun } from './runV2/runMigration';
import { PersistedRunRecordV2Schema } from './runV2/runRecordSchema';

export function toRunSummary(run: PersistedRunRecord): RunSummary {
  const { createdAt: _createdAt, updatedAt: _updatedAt, runtime: _runtime, ...summary } = run;
  return summary;
}

export function writeRunFiles(host: StorageHost, runPath: string, run: PersistedRunRecord): void {
  const parsed = PersistedRunRecordV2Schema.safeParse(run);
  if (!parsed.success) {
    throw new Error(`STORAGE_SCHEMA: refused to write invalid Run v2: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  host.io.ensureDir(runPath);
  host.io.writeJsonAtomic(path.join(runPath, 'run.json'), parsed.data);
  writeYaml(path.join(runPath, 'run.yaml'), parsed.data);
}

export function readPersistedRun(
  host: StorageHost,
  runPath: string,
  sessionId: string,
  runId: string,
  sessionPath?: string,
): PersistedRunRecord | null {
  const resolvedSessionPath = sessionPath ?? path.dirname(path.dirname(runPath));
  const run = readOrMigratePersistedRun(host, runPath, resolvedSessionPath, sessionId, runId);
  if (!run) return null;
  run.lastStage = normalizeWorkflowStage(run.lastStage);
  run.runtime.workflow_stage = normalizeWorkflowStage(run.runtime.workflow_stage);
  return run;
}
