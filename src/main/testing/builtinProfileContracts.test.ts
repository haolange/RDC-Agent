import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// Scripts live outside tsconfig include; the .mjs is the shared check-script contract.
// @ts-expect-error -- untyped ESM check helper
import { assertBuiltinProfileContracts, assertManifestSourceContracts } from '../../../scripts/builtin-profile-contracts.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyBuiltinRuntime(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdx-profile-contract-'));
  tempRoots.push(root);
  cpSync(
    path.join(repoRoot, 'resources', 'agent-runtime'),
    path.join(root, 'resources', 'agent-runtime'),
    { recursive: true },
  );
  return root;
}

describe('builtin profile contracts', () => {
  it('accepts the four builtin agents and four root skills', () => {
    expect(() => assertBuiltinProfileContracts(repoRoot)).not.toThrow();
  });

  it('fails when a mission profile gains write tools or drops its coordinator skill', () => {
    const root = copyBuiltinRuntime();
    const debuggerPath = path.join(root, 'resources', 'agent-runtime', 'agents', 'debugger.agent.md');
    const mutated = readFileSync(debuggerPath, 'utf8')
      .replace('  - planArtifact\n', '  - write\n  - planArtifact\n')
      .replace('  - debugger-coordinator\n', '  - execution-orchestrator\n');
    writeFileSync(debuggerPath, mutated, 'utf8');
    expect(() => assertBuiltinProfileContracts(root)).toThrow(/debugger tools must not include write|must arm debugger-coordinator/);
  });

  it('fails closed on unknown tool tokens and malformed handoffs via the runtime parser', () => {
    const unknownToken = `---
name: General
target: rdc-agent
tools:
  - bash
handoffs: []
---

body
`;
    expect(() => assertManifestSourceContracts('general', unknownToken, 'general.agent.md'))
      .toThrow(/failed strict manifest parse|diagnoseManifestToolTokens|bash/);

    const malformedHandoff = `---
name: General
target: rdc-agent
tools:
  - read
handoffs:
  - label: Go
    agent: debugger
    prompt: ''
---

body
`;
    expect(() => assertManifestSourceContracts('general', malformedHandoff, 'general.agent.md'))
      .toThrow(/failed strict manifest parse|requires non-empty label, agent, and prompt/);
  });
});
