import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  compilePolicyFromRestrictive,
  isToolDeniedByPolicy,
  resolvePolicyApprovalFloor,
  compileEffectivePolicy,
} from './PolicyCompiler';

describe('PolicyCompiler', () => {
  it('compiles deniedTools, approval floors, and limits', () => {
    const compiled = compilePolicyFromRestrictive({
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
    expect(compilePolicyFromRestrictive({
      limits: { contextCompactionPercent: 70 },
    }).contextCompactionPercent).toBe(70);

    const previousHome = process.env.RDC_AGENT_HOME;
    const userRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-user-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-project-'));
    try {
      process.env.RDC_AGENT_HOME = userRoot;
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
      if (previousHome === undefined) delete process.env.RDC_AGENT_HOME;
      else process.env.RDC_AGENT_HOME = previousHome;
      fs.rmSync(userRoot, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });


  it('filters disabled policies before restrictive merge', () => {
    const previousHome = process.env.RDC_AGENT_HOME;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-policy-'));
    try {
      process.env.RDC_AGENT_HOME = root;
      const policies = path.join(root, 'policies');
      fs.mkdirSync(policies, { recursive: true });
      fs.writeFileSync(path.join(policies, '01-disabled.policy.yml'), 'enabled: false\nlimits:\n  maxTurns: 0\n', 'utf8');
      fs.writeFileSync(path.join(policies, '02-active.policy.yml'), 'limits:\n  maxTurns: 7\n', 'utf8');
      expect(compileEffectivePolicy(null).maxTurns).toBe(7);
    } finally {
      if (previousHome === undefined) delete process.env.RDC_AGENT_HOME;
      else process.env.RDC_AGENT_HOME = previousHome;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fail-closed on invalid policy fields', () => {
    expect(() => compilePolicyFromRestrictive({
      deniedTools: [1 as unknown as string],
    })).toThrow(/POLICY_INVALID/);
    expect(() => compilePolicyFromRestrictive({
      approval: 'maybe' as 'none',
    })).toThrow(/POLICY_INVALID/);
    expect(() => compilePolicyFromRestrictive({
      limits: { maxTurns: -1 },
    })).toThrow(/POLICY_INVALID/);
    expect(() => compilePolicyFromRestrictive({
      limits: { maxTurns: 1.5 },
    })).toThrow(/non-negative integer/);
    expect(() => compilePolicyFromRestrictive({
      limits: { maxOutputBytes: 10 },
    })).toThrow(/unknown limit/);
  });
});
