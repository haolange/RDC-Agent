import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { ProjectRecord } from '@shared/types/session';
import { hashCaptureFile } from '../../rdc/captures/replay/captureContentHash';
import { prepareInvestigationPlan, type InvestigationPlanHost } from './prepareInvestigationPlan';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'investigation-plan-')); roots.push(root);
  const inputsPath = path.join(root, '.rdc-agent', 'inputs');
  await mkdir(inputsPath, { recursive: true });
  const filePath = path.join(inputsPath, 'one.rdc');
  await writeFile(filePath, 'capture one');
  const hash = (await hashCaptureFile(filePath)).sha256;
  const project: ProjectRecord = { projectId: 'project', name: 'project', rootPath: root, inputsPath,
    resourcePath: path.dirname(inputsPath), knowledgePath: '', slug: 'project', inputsUpdatedAt: 1, createdAt: 1, updatedAt: 1,
    inputs: [{ inputId: 'one', fileName: 'one.rdc', filePath, source: 'project_resource', contentSha256: hash,
      discoveredAt: 1, lastModifiedAt: 1, size: 11 }] };
  const host: InvestigationPlanHost = { sessionProjectId: () => 'project', project: () => project,
    replayState: () => ({ replayDeviceId: 'device', preparation: { targetDeviceId: 'device', phase: 'ready', issue: null } }) };
  const base = { mission: 'analyzer' as const, sessionId: 'session', projectId: 'project', host };
  const captureScope = { inputIds: ['one'], deviceId: 'device', comparisonGoal: 'Compare passes' };
  return { base, captureScope, filePath, hash };
}

it('freezes the verified registered capture and selected device for the plan reviewer', async () => {
  const f = await fixture();
  expect(await prepareInvestigationPlan({ ...f.base, captureScope: f.captureScope })).toEqual({ schemaVersion: 1, mission: 'analyzer',
    captureScope: { projectId: 'project', deviceId: 'device', comparisonGoal: 'Compare passes',
      inputs: [{ inputId: 'one', fileName: 'one.rdc', contentSha256: f.hash }] } });
  expect(await prepareInvestigationPlan(f.base)).toEqual({ schemaVersion: 1, mission: 'analyzer' });
});

it('rejects unregistered, changed, duplicate or wrong-device inputs before approval', async () => {
  const f = await fixture();
  await expect(prepareInvestigationPlan({ ...f.base, captureScope: { ...f.captureScope, inputIds: ['missing'] } })).rejects.toThrow('not registered');
  await expect(prepareInvestigationPlan({ ...f.base, captureScope: { ...f.captureScope, inputIds: ['one', 'one'] } })).rejects.toThrow('duplicate');
  await expect(prepareInvestigationPlan({ ...f.base, captureScope: { ...f.captureScope, deviceId: 'other' } })).rejects.toThrow('differs from the prepared selection');
  await writeFile(f.filePath, 'changed capture');
  await expect(prepareInvestigationPlan({ ...f.base, captureScope: f.captureScope })).rejects.toThrow('changed since registration');
});
