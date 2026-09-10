import { resolveDelegatedArtifactRead } from '../../../sessions/DelegatedArtifactAccess';
import type { AgentTool } from '../../agent/AgentTool';
import {
  ARTIFACT_TOOL_PAGE_BYTES,
  ARTIFACT_READ_MAX_OUTPUT_LINES,
  SessionArtifactError,
} from '@shared/types/sessionArtifact';
import { sessionArtifactResolver } from '../../../sessions/SessionArtifactResolver';

interface ArtifactReadParams {
  uri: string;
  offset?: number;
  column?: number;
  limit?: number;
  expectedHash?: string;
}

interface ArtifactReadDetails {
  uri: string;
  mimeType: string;
  hash: string;
  bytes: number;
  truncated: boolean;
  offset: number;
  limit: number;
  totalLines?: number;
  next?: { offset: number; column: number };
  owner?: string;
  source?: { toolName: string; toolCallId: string };
}

export const artifactReadTool: AgentTool<ArtifactReadParams, ArtifactReadDetails> = {
  name: 'artifact_read',
  label: '读取会话产物',
  description:
    'Read a session-owned artifact by session:// URI. Only the owning session can be read. '
    + `Returns at most ${ARTIFACT_TOOL_PAGE_BYTES} bytes / ${ARTIFACT_READ_MAX_OUTPUT_LINES} lines. Follow the returned next offset and column with the same expectedHash; concatenate page bodies without adding separators.`,
  parameters: {
    type: 'object',
    properties: {
      uri: {
        type: 'string',
        description: 'Canonical URI: session://<plans|investigation|tool-outputs>/<relative-path>',
      },
      offset: {
        type: 'integer',
        description: 'Start line number (1-based, default: 1). Ignored for images.',
      },
      column: { type: 'integer', minimum: 0, description: 'UTF-16 column within the starting line, default 0. Use the exact next.column returned for a split line.' },
      limit: {
        type: 'integer',
        description: `Maximum lines to return (default/max: ${ARTIFACT_READ_MAX_OUTPUT_LINES}).`,
      },
      expectedHash: {
        type: 'string',
        description: 'Optional sha256 hex. Fail-closed with ARTIFACT_HASH_MISMATCH on mismatch.',
      },
    },
    required: ['uri'],
  },
  spec: {
    isReadOnly: true,
    isConcurrencySafe: true,
    isDestructive: false,
    sideEffect: 'none',
    category: 'file',
    requiresApproval: false,
  },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal, _onUpdate, context) {
    if (signal?.aborted) throw new Error('Aborted');
    if (!context?.sessionId) {
      return {
        content: [{ type: 'text', text: 'ARTIFACT_SESSION_DENIED: artifact_read requires an active owning session.' }],
        isError: true,
        details: {
          uri: params.uri,
          mimeType: '',
          hash: '',
          bytes: 0,
          truncated: false,
          offset: 1,
          limit: ARTIFACT_READ_MAX_OUTPUT_LINES,
        },
      };
    }
    try {
      const scope = resolveDelegatedArtifactRead(context.sessionId, params.uri, params.expectedHash);
      const result = sessionArtifactResolver.read(scope.sessionId, params.uri, {
        offset: params.offset,
        column: params.column,
        maxBytes: ARTIFACT_TOOL_PAGE_BYTES,
        limit: params.limit,
        expectedHash: scope.expectedHash,
        ...(context.visionInputMode === 'native' ? { includeImageData: true } : {}),
      });
      const header = [
        result.uri,
        result.mimeType,
        `${result.bytes} bytes`,
        `sha256=${result.hash}`,
        result.owner ? `owner=${result.owner}` : null,
        result.source ? `source=${result.source.toolName}/${result.source.toolCallId}` : null,
        result.next ? `next=${JSON.stringify(result.next)}; continue with same URI/hash, concatenate bodies verbatim` : null,
      ].filter(Boolean).join(' · ');
      if (result.mimeType.startsWith('image/') && !result.imageData) {
        throw new Error('VISION_INPUT_UNSUPPORTED: image evidence requires a native vision route.');
      }
      const body = result.text ?? '';
      return {
        content: [
          { type: 'text', text: body ? `${header}\n\n${body}` : header },
          ...(result.imageData ? [{ type: 'image' as const, data: result.imageData, mimeType: result.mimeType }] : []),
        ],
        details: {
          uri: result.uri,
          mimeType: result.mimeType,
          hash: result.hash,
          bytes: result.bytes,
          truncated: result.truncated,
          offset: result.offset,
          limit: result.limit,
          totalLines: result.totalLines,
          next: result.next,
          owner: result.owner,
          source: result.source,
        },
      };
    } catch (error) {
      const code = error instanceof SessionArtifactError ? error.code : 'ARTIFACT_SESSION_DENIED';
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: message.startsWith(code) ? message : `${code}: ${message}` }],
        isError: true,
        details: {
          uri: params.uri,
          mimeType: '',
          hash: '',
          bytes: 0,
          truncated: false,
          offset: 1,
          limit: ARTIFACT_READ_MAX_OUTPUT_LINES,
        },
      };
    }
  },
};
