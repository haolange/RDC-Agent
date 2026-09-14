import { BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { PlanApprovalTokenRequest, PlanExportRequest, PlanReadRequest, PlanSaveToProjectRequest } from '@shared/types/planReview';
import { readReferencedPlan } from '../sessions/sessionPlanReference';
import { assertPlanWritePath, composeProjectPlan, writePlanFile } from '../sessions/planFilePersistence';
import { storageAdapter } from '../sessions/StorageAdapter';
import { appPathService } from '../runtime/AppPathService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import type { WorkbenchIpcContext } from './workbenchContext';
import { ipcApprovalTokenService } from './validation/IpcApprovalTokenService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import { PlanExportArgsSchema, PlanIssueApprovalTokenArgsSchema, PlanReadArgsSchema, PlanSaveToProjectArgsSchema } from './validation/planSchemas';

async function confirmPlanMutation(action: 'plan.saveToProject' | 'plan.export', sessionId: string): Promise<boolean> {
  if (process.env.RDC_AGENT_TEST_MODE === '1') return true;
  if (process.env.RDC_AGENT_BROWSER_QA === '1') {
    const owner = BrowserWindow.getFocusedWindow() ?? undefined;
    if (!owner && process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS === '1') {
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'warning',
        title: 'Browser QA plan mutation auto-confirmed',
        summary: `${action} was auto-confirmed because Browser QA full access is explicitly enabled.`,
        raw: { action, sessionId },
      });
      return true;
    }
    if (!owner) return false;
  }
  const owner = BrowserWindow.getFocusedWindow() ?? undefined;
  if (!owner) return false;
  const result = await dialog.showMessageBox(owner, {
    type: 'warning',
    buttons: ['Allow once', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm plan file write',
    message: action === 'plan.saveToProject' ? 'Save this plan into the project?' : 'Export this plan to a file?',
    detail: `Session ${sessionId}. The action is authorized by the native main-process dialog.`,
    noLink: true,
  });
  return result.response === 0;
}


function requireCurrentSession(context: WorkbenchIpcContext, sessionId: string): void {
  if (context.state.currentSessionId !== sessionId || !storageAdapter.sessions.findSessionLocation(sessionId)) {
    throw new Error('PLAN_SESSION_DENIED: plan actions require the current session.');
  }
}

function projectTarget(sessionId: string): string {
  const location = storageAdapter.sessions.findSessionLocation(sessionId);
  if (!location) throw new Error('PLAN_SESSION_NOT_FOUND');
  return path.join(appPathService.getProjectRdxPaths(location.project.rootPath).plansPath, sessionId, 'plan.md');
}

function binding(request: PlanReadRequest, owner: string, target: string): string {
  return createHash('sha256').update(JSON.stringify([
    request.sessionId, owner, request.planId, request.revision, request.uri, request.expectedHash, path.resolve(target),
  ])).digest('hex');
}

export function registerPlanHandlers(context: WorkbenchIpcContext): void {
  ipcMain.handle('plan:read', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(PlanReadArgsSchema, rawArgs, { label: 'plan:read', maxBytes: 8192 }) as [PlanReadRequest];
    requireCurrentSession(context, request.sessionId);
    const { markdown, uri, hash } = readReferencedPlan(request);
    return { markdown, uri, hash };
  });

  ipcMain.handle('plan:issueApprovalToken', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(PlanIssueApprovalTokenArgsSchema, rawArgs, { label: 'plan:issueApprovalToken', maxBytes: 8192 }) as [PlanApprovalTokenRequest];
    requireCurrentSession(context, request.sessionId);
    const selected = readReferencedPlan(request);
    let targetPath: string;
    if (request.action === 'plan.export') {
      const result = await dialog.showSaveDialog({
        defaultPath: selected.plan.title.replace(/[\\/:*?"<>|]/g, '-') + '.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      targetPath = assertPlanWritePath(result.filePath);
    } else {
      targetPath = assertPlanWritePath(projectTarget(request.sessionId));
      if (!await confirmPlanMutation(request.action, request.sessionId)) return { cancelled: true };
    }
    requireCurrentSession(context, request.sessionId);
    const current = readReferencedPlan(request);
    if (current.ownerSessionId !== selected.ownerSessionId) throw new Error('PLAN_REFERENCE_CHANGED');
    return { token: ipcApprovalTokenService.issue({
      action: request.action, scope: 'project', name: binding(request, current.ownerSessionId, targetPath),
    }), targetPath };
  });

  for (const action of ['plan.saveToProject', 'plan.export'] as const) {
    const channel = action === 'plan.export' ? 'plan:export' : 'plan:saveToProject';
    ipcMain.handle(channel, async (_event, ...rawArgs: unknown[]) => {
      try {
        const [request] = parseIpcArgs(action === 'plan.export' ? PlanExportArgsSchema : PlanSaveToProjectArgsSchema,
          rawArgs, { label: channel, maxBytes: 8192 }) as [PlanExportRequest | PlanSaveToProjectRequest];
        requireCurrentSession(context, request.sessionId);
        const selected = readReferencedPlan(request);
        const targetPath = assertPlanWritePath('targetPath' in request ? request.targetPath : projectTarget(request.sessionId));
        if (!ipcApprovalTokenService.consume({ token: request.approvalToken, action, scope: 'project',
          name: binding(request, selected.ownerSessionId, targetPath),
        })) return { success: false, error: 'PLAN_APPROVAL_TOKEN_INVALID' };
        const document = action === 'plan.export' ? selected.markdown : composeProjectPlan(selected.markdown, {
          planId: selected.plan.planId, revision: selected.plan.revision, sha256: selected.hash,
          agent: selected.agentId, sessionId: selected.ownerSessionId, savedAt: new Date().toISOString(),
        });
        writePlanFile(targetPath, document);
        return { success: true, path: targetPath };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
}
