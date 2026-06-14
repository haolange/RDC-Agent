/**
 * CommandRegistry 单元测试。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandRegistry } from './CommandRegistry';
import type { CommandDefinition } from '@shared/types/command';

function makeCommand(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    id: overrides.id ?? 'test-cmd',
    name: overrides.name ?? 'test-cmd',
    description: overrides.description ?? 'A test command',
    aliases: overrides.aliases,
    category: overrides.category ?? 'system',
    execute: overrides.execute ?? (async () => ({ success: true, message: 'ok' })),
  };
}

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  describe('register / resolve', () => {
    it('应能解析已注册的命令', () => {
      const cmd = makeCommand({ name: 'hello' });
      registry.register(cmd);
      expect(registry.resolve('hello')).toBe(cmd);
    });

    it('未注册的命令应返回 undefined', () => {
      expect(registry.resolve('nope')).toBeUndefined();
    });

    it('应支持别名解析', () => {
      const cmd = makeCommand({ name: 'help', aliases: ['h', '?'] });
      registry.register(cmd);
      expect(registry.resolve('h')).toBe(cmd);
      expect(registry.resolve('?')).toBe(cmd);
    });

    it('别名不应覆盖已注册的独立命令', () => {
      const help = makeCommand({ name: 'help', aliases: ['h'] });
      const hi = makeCommand({ name: 'h' });
      registry.register(hi); // 先注册 h
      registry.register(help); // help 别名 h，但不应覆盖
      expect(registry.resolve('h')).toBe(hi); // 先注册的保留
    });
  });

  describe('unregister', () => {
    it('应注销命令', () => {
      const cmd = makeCommand({ name: 'test' });
      registry.register(cmd);
      registry.unregister('test');
      expect(registry.resolve('test')).toBeUndefined();
    });

    it('应同时移除别名', () => {
      const cmd = makeCommand({ name: 'help', aliases: ['h'] });
      registry.register(cmd);
      registry.unregister('help');
      expect(registry.resolve('help')).toBeUndefined();
      expect(registry.resolve('h')).toBeUndefined();
    });

    it('应清除已注册的所有别名项', () => {
      const cmd = makeCommand({ name: 'cmd', aliases: ['a1', 'a2'] });
      registry.register(cmd);
      registry.unregister('cmd');
      expect(registry.resolve('a1')).toBeUndefined();
      expect(registry.resolve('a2')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('空注册表应返回空数组', () => {
      expect(registry.list()).toHaveLength(0);
    });

    it('应返回去重的命令列表', () => {
      registry.register(makeCommand({ id: 'cmd-a', name: 'cmd-a', category: 'system' }));
      registry.register(makeCommand({ id: 'cmd-b', name: 'cmd-b', category: 'debug' }));
      expect(registry.list()).toHaveLength(2);
    });

    it('应按名称排序', () => {
      registry.register(makeCommand({ id: 'zzz', name: 'zzz' }));
      registry.register(makeCommand({ id: 'aaa', name: 'aaa' }));
      const list = registry.list();
      expect(list[0].name).toBe('aaa');
      expect(list[1].name).toBe('zzz');
    });

    it('应按 category 过滤', () => {
      registry.register(makeCommand({ name: 'sys', category: 'system' }));
      registry.register(makeCommand({ name: 'dbg', category: 'debug' }));
      const systemCmds = registry.list('system');
      expect(systemCmds).toHaveLength(1);
      expect(systemCmds[0].name).toBe('sys');
    });
  });

  describe('execute', () => {
    it('应执行命令并返回结果', async () => {
      registry.register(makeCommand({
        name: 'greet',
        execute: async (args) => ({
          success: true,
          message: `Hello, ${args[0] ?? 'world'}!`,
        }),
      }));

      const result = await registry.execute({
        input: '/greet Claude',
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Hello, Claude!');
    });

    it('不以 / 开头的输入应返回错误', async () => {
      const result = await registry.execute({ input: 'hello' });
      expect(result.success).toBe(false);
    });

    it('未知命令应返回错误', async () => {
      const result = await registry.execute({ input: '/nope' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown command');
    });

    it('命令执行异常应被捕获', async () => {
      registry.register(makeCommand({
        name: 'fail',
        execute: async () => { throw new Error('boom'); },
      }));

      const result = await registry.execute({ input: '/fail' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('boom');
    });

    it('应传递执行上下文', async () => {
      let receivedCtx: unknown;
      registry.register(makeCommand({
        name: 'ctx',
        execute: async (_args, ctx) => {
          receivedCtx = ctx;
          return { success: true, message: 'ok' };
        },
      }));

      await registry.execute({
        input: '/ctx',
        context: { sessionId: 's1', projectId: 'p1' },
      });
      expect(receivedCtx).toMatchObject({
        sessionId: 's1',
        projectId: 'p1',
      });
    });
  });
});
