import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from '../StorageIo';
import type { StorageHost } from '../storageHost';
import { archiveRunOriginalBytes, RUN_V2_BACKUP_DIR, RUN_V3_BACKUP_DIR, RUN_V3_MIGRATION_LOCK } from './runArchive';
import { archiveConversationSidecars, readOrMigratePersistedRun } from './runMigration';
import { writeRunFiles } from '../sessionRunPersistence';
import { recoverRunProfileId } from './runProfileRecovery';
import { PersistedRunRecordV3Schema, toPersistedRunV3 } from './runRecordSchema';
import { SessionRecordStore } from '../SessionRecordStore';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const runtime = {
  backend: 'local' as const,
  entry_mode: 'cli' as const,
  context_id: null,
  runtime_owner: null,
  session_id: 'sess',
};

function host(): StorageHost {
  return { io: new StorageIo() } as StorageHost;
}

function v3Base() {
  return {
    runId: 'run_c',
    projectId: 'p',
    sessionId: 'sess',
    caseId: 'sess',
    profileId: 'general',
    goal: 'g',
    captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary' as const, backendHint: 'local' as const, status: 'pending' as const }],
    startedAt: 1,
    status: 'running' as const,
    backend: 'local' as const,
    createdAt: 1,
    updatedAt: 1,
    runtime,
  };
}

describe('Run v3 schema', () => {
  it('accepts conversation and mission records and rejects mode, lastStage, and workflow_stage', () => {
    const conversation = toPersistedRunV3(v3Base());
    expect(conversation.kind).toBe('conversation');
    expect(conversation.captures).toEqual([]);
    expect(conversation).not.toHaveProperty('lastStage');
    expect(conversation.runtime).not.toHaveProperty('workflow_stage');
    expect(PersistedRunRecordV3Schema.safeParse(conversation).success).toBe(true);
    expect(PersistedRunRecordV3Schema.safeParse({ ...conversation, mode: 'debugger' }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({ ...conversation, mission: 'debugger' }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({ ...conversation, lastStage: 'investigate' }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({
      ...conversation,
      runtime: { ...runtime, workflow_stage: 'investigate' },
    }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({
      ...conversation,
      recommendedSpecialists: ['debugger'],
    }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({
      ...conversation,
      availableStages: ['investigate'],
      currentStage: 'investigate',
    }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({
      ...conversation,
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
    }).success).toBe(false);

    const mission = toPersistedRunV3({
      ...v3Base(),
      runId: 'run_m',
      profileId: 'debugger',
    });
    expect(mission.kind).toBe('mission');
    if (mission.kind === 'mission') expect(mission.mission).toBe('debugger');
    expect(PersistedRunRecordV3Schema.safeParse(mission).success).toBe(true);
  });

  it('fail-closes unknown higher schema versions at the archive/migration boundary', () => {
    expect(PersistedRunRecordV3Schema.safeParse({
      schemaVersion: '99',
      kind: 'conversation',
      runId: 'r',
      projectId: 'p',
      sessionId: 's',
      caseId: 's',
      profileId: 'general',
      goal: '',
      captures: [],
      startedAt: 1,
      status: 'running',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(false);
  });
});

describe('Run profile recovery', () => {
  it('prefers unique terminal assistant agentId and ignores legacy mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-recover-'));
    roots.push(root);
    await writeFile(path.join(root, 'conversation.jsonl'), `${JSON.stringify({
      runId: 'run_1', role: 'user', status: 'complete', agentId: 'general',
    })}\n${JSON.stringify({
      runId: 'run_1', role: 'assistant', status: 'complete', agentId: 'debugger',
    })}\n`, 'utf8');
    const recovered = recoverRunProfileId(root, 'run_1', 'optimizer');
    expect(recovered.profileId).toBe('debugger');
    expect(recovered.diagnostics.some((entry) => entry.includes('LEGACY_MODE_IGNORED'))).toBe(true);
  });

  it('returns legacy:unknown without unique evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-unknown-'));
    roots.push(root);
    const recovered = recoverRunProfileId(root, 'missing');
    expect(recovered.profileId).toBe('legacy:unknown');
  });
});

describe('Run archive', () => {
  it('archives original bytes with hash verification and is idempotent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-archive-'));
    roots.push(root);
    const io = new StorageIo();
    const bytes = '{"mode":"debugger","runId":"r1"}';
    const first = archiveRunOriginalBytes(io, root, 'r1', 'json', bytes);
    const second = archiveRunOriginalBytes(io, root, 'r1', 'json', bytes);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(first.archivePath).toContain(path.join('migration-backups', 'run-v3'));
    expect(await readFile(first.archivePath, 'utf8')).toBe(bytes);
  });

  it('fail-closes when an existing archive hash conflicts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-archive-conflict-'));
    roots.push(root);
    const io = new StorageIo();
    const first = archiveRunOriginalBytes(io, root, 'r1', 'json', '{"a":1}');
    await mkdir(path.dirname(first.archivePath), { recursive: true });
    await writeFile(first.archivePath, '{"a":2}', 'utf8');
    expect(() => archiveRunOriginalBytes(io, root, 'r1', 'json', '{"a":1}')).toThrow(/RUN_V3_ARCHIVE_CONFLICT/);
  });

  it('leaves existing run-v2 archives untouched', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-v2-archive-keep-'));
    roots.push(root);
    const legacyPath = path.join(root, RUN_V2_BACKUP_DIR, 'r1', 'legacy.json');
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, '{"kept":true}', 'utf8');
    archiveRunOriginalBytes(new StorageIo(), root, 'r1', 'json', '{"v3":true}');
    expect(await readFile(legacyPath, 'utf8')).toBe('{"kept":true}');
  });
});

describe('Run v3 migration', () => {
  it('archives unversioned v0 run.json then writes conversation v3 without inferring mission from lastStage', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-mig-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r1');
    await mkdir(path.join(runPath, 'notes'), { recursive: true });
    const original = JSON.stringify({
      run_id: 'r1',
      project_id: 'p',
      session_id: 'sess',
      case_id: 'sess',
      mode: 'debugger',
      goal: 'legacy',
      status: 'running',
      last_stage: 'investigate',
      created_at: '2026-01-01T00:00:00.000Z',
      runtime: { ...runtime, workflow_stage: 'investigate' },
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
    });
    await writeFile(path.join(runPath, 'run.json'), original, 'utf8');
    await writeFile(path.join(runPath, 'capture_refs.yaml'), 'captures: []\n', 'utf8');
    await writeFile(path.join(runPath, 'notes', 'hypothesis_board.yaml'), 'hypothesis_board: {}\n', 'utf8');
    const migrated = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r1');
    expect(migrated?.schemaVersion).toBe('3');
    expect(migrated?.kind).toBe('conversation');
    expect(migrated?.profileId).toBe('legacy:unknown');
    expect(migrated?.captures).toEqual([]);
    expect(migrated).not.toHaveProperty('lastStage');
    expect(migrated?.runtime).not.toHaveProperty('workflow_stage');
    expect(migrated?.diagnostics?.some((entry) => entry.includes('LEGACY_MODE_IGNORED'))).toBe(true);
    expect(migrated?.diagnostics?.some((entry) => entry.includes('RUN_V3_SIDECAR_ARCHIVED'))).toBe(true);
    expect(migrated?.diagnostics?.some((entry) => entry.includes('MISSION_NOT_INFERRED'))).toBe(true);
    const rewritten = JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8')) as Record<string, unknown>;
    expect(rewritten).not.toHaveProperty('mode');
    expect(rewritten).not.toHaveProperty('lastStage');
    expect(rewritten.schemaVersion).toBe('3');
    const archiveRoot = path.join(sessionPath, RUN_V3_BACKUP_DIR, 'r1');
    const archived = await readFile(path.join(archiveRoot, `${createHash('sha256').update(original, 'utf8').digest('hex')}.json`), 'utf8');
    expect(archived).toBe(original);
  });

  it('migrates v1 to mission from conversation identity, not lastStage', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-mission-'));
    roots.push(sessionPath);
    await writeFile(path.join(sessionPath, 'conversation.jsonl'), `${JSON.stringify({
      runId: 'r2', role: 'assistant', status: 'complete', agentId: 'debugger',
    })}\n`, 'utf8');
    const runPath = path.join(sessionPath, 'runs', 'r2');
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(runPath, 'run.json'), JSON.stringify({
      schema_version: '1',
      runId: 'r2',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      mode: 'ask',
      goal: 'debug',
      status: 'running',
      lastStage: 'investigate',
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
      createdAt: 1,
      updatedAt: 1,
      runtime: { ...runtime, workflow_stage: 'finalize' },
    }), 'utf8');
    const migrated = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r2');
    expect(migrated?.schemaVersion).toBe('3');
    expect(migrated?.kind).toBe('mission');
    if (migrated?.kind === 'mission') expect(migrated.mission).toBe('debugger');
    expect(migrated?.profileId).toBe('debugger');
    expect(migrated?.captures).toHaveLength(1);
    expect(migrated).not.toHaveProperty('lastStage');
    expect(migrated?.diagnostics?.some((entry) => entry.includes('LEGACY_MODE_IGNORED'))).toBe(true);
  });

  it('archives and rewrites a legal v2 run.json to v3', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-v2-json-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-v2');
    await mkdir(runPath, { recursive: true });
    const original = JSON.stringify({
      schemaVersion: '2',
      kind: 'conversation',
      runId: 'r-v2',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'v2',
      captures: [],
      startedAt: 1,
      status: 'running',
      lastStage: 'finalize',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime: { ...runtime, workflow_stage: 'finalize' },
    });
    await writeFile(path.join(runPath, 'run.json'), original, 'utf8');
    const migrated = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-v2');
    expect(migrated?.schemaVersion).toBe('3');
    expect(migrated?.kind).toBe('conversation');
    expect(migrated?.status).toBe('running');
    expect(migrated).not.toHaveProperty('lastStage');
    const rewritten = JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8')) as { schemaVersion: string };
    expect(rewritten.schemaVersion).toBe('3');
    expect(fs.existsSync(path.join(sessionPath, RUN_V3_BACKUP_DIR, 'r-v2', `${createHash('sha256').update(original, 'utf8').digest('hex')}.json`))).toBe(true);
  });

  it('is idempotent when migration is repeated', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-idemp-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-idemp');
    await mkdir(runPath, { recursive: true });
    const original = JSON.stringify({
      schemaVersion: '2',
      kind: 'conversation',
      runId: 'r-idemp',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'idemp',
      captures: [],
      startedAt: 1,
      status: 'running',
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime: { ...runtime, workflow_stage: 'preflight' },
    });
    await writeFile(path.join(runPath, 'run.json'), original, 'utf8');
    const first = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-idemp');
    const firstJson = await readFile(path.join(runPath, 'run.json'), 'utf8');
    const second = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-idemp');
    const secondJson = await readFile(path.join(runPath, 'run.json'), 'utf8');
    expect(first?.schemaVersion).toBe('3');
    expect(second?.schemaVersion).toBe('3');
    expect(secondJson).toBe(firstJson);
    const archiveDir = path.join(sessionPath, RUN_V3_BACKUP_DIR, 'r-idemp');
    expect(fs.readdirSync(archiveDir)).toHaveLength(1);
  });

  it('survives crash after archive and before rewrite', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-crash-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-crash');
    await mkdir(runPath, { recursive: true });
    const original = JSON.stringify({
      schemaVersion: '2',
      kind: 'conversation',
      runId: 'r-crash',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'crash',
      captures: [],
      startedAt: 1,
      status: 'running',
      lastStage: 'investigate',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime: { ...runtime, workflow_stage: 'investigate' },
    });
    await writeFile(path.join(runPath, 'run.json'), original, 'utf8');
    archiveRunOriginalBytes(new StorageIo(), sessionPath, 'r-crash', 'json', original);
    expect(JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8')).schemaVersion).toBe('2');
    const migrated = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-crash');
    expect(migrated?.schemaVersion).toBe('3');
    expect(JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8')).schemaVersion).toBe('3');
  });

  it('fail-closes lock contention from a live owner', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-lock-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-lock');
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(runPath, 'run.json'), JSON.stringify({
      schemaVersion: '2',
      kind: 'conversation',
      runId: 'r-lock',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: '',
      captures: [],
      startedAt: 1,
      status: 'running',
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime: { ...runtime, workflow_stage: 'preflight' },
    }), 'utf8');
    await writeFile(path.join(sessionPath, RUN_V3_MIGRATION_LOCK), JSON.stringify({
      pid: process.pid,
      createdAt: Date.now(),
    }), 'utf8');
    expect(() => readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-lock'))
      .toThrow(/RUN_V3_MIGRATION_LOCK_TIMEOUT/);
    expect(JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8')).schemaVersion).toBe('2');
  }, 20_000);

  it('fail-closes unknown higher schemaVersion without archiving or rewriting', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-version-'));
    roots.push(sessionPath);
    for (const version of ['future', '1.1', '4', '99']) {
      const runId = `r-${version.replace('.', '_')}`;
      const runPath = path.join(sessionPath, 'runs', runId);
      await mkdir(runPath, { recursive: true });
      const original = JSON.stringify({
        schemaVersion: version,
        kind: 'conversation',
        runId,
        projectId: 'p',
        sessionId: 'sess',
        caseId: 'sess',
        profileId: 'general',
        goal: '',
        captures: [],
        startedAt: 1,
        status: 'running',
        lastStage: 'preflight',
        backend: 'local',
        createdAt: 1,
        updatedAt: 1,
        runtime: { ...runtime, workflow_stage: 'preflight' },
      });
      await writeFile(path.join(runPath, 'run.json'), original, 'utf8');
      expect(() => readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', runId))
        .toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
      expect(await readFile(path.join(runPath, 'run.json'), 'utf8')).toBe(original);
      expect(fs.existsSync(path.join(sessionPath, RUN_V3_BACKUP_DIR, runId))).toBe(false);
    }
  });

  it('fail-closes json/yaml identity conflict without archiving', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-conflict-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-conflict');
    await mkdir(runPath, { recursive: true });
    const json = JSON.stringify({
      schemaVersion: '2',
      kind: 'conversation',
      runId: 'r-conflict',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'json',
      captures: [],
      startedAt: 1,
      status: 'running',
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime: { ...runtime, workflow_stage: 'preflight' },
    });
    const yaml = [
      'schemaVersion: "2"',
      'kind: mission',
      'mission: debugger',
      'runId: r-conflict',
      'projectId: p',
      'sessionId: sess',
      'caseId: sess',
      'profileId: debugger',
      'goal: yaml',
      'captures: []',
      'startedAt: 1',
      'status: running',
      'lastStage: investigate',
      'backend: local',
      'createdAt: 1',
      'updatedAt: 1',
      'runtime:',
      '  backend: local',
      '  entry_mode: cli',
      '  context_id: null',
      '  runtime_owner: null',
      '  session_id: sess',
      '  workflow_stage: investigate',
      '',
    ].join('\n');
    await writeFile(path.join(runPath, 'run.json'), json, 'utf8');
    await writeFile(path.join(runPath, 'run.yaml'), yaml, 'utf8');
    expect(() => readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-conflict'))
      .toThrow(/RUN_V3_DUAL_FILE_CONFLICT/);
    expect(await readFile(path.join(runPath, 'run.json'), 'utf8')).toBe(json);
    expect(fs.existsSync(path.join(sessionPath, RUN_V3_BACKUP_DIR, 'r-conflict'))).toBe(false);
  });

  it('fail-closes json/yaml content conflict when runId/profileId match but captures or status differ', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-content-conflict-'));
    roots.push(sessionPath);

    const shared = {
      schemaVersion: '2',
      kind: 'conversation',
      runId: 'r-content',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'same-goal',
      startedAt: 1,
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    };
    const capture = { id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' };

    const statusConflict = path.join(sessionPath, 'runs', 'r-status');
    await mkdir(statusConflict, { recursive: true });
    await writeFile(path.join(statusConflict, 'run.json'), JSON.stringify({
      ...shared,
      runId: 'r-status',
      captures: [],
      status: 'running',
    }), 'utf8');
    await writeFile(path.join(statusConflict, 'run.yaml'), [
      'schemaVersion: "2"',
      'kind: conversation',
      'runId: r-status',
      'projectId: p',
      'sessionId: sess',
      'caseId: sess',
      'profileId: general',
      'goal: same-goal',
      'captures: []',
      'startedAt: 1',
      'status: completed',
      'backend: local',
      'createdAt: 1',
      'updatedAt: 1',
      'runtime:',
      '  backend: local',
      '  entry_mode: cli',
      '  context_id: null',
      '  runtime_owner: null',
      '  session_id: sess',
      '',
    ].join('\n'), 'utf8');
    expect(() => readOrMigratePersistedRun(host(), statusConflict, sessionPath, 'sess', 'r-status'))
      .toThrow(/RUN_V3_DUAL_FILE_CONFLICT/);

    const captureConflict = path.join(sessionPath, 'runs', 'r-captures');
    await mkdir(captureConflict, { recursive: true });
    await writeFile(path.join(captureConflict, 'run.json'), JSON.stringify({
      ...shared,
      runId: 'r-captures',
      captures: [capture],
      status: 'running',
    }), 'utf8');
    await writeFile(path.join(captureConflict, 'run.yaml'), [
      'schemaVersion: "2"',
      'kind: conversation',
      'runId: r-captures',
      'projectId: p',
      'sessionId: sess',
      'caseId: sess',
      'profileId: general',
      'goal: same-goal',
      'captures: []',
      'startedAt: 1',
      'status: running',
      'backend: local',
      'createdAt: 1',
      'updatedAt: 1',
      'runtime:',
      '  backend: local',
      '  entry_mode: cli',
      '  context_id: null',
      '  runtime_owner: null',
      '  session_id: sess',
      '',
    ].join('\n'), 'utf8');
    expect(() => readOrMigratePersistedRun(host(), captureConflict, sessionPath, 'sess', 'r-captures'))
      .toThrow(/RUN_V3_DUAL_FILE_CONFLICT/);
    expect(fs.existsSync(path.join(sessionPath, RUN_V3_BACKUP_DIR, 'r-status'))).toBe(false);
    expect(fs.existsSync(path.join(sessionPath, RUN_V3_BACKUP_DIR, 'r-captures'))).toBe(false);
  });

  it('rejects a v3 file that still carries lastStage or recommendedSpecialists', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-v3-leftover-'));
    roots.push(sessionPath);
    const v3 = {
      schemaVersion: '3',
      kind: 'conversation',
      runId: 'r-leftover',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'g',
      captures: [],
      startedAt: 1,
      status: 'running',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    };

    const lastStagePath = path.join(sessionPath, 'runs', 'r-last-stage');
    await mkdir(lastStagePath, { recursive: true });
    await writeFile(path.join(lastStagePath, 'run.json'), JSON.stringify({
      ...v3,
      runId: 'r-last-stage',
      lastStage: 'investigate',
    }), 'utf8');
    expect(() => readOrMigratePersistedRun(host(), lastStagePath, sessionPath, 'sess', 'r-last-stage'))
      .toThrow(/STORAGE_SCHEMA/);

    const specialistsPath = path.join(sessionPath, 'runs', 'r-specialists');
    await mkdir(specialistsPath, { recursive: true });
    await writeFile(path.join(specialistsPath, 'run.json'), JSON.stringify({
      ...v3,
      runId: 'r-specialists',
      recommendedSpecialists: ['debugger'],
    }), 'utf8');
    expect(() => readOrMigratePersistedRun(host(), specialistsPath, sessionPath, 'sess', 'r-specialists'))
      .toThrow(/STORAGE_SCHEMA/);
  });

  it('archives conversation sidecars without deleting the originals', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-sidecar-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r3');
    await mkdir(path.join(runPath, 'notes'), { recursive: true });
    await writeFile(path.join(runPath, 'capture_refs.yaml'), 'captures: [legacy]\n', 'utf8');
    const diagnostics = archiveConversationSidecars(host(), sessionPath, runPath, 'r3');
    expect(diagnostics.some((entry) => entry.includes('capture_refs.yaml'))).toBe(true);
    expect(await readFile(path.join(runPath, 'capture_refs.yaml'), 'utf8')).toContain('legacy');
  });

  it('rewrites writer yaml-only v2 to canonical v3 json+yaml', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-writer-yaml-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-writer');
    const run = toPersistedRunV3({
      ...v3Base(),
      runId: 'r-writer',
      profileId: 'debugger',
      goal: 'writer-yaml',
    });
    writeRunFiles(host(), runPath, run);
    fs.rmSync(path.join(runPath, 'run.json'), { force: true });
    const v2Yaml = [
      'schemaVersion: "2"',
      'kind: mission',
      'mission: debugger',
      'runId: r-writer',
      'projectId: p',
      'sessionId: sess',
      'caseId: sess',
      'profileId: debugger',
      'goal: writer-yaml',
      'captures: []',
      'startedAt: 1',
      'status: running',
      'lastStage: investigate',
      'backend: local',
      'createdAt: 1',
      'updatedAt: 1',
      'runtime:',
      '  backend: local',
      '  entry_mode: cli',
      '  context_id: null',
      '  runtime_owner: null',
      '  session_id: sess',
      '  workflow_stage: investigate',
      '',
    ].join('\n');
    await writeFile(path.join(runPath, 'run.yaml'), v2Yaml, 'utf8');
    const loaded = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-writer');
    expect(loaded?.schemaVersion).toBe('3');
    expect(loaded?.kind).toBe('mission');
    expect(fs.existsSync(path.join(runPath, 'run.json'))).toBe(true);
    expect(JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8')).schemaVersion).toBe('3');
  });

  it('still reads legacy snake_case v2 yaml after normalize and rewrites v3', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-snake-yaml-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-snake');
    await mkdir(runPath, { recursive: true });
    const yaml = [
      'schema_version: "2"',
      'kind: mission',
      'mission: debugger',
      'run_id: r-snake',
      'project_id: p',
      'session_id: sess',
      'case_id: sess',
      'profileId: debugger',
      'goal: snake-yaml',
      'captures:',
      '  - id: cap',
      '    filePath: a.rdc',
      '    role: primary',
      '    backendHint: local',
      '    status: pending',
      'created_at: "2026-01-01T00:00:00.000Z"',
      'updated_at: "2026-01-01T00:00:00.000Z"',
      'status: running',
      'last_stage: investigate',
      'runtime:',
      '  backend: local',
      '  entry_mode: cli',
      '  context_id: null',
      '  runtime_owner: null',
      '  session_id: sess',
      '  workflow_stage: investigate',
      '',
    ].join('\n');
    await writeFile(path.join(runPath, 'run.yaml'), yaml, 'utf8');
    const loaded = readOrMigratePersistedRun(host(), runPath, sessionPath, 'sess', 'r-snake');
    expect(loaded?.schemaVersion).toBe('3');
    expect(loaded?.kind).toBe('mission');
    expect(loaded?.profileId).toBe('debugger');
    if (loaded?.kind === 'mission') expect(loaded.mission).toBe('debugger');
    expect(loaded?.captures).toHaveLength(1);
  });
});

describe('Run v3 identity', () => {
  it('treats a custom profile named debugger as mission identity', () => {
    const parsed = PersistedRunRecordV3Schema.safeParse({
      schemaVersion: '3',
      kind: 'mission',
      mission: 'debugger',
      runId: 'r',
      projectId: 'p',
      sessionId: 's',
      caseId: 's',
      profileId: 'debugger',
      goal: '',
      captures: [],
      startedAt: 1,
      status: 'running',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    });
    expect(parsed.success).toBe(true);
    expect(PersistedRunRecordV3Schema.safeParse({
      schemaVersion: '3',
      kind: 'conversation',
      runId: 'r',
      projectId: 'p',
      sessionId: 's',
      caseId: 's',
      profileId: 'debugger',
      goal: '',
      captures: [],
      startedAt: 1,
      status: 'running',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(false);
  });

  it('allows legacy:unknown conversation and rejects conversation+mission', () => {
    expect(PersistedRunRecordV3Schema.safeParse({
      schemaVersion: '3',
      kind: 'conversation',
      runId: 'r',
      projectId: 'p',
      sessionId: 's',
      caseId: 's',
      profileId: 'legacy:unknown',
      goal: '',
      captures: [],
      startedAt: 1,
      status: 'running',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(true);
    expect(PersistedRunRecordV3Schema.safeParse({
      schemaVersion: '3',
      kind: 'conversation',
      mission: 'debugger',
      runId: 'r',
      projectId: 'p',
      sessionId: 's',
      caseId: 's',
      profileId: 'general',
      goal: '',
      captures: [],
      startedAt: 1,
      status: 'running',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(false);
  });
});

describe('Run lifecycle without stage finalize', () => {
  it('fail-closes leftover lastStage or workflow_stage on the live write path', async () => {
    const projectsRoot = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-finalize-'));
    roots.push(projectsRoot);
    const sessionPath = path.join(projectsRoot, 'sess');
    const runPath = path.join(sessionPath, 'runs', 'r-final');
    const io = new StorageIo();
    const store = new SessionRecordStore({
      io,
      projects: {
        listProjects: () => [{ projectId: 'p' }],
        ensureProjectSessionsRoot: () => projectsRoot,
        touchProject: () => undefined,
        setCurrentProjectId: () => undefined,
        setCurrentSessionId: () => undefined,
      },
    } as unknown as StorageHost);
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(sessionPath, 'session.json'), JSON.stringify({
      sessionId: 'sess',
      projectId: 'p',
      title: 't',
      goal: '',
      sessionPath,
      createdAt: 1,
      updatedAt: 1,
    }), 'utf8');
    const run = toPersistedRunV3({
      ...v3Base(),
      runId: 'r-final',
      sessionId: 'sess',
      caseId: 'sess',
      status: 'running',
    });
    writeRunFiles({ io } as StorageHost, runPath, run);
    await expect(store.updateRun('sess', 'r-final', {
      lastStage: 'finalize',
      status: 'running',
    })).rejects.toThrow(/RUN_V3_STAGE_FIELD/);
    await expect(store.updateRun('sess', 'r-final', {
      runtime: { workflow_stage: 'finalize' },
      status: 'running',
    })).rejects.toThrow(/RUN_V3_STAGE_FIELD/);
    const loaded = store.readPersistedRun('sess', 'r-final');
    expect(loaded?.status).toBe('running');
    expect(loaded).not.toHaveProperty('lastStage');
    expect(loaded?.runtime).not.toHaveProperty('workflow_stage');
    expect(loaded?.finishedAt).toBeUndefined();
  });
});
