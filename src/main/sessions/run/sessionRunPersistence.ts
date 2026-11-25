import * as fs from 'fs';
import * as path from 'path';
import { AppError } from '@shared/errors/appError';
import { stringifyYaml } from '../../runtime/yaml';
import { readCurrentStoredJson, StorageSchemaError } from '../store/storageSchema';
import { PersistedRunRecordV3Schema } from './runV3/runRecordSchema';
import type { RunSummary } from '@shared/types/session';
import type { PersistedRunRecord } from '../store/storageTypes';
import type { StorageIo } from '../store/StorageIo';

export function toRunSummary(run: PersistedRunRecord): RunSummary {
  const { createdAt: _createdAt, updatedAt: _updatedAt, runtime: _runtime, ...summary } = run;
  return summary;
}

export function writeRunFiles(io: StorageIo, runPath: string, run: PersistedRunRecord): void {
  const parsed = PersistedRunRecordV3Schema.safeParse(run);
  if (!parsed.success) {
    throw new AppError('STORAGE_SCHEMA', `refused to write invalid Run v3: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
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
      throw new StorageSchemaError('STORAGE_SCHEMA_UNSUPPORTED', `${runPath} has run.yaml without a Run v3 run.json`);
    }
    return null;
  }
  const parsed = readCurrentStoredJson(io, filePath, '3', PersistedRunRecordV3Schema);
  if (parsed === null) return null;
  if (parsed.runId !== runId || parsed.sessionId !== sessionId || parsed.caseId !== sessionId) {
    throw new StorageSchemaError('STORAGE_SCHEMA', `${filePath} Run identity does not match its session or directory`);
  }
  return parsed;
}
