import { ipcMain } from 'electron';
import type { CommitGenerativeUiVersionRequest, GenerativeUiLoopRequest, GenerativeUiRuntimeEventDetails, GenerativeUiRuntimeEventType, GenerativeUiStopReason } from '@shared/types/generativeUi';
import { generativeUiCanvasService } from '../generative-ui/GenerativeUiCanvasService';
import { buildGenerativeUiSandboxDocument, GENERATIVE_UI_IFRAME_SANDBOX } from '../generative-ui/GenerativeUiSandbox';
import { GenerativeUiInnerLoop } from '../generative-ui/GenerativeUiInnerLoop';
import { LlmGenerativeUiModel } from '../generative-ui/LlmGenerativeUiModel';
import { generativeUiOuterLoopService } from '../generative-ui/GenerativeUiOuterLoopService';
import { generativeUiRuntimeContinuation } from '../generative-ui/GenerativeUiRuntimeContinuation';
import { generativeUiBenchmarkService } from '../generative-ui/GenerativeUiBenchmarkService';

const model = new LlmGenerativeUiModel();
const innerLoop = new GenerativeUiInnerLoop(model, model, model);

export function registerGenerativeUiHandlers(): void {
  ipcMain.handle('generative-ui:run', (_event, request: GenerativeUiLoopRequest) => innerLoop.run(request));
  ipcMain.handle('generative-ui:create', (_event, projectId: string, sessionId: string, title: string, prompt: string) =>
    generativeUiCanvasService.create(projectId, sessionId, title, prompt));
  ipcMain.handle('generative-ui:list', (_event, sessionId: string) => generativeUiCanvasService.list(sessionId));
  ipcMain.handle('generative-ui:metrics', (_event, sessionId?: string) => generativeUiCanvasService.summarize(sessionId));
  ipcMain.handle('generative-ui:evidenceList', (_event, sessionId: string) => generativeUiOuterLoopService.list(sessionId));
  ipcMain.handle('generative-ui:evidenceAdd', (_event, sessionId: string, request) => generativeUiOuterLoopService.add(sessionId, request));
  ipcMain.handle('generative-ui:outerReport', (_event, sessionId: string) => generativeUiOuterLoopService.report(sessionId));
  ipcMain.handle('generative-ui:benchmarkList', () => generativeUiBenchmarkService.list());
  ipcMain.handle('generative-ui:benchmarkRun', (_event, projectId: string, sessionId: string, caseId: string) => generativeUiBenchmarkService.run(projectId, sessionId, caseId));
  ipcMain.handle('generative-ui:get', (_event, sessionId: string, canvasId: string) => generativeUiCanvasService.get(sessionId, canvasId));
  ipcMain.handle('generative-ui:commit', (_event, sessionId: string, request: CommitGenerativeUiVersionRequest) =>
    generativeUiCanvasService.commit(sessionId, request));
  ipcMain.handle('generative-ui:createBranch', (_event, sessionId: string, canvasId: string, name: string, fromVersionId: string | null) =>
    generativeUiCanvasService.createBranch(sessionId, canvasId, name, fromVersionId));
  ipcMain.handle('generative-ui:switchBranch', (_event, sessionId: string, canvasId: string, branchId: string) =>
    generativeUiCanvasService.switchBranch(sessionId, canvasId, branchId));
  ipcMain.handle('generative-ui:stop', (_event, sessionId: string, canvasId: string, reason: GenerativeUiStopReason) =>
    generativeUiCanvasService.stop(sessionId, canvasId, reason));
  ipcMain.handle('generative-ui:observe', (_event, sessionId: string, canvasId: string, versionId: string, eventType: GenerativeUiRuntimeEventType, details?: GenerativeUiRuntimeEventDetails) =>
    generativeUiRuntimeContinuation.observe(sessionId, canvasId, versionId, eventType, details));
  ipcMain.handle('generative-ui:feedback', (_event, sessionId: string, canvasId: string, versionId: string, value: { rating: 1 | 2 | 3 | 4 | 5; usable: boolean; preferredOverStatic?: boolean; comment?: string }) =>
    generativeUiCanvasService.recordFeedback(sessionId, canvasId, versionId, value));
  ipcMain.handle('generative-ui:export', (_event, sessionId: string, canvasId: string, versionId: string) =>
    generativeUiCanvasService.exportVersion(sessionId, canvasId, versionId));
  ipcMain.handle('generative-ui:getPreview', (_event, sessionId: string, canvasId: string, versionId: string) => {
    const canvas = generativeUiCanvasService.get(sessionId, canvasId);
    const version = canvas?.versions.find((entry) => entry.versionId === versionId);
    if (!version) throw new Error(`Canvas version not found: ${versionId}`);
    return {
      document: buildGenerativeUiSandboxDocument(version.source),
      sandbox: GENERATIVE_UI_IFRAME_SANDBOX,
    };
  });
}
