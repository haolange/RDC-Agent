import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { CONVERSATION_COMPACTION_DELTA_THRESHOLD } from './storageCommitTypes';
import type { ConversationMessage } from '@shared/types/conversation';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-conversation-io-'));

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() },
}));

vi.mock('../../runtime/AppPathService', () => {
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

function makeMessage(overrides: Partial<ConversationMessage> & Pick<ConversationMessage, 'id' | 'content'>): ConversationMessage {
  return {
    turnId: 'turn-1',
    sessionId: 'session',
    projectId: 'project',
    role: 'assistant',
    createdAt: 1,
    status: 'streaming',
    ...overrides,
  };
}

describe('conversationHistoryStore streaming I/O', () => {
  it('writes deltas for streaming updates and compacts without full-snapshot amplification', async () => {
    const { projectWorkspaceStore, sessionRecordStore, conversationHistoryStore } = await import('./sessionStores');
    await projectWorkspaceStore.initializeWorkspace();
    const project = await projectWorkspaceStore.createProject(path.join(tempRoot, 'project-root'));
    const session = sessionRecordStore.createSession(project.projectId, 'stream-io');

    const base = makeMessage({
      id: 'assistant-1',
      content: 'Hello',
      sessionId: session.sessionId,
      projectId: project.projectId,
    });
    conversationHistoryStore.appendConversationMessage(session.sessionId, base);

    for (let index = 0; index < 8; index += 1) {
      conversationHistoryStore.appendConversationMessage(session.sessionId, {
        ...base,
        content: `Hello${'!'.repeat(index + 1)}`,
        updatedAt: 2 + index,
      });
    }

    const conversationPath = conversationHistoryStore.getConversationPath(session.sessionId);
    const rawLines = fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean);
    expect(rawLines.length).toBeGreaterThan(1);
    expect(rawLines.some((line) => line.includes('"op":"delta"'))).toBe(true);
    expect(rawLines.every((line) => {
      if (!line.includes('"op":"delta"')) return true;
      return !line.includes('"role":"assistant"');
    })).toBe(true);

    const history = conversationHistoryStore.readConversationHistory(session.sessionId);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe('Hello!!!!!!!!');

    // Cache hit should avoid re-reading when file is unchanged.
    const before = fs.readFileSync(conversationPath, 'utf8');
    const again = conversationHistoryStore.readConversationHistory(session.sessionId);
    expect(again[0]?.content).toBe('Hello!!!!!!!!');
    expect(fs.readFileSync(conversationPath, 'utf8')).toBe(before);

    conversationHistoryStore.compactConversationHistory(session.sessionId);
    const compacted = fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).not.toContain('"op":"delta"');
    expect(JSON.parse(compacted[0]!).content).toBe('Hello!!!!!!!!');
  });

  it('reports a conversation record that is not a message or delta as corruption instead of skipping it', async () => {
    const { projectWorkspaceStore, sessionRecordStore, conversationHistoryStore } = await import('./sessionStores');
    await projectWorkspaceStore.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'project-root-corrupt');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projectWorkspaceStore.createProject(projectRoot);
    const session = sessionRecordStore.createSession(project.projectId, 'corrupt-io');
    conversationHistoryStore.appendConversationMessage(session.sessionId, makeMessage({ id: 'user-1', content: 'Inspect', sessionId: session.sessionId, projectId: project.projectId }));
    fs.appendFileSync(conversationHistoryStore.getConversationPath(session.sessionId), `${JSON.stringify({ id: 'assistant-1', content: 'no owner' })}\n`);
    expect(() => conversationHistoryStore.readConversationHistory(session.sessionId)).toThrow(expect.objectContaining({ code: 'STORAGE_CORRUPT' }));
  });

  it('keeps a streamed delta durable when a reader blocks journal compaction', async () => {
    const { projectWorkspaceStore, sessionRecordStore, conversationHistoryStore, storageIo } = await import('./sessionStores');
    await projectWorkspaceStore.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'project-root-busy');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projectWorkspaceStore.createProject(projectRoot);
    const session = sessionRecordStore.createSession(project.projectId, 'busy-stream-io');
    const conversationPath = conversationHistoryStore.getConversationPath(session.sessionId);
    const base = makeMessage({
      id: 'assistant-busy', content: 'start', sessionId: session.sessionId, projectId: project.projectId,
    });
    conversationHistoryStore.appendConversationMessage(session.sessionId, base);

    const write = storageIo.writeJsonlAtomic.bind(storageIo);
    let blockedOnce = false;
    const writeSpy = vi.spyOn(storageIo, 'writeJsonlAtomic').mockImplementation((filePath, records) => {
      if (filePath === conversationPath && !blockedOnce) {
        blockedOnce = true;
        throw Object.assign(new Error('reader holds conversation journal'), { code: 'EBUSY' });
      }
      return write(filePath, records);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (let index = 1; index <= CONVERSATION_COMPACTION_DELTA_THRESHOLD; index += 1) {
        conversationHistoryStore.appendConversationMessage(session.sessionId, {
          ...base, content: `update-${index}`, updatedAt: index + 1,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(blockedOnce).toBe(true);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(conversationHistoryStore.conversationPendingDeltaCounts.get(session.sessionId)).toBe(CONVERSATION_COMPACTION_DELTA_THRESHOLD);
      expect(fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(CONVERSATION_COMPACTION_DELTA_THRESHOLD + 1);
      expect(conversationHistoryStore.readConversationHistory(session.sessionId)[0]?.content).toBe(`update-${CONVERSATION_COMPACTION_DELTA_THRESHOLD}`);

      for (let index = CONVERSATION_COMPACTION_DELTA_THRESHOLD + 1; index <= 2 * CONVERSATION_COMPACTION_DELTA_THRESHOLD; index += 1) {
        conversationHistoryStore.appendConversationMessage(session.sessionId, {
          ...base, content: `update-${index}`, updatedAt: index + 1,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(warning).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
      expect(conversationHistoryStore.readConversationHistory(session.sessionId)[0]?.content).toBe(`update-${2 * CONVERSATION_COMPACTION_DELTA_THRESHOLD}`);
    } finally {
      writeSpy.mockRestore();
      warning.mockRestore();
    }
  });

  it('appends only the work blocks an update changed and replays them into the full trace', async () => {
    const { projectWorkspaceStore, sessionRecordStore, conversationHistoryStore } = await import('./sessionStores');
    const { upsertLoopTextItem } = await import('../../conversation/ConversationWorkTrace');
    await projectWorkspaceStore.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'project-root-trace-blocks');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await projectWorkspaceStore.createProject(projectRoot);
    const session = sessionRecordStore.createSession(project.projectId, 'trace-blocks');
    const ref = (index: number) => ({ protocol: 'test', providerBlockKey: `text:${index}`, contentIndex: index });
    let trace = upsertLoopTextItem(undefined, 'loop-1', ref(0), 'A long finished loop', 'commentary', 'complete');
    trace = upsertLoopTextItem(trace, 'loop-2', ref(1), 'Str', undefined, 'streaming');
    const base = makeMessage({ id: 'assistant-blocks', content: '', sessionId: session.sessionId, projectId: project.projectId, workTrace: trace });
    conversationHistoryStore.appendConversationMessage(session.sessionId, base);

    trace = upsertLoopTextItem(trace, 'loop-2', ref(1), 'Streaming on', undefined, 'streaming');
    conversationHistoryStore.appendConversationMessage(session.sessionId, { ...base, workTrace: trace, updatedAt: 2 });

    const conversationPath = conversationHistoryStore.getConversationPath(session.sessionId);
    const lastRecord = JSON.parse(fs.readFileSync(conversationPath, 'utf8').trim().split('\n').at(-1)!);
    expect(lastRecord.patch.workTrace).toBeUndefined();
    expect(lastRecord.traceBlocks.blockIds).toEqual(['loop-1', 'loop-2']);
    expect(lastRecord.traceBlocks.changedBlocks.map((block: { id: string }) => block.id)).toEqual(['loop-2']);

    conversationHistoryStore.conversationHistoryCache.delete(session.sessionId);
    const replayed = conversationHistoryStore.readConversationHistory(session.sessionId)[0]!.workTrace!;
    expect(replayed.blocks.map((block) => block.items?.[0]?.kind === 'text' && block.items[0].text))
      .toEqual(['A long finished loop', 'Streaming on']);
  });
});
