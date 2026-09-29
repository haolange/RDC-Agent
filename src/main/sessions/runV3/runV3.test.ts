import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorageIo } from '../StorageIo';
import type { StorageHost } from '../storageHost';
import { readPersistedRun, writeRunFiles } from '../sessionRunPersistence';
import { SessionRecordStore } from '../SessionRecordStore';
import { PersistedRunRecordV3Schema, toPersistedRunV3 } from './runRecordSchema';

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

async function tempRun() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-run-v3-'));
  roots.push(root);
  const runPath = path.join(root, 'sess', 'runs', 'run_c');
  await mkdir(runPath, { recursive: true });
  return runPath;
}

describe('Run v3 schema', () => {
  it('accepts conversation and mission identity and rejects stage-era fields', () => {
    const conversation = toPersistedRunV3(v3Base());
    expect(conversation.kind).toBe('conversation');
    expect(conversation.captures).toEqual([]);
    expect(PersistedRunRecordV3Schema.safeParse(conversation).success).toBe(true);
    for (const field of ['mode', 'lastStage', 'last_stage', 'workflow_stage', 'recommendedSpecialists', 'availableStages', 'currentStage']) {
      expect(PersistedRunRecordV3Schema.safeParse({ ...conversation, [field]: 'obsolete' }).success).toBe(false);
    }
    expect(PersistedRunRecordV3Schema.safeParse({
      ...conversation,
      runtime: { ...runtime, workflow_stage: 'investigate' },
    }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({ ...conversation, mission: 'debugger' }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({ ...conversation, captures: v3Base().captures }).success).toBe(false);

    const mission = toPersistedRunV3({ ...v3Base(), profileId: 'debugger' });
    expect(mission.kind).toBe('mission');
    if (mission.kind === 'mission') expect(mission.mission).toBe('debugger');
    expect(PersistedRunRecordV3Schema.safeParse(mission).success).toBe(true);
    expect(PersistedRunRecordV3Schema.safeParse({ ...mission, mission: 'analyzer' }).success).toBe(false);
    expect(PersistedRunRecordV3Schema.safeParse({ ...mission, kind: 'conversation' }).success).toBe(false);
  });

  it('uses the builtin mission identity even when a custom profile has the same name', () => {
    const mission = toPersistedRunV3({ ...v3Base(), profileId: 'debugger' });
    expect(mission.kind).toBe('mission');
    expect(PersistedRunRecordV3Schema.safeParse({ ...mission, kind: 'conversation', mission: undefined }).success).toBe(false);
  });
});

describe('current Run persistence', () => {
  it('writes JSON and YAML projections and reads current JSON', async () => {
    const runPath = await tempRun();
    const run = toPersistedRunV3(v3Base());
    writeRunFiles(host(), runPath, run);
    expect(fs.existsSync(path.join(runPath, 'run.yaml'))).toBe(true);
    expect(JSON.parse(await readFile(path.join(runPath, 'run.json'), 'utf8'))).toMatchObject({ schemaVersion: '3', runId: 'run_c' });
    expect(readPersistedRun(host(), runPath, 'sess', 'run_c')).toEqual(run);
  });

  it('returns null only when neither Run projection exists', async () => {
    const runPath = await tempRun();
    expect(readPersistedRun(host(), runPath, 'sess', 'run_c')).toBeNull();
  });

  it('rejects YAML-only data without silently recreating a JSON Run', async () => {
    const runPath = await tempRun();
    const yamlPath = path.join(runPath, 'run.yaml');
    await writeFile(yamlPath, 'schemaVersion: "2"\nrunId: run_c\n', 'utf8');
    expect(() => readPersistedRun(host(), runPath, 'sess', 'run_c')).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    expect(await readFile(yamlPath, 'utf8')).toContain('schemaVersion');
    expect(fs.existsSync(path.join(runPath, 'run.json'))).toBe(false);
  });

  it.each([undefined, '0', '1', '2', '99'])('rejects unsupported version %s without touching the source', async (version) => {
    const runPath = await tempRun();
    const filePath = path.join(runPath, 'run.json');
    const raw = JSON.stringify({ ...toPersistedRunV3(v3Base()), schemaVersion: version });
    await writeFile(filePath, raw, 'utf8');
    expect(() => readPersistedRun(host(), runPath, 'sess', 'run_c')).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    expect(await readFile(filePath, 'utf8')).toBe(raw);
  });

  it('rejects invalid v3 and mismatched directory identity without rewriting', async () => {
    const runPath = await tempRun();
    const filePath = path.join(runPath, 'run.json');
    for (const run of [
      { ...toPersistedRunV3(v3Base()), status: 'made-up' },
      { ...toPersistedRunV3(v3Base()), runId: 'other' },
      { ...toPersistedRunV3(v3Base()), sessionId: 'other' },
      { ...toPersistedRunV3(v3Base()), caseId: 'other' },
      { ...toPersistedRunV3(v3Base()), lastStage: 'investigate' },
    ]) {
      const raw = JSON.stringify(run);
      await writeFile(filePath, raw, 'utf8');
      expect(() => readPersistedRun(host(), runPath, 'sess', 'run_c')).toThrow(/STORAGE_SCHEMA/);
      expect(await readFile(filePath, 'utf8')).toBe(raw);
    }
  });

  it('refuses to write an invalid Run instead of persisting a stage field', async () => {
    const runPath = await tempRun();
    const run = { ...toPersistedRunV3(v3Base()), lastStage: 'investigate' };
    expect(() => writeRunFiles(host(), runPath, run)).toThrow(/refused to write invalid Run v3/);
    expect(fs.existsSync(path.join(runPath, 'run.json'))).toBe(false);
  });

  it('fail-closes leftover stage fields on the live update path', async () => {
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
      sessionId: 'sess', projectId: 'p', title: 't', goal: '', sessionPath, createdAt: 1, updatedAt: 1,
    }), 'utf8');
    writeRunFiles({ io } as StorageHost, runPath, toPersistedRunV3({ ...v3Base(), runId: 'r-final' }));
    await expect(store.updateRun('sess', 'r-final', { lastStage: 'finalize', status: 'running' })).rejects.toThrow(/RUN_V3_STAGE_FIELD/);
    await expect(store.updateRun('sess', 'r-final', { runtime: { workflow_stage: 'finalize' }, status: 'running' })).rejects.toThrow(/RUN_V3_STAGE_FIELD/);
    expect(store.readPersistedRun('sess', 'r-final')?.status).toBe('running');
  });
});
