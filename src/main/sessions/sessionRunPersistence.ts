import * as path from 'path';
import { writeYaml } from '@shared/utils/yaml';
import { nowIso } from '@shared/utils/id';
import { normalizeWorkflowStage } from '@shared/constants/stages';
import type { CaptureDescriptor, ExecutableAppMode, RunSummary } from '@shared/types/session';
import type { PersistedRunRecord } from './storageTypes';
import {
  assertNoUnsupportedSchemaVersion,
  CURRENT_STORE_SCHEMA_VERSION,
  PersistedRunRecordSchema,
} from './storageSchema';
import type { StorageHost } from './storageHost';

export function toRunSummary(run: PersistedRunRecord): RunSummary {
  return {
    runId: run.runId,
    turnId: run.turnId,
    projectId: run.projectId,
    sessionId: run.sessionId,
    caseId: run.caseId,
    mode: run.mode,
    goal: run.goal,
    captures: run.captures,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    stoppedAt: run.stoppedAt,
    status: run.status,
    stopReason: run.stopReason,
    lastStage: run.lastStage,
    backend: run.backend,
    reportPaths: run.reportPaths,
  };
}

export function writeRunFiles(host: StorageHost, runPath: string, run: PersistedRunRecord): void {
  host.io.ensureDir(runPath);
  host.io.writeJsonAtomic(path.join(runPath, 'run.json'), run);
  writeYaml(path.join(runPath, 'run.yaml'), {
    schema_version: CURRENT_STORE_SCHEMA_VERSION,
    run_id: run.runId,
    turn_id: run.turnId,
    session_id: run.sessionId,
    case_id: run.caseId,
    project_id: run.projectId,
    created_at: new Date(run.createdAt).toISOString(),
    updated_at: new Date(run.updatedAt).toISOString(),
    mode: run.mode,
    goal: run.goal,
    status: run.status,
    last_stage: run.lastStage,
    coordination_mode: 'staged_handoff',
    orchestration_mode: 'multi_agent',
    runtime: run.runtime,
    captures: run.captures,
  });
}

export function readPersistedRun(
  host: StorageHost,
  runPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord | null {
  const runJsonPath = path.join(runPath, 'run.json');
  const runJson = host.io.readJson(runJsonPath, PersistedRunRecordSchema);
  if (runJson) {
    runJson.lastStage = normalizeWorkflowStage(runJson.lastStage);
    runJson.runtime.workflow_stage = normalizeWorkflowStage(runJson.runtime.workflow_stage);
    return runJson;
  }

  const runYamlPath = path.join(runPath, 'run.yaml');
  const runYaml = host.io.readYaml<Record<string, unknown>>(runYamlPath);
  if (!runYaml) {
    return null;
  }
  assertNoUnsupportedSchemaVersion(runYaml, CURRENT_STORE_SCHEMA_VERSION, runYamlPath);

  const mapped: PersistedRunRecord = {
    runId,
    turnId: typeof runYaml.turn_id === 'string' ? runYaml.turn_id : undefined,
    projectId: String(runYaml.project_id || ''),
    sessionId,
    caseId: String(runYaml.case_id || sessionId),
    mode: (runYaml.mode as ExecutableAppMode) || 'debugger',
    goal: String(runYaml.goal || ''),
    captures: (runYaml.captures as CaptureDescriptor[]) || [],
    startedAt: Date.parse(String(runYaml.created_at || nowIso())),
    finishedAt: runYaml.finished_at ? Date.parse(String(runYaml.finished_at)) : undefined,
    status: (runYaml.status as PersistedRunRecord['status']) || 'running',
    lastStage: normalizeWorkflowStage(String(runYaml.last_stage || 'preflight')),
    backend: ((runYaml.runtime as Record<string, unknown>)?.backend as 'local' | 'remote') || 'local',
    createdAt: Date.parse(String(runYaml.created_at || nowIso())),
    updatedAt: Date.parse(String(runYaml.updated_at || runYaml.created_at || nowIso())),
    runtime: {
      backend: ((runYaml.runtime as Record<string, unknown>)?.backend as 'local' | 'remote') || 'local',
      entry_mode: (((runYaml.runtime as Record<string, unknown>)?.entry_mode as 'cli' | 'mcp') || 'cli'),
      context_id: ((runYaml.runtime as Record<string, unknown>)?.context_id as string | null) || null,
      runtime_owner: ((runYaml.runtime as Record<string, unknown>)?.runtime_owner as string | null) || null,
      session_id: String((runYaml.runtime as Record<string, unknown>)?.session_id || sessionId),
      workflow_stage: normalizeWorkflowStage((runYaml.runtime as Record<string, unknown>)?.workflow_stage as string | undefined),
    },
  };
  const parsed = PersistedRunRecordSchema.safeParse(mapped);
  if (!parsed.success) {
    host.io.quarantineCorrupt(runYamlPath);
    throw new Error(
      `STORAGE_CORRUPT: failed to parse YAML file: ${runYamlPath}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  parsed.data.lastStage = normalizeWorkflowStage(parsed.data.lastStage);
  parsed.data.runtime.workflow_stage = normalizeWorkflowStage(parsed.data.runtime.workflow_stage);
  return parsed.data;
}
