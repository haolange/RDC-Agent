import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { StorageIo } from '../../sessions/StorageIo';
import { artifactizeToolResult } from './ToolResultArtifactizer';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function resolverFor(sessionPath: string): SessionArtifactResolver {
  return new SessionArtifactResolver({
    resolveSessionPath: (sessionId) => (sessionId === 'sess-1' ? sessionPath : null),
    io: new StorageIo(),
  });
}

describe('ToolResultArtifactizer', () => {
  it('leaves results at or below the 32 KiB threshold in place', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-art-below-'));
    roots.push(sessionPath);
    const small = {
      content: [{ type: 'text' as const, text: 'hello' }],
      details: { path: 'a.txt' },
    };
    const result = artifactizeToolResult({
      sessionId: 'sess-1',
      toolCallId: 'tc-small',
      toolName: 'read_file',
      result: small,
      resolver: resolverFor(sessionPath),
    });
    expect(result).toEqual(small);
    expect(result.details).toMatchObject({ path: 'a.txt' });
    expect(fs.existsSync(path.join(sessionPath, 'session-artifacts'))).toBe(false);
  });

  it('offloads oversized successful results to session://tool-outputs', () => {
    const sessionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rdx-art-over-'));
    roots.push(sessionPath);
    fs.writeFileSync(path.join(sessionPath, 'session.json'), '{}');
    const huge = 'x'.repeat(TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES + 64);
    const result = artifactizeToolResult({
      sessionId: 'sess-1',
      toolCallId: 'tc-big',
      toolName: 'grep',
      result: {
        content: [{ type: 'text', text: huge }],
        details: { matched: 9 },
      },
      resolver: resolverFor(sessionPath),
    });
    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      artifactized: true,
      ref: 'session://tool-outputs/tc-big.json',
    });
    expect(String((result.details as { hash: string }).hash)).toMatch(/^[a-f0-9]{64}$/);
    const stored = fs.readFileSync(
      path.join(sessionPath, 'session-artifacts', 'tool-outputs', 'tc-big.json'),
      'utf8',
    );
    expect(stored).toContain(huge);
    expect(JSON.stringify(result.content).length).toBeLessThan(huge.length);
  });

  it('fail-closes instead of silently truncating when offload cannot run', () => {
    const huge = 'y'.repeat(TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES + 8);
    const denied = artifactizeToolResult({
      sessionId: null,
      toolCallId: 'tc-nosess',
      toolName: 'shell',
      result: { content: [{ type: 'text', text: huge }] },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toMatch(/ARTIFACT_SESSION_DENIED/);
    expect(JSON.stringify(denied)).not.toContain(huge.slice(0, 80));
  });
});
