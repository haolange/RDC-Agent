import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationHistoryStore } from '../sessions/ConversationHistoryStore';
import { StorageIo } from '../sessions/StorageIo';

describe('attachment staging bytes are the commit source', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('keeps staged bytes after the original source is replaced', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-att-tx-'));
    dirs.push(root);
    const sourcePath = path.join(root, 'source.txt');
    const stagingDir = path.join(root, 'staging');
    const commitDir = path.join(root, 'commit');
    fs.writeFileSync(sourcePath, 'fingerprint-bytes');
    fs.mkdirSync(commitDir);

    const store = new ConversationHistoryStore({
      io: new StorageIo(),
    } as ConstructorParameters<typeof ConversationHistoryStore>[0]);
    const [stagedPath] = store.stageAttachmentInputs([sourcePath], stagingDir);
    expect(stagedPath).toBeTruthy();
    fs.writeFileSync(sourcePath, 'replaced-after-hash');

    const committedPath = path.join(commitDir, 'committed.txt');
    fs.copyFileSync(stagedPath!, committedPath);
    expect(fs.readFileSync(committedPath, 'utf8')).toBe('fingerprint-bytes');
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe('replaced-after-hash');
  });
});
