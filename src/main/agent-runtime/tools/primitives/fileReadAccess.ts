import fs from 'fs';
import { pathComparisonKey } from '../../../platform/paths';
import type { ToolExecutionContext } from '../../agent/AgentTool';

function readKey(absolute: string): string {
  return pathComparisonKey(fs.realpathSync(absolute));
}

export function recordSuccessfulFileRead(absolute: string, context?: ToolExecutionContext): void {
  context?.successfulFileReads?.add(readKey(absolute));
}

export function requireSuccessfulFileRead(absolute: string, context?: ToolExecutionContext): void {
  if (!context?.successfulFileReads?.has(readKey(absolute))) {
    throw new Error('READ_BEFORE_EDIT_REQUIRED: successfully read_file this path in the current session before editing or overwriting it.');
  }
}
