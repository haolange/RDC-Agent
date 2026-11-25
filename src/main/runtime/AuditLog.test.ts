import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLog, AuditWriteFailedError, auditArgumentsHash, runWithAuditOrigin, type AuditRecord } from './AuditLog';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const readRecords = (filePath: string): AuditRecord[] => fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as AuditRecord);

describe('audit log', () => {
  it('appends one record per decision, tagged with the origin that asked, across awaits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-audit-'));
    roots.push(root);
    const log = new AuditLog(path.join(root, 'state', 'audit.jsonl'));
    const argumentsSha256 = auditArgumentsHash({ command: 'git push' });

    log.record({ kind: 'tool-decision', decidedBy: 'policy', approved: false, tool: 'shell', toolCallId: 'a', argumentsSha256 });
    await runWithAuditOrigin('browser-qa', async () => {
      await Promise.resolve();
      log.record({ kind: 'tool-decision', decidedBy: 'user', approved: true, tool: 'shell', toolCallId: 'b', argumentsSha256 });
    });

    const records = readRecords(log.filePath);
    expect(records.map((record) => [record.origin, record.kind === 'tool-decision' && record.decidedBy])).toEqual([
      ['runtime', 'policy'],
      ['browser-qa', 'user'],
    ]);
    expect(fs.readFileSync(log.filePath, 'utf8')).not.toContain('git push');
  });
});

describe('audit log failure', () => {
  it('throws instead of letting an unrecorded decision proceed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-audit-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'state'), 'not a directory');
    const log = new AuditLog(path.join(root, 'state', 'audit.jsonl'));

    expect(() => log.record({ kind: 'ipc', channel: 'settings:set', argumentsSha256: 'x', outcome: 'requested' }))
      .toThrow(AuditWriteFailedError);
  });
});
