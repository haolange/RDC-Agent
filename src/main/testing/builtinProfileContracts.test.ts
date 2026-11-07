import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// Scripts live outside tsconfig include; the .mjs is the shared check-script contract.
// @ts-expect-error -- untyped ESM check helper
import { assertBuiltinProfileContracts, assertManifestSourceContracts } from '../../../scripts/builtin-profile-contracts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyBuiltinRuntime(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-profile-contract-'));
  tempRoots.push(root);
  cpSync(
    path.join(repoRoot, 'resources', 'agent-runtime'),
    path.join(root, 'resources', 'agent-runtime'),
    { recursive: true },
  );
  return root;
}

describe('builtin profile contracts', () => {
  it('accepts the four entry Agents, eight internal Agents and their required skills', () => {
    expect(() => assertBuiltinProfileContracts(repoRoot)).not.toThrow();
  });

  it('rejects an internal Agent that can invoke a live replay tool', () => {
    const root = copyBuiltinRuntime();
    const file = path.join(root, 'resources', 'agent-runtime', 'agents', 'verifier.agent.md');
    const source = readFileSync(file, 'utf8');
    const mutated = source.replace('  - artifact_read\n', '  - artifact_read\n  - rdc_probe\n');
    expect(mutated).not.toBe(source);
    writeFileSync(file, mutated, 'utf8');
    expect(() => assertBuiltinProfileContracts(root)).toThrow(/verifier tools must not include rdc_probe/);
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

  it('fails when builtin General imposes a default loop ceiling', () => {
    const root = copyBuiltinRuntime();
    const generalPath = path.join(root, 'resources', 'agent-runtime', 'agents', 'general.agent.md');
    writeFileSync(generalPath, readFileSync(generalPath, 'utf8').replace('enabled: true\n', 'enabled: true\nmax-turns: 50\n'), 'utf8');
    expect(() => assertBuiltinProfileContracts(root)).toThrow(/must not impose a default/);
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
