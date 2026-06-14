/**
 * DaemonMode — 后台运行模式 (--bg)。
 */
import { spawn } from 'child_process';

export class DaemonMode {
  /** 以后台进程方式启动 agent。 */
  static async start(sessionId?: string): Promise<{ pid: number }> {
    const args = process.argv.slice(1);
    if (sessionId) args.push('--session', sessionId);
    args.push('--headless');

    const proc = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, RDC_AGENT_DAEMON: '1' },
    });

    proc.unref();
    return { pid: proc.pid ?? -1 };
  }

  /** 检查是否在 daemon 模式运行。 */
  static isDaemon(): boolean {
    return process.env.RDC_AGENT_DAEMON === '1';
  }
}
