import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import { applyTerminalAppend, prepareTerminalAppend } from './ConversationTerminalAppend';

describe('bounded terminal append transaction', () => {
  let root = '';
  const assistant = {
    id: 'assistant', requestId: 'request', turnId: 'turn', role: 'assistant', content: '终态😀',
    sessionId: 'session', projectId: 'project', createdAt: 1, updatedAt: 2, status: 'complete',
  } satisfies ConversationMessage;
  // This layer serializes the already-validated context entry, not its provider contract.
  const context = { schemaVersion: 2, turnId: 'turn', assistantMessageId: 'assistant', messages: [] } as unknown as SessionContextTurnEntry;
  const file = (name: string) => path.join(root, name);
  const prepare = () => prepareTerminalAppend(root, 'request', 'turn', assistant, context, true, false);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-terminal-append-'));
    fs.writeFileSync(file('conversation.jsonl'), '{"id":"old"}\n');
    fs.writeFileSync(file('session-context.jsonl'), '{"turnId":"old"}\n');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (root && path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('rdc-terminal-append-') && !fs.lstatSync(root).isSymbolicLink()) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the WAL proportional to one turn and never bulk-reads historical files', () => {
    fs.writeFileSync(file('session-context.jsonl'), `${JSON.stringify({ value: 'x'.repeat(1024 * 1024) })}\n`);
    const bulkRead = vi.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('bulk read forbidden'); });
    const wal = prepare();
    expect(wal.context.bytes).toBeGreaterThan(1024 * 1024);
    expect(JSON.stringify(wal).length).toBeLessThan(2000);
    applyTerminalAppend(root, wal, true);
    expect(bulkRead).not.toHaveBeenCalled();
  });

  it('rolls forward interrupted UTF8 appends and is idempotent', () => {
    const wal = prepare();
    fs.appendFileSync(file('conversation.jsonl'), Buffer.from(wal.history.append).subarray(0, Buffer.byteLength(wal.history.append) - 5));
    applyTerminalAppend(root, wal, true);
    applyTerminalAppend(root, wal, true);
    expect(fs.readFileSync(file('conversation.jsonl'), 'utf8')).toBe(`{"id":"old"}\n${wal.history.append}`);
    expect(fs.readFileSync(file('session-context.jsonl'), 'utf8')).toBe(`{"turnId":"old"}\n${wal.context.append}`);
  });

  it('rolls prepared partial writes back to exact original bytes', () => {
    const wal = prepare();
    fs.appendFileSync(file('conversation.jsonl'), wal.history.append);
    fs.appendFileSync(file('session-context.jsonl'), wal.context.append.slice(0, 10));
    applyTerminalAppend(root, wal, false);
    expect(fs.readFileSync(file('conversation.jsonl'), 'utf8')).toBe('{"id":"old"}\n');
    expect(fs.readFileSync(file('session-context.jsonl'), 'utf8')).toBe('{"turnId":"old"}\n');
  });

  it.each(['prefix', 'tail', 'missing'] as const)('rejects %s corruption before changing either file', (kind) => {
    const wal = prepare();
    if (kind === 'prefix') fs.writeFileSync(file('session-context.jsonl'), '{"turnId":"bad"}\n');
    if (kind === 'tail') fs.appendFileSync(file('session-context.jsonl'), 'unrelated');
    if (kind === 'missing') fs.unlinkSync(file('session-context.jsonl'));
    const before = fs.readFileSync(file('conversation.jsonl'));
    expect(() => applyTerminalAppend(root, wal, true)).toThrow(/Terminal append/);
    expect(fs.readFileSync(file('conversation.jsonl'))).toEqual(before);
  });

  it('recovers when the second file write failed after the first file committed', () => {
    const wal = prepare();
    const write = fs.writeSync;
    const fault = vi.spyOn(fs, 'writeSync').mockImplementationOnce(write).mockImplementationOnce(() => { throw new Error('injected context write failure'); });
    expect(() => applyTerminalAppend(root, wal, true)).toThrow('injected context write failure');
    fault.mockRestore();
    applyTerminalAppend(root, wal, true);
    expect(fs.readFileSync(file('conversation.jsonl'), 'utf8')).toBe(`{"id":"old"}\n${wal.history.append}`);
    expect(fs.readFileSync(file('session-context.jsonl'), 'utf8')).toBe(`{"turnId":"old"}\n${wal.context.append}`);
  });

  it('preserves absent-context state on rollback and creates it only on forward commit', () => {
    fs.unlinkSync(file('session-context.jsonl'));
    const wal = prepare();
    applyTerminalAppend(root, wal, false);
    expect(fs.existsSync(file('session-context.jsonl'))).toBe(false);
    applyTerminalAppend(root, wal, true);
    expect(fs.readFileSync(file('session-context.jsonl'), 'utf8')).toBe(wal.context.append);
  });

  it('rejects mismatched terminal ownership and invalid newline prefixes', () => {
    const wal = prepare();
    expect(() => applyTerminalAppend(root, { ...wal, turnId: 'other' }, true)).toThrow(/ownership/);
    fs.writeFileSync(file('session-context.jsonl'), '{"turnId":"old"}');
    expect(prepare).toThrow(/newline-terminated/);
  });
});
