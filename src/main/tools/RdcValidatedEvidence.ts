import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { RdcOperationDefinition } from '@shared/types/tool';
import type { ToolExecutionContext } from '../agent-runtime/agent/AgentTool';
import { safeResolvePath } from '../agent-runtime/tools/primitives/_shared';
import { canonicalJson } from './RdcOperationCatalog';

export type RdcValidatedEvidence =
  | { kind: 'measurement'; method: 'event_durations' | 'counters' | 'image' | 'frame_timing'; conditionsFingerprint: string; values: unknown }
  | { kind: 'intervention' | 'rollback'; replacementId: string };
const replacements = new Map<string, { contextId: string; experimentId: string }>();
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const eventId = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
function invalid(): never { throw new Error('RDC_EVIDENCE_INVALID: native result does not provide supported execution evidence.'); }
export function verifyRollbackIdentity(definition: RdcOperationDefinition, args: Record<string, unknown>, contextId: string, experimentId?: string): void {
  if (definition.evidence_kind !== 'rollback' || !experimentId) return;
  const known = replacements.get(String(args.replacement_id));
  if (!known || known.contextId !== contextId || known.experimentId !== experimentId) throw new Error('RDC_EVIDENCE_INVALID: rollback must match a host-verified intervention for this experiment.');
}
export async function validateExecutionEvidence(definition: RdcOperationDefinition, args: Record<string, unknown>, result: Record<string, unknown>, context: ToolExecutionContext, contextId: string, experimentId: string): Promise<RdcValidatedEvidence> {
  if (definition.evidence_kind === 'intervention') {
    if (typeof result.replacement_id !== 'string' || !result.replacement_id || result.status !== 'applied'
      || !eventId(result.resolved_event_id) || !result.replacement || typeof result.replacement !== 'object'
      || (result.replacement as Record<string, unknown>).replacement_id !== result.replacement_id
      || (result.replacement as Record<string, unknown>).status !== 'applied') invalid();
    replacements.set(result.replacement_id, { contextId, experimentId });
    return { kind: 'intervention', replacementId: result.replacement_id };
  }
  if (definition.evidence_kind === 'rollback') {
    if (typeof result.replacement_id !== 'string' || !result.replacement_id || args.replacement_id !== result.replacement_id || result.reverted !== true) invalid();
    verifyRollbackIdentity(definition, args, contextId, experimentId); replacements.delete(result.replacement_id);
    return { kind: 'rollback', replacementId: result.replacement_id };
  }
  if (definition.evidence_kind !== 'measurement') invalid();
  if (result.frame_timing && typeof result.frame_timing === 'object') {
    const timing = result.frame_timing as Record<string, unknown>;
    const sampling = timing.sampling as Record<string, unknown> | undefined;
    const range = timing.range as Record<string, unknown> | undefined;
    const captureId = context.rdcBinding?.identity?.runtimeContext?.captureFileId;
    const expectedReplacements = [...replacements.entries()].filter(([, value]) => value.contextId === contextId).map(([id]) => id).sort();
    if (!captureId || result.capture_file_id !== captureId || timing.valid !== true
      || timing.method !== 'gpu_timestamp_full_replay' || timing.unit !== 'seconds'
      || timing.scope !== 'single_queue_complete_replay' || timing.includes_initial_contents !== false
      || timing.includes_replay_scheduling_gaps !== true || timing.original_application_frame_time !== false
      || !Array.isArray(timing.samples) || timing.samples.length !== (args.samples ?? 3)
      || timing.samples.some(value => !finite(value) || Number(value) <= 0)
      || sampling?.samples !== (args.samples ?? 3) || sampling?.warmup !== (args.warmup ?? 1)
      || range?.first_event_id !== 1 || !eventId(range?.last_event_id) || Number(range?.last_event_id) < 1
      || !Array.isArray(result.replacement_ids) || canonicalJson([...result.replacement_ids].sort()) !== canonicalJson(expectedReplacements)) invalid();
    return { kind: 'measurement', method: 'frame_timing', conditionsFingerprint: digest({
      captureId, method: timing.method, scope: timing.scope, unit: timing.unit, range, sampling,
      includesInitialContents: false, includesReplaySchedulingGaps: true,
    }), values: timing.samples };
  }
  if (Array.isArray(result.event_durations)) {
    const rows = result.event_durations as Record<string, unknown>[];
    if (!rows.length || rows.some(row => !row || !eventId(row.event_id) || !finite(row.duration_us) || Number(row.duration_us) < 0)
      || new Set(rows.map(row => row.event_id)).size !== rows.length) invalid();
    const samples = [...rows].sort((a, b) => Number(a.event_id) - Number(b.event_id));
    return { kind: 'measurement', method: 'event_durations', conditionsFingerprint: digest({ events: samples.map(row => row.event_id), unit: 'us' }), values: samples.map(row => row.duration_us) };
  }
  if (result.perf && typeof result.perf === 'object') {
    const rows = (result.perf as Record<string, unknown>).samples;
    if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || !eventId(row.event_id) || !Number.isSafeInteger(row.counter_id) || !finite(row.value))) invalid();
    const samples = [...rows].sort((a, b) => a.event_id - b.event_id || a.counter_id - b.counter_id);
    const identities = samples.map(row => [row.event_id, row.counter_id, row.counter_name ?? '']);
    if (new Set(identities.map(row => JSON.stringify(row))).size !== samples.length) invalid();
    return { kind: 'measurement', method: 'counters', conditionsFingerprint: digest(identities), values: samples.map(row => row.value) };
  }
  const imagePath = result.image_path ?? result.saved_path;
  if (typeof imagePath === 'string' && typeof args.output_path === 'string') {
    const resolved = safeResolvePath(imagePath, undefined, context);
    if (resolved !== safeResolvePath(args.output_path, undefined, context)) invalid();
    const stat = fs.statSync(resolved); const resolvedEvent = result.resolved_event_id ?? args.event_id;
    if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024 * 1024 || !eventId(resolvedEvent)) invalid();
    const header = Buffer.alloc(10); const fd = fs.openSync(resolved, 'r');
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    if (!(header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || header.readUInt16BE(0) === 0xffd8
      || header.readUInt32LE(0) === 20000630 || header.toString('ascii').startsWith('#?RADIANCE') || header.toString('ascii').startsWith('#?RGBE'))) invalid();
    const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(resolved)) hash.update(chunk);
    return { kind: 'measurement', method: 'image', conditionsFingerprint: digest({ event: resolvedEvent, texture: result.texture_id ?? args.texture_id ?? null, width: result.width ?? null, height: result.height ?? null, format: result.selected_formats ?? args.file_format ?? 'png' }), values: { sha256: hash.digest('hex'), bytes: stat.size } };
  }
  return invalid();
}
