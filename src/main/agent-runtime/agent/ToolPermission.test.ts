/**
 * ToolPermission 单元测试。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolPermission,
  BashDenyListRule,
  PathEscapeRule,
  MutationApprovalRule,
  type PermissionRule,
  type PermissionContext,
} from './ToolPermission';
import type { ToolCall } from '../core/types';
import type { AgentTool } from './AgentTool';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    type: 'toolCall' as const,
    id: overrides.id ?? 'tc-1',
    name: overrides.name ?? 'bash',
    arguments: overrides.arguments ?? { command: 'ls -la' },
  };
}

function makeContext(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    toolName: 'bash',
    toolCall: makeToolCall(),
    ...overrides,
  };
}

function makeReadonlyTool(name: string): AgentTool {
  return {
    name,
    description: 'test tool',
    parameters: { type: 'object', properties: {} },
    permissionHint: 'readonly',
    execute: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
  };
}

function makeMutationTool(name: string): AgentTool {
  return {
    ...makeReadonlyTool(name),
    permissionHint: 'mutation',
  };
}

function makeDestructiveTool(name: string): AgentTool {
  return {
    ...makeReadonlyTool(name),
    permissionHint: 'destructive',
  };
}

describe('ToolPermission', () => {
  let tp: ToolPermission;

  beforeEach(() => {
    tp = new ToolPermission();
  });

  describe('默认行为', () => {
    it('无规则时应 allow', () => {
      const result = tp.evaluate(makeContext());
      expect(result.decision).toBe('allow');
    });
  });

  describe('Layer 0: Allowlist', () => {
    it('不在白名单应 deny', () => {
      tp.setAllowlist(['read_file', 'write_file']);
      const result = tp.evaluate(makeContext({ toolName: 'bash' }));
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('bash');
    });

    it('在白名单应通过到下一层', () => {
      tp.setAllowlist(['bash', 'read_file']);
      const result = tp.evaluate(makeContext({ toolName: 'bash' }));
      expect(result.decision).toBe('allow');
    });

    it('clearAllowlist 应恢复不限制', () => {
      tp.setAllowlist(['read_file']);
      tp.clearAllowlist();
      const result = tp.evaluate(makeContext({ toolName: 'bash' }));
      expect(result.decision).toBe('allow');
    });
  });

  describe('Layer 1: HardDeny', () => {
    it('硬拒绝规则命中时应 deny', () => {
      tp.addHardDenyRule(new BashDenyListRule());
      const result = tp.evaluate(
        makeContext({
          toolName: 'bash',
          toolCall: makeToolCall({ arguments: { command: 'rm -rf /' } }),
        }),
      );
      expect(result.decision).toBe('deny');
    });

    it('硬拒绝规则未命中时继续到下一层', () => {
      tp.addHardDenyRule(new BashDenyListRule());
      const result = tp.evaluate(
        makeContext({
          toolName: 'bash',
          toolCall: makeToolCall({ arguments: { command: 'ls -la' } }),
        }),
      );
      expect(result.decision).toBe('allow');
    });
  });

  describe('Layer 2: Policy', () => {
    it('policy deny 应 deny', () => {
      const denyRule: PermissionRule = {
        name: 'always-deny-test',
        evaluate: () => ({ decision: 'deny', reason: 'test deny' }),
      };
      tp.addPolicyRule(denyRule);
      const result = tp.evaluate(makeContext());
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('always-deny-test');
    });

    it('policy ask_user 应 ask_user', () => {
      const askRule: PermissionRule = {
        name: 'ask-rule',
        evaluate: () => ({ decision: 'ask_user', reason: 'need confirm' }),
      };
      tp.addPolicyRule(askRule);
      const result = tp.evaluate(makeContext());
      expect(result.decision).toBe('ask_user');
    });
  });

  describe('Layer 3: Approval', () => {
    it('标记了审批要求的工具应 ask_user', () => {
      tp.markRequiresApproval('bash');
      const result = tp.evaluate(makeContext({ toolName: 'bash' }));
      expect(result.decision).toBe('ask_user');
    });

    it('取消审批标记后应 allow', () => {
      tp.markRequiresApproval('bash');
      tp.unmarkRequiresApproval('bash');
      const result = tp.evaluate(makeContext({ toolName: 'bash' }));
      expect(result.decision).toBe('allow');
    });
  });

  describe('硬拒绝优先级最高', () => {
    it('即使白名单包含，硬拒绝规则仍应生效', () => {
      tp.setAllowlist(['bash']);
      tp.addHardDenyRule(new BashDenyListRule());
      const result = tp.evaluate(
        makeContext({
          toolName: 'bash',
          toolCall: makeToolCall({ arguments: { command: 'rm -rf /' } }),
        }),
      );
      expect(result.decision).toBe('deny');
    });
  });
});

describe('BashDenyListRule', () => {
  const rule = new BashDenyListRule();

  it('非 bash 工具应直接 allow', () => {
    const ctx = makeContext({ toolName: 'read_file' });
    expect(rule.evaluate(ctx).decision).toBe('allow');
  });

  it('安全命令应 allow', () => {
    const ctx = makeContext({
      toolCall: {
        type: 'toolCall' as const,
        id: 'tc-1',
        name: 'bash',
        arguments: { command: 'ls -la' },
      },
    });
    expect(rule.evaluate(ctx).decision).toBe('allow');
  });

  it.each([
    'rm -rf /',
    'rm -rf /*',
    'sudo rm file',
    'shutdown now',
    'reboot',
    'mkfs /dev/sda',
    'dd if=/dev/zero',
    '> /dev/sda',
    'chmod 777 file',
    'format c:',
    'format /q',
    ':(){ :|:& };:',
  ])('危险命令 "%s" 应 deny', (cmd) => {
    const ctx = makeContext({
      toolCall: {
        type: 'toolCall' as const,
        id: 'tc-1',
        name: 'bash',
        arguments: { command: cmd },
      },
    });
    expect(rule.evaluate(ctx).decision).toBe('deny');
  });
});

describe('PathEscapeRule', () => {
  it('workspace 内路径应 allow', () => {
    const rule = new PathEscapeRule('/home/user/project');
    const ctx = makeContext({
      toolName: 'write_file',
      toolCall: {
        type: 'toolCall' as const,
        id: 'tc-1',
        name: 'write_file',
        arguments: { path: 'src/file.ts' },
      },
    });
    expect(rule.evaluate(ctx).decision).toBe('allow');
  });

  it('workspace 外路径应 deny', () => {
    const rule = new PathEscapeRule('/home/user/project');
    const ctx = makeContext({
      toolName: 'write_file',
      toolCall: {
        type: 'toolCall' as const,
        id: 'tc-1',
        name: 'write_file',
        arguments: { path: '/etc/passwd' },
      },
    });
    expect(rule.evaluate(ctx).decision).toBe('deny');
  });

  it('无 path 参数时应 allow', () => {
    const rule = new PathEscapeRule('/home/user/project');
    const ctx = makeContext({
      toolName: 'bash',
      toolCall: {
        type: 'toolCall' as const,
        id: 'tc-1',
        name: 'bash',
        arguments: { command: 'ls' },
      },
    });
    expect(rule.evaluate(ctx).decision).toBe('allow');
  });
});

describe('MutationApprovalRule', () => {
  it('readonly 工具应 allow', () => {
    const rule = new MutationApprovalRule();
    const ctx = makeContext({ tool: makeReadonlyTool('read_file') });
    expect(rule.evaluate(ctx).decision).toBe('allow');
  });

  it('mutation 工具应 ask_user', () => {
    const rule = new MutationApprovalRule();
    const ctx = makeContext({ tool: makeMutationTool('write_file') });
    expect(rule.evaluate(ctx).decision).toBe('ask_user');
  });

  it('destructive 工具应 ask_user', () => {
    const rule = new MutationApprovalRule();
    const ctx = makeContext({ tool: makeDestructiveTool('delete_all') });
    expect(rule.evaluate(ctx).decision).toBe('ask_user');
  });
});
