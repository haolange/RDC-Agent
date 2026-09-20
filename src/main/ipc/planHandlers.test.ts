import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { registerPlanHandlers } from './planHandlers';
import { StorageIo } from '../sessions/StorageIo';
import type { WorkbenchIpcContext } from './workbenchContext';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<any>>(),
  read: vi.fn(), saveDialog: vi.fn(), confirm: vi.fn(),
  location: vi.fn(), paths: vi.fn(),
}));
vi.mock('electron', () => ({ ipcMain: { handle: (id: string, fn: (...args: unknown[]) => Promise<any>) => mocks.handlers.set(id, fn) },
  BrowserWindow: { getFocusedWindow: () => ({}) }, dialog: { showSaveDialog: mocks.saveDialog, showMessageBox: mocks.confirm } }));
vi.mock('../sessions/sessionPlanReference', () => ({ readReferencedPlan: mocks.read }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: { sessions: { findSessionLocation: mocks.location }, get io() { return new StorageIo(); } } }));
vi.mock('../runtime/AppPathService', () => ({ appPathService: { getProjectRdcPaths: mocks.paths } }));
vi.mock('../runtime/RuntimeLogService', () => ({ runtimeLogService: { log: vi.fn() } }));

const request = { sessionId: 's', planId: 'old-plan', revision: 2, uri: 'session://plans/plan-frozen.md', expectedHash: 'a'.repeat(64) };
const context = { state: { currentSessionId: 's' } } as WorkbenchIpcContext;
let root: string;
const invoke = (channel: string, args: unknown) => mocks.handlers.get(channel)!(null, args);
beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-plan-ipc-'));
  context.state.currentSessionId = 's';
  mocks.location.mockReturnValue({ project: { rootPath: root } });
  mocks.paths.mockReturnValue({ plansPath: path.join(root, '.rdc-agent', 'plans') });
  mocks.read.mockReturnValue({ markdown: '# Old body\n', hash: request.expectedHash, uri: request.uri,
    ownerSessionId: 's', agentId: 'debugger', plan: { planId: request.planId, revision: 2, title: 'Old plan' } });
  mocks.saveDialog.mockResolvedValue({ canceled: false, filePath: path.join(root, 'export.md') });
  mocks.confirm.mockResolvedValue({ response: 0 });
  registerPlanHandlers(context);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('plan IPC file authority', () => {
  it('saves selected history metadata, not latest session state', async () => {
    const grant = await invoke('plan:issueApprovalToken', { ...request, action: 'plan.saveToProject' });
    const result = await invoke('plan:saveToProject', { ...request, approvalToken: grant.token });
    expect(result.success).toBe(true);
    const content = fs.readFileSync(result.path, 'utf8');
    expect(parse(content.split('---')[1])).toMatchObject({ planId: 'old-plan', revision: 2, agent: 'debugger', sha256: request.expectedHash });
    expect(content).toContain('# Old body');
    expect((await invoke('plan:saveToProject', { ...request, approvalToken: grant.token })).success).toBe(false);
  });
  it.each(['path', 'hash', 'revision'])('rejects substituted %s and consumes the grant', async field => {
    const grant = await invoke('plan:issueApprovalToken', { ...request, action: 'plan.export' });
    const args = { ...request, approvalToken: grant.token, targetPath: grant.targetPath };
    const altered = field === 'path' ? { ...args, targetPath: path.join(root, 'victim.md') }
      : field === 'hash' ? { ...args, expectedHash: 'b'.repeat(64) } : { ...args, revision: 3 };
    expect((await invoke('plan:export', altered)).error).toBe('PLAN_APPROVAL_TOKEN_INVALID');
    expect((await invoke('plan:export', args)).success).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('writes the native-selected export and denies cross-session requests', async () => {
    const grant = await invoke('plan:issueApprovalToken', { ...request, action: 'plan.export' });
    const args = { ...request, approvalToken: grant.token, targetPath: grant.targetPath };
    expect((await invoke('plan:export', args)).success).toBe(true);
    expect(fs.readFileSync(grant.targetPath, 'utf8')).toBe('# Old body\n');
    context.state.currentSessionId = 'other';
    expect((await invoke('plan:export', args)).success).toBe(false);
  });
  it('does not issue after dialog cancellation or a session switch during confirmation', async () => {
    mocks.saveDialog.mockResolvedValueOnce({ canceled: true });
    expect(await invoke('plan:issueApprovalToken', { ...request, action: 'plan.export' })).toEqual({ cancelled: true });
    mocks.confirm.mockImplementationOnce(async () => { context.state.currentSessionId = 'other'; return { response: 0 }; });
    await expect(invoke('plan:issueApprovalToken', { ...request, action: 'plan.saveToProject' })).rejects.toThrow(/SESSION_DENIED/);
  });
});
