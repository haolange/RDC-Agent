import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hashAttachmentContents } from '../agent-runtime/attachments/ConversationAttachmentHashing';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-att-tx-'));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
}));

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
  return {
    appPathService: {
      getAppStatePaths: () => paths,
      getUserDataRoot: () => tempRoot,
      getRuntimePaths: () => ({ userDataRoot: tempRoot, ...paths }),
      getProjectRdcPaths: (projectRoot: string) => ({
        projectRoot,
        projectRdcRoot: path.join(projectRoot, '.rdc-agent'),
        projectMetadataPath: path.join(projectRoot, '.rdc-agent', 'project.yaml'),
        gitignorePath: path.join(projectRoot, '.rdc-agent', '.gitignore'),
        agentsPath: path.join(projectRoot, '.rdc-agent', 'agents'),
        skillsPath: path.join(projectRoot, '.rdc-agent', 'skills'),
        mcpPath: path.join(projectRoot, '.rdc-agent', 'mcp'),
        hooksPath: path.join(projectRoot, '.rdc-agent', 'hooks'),
        policiesPath: path.join(projectRoot, '.rdc-agent', 'policies'),
        knowledgePath: path.join(projectRoot, '.rdc-agent', 'knowledge'),
        memoryPath: path.join(projectRoot, '.rdc-agent', 'memory'),
        inputsPath: path.join(projectRoot, '.rdc-agent', 'inputs'),
        artifactsPath: path.join(projectRoot, '.rdc-agent', 'artifacts'),
      }),
      initializeProjectRdc: (projectRoot: string) => {
        const projectPaths = {
          projectRoot,
          projectRdcRoot: path.join(projectRoot, '.rdc-agent'),
          projectMetadataPath: path.join(projectRoot, '.rdc-agent', 'project.yaml'),
          gitignorePath: path.join(projectRoot, '.rdc-agent', '.gitignore'),
          agentsPath: path.join(projectRoot, '.rdc-agent', 'agents'),
          skillsPath: path.join(projectRoot, '.rdc-agent', 'skills'),
          mcpPath: path.join(projectRoot, '.rdc-agent', 'mcp'),
          hooksPath: path.join(projectRoot, '.rdc-agent', 'hooks'),
          policiesPath: path.join(projectRoot, '.rdc-agent', 'policies'),
          knowledgePath: path.join(projectRoot, '.rdc-agent', 'knowledge'),
          memoryPath: path.join(projectRoot, '.rdc-agent', 'memory'),
          inputsPath: path.join(projectRoot, '.rdc-agent', 'inputs'),
          artifactsPath: path.join(projectRoot, '.rdc-agent', 'artifacts'),
        };
        for (const dir of [
          projectPaths.projectRdcRoot,
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

describe('attachment staging bytes are the commit source', () => {
  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('hashes staged bytes then commits them after the original source is replaced', async () => {
    const { projectWorkspaceStore, sessionRecordStore, conversationHistoryStore } = await import('../sessions/store/sessionStores');
    await projectWorkspaceStore.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'project-root');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projectWorkspaceStore.createProject(projectRoot);
    const session = sessionRecordStore.createSession(project.projectId, 'Attachment commit');

    const sourcePath = path.join(tempRoot, 'source.txt');
    fs.writeFileSync(sourcePath, 'fingerprint-bytes');
    const stagingDir = path.join(tempRoot, 'staging');
    const [stagedPath] = conversationHistoryStore.stageAttachmentInputs([sourcePath], stagingDir);
    expect(stagedPath).toBeTruthy();

    const hashes = await hashAttachmentContents([{
      sourcePath: stagedPath!,
      fileName: 'source.txt',
      mimeType: 'text/plain',
    }]);
    expect(hashes[0]).toMatch(/^[a-f0-9]{64}$/);

    fs.writeFileSync(sourcePath, 'replaced-after-hash');

    const commit = conversationHistoryStore.beginExistingConversationTurnCommit(
      session.sessionId,
      [stagedPath!],
      'req-att-tx',
      'turn-att-tx',
    );
    const committedPath = commit.attachments[0]?.filePath;
    expect(committedPath).toBeTruthy();
    expect(fs.readFileSync(committedPath!, 'utf8')).toBe('fingerprint-bytes');
    expect(fs.readFileSync(sourcePath, 'utf8')).toBe('replaced-after-hash');
    expect(fs.readFileSync(stagedPath!, 'utf8')).toBe('fingerprint-bytes');

    const replayHashes = await hashAttachmentContents([{
      sourcePath: committedPath!,
      fileName: 'source.txt',
      mimeType: 'text/plain',
    }]);
    expect(replayHashes[0]).toBe(hashes[0]);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(session.sessionPath, 'attachments.json'), 'utf8'),
    ) as { schemaVersion?: string; attachments?: unknown };
    expect(manifest.schemaVersion).toBe('1');
    expect(Array.isArray(manifest.attachments)).toBe(true);
    expect(manifest.attachments).toHaveLength(1);
  });

  it('preserves the display name and independent bytes across initial send and edit-resend', async () => {
    const { projectWorkspaceStore, sessionRecordStore, conversationHistoryStore } = await import('../sessions/store/sessionStores');
    await projectWorkspaceStore.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'rewrite-project');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projectWorkspaceStore.createProject(projectRoot);
    const sources = ['first', 'second'].map((text) => {
      const root = path.join(tempRoot, text);
      fs.mkdirSync(root, { recursive: true });
      const file = path.join(root, 'stability.md');
      fs.writeFileSync(file, text);
      return file;
    });
    const reserved = sessionRecordStore.allocateStagedConversationSession(project.projectId, 'Attachments', 'req-start', 'turn-start');
    const planned = conversationHistoryStore.planAttachmentsForTurn(reserved.session, sources, path.join(reserved.finalPath, 'attachments'));
    const staged = sessionRecordStore.beginStagedConversationSession(project.projectId, 'Attachments', sources, 'req-start', 'turn-start', {
      reserved, plannedAttachments: planned,
    });
    const session = sessionRecordStore.commitStagedConversationSession(staged, [], null);
    const original = conversationHistoryStore.listSessionAttachments(session.sessionId);
    expect(original.map((entry) => entry.fileName)).toEqual(['stability.md', 'stability.md']);
    expect(original.map((entry) => path.basename(entry.filePath))).toEqual(['stability.md', 'stability-2.md']);
    const previous = original[1]!;
    const resend = conversationHistoryStore.planAttachmentsForTurn(session, [previous.filePath], sessionRecordStore.getSessionAttachmentsDir(session.sessionId), [
      { ...previous, layer: 'text' },
    ]);
    const commit = conversationHistoryStore.beginExistingConversationTurnCommit(session.sessionId, [previous.filePath], 'req-edit', 'turn-edit', resend);
    conversationHistoryStore.commitExistingConversationTurn(commit, [], null);

    const attachments = conversationHistoryStore.listSessionAttachments(session.sessionId);
    expect(attachments.slice(0, 2)).toEqual(original);
    expect(attachments[2]).toMatchObject({ fileName: 'stability.md' });
    expect(new Set(attachments.map((entry) => entry.attachmentId)).size).toBe(3);
    expect(attachments.map((entry) => path.basename(entry.filePath))).toEqual(['stability.md', 'stability-2.md', 'stability-3.md']);
    expect(attachments.map((entry) => fs.readFileSync(entry.filePath, 'utf8'))).toEqual(['first', 'second', 'second']);
  });
});
