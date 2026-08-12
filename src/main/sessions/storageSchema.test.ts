import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseStoredDocument,
  PROJECT_REGISTRY_MIGRATIONS,
  SessionRecordSchema,
  StorageSchemaError,
  type StorageMigration,
} from './storageSchema';
import { StorageIo } from './StorageIo';
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
