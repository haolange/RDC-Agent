import fs from 'node:fs';
import type { RdxProbeInput } from '@shared/constants/rdxProbe';
import type { RdxTurnBinding } from './RdxTurnBindings';
import { getRdxContextLease, getDelegatedChildSessionId } from '../sessions/RdxRuntimeContextRegistry';

/** Reuse the product capture lifecycle; never mint a lease for an arbitrary context id. */
export async function openProbeLease(
  input: RdxProbeInput, sessionId: string, projectId: string | null, binding: RdxTurnBinding, signal?: AbortSignal,
): Promise<void> {
  if (!projectId || !input.capturePath) throw new Error('RDX_PROBE_CAPTURE_REQUIRED: open a registered project capture first.');
  const { storageAdapter } = await import('../sessions/StorageAdapter');
  const session = storageAdapter.readSession(sessionId);
  if (!session || session.projectId !== projectId) throw new Error('RDX_PROBE_OWNER: session/project mismatch.');
  const requested = fs.realpathSync(input.capturePath);
  const inputs = await storageAdapter.listProjectInputs(projectId);
  const capture = inputs.find((entry) => fs.realpathSync(entry.filePath) === requested);
  if (!capture) throw new Error('RDX_PROBE_CAPTURE_DENIED: capture is not a registered project input.');
  if (input.contextId && input.contextId !== getRdxContextLease(sessionId)?.contextId) {
    throw new Error('RDX_PROBE_OWNER: context must be allocated by the capture lifecycle.');
  }
  signal?.throwIfAborted();
  const { replayDeviceService } = await import('../captures/ReplayDeviceService');
  const device = replayDeviceService.getDeviceById('local');
  if (!device) throw new Error('RDX_PROBE_DEVICE_REQUIRED: select a replay device through Capture.');
  const { rdxSessionService } = await import('../sessions');
  await rdxSessionService.openProjectInput({
    projectId, sessionId, inputId: capture.inputId, filePath: capture.filePath, replayDevice: device,
  }, { binding, signal });
}

export async function closeProbeLease(
  sessionId: string, projectId: string | null, binding: RdxTurnBinding, signal?: AbortSignal,
): Promise<void> {
  if (!projectId) throw new Error('RDX_PROBE_OWNER: project is required.');
  const lease = getRdxContextLease(sessionId);
  if (getDelegatedChildSessionId(sessionId)) throw new Error('RDX_LEASE_DUAL_OWNER: join delegated execution before closing.');
  if (lease?.delegatedFrom) throw new Error('RDX_PROBE_OWNER: a delegated lease cannot close its parent capture.');
  const { rdxSessionService } = await import('../sessions');
  const closed = await rdxSessionService.clearOpenedCaptureForSession({ sessionId, projectId }, { binding, signal });
  if (!closed) throw new Error('RDX_PROBE_OWNER: no owning capture lifecycle exists.');
}
