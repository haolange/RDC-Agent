import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isolateHome } from '../../testing/isolatedHome';
import { compileFixturePolicy } from '../../testing/policyFixture';
import { isToolDeniedByPolicy, resolvePolicyApprovalFloor, compileEffectivePolicy } from './PolicyCompiler';

describe('PolicyCompiler', () => {
  it('defaults to one child level without capping explicit policy limits', () => {
    expect(compileFixturePolicy({}).maxChildDepth).toBe(1);
    expect(compileFixturePolicy({ limits: { maxChildDepth: 0 } }).maxChildDepth).toBe(0);
    expect(compileFixturePolicy({ limits: { maxChildDepth: 2 } }).maxChildDepth).toBe(2);
  });

  it('takes the strictest explicit child depth across enabled policies', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-depth-user-'));
    const userRoot = path.join(home, '.rdc-agent');
    const restoreHome = isolateHome(home);
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-depth-project-'));
    try {
      fs.mkdirSync(path.join(userRoot, 'policies'), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, '.rdc-agent', 'policies'), { recursive: true });
      const userFile = path.join(userRoot, 'policies', 'user.policy.yml');
      const projectFile = path.join(projectRoot, '.rdc-agent', 'policies', 'project.policy.yml');
      fs.writeFileSync(userFile, 'limits:\n  maxChildDepth: 3\n');
      fs.writeFileSync(projectFile, 'limits:\n  maxChildDepth: 2\n');
      expect(compileEffectivePolicy(projectRoot).maxChildDepth).toBe(2);
      fs.writeFileSync(userFile, 'limits:\n  maxChildDepth: 2\n');
      fs.writeFileSync(projectFile, 'limits:\n  maxChildDepth: 3\n');
      expect(compileEffectivePolicy(projectRoot).maxChildDepth).toBe(2);
    } finally {
      restoreHome();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('compiles deniedTools, approval floors, and limits', () => {
    const compiled = compileFixturePolicy({
      deniedTools: ['Shell', 'web-search'],
      approval: 'mutation',
      approvalFloorByTool: { read_file: 'user' },
      limits: { maxTurns: 12, maxToolCalls: 40, maxSubagents: 2, maxChildDepth: 3, maxWallTimeMs: 60000 },
    });
    expect(isToolDeniedByPolicy(compiled, 'shell')).toBe(true);
    expect(isToolDeniedByPolicy(compiled, 'web_search')).toBe(true);
    expect(isToolDeniedByPolicy(compiled, 'read_file')).toBe(false);
    expect(compiled.approvalFloorByTool.read_file).toBe('user');
    expect(resolvePolicyApprovalFloor(compiled, 'write_file', 'mutation')).toBe('user');
    expect(compiled.maxTurns).toBe(12);
    expect(compiled.maxToolCalls).toBe(40);
    expect(compiled.maxSubagents).toBe(2);
    expect(compiled.maxChildDepth).toBe(3);
    expect(compiled.maxWallTimeMs).toBe(60000);
    expect(compiled.contextCompactionPercent).toBe(100);
  });

  it('compiles contextCompactionPercent and lets project policy only tighten it', () => {
    expect(
      compileFixturePolicy({
        limits: { contextCompactionPercent: 70 },
      }).contextCompactionPercent,
    ).toBe(70);

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-user-'));
    const userRoot = path.join(home, '.rdc-agent');
    const restoreHome = isolateHome(home);
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-project-'));
    try {
      fs.mkdirSync(path.join(userRoot, 'policies'), { recursive: true });
      fs.writeFileSync(
        path.join(userRoot, 'policies', 'user.policy.yml'),
        'limits:\n  contextCompactionPercent: 80\n',
        'utf8',
      );
      fs.mkdirSync(path.join(projectRoot, '.rdc-agent', 'policies'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, '.rdc-agent', 'policies', 'project.policy.yml'),
        'limits:\n  contextCompactionPercent: 70\n',
        'utf8',
      );
      expect(compileEffectivePolicy(projectRoot).contextCompactionPercent).toBe(70);

      fs.writeFileSync(
        path.join(projectRoot, '.rdc-agent', 'policies', 'project.policy.yml'),
        'limits:\n  contextCompactionPercent: 90\n',
        'utf8',
      );
      expect(() => compileEffectivePolicy(projectRoot)).toThrow(/cannot raise contextCompactionPercent/);
    } finally {
      restoreHome();
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('filters disabled policies before restrictive merge', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-'));
    const restoreHome = isolateHome(root);
    try {
      const policies = path.join(root, '.rdc-agent', 'policies');
      fs.mkdirSync(policies, { recursive: true });
      fs.writeFileSync(
        path.join(policies, '01-disabled.policy.yml'),
        'enabled: false\nlimits:\n  maxTurns: 0\n',
        'utf8',
      );
      fs.writeFileSync(path.join(policies, '02-active.policy.yml'), 'limits:\n  maxTurns: 7\n', 'utf8');
      expect(compileEffectivePolicy(null).maxTurns).toBe(7);
    } finally {
      restoreHome();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fail-closed on invalid policy fields', () => {
    expect(() =>
      compileFixturePolicy({
        deniedTools: [1 as unknown as string],
      }),
    ).toThrow(/POLICY_INVALID/);
    expect(() =>
      compileFixturePolicy({
        approval: 'maybe' as 'none',
      }),
    ).toThrow(/POLICY_INVALID/);
    expect(() =>
      compileFixturePolicy({
        limits: { maxTurns: -1 },
      }),
    ).toThrow(/POLICY_INVALID/);
    expect(() =>
      compileFixturePolicy({
        limits: { maxTurns: 1.5 },
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      compileFixturePolicy({
        limits: { maxOutputBytes: 10 },
      }),
    ).toThrow(/unknown limit/);
  });
});
