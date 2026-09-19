import fs from 'fs';
import type { ToolExecutionContext } from '../../agent/AgentTool';

function readKey(absolute: string): string {
  const resolved = fs.realpathSync(absolute);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function recordSuccessfulFileRead(absolute: string, context?: ToolExecutionContext): void {
  context?.successfulFileReads?.add(readKey(absolute));
}

export function requireSuccessfulFileRead(absolute: string, context?: ToolExecutionContext): void {
  if (!context?.successfulFileReads?.has(readKey(absolute))) {
    throw new Error('READ_BEFORE_EDIT_REQUIRED: successfully read_file this path in the current session before editing or overwriting it.');
  }
}
