import fs from 'fs';
import path from 'path';
import { z, type ZodType } from 'zod';
import { childScopePrefix } from '@shared/utils/executionScope';
import { AppError } from '@shared/errors/appError';
import {
  ProviderCacheContractSchema,
  ProviderReasoningContractSchema,
} from '@shared/provider-catalog/modelManifestSchema';
import { parseJsonWith, readValidatedSync } from '../../runtime/atomicFile';
import { appPathService } from '../../runtime/AppPathService';
import { readRequestUsage } from './RequestUsageSnapshot';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan, PromptSegment, RequestEnvelopeSnapshot } from '@shared/types/rdcRuntime';

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '-');

type MailboxDeliveries = NonNullable<RequestEnvelopeSnapshot['mailboxDeliveries']>;

const PromptSegmentsSchema: ZodType<PromptSegment[]> = z.array(
  z.object({
    id: z.string(),
    kind: z.enum([
      'core-contract',
      'agent-profile',
      'scoped-instruction',
      'preloaded-skill',
      'skill-catalog',
      'tool-capability',
      'runtime-fact',
      'plan-revision',
      'delegation-capsule',
    ]),
    scope: z.enum(['builtin', 'user', 'project', 'runtime']),
    sourcePath: z.string(),
    sourceHash: z.string(),
    precedence: z.number(),
    content: z.string(),
    stability: z.enum(['stable', 'volatile']),
    tokenEstimate: z.number(),
  }),
);

const MailboxDeliveriesSchema: ZodType<MailboxDeliveries> = z.array(
  z.object({
    executionId: z.string(),
    generation: z.number(),
    direction: z.enum(['to_parent', 'to_child']),
    throughSequence: z.number(),
    messageIds: z.array(z.string()),
  }),
);

const UsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  cacheHitTokens: z.number().optional(),
  cacheMissTokens: z.number().optional(),
  estimated: z.boolean().optional(),
});

const ReasoningEventsSchema = z.object({
  events: z.record(z.string(), z.number()),
  summaryParts: z.array(
    z.object({
      itemKey: z.string(),
      index: z.number(),
      streamedChars: z.number(),
      completedChars: z.number().optional(),
      recovered: z.boolean(),
    }),
  ),
});

/** What a request's completion adds to its snapshot, stored beside it so the large snapshot is written once. */
const CompletionSchema = z
  .object({
    completedAt: z.string(),
    usage: UsageSchema.optional(),
    reasoningEvents: ReasoningEventsSchema.optional(),
  })
  .strict();

/**
 * A stored request snapshot. The frozen RequestPlan was validated when the request was planned; on read it is checked
 * to be the object this store wrote, and every field the store and the inspector read is validated here.
 */
const RequestEnvelopeSnapshotSchema: ZodType<RequestEnvelopeSnapshot> = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    reasoningEvents: ReasoningEventsSchema.optional(),
    completedAt: z.string().optional(),
    sessionId: z.string().optional(),
    turnId: z.string().optional(),
    callIndex: z.number(),
    route: z.object({ providerId: z.string(), modelId: z.string(), protocol: z.string() }),
    requestPlan: z.custom<RequestPlan>((value) => typeof value === 'object' && value !== null && !Array.isArray(value)),
    promptPlan: z.object({
      id: z.string(),
      segments: PromptSegmentsSchema,
      systemPrompt: z.string(),
      totalTokenEstimate: z.number(),
      stablePrefix: z.object({
        fingerprint: z.string(),
        segmentIds: z.array(z.string()),
        sourceHashes: z.array(z.string()),
        tokenEstimate: z.number(),
        volatileSegmentIds: z.array(z.string()),
      }),
      metrics: z.object({ systemPrompt: z.number(), scopedInstructions: z.number(), skills: z.number() }),
      diagnostics: z.array(
        z.object({
          code: z.string(),
          severity: z.enum(['warning', 'error']),
          message: z.string(),
          sourcePath: z.string().optional(),
        }),
      ),
    }),
    messages: z.array(z.unknown()),
    mailboxDeliveries: MailboxDeliveriesSchema.optional(),
    tools: z.array(z.unknown()),
    controls: z.record(z.string(), z.unknown()),
    reasoning: ProviderReasoningContractSchema,
    cache: z.object({
      enabled: z.boolean(),
      mode: ProviderCacheContractSchema.shape.mode,
      keyCarrier: ProviderCacheContractSchema.shape.keyCarrier,
      breakpointCarrier: ProviderCacheContractSchema.shape.breakpointCarrier,
      ttl: ProviderCacheContractSchema.shape.ttl,
      prefixFingerprint: z.string().optional(),
      requestKey: z.string().optional(),
      breakpoint: z.enum(['none', 'implicit', 'automatic', 'explicit', 'automatic-and-explicit']),
      stableSegmentIds: z.array(z.string()),
      stableTokenEstimate: z.number(),
      providerReported: z.boolean(),
      reason: z.string(),
    }),
    usage: UsageSchema.optional(),
    redactions: z.array(z.object({ path: z.string(), reason: z.string(), hash: z.string().optional() })),
  })
  .strict();

/** A snapshot file listed in this store; a damaged file throws `STORAGE_CORRUPT`. */
const completionPath = (snapshotPath: string): string => snapshotPath.replace(/\.json$/u, '.completion.meta');

function readSnapshot(file: string): RequestEnvelopeSnapshot | null {
  const snapshot = readValidatedSync(file, parseJsonWith(RequestEnvelopeSnapshotSchema.parse));
  if (!snapshot) return null;
  const completion = readValidatedSync(completionPath(file), parseJsonWith(CompletionSchema.parse));
  return completion ? { ...snapshot, ...completion } : snapshot;
}

export class RequestSnapshotStore {
  private readonly promptSegmentsCache = new Map<string, { stamp: string; segments: PromptPlan['segments'] }>();
  private readonly mailboxDeliveriesCache = new Map<string, { stamp: string; deliveries: MailboxDeliveries }>();

  constructor(private readonly explicitRootPath?: string) {}

  private get rootPath(): string {
    return this.explicitRootPath ?? appPathService.getAppStatePaths().llmCallsPath;
  }

  nextCallIndex(sessionId: string | undefined, turnId: string | undefined): number {
    const dir = this.turnPath(sessionId, turnId);
    if (!fs.existsSync(dir)) return 1;
    return fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).length + 1;
  }

  readUsage(scopeId: string) {
    return readRequestUsage(this.rootPath, scopeId);
  }

  /** Delete the owning session and every nested child scope after their producers have stopped. */
  removeSession(sessionId: string): void {
    const base = this.rootPath;
    if (!fs.existsSync(base)) return;
    const own = safeSegment(sessionId);
    const childPrefix = safeSegment(childScopePrefix(sessionId));
    const entries = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.name === own || entry.name.startsWith(childPrefix));
    if (entries.some((entry) => !entry.isDirectory())) throw new AppError('REQUEST_SNAPSHOT_SCOPE_NOT_DIRECTORY');
    for (const entry of entries) {
      const scopePath = path.join(base, entry.name);
      fs.rmSync(scopePath, { recursive: true, force: true });
      for (const cache of [this.promptSegmentsCache, this.mailboxDeliveriesCache]) {
        for (const key of cache.keys()) if (key.startsWith(`${scopePath}${path.sep}`)) cache.delete(key);
      }
    }
  }

  write(snapshot: RequestEnvelopeSnapshot): void {
    const dir = this.turnPath(snapshot.sessionId, snapshot.turnId);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${String(snapshot.callIndex).padStart(3, '0')}-${safeSegment(snapshot.id)}`;
    // Compact: the snapshot carries the whole request (history included) and is written once per model call.
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(snapshot), 'utf8');
    // The right rail needs only the frozen PromptPlan segments. Keep a bounded
    // projection beside the full request so refreshing the rail never parses
    // every large message transcript in a long session.
    fs.writeFileSync(path.join(dir, 'prompt-segments.meta'), JSON.stringify(snapshot.promptPlan.segments), 'utf8');
    fs.writeFileSync(path.join(dir, `${name}.mailbox.meta`), JSON.stringify(snapshot.mailboxDeliveries ?? []), 'utf8');
  }

  listPromptSegments(sessionId: string): PromptPlan['segments'] {
    const base = path.join(this.rootPath, safeSegment(sessionId));
    if (!fs.existsSync(base)) return [];
    const segments: PromptPlan['segments'] = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      const file = path.join(dir, 'prompt-segments.meta');
      if (!fs.existsSync(file)) continue;
      const stat = fs.statSync(file);
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      let cached = this.promptSegmentsCache.get(file);
      if (!cached || cached.stamp !== stamp) {
        const segments = readValidatedSync(file, parseJsonWith(PromptSegmentsSchema.parse));
        if (!segments) continue;
        cached = { stamp, segments };
        this.promptSegmentsCache.set(file, cached);
      }
      segments.push(...cached.segments);
    }
    return segments;
  }

  listMailboxDeliveries(sessionId: string): MailboxDeliveries {
    const base = path.join(this.rootPath, safeSegment(sessionId));
    if (!fs.existsSync(base)) return [];
    const deliveries: MailboxDeliveries = [];
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(base, entry.name);
      for (const name of fs
        .readdirSync(dir)
        .filter((value) => value.endsWith('.mailbox.meta'))
        .sort()) {
        const file = path.join(dir, name);
        const stat = fs.statSync(file);
        const stamp = `${stat.size}:${stat.mtimeMs}`;
        let cached = this.mailboxDeliveriesCache.get(file);
        if (!cached || cached.stamp !== stamp) {
          const values = readValidatedSync(file, parseJsonWith(MailboxDeliveriesSchema.parse));
          if (!values) continue;
          cached = { stamp, deliveries: values };
          this.mailboxDeliveriesCache.set(file, cached);
        }
        deliveries.push(...cached.deliveries);
      }
    }
    return deliveries;
  }

  complete(
    snapshotId: string,
    sessionId: string | undefined,
    turnId: string | undefined,
    usage: RequestEnvelopeSnapshot['usage'],
    reasoningEvents?: RequestEnvelopeSnapshot['reasoningEvents'],
  ): void {
    const snapshotPath = this.findSnapshotPath(snapshotId, sessionId, turnId);
    if (!snapshotPath) return;
    // The completion goes beside the snapshot; reading the large request back to rewrite it cost as much as the
    // request itself on every model call.
    const completion = CompletionSchema.parse({
      completedAt: new Date().toISOString(),
      usage,
      ...(reasoningEvents ? { reasoningEvents } : {}),
    });
    fs.writeFileSync(completionPath(snapshotPath), JSON.stringify(completion), 'utf8');
  }

  list(sessionId: string, turnId?: string): RequestEnvelopeSnapshot[] {
    const base = turnId ? this.turnPath(sessionId, turnId) : path.join(this.rootPath, safeSegment(sessionId));
    if (!fs.existsSync(base)) return [];
    const files: string[] = [];
    const walk = (dir: string) =>
      fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(target);
        else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
      });
    walk(base);
    return files
      .flatMap((file) => readSnapshot(file) ?? [])
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.callIndex - right.callIndex);
  }

  get(sessionId: string, turnId: string, snapshotId: string): RequestEnvelopeSnapshot | null {
    const snapshotPath = this.findSnapshotPath(snapshotId, sessionId, turnId);
    return snapshotPath ? readSnapshot(snapshotPath) : null;
  }

  private turnPath(sessionId?: string, turnId?: string): string {
    return path.join(this.rootPath, safeSegment(sessionId || 'no-session'), safeSegment(turnId || 'no-turn'));
  }

  private findSnapshotPath(snapshotId: string, sessionId?: string, turnId?: string): string | null {
    const dir = this.turnPath(sessionId, turnId);
    if (!fs.existsSync(dir)) return null;
    const suffix = `-${safeSegment(snapshotId)}.json`;
    const fileName = fs.readdirSync(dir).find((entry) => entry.endsWith(suffix));
    return fileName ? path.join(dir, fileName) : null;
  }
}

export const requestSnapshotStore = new RequestSnapshotStore();
