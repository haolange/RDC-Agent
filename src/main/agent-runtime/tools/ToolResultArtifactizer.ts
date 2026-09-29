import * as crypto from 'crypto';
import * as fs from 'fs';
import type { AgentToolResult } from '../agent/AgentTool';
import {
  SessionArtifactError,
  TOOL_RESULT_ARTIFACTIZE_THRESHOLD_BYTES,
  formatSessionArtifactUri,
  type SessionArtifactizedEnvelope,
} from '@shared/types/sessionArtifact';
import { sessionArtifactResolver, type SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { delegatedArtifactOwner, grantDelegatedOutput } from '../../sessions/DelegatedArtifactAccess';
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
  /** Preserve a small result inline while also giving it a durable evidence URI. */
  pinBelowThreshold?: boolean;
}

function serializeResult(result: AgentToolResult): string {
  return JSON.stringify({
    content: result.content,
    details: result.details ?? null,
  });
}

function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function serializeEnvelope(
  sessionId: string,
  toolName: string,
  toolCallId: string,
  result: AgentToolResult,
  storedContent: unknown = result.content,
): { envelope: string; record: SessionArtifactizedEnvelope } {
  const payload = JSON.stringify({ content: storedContent, details: result.details ?? null });
  const payloadBytes = Buffer.from(payload, 'utf8');
  const parsed = JSON.parse(payload) as { content: unknown; details: unknown };
  const record: SessionArtifactizedEnvelope = {
    owner: sessionId,
    ownerScope: 'product-session',
    source: { toolName, toolCallId },
    hash: sha256Hex(payloadBytes),
    size: payloadBytes.length,
    mime: 'application/json',
    content: parsed.content,
    details: parsed.details,
  };
  const serialized = JSON.stringify(record);
  const chunks = Array.from({ length: Math.ceil(serialized.length / 4000) }, (_, index) => serialized.slice(index * 4000, (index + 1) * 4000));
  return { envelope: JSON.stringify({ encoding: 'json-chunks', reconstruction: 'Join chunks without separators, then parse JSON.', chunks }, null, 2), record };
}

function failClosed(code: string, message: string): AgentToolResult {
  return {
    content: [{ type: 'text', text: message.startsWith(code) ? message : `${code}: ${message}` }],
    isError: true,
    details: { code, artifactized: false },
  };
}

const IMAGE_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function removeIncompleteImageArtifacts(
  resolver: SessionArtifactResolver,
  sessionId: string,
  created: Array<{ uri: string; hash: string }>,
): void {
  for (const image of created) {
    try {
      const target = resolver.resolve(sessionId, image.uri).absolutePath;
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) continue;
      if (sha256Hex(fs.readFileSync(target)) === image.hash) fs.unlinkSync(target);
    } catch {
      // A failed offload remains a failure; never remove a path we cannot verify.
    }
  }
}

/**
 * 超阈值工具结果卸货到 session://tool-outputs/。
 * 失败 fail-closed，禁止静默截断当成功。
 */
export function artifactizeToolResult(input: ArtifactizeToolResultInput): AgentToolResult {
  const { result } = input;
  // Artifact reads already enforce paging, hash, scope and vision limits. Rewrapping
  // their pages creates recursive references and makes original recovery impossible.
  if (input.toolName === 'artifact_read') return result;
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
  const belowThreshold = Buffer.byteLength(serialized, 'utf8') <= threshold;
  if (belowThreshold && !input.pinBelowThreshold) {
    return result;
  }

  const sessionId = input.sessionId?.trim() || null;
  if (!sessionId) {
    return failClosed('ARTIFACT_SESSION_DENIED', 'cannot offload a tool result without an owning session.');
  }

  const toolCallId = (input.toolCallId || 'tool').replace(SAFE_TOOL_CALL_ID, '_').slice(0, 80) || 'tool';
  const ownerSessionId = delegatedArtifactOwner(sessionId) ?? sessionId;
  const childPrefix = ownerSessionId === sessionId ? '' : `${sha256Hex(Buffer.from(sessionId)).slice(0, 24)}-`;
  const relativePath = `${childPrefix}${toolCallId}.json`;
  const uri = formatSessionArtifactUri('tool-outputs', relativePath);
  const resolver = input.resolver ?? sessionArtifactResolver;
  const mimeType = 'application/json';
  const createdImages: Array<{ uri: string; hash: string }> = [];
  let manifestWritten = false;

  try {
    // Keep image bytes as native image artifacts. Embedding base64 in the JSON
    // envelope applies the text-file cap to an otherwise valid raster and makes
    // read_image fail before its pixels can reach the model.
    const storedContent = result.content.map((block, index) => {
      if (block.type !== 'image' || !block.data) return block;
      const extension = IMAGE_EXTENSION[block.mimeType];
      if (!extension) throw new SessionArtifactError('ARTIFACT_MIME_DENIED', `unsupported image MIME: ${block.mimeType}`);
      const imageUri = formatSessionArtifactUri('tool-outputs', `${childPrefix}${toolCallId}-image-${index}.${extension}`);
      if (fs.existsSync(resolver.resolve(ownerSessionId, imageUri).absolutePath)) {
        throw new SessionArtifactError('ARTIFACT_WRITE_FAILED', `image artifact already exists: ${imageUri}`);
      }
      const bytes = Buffer.from(block.data, 'base64');
      const written = resolver.write(ownerSessionId, imageUri, bytes, { mimeType: block.mimeType });
      createdImages.push({ uri: written.uri, hash: written.hash });
      return { type: 'image', ref: written.uri, hash: written.hash, mimeType: block.mimeType, bytes: bytes.length };
    });
    const { envelope, record } = serializeEnvelope(ownerSessionId, input.toolName, input.toolCallId || toolCallId, result, storedContent);
    const written = resolver.write(ownerSessionId, uri, Buffer.from(envelope, 'utf8'), { mimeType });
    manifestWritten = true;
    for (const image of createdImages) grantDelegatedOutput(sessionId, image.uri, image.hash);
    grantDelegatedOutput(sessionId, written.uri, written.hash);
    if (belowThreshold) {
      return {
        ...result,
        content: [...result.content, { type: 'text', text: `Evidence ref: ${written.uri}\nhash: ${written.hash}` }],
        details: { ...(typeof result.details === 'object' && result.details !== null ? result.details : {}),
          evidenceArtifact: { ref: written.uri, hash: written.hash, owner: record.owner, ownerScope: record.ownerScope, source: record.source } },
      };
    }
    const summary = summarizer.trySummarize(input.toolName, result, 400)
      ?? `[${input.toolName}] ${record.size} bytes stored`;
    // Offload large text and evidence payloads, but keep native image blocks in
    // the model result. ContextManager bridges them into the next vision input;
    // replacing them with a URI would make read_image look successful while the
    // model never receives pixels.
    const imageBlocks = result.content.filter((block) => block.type === 'image' && Boolean(block.data));
    return {
      isError: result.isError,
      content: [
        { type: 'text', text: `${summary}\nref: ${written.uri}\nhash: ${written.hash}` },
        ...imageBlocks,
      ],
      details: {
        artifactized: true,
        ref: written.uri,
        hash: written.hash,
        summary,
        bytes: record.size,
        mimeType: record.mime,
        owner: record.owner,
        ownerScope: record.ownerScope,
        source: record.source,
      },
    };
  } catch (error) {
    if (!manifestWritten) removeIncompleteImageArtifacts(resolver, ownerSessionId, createdImages);
    if (error instanceof SessionArtifactError) {
      return failClosed(error.code, error.message);
    }
    return failClosed(
      'ARTIFACT_WRITE_FAILED',
      error instanceof Error ? error.message : String(error),
    );
  }
}
