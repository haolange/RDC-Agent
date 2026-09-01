import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from '../StorageIo';
import type { StorageHost } from '../storageHost';
import { archiveRunOriginalBytes } from './runArchive';
import { archiveConversationSidecars, readOrMigratePersistedRun } from './runMigration';
import { writeRunFiles } from '../sessionRunPersistence';
import { recoverRunProfileId } from './runProfileRecovery';
import { PersistedRunRecordV2Schema, toPersistedRunV2 } from './runRecordSchema';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const runtime = {
  backend: 'local' as const,
  entry_mode: 'cli' as const,
  context_id: null,
  runtime_owner: null,
  session_id: 'sess',
  workflow_stage: 'investigate' as const,
};

describe('Run v2 schema', () => {
  it('accepts conversation and mission records and rejects mode', () => {
    const conversation = toPersistedRunV2({
      runId: 'run_c',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'general',
      goal: 'g',
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
      startedAt: 1,
      status: 'running',
      lastStage: 'investigate',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    });
    expect(conversation.kind).toBe('conversation');
    expect(conversation.captures).toEqual([]);
    expect(PersistedRunRecordV2Schema.safeParse(conversation).success).toBe(true);
    expect(PersistedRunRecordV2Schema.safeParse({ ...conversation, mode: 'debugger' }).success).toBe(false);
    expect(PersistedRunRecordV2Schema.safeParse({ ...conversation, mission: 'debugger' }).success).toBe(false);
    expect(PersistedRunRecordV2Schema.safeParse({
      ...conversation,
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
    }).success).toBe(false);

    const mission = toPersistedRunV2({
      ...conversation,
      runId: 'run_m',
      profileId: 'debugger',
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
    });
    expect(mission.kind).toBe('mission');
    if (mission.kind === 'mission') expect(mission.mission).toBe('debugger');
    expect(PersistedRunRecordV2Schema.safeParse(mission).success).toBe(true);
  });

  it('fail-closes unknown higher schema versions at the archive/migration boundary', () => {
    expect(PersistedRunRecordV2Schema.safeParse({
      schemaVersion: '3',
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
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(false);
  });
});

describe('Run profile recovery', () => {
  it('prefers unique terminal assistant agentId and ignores legacy mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-recover-'));
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
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-unknown-'));
    roots.push(root);
    const recovered = recoverRunProfileId(root, 'missing');
    expect(recovered.profileId).toBe('legacy:unknown');
  });
});

describe('Run archive', () => {
  it('archives original bytes with hash verification and is idempotent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-archive-'));
    roots.push(root);
    const io = new StorageIo();
    const bytes = '{"mode":"debugger","runId":"r1"}';
    const first = archiveRunOriginalBytes(io, root, 'r1', 'json', bytes);
    const second = archiveRunOriginalBytes(io, root, 'r1', 'json', bytes);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(await readFile(first.archivePath, 'utf8')).toBe(bytes);
  });

  it('fail-closes when an existing archive hash conflicts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-archive-conflict-'));
    roots.push(root);
    const io = new StorageIo();
    const first = archiveRunOriginalBytes(io, root, 'r1', 'json', '{"a":1}');
    await mkdir(path.dirname(first.archivePath), { recursive: true });
    await writeFile(first.archivePath, '{"a":2}', 'utf8');
    expect(() => archiveRunOriginalBytes(io, root, 'r1', 'json', '{"a":1}')).toThrow(/RUN_V2_ARCHIVE_CONFLICT/);
  });
});

describe('Run v2 migration and sidecars', () => {
  it('archives unversioned run.json then writes conversation v2 without consuming sidecars', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-mig-'));
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
      runtime,
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
    });
    await writeFile(path.join(runPath, 'run.json'), original, 'utf8');
    await writeFile(path.join(runPath, 'capture_refs.yaml'), 'captures: []\n', 'utf8');
    await writeFile(path.join(runPath, 'notes', 'hypothesis_board.yaml'), 'hypothesis_board: {}\n', 'utf8');
    const host = { io: new StorageIo() } as StorageHost;
    const migrated = readOrMigratePersistedRun(host, runPath, sessionPath, 'sess', 'r1');
    expect(migrated?.kind).toBe('conversation');
    expect(migrated?.profileId).toBe('legacy:unknown');
    expect(migrated?.captures).toEqual([]);
    expect(migrated?.diagnostics?.some((entry) => entry.includes('LEGACY_MODE_IGNORED'))).toBe(true);
    expect(migrated?.diagnostics?.some((entry) => entry.includes('RUN_V2_SIDECAR_ARCHIVED'))).toBe(true);
    expect(JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8'))).not.toHaveProperty('mode');
    const archiveRoot = path.join(sessionPath, 'migration-backups', 'run-v2', 'r1');
    const archived = await readFile(path.join(archiveRoot, `${createHash('sha256').update(original, 'utf8').digest('hex')}.json`), 'utf8');
    expect(archived).toBe(original);
    expect(await readFile(path.join(runPath, 'capture_refs.yaml'), 'utf8')).toContain('captures:');
  });

  it('classifies an exact mission profile as mission and keeps captures', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-mission-'));
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
      runtime,
    }), 'utf8');
    const host = { io: new StorageIo() } as StorageHost;
    const migrated = readOrMigratePersistedRun(host, runPath, sessionPath, 'sess', 'r2');
    expect(migrated?.kind).toBe('mission');
    if (migrated?.kind === 'mission') expect(migrated.mission).toBe('debugger');
    expect(migrated?.profileId).toBe('debugger');
    expect(migrated?.captures).toHaveLength(1);
    expect(migrated?.diagnostics?.some((entry) => entry.includes('LEGACY_MODE_IGNORED'))).toBe(true);
  });

  it('archives conversation sidecars without deleting the originals', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-sidecar-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r3');
    await mkdir(path.join(runPath, 'notes'), { recursive: true });
    await writeFile(path.join(runPath, 'capture_refs.yaml'), 'captures: [legacy]\n', 'utf8');
    const host = { io: new StorageIo() } as StorageHost;
    const diagnostics = archiveConversationSidecars(host, sessionPath, runPath, 'r3');
    expect(diagnostics.some((entry) => entry.includes('capture_refs.yaml'))).toBe(true);
    expect(await readFile(path.join(runPath, 'capture_refs.yaml'), 'utf8')).toContain('legacy');
  });

  it('reads a legal v2 run.yaml without json as v2 and does not rewrite it as legacy conversation', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-yaml-v2-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r4');
    await mkdir(runPath, { recursive: true });
    const yaml = [
      'schemaVersion: "2"',
      'kind: mission',
      'mission: debugger',
      'runId: r4',
      'projectId: p',
      'sessionId: sess',
      'caseId: sess',
      'profileId: debugger',
      'goal: yaml-v2',
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
    await writeFile(path.join(runPath, 'run.yaml'), yaml, 'utf8');
    const host = { io: new StorageIo() } as StorageHost;
    const loaded = readOrMigratePersistedRun(host, runPath, sessionPath, 'sess', 'r4');
    expect(loaded?.kind).toBe('mission');
    expect(loaded?.profileId).toBe('debugger');
    if (loaded?.kind === 'mission') expect(loaded.mission).toBe('debugger');
    expect(fs.existsSync(path.join(runPath, 'run.json'))).toBe(false);
  });

  it('reads real writer yaml after deleting run.json and keeps v2 mission identity', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-writer-yaml-'));
    roots.push(sessionPath);
    const runPath = path.join(sessionPath, 'runs', 'r-writer');
    const host = { io: new StorageIo() } as StorageHost;
    const run = toPersistedRunV2({
      runId: 'r-writer',
      projectId: 'p',
      sessionId: 'sess',
      caseId: 'sess',
      profileId: 'debugger',
      goal: 'writer-yaml',
      captures: [{ id: 'cap', filePath: 'a.rdc', role: 'primary', backendHint: 'local', status: 'pending' }],
      startedAt: 1,
      status: 'running',
      lastStage: 'investigate',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    });
    writeRunFiles(host, runPath, run);
    fs.rmSync(path.join(runPath, 'run.json'), { force: true });
    const loaded = readOrMigratePersistedRun(host, runPath, sessionPath, 'sess', 'r-writer');
    expect(loaded?.kind).toBe('mission');
    expect(loaded?.profileId).toBe('debugger');
    if (loaded?.kind === 'mission') expect(loaded.mission).toBe('debugger');
    expect(loaded?.captures).toHaveLength(1);
    expect(fs.existsSync(path.join(runPath, 'run.json'))).toBe(false);
  });

  it('still reads legacy snake_case v2 yaml after normalize', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-snake-yaml-'));
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
    const host = { io: new StorageIo() } as StorageHost;
    const loaded = readOrMigratePersistedRun(host, runPath, sessionPath, 'sess', 'r-snake');
    expect(loaded?.kind).toBe('mission');
    expect(loaded?.profileId).toBe('debugger');
    if (loaded?.kind === 'mission') expect(loaded.mission).toBe('debugger');
    expect(loaded?.captures).toHaveLength(1);
  });

  it('fail-closes unknown or malformed schemaVersion strings', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-run-version-'));
    roots.push(sessionPath);
    const host = { io: new StorageIo() } as StorageHost;
    for (const version of ['future', '1.1', '3']) {
      const runId = `r-${version.replace('.', '_')}`;
      const runPath = path.join(sessionPath, 'runs', runId);
      await mkdir(runPath, { recursive: true });
      await writeFile(path.join(runPath, 'run.json'), JSON.stringify({
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
        runtime,
      }), 'utf8');
      expect(() => readOrMigratePersistedRun(host, runPath, sessionPath, 'sess', runId))
        .toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    }
  });
});

describe('Run v2 identity', () => {
  it('treats a custom profile named debugger as mission identity', () => {
    const parsed = PersistedRunRecordV2Schema.safeParse({
      schemaVersion: '2',
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
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    });
    expect(parsed.success).toBe(true);
    expect(PersistedRunRecordV2Schema.safeParse({
      schemaVersion: '2',
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
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(false);
  });

  it('allows legacy:unknown conversation and rejects conversation+mission', () => {
    expect(PersistedRunRecordV2Schema.safeParse({
      schemaVersion: '2',
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
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(true);
    expect(PersistedRunRecordV2Schema.safeParse({
      schemaVersion: '2',
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
      lastStage: 'preflight',
      backend: 'local',
      createdAt: 1,
      updatedAt: 1,
      runtime,
    }).success).toBe(false);
  });
});
