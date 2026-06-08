import fs from 'fs';
import path from 'path';
import type { AgentRole } from '@shared/types/agent';
import type { ContentBlock } from '@shared/types/llm';
import type { ToolCallResult } from '@shared/types/tool';
import type { DebugPlan, ReasoningSummary } from '@shared/types/workflow';
import { nowIso } from '@shared/utils/id';
import { harnessController } from './HarnessController';
import { rdxCliInvokerService } from '../../tools/RdxCliInvokerService';
import { rdxSessionService } from '../../index';
import { debuggerLlmService } from '../../settings/DebuggerLlmService';

export interface SpecialistRunContext {
  runId: string;
  turnId?: string;
  sessionId: string;
  caseId: string;
  contextId: string;
  runtimeOwner: string;
  ownerLeaseId: string;
  debugPlan: DebugPlan;
  targetCapturePath: string;
  outputRoot: string;
  signal?: AbortSignal;
}

export interface SpecialistRecipeResult {
  agentId: AgentRole;
  brief: string;
  reasoningSummary: ReasoningSummary;
  artifacts: string[];
  evidenceRefs: string[];
  payloads: Array<{ toolName: string; ok: boolean; data?: unknown; error?: string }>;
}

interface SurfaceHandle {
  captureFileId: string;
  replaySessionId: string;
}

interface SpecialistSummaryPayload {
  summary: string;
  evidence: string[];
  next_step: string;
  confidence: number;
}

interface PixelFocusPayload {
  normalized_x: number;
  normalized_y: number;
  reason: string;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function summarizePayloadData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record).slice(0, 8)) {
    if (Array.isArray(entry)) {
      summary[key] = `array(${entry.length})`;
      continue;
    }
    if (entry && typeof entry === 'object') {
      summary[key] = `object(${Object.keys(entry as Record<string, unknown>).length})`;
      continue;
    }
    summary[key] = entry;
  }
  return summary;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatPixel(value: unknown): string | null {
  const pixel = asRecord(value);
  const x = pixel.x;
  const y = pixel.y;
  const rgba = [pixel.r, pixel.g, pixel.b, pixel.a].map((entry) => typeof entry === 'number' ? entry : null);
  if (rgba.some((entry) => entry === null)) {
    return null;
  }
  return `Pixel(${x ?? '?'},${y ?? '?'}) RGBA=${rgba.join(',')}`;
}

function describePayloadEvidence(toolName: string, data: unknown): string | null {
  const record = asRecord(data);
  if (toolName === 'rd.export.screenshot') {
    const nameInfo = asRecord(record.name_info);
    return [
      `Screenshot ${record.width ?? '?'}x${record.height ?? '?'}`,
      `event=${record.resolved_event_id ?? record.requested_event_id ?? '?'}`,
      `target=${record.texture_id ?? nameInfo.resource_id ?? 'unknown'}`,
      `format=${record.texture_format ?? 'unknown'}`,
      record.fallback_reason ? `fallback=${record.fallback_reason}` : '',
      Array.isArray(record.summary_degraded_reasons) ? `degraded=${record.summary_degraded_reasons.join(',')}` : '',
    ].filter(Boolean).join('; ');
  }

  if (toolName === 'rd.macro.explain_pixel') {
    const history = Array.isArray(record.history) ? record.history : [];
    return `${record.explanation ?? 'Pixel explanation available'} History events=${history.map((entry) => asRecord(entry).event_id).filter(Boolean).join(',') || history.length}`;
  }

  if (toolName === 'rd.texture.get_pixel_value') {
    const pixel = formatPixel(record.pixel);
    return [
      pixel ?? 'Pixel value readback available',
      `texture=${record.texture_id ?? 'unknown'}`,
      `event=${record.resolved_event_id ?? '?'}`,
      Array.isArray(record.summary_degraded_reasons) ? `degraded=${record.summary_degraded_reasons.join(',')}` : '',
    ].filter(Boolean).join('; ');
  }

  if (toolName === 'rd.texture.get_pixel_history') {
    const history = Array.isArray(record.history) ? record.history : [];
    return `Pixel history on ${record.texture_id ?? 'unknown'} has ${history.length} modifications: ${history.map((entry) => asRecord(entry).event_id).filter(Boolean).join(',') || 'none'}.`;
  }

  if (toolName === 'rd.pipeline.get_state_summary') {
    const summary = asRecord(record.summary);
    const shaders = Array.isArray(summary.shaders) ? summary.shaders.map((entry) => {
      const shader = asRecord(entry);
      return `${shader.stage}:${shader.resource_id}`;
    }).join(', ') : '';
    const target = asRecord(summary.selected_visual_target);
    return [
      `Pipeline api=${summary.api ?? 'unknown'}`,
      shaders ? `shaders=${shaders}` : '',
      `bindings=${summary.binding_count ?? '?'}`,
      target.texture_id ? `visual_target=${target.texture_id}` : '',
      target.fallback_reason ? `fallback=${target.fallback_reason}` : '',
    ].filter(Boolean).join('; ');
  }

  if (toolName === 'rd.pipeline.get_output_targets') {
    const framebuffer = asRecord(record.framebuffer);
    const target = asRecord(framebuffer.selected_visual_target);
    return [
      `Framebuffer render_targets=${Array.isArray(framebuffer.render_targets) ? framebuffer.render_targets.length : '?'}`,
      target.texture_id ? `visual_target=${target.texture_id}` : '',
      target.texture_format ? `format=${target.texture_format}` : '',
      target.fallback_reason ? `fallback=${target.fallback_reason}` : '',
    ].filter(Boolean).join('; ');
  }

  if (toolName === 'rd.pipeline.get_resource_bindings') {
    const bindings = Array.isArray(record.bindings) ? record.bindings : [];
    const first = bindings.slice(0, 5).map((entry) => {
      const binding = asRecord(entry);
      return `${binding.type}@${binding.set_or_space}:${binding.binding}=${binding.resource_id}`;
    });
    return `Resource bindings ${bindings.length}: ${first.join(', ')}`;
  }

  if (toolName.startsWith('rd.pipeline.get_shader')) {
    const shader = asRecord(record.shader);
    return `Shader ${shader.stage ?? 'unknown'} ${shader.shader_id ?? 'unknown'} entry=${shader.entry ?? 'unknown'}`;
  }

  return null;
}

function findStringFieldDeep(value: unknown, keys: string[], seen = new Set<unknown>()): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findStringFieldDeep(item, keys, seen);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key]) {
      return record[key] as string;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nested = findStringFieldDeep(nestedValue, keys, seen);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function getActiveEventId(debugPlan: DebugPlan): number | undefined {
  return debugPlan.targetFrameOrEvent?.eventId;
}

function getFrameIndex(debugPlan: DebugPlan): number | undefined {
  return debugPlan.targetFrameOrEvent?.frameIndex;
}

function pngDimensions(filePath: string): { width: number; height: number } | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function fileToImageBlock(filePath: string): Promise<ContentBlock | null> {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = await fs.promises.readFile(filePath);
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: data.toString('base64'),
    },
  };
}

export class SpecialistRecipeRunner {
  async prepareSurface(context: SpecialistRunContext): Promise<SurfaceHandle> {
    const existingSnapshot = rdxSessionService.snapshotContext();
    const existingCapture = rdxSessionService.getCaptureDescriptors().find((capture) => (
      capture.id === context.debugPlan.targetCapture?.captureId
      || capture.filePath === context.targetCapturePath
    ));
    const existingReplaySessionId = existingCapture?.sessionId
      || existingCapture?.replaySessionId
      || existingSnapshot.sessionId
      || await this.resolveReplaySessionId(context);
    if (existingReplaySessionId) {
      const frameIndex = getFrameIndex(context.debugPlan);
      if (typeof frameIndex === 'number') {
        await this.callTool(
          'rd.replay.set_frame',
          {
            session_id: existingReplaySessionId,
            frame_index: frameIndex,
          },
          'triage_agent',
          context,
        );
      }

      const eventId = getActiveEventId(context.debugPlan);
      if (typeof eventId === 'number') {
        await this.callTool(
          'rd.event.set_active',
          {
            session_id: existingReplaySessionId,
            event_id: eventId,
          },
          'triage_agent',
          context,
        );
      }

      await this.openHumanPreviewSafe(existingReplaySessionId);

      return {
        captureFileId: existingCapture?.captureFileId || existingCapture?.id || context.debugPlan.targetCapture?.captureId || 'target_capture',
        replaySessionId: existingReplaySessionId,
      };
    }

    const openCapture = await this.callTool(
      'rd.capture.open_file',
      {
        file_path: context.targetCapturePath,
      },
      'triage_agent',
      context,
    );
    const captureFileId = typeof openCapture.data?.capture_file_id === 'string'
      ? openCapture.data.capture_file_id
      : context.debugPlan.targetCapture?.captureId;
    if (!openCapture.ok || !captureFileId) {
      throw new Error(openCapture.error?.message || `Failed to open target capture. capture_id=${String(captureFileId || '')} data_keys=${Object.keys(openCapture.data || {}).join(',') || 'none'}`);
    }

    const openReplay = await this.callTool(
      'rd.capture.open_replay',
      {
        capture_file_id: captureFileId,
      },
      'triage_agent',
      context,
    );
    const replaySessionId = typeof openReplay.data?.session_id === 'string'
      ? openReplay.data.session_id
      : typeof openReplay.data?.replay_session_id === 'string'
        ? openReplay.data.replay_session_id
        : await this.resolveReplaySessionId(context);
    if (!openReplay.ok || !replaySessionId) {
      throw new Error(openReplay.error?.message || `Failed to open replay session. data_keys=${Object.keys(openReplay.data || {}).join(',') || 'none'}`);
    }

    const frameIndex = getFrameIndex(context.debugPlan);
    if (typeof frameIndex === 'number') {
      await this.callTool(
        'rd.replay.set_frame',
        {
          session_id: replaySessionId,
          frame_index: frameIndex,
        },
        'triage_agent',
        context,
      );
    }

    const eventId = getActiveEventId(context.debugPlan);
    if (typeof eventId === 'number') {
      await this.callTool(
        'rd.event.set_active',
        {
          session_id: replaySessionId,
          event_id: eventId,
        },
        'triage_agent',
        context,
      );
    }

    await this.openHumanPreviewSafe(replaySessionId);

    return {
      captureFileId: String(captureFileId),
      replaySessionId: String(replaySessionId),
    };
  }

  async run(agentId: AgentRole, context: SpecialistRunContext, surface: SurfaceHandle): Promise<SpecialistRecipeResult> {
    if (agentId === 'triage_agent') {
      return this.runTriage(context, surface);
    }
    if (agentId === 'capture_repro_agent') {
      return this.runCaptureRepro(context, surface);
    }
    if (agentId === 'pass_graph_pipeline_agent') {
      return this.runPassGraph(context, surface);
    }
    if (agentId === 'pixel_forensics_agent') {
      return this.runPixelForensics(context, surface);
    }
    if (agentId === 'shader_ir_agent') {
      return this.runShaderIr(context, surface);
    }
    if (agentId === 'driver_device_agent') {
      return this.runDriverDevice(context);
    }

    throw new Error(`Unsupported specialist recipe: ${agentId}`);
  }

  private async openHumanPreviewSafe(sessionId: string): Promise<void> {
    await rdxSessionService.openHumanPreviewWindow({ sessionId }).catch(() => undefined);
  }

  private async runTriage(context: SpecialistRunContext, surface: SurfaceHandle): Promise<SpecialistRecipeResult> {
    const eventId = getActiveEventId(context.debugPlan);
    const payloads: SpecialistRecipeResult['payloads'] = [];
    const info = await this.callTool('rd.capture.get_info', {
      capture_file_id: surface.captureFileId,
    }, 'triage_agent', context);
    payloads.push(this.toPayload('rd.capture.get_info', info));

    const frame = await this.callTool('rd.replay.get_frame_info', {
      session_id: surface.replaySessionId,
    }, 'triage_agent', context);
    payloads.push(this.toPayload('rd.replay.get_frame_info', frame));

    if (typeof eventId === 'number') {
      const action = await this.callTool('rd.event.get_action_details', {
        session_id: surface.replaySessionId,
        event_id: eventId,
      }, 'triage_agent', context);
      payloads.push(this.toPayload('rd.event.get_action_details', action));

      const parentChain = await this.callTool('rd.event.get_parent_chain', {
        session_id: surface.replaySessionId,
        event_id: eventId,
      }, 'triage_agent', context);
      payloads.push(this.toPayload('rd.event.get_parent_chain', parentChain));

      const markerStack = await this.callTool('rd.event.get_marker_stack', {
        session_id: surface.replaySessionId,
        event_id: eventId,
      }, 'triage_agent', context);
      payloads.push(this.toPayload('rd.event.get_marker_stack', markerStack));
    }

    const summary = await this.callTool('rd.macro.summarize_frame', {
      session_id: surface.replaySessionId,
    }, 'triage_agent', context);
    payloads.push(this.toPayload('rd.macro.summarize_frame', summary));

    return this.finishRecipe('triage_agent', context, payloads, [
      'Capture metadata',
      'Frame summary',
      eventId ? `Event ${eventId}` : 'Frame-level scope',
    ]);
  }

  private async runCaptureRepro(context: SpecialistRunContext, surface: SurfaceHandle): Promise<SpecialistRecipeResult> {
    const payloads: SpecialistRecipeResult['payloads'] = [];
    const listFrames = await this.callTool('rd.capture.list_frames', {
      capture_file_id: surface.captureFileId,
    }, 'capture_repro_agent', context);
    payloads.push(this.toPayload('rd.capture.list_frames', listFrames));

    const screenshotPath = path.join(context.outputRoot, 'screenshots', 'capture_repro.png');
    const screenshot = await this.callTool('rd.export.screenshot', {
      session_id: surface.replaySessionId,
      output_path: screenshotPath,
      file_format: 'png',
      include_alpha: true,
    }, 'capture_repro_agent', context);
    payloads.push(this.toPayload('rd.export.screenshot', screenshot));

    return this.finishRecipe('capture_repro_agent', context, payloads, [
      'Frame list',
      'Reference screenshot',
    ]);
  }

  private async runPassGraph(context: SpecialistRunContext, surface: SurfaceHandle): Promise<SpecialistRecipeResult> {
    const eventId = getActiveEventId(context.debugPlan);
    const payloads: SpecialistRecipeResult['payloads'] = [];
    const stageState = await this.callTool('rd.pipeline.get_state_summary', {
      session_id: surface.replaySessionId,
      event_id: eventId,
      include_bindings: true,
      include_shaders: true,
    }, 'pass_graph_pipeline_agent', context);
    payloads.push(this.toPayload('rd.pipeline.get_state_summary', stageState));

    const outputTargets = await this.callTool('rd.pipeline.get_output_targets', {
      session_id: surface.replaySessionId,
      event_id: eventId,
    }, 'pass_graph_pipeline_agent', context);
    payloads.push(this.toPayload('rd.pipeline.get_output_targets', outputTargets));

    const bindings = await this.callTool('rd.pipeline.get_resource_bindings', {
      session_id: surface.replaySessionId,
      stage: 'ps',
    }, 'pass_graph_pipeline_agent', context);
    payloads.push(this.toPayload('rd.pipeline.get_resource_bindings', bindings));

    if (typeof eventId === 'number' && eventId > 1) {
      const diff = await this.callTool('rd.event.diff_pipeline_state', {
        session_id: surface.replaySessionId,
        event_a: Math.max(1, eventId - 1),
        event_b: eventId,
        scope: 'full',
        include_unchanged: false,
      }, 'pass_graph_pipeline_agent', context);
      payloads.push(this.toPayload('rd.event.diff_pipeline_state', diff));
    }

    return this.finishRecipe('pass_graph_pipeline_agent', context, payloads, [
      'Pipeline summary',
      'Output targets',
      'Binding diff',
    ]);
  }

  private async runPixelForensics(context: SpecialistRunContext, surface: SurfaceHandle): Promise<SpecialistRecipeResult> {
    const payloads: SpecialistRecipeResult['payloads'] = [];
    const screenshotPath = path.join(context.outputRoot, 'screenshots', 'pixel_forensics.png');
    const screenshot = await this.callTool('rd.export.screenshot', {
      session_id: surface.replaySessionId,
      output_path: screenshotPath,
      file_format: 'png',
      include_alpha: true,
    }, 'pixel_forensics_agent', context);
    payloads.push(this.toPayload('rd.export.screenshot', screenshot));

    const point = await this.locatePixelFocus(screenshotPath, context);
    const resolvedTextureId = typeof screenshot.data?.texture_id === 'string'
      ? screenshot.data.texture_id
      : undefined;

    const explain = await this.callTool('rd.macro.explain_pixel', {
      session_id: surface.replaySessionId,
      x: point.x,
      y: point.y,
      target: resolvedTextureId ?? 'auto',
      verbosity: 'medium',
    }, 'pixel_forensics_agent', context);
    payloads.push(this.toPayload('rd.macro.explain_pixel', explain));

    if (resolvedTextureId) {
      const pixelValue = await this.callTool('rd.texture.get_pixel_value', {
        session_id: surface.replaySessionId,
        texture_id: resolvedTextureId,
        x: point.x,
        y: point.y,
        mip: 0,
        slice: 0,
        sample: 0,
        as_type: 'float',
      }, 'pixel_forensics_agent', context);
      payloads.push(this.toPayload('rd.texture.get_pixel_value', pixelValue));

      const pixelHistory = await this.callTool('rd.texture.get_pixel_history', {
        session_id: surface.replaySessionId,
        texture_id: resolvedTextureId,
        x: point.x,
        y: point.y,
        mip: 0,
        slice: 0,
        sample: 0,
        include_shaders: true,
      }, 'pixel_forensics_agent', context);
      payloads.push(this.toPayload('rd.texture.get_pixel_history', pixelHistory));
    }

    return this.finishRecipe('pixel_forensics_agent', context, payloads, [
      `Pixel focus ${point.x},${point.y}`,
      'Framebuffer screenshot',
      'Pixel explanation',
    ], [screenshotPath]);
  }

  private async runShaderIr(context: SpecialistRunContext, surface: SurfaceHandle): Promise<SpecialistRecipeResult> {
    const eventId = getActiveEventId(context.debugPlan);
    const payloads: SpecialistRecipeResult['payloads'] = [];
    let shaderId: string | undefined;
    let shaderStage = 'ps';

    for (const stage of ['ps', 'cs', 'vs']) {
      const shader = await this.callTool('rd.pipeline.get_shader', {
        session_id: surface.replaySessionId,
        event_id: eventId,
        stage,
      }, 'shader_ir_agent', context);
      payloads.push(this.toPayload(`rd.pipeline.get_shader:${stage}`, shader));
      const candidateShaderId = typeof shader.data?.shader_id === 'string'
        ? shader.data.shader_id
        : typeof shader.data?.resource_id === 'string'
          ? shader.data.resource_id
          : undefined;
      if (candidateShaderId) {
        shaderId = candidateShaderId;
        shaderStage = stage;
        break;
      }
    }

    if (shaderId) {
      const source = await this.callTool('rd.shader.get_source', {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        prefer_original: true,
      }, 'shader_ir_agent', context);
      payloads.push(this.toPayload('rd.shader.get_source', source));

      const disassembly = await this.callTool('rd.shader.get_disassembly', {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        stage: shaderStage,
        event_id: eventId,
      }, 'shader_ir_agent', context);
      payloads.push(this.toPayload('rd.shader.get_disassembly', disassembly));

      const reflection = await this.callTool('rd.shader.get_reflection', {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        stage: shaderStage,
        event_id: eventId,
        include_bindings: true,
        include_constant_blocks: true,
      }, 'shader_ir_agent', context);
      payloads.push(this.toPayload('rd.shader.get_reflection', reflection));
    }

    return this.finishRecipe('shader_ir_agent', context, payloads, [
      shaderId ? `Shader ${shaderId}` : 'Shader lookup attempted',
      `Stage ${shaderStage}`,
    ]);
  }

  private async runDriverDevice(context: SpecialistRunContext): Promise<SpecialistRecipeResult> {
    const payloads: SpecialistRecipeResult['payloads'] = [];
    const contextSnapshot = await this.callTool('rd.session.get_context', {
      context_id: context.contextId,
    }, 'driver_device_agent', context);
    payloads.push(this.toPayload('rd.session.get_context', contextSnapshot));

    const ping = await this.callTool('rd.remote.ping', {
      remote_id: 'current',
    }, 'driver_device_agent', context);
    payloads.push(this.toPayload('rd.remote.ping', ping));

    return this.finishRecipe('driver_device_agent', context, payloads, [
      'Runtime context',
      'Remote status probe',
    ]);
  }

  private async callTool(
    toolName: string,
    args: Record<string, unknown>,
    agentId: AgentRole,
    context: SpecialistRunContext,
  ): Promise<ToolCallResult> {
    const result = await harnessController.wrapToolExecution({
      toolName,
      args,
      agentId,
      sessionId: context.sessionId,
      runId: context.runId,
      turnId: context.turnId,
      execute: () => rdxCliInvokerService.call({
        toolName,
        args: {
          ...args,
          context_id: context.contextId,
          runtime_owner: context.runtimeOwner,
          owner_lease_id: context.ownerLeaseId,
        },
        contextId: context.contextId,
        turnId: context.turnId,
        runtimeOwner: context.runtimeOwner,
        ownerLeaseId: context.ownerLeaseId,
        runId: context.runId,
        abortSignal: context.signal,
      }),
    });
    return {
      ok: result.ok,
      data: result.data as Record<string, unknown> | undefined,
      error: result.error as ToolCallResult['error'],
      artifacts: [],
      duration_ms: 0,
    };
  }

  private async resolveReplaySessionId(context: SpecialistRunContext): Promise<string | null> {
    for (const toolName of ['rd.session.get_context', 'rd.session.list_sessions', 'rd.core.get_capabilities']) {
      const result = await this.callTool(toolName, {}, 'triage_agent', context);
      if (!result.ok) {
        continue;
      }

      const replaySessionId = findStringFieldDeep(result.data, [
        'current_session_id',
        'selected_session_id',
        'session_id',
        'replay_session_id',
      ]);
      if (replaySessionId) {
        return replaySessionId;
      }
    }

    return null;
  }

  private toPayload(toolName: string, result: ToolCallResult): SpecialistRecipeResult['payloads'][number] {
    return {
      toolName,
      ok: result.ok,
      data: result.data,
      error: result.error?.message,
    };
  }

  private async locatePixelFocus(screenshotPath: string, context: SpecialistRunContext): Promise<{ x: number; y: number }> {
    const dims = pngDimensions(screenshotPath);
    if (!dims) {
      return { x: 0, y: 0 };
    }
    const fallbackPoint = {
      x: Math.max(0, Math.min(dims.width - 1, Math.round(dims.width * 0.5))),
      y: Math.max(0, Math.min(dims.height - 1, Math.round(dims.height * 0.5))),
    };

    const imageBlock = await fileToImageBlock(screenshotPath);
    if (!imageBlock) {
      return fallbackPoint;
    }

    try {
      const { data } = await debuggerLlmService.callStructured<PixelFocusPayload>({
        agentId: 'pixel_forensics_agent',
        stage: 'dispatch',
        sessionId: context.sessionId,
        runId: context.runId,
        messages: [
          {
            role: 'system',
            content: 'You are a graphics debugging assistant. Return JSON only with keys normalized_x, normalized_y, reason. Coordinates must be floats between 0 and 1 for the suspicious bright white highlight most relevant to the debugging task.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Task: ${context.debugPlan.userGoal}\nFind the suspicious bright white highlight that should be investigated first.`,
              },
              imageBlock,
            ],
          },
        ],
        maxTokens: 300,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson<PixelFocusPayload>(text),
        testValue: {
          normalized_x: 0.5,
          normalized_y: 0.5,
          reason: 'test-mode center point',
        },
        auditSummary: (payload) => payload.reason,
      });

      return {
        x: Math.max(0, Math.min(dims.width - 1, Math.round(clamp01(toNumber(data.normalized_x, 0.5)) * dims.width))),
        y: Math.max(0, Math.min(dims.height - 1, Math.round(clamp01(toNumber(data.normalized_y, 0.5)) * dims.height))),
      };
    } catch {
      return fallbackPoint;
    }
  }

  private async finishRecipe(
    agentId: AgentRole,
    context: SpecialistRunContext,
    payloads: SpecialistRecipeResult['payloads'],
    evidence: string[],
    extraArtifacts: string[] = [],
  ): Promise<SpecialistRecipeResult> {
    const agentRoot = path.join(context.outputRoot, 'notes');
    fs.mkdirSync(agentRoot, { recursive: true });
    const artifactPath = path.join(agentRoot, `${agentId}.json`);
    fs.writeFileSync(artifactPath, JSON.stringify(payloads, null, 2), 'utf-8');

    const successfulTools = payloads.filter((payload) => payload.ok);
    const failedTools = payloads.filter((payload) => !payload.ok);
    const condensedPayloads = payloads.map((payload) => ({
      toolName: payload.toolName,
      ok: payload.ok,
      data: summarizePayloadData(payload.data),
      error: payload.error,
    }));
    const deterministicSummary: SpecialistSummaryPayload = {
      summary: [
        `${agentId} collected ${successfulTools.length} successful tool results.`,
        ...successfulTools
          .map((payload) => describePayloadEvidence(payload.toolName, payload.data) ?? payload.toolName)
          .slice(0, 4)
          .map((line) => `- ${line}`),
        ...(failedTools.length > 0 ? [`Failed tools: ${failedTools.map((payload) => payload.toolName).join(', ')}`] : []),
      ].join('\n'),
      evidence: [
        ...evidence,
        ...successfulTools
          .map((payload) => describePayloadEvidence(payload.toolName, payload.data))
          .filter((line): line is string => Boolean(line)),
      ],
      next_step: this.getNextStep(agentId),
      confidence: successfulTools.length > 0 ? 0.72 : 0.35,
    };

    let llmSummary: SpecialistSummaryPayload;
    try {
      const structuredResult = await debuggerLlmService.callStructured<SpecialistSummaryPayload>({
        agentId,
        stage: 'dispatch',
        sessionId: context.sessionId,
        runId: context.runId,
        messages: [
          {
            role: 'system',
            content: 'You are a RenderDoc debugging specialist. Return compact JSON only with keys summary, evidence, next_step, confidence. Keep summary to at most two sentences, evidence to at most three short strings, and confidence between 0 and 1. Do not include markdown fences or extra commentary.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  `Agent: ${agentId}`,
                  `Goal: ${context.debugPlan.userGoal}`,
                  `Evidence anchors: ${evidence.join(' | ') || 'N/A'}`,
                  `Successful tools: ${successfulTools.map((payload) => payload.toolName).join(', ') || 'none'}`,
                  `Failed tools: ${failedTools.map((payload) => `${payload.toolName}: ${payload.error || 'failed'}`).join(' | ') || 'none'}`,
                  `Condensed tool payloads JSON: ${JSON.stringify(condensedPayloads)}`,
                ].join('\n'),
              },
            ],
          },
        ],
        maxTokens: 220,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson<SpecialistSummaryPayload>(text),
        testValue: deterministicSummary,
        auditSummary: (payload) => payload.summary,
      });
      llmSummary = structuredResult.data;
    } catch {
      try {
        const fallbackResult = await debuggerLlmService.call({
          agentId,
          stage: 'dispatch',
          sessionId: context.sessionId,
          runId: context.runId,
        }, {
          messages: [
            {
              role: 'system',
              content: 'You are a RenderDoc debugging specialist. Reply with one or two concise sentences only. Summarize the most important finding from the provided tool evidence and what should be checked next.',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    `Agent: ${agentId}`,
                    `Goal: ${context.debugPlan.userGoal}`,
                    `Evidence anchors: ${evidence.join(' | ') || 'N/A'}`,
                    `Successful tools: ${successfulTools.map((payload) => payload.toolName).join(', ') || 'none'}`,
                    `Failed tools: ${failedTools.map((payload) => `${payload.toolName}: ${payload.error || 'failed'}`).join(' | ') || 'none'}`,
                  ].join('\n'),
                },
              ],
            },
          ],
          maxTokens: 160,
          temperature: 0.1,
        });
        const fallbackSummary = fallbackResult.text.trim();
        llmSummary = fallbackSummary
          ? {
              summary: fallbackSummary,
              evidence,
              next_step: this.getNextStep(agentId),
              confidence: deterministicSummary.confidence,
            }
          : deterministicSummary;
      } catch {
        llmSummary = deterministicSummary;
      }
    }

    const reasoningSummary: ReasoningSummary = {
      summaryId: `${agentId}-${Date.now()}`,
      stage: 'dispatch',
      agentId,
      summary: llmSummary.summary,
      evidence: toStringArray(llmSummary.evidence).length > 0 ? toStringArray(llmSummary.evidence) : evidence,
      nextStep: llmSummary.next_step || this.getNextStep(agentId),
      confidence: toNumber(llmSummary.confidence, deterministicSummary.confidence),
      createdAt: nowIso(),
    };

    return {
      agentId,
      brief: reasoningSummary.summary,
      reasoningSummary,
      artifacts: [artifactPath, ...extraArtifacts],
      evidenceRefs: reasoningSummary.evidence,
      payloads,
    };
  }

  private getNextStep(agentId: AgentRole): string {
    if (agentId === 'triage_agent') {
      return 'Use triage evidence to decide which pipeline, pixel, and shader investigations should continue.';
    }
    if (agentId === 'pixel_forensics_agent') {
      return 'Correlate the suspicious pixel evidence with pipeline and shader state.';
    }
    if (agentId === 'shader_ir_agent') {
      return 'Validate whether shader logic matches the visual artifact and proposed fix.';
    }
    return 'Feed this specialist evidence into the orchestrator investigation summary.';
  }
}

export const specialistRecipeRunner = new SpecialistRecipeRunner();

