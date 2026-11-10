import { delegatedArtifactOwner, resolveDelegatedArtifactRead, grantDelegatedOutput, assertDelegatedArtifactWrite } from '../sessions/artifacts/DelegatedArtifactAccess';
import {
  INVESTIGATION_ARTIFACT_KINDS,
  INVESTIGATION_ARTIFACT_STATUSES,
  resolveInvestigationKind,
  type InvestigationMission,
} from '@shared/types/renderdocInvestigation';
import type { AgentTool, AgentToolResult } from '../agent-runtime/agent/AgentTool';
import { InvestigationError, toInvestigationError } from './investigationErrors';
import { getInvestigationRecordJsonSchema } from './investigationRecordSchemas';
import { recordKeyOf } from './investigationRecordKeys';
import {
  investigationArtifactService,
  type InvestigationArtifactService,
  type InvestigationWriteInput,
} from './InvestigationArtifactService';

export const INVESTIGATION_TOOL_IDS = [
  'investigation_schema',
  'investigation_read',
  'investigation_write',
  'investigation_list',
] as const;

export interface InvestigationToolDependencies {
  service: InvestigationArtifactService;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textResult<TDetails>(text: string, details: TDetails, isError = false): AgentToolResult<TDetails> {
  return { content: [{ type: 'text', text }], isError, details };
}

function errorResult(error: unknown): AgentToolResult<Record<string, unknown>> {
  const mapped = toInvestigationError(error);
  return textResult(mapped.message, {
    ok: false,
    code: mapped.code,
    invariantId: mapped.invariantId,
    details: mapped.details,
  }, true);
}

function parseWriteStatus(value: unknown): 'draft' | 'ready' {
  if (value == null || value === '') return 'draft';
  const status = asString(value);
  if (status === 'draft' || status === 'ready') return status;
  throw new InvestigationError('INVESTIGATION_SCHEMA_INVALID', `illegal status "${asString(value) || String(value)}"`);
}

function parseListFilter(value: unknown, field: 'kind' | 'status'): string | undefined {
  if (value == null || value === '') return undefined;
  const parsed = asString(value);
  if (parsed === 'any') return undefined;
  const allowed = field === 'kind' ? INVESTIGATION_ARTIFACT_KINDS : INVESTIGATION_ARTIFACT_STATUSES;
  if (allowed.some((entry) => entry === parsed)) return parsed;
  throw new InvestigationError(
    field === 'kind' ? 'INVESTIGATION_KIND_UNKNOWN' : 'INVESTIGATION_SCHEMA_INVALID',
    `invalid ${field} filter "${parsed || String(value)}"; use "any" or omit ${field} to include all ${field === 'status' ? 'statuses' : 'kinds'}`,
  );
}

function defaultDependencies(): InvestigationToolDependencies {
  return { service: investigationArtifactService };
}

export function createInvestigationTools(
  sessionId?: string | null,
  overrides: Partial<InvestigationToolDependencies> = {},
): AgentTool[] {
  const deps: InvestigationToolDependencies = { ...defaultDependencies(), ...overrides };
  return [
    createInvestigationSchemaTool(),
    createInvestigationReadTool(sessionId, deps),
    createInvestigationWriteTool(sessionId, deps),
    createInvestigationListTool(sessionId, deps),
  ];
}

function createInvestigationSchemaTool(): AgentTool {
  return {
    name: 'investigation_schema',
    label: 'Read Investigation Schema',
    description: 'Read the authoritative rdc.investigation.v1 input shape for one kind. This does not read records; use tool_search to activate investigation_read or investigation_list for existing records, or investigation_write to save one.',
    parameters: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { type: 'string', description: 'Closed Kind Registry id, such as world_state or evidence' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      const entry = resolveInvestigationKind(asString(args.kind));
      if (!entry) return errorResult(new InvestigationError('INVESTIGATION_SCHEMA_INVALID', `unknown kind "${asString(args.kind)}"`));
      const recordSchema = getInvestigationRecordJsonSchema(entry.recordType);
      const nextStep = 'Schema only. To retrieve an existing record, use tool_search query=investigation_read; to enumerate records, use tool_search query=investigation_list; to save a record, use tool_search query=investigation_write. Repeating this call does not retrieve record content.';
      const recordIdPolicy = entry.kind === 'claim_set'
        ? 'ClaimSet.items define ClaimRecords, not references to previously written claims. New claimIds must be unique; when versioning through supersedes, retain the IDs of continuing claims. Current items can be sources for report projections.'
        : entry.kind === 'report'
          ? 'A ready report projects existing ClaimRecords, including members of a current ClaimSet. Read the source ClaimSet and preserve each source claimId, epistemic and verification in compactProvenance.'
          : entry.kind === 'evidence' || entry.kind === 'evidence_pack'
            ? 'Write each artifactRefs URI and expectedHash once. The service derives stored contentHashes; omit that derived field even when copying a previously read record.'
          : undefined;
      return textResult(
        JSON.stringify({ kind: entry.kind, recordType: entry.recordType, nextStep, recordIdPolicy, schema: recordSchema }),
        { ok: true, kind: entry.kind, recordType: entry.recordType, nextStep, recordIdPolicy, schema: recordSchema },
      );
    },
  };
}

function createInvestigationReadTool(
  sessionId: string | null | undefined,
  deps: InvestigationToolDependencies,
): AgentTool {
  return {
    name: 'investigation_read',
    label: 'Read Investigation Artifact',
    description: 'Read one session-owned rdc.investigation.v1 artifact by artifactId. Fails closed if the hash or schema does not match.',
    parameters: {
      type: 'object',
      required: ['artifactId'],
      properties: {
        artifactId: { type: 'string', description: 'Investigation artifact id' },
        expectedHash: { type: 'string', description: 'Optional sha256 of the content bytes' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      try {
        const artifactId = asString(args.artifactId);
        if (!artifactId) return errorResult(new InvestigationError('INVESTIGATION_SCHEMA_INVALID', 'artifactId is required'));
        const result = deps.service.readRecord(delegatedArtifactOwner(sessionId) ?? sessionId, artifactId, asString(args.expectedHash) || undefined);
        if (sessionId) resolveDelegatedArtifactRead(sessionId, result.contentUri, result.contentHash);
        return textResult(
          `${result.manifest.kind}\t${result.manifest.status}\t${result.manifest.title}\nmetadata\t${JSON.stringify({ artifactId, status: result.manifest.status, contentRef: result.contentUri, contentHash: result.contentHash, supersedes: result.manifest.supersedes ?? null })}\n${JSON.stringify(result.record)}`,
          { ok: true, artifactId, manifest: result.manifest, record: result.record, contentUri: result.contentUri, contentHash: result.contentHash },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}

function createInvestigationWriteTool(
  sessionId: string | null | undefined,
  deps: InvestigationToolDependencies,
): AgentTool {
  return {
    name: 'investigation_write',
    label: 'Write Investigation Artifact',
    description: 'Write or version a session-owned rdc.investigation.v1 record through InvestigationArtifactService. Schema and invariants fail closed; ready is never set on invalid records. A delegated read grant does not authorize replacing its source record. Independent reviewers return findings and their own outputs; the owning parent versions parent records.',
    parameters: {
      type: 'object',
      required: ['kind', 'mission', 'title', 'summary', 'record'],
      properties: {
        kind: { type: 'string', description: 'Closed Kind Registry id, e.g. claim or experiment' },
        mission: { type: 'string', description: 'debugger | analyzer | optimizer' },
        title: { type: 'string' },
        summary: { type: 'string' },
        record: { type: 'object', description: 'Record body matching the kind schema' },
        sourceRefs: {
          type: 'array',
          description: 'Required and non-empty for ready writes, including Challenges. Cite existing Investigation artifacts as {artifactId, expectedHash} from investigation_read/list. A record targetRef, worldStateId, or evidence artifactRefs does not replace these manifest provenance references.',
          items: {
            type: 'object',
            required: ['artifactId', 'expectedHash'],
            properties: {
              artifactId: { type: 'string' },
              expectedHash: { type: 'string', description: 'Exact source contentHash from investigation_read/list, including the sha256: prefix (sha256:<64 hex>). Required for ready writes.' },
            },
          },
        },
        worldStateId: { type: 'string' },
        supersedes: { type: 'string' },
        status: { type: 'string', description: 'Artifact readiness: draft or ready. Ready requires at least one valid sourceRefs entry; this is separate from Challenge record.status=open/resolved/wont_fix.' },
        artifactId: { type: 'string' },
      },
    },
    permissionHint: 'session_mutation',
    spec: {
      isReadOnly: false,
      isConcurrencySafe: false,
      isDestructive: false,
      sideEffect: 'session',
      category: 'system',
      requiresApproval: false,
    },
    async execute(_id, args) {
      try {
        const input: InvestigationWriteInput = {
          kind: asString(args.kind),
          mission: asString(args.mission) as InvestigationMission,
          title: asString(args.title),
          summary: asString(args.summary),
          record: args.record,
          sourceRefs: Array.isArray(args.sourceRefs)
            ? args.sourceRefs.map((entry) => ({
              artifactId: asString((entry as { artifactId?: unknown }).artifactId),
              expectedHash: asString((entry as { expectedHash?: unknown }).expectedHash),
            }))
            : undefined,
          worldStateId: asString(args.worldStateId) || undefined,
          supersedes: asString(args.supersedes) || undefined,
          status: parseWriteStatus(args.status),
          artifactId: asString(args.artifactId) || undefined,
        };
        const owner = delegatedArtifactOwner(sessionId);
        if (owner && sessionId) {
          for (const ref of input.sourceRefs ?? []) {
            const source = deps.service.readRecord(owner, ref.artifactId, ref.expectedHash);
            resolveDelegatedArtifactRead(sessionId, source.contentUri, source.contentHash);
          }
          if (input.supersedes) {
            const previous = deps.service.readRecord(owner, input.supersedes);
            assertDelegatedArtifactWrite(sessionId, previous.contentUri);
          }
          if (input.artifactId) {
            const existing = deps.service.list(owner).find(item => item.artifactId === input.artifactId);
            if (existing) assertDelegatedArtifactWrite(sessionId, deps.service.readRecord(owner, existing.artifactId).contentUri);
          }
        }
        const result = deps.service.writeRecord(owner ?? sessionId, input);
        if (owner && sessionId) grantDelegatedOutput(sessionId, result.contentUri, result.contentHash);
        const recordKey = recordKeyOf(result.manifest.kind, result.record);
        return textResult(
          `${result.manifest.artifactId}\t${result.manifest.kind}\t${result.manifest.status}\t${result.contentHash}${recordKey ? `\trecordKey=${recordKey}` : ''}`,
          { ok: true, ...result },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}

function createInvestigationListTool(
  sessionId: string | null | undefined,
  deps: InvestigationToolDependencies,
): AgentTool {
  return {
    name: 'investigation_list',
    label: 'List Investigation Artifacts',
    description: 'List session-owned rdc.investigation.v1 artifact manifests with contentUri and contentHash. Kind filters select artifact kinds, not records embedded in a ClaimSet. Use kind/status "any" (or omit a filter) to include every value; invalid filters fail instead of looking like an empty session. To delegate a record for child investigation_read, place its exact contentUri in the Capsule read refs; an artifactId in scope does not grant access. Does not invent a graph.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['any', ...INVESTIGATION_ARTIFACT_KINDS], description: 'Exact kind, or "any" for all kinds.' },
        status: { type: 'string', enum: ['any', ...INVESTIGATION_ARTIFACT_STATUSES], description: 'Exact status, or "any" for all statuses.' },
      },
    },
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: 'search',
      requiresApproval: false,
    },
    async execute(_id, args) {
      try {
        const owner = delegatedArtifactOwner(sessionId);
        const kind = parseListFilter(args.kind, 'kind');
        const status = parseListFilter(args.status, 'status');
        const items = deps.service.list(owner ?? sessionId, {
          kind,
          status,
        }).filter(item => {
          if (!owner || !sessionId) return true;
          const result = deps.service.readRecord(owner, item.artifactId);
          try { resolveDelegatedArtifactRead(sessionId, result.contentUri, result.contentHash); return true; } catch { return false; }
        });
        const lines = items.map((item) => JSON.stringify({ artifactId: item.artifactId, kind: item.kind, status: item.status, recordKey: item.recordKey, contentUri: item.contentUri, contentHash: item.contentHash, supersedes: item.supersedes ?? null }));
        const summary = lines.length > 0 ? `artifacts\t${items.length}\n${lines.join('\n')}`
          : kind || status ? 'No Investigation artifacts match the requested filters.' : 'No Investigation artifacts in this session.';
        const claimSetNote = kind === 'claim'
          ? '\nThis filter lists standalone Claim artifacts only. Current ClaimSet items are also ClaimRecord sources; list and read an accessible claim_set to use its members.'
          : '';
        return textResult(
          summary + claimSetNote,
          { ok: true, count: items.length, artifacts: items },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
