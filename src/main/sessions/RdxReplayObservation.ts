import type { RdxCliInvokerSettings } from '@shared/types/settings';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nativeImage } from 'electron';
import type { CaptureReplayState } from '@shared/types/captureReplay';
import type { RdxRuntimeContext } from '@shared/types/session';
import { settingsService } from '../settings/SettingsService';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { parseRdxNativeResult } from '../tools/RdxNativeProtocol';

async function call(owner: RdxRuntimeContext, operation: string, args: Record<string, unknown>, frozenCli?: RdxCliInvokerSettings) {
  const settings = structuredClone(frozenCli ?? settingsService.getAll().tooling.rdxCli);
  settings.argsPrefix = [...settings.argsPrefix.filter(arg => arg !== '--json'), '--json'];
  const result = parseRdxNativeResult(await rdxCliInvokerService.executeCLI('call', [operation, '--args-json',
    JSON.stringify({ ...args, session_id: owner.replaySessionId }), '--daemon-context', owner.contextId,
  ], { contextId: owner.contextId, settings }), owner.contextId);
  if (result.result_kind !== operation || result.data.session_id !== owner.replaySessionId) throw new Error('RDX_OBSERVATION_IDENTITY_MISMATCH');
  return result.data;
}
export async function readReplayEvents(owner: RdxRuntimeContext, frozenCli?: RdxCliInvokerSettings): Promise<CaptureReplayState['events']> {
  const data = await call(owner, 'rd.session.get_replay_events', {}, frozenCli);
  if (data.complete !== true || !Array.isArray(data.events)) throw new Error('RDX_EVENTS_INCOMPLETE');
  return data.events.map((entry: { event_id: number; name: string }) => {
    if (!Number.isInteger(entry.event_id) || typeof entry.name !== 'string') throw new Error('RDX_EVENTS_INVALID');
    return { eventId: entry.event_id, name: entry.name };
  });
}
export async function observeReplay(owner: RdxRuntimeContext, args: Record<string, unknown>, frozenCli?: RdxCliInvokerSettings): Promise<Partial<CaptureReplayState>> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-replay-'));
  try {
    const imagePath = path.join(directory, 'frame.png');
    const data = await call(owner, 'rd.session.observe', { ...args, out_path: imagePath }, frozenCli);
    if (!Number.isSafeInteger(data.event_id) || Number(data.event_id) < 0) throw new Error('RDX_OBSERVATION_EVENT_INVALID');
    const eventId = data.event_id as number;
    const display = data.display_parameters as Record<string, unknown> | null;
    if (!Number.isSafeInteger(data.revision) || Number(data.revision) < 0
      || !['baseline', 'intervention', 'restored'].includes(String(data.modification_state))
      || !display || !['mip', 'slice', 'sample'].every(key => Number.isSafeInteger(display[key]) && Number(display[key]) >= 0)
      || !['range_min', 'range_max'].every(key => typeof display[key] === 'number' && Number.isFinite(display[key]))) {
      throw new Error('RDX_OBSERVATION_METADATA_INVALID');
    }
    const targetSchema = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RDX_OBSERVATION_TARGET_INVALID');
      const target = value as Record<string, unknown>;
      if (typeof target.texture_id !== 'string' || !target.texture_id || !(target.output_slot === null || (Number.isSafeInteger(target.output_slot) && Number(target.output_slot) >= 0))) throw new Error('RDX_OBSERVATION_TARGET_INVALID');
      return { textureId: target.texture_id, outputSlot: target.output_slot as number | null };
    };
    const target = data.target === null ? null : targetSchema(data.target);
    if (!Array.isArray(data.targets)) throw new Error('RDX_OBSERVATION_TARGET_INVALID');
    const targets = data.targets.map(targetSchema);
    const remote = data.remote_display as Record<string, unknown> | undefined;
    if (!remote || !['not_applicable', 'unsupported', 'pending', 'displayed', 'error'].includes(String(remote.status))
      || (remote.reason !== undefined && typeof remote.reason !== 'string')) throw new Error('RDX_DISPLAY_RECEIPT_INVALID');
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
      devicePresentation: remote as CaptureReplayState['devicePresentation'],
      warning: finalError && typeof finalError.code === 'string' && typeof finalError.message === 'string' ? { code: finalError.code, message: finalError.message } : null,
      error: null,
    };
    if (data.image_path) {
      if (!Number.isSafeInteger(data.image_event_id) || data.image_event_id !== eventId) throw new Error('RDX_IMAGE_EVENT_MISMATCH');
      if (typeof data.image_path !== 'string' || path.resolve(data.image_path) !== imagePath) throw new Error('RDX_IMAGE_PATH_MISMATCH');
      let image = nativeImage.createFromPath(imagePath);
      if (image.isEmpty()) throw new Error('RDX_IMAGE_UNREADABLE');
      const size = image.getSize();
      if (Math.max(size.width, size.height) > 960) image = image.resize(size.width >= size.height ? { width: 960 } : { height: 960 });
      const scaled = image.getSize();
      result.image = { imagePath: '', imageUrl: image.toDataURL(), ...scaled, source: 'framebuffer_screenshot', updatedAt: Date.now() };
      result.imageEventId = data.image_event_id as number;
    } else {
      const error = data.image_error as { code?: unknown; message?: unknown } | null | undefined;
      if (!error || typeof error.code !== 'string' || typeof error.message !== 'string') throw new Error('RDX_IMAGE_ERROR_INVALID');
      result.error = { code: error.code, message: error.message,
        retry: error.code === 'no_color_output' || error.code === 'missing_target' ? null : 'image' };
    }
    return result;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
