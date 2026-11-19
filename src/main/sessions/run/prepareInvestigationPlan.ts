import path from 'node:path';
import { z } from 'zod';
import type { InvestigationPlanContract } from '@shared/types/planInvestigation';
import type { ProjectInputRecord, ProjectRecord } from '@shared/types/session';
import { hashCaptureFile } from '../../rdc/captures/replay/captureContentHash';
import { safePath } from '../../rdc/captures/replay/replayFileSafety';
import { verifyExternalCaptureReference } from '../../rdc/captures/ExternalCaptureReference';
import { selectedProbeDeviceId } from '../../rdc/RdcProbeLifecycle';
import type { CaptureReplayState } from '@shared/types/captureReplay';

const proposalSchema = z.object({
  inputIds: z.array(z.string().trim().min(1).max(256)).min(1).max(32),
  deviceId: z.string().trim().min(1).max(256),
  comparisonGoal: z.string().trim().min(1).max(4000),
}).strict();

export interface InvestigationPlanHost {
  sessionProjectId(sessionId: string): string | null;
  project(projectId: string): ProjectRecord | null;
  replayState(sessionId: string, projectId: string): Pick<CaptureReplayState, 'replayDeviceId' | 'preparation'>;
}

/** Snapshot verified registered inputs without refreshing or reconciling an active replay. */
export async function prepareInvestigationPlan(input: {
  mission: InvestigationPlanContract['mission']; sessionId: string; projectId: string | null;
  captureScope?: unknown; host: InvestigationPlanHost;
}): Promise<InvestigationPlanContract> {
  if (input.captureScope === undefined) return { schemaVersion: 1, mission: input.mission };
  const proposal = proposalSchema.parse(input.captureScope);
  if (new Set(proposal.inputIds).size !== proposal.inputIds.length) throw new Error('PLAN_CAPTURE_SCOPE_INVALID: duplicate inputs.');
  if (!input.projectId || input.host.sessionProjectId(input.sessionId) !== input.projectId) throw new Error('PLAN_CAPTURE_SCOPE_INVALID: session/project mismatch.');
  const project = input.host.project(input.projectId);
  if (!project) throw new Error('PLAN_CAPTURE_SCOPE_INVALID: project is unavailable.');
  const deviceId = selectedProbeDeviceId(input.host.replayState(input.sessionId, input.projectId));
  if (deviceId !== proposal.deviceId) throw new Error('PLAN_CAPTURE_SCOPE_INVALID: device differs from the prepared selection.');
  const inputs = [];
  for (const inputId of proposal.inputIds) {
    const capture = project.inputs.find(item => item.inputId === inputId);
    if (!capture || !capture.contentSha256) throw new Error(`PLAN_CAPTURE_SCOPE_INVALID: input ${inputId} is not registered and verified.`);
    const hash = await verifyPlanInput(project, capture);
    if (hash !== capture.contentSha256) throw new Error(`PLAN_CAPTURE_SCOPE_INVALID: input ${inputId} changed since registration.`);
    inputs.push({ inputId, fileName: capture.fileName, contentSha256: hash });
  }
  return { schemaVersion: 1, mission: input.mission, captureScope: {
    projectId: input.projectId, deviceId, comparisonGoal: proposal.comparisonGoal, inputs,
  } };
}

export async function verifyPlanInput(project: ProjectRecord, input: ProjectInputRecord): Promise<string> {
  if (input.source === 'external_reference') return (await verifyExternalCaptureReference(input)).contentSha256!;
  const relative = path.relative(project.inputsPath, input.filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(input.filePath).toLowerCase() !== '.rdc') {
    throw new Error('PLAN_CAPTURE_SCOPE_INVALID: project input path is outside the registered inputs directory.');
  }
  await safePath(project.rootPath, input.filePath);
  return (await hashCaptureFile(input.filePath)).sha256;
}
