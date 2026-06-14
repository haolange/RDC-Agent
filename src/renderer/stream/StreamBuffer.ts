/**
 * StreamBuffer — 流式文本缓冲器。
 *
 * 累积 text deltas 并按帧率（requestAnimationFrame）批量输出，
 * 减少 React re-render 次数，提升流式渲染流畅度。
 */

export class StreamBuffer {
  private buffer = '';
  private rafId: number | null = null;
  private onFlush: (text: string) => void;

  constructor(onFlush: (text: string) => void) {
    this.onFlush = onFlush;
  }

  /** 追加文本片段。 */
  append(delta: string): void {
    this.buffer += delta;
    this.scheduleFlush();
  }

  /** 强制立即刷新缓冲区。 */
  flush(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.buffer.length > 0) {
      const text = this.buffer;
      this.buffer = '';
      this.onFlush(text);
    }
  }

  /** 使用 requestAnimationFrame 调度刷新。 */
  private scheduleFlush(): void {
    if (this.rafId !== null) return; // 已调度
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.buffer.length > 0) {
        const text = this.buffer;
        this.buffer = '';
        this.onFlush(text);
      }
    });
  }

  /** 销毁缓冲器。 */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.buffer = '';
  }
}
