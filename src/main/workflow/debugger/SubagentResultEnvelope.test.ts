import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { persistSubagentResult, normalizeSubagentResult, projectSubagentResult } from './SubagentResultEnvelope';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
it('persists and pages the complete result while the parent receives qualified bounded fields', () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-result-')); roots.push(root); fs.writeFileSync(path.join(root, 'session.json'), '{}');
 const resolver = new SessionArtifactResolver({ resolveSessionPath: (sessionId) => sessionId === 'owner' ? root : null });
 const complete = { status: 'complete' as const, text: 'private exploration '.repeat(10000), completionDeclaration: { disposition: 'partial' as const, evidenceRefs: [{ uri: 'session://tool-outputs/before.png', hash: 'b'.repeat(64) }], result: { summary: 'Hypothesis only', outputs: { report: 'bounded output' }, counterevidence: ['Driver Y untested'], unresolved: ['Driver Y'], scope: 'Capture A; driver X only; recheck on driver change', sideEffects: ['No mutation'], recoveryState: ['Baseline unchanged'] } } };
 const ref = persistSubagentResult('owner', 'execution-1', complete, resolver);
 const pieces: string[] = [];
 for (let offset = 1; ; offset += 2) { const read = resolver.read('owner', ref.uri, { expectedHash: ref.hash, offset, limit: 2 }); pieces.push(read.text!); if (!read.truncated) break; }
 expect(JSON.parse(JSON.parse(pieces.join('\n')).chunks.join(''))).toEqual(complete);
 const normalized = normalizeSubagentResult(complete.text, complete.status, complete.completionDeclaration, ref);
 const projection = projectSubagentResult(normalized);
 expect(projection.resultHash).toBe(ref.hash);
 expect(projection).toMatchObject({ scope: complete.completionDeclaration.result.scope, counterevidence: ['Driver Y untested'], unresolved: ['Driver Y'], sideEffects: ['No mutation'], recoveryState: ['Baseline unchanged'], evidenceRefs: complete.completionDeclaration.evidenceRefs });
 expect(JSON.stringify(projection)).not.toContain('private exploration');
});
it('marks over-limit fields as externalized without silently truncating or upgrading their meaning', () => {
 const full = { disposition: 'partial' as const, summary: 'hypothesis only', outputs: { raw: 'x'.repeat(100000) }, scope: 'fixed camera '.repeat(2000), counterevidence: ['negative '.repeat(2000)], unresolved: ['unknown'], sideEffects: [], recoveryState: [], resultRef: 'session://tool-outputs/result.json', resultHash: 'a'.repeat(64) };
 const projection = projectSubagentResult(full);
 expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(14000);
 expect(projection.externalizedFields).toEqual(expect.arrayContaining(['outputs', 'scope', 'counterevidence']));
 expect(projection.outputs).toEqual({}); expect(projection.counterevidence).toEqual([]);
 expect(projection.disposition).toBe('partial'); expect(projection.unresolved).toEqual(['unknown']);
 expect(() => projectSubagentResult({ ...full, resultRef: undefined })).toThrow('REFERENCE_REQUIRED');
});
it('never returns exploratory final text when structured completion is absent or execution failed', () => {
 for (const status of ['complete', 'failed'] as const) {
  const result = normalizeSubagentResult('private scratch reasoning', status, undefined, { uri: 'session://tool-outputs/result.json', hash: 'a'.repeat(64) });
  expect(JSON.stringify(projectSubagentResult(result))).not.toContain('private scratch');
  expect(result.disposition).not.toBe('completed');
 }
});
it('does not release a result reference on failed save or readback verification', () => {
 const read = vi.fn(() => ({ hash: 'b'.repeat(64) }));
 const resolver = { write: vi.fn(() => ({ uri: 'session://tool-outputs/x.json', hash: 'a'.repeat(64) })), read };
 expect(() => persistSubagentResult('owner', 'x', {}, resolver as never)).toThrow('VERIFY_FAILED');
 resolver.write.mockImplementation(() => { throw new Error('disk full'); });
 expect(() => persistSubagentResult('owner', 'x', {}, resolver as never)).toThrow('disk full');
});
