/**
 * EventStream 单元测试。
 */
import { describe, it, expect } from 'vitest';
import { EventStream } from './EventStream';

describe('EventStream', () => {
  describe('基本 push / complete 流程', () => {
    it('应在 for await 中接收所有 push 的事件', async () => {
      const stream = new EventStream<string>();
      stream.push('a');
      stream.push('b');
      stream.complete('done');

      const received: string[] = [];
      for await (const ev of stream) {
        received.push(ev);
      }
      expect(received).toEqual(['a', 'b']);
    });

    it('应在 complete 后返回 result', async () => {
      const stream = new EventStream<string>();
      stream.push('hello');
      stream.complete('final');

      const result = await stream.result();
      expect(result).toBe('final');
    });

    it('complete 后 push 应被忽略', async () => {
      const stream = new EventStream<string>();
      stream.push('a');
      stream.complete('done');
      stream.push('b'); // 应被忽略

      const received: string[] = [];
      for await (const ev of stream) {
        received.push(ev);
      }
      expect(received).toEqual(['a']);
    });
  });

  describe('isComplete / extractResult 自动完成', () => {
    it('当 isComplete 返回 true 时应自动调用 complete', async () => {
      const stream = new EventStream<{ type: string; data: string }, string>(
        (e) => e.type === 'done',
        (e) => e.data,
      );
      stream.push({ type: 'chunk', data: 'hello' });
      stream.push({ type: 'done', data: 'result-value' });

      const received: Array<{ type: string; data: string }> = [];
      for await (const ev of stream) {
        received.push(ev);
      }
      expect(received).toEqual([
        { type: 'chunk', data: 'hello' },
        { type: 'done', data: 'result-value' },
      ]);

      const result = await stream.result();
      expect(result).toBe('result-value');
    });

    it('未提供 extractResult 时以事件本身作为结果', async () => {
      interface MyEvent { type: string; value: number; }
      const stream = new EventStream<MyEvent>(
        (e) => e.type === 'done',
      );
      stream.push({ type: 'done', value: 42 });

      const result = await stream.result();
      expect(result).toEqual({ type: 'done', value: 42 });
    });
  });

  describe('错误处理', () => {
    it('error 应导致 result() reject', async () => {
      const stream = new EventStream<string>();
      stream.error(new Error('boom'));

      await expect(stream.result()).rejects.toThrow('boom');
    });

    it('error 应导致 for await 抛出', async () => {
      const stream = new EventStream<string>();
      stream.push('before');
      stream.error(new Error('fail'));

      const received: string[] = [];
      await expect(
        (async () => {
          for await (const ev of stream) {
            received.push(ev);
          }
        })(),
      ).rejects.toThrow('fail');
      expect(received).toEqual(['before']);
    });

    it('error 后 push 应被忽略', async () => {
      const stream = new EventStream<string>();
      stream.push('a');
      stream.error(new Error('err'));
      stream.push('b');

      const received: string[] = [];
      try {
        for await (const ev of stream) {
          received.push(ev);
        }
      } catch {
        // expected
      }
      expect(received).toEqual(['a']);
    });
  });

  describe('abort', () => {
    it('应抛出 AbortError', async () => {
      const stream = new EventStream<string>();
      stream.abort();

      await expect(stream.result()).rejects.toThrow('EventStream aborted');
    });

    it('应设置 AbortController 信号', () => {
      const stream = new EventStream<string>();
      expect(stream.signal.aborted).toBe(false);
      stream.abort();
      expect(stream.signal.aborted).toBe(true);
    });
  });

  describe('状态查询', () => {
    it('初始时 isDone === false', () => {
      const stream = new EventStream<string>();
      expect(stream.isDone).toBe(false);
    });

    it('complete 后 isDone === true', () => {
      const stream = new EventStream<string>();
      stream.complete('ok');
      expect(stream.isDone).toBe(true);
    });

    it('error 后 isDone === true', () => {
      const stream = new EventStream<string>();
      stream.error(new Error('x'));
      expect(stream.isDone).toBe(true);
    });
  });

  describe('链式操作', () => {
    it('map 应转换事件，保留 result', async () => {
      const source = new EventStream<number, string>();
      const mapped = source.map((n) => `num_${n}`);

      source.push(1);
      source.push(2);
      source.complete('final');

      const received: string[] = [];
      for await (const ev of mapped) {
        received.push(ev);
      }
      expect(received).toEqual(['num_1', 'num_2']);
      expect(await mapped.result()).toBe('final');
    });

    it('filter 应过滤事件', async () => {
      const source = new EventStream<number, string>();
      const filtered = source.filter((n) => n % 2 === 0);

      source.push(1);
      source.push(2);
      source.push(3);
      source.push(4);
      source.complete('done');

      const received: number[] = [];
      for await (const ev of filtered) {
        received.push(ev);
      }
      expect(received).toEqual([2, 4]);
      expect(await filtered.result()).toBe('done');
    });

    it('tap 应旁路观察事件', async () => {
      const source = new EventStream<number, string>();
      const observed: number[] = [];
      const tapped = source.tap((n) => observed.push(n));

      source.push(10);
      source.push(20);
      source.complete('ok');

      const received: number[] = [];
      for await (const ev of tapped) {
        received.push(ev);
      }
      expect(received).toEqual([10, 20]);
      expect(observed).toEqual([10, 20]);
    });

    it('tap 中抛出的异常不应中断流', async () => {
      const source = new EventStream<number, string>();
      const tapped = source.tap((n) => {
        if (n === 2) throw new Error('tap error');
      });

      source.push(1);
      source.push(2);
      source.push(3);
      source.complete('ok');

      const received: number[] = [];
      for await (const ev of tapped) {
        received.push(ev);
      }
      expect(received).toEqual([1, 2, 3]);
      expect(await tapped.result()).toBe('ok');
    });
  });

  describe('提前退出迭代', () => {
    it('迭代 return() 应中止流', async () => {
      const stream = new EventStream<number>();
      stream.push(1);
      stream.push(2);

      const received: number[] = [];
      for await (const ev of stream) {
        received.push(ev);
        if (ev === 1) break; // 触发 return()
      }
      expect(received).toEqual([1]);
      expect(stream.isDone).toBe(true);
    });
  });
});
