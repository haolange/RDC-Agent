import type { InvestigationMission } from '@shared/types/renderdocInvestigation';
import type { AgentTool, AgentToolResult } from '../agent-runtime/agent/AgentTool';
import { InvestigationError, toInvestigationError } from './investigationErrors';
import {
  investigationArtifactService,
  type InvestigationArtifactService,
  type InvestigationWriteInput,
} from './InvestigationArtifactService';

export const INVESTIGATION_TOOL_IDS = [
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

function defaultDependencies(): InvestigationToolDependencies {
  return { service: investigationArtifactService };
}

export function createInvestigationTools(
  sessionId?: string | null,
  overrides: Partial<InvestigationToolDependencies> = {},
): AgentTool[] {
  const deps: InvestigationToolDependencies = { ...defaultDependencies(), ...overrides };
  return [
    createInvestigationReadTool(sessionId, deps),
    createInvestigationWriteTool(sessionId, deps),
    createInvestigationListTool(sessionId, deps),
  ];
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
        const result = deps.service.readRecord(sessionId, artifactId, asString(args.expectedHash) || undefined);
        return textResult(
          `${result.manifest.kind}\t${result.manifest.status}\t${result.manifest.title}\n${JSON.stringify(result.record)}`,
          { ok: true, artifactId, manifest: result.manifest, record: result.record, contentHash: result.contentHash },
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
    description: 'Write or version a session-owned rdc.investigation.v1 record through InvestigationArtifactService. Schema and invariants fail closed; ready is never set on invalid records.',
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
          items: {
            type: 'object',
            properties: {
              artifactId: { type: 'string' },
              expectedHash: { type: 'string' },
            },
          },
        },
        worldStateId: { type: 'string' },
        supersedes: { type: 'string' },
        status: { type: 'string', description: 'draft or ready; ready fail-closed' },
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
        const result = deps.service.writeRecord(sessionId, input);
        return textResult(
          `${result.manifest.artifactId}\t${result.manifest.kind}\t${result.manifest.status}\t${result.contentHash}`,
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
    description: 'List session-owned rdc.investigation.v1 manifests. Does not invent a graph.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        status: { type: 'string' },
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
        const items = deps.service.list(sessionId, {
          kind: asString(args.kind) || undefined,
          status: asString(args.status) || undefined,
        });
        const lines = items.map((item) => `${item.artifactId}\t${item.kind}\t${item.status}\t${item.recordKey}`);
        return textResult(
          lines.length > 0 ? `artifacts\t${items.length}\n${lines.join('\n')}` : 'No Investigation artifacts in this session.',
          { ok: true, count: items.length, artifacts: items },
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
