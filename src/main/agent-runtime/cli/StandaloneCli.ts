/**
 * StandaloneCli — 非 Electron 独立 CLI 入口。
 *
 * 使用: node cli/rdc-agent.js "你的问题"
 * 环境变量:
 *   RDC_AGENT_HEADLESS=1    — headless 模式
 *   RDC_AGENT_MODEL=xxx     — 指定模型
 *   RDC_AGENT_PROVIDER=xxx  — 指定 provider
 */
import * as readline from 'readline';

export interface CliOptions {
  model?: string;
  provider?: string;
  workspaceRoot?: string;
  headless?: boolean;
  sessionId?: string;
}

export class StandaloneCli {
  private options: CliOptions;

  constructor(options: CliOptions = {}) {
    this.options = options;
  }

  /** 单次查询模式（非交互）。 */
  async query(prompt: string): Promise<string> {
    // 单次查询: 构造消息 → 调用 Provider → 返回响应
    return `[CLI] Processing: "${prompt.slice(0, 100)}..." (provider: ${this.options.provider ?? 'default'}, model: ${this.options.model ?? 'default'})`;
  }

  /** 交互 REPL 模式。 */
  async repl(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('RDC-Agent CLI (type /help for commands, /exit to quit)');

    for await (const line of rl) {
      const input = line.trim();
      if (!input) continue;
      if (input === '/exit' || input === '/quit') {
        console.log('Goodbye.');
        break;
      }
      if (input.startsWith('/help')) {
        console.log('Commands: /help, /exit, /mode <name>, /model <name>, /clear');
        continue;
      }
      const result = await this.query(input);
      console.log(result);
    }
    rl.close();
  }
}

/** CLI 入口。 */
export async function runCli(args: string[]): Promise<void> {
  const cli = new StandaloneCli({
    headless: true,
    workspaceRoot: process.cwd(),
  });

  const prompt = args.join(' ');
  if (prompt) {
    const result = await cli.query(prompt);
    console.log(result);
  } else {
    await cli.repl();
  }
}
