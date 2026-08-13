import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseStoredDocument,
  PROJECT_REGISTRY_MIGRATIONS,
  SessionRecordSchema,
  SessionAttachmentManifestSchema,
  PersistedRunRecordSchema,
  CONVERSATION_TURN_COMMIT_MIGRATIONS,
  CONVERSATION_TERMINAL_COMMIT_MIGRATIONS,
  SESSION_EVIDENCE_MIGRATIONS,
  StorageSchemaError,
  type StorageMigration,
} from './storageSchema';
import { StorageIo } from './StorageIo';
import { assertPersistedSettingsSchemaVersion } from '../settings/settingsServiceHelpers';
import { SETTINGS_SCHEMA_VERSION } from '../settings/settingsDefaults';
import { stringifyYaml } from '@shared/utils/yaml';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach } from 'vitest';

describe('storageSchema parseStoredDocument', () => {
  const current = z.object({
    schemaVersion: z.literal('1'),
    name: z.string(),
    extra: z.boolean().optional(),
  });
  const migrations = [
    {
      schemaVersion: '0',
      schema: z.object({ schemaVersion: z.literal('0'), name: z.string() }),
      migrate: (raw: unknown) => {
        const record = raw as { name: string };
        return { schemaVersion: '1', name: record.name, extra: true };
      },
    },
    { schemaVersion: '1', schema: current },
  ] as StorageMigration<{ schemaVersion: '1'; name: string; extra?: boolean }>[];

  it('accepts a legal current-version document', () => {
    expect(parseStoredDocument(
      { schemaVersion: '1', name: 'ok' },
      migrations,
      'doc.json',
    )).toEqual({ schemaVersion: '1', name: 'ok' });
  });

  it('migrates an old version through the registry', () => {
    expect(parseStoredDocument(
      { schemaVersion: '0', name: 'legacy' },
      migrations,
      'doc.json',
    )).toEqual({ schemaVersion: '1', name: 'legacy', extra: true });
  });

  it('fail-closes unknown higher versions without mutating the document', () => {
    expect(() => parseStoredDocument(
      { schemaVersion: '9', name: 'future' },
      migrations,
      'doc.json',
    )).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
  });

  it('fail-closes structurally invalid current documents', () => {
    expect(() => parseStoredDocument(
      { schemaVersion: '1', name: 12 },
      migrations,
      'doc.json',
    )).toThrow(/STORAGE_SCHEMA/);
  });

  it('parses the project registry v1 contract', () => {
    const parsed = parseStoredDocument({
      schemaVersion: '1',
      projects: [{
        projectId: 'p1',
        name: 'Demo',
        rootPath: 'D:/demo',
        slug: 'demo',
        resourcePath: 'D:/demo/.rdx',
        knowledgePath: 'D:/demo/.rdx/knowledge',
        inputsPath: 'D:/demo/.rdx/inputs',
        inputs: [],
        inputsUpdatedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }],
    }, PROJECT_REGISTRY_MIGRATIONS, 'projects.json');
    expect(parsed.projects).toHaveLength(1);
  });
});

describe('StorageIo schema-backed readJson', () => {
  const roots: string[] = [];
  const io = new StorageIo();

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-storage-schema-'));
    roots.push(root);
    return root;
  }

  it('returns a valid session record', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'session.json');
    const record = {
      sessionId: 'sess_1',
      projectId: 'proj_1',
      title: 't',
      goal: '',
      sessionPath: filePath,
      createdAt: 1,
      updatedAt: 1,
    };
    io.writeJsonAtomic(filePath, record);
    expect(io.readJson(filePath, SessionRecordSchema)).toMatchObject({ sessionId: 'sess_1' });
  });

  it('quarantines structurally invalid JSON under a schema', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'session.json');
    fs.writeFileSync(filePath, JSON.stringify({ sessionId: 1 }), 'utf8');
    expect(() => io.readJson(filePath, SessionRecordSchema)).toThrow(/STORAGE_CORRUPT/);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not quarantine unknown higher schema versions', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'projects.json');
    const future = { schemaVersion: '99', projects: [] };
    fs.writeFileSync(filePath, JSON.stringify(future), 'utf8');
    expect(() => io.readJson(filePath, PROJECT_REGISTRY_MIGRATIONS)).toThrow(StorageSchemaError);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(future);
  });
});

const legalSession = {
  sessionId: 'sess_1',
  projectId: 'proj_1',
  title: 't',
  goal: '',
  sessionPath: 'D:/sess',
  createdAt: 1,
  updatedAt: 1,
};

const legalAttachment = {
  attachmentId: 'att_1',
  sessionId: 'sess_1',
  projectId: 'proj_1',
  kind: 'file' as const,
  fileName: 'note.txt',
  filePath: 'D:/note.txt',
  mimeType: 'text/plain',
  size: 4,
  createdAt: 1,
};

const legalRun = {
  runId: 'run_1',
  projectId: 'proj_1',
  sessionId: 'sess_1',
  caseId: 'sess_1',
  mode: 'debugger' as const,
  goal: 'g',
  captures: [],
  startedAt: 1,
  status: 'running' as const,
  lastStage: 'investigate',
  backend: 'local' as const,
  createdAt: 1,
  updatedAt: 1,
  runtime: {
    backend: 'local' as const,
    entry_mode: 'cli' as const,
    context_id: null,
    runtime_owner: null,
    session_id: 'sess_1',
    workflow_stage: 'investigate',
  },
};

const legalTurnCommit = {
  schemaVersion: '1',
  requestId: 'req_1',
  turnId: 'turn_1',
  phase: 'prepared' as const,
  beforeHistory: [],
  beforeBranch: null,
  beforeAttachments: [],
  afterAttachments: [],
  importedPaths: [],
};

const legalTerminalCommit = {
  schemaVersion: '1',
  requestId: 'req_1',
  turnId: 'turn_1',
  phase: 'prepared' as const,
  beforeHistory: [],
  beforeBranch: null,
  beforeContext: [],
  afterHistory: [],
  afterBranch: null,
  afterContext: [],
};

const legalEvidence = {
  schema_version: '1',
  session_id: 'sess_1',
  project_id: 'proj_1',
  latest_run_id: null,
  latest_run_status: null,
  latest_stage: null,
  updated_at: '2026-01-01T00:00:00.000Z',
  event_counts: {},
  active_blockers: [],
  verification_summary: [],
  reasoning_summaries: [],
  report_paths: null,
};

const legalRegistry = {
  schemaVersion: '1',
  projects: [{
    projectId: 'p1',
    name: 'Demo',
    rootPath: 'D:/demo',
    slug: 'demo',
    resourcePath: 'D:/demo/.rdx',
    knowledgePath: 'D:/demo/.rdx/knowledge',
    inputsPath: 'D:/demo/.rdx/inputs',
    inputs: [],
    inputsUpdatedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }],
};

describe('storage schema store quartet', () => {
  const roots: string[] = [];
  const io = new StorageIo();

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-store-quartet-'));
    roots.push(root);
    return root;
  }

  const stores = [
    {
      name: 'projects registry',
      file: 'registry.json',
      legal: legalRegistry,
      corrupt: { schemaVersion: '1', projects: 'nope' },
      missingOrLegacy: legalRegistry,
      higher: { ...legalRegistry, schemaVersion: '99' },
      read: (filePath: string) => io.readJson(filePath, PROJECT_REGISTRY_MIGRATIONS),
    },
    {
      name: 'session record',
      file: 'session.json',
      legal: legalSession,
      corrupt: { sessionId: 1 },
      missingOrLegacy: legalSession,
      higher: { ...legalSession, schemaVersion: '99' },
      read: (filePath: string) => io.readJson(filePath, SessionRecordSchema),
    },
    {
      name: 'attachments',
      file: 'attachments.json',
      legal: [legalAttachment],
      corrupt: [{ attachmentId: 1 }],
      missingOrLegacy: [legalAttachment],
      higher: { schemaVersion: '99', attachments: [legalAttachment] },
      read: (filePath: string) => io.readJson(filePath, SessionAttachmentManifestSchema),
    },
    {
      name: 'turn-commit',
      file: 'conversation-turn-commit.json',
      legal: legalTurnCommit,
      corrupt: { schemaVersion: '1', requestId: 1 },
      missingOrLegacy: legalTurnCommit,
      higher: { ...legalTurnCommit, schemaVersion: '99' },
      read: (filePath: string) => io.readJson(filePath, CONVERSATION_TURN_COMMIT_MIGRATIONS),
    },
    {
      name: 'terminal-commit',
      file: 'conversation-terminal-commit.json',
      legal: legalTerminalCommit,
      corrupt: { schemaVersion: '1', requestId: 1 },
      missingOrLegacy: legalTerminalCommit,
      higher: { ...legalTerminalCommit, schemaVersion: '99' },
      read: (filePath: string) => io.readJson(filePath, CONVERSATION_TERMINAL_COMMIT_MIGRATIONS),
    },
    {
      name: 'run',
      file: 'run.json',
      legal: legalRun,
      corrupt: { runId: 1 },
      missingOrLegacy: legalRun,
      higher: { ...legalRun, schemaVersion: '99' },
      read: (filePath: string) => io.readJson(filePath, PersistedRunRecordSchema),
    },
    {
      name: 'session evidence',
      file: 'session_evidence.yaml',
      legal: legalEvidence,
      corrupt: 'schema_version: [\n',
      missingOrLegacy: legalEvidence,
      higher: { ...legalEvidence, schema_version: '99' },
      read: (filePath: string) => io.readYaml(filePath, SESSION_EVIDENCE_MIGRATIONS),
      write: (filePath: string, value: unknown) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(
          filePath,
          typeof value === 'string' ? value : stringifyYaml(value),
          'utf8',
        );
      },
    },
    {
      name: 'settings',
      file: 'config.json',
      legal: { schemaVersion: SETTINGS_SCHEMA_VERSION, appearance: { theme: 'dark' } },
      corrupt: { schemaVersion: SETTINGS_SCHEMA_VERSION, appearance: 12 },
      missingOrLegacy: { appearance: { theme: 'dark' } },
      higher: { schemaVersion: SETTINGS_SCHEMA_VERSION + 1, appearance: { theme: 'dark' } },
      read: (filePath: string) => {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
        assertPersistedSettingsSchemaVersion(raw, filePath);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error(`STORAGE_SCHEMA: ${filePath} is not an object`);
        }
        const appearance = (raw as { appearance?: unknown }).appearance;
        if (appearance != null && (typeof appearance !== 'object' || Array.isArray(appearance))) {
          throw new Error(`STORAGE_CORRUPT: ${filePath} appearance is invalid`);
        }
        return raw;
      },
    },
  ] as const;

  it('covers every required store', () => {
    expect(stores.map((store) => store.name)).toEqual([
      'projects registry',
      'session record',
      'attachments',
      'turn-commit',
      'terminal-commit',
      'run',
      'session evidence',
      'settings',
    ]);
  });

  for (const store of stores) {
    describe(store.name, () => {
      it('accepts a legal current document', () => {
        const filePath = path.join(tempRoot(), store.file);
        if ('write' in store && store.write) {
          store.write(filePath, store.legal);
        } else {
          io.writeJsonAtomic(filePath, store.legal);
        }
        expect(store.read(filePath)).toBeTruthy();
      });

      it('fail-closes a structurally damaged document', () => {
        const filePath = path.join(tempRoot(), store.file);
        if ('write' in store && store.write) {
          store.write(filePath, store.corrupt);
        } else {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(store.corrupt), 'utf8');
        }
        expect(() => store.read(filePath)).toThrow(/STORAGE_CORRUPT|STORAGE_SCHEMA/);
      });

      it('accepts a current-shaped document without requiring a newer version', () => {
        const filePath = path.join(tempRoot(), store.file);
        if ('write' in store && store.write) {
          store.write(filePath, store.missingOrLegacy);
        } else {
          io.writeJsonAtomic(filePath, store.missingOrLegacy);
        }
        expect(store.read(filePath)).toBeTruthy();
      });

      it('fail-closes an unknown higher schemaVersion without quarantine', () => {
        const filePath = path.join(tempRoot(), store.file);
        if ('write' in store && store.write) {
          store.write(filePath, store.higher);
        } else {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(store.higher), 'utf8');
        }
        expect(() => store.read(filePath)).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
        expect(fs.existsSync(filePath)).toBe(true);
      });
    });
  }

  it('validates run.yaml fallback and fail-closes a higher schema_version', () => {
    const root = tempRoot();
    const runPath = path.join(root, 'run');
    fs.mkdirSync(runPath, { recursive: true });
    const yamlPath = path.join(runPath, 'run.yaml');
    fs.writeFileSync(yamlPath, stringifyYaml({
      schema_version: '99',
      run_id: 'run_1',
      project_id: 'proj_1',
      session_id: 'sess_1',
      case_id: 'sess_1',
      mode: 'debugger',
      goal: 'g',
      status: 'running',
      last_stage: 'investigate',
      created_at: '2026-01-01T00:00:00.000Z',
      runtime: {
        backend: 'local',
        entry_mode: 'cli',
        context_id: null,
        runtime_owner: null,
        session_id: 'sess_1',
        workflow_stage: 'investigate',
      },
      captures: [],
    }), 'utf8');
    expect(() => io.readYaml(yamlPath)).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
    expect(fs.existsSync(yamlPath)).toBe(true);
  });
});
