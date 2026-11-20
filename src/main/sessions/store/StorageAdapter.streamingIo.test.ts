import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { CONVERSATION_COMPACTION_DELTA_THRESHOLD } from './storageCommitTypes';

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

describe('StorageAdapter conversation streaming I/O', () => {
  it('writes deltas for streaming updates and compacts without full-snapshot amplification', async () => {
    const { storageAdapter } = await import('./StorageAdapter');
    await storageAdapter.initializeWorkspace();
    const project = await storageAdapter.createProject(path.join(tempRoot, 'project-root'));
    const session = storageAdapter.createSession(project.projectId, 'stream-io');

    const base = makeMessage({
      id: 'assistant-1',
      content: 'Hello',
      sessionId: session.sessionId,
      projectId: project.projectId,
    });
    storageAdapter.appendConversationMessage(session.sessionId, base);

    for (let index = 0; index < 8; index += 1) {
      storageAdapter.appendConversationMessage(session.sessionId, {
        ...base,
        content: `Hello${'!'.repeat(index + 1)}`,
        updatedAt: 2 + index,
      });
    }

    const conversationPath = storageAdapter.getConversationPath(session.sessionId);
    const rawLines = fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean);
    expect(rawLines.length).toBeGreaterThan(1);
    expect(rawLines.some((line) => line.includes('"op":"delta"'))).toBe(true);
    expect(rawLines.every((line) => {
      if (!line.includes('"op":"delta"')) return true;
      return !line.includes('"role":"assistant"');
    })).toBe(true);

    const history = storageAdapter.readConversationHistory(session.sessionId);
    expect(history).toHaveLength(1);
    expect(history[0]?.content).toBe('Hello!!!!!!!!');

    // Cache hit should avoid re-reading when file is unchanged.
    const before = fs.readFileSync(conversationPath, 'utf8');
    const again = storageAdapter.readConversationHistory(session.sessionId);
    expect(again[0]?.content).toBe('Hello!!!!!!!!');
    expect(fs.readFileSync(conversationPath, 'utf8')).toBe(before);

    storageAdapter.compactConversationHistory(session.sessionId);
    const compacted = fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean);
    expect(compacted).toHaveLength(1);
    expect(compacted[0]).not.toContain('"op":"delta"');
    expect(JSON.parse(compacted[0]!).content).toBe('Hello!!!!!!!!');
  });

  it('keeps a streamed delta durable when a reader blocks journal compaction', async () => {
    const { storageAdapter } = await import('./StorageAdapter');
    await storageAdapter.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'project-root-busy');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await storageAdapter.createProject(projectRoot);
    const session = storageAdapter.createSession(project.projectId, 'busy-stream-io');
    const conversationPath = storageAdapter.getConversationPath(session.sessionId);
    const base = makeMessage({
      id: 'assistant-busy', content: 'start', sessionId: session.sessionId, projectId: project.projectId,
    });
    storageAdapter.appendConversationMessage(session.sessionId, base);

    const write = storageAdapter.io.writeJsonlAtomic.bind(storageAdapter.io);
    let blockedOnce = false;
    const writeSpy = vi.spyOn(storageAdapter.io, 'writeJsonlAtomic').mockImplementation((filePath, records) => {
      if (filePath === conversationPath && !blockedOnce) {
        blockedOnce = true;
        throw Object.assign(new Error('reader holds conversation journal'), { code: 'EBUSY' });
      }
      return write(filePath, records);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (let index = 1; index <= CONVERSATION_COMPACTION_DELTA_THRESHOLD; index += 1) {
        storageAdapter.appendConversationMessage(session.sessionId, {
          ...base, content: `update-${index}`, updatedAt: index + 1,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(blockedOnce).toBe(true);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(storageAdapter.conversationPendingDeltaCounts.get(session.sessionId)).toBe(CONVERSATION_COMPACTION_DELTA_THRESHOLD);
      expect(fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(CONVERSATION_COMPACTION_DELTA_THRESHOLD + 1);
      expect(storageAdapter.readConversationHistory(session.sessionId)[0]?.content).toBe(`update-${CONVERSATION_COMPACTION_DELTA_THRESHOLD}`);

      for (let index = CONVERSATION_COMPACTION_DELTA_THRESHOLD + 1; index <= 2 * CONVERSATION_COMPACTION_DELTA_THRESHOLD; index += 1) {
        storageAdapter.appendConversationMessage(session.sessionId, {
          ...base, content: `update-${index}`, updatedAt: index + 1,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(warning).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(conversationPath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);
      expect(storageAdapter.readConversationHistory(session.sessionId)[0]?.content).toBe(`update-${2 * CONVERSATION_COMPACTION_DELTA_THRESHOLD}`);
    } finally {
      writeSpy.mockRestore();
      warning.mockRestore();
    }
  });

  it('appends only the work blocks an update changed and replays them into the full trace', async () => {
    const { storageAdapter } = await import('./StorageAdapter');
    const { upsertLoopTextItem } = await import('../../conversation/ConversationWorkTrace');
    await storageAdapter.initializeWorkspace();
    const projectRoot = path.join(tempRoot, 'project-root-trace-blocks');
    fs.mkdirSync(projectRoot, { recursive: true });
    const project = await storageAdapter.createProject(projectRoot);
    const session = storageAdapter.createSession(project.projectId, 'trace-blocks');
    const ref = (index: number) => ({ protocol: 'test', providerBlockKey: `text:${index}`, contentIndex: index });
    let trace = upsertLoopTextItem(undefined, 'loop-1', ref(0), 'A long finished loop', 'commentary', 'complete');
    trace = upsertLoopTextItem(trace, 'loop-2', ref(1), 'Str', undefined, 'streaming');
    const base = makeMessage({ id: 'assistant-blocks', content: '', sessionId: session.sessionId, projectId: project.projectId, workTrace: trace });
    storageAdapter.appendConversationMessage(session.sessionId, base);

    trace = upsertLoopTextItem(trace, 'loop-2', ref(1), 'Streaming on', undefined, 'streaming');
    storageAdapter.appendConversationMessage(session.sessionId, { ...base, workTrace: trace, updatedAt: 2 });

    const conversationPath = storageAdapter.getConversationPath(session.sessionId);
    const lastRecord = JSON.parse(fs.readFileSync(conversationPath, 'utf8').trim().split('\n').at(-1)!);
    expect(lastRecord.patch.workTrace).toBeUndefined();
    expect(lastRecord.traceBlocks.blockIds).toEqual(['loop-1', 'loop-2']);
    expect(lastRecord.traceBlocks.changedBlocks.map((block: { id: string }) => block.id)).toEqual(['loop-2']);

    storageAdapter.conversationHistoryCache.delete(session.sessionId);
    const replayed = storageAdapter.readConversationHistory(session.sessionId)[0]!.workTrace!;
    expect(replayed.blocks.map((block) => block.items?.[0]?.kind === 'text' && block.items[0].text))
      .toEqual(['A long finished loop', 'Streaming on']);
  });
});
