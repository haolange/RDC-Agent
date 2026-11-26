import * as fs from 'fs';
import * as path from 'path';
import { AppError } from '@shared/errors/appError';
import { stringifyYaml } from '../../runtime/yaml';
import { StorageSchemaError } from '../../runtime/storedDocument';
import { PersistedRunRecordSchema } from './runRecord/runRecordSchema';
import type { RunSummary } from '@shared/types/session';
import type { PersistedRunRecord } from '../store/storageTypes';
import type { StorageIo } from '../../runtime/StorageIo';

export function toRunSummary(run: PersistedRunRecord): RunSummary {
  const { createdAt: _createdAt, updatedAt: _updatedAt, runtime: _runtime, ...summary } = run;
  return summary;
}

export function writeRunFiles(io: StorageIo, runPath: string, run: PersistedRunRecord): void {
  const parsed = PersistedRunRecordSchema.safeParse(run);
  if (!parsed.success) {
    throw new AppError(
      'STORAGE_SCHEMA',
      `refused to write an invalid run: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  io.ensureDir(runPath);
  io.writeUtf8Atomic(path.join(runPath, 'run.json'), `${JSON.stringify(parsed.data, null, 2)}\n`);
  io.writeUtf8Atomic(path.join(runPath, 'run.yaml'), stringifyYaml(parsed.data));
}

export function readPersistedRun(
  io: StorageIo,
  runPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord | null {
  const filePath = path.join(runPath, 'run.json');
  if (!fs.existsSync(filePath)) {
    if (fs.existsSync(path.join(runPath, 'run.yaml'))) {
      throw new StorageSchemaError(`${runPath} has run.yaml without run.json`);
    }
    return null;
  }
  const parsed = io.readJson(filePath, PersistedRunRecordSchema);
  if (parsed === null) return null;
  if (parsed.runId !== runId || parsed.sessionId !== sessionId || parsed.caseId !== sessionId) {
    throw new StorageSchemaError(`${filePath} Run identity does not match its session or directory`);
  }
  return parsed;
}
