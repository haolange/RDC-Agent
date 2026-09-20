import type { RdcCliInvokerSettings } from '@shared/types/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { RdcRuntimeContext } from '@shared/types/session';
import { replayPngCodec } from '../captures/replay/replayPngCodec';
import { replayLivePreviewStore } from '../captures/replay/ReplayLivePreviewStore';
import { settingsService } from '../settings/SettingsService';
import { rdcCliInvokerService } from '../tools/RdcCliInvokerService';
import { parseRdcNativeResult } from '../tools/RdcNativeProtocol';

export interface ReplayLiveWriteTarget {
  sessionId: string;
  generation: number;
}

async function call(owner: RdcRuntimeContext, operation: string, args: Record<string, unknown>, frozenCli?: RdcCliInvokerSettings) {
  const settings = structuredClone(frozenCli ?? settingsService.getAll().tooling.rdcCli);
  const result = parseRdcNativeResult(await rdcCliInvokerService.executeCLI('call', [operation, '--args-json',
    JSON.stringify(args), '--daemon-context', owner.contextId,
  ], { contextId: owner.contextId, settings }), owner.contextId);
  if (result.result_kind !== operation || result.data.session_id !== owner.replaySessionId) throw new Error('RDC_OBSERVATION_IDENTITY_MISMATCH');
  return result.data;
}

export async function readReplayEvents(owner: RdcRuntimeContext, frozenCli?: RdcCliInvokerSettings): Promise<CaptureReplayState['events']> {
  const data = await call(owner, 'rd.session.get_replay_events', {}, frozenCli);
  if (data.complete !== true || !Array.isArray(data.events)) throw new Error('RDC_EVENTS_INCOMPLETE');
  return data.events.map((entry: { event_id: number; name: string }) => {
    if (!Number.isInteger(entry.event_id) || typeof entry.name !== 'string') throw new Error('RDC_EVENTS_INVALID');
    return { eventId: entry.event_id };
  });
}

export async function observeReplay(
  owner: RdcRuntimeContext,
  args: Record<string, unknown>,
  frozenCli?: RdcCliInvokerSettings,
  live?: ReplayLiveWriteTarget,
): Promise<Partial<CaptureReplayState>> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-replay-'));
  try {
    const imagePath = path.join(directory, 'frame.png');
    const data = await call(owner, 'rd.session.observe', { ...args, out_path: imagePath }, frozenCli);
    if (!Number.isSafeInteger(data.event_id) || Number(data.event_id) < 0) throw new Error('RDC_OBSERVATION_EVENT_INVALID');
    const eventId = data.event_id as number;
    const display = data.display_parameters as Record<string, unknown> | null;
    if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 0
      || !['baseline', 'intervention', 'restored'].includes(String(data.modification_state))
      || !display || !['mip', 'slice', 'sample'].every(key => Number.isSafeInteger(display[key]) && Number(display[key]) >= 0)
      || !['range_min', 'range_max'].every(key => typeof display[key] === 'number' && Number.isFinite(display[key]))) {
      throw new Error('RDC_OBSERVATION_METADATA_INVALID');
    }
    const targetSchema = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RDC_OBSERVATION_TARGET_INVALID');
      const target = value as Record<string, unknown>;
      if (typeof target.texture_id !== 'string' || !target.texture_id || !(target.output_slot === null || (Number.isSafeInteger(target.output_slot) && Number(target.output_slot) >= 0))) throw new Error('RDC_OBSERVATION_TARGET_INVALID');
      return { textureId: target.texture_id, outputSlot: target.output_slot as number | null };
    };
    const target = data.target === null ? null : targetSchema(data.target);
    if (!Array.isArray(data.targets)) throw new Error('RDC_OBSERVATION_TARGET_INVALID');
    const targets = data.targets.map(targetSchema);
    const remote = data.remote_display as Record<string, unknown> | undefined;
    if (!remote || !['not_applicable', 'unsupported', 'unavailable', 'presented'].includes(String(remote.status))
      || remote.event_id !== eventId
      || !(remote.texture_id === null || typeof remote.texture_id === 'string')
      || !(remote.sequence === null || (Number.isSafeInteger(remote.sequence) && Number(remote.sequence) > 0))
      || !(remote.reason === null || typeof remote.reason === 'string')) throw new Error('RDC_DISPLAY_RECEIPT_INVALID');
    if (remote.status === 'presented' && (owner.backend !== 'remote' || !target
      || remote.texture_id !== target.textureId || remote.sequence === null || remote.reason !== null)) {
      throw new Error('RDC_DISPLAY_RECEIPT_IDENTITY_MISMATCH');
    }
    if (['unsupported', 'unavailable'].includes(String(remote.status)) && !remote.reason) throw new Error('RDC_DISPLAY_RECEIPT_INVALID');
    const finalError = data.final_output_error as { code?: unknown; message?: unknown } | null;
    const result: Partial<CaptureReplayState> = {
      appliedEventId: eventId, imageEventId: null, image: null,
      observation: { nativeRevision: data.revision as number,
        modificationState: data.modification_state as 'baseline' | 'intervention' | 'restored',
        displayParameters: { mip: display.mip as number, slice: display.slice as number, sample: display.sample as number,
          rangeMin: display.range_min as number, rangeMax: display.range_max as number } },
      target,
      targets,
      isFinalOutput: data.is_final_output === true,
      devicePresentation: { status: remote.status as CaptureReplayState['devicePresentation']['status'],
        eventId, textureId: remote.texture_id as string | null, sequence: remote.sequence as number | null,
        reason: remote.reason as string | null },
      warning: finalError && typeof finalError.code === 'string' && typeof finalError.message === 'string' ? { code: finalError.code, message: finalError.message } : null,
      error: null,
    };
    if (data.image_path) {
      if (!Number.isSafeInteger(data.image_event_id) || data.image_event_id !== eventId) throw new Error('RDC_IMAGE_EVENT_MISMATCH');
      if (typeof data.image_path !== 'string' || path.resolve(data.image_path) !== imagePath) throw new Error('RDC_IMAGE_PATH_MISMATCH');
      if (!live) throw new Error('RDC_LIVE_TARGET_REQUIRED');
      let bytes: Buffer;
      try { bytes = await fs.readFile(imagePath); } catch { throw new Error('RDC_IMAGE_UNREADABLE'); }
      result.image = await replayLivePreviewStore.write(live.sessionId, live.generation, eventId, replayPngCodec.encode(bytes));
      result.imageEventId = data.image_event_id as number;
    } else {
      const error = data.image_error as { code?: unknown; message?: unknown } | null | undefined;
      if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') throw new Error('RDC_IMAGE_ERROR_INVALID');
      result.error = { code: error.code, message: error.message,
        retry: error.code === 'no_color_output' || error.code === 'missing_target' ? null : 'image' };
    }
    return result;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
