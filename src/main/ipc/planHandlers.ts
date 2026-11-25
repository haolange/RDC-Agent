import path from 'node:path';
import { createHash } from 'node:crypto';
import { dialog, ipcMain } from 'electron';
import { AppError } from '@shared/errors/appError';
import { nativeMessage } from '../window/nativeI18n';
import { confirmInMainProcess } from '../window/mainConfirmation';
import { readReferencedPlan } from '../sessions/run/sessionPlanReference';
import { assertPlanWritePath, composeProjectPlan, writePlanFile } from '../sessions/run/planFilePersistence';
import { sessionRecordStore } from '../sessions/store/sessionStores';
import { appPathService } from '../runtime/AppPathService';
import { ipcApprovalTokenService } from '../runtime/IpcApprovalTokenService';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';
import { conversationService } from '../conversation/ConversationService';
import { PlanExportArgsSchema, PlanIssueApprovalTokenArgsSchema, PlanReadArgsSchema, PlanSaveToProjectArgsSchema, PlanCancelReviewArgsSchema } from './validation/planSchemas';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import type { PlanApprovalTokenRequest, PlanExportRequest, PlanReadRequest, PlanSaveToProjectRequest } from '@shared/types/planReview';
import type { WorkbenchIpcContext } from './workbenchContext';

async function confirmPlanMutation(action: 'plan.saveToProject' | 'plan.export', sessionId: string): Promise<boolean> {
  return confirmInMainProcess({
    action,
    title: nativeMessage('planTitle'),
    message: nativeMessage(action === 'plan.saveToProject' ? 'planSave' : 'planExport'),
    detail: nativeMessage('session', { id: sessionId }),
    confirmLabel: nativeMessage('allowOnce'),
    cancelLabel: nativeMessage('cancel'),
  });
}


function requireCurrentSession(context: WorkbenchIpcContext, sessionId: string): void {
  if (context.state.currentSessionId !== sessionId || !sessionRecordStore.findSessionLocation(sessionId)) {
    throw new AppError('PLAN_SESSION_DENIED', 'plan actions require the current session.');
  }
}

function projectTarget(sessionId: string): string {
  const location = sessionRecordStore.findSessionLocation(sessionId);
  if (!location) throw new AppError('PLAN_SESSION_NOT_FOUND');
  return path.join(appPathService.getProjectRdcPaths(location.project.rootPath).plansPath, sessionId, 'plan.md');
}

function binding(request: PlanReadRequest, owner: string, target: string): string {
  return createHash('sha256').update(JSON.stringify([
    request.sessionId, owner, request.planId, request.revision, request.uri, request.expectedHash, path.resolve(target),
  ])).digest('hex');
}

export function registerPlanHandlers(context: WorkbenchIpcContext): void {
  agentPlanReviewRequestService.setBusyChecker(sessionId => conversationService.isSessionBusy(sessionId));
  agentPlanReviewRequestService.subscribe(projection => context.broadcastToRenderer('plan:reviewChanged', projection));
  ipcMain.handle('plan:reopenReview', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(PlanReadArgsSchema, rawArgs, { label: 'plan:reopenReview', maxBytes: 8192 });
    requireCurrentSession(context, request.sessionId);
    return agentPlanReviewRequestService.reopen(request);
  });
  ipcMain.handle('plan:cancelReview', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(PlanCancelReviewArgsSchema, rawArgs, { label: 'plan:cancelReview', maxBytes: 4096 });
    requireCurrentSession(context, request.sessionId);
    const result = agentPlanReviewRequestService.cancel(request.sessionId, request.reviewId);
    if (result.success && result.liveTurnId) {
      await conversationService.cancelActiveTurn({ sessionId: request.sessionId });
    }
    return { success: result.success };
  });
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
        title: nativeMessage('exportPlan'),
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
    if (current.ownerSessionId !== selected.ownerSessionId) throw new AppError('PLAN_REFERENCE_CHANGED');
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
