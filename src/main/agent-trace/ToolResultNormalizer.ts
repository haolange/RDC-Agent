import type { NormalizedToolResult } from '@shared/types/agenticTrace';
import type { ToolCallResult } from '@shared/types/tool';
import type { ActionEvent } from '@shared/types/evidence';

const firstLine = (value: unknown, fallback: string): string => {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.trim().split(/\r?\n/)[0]?.trim() || fallback;
};

export class ToolResultNormalizer {
  fromToolCallResult(toolName: string, result: ToolCallResult): NormalizedToolResult {
    const data = result.data;
    const summary = result.ok
      ? firstLine(data, `${toolName} 完成`)
      : firstLine(result.error?.message ?? result.error, `${toolName} 失败`);

    if (typeof data === 'string') {
      return { summary, preview: { kind: 'text', text: data }, raw: result };
    }

    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (typeof record.stdout === 'string' || typeof record.stderr === 'string') {
        return {
          summary,
          preview: {
            kind: 'log',
            stdout: String(record.stdout ?? ''),
            stderr: String(record.stderr ?? ''),
            exitCode: typeof record.exitCode === 'number' ? record.exitCode : undefined,
          },
          raw: result,
        };
      }
      if (typeof record.code === 'string') {
        return {
          summary,
          preview: {
            kind: 'code',
            code: record.code,
            language: typeof record.language === 'string' ? record.language : undefined,
            path: typeof record.path === 'string' ? record.path : undefined,
          },
          raw: result,
        };
      }
      return { summary, preview: { kind: 'json', value: data }, raw: result };
    }

    return { summary, raw: result };
  }

  fromActionEvent(event: ActionEvent): NormalizedToolResult {
    const toolName = String(event.payload.tool_name || event.payload.toolName || 'tool');
    const summary = firstLine(
      event.payload.summary ?? event.payload.result ?? event.payload.error ?? event.payload.data,
      toolName,
    );
    const payload = event.payload;
    if (typeof payload.data === 'string') {
      return { summary, preview: { kind: 'text', text: payload.data }, raw: payload };
    }
    if (payload.data && typeof payload.data === 'object') {
      return { summary, preview: { kind: 'json', value: payload.data }, raw: payload };
    }
    return { summary, preview: { kind: 'text', text: summary }, raw: payload };
  }
}

export const toolResultNormalizer = new ToolResultNormalizer();
