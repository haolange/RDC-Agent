import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-session-cleanup-'));

vi.mock('../runtime/AppPathService', () => {
  const appStateRoot = path.join(tempRoot, 'state');
  const paths = {
    appStateRoot,
    projectsPath: path.join(appStateRoot, 'projects'),
    sessionsPath: path.join(appStateRoot, 'sessions'),
    tasksPath: path.join(appStateRoot, 'tasks'),
    tracesPath: path.join(appStateRoot, 'traces'),
    llmCallsPath: path.join(appStateRoot, 'llm-calls'),
    secretsPath: path.join(tempRoot, 'secrets'),
    logsPath: path.join(tempRoot, 'logs'),
    logPath: path.join(tempRoot, 'logs', 'app.log'),
    capturePreviewsPath: path.join(tempRoot, 'capture-previews'),
    profileStatePath: path.join(appStateRoot, 'profile'),
    knowledgePath: path.join(appStateRoot, 'knowledge'),
  };
  for (const dir of Object.values(paths)) {
    if (typeof dir === 'string' && !dir.endsWith('.log')) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  fs.mkdirSync(path.join(tempRoot, 'project-root'), { recursive: true });
  return {
    appPathService: {
      getAppStatePaths: () => paths,
      getUserDataRoot: () => tempRoot,
      getRuntimePaths: () => ({ userDataRoot: tempRoot, ...paths }),
      getProjectRdxPaths: (projectRoot: string) => ({
        projectRoot,
        projectRdxRoot: path.join(projectRoot, '.rdx'),
        projectMetadataPath: path.join(projectRoot, '.rdx', 'project.yaml'),
        gitignorePath: path.join(projectRoot, '.rdx', '.gitignore'),
        agentsPath: path.join(projectRoot, '.rdx', 'agents'),
        skillsPath: path.join(projectRoot, '.rdx', 'skills'),
        mcpPath: path.join(projectRoot, '.rdx', 'mcp'),
        hooksPath: path.join(projectRoot, '.rdx', 'hooks'),
        policiesPath: path.join(projectRoot, '.rdx', 'policies'),
        knowledgePath: path.join(projectRoot, '.rdx', 'knowledge'),
        memoryPath: path.join(projectRoot, '.rdx', 'memory'),
        inputsPath: path.join(projectRoot, '.rdx', 'inputs'),
        artifactsPath: path.join(projectRoot, '.rdx', 'artifacts'),
      }),
      initializeProjectRdx: (projectRoot: string) => {
        const projectPaths = {
          projectRoot,
          projectRdxRoot: path.join(projectRoot, '.rdx'),
          projectMetadataPath: path.join(projectRoot, '.rdx', 'project.yaml'),
          gitignorePath: path.join(projectRoot, '.rdx', '.gitignore'),
          agentsPath: path.join(projectRoot, '.rdx', 'agents'),
          skillsPath: path.join(projectRoot, '.rdx', 'skills'),
          mcpPath: path.join(projectRoot, '.rdx', 'mcp'),
          hooksPath: path.join(projectRoot, '.rdx', 'hooks'),
          policiesPath: path.join(projectRoot, '.rdx', 'policies'),
          knowledgePath: path.join(projectRoot, '.rdx', 'knowledge'),
          memoryPath: path.join(projectRoot, '.rdx', 'memory'),
          inputsPath: path.join(projectRoot, '.rdx', 'inputs'),
          artifactsPath: path.join(projectRoot, '.rdx', 'artifacts'),
        };
        for (const dir of [
          projectPaths.projectRdxRoot,
          projectPaths.agentsPath,
          projectPaths.skillsPath,
          projectPaths.mcpPath,
          projectPaths.hooksPath,
          projectPaths.policiesPath,
          projectPaths.knowledgePath,
          projectPaths.memoryPath,
          projectPaths.inputsPath,
          projectPaths.artifactsPath,
        ]) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return projectPaths;
      },
    },
  };
});

describe('StorageAdapter.removeSession side-channel cleanup', () => {
  it('removes tasks, llm-calls, and matching trace run files for the session', async () => {
    const { storageAdapter } = await import('./StorageAdapter');
    const { appPathService } = await import('../runtime/AppPathService');
    const paths = appPathService.getAppStatePaths();

    const project = storageAdapter.createProject(path.join(tempRoot, 'project-root'));
    const session = storageAdapter.createSession(project.projectId, 'Cleanup Session');
    const run = await storageAdapter.createRun({
      caseId: session.sessionId,
      sessionId: session.sessionId,
      capturePaths: [],
      mode: 'debugger',
    });
    const runId = run.runId;

    const taskDir = path.join(paths.tasksPath, session.sessionId);
    const llmDir = path.join(paths.llmCallsPath, session.sessionId);
    const runFile = path.join(paths.tracesPath, 'runs', `${runId}.json`);
    const eventFile = path.join(paths.tracesPath, 'events', `${runId}.jsonl`);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(llmDir, { recursive: true });
    fs.mkdirSync(path.dirname(runFile), { recursive: true });
    fs.mkdirSync(path.dirname(eventFile), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'task.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(llmDir, 'snap.json'), '{}', 'utf8');
    fs.writeFileSync(runFile, '{}', 'utf8');
    fs.writeFileSync(eventFile, '', 'utf8');

    storageAdapter.removeSession(session.sessionId);

    expect(fs.existsSync(session.sessionPath)).toBe(false);
    expect(fs.existsSync(taskDir)).toBe(false);
    expect(fs.existsSync(llmDir)).toBe(false);
    expect(fs.existsSync(runFile)).toBe(false);
    expect(fs.existsSync(eventFile)).toBe(false);
  });

  it('keeps a new session invisible until its prepared turn is atomically committed', async () => {
    const { storageAdapter } = await import('./StorageAdapter');
    const projectRoot = path.join(tempRoot, 'staged-project-root');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = storageAdapter.createProject(projectRoot);
    const sourcePath = path.join(tempRoot, 'staged-attachment.txt');
    fs.writeFileSync(sourcePath, 'attachment', 'utf8');
    const staged = storageAdapter.beginStagedConversationSession(
      project.projectId,
      'Prepared turn',
      [sourcePath],
      'request-staged',
      'turn-staged',
    );

    expect(storageAdapter.listSessions(project.projectId)).toEqual([]);
    expect(fs.existsSync(staged.finalPath)).toBe(false);

    const preparedContext = {
      requestId: 'request-staged',
      turnId: 'turn-staged',
      route: {
        providerId: 'provider',
        adapterId: 'openai-responses',
        selectedModelId: 'model',
        effectiveModelId: 'model-fast',
        protocol: 'OpenAIResponses',
        catalogRevision: 'catalog-1',
        routeRevision: 'route-1',
        bindingIds: ['fast:model-fast'],
      },
      wirePatch: { headers: {}, body: {} },
      controls: { reasoningLevel: 'high' as const, maxContextMode: false, fastModel: true },
      contextMode: 'normal' as const,
      preparedInputTokens: 10,
      uncompactedInputTokens: 10,
      promptBudgetTokens: 100,
      contextWindowTokens: 128,
      usagePercent: 10,
      breakdown: [],
      compactionApplied: false,
      filteredArtifactCount: 0,
      preparedAt: 1,
    };
    const user: ConversationMessage = {
      id: 'user-staged', requestId: 'request-staged', turnId: 'turn-staged',
      sessionId: staged.session.sessionId, projectId: project.projectId, role: 'user',
      content: 'hello', createdAt: 1, preparedContext, attachments: staged.attachments,
    };
    const assistant: ConversationMessage = {
      id: 'assistant-staged', requestId: 'request-staged', turnId: 'turn-staged',
      sessionId: staged.session.sessionId, projectId: project.projectId, role: 'assistant',
      content: '', status: 'streaming', createdAt: 2, preparedContext,
    };
    storageAdapter.commitStagedConversationSession(staged, [user, assistant], null);

    expect(storageAdapter.listSessions(project.projectId)).toHaveLength(1);
    expect(storageAdapter.readConversationHistory(staged.session.sessionId)).toEqual([
      { ...user, workTrace: null },
      { ...assistant, workTrace: null },
    ]);
    expect(storageAdapter.listSessionAttachments(staged.session.sessionId)).toHaveLength(1);
    expect(fs.readFileSync(staged.attachments[0]!.filePath, 'utf8')).toBe('attachment');
  });

  it('recovers a prepared existing-session commit without leaving orphan attachments or messages', async () => {
    const { storageAdapter } = await import('./StorageAdapter');
    const projectRoot = path.join(tempRoot, 'recover-project-root');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = storageAdapter.createProject(projectRoot);
    const session = storageAdapter.createSession(project.projectId, 'Recover turn');
    const sourcePath = path.join(tempRoot, 'recover-attachment.txt');
    fs.writeFileSync(sourcePath, 'pending', 'utf8');

    const pending = storageAdapter.beginExistingConversationTurnCommit(
      session.sessionId,
      [sourcePath],
      'request-recover',
      'turn-recover',
    );
    expect(storageAdapter.listSessionAttachments(session.sessionId)).toHaveLength(1);
    expect(fs.existsSync(pending.attachments[0]!.filePath)).toBe(true);

    await storageAdapter.initializeWorkspace();

    expect(storageAdapter.listSessionAttachments(session.sessionId)).toEqual([]);
    expect(storageAdapter.readConversationHistory(session.sessionId)).toEqual([]);
    expect(fs.existsSync(pending.attachments[0]!.filePath)).toBe(false);
    expect(fs.existsSync(path.join(session.sessionPath, 'turn-commit.json'))).toBe(false);
  });
});
