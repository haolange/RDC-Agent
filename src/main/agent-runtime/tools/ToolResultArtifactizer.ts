import type { AgentToolResult } from '../agent/AgentTool';
import {
  SessionArtifactError,
  TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES,
  formatSessionArtifactUri,
} from '@shared/types/sessionArtifact';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { ToolResultSummarizer } from './ToolResultSummarizer';

const summarizer = new ToolResultSummarizer();

const SAFE_TOOL_CALL_ID = /[^A-Za-z0-9._-]+/g;

export interface ArtifactizeToolResultInput {
  sessionId: string | null | undefined;
  toolCallId: string;
  toolName: string;
  result: AgentToolResult;
  resolver?: SessionArtifactResolver;
  thresholdBytes?: number;
}

function serializeResult(result: AgentToolResult): string {
  return JSON.stringify({
    content: result.content,
    details: result.details ?? null,
  });
}

function failClosed(code: string, message: string): AgentToolResult {
  return {
    content: [{ type: 'text', text: message.startsWith(code) ? message : `${code}: ${message}` }],
    isError: true,
    details: { code, artifactized: false },
  };
}

/**
 * 超阈值工具结果卸货到 session://tool-outputs/。
 * 失败 fail-closed，禁止静默截断当成功。
 */
export function artifactizeToolResult(input: ArtifactizeToolResultInput): AgentToolResult {
  const { result } = input;
  if (result.isError === true) return result;
  let serialized: string;
  try {
    serialized = serializeResult(result);
  } catch (error) {
    return failClosed(
      'ARTIFACT_WRITE_FAILED',
      error instanceof Error ? error.message : String(error),
    );
  }
  const threshold = input.thresholdBytes ?? TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES;
  if (Buffer.byteLength(serialized, 'utf8') <= threshold) {
    return result;
  }

  const sessionId = input.sessionId?.trim() || null;
  if (!sessionId) {
    return failClosed('ARTIFACT_SESSION_DENIED', 'cannot offload a tool result without an owning session.');
  }

  const toolCallId = (input.toolCallId || 'tool').replace(SAFE_TOOL_CALL_ID, '_').slice(0, 80) || 'tool';
  const relativePath = `${toolCallId}.json`;
  const uri = formatSessionArtifactUri('tool-outputs', relativePath);
  const resolver = input.resolver ?? sessionArtifactResolver;
  const mimeType = 'application/json';

  try {
    const written = resolver.write(sessionId, uri, Buffer.from(serialized, 'utf8'), { mimeType });
    const summary = summarizer.trySummarize(input.toolName, result, 400)
      ?? `[${input.toolName}] ${written.bytes} bytes stored`;
    return {
      content: [{
        type: 'text',
        text: `${summary}\nref: ${written.uri}\nhash: ${written.hash}`,
      }],
      details: {
        artifactized: true,
        ref: written.uri,
        hash: written.hash,
        summary,
        bytes: written.bytes,
        mimeType: written.mimeType,
      },
    };
  } catch (error) {
    if (error instanceof SessionArtifactError) {
      return failClosed(error.code, error.message);
    }
    return failClosed(
      'ARTIFACT_WRITE_FAILED',
      error instanceof Error ? error.message : String(error),
    );
  }
}
