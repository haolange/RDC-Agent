import { resolveDelegatedArtifactRead } from '../../../sessions/DelegatedArtifactAccess';
import type { AgentTool } from '../../agent/AgentTool';
import {
  ARTIFACT_TOOL_PAGE_BYTES,
  ARTIFACT_READ_MAX_OUTPUT_LINES,
  SessionArtifactError,
} from '@shared/types/sessionArtifact';
import { sessionArtifactResolver } from '../../../sessions/SessionArtifactResolver';
import type { ArtifactJsonInspection, ArtifactJsonTextView } from '../../../sessions/SessionArtifactJsonInspection';
import { ARTIFACT_TEXT_SEARCH_MAX_MATCHES, type ArtifactTextSearch } from '../../../sessions/SessionArtifactTextSearch';
import { materializeRecordedRdcRequest, type RecordedRequestQualification } from '../../../sessions/RecordedRdcRequest';

interface ArtifactReadParams {
  uri: string;
  offset?: number;
  column?: number;
  limit?: number;
  expectedHash?: string;
  jsonTextPointers?: string[];
  textPointer?: string;
  search?: string;
  includeRecordedRequest?: boolean;
  includeRecordedOperationIndex?: boolean;
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
  jsonInspection?: ArtifactJsonInspection;
  textView?: ArtifactJsonTextView;
  search?: ArtifactTextSearch;
  recordedRequest?: { uri: string; hash: string; qualification: RecordedRequestQualification };
}

export const artifactReadTool: AgentTool<ArtifactReadParams, ArtifactReadDetails> = {
  name: 'artifact_read',
  label: '读取会话产物',
  description:
    'Read a session-owned artifact by session:// URI. Only the owning session can be read. '
    + `Returns at most ${ARTIFACT_TOOL_PAGE_BYTES} bytes / ${ARTIFACT_READ_MAX_OUTPUT_LINES} lines. Follow the returned next offset and column with the same expectedHash; concatenate page bodies without adding separators. `
    + 'For image or plain-text reads, omit JSON selectors entirely. jsonTextPointers parses JSON-encoded strings at successive RFC 6901 pointers after decoding json-chunks; [] validates the document itself. With textPointer, select a final plain string instead of JSON statistics: page/search its exact decoded text, with separate UTF-8 hash and decoding provenance. search is a case-sensitive single-line literal over the complete selected text, not a regex; returns bounded excerpts, total non-overlapping match count and a next cursor. Keep all selectors/search unchanged when continuing. JSON inspection, text selection and search require expectedHash. No code is executed; matches and statistics do not prove domain or control-flow claims.',
  parameters: {
    type: 'object',
    properties: {
      includeRecordedOperationIndex: { type: 'boolean', description: 'Owning root General only, with expectedHash and a native RDC result anchor: materialize an index of every recorded request for that same operation in this session journal. Reports missing conversation turns, deduplicated call ids, requested args, recorded return errors and available outcome refs. Not a complete native execution inventory. Read the returned separate URI/hash; reviewer requires a separate exact-reference grant. Mutually exclusive with includeRecordedRequest.' },
      includeRecordedRequest: { type: 'boolean', description: 'Opt-in for owning root General only, with expectedHash: materialize the original model RDC request from this session journal as a separately hash-bound artifact. This is requested-argument provenance, not native execution/default resolution or an experiment receipt. Child/Skeptic access remains limited to explicitly granted artifact URI/hash; no journal access.' },
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
        description: 'Optional SHA-256: 64 hex digits or sha256:<64 hex> from an Investigation record. Fail-closed with ARTIFACT_HASH_MISMATCH on mismatch.',
      },
      jsonTextPointers: {
        type: 'array', maxItems: 4,
        items: { type: 'string', maxLength: 256 },
        description: 'JSON artifacts only. Omit this property entirely when reading images or plain text; [] enables JSON inspection and is not a neutral default. Requires expectedHash. After decoding any json-chunks envelope, parse JSON text selected by each successive RFC 6901 pointer, e.g. ["/content/0/text", "/payloadJson"]. Empty array validates the JSON document. Statistics concern the final decoded value, not just the displayed page; layer hashes concern original file bytes or decoded UTF-8 text as labeled.',
      },
      textPointer: { type: 'string', maxLength: 256, description: 'JSON only: RFC 6901 pointer selecting a plain string after jsonTextPointers decoding (default chain []). Returns that string as a separately hash-bound text view, with exact CRLF/Unicode. offset/column apply to this view. Does not interpret the string as JSON, code, a path or another artifact.' },
      search: { type: 'string', minLength: 1, maxLength: 256, description: `Optional case-sensitive single-line literal search over the full selected text (decoded view when textPointer is set, otherwise the ordinary text view). Counts all non-overlapping matches; returns at most ${ARTIFACT_TEXT_SEARCH_MAX_MATCHES} bounded excerpts within the page byte budget. limit bounds returned matches; next is the first omitted match. No match is an actual empty search, not a domain conclusion. Requires expectedHash.` },
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
      if (params.includeRecordedRequest === true && params.includeRecordedOperationIndex === true) throw new SessionArtifactError('ARTIFACT_REQUEST_UNAVAILABLE', 'Choose either one recorded request or the operation index, not both.');
      const scope = resolveDelegatedArtifactRead(context.sessionId, params.uri, params.expectedHash);
      const result = sessionArtifactResolver.read(scope.sessionId, params.uri, {
        offset: params.offset,
        column: params.column,
        maxBytes: ARTIFACT_TOOL_PAGE_BYTES,
        limit: params.limit,
        expectedHash: scope.expectedHash,
        ...(params.jsonTextPointers === undefined ? {} : { jsonTextPointers: params.jsonTextPointers }),
        ...(params.textPointer === undefined ? {} : { textPointer: params.textPointer }),
        ...(params.search === undefined ? {} : { search: params.search }),
        ...(context.visionInputMode === 'native' ? { includeImageData: true } : {}),
      });
      const header = [
        result.uri,
        result.mimeType,
        `${result.bytes} bytes`,
        `sha256=${result.hash}`,
        result.owner ? `owner=${result.owner}` : null,
        result.source ? `source=${result.source.toolName}/${result.source.toolCallId}` : null,
        result.next ? `next=${JSON.stringify(result.next)}; continue with same URI/hash and text-view/search parameters; concatenate read pages verbatim` : null,
        result.textView ? `textView=${result.textView.pointer} utf8-sha256=${result.textView.sha256}` : null,
        result.search ? `literal-search total=${result.search.totalMatches} returned=${result.search.returnedMatches}; excerpts are not complete source coverage` : null,
      ].filter(Boolean).join(' · ');
      if (result.mimeType.startsWith('image/') && !result.imageData) {
        throw new Error('VISION_INPUT_UNSUPPORTED: image evidence requires a native vision route.');
      }
      const body = result.text ?? '';
      const recordedRequest = params.includeRecordedOperationIndex === true
        ? materializeRecordedRdcRequest(context, params.uri, scope.expectedHash, undefined, true)
        : params.includeRecordedRequest === true ? materializeRecordedRdcRequest(context, params.uri, scope.expectedHash) : undefined;
      return {
        content: [
          { type: 'text', text: body ? `${header}\n\n${body}` : header },
          ...(recordedRequest ? [{ type: 'text' as const, text: `Recorded model request (not native execution proof): ${JSON.stringify(recordedRequest)}` }] : []),
          ...(result.jsonInspection ? [{ type: 'text' as const, text: `Whole-artifact JSON inspection (not domain validation): ${JSON.stringify(result.jsonInspection)}` }] : []),
          ...(result.textView ? [{ type: 'text' as const, text: `Decoded text provenance (not execution or domain validation): ${JSON.stringify(result.textView)}` }] : []),
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
          ...(recordedRequest ? { recordedRequest } : {}),
          ...(result.jsonInspection ? { jsonInspection: result.jsonInspection } : {}),
          ...(result.textView ? { textView: result.textView } : {}),
          ...(result.search ? { search: result.search } : {}),
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
