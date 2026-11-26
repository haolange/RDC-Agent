import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { afterEach } from 'vitest';
import { readPersistedRun } from '../run/sessionRunPersistence';
import { createDefaultSettingsFile } from '../../settings/settings-core/settingsDefaults';
import { parseSettingsFile } from '../../settings/settings-core/settingsFileSchema';
import { parseJsonWith, readValidatedSync } from '../../runtime/atomicFile';
import { stringifyYaml } from '../../runtime/yaml';
import { ProjectRegistrySchema } from '../../runtime/projectRegistrySchema';
import { StorageIo } from '../../runtime/StorageIo';
import {
  SessionRecordSchema,
  SessionAttachmentManifestSchema,
  toSessionAttachmentManifest,
  SessionUsageSchema,
  SessionShellStateSchema,
  toSessionUsageManifest,
  toSessionShellStateManifest,
  ConversationTurnCommitSchema,
  ConversationTerminalJournalSchema,
} from './storageSchema';

describe('session usage schema', () => {
  const usage = {
    runId: 'run_current',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
    promptBudgetTokens: 616_000,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    compactionThresholdTokens: 800_000,
    usagePercent: 1,
    occupiedTokens: 12,
    breakdown: null,
    snapshotAt: 1,
  };

  it('accepts a current { schemaVersion, usage } document', () => {
    expect(SessionUsageSchema.parse(toSessionUsageManifest(usage))).toEqual({ schemaVersion: '2', usage });
  });

  it('rejects retired usage fields', () => {
    expect(
      SessionUsageSchema.safeParse({
        schemaVersion: '2',
        usage: { ...usage, outputReserveTokens: 384_000 },
      }).success,
    ).toBe(false);
  });
});

describe('session shell-state schema', () => {
  it('accepts a current { schemaVersion, state } document', () => {
    expect(SessionShellStateSchema.parse(toSessionShellStateManifest({ cwd: 'D:/Projects/app' }))).toEqual({
      schemaVersion: '1',
      state: { cwd: 'D:/Projects/app' },
    });
  });

  it('reports a structurally invalid on-disk document and keeps a copy', () => {
    const io = new StorageIo();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-shell-state-'));
    const filePath = path.join(root, 'shell-state.json');
    fs.writeFileSync(filePath, JSON.stringify({ schemaVersion: '1', state: { cwd: 12 } }), 'utf8');
    expect(() => io.readJson(filePath, SessionShellStateSchema)).toThrow(/STORAGE_CORRUPT|STORAGE_SCHEMA/);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(
      fs.readdirSync(path.dirname(filePath)).some((name) => name.startsWith(`${path.basename(filePath)}.corrupt-`)),
    ).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
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
      schemaVersion: '1',
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

  it('reports structurally invalid JSON under a schema and keeps a copy', () => {
    const root = tempRoot();
    const filePath = path.join(root, 'session.json');
    fs.writeFileSync(filePath, JSON.stringify({ sessionId: 1 }), 'utf8');
    expect(() => io.readJson(filePath, SessionRecordSchema)).toThrow(/STORAGE_CORRUPT/);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(
      fs.readdirSync(path.dirname(filePath)).some((name) => name.startsWith(`${path.basename(filePath)}.corrupt-`)),
    ).toBe(true);
  });
});

const legalSession = {
  schemaVersion: '1' as const,
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
  projects: [
    {
      projectId: 'p1',
      name: 'Demo',
      rootPath: 'D:/demo',
      slug: 'demo',
      resourcePath: 'D:/demo/.rdc-agent',
      knowledgePath: 'D:/demo/.rdc-agent/knowledge',
      inputsPath: 'D:/demo/.rdc-agent/inputs',
      inputs: [],
      inputsUpdatedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

describe('external capture registry boundary', () => {
  const external = {
    inputId: 'reference_test',
    fileName: 'original.rdc',
    filePath: 'D:/source/original.rdc',
    source: 'external_reference',
    discoveredAt: 1,
    lastModifiedAt: 1,
    size: 8,
    contentSha256: 'a'.repeat(64),
    referenceIdentity: { device: '1', inode: '2', birthtimeNs: '3' },
  };
  const registry = (input: Record<string, unknown>) => ({
    ...legalRegistry,
    projects: legalRegistry.projects.map((project) => ({ ...project, inputs: [input] })),
  });
  it('keeps existing registries readable and round-trips the new exact reference fields', () => {
    expect(ProjectRegistrySchema.parse(legalRegistry)).toEqual(legalRegistry);
    expect(ProjectRegistrySchema.parse(registry(external))).toMatchObject(registry(external));
  });
  it.each(['contentSha256', 'referenceIdentity'])('rejects external references missing %s', (field) => {
    expect(ProjectRegistrySchema.safeParse(registry({ ...external, [field]: undefined })).success).toBe(false);
  });
});

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
      corrupt: { projects: 'nope' },
      read: (filePath: string) => io.readJson(filePath, ProjectRegistrySchema),
    },
    {
      name: 'session record',
      file: 'session.json',
      legal: legalSession,
      corrupt: { sessionId: 1 },
      read: (filePath: string) => io.readJson(filePath, SessionRecordSchema),
    },
    {
      name: 'attachments',
      file: 'attachments.json',
      legal: toSessionAttachmentManifest([legalAttachment]),
      corrupt: [{ attachmentId: 1 }],
      read: (filePath: string) => io.readJson(filePath, SessionAttachmentManifestSchema),
    },
    {
      name: 'session usage',
      file: 'usage.json',
      legal: toSessionUsageManifest(legalUsage),
      corrupt: { schemaVersion: '1', usage: { runId: 1 } },
      read: (filePath: string) => io.readJson(filePath, SessionUsageSchema),
    },
    {
      name: 'turn-commit',
      file: 'conversation-turn-commit.json',
      legal: legalTurnCommit,
      corrupt: { schemaVersion: '1', requestId: 1 },
      read: (filePath: string) => io.readJson(filePath, ConversationTurnCommitSchema),
    },
    {
      name: 'terminal-commit',
      file: 'conversation-terminal-commit.json',
      legal: legalTerminalCommit,
      corrupt: { schemaVersion: '1', requestId: 1 },
      read: (filePath: string) => io.readJson(filePath, ConversationTerminalJournalSchema),
    },
    {
      name: 'run',
      file: 'run.json',
      legal: legalRun,
      corrupt: { runId: 1 },
      read: (filePath: string) => readPersistedRun(io, path.dirname(filePath), 'sess_1', 'run_1'),
    },
    {
      name: 'settings',
      file: 'config.json',
      legal: createDefaultSettingsFile(),
      corrupt: { ...createDefaultSettingsFile(), appearance: 12 },
      read: (filePath: string) => readValidatedSync(filePath, parseJsonWith(parseSettingsFile)),
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
          expect((JSON.parse(fs.readFileSync(filePath, 'utf8')) as { schemaVersion?: string }).schemaVersion).toBe('1');
        }
        if (store.name === 'session usage') {
          expect((parsed as { schemaVersion?: string; usage?: { promptBudgetTokens?: number } }).schemaVersion).toBe(
            '2',
          );
          expect((parsed as { usage?: { promptBudgetTokens?: number } }).usage?.promptBudgetTokens).toBe(100);
        }
      });

      it('fail-closes a structurally damaged document', () => {
        const filePath = path.join(tempRoot(), store.file);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(store.corrupt), 'utf8');
        expect(() => store.read(filePath)).toThrow(/STORAGE_CORRUPT|STORAGE_SCHEMA/);
      });
    });
  }

  it('rejects a YAML-only Run even when its projection claims the current schema', () => {
    const root = tempRoot();
    const runPath = path.join(root, 'run');
    fs.mkdirSync(runPath, { recursive: true });
    const yamlPath = path.join(runPath, 'run.yaml');
    const original = stringifyYaml({ schema_version: '3', run_id: 'run_1' });
    fs.writeFileSync(yamlPath, original, 'utf8');
    expect(() => readPersistedRun(io, runPath, 'sess_1', 'run_1')).toThrow(/STORAGE_SCHEMA/);
    expect(fs.readFileSync(yamlPath, 'utf8')).toBe(original);
  });
});
