import fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { ConversationMessage } from '@shared/types/conversation';
import type { SessionContextTurnEntry } from '../conversation/SessionContextJournal';
import type { ConversationTerminalAppendJournal, TerminalAppendFile } from './storageCommitTypes';

const CHUNK_BYTES = 64 * 1024;

function fingerprint(filePath: string, append: string): TerminalAppendFile {
  const existed = fs.existsSync(filePath);
  const hash = createHash('sha256');
  let bytes = 0;
  if (existed) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      let count: number;
      let lastByte: number | undefined;
      while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        hash.update(buffer.subarray(0, count));
        bytes += count;
        lastByte = buffer[count - 1];
      }
      if (bytes > 0 && lastByte !== 10) throw new Error('Terminal JSONL prefix is not newline-terminated.');
    } finally {
      fs.closeSync(fd);
    }
  }
  return { existed, bytes, sha256: hash.digest('hex'), append };
}

export function prepareTerminalAppend(
  sessionPath: string,
  requestId: string,
  turnId: string,
  assistant: ConversationMessage,
  context: SessionContextTurnEntry,
  appendContext: boolean,
  replaceAssistant: boolean,
): ConversationTerminalAppendJournal {
  const historyRecord = replaceAssistant
    ? { op: 'delta', id: assistant.id, patch: assistant, updatedAt: assistant.updatedAt ?? assistant.createdAt }
    : assistant;
  return {
    schemaVersion: '2', requestId, turnId, phase: 'prepared',
    history: fingerprint(path.join(sessionPath, 'conversation.jsonl'), `${JSON.stringify(historyRecord)}\n`),
    context: fingerprint(path.join(sessionPath, 'session-context.jsonl'), appendContext ? `${JSON.stringify(context)}\n` : ''),
  };
}

/** Validate both prefixes and every possible partial tail BEFORE modifying either file. */
function validateFile(filePath: string, expected: TerminalAppendFile): void {
  const hash = createHash('sha256');
  if (!fs.existsSync(filePath)) {
    if (expected.existed || expected.bytes !== 0 || expected.sha256 !== hash.digest('hex')) {
      throw new Error('Terminal append prefix is missing.');
    }
    return;
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const append = Buffer.from(expected.append, 'utf8');
    if (size < expected.bytes || size > expected.bytes + append.length) {
      throw new Error('Terminal append has an unexpected file length.');
    }
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let position = 0;
    while (position < expected.bytes) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, expected.bytes - position), position);
      if (!count) throw new Error('Terminal append prefix ended early.');
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    if (hash.digest('hex') !== expected.sha256) throw new Error('Terminal append prefix hash mismatch.');
    while (position < size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
      if (!count || !buffer.subarray(0, count).equals(append.subarray(position - expected.bytes, position - expected.bytes + count))) {
        throw new Error('Terminal append contains an unrelated tail.');
      }
      position += count;
    }
  } finally {
    fs.closeSync(fd);
  }
}

function applyFile(filePath: string, expected: TerminalAppendFile, forward: boolean): void {
  if (!forward && !expected.existed) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  const fd = fs.openSync(filePath, fs.existsSync(filePath) ? 'r+' : 'w+');
  try {
    fs.ftruncateSync(fd, expected.bytes);
    if (forward) {
      const buffer = Buffer.from(expected.append, 'utf8');
      let written = 0;
      while (written < buffer.length) {
        const count = fs.writeSync(fd, buffer, written, buffer.length - written, expected.bytes + written);
        if (!count) throw new Error('Terminal append write made no progress.');
        written += count;
      }
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export function applyTerminalAppend(sessionPath: string, journal: ConversationTerminalAppendJournal, forward: boolean): ConversationMessage {
  const record = JSON.parse(journal.history.append) as Partial<ConversationMessage> & { op?: unknown; patch?: Partial<ConversationMessage> };
  const assistant = record.op === 'delta' ? record.patch : record;
  if (!assistant || (record.op === 'delta' && record.id !== assistant.id)) throw new Error('Terminal append delta ownership mismatch.');
  if (assistant.role !== 'assistant' || assistant.turnId !== journal.turnId || assistant.requestId !== journal.requestId) {
    throw new Error('Terminal append message ownership mismatch.');
  }
  if (journal.context.append) {
    const context = JSON.parse(journal.context.append) as Partial<SessionContextTurnEntry>;
    if (context.schemaVersion !== 2 || context.turnId !== journal.turnId || context.assistantMessageId !== assistant.id) {
      throw new Error('Terminal append context ownership mismatch.');
    }
  }
  // Paths are fixed by the owning session, never accepted from the WAL.
  const historyPath = path.join(sessionPath, 'conversation.jsonl');
  const contextPath = path.join(sessionPath, 'session-context.jsonl');
  validateFile(historyPath, journal.history);
  validateFile(contextPath, journal.context);
  applyFile(historyPath, journal.history, forward);
  applyFile(contextPath, journal.context, forward);
  return assistant as ConversationMessage;
}
