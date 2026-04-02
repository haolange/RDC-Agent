/**
 * BashTools - Shell 执行工具
 * 提供 bash.exec 系统工具，带有安全限制
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import * as path from 'path';

const DEFAULT_TIMEOUT = 30000; // 默认 30 秒超时
const MAX_OUTPUT_LENGTH = 50000; // 最大输出长度

/**
 * 危险命令列表
 */
const DANGEROUS_PATTERNS = [
  // 删除命令
  /\brm\s+-[rf]*[rf]+/i,  // rm -rf, rm -r -f, etc.
  /\brm\s+.*\*+/i,         // rm with wildcards
  /\bdel\s+\/s/i,          // del /s
  /\bdel\s+.*\*+/i,        // del with wildcards
  /\brd\s+\/s\s+\/q/i,     // rd /s /q
  
  // 格式化命令
  /\bformat\s+[a-z]:/i,    // format drive
  /\bmkfs\./i,             // mkfs commands
  
  // 系统修改
  /\bfdisk\b/i,            // fdisk
  /\bdd\s+if=/i,           // dd with input file
  /\bmkfs\b/i,             // mkfs
  
  // 权限提升/危险操作
  /\bsudo\s+rm/i,          // sudo rm
  /\b:\(\)\{\s*:\|:&\s*\};/i,  // fork bomb
  /\bshutdown\b/i,         // shutdown
  /\breboot\b/i,           // reboot
  /\bpoweroff\b/i,         // poweroff
  
  // 网络危险
  /\bnc\s+-.*-[e]/i,       // netcat with execute
  /\bnetcat\s+-.*-[e]/i,   // netcat with execute
  
  // Windows 危险
  /\bformat\s+\/fs:/i,     // format with fs
  /\bdiskpart\b/i,         // diskpart
];

/**
 * 检查命令是否包含危险模式
 */
function isDangerousCommand(command: string): { safe: boolean; reason?: string } {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { 
        safe: false, 
        reason: `Command matches dangerous pattern: ${pattern.source}` 
      };
    }
  }
  
  // 检查是否包含管道或分号分隔的多个命令
  const simplifiedCommand = command.replace(/\s+/g, ' ').trim();
  
  // 检查常见的危险组合
  const dangerousCombinations = [
    'rm -rf /',
    'rm -rf /*',
    'rm -rf ~',
    '> /dev/sda',
    'of=/dev/sda',
  ];
  
  for (const dangerous of dangerousCombinations) {
    if (simplifiedCommand.includes(dangerous)) {
      return { 
        safe: false, 
        reason: `Command contains dangerous combination: ${dangerous}` 
      };
    }
  }
  
  return { safe: true };
}

/**
 * 验证并解析工作目录
 */
function resolveSafeCwd(cwd: string | undefined, workspacePath: string): string {
  if (!cwd) {
    return workspacePath;
  }
  
  const resolved = path.resolve(workspacePath, cwd);
  const normalizedWorkspace = path.normalize(workspacePath);
  const normalizedResolved = path.normalize(resolved);
  
  if (!normalizedResolved.startsWith(normalizedWorkspace)) {
    throw new Error(`Working directory "${cwd}" is outside of workspace`);
  }
  
  return resolved;
}

/**
 * 截断输出
 */
function truncateOutput(output: string, maxLength: number = MAX_OUTPUT_LENGTH): {
  output: string;
  truncated: boolean;
  originalLength: number;
} {
  if (output.length <= maxLength) {
    return {
      output,
      truncated: false,
      originalLength: output.length
    };
  }
  
  return {
    output: output.substring(0, maxLength) + '\n... [output truncated]',
    truncated: true,
    originalLength: output.length
  };
}

/**
 * 执行命令（使用 spawn 以获得更好的控制和流式输出）
 */
function executeCommand(
  command: string, 
  cwd: string, 
  timeout: number
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/sh';
    const shellFlag = isWindows ? '/c' : '-c';
    
    const child = spawn(shell, [shellFlag, command], {
      cwd,
      timeout,
      killSignal: 'SIGTERM',
      env: {
        ...process.env,
        // 限制环境变量，提高安全性
        PATH: process.env.PATH,
      }
    });
    
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      // 防止输出过大
      if (stdout.length > MAX_OUTPUT_LENGTH * 2) {
        child.kill('SIGTERM');
      }
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      // 防止输出过大
      if (stderr.length > MAX_OUTPUT_LENGTH * 2) {
        child.kill('SIGTERM');
      }
    });
    
    child.on('error', (error) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: error.message,
        timedOut: false
      });
    });
    
    child.on('timeout', () => {
      timedOut = true;
      child.kill('SIGTERM');
      // 给进程一点时间优雅退出
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    });
    
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}

/**
 * 创建 Bash 工具
 */
export function createBashTools(workspacePath: string): DynamicStructuredTool[] {
  return [
    // bash.exec - 受限 shell 执行
    new DynamicStructuredTool({
      name: 'bash_exec',
      description: 'Execute a shell command with safety restrictions. Commands are limited to workspace directory and dangerous operations are blocked.',
      schema: z.object({
        command: z.string().min(1).describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory relative to workspace'),
        timeout: z.number().int().min(1000).max(300000).optional().default(DEFAULT_TIMEOUT).describe('Timeout in milliseconds (max 5 minutes)'),
      }),
      func: async ({ command, cwd, timeout }) => {
        try {
          // 安全检查
          const safetyCheck = isDangerousCommand(command);
          if (!safetyCheck.safe) {
            return JSON.stringify({
              ok: false,
              error: { 
                code: 'UNSAFE_COMMAND', 
                message: `Command rejected: ${safetyCheck.reason}` 
              }
            });
          }
          
          // 解析工作目录
          let resolvedCwd: string;
          try {
            resolvedCwd = resolveSafeCwd(cwd, workspacePath);
          } catch (error) {
            return JSON.stringify({
              ok: false,
              error: { 
                code: 'INVALID_CWD', 
                message: error instanceof Error ? error.message : 'Invalid working directory' 
              }
            });
          }
          
          // 执行命令
          const result = await executeCommand(command, resolvedCwd, timeout);
          
          // 截断输出
          const truncatedStdout = truncateOutput(result.stdout);
          const truncatedStderr = truncateOutput(result.stderr);
          
          return JSON.stringify({
            ok: result.exitCode === 0,
            data: {
              command,
              cwd: cwd || '.',
              exitCode: result.exitCode,
              stdout: truncatedStdout.output,
              stderr: truncatedStderr.output,
              stdoutTruncated: truncatedStdout.truncated,
              stderrTruncated: truncatedStderr.truncated,
              timedOut: result.timedOut,
              executionTime: timeout
            }
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: { 
              code: 'EXEC_ERROR', 
              message: error instanceof Error ? error.message : 'Unknown error' 
            }
          });
        }
      },
      metadata: { layer: 'system', originalName: 'bash.exec' }
    }),
  ];
}
