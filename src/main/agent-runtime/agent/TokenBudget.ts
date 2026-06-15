/**
 * TokenBudget — Token 预算管理系统。
 * 跟踪输入/输出/总 token 使用量，并在接近预算时发出警告。
 */
export class TokenBudget {
  private usedInput = 0;
  private usedOutput = 0;
  private limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get totalUsed(): number {
    return this.usedInput + this.usedOutput;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.totalUsed);
  }

  get ratio(): number {
    return this.limit > 0 ? this.totalUsed / this.limit : 0;
  }

  recordInput(tokens: number): void {
    this.usedInput += tokens;
  }

  recordOutput(tokens: number): void {
    this.usedOutput += tokens;
  }

  setLimit(limit: number): void {
    this.limit = limit;
  }

  isExceeded(): boolean {
    return this.totalUsed >= this.limit;
  }

  /**
   * 返回预算状态摘要。
   */
  status(): { input: number; output: number; total: number; limit: number; remaining: number; ratio: number } {
    return {
      input: this.usedInput,
      output: this.usedOutput,
      total: this.totalUsed,
      limit: this.limit,
      remaining: this.remaining,
      ratio: this.ratio,
    };
  }
}
