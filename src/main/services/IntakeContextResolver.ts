import fs from 'fs';
import path from 'path';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type {
  AppMode,
  CaptureDescriptor,
  DebugSessionStartRequest,
  ProjectInputRecord,
  ProjectRecord,
  SessionRecord,
} from '@shared/types/session';
import type { IntakeContext } from '@shared/types/workflow';
import { storageAdapter } from './StorageAdapter';
import { rdxSessionService } from '../index';
import { settingsService } from './SettingsService';
import { replayDeviceService } from './ReplayDeviceService';

const TASK_FILE_PATTERN = /([A-Za-z]:[\\/][^\r\n"]+?\.txt)/g;
const CAPTURE_FILE_PATTERN = /([A-Za-z0-9_.-]+\.rdc)/gi;
const EVENT_ID_PATTERN = /event\s*id\s*(?:是|:)?\s*(\d+)/i;

export interface ResolvedIntakeContext {
  intakeContext: IntakeContext;
  project: ProjectRecord;
  session: SessionRecord | null;
  goalText: string;
  taskFilePath?: string;
  taskFileContent?: string;
  explicitCaptureFileName?: string;
  explicitEventId?: number;
  captures: CaptureDescriptor[];
  primaryCaptureId?: string;
  replayDevice: ReplayDeviceEntry;
  backend: 'local' | 'remote';
  taskSources: string[];
  projectInputs: ProjectInputRecord[];
}

function firstMatch(pattern: RegExp, value: string): string | undefined {
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match?.[1];
}

function parseTaskFilePath(goal: string): string | undefined {
  const match = goal.match(TASK_FILE_PATTERN);
  return match?.[0] ? path.resolve(match[0]) : undefined;
}

function parseCaptureFileName(text: string): string | undefined {
  const match = text.match(CAPTURE_FILE_PATTERN);
  return match?.[0];
}

function parseEventId(text: string): number | undefined {
  const raw = firstMatch(EVENT_ID_PATTERN, text);
  if (!raw) {
    return undefined;
  }
  const eventId = Number(raw);
  return Number.isFinite(eventId) ? eventId : undefined;
}

function inferBackend(goal: string, requestMode: AppMode): 'local' | 'remote' {
  if (requestMode !== 'debugger') {
    return 'local';
  }
  return /\bremote\b|远端|安卓|android/i.test(goal) ? 'remote' : 'local';
}

function createCaptureDescriptor(input: ProjectInputRecord, backend: 'local' | 'remote'): CaptureDescriptor {
  return {
    id: input.inputId,
    filePath: input.filePath,
    role: 'primary',
    backendHint: backend,
    status: 'pending',
  };
}

function chooseFallbackReplayDevice(preferred?: ReplayDeviceEntry | null): ReplayDeviceEntry {
  if (preferred) {
    return preferred;
  }

  const devices = replayDeviceService.listDevices();
  const local = devices.find((device) => device.type === 'local');
  return local || {
    id: 'local',
    label: 'Local',
    type: 'local',
    status: 'online',
    transport: 'local',
    detailText: 'Local replay ready',
  };
}

export class IntakeContextResolver {
  resolve(request: DebugSessionStartRequest): ResolvedIntakeContext {
    const project = storageAdapter.getProjectById(request.projectId);
    if (!project) {
      throw new Error(`Project not found: ${request.projectId}`);
    }

    const session = request.sessionId ? storageAdapter.readSession(request.sessionId) : null;
    const taskFilePath = parseTaskFilePath(request.goal);
    const taskFileContent = taskFilePath && fs.existsSync(taskFilePath)
      ? fs.readFileSync(taskFilePath, 'utf-8')
      : undefined;
    const goalText = [request.goal, taskFileContent].filter(Boolean).join('\n\n').trim();
    const explicitCaptureFileName = parseCaptureFileName(goalText);
    const explicitEventId = parseEventId(goalText);
    const backend = inferBackend(goalText, request.mode);
    const projectInputs = storageAdapter.listProjectInputs(project.projectId);
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const currentSettings = settingsService.getAll();
    const debuggerRoute = currentSettings.llm.agentRoutes.find((route) => route.agentId === 'rdc-debugger');
    const requestCaptures = request.captures ?? [];

    let captures = requestCaptures.length > 0
      ? requestCaptures.map((capture) => ({ ...capture }))
      : projectInputs.map((input) => createCaptureDescriptor(input, backend));

    if (explicitCaptureFileName) {
      const exactFromRequest = captures.find((capture) => path.basename(capture.filePath) === explicitCaptureFileName);
      if (!exactFromRequest) {
        const matchedInput = projectInputs.find((input) => input.fileName === explicitCaptureFileName);
        if (matchedInput) {
          captures = [createCaptureDescriptor(matchedInput, backend)];
        }
      } else {
        captures = captures.map((capture) => ({
          ...capture,
          role: path.basename(capture.filePath) === explicitCaptureFileName ? 'primary' : capture.role,
          backendHint: backend,
        }));
      }
    }

    const primaryCapture = captures.find((capture) => {
      if (request.primaryCaptureId) {
        return capture.id === request.primaryCaptureId;
      }
      if (explicitCaptureFileName) {
        return path.basename(capture.filePath) === explicitCaptureFileName;
      }
      if (openedCapture) {
        return capture.filePath === openedCapture.filePath;
      }
      return captures.length === 1;
    }) || null;

    const replayDevice = chooseFallbackReplayDevice(request.replayDevice);
    const taskSources = taskFilePath ? [taskFilePath] : [];

    return {
      intakeContext: {
        taskFilePath,
        taskFileContent,
        effectiveGoal: goalText || request.goal,
        discoveredProjectRoot: project.rootPath,
        openedCaptureId: openedCapture?.captureId ?? null,
        openedCapturePath: openedCapture?.filePath ?? null,
        availableCaptureIds: captures.map((capture) => capture.id),
        providerId: debuggerRoute?.providerId || undefined,
        modelId: debuggerRoute?.modelId,
        replayDeviceId: replayDevice.id,
        replayDeviceLabel: replayDevice.label,
      },
      project,
      session,
      goalText: goalText || request.goal,
      taskFilePath,
      taskFileContent,
      explicitCaptureFileName,
      explicitEventId,
      captures: captures.map((capture) => ({
        ...capture,
        backendHint: capture.backendHint || backend,
      })),
      primaryCaptureId: primaryCapture?.id,
      replayDevice,
      backend,
      taskSources,
      projectInputs,
    };
  }
}

export const intakeContextResolver = new IntakeContextResolver();
