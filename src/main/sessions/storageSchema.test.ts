import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseStoredDocument,
  PROJECT_REGISTRY_MIGRATIONS,
  SessionRecordSchema,
  SessionAttachmentManifestSchema,
  toSessionAttachmentManifest,
  SESSION_USAGE_MIGRATIONS,
  SESSION_SHELL_STATE_MIGRATIONS,
  toSessionUsageManifest,
  toSessionShellStateManifest,
  SESSION_RUN_MIGRATIONS,
  CONVERSATION_TURN_COMMIT_MIGRATIONS,
  CONVERSATION_TERMINAL_COMMIT_MIGRATIONS,
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

  it('treats unversioned documents as v0 when a v0 migration exists', () => {
    expect(parseStoredDocument(
      { name: 'legacy' },
      migrations,
      'doc.json',
    )).toEqual({ schemaVersion: '1', name: 'legacy', extra: true });
  });

  it('fail-closes missing schemaVersion when no v0 migration exists', () => {
    expect(() => parseStoredDocument(
      { name: 'ok' },
      [{ schemaVersion: '1', schema: current }],
      'doc.json',
    )).toThrow(/missing schemaVersion/);
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

describe('session usage schema v2', () => {
  const legacyUsage = {
    runId: 'run_legacy',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
    contextWindowTokens: 616_000,
    usagePercent: 1,
    occupiedTokens: 12,
    breakdown: null,
    snapshotAt: 1,
  };

  it('migrates a v0 bare usage object onto promptBudgetTokens then v2 output fields', () => {
    const parsed = parseStoredDocument(legacyUsage, SESSION_USAGE_MIGRATIONS, 'usage.json');
    expect(parsed).toEqual({
      schemaVersion: '2',
      usage: {
        ...legacyUsage,
        promptBudgetTokens: 616_000,
        contextWindowTokens: null,
        maxOutputTokens: null,
        compactionThresholdTokens: null,
      },
    });
  });

  it('migrates a v1 document from outputReserveTokens to maxOutputTokens', () => {
    const parsed = parseStoredDocument({
      schemaVersion: '1',
      usage: {
        ...legacyUsage,
        promptBudgetTokens: 616_000,
        contextWindowTokens: 1_000_000,
        outputReserveTokens: 384_000,
      },
    }, SESSION_USAGE_MIGRATIONS, 'usage.json');
    expect(parsed).toEqual({
      schemaVersion: '2',
      usage: {
        ...legacyUsage,
        promptBudgetTokens: 616_000,
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 384_000,
        compactionThresholdTokens: null,
      },
    });
  });

  it('accepts a current { schemaVersion, usage } document', () => {
    const usage = {
      ...legacyUsage,
      promptBudgetTokens: 616_000,
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      compactionThresholdTokens: 800_000,
    };
    expect(parseStoredDocument(
      toSessionUsageManifest(usage),
      SESSION_USAGE_MIGRATIONS,
      'usage.json',
    )).toEqual({ schemaVersion: '2', usage });
  });

  it('fail-closes an unknown higher usage schemaVersion', () => {
    expect(() => parseStoredDocument(
      { schemaVersion: '9', usage: legacyUsage },
      SESSION_USAGE_MIGRATIONS,
      'usage.json',
    )).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
  });
});

describe('session shell-state schema', () => {
  it('accepts a current { schemaVersion, state } document', () => {
    expect(parseStoredDocument(
      toSessionShellStateManifest({ cwd: 'D:/Projects/app' }),
      SESSION_SHELL_STATE_MIGRATIONS,
      'shell-state.json',
    )).toEqual({
      schemaVersion: '1',
      state: { cwd: 'D:/Projects/app' },
    });
  });

  it('fail-closes a missing schemaVersion', () => {
    expect(() => parseStoredDocument(
      { state: { cwd: 'D:/Projects/app' } },
      SESSION_SHELL_STATE_MIGRATIONS,
      'shell-state.json',
    )).toThrow(/missing schemaVersion/);
  });

  it('quarantines a structurally invalid on-disk document', () => {
    const io = new StorageIo();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-shell-state-'));
    const filePath = path.join(root, 'shell-state.json');
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: '1', state: { cwd: 12 } }), 'utf8');
    expect(() => io.readJson(filePath, SESSION_SHELL_STATE_MIGRATIONS)).toThrow(/STORAGE_CORRUPT|STORAGE_SCHEMA/);
    expect(fs.existsSync(filePath)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fail-closes an unknown higher shell-state schemaVersion', () => {
    expect(() => parseStoredDocument(
      { schemaVersion: '9', state: { cwd: 'D:/Projects/app' } },
      SESSION_SHELL_STATE_MIGRATIONS,
      'shell-state.json',
    )).toThrow(/STORAGE_SCHEMA_UNSUPPORTED/);
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
  schemaVersion: '3' as const,
  kind: 'mission' as const,
  mission: 'debugger' as const,
  profileId: 'debugger',
  runId: 'run_1',
  projectId: 'proj_1',
  sessionId: 'sess_1',
  caseId: 'sess_1',
  goal: 'g',
  captures: [],
  startedAt: 1,
  status: 'running' as const,
  backend: 'local' as const,
  createdAt: 1,
  updatedAt: 1,
  runtime: {
    backend: 'local' as const,
    entry_mode: 'cli' as const,
    context_id: null,
    runtime_owner: null,
    session_id: 'sess_1',
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

const legalUsage = {
  runId: 'run_1',
  providerId: 'provider',
  modelId: 'model',
  inputTokens: 10,
  outputTokens: 2,
  totalTokens: 12,
  promptBudgetTokens: 100,
  contextWindowTokens: 128,
  maxOutputTokens: 28,
  compactionThresholdTokens: 80,
  usagePercent: 10,
  occupiedTokens: 10,
  breakdown: null,
  snapshotAt: 1,
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
      legal: toSessionAttachmentManifest([legalAttachment]),
      corrupt: [{ attachmentId: 1 }],
      missingOrLegacy: [legalAttachment],
      higher: { schemaVersion: '99', attachments: [legalAttachment] },
      read: (filePath: string) => io.readJson(filePath, SessionAttachmentManifestSchema),
    },
    {
      name: 'session usage',
      file: 'usage.json',
      legal: toSessionUsageManifest(legalUsage),
      corrupt: { schemaVersion: '1', usage: { runId: 1 } },
      missingOrLegacy: {
        runId: 'run_1',
        providerId: 'provider',
        modelId: 'model',
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        contextWindowTokens: 100,
        usagePercent: 10,
        occupiedTokens: 10,
        breakdown: null,
        snapshotAt: 1,
      },
      higher: { schemaVersion: '99', usage: legalUsage },
      read: (filePath: string) => io.readJson(filePath, SESSION_USAGE_MIGRATIONS),
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
      read: (filePath: string) => io.readJson(filePath, SESSION_RUN_MIGRATIONS),
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
      'session usage',
      'turn-commit',
      'terminal-commit',
      'run',
      'settings',
    ]);
  });

  for (const store of stores) {
    describe(store.name, () => {
      it('accepts a legal current document', () => {
        const filePath = path.join(tempRoot(), store.file);
        io.writeJsonAtomic(filePath, store.legal);
        const parsed = store.read(filePath);
        expect(parsed).toBeTruthy();
        if (store.name === 'attachments') {
          expect(Array.isArray(parsed)).toBe(true);
          expect((JSON.parse(fs.readFileSync(filePath, 'utf8')) as { schemaVersion?: string }).schemaVersion)
            .toBe('1');
        }
        if (store.name === 'session usage') {
          expect((parsed as { schemaVersion?: string; usage?: { promptBudgetTokens?: number } }).schemaVersion)
            .toBe('2');
          expect((parsed as { usage?: { promptBudgetTokens?: number } }).usage?.promptBudgetTokens)
            .toBe(100);
        }
      });

      it('fail-closes a structurally damaged document', () => {
        const filePath = path.join(tempRoot(), store.file);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(store.corrupt), 'utf8');
        expect(() => store.read(filePath)).toThrow(/STORAGE_CORRUPT|STORAGE_SCHEMA/);
      });

      it('accepts a current-shaped document without requiring a newer version', () => {
        const filePath = path.join(tempRoot(), store.file);
        io.writeJsonAtomic(filePath, store.missingOrLegacy);
        expect(store.read(filePath)).toBeTruthy();
      });

      it('fail-closes an unknown higher schemaVersion without quarantine', () => {
        const filePath = path.join(tempRoot(), store.file);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(store.higher), 'utf8');
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
