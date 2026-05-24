import { expect, test } from '@playwright/test';
import { AppContext, closeApp, launchApp } from './helpers/electron-app';
import type { AgentWorkstreamPresentation } from '../src/shared/types/workstream';

let ctx: AppContext;

const BASE_TIME = Date.UTC(2026, 4, 24, 10, 0, 0);

const iso = (offsetMs: number): string => new Date(BASE_TIME + offsetMs).toISOString();

const createPresentation = (): AgentWorkstreamPresentation => ({
  sessionId: 'session-agent-workstream',
  activeBranchId: 'branch-main',
  mode: 'debugger',
  items: [
    {
      kind: 'task_workstream',
      id: 'ws-plan',
      type: 'debugger',
      status: 'awaiting_approval',
      density: 'expanded',
      title: 'Plan Task',
      startedAt: iso(0),
      prompt: {
        kind: 'user_prompt',
        id: 'prompt-main',
        branchId: 'branch-main',
        requestId: 'request-main',
        revisionId: 'revision-main',
        prompt: [
          '请分析当前打开的 capture，并给出可验证的调试计划。',
          '要求：保留历史、产出报告，并避免把 raw trace 默认铺满消息流。',
        ].join('\n'),
        createdAt: iso(0),
        branchIndex: 0,
        branchCount: 2,
        canCopy: true,
        canEdit: true,
      },
      process: {
        collapsed: false,
        items: [
          {
            kind: 'agent_thinking',
            id: 'thinking-1',
            createdAt: iso(1000),
            text: '我会先确认 opened capture，再把计划、工具调用和产物拆成产品级 workstream。',
          },
          {
            kind: 'tool_row',
            id: 'tool-1',
            createdAt: iso(2000),
            completedAt: iso(2600),
            status: 'done',
            title: 'Inspect pipeline state',
            summary: '读取 event 6152 的 pipeline state。',
            target: 'Event 6152',
            durationMs: 600,
            artifactIds: [],
            rawTraceRef: 'raw-tool-1',
            inputRef: 'input-tool-1',
            outputRef: 'output-tool-1',
          },
          {
            kind: 'subagent_row',
            id: 'subagent-1',
            createdAt: iso(3000),
            completedAt: iso(6400),
            status: 'done',
            label: 'pixel_forensics_agent',
            summary: '检查亮点像素和 render target。',
            resultSummary: '亮点证据需要在 execution 中继续验证。',
          },
        ],
      },
      result: {
        id: 'result-plan',
        workstreamId: 'ws-plan',
        kind: 'plan',
        status: 'awaiting_approval',
        title: 'Debugger Plan',
        sections: [
          { id: 'goal', title: '目标', body: '确认白点根因并产出可验证报告。' },
          { id: 'route', title: '执行路线', body: 'Inspect pipeline -> verify render target -> publish report.' },
          { id: 'acceptance', title: '验收标准', body: '报告包含结论、证据、验证和剩余风险。' },
        ],
        artifactIds: ['artifact-plan'],
        createdAt: iso(7000),
        artifacts: [
          {
            id: 'artifact-plan',
            sessionId: 'session-agent-workstream',
            workstreamId: 'ws-plan',
            branchId: 'branch-main',
            type: 'plan',
            status: 'ready',
            displayName: 'plan.md',
            taskTitle: 'Plan Task',
            path: 'D:\\Utility\\DebugTest\\plan.md',
            rawRef: 'raw-plan',
            createdAt: iso(7000),
            updatedAt: iso(7000),
          },
        ],
      },
      planId: 'plan-main',
      planStatus: 'awaiting_approval',
    },
  ],
  rightPanel: {
    progress: {
      current: [
        {
          id: 'task-current',
          sessionId: 'session-agent-workstream',
          workstreamId: 'ws-plan',
          branchId: 'branch-main',
          title: 'Approve structured plan',
          status: 'running',
          order: 1,
          createdAt: iso(0),
          updatedAt: iso(7000),
          source: 'plan',
        },
      ],
      history: [
        {
          id: 'task-history',
          sessionId: 'session-agent-workstream',
          workstreamId: 'ws-plan',
          branchId: 'branch-main',
          title: 'Open capture context',
          status: 'completed',
          order: 0,
          createdAt: iso(0),
          updatedAt: iso(1000),
          completedAt: iso(1000),
          source: 'runtime',
        },
      ],
    },
    artifacts: {
      current: [
        {
          id: 'artifact-plan',
          sessionId: 'session-agent-workstream',
          workstreamId: 'ws-plan',
          branchId: 'branch-main',
          type: 'plan',
          status: 'ready',
          displayName: 'plan.md',
          taskTitle: 'Plan Task',
          path: 'D:\\Utility\\DebugTest\\plan.md',
          rawRef: 'raw-plan',
          createdAt: iso(7000),
          updatedAt: iso(7000),
        },
      ],
      previous: [],
    },
    context: {
      groups: [
        {
          kind: 'capture',
          important: [
            {
              id: 'context-capture',
              sessionId: 'session-agent-workstream',
              workstreamId: 'ws-plan',
              branchId: 'branch-main',
              kind: 'capture',
              label: 'Character_EyeSpark_Desktop.rdc',
              summary: 'Opened capture from current project.',
              importance: 'decisive',
              firstObservedAt: iso(0),
              lastObservedAt: iso(7000),
            },
          ],
          all: [],
        },
        { kind: 'file', important: [], all: [] },
        { kind: 'source', important: [], all: [] },
        {
          kind: 'capability',
          important: [
            {
              id: 'context-capability',
              sessionId: 'session-agent-workstream',
              workstreamId: 'ws-plan',
              branchId: 'branch-main',
              kind: 'capability',
              label: 'RDX ToolBridge',
              summary: 'Renderer -> preload -> IPC -> ToolBridge.',
              importance: 'important',
              firstObservedAt: iso(0),
              lastObservedAt: iso(7000),
            },
          ],
          all: [],
        },
      ],
    },
  },
  approval: {
    planId: 'plan-main',
    runId: 'run-agent-workstream',
    workstreamId: 'ws-plan',
    status: 'awaiting_approval',
    title: 'Debugger Plan',
    summary: '目标: 确认白点根因并产出可验证报告。',
    canApprove: true,
    canRequestRevision: true,
  },
  branchNavigator: {
    activeBranchId: 'branch-main',
    branchIndex: 0,
    branchCount: 2,
    branches: [
      { id: 'branch-main', revisionId: 'revision-main', status: 'active', workstreamIds: ['ws-plan'] },
      { id: 'branch-alt', parentBranchId: 'branch-main', revisionId: 'revision-alt', status: 'inactive', workstreamIds: [] },
    ],
  },
  rawAuditRefs: [{ id: 'raw-tool-1', label: 'tool_execution', eventId: 'event-tool-1', runId: 'run-agent-workstream', sessionId: 'session-agent-workstream' }],
  updatedAt: iso(7000),
});

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('renders Agent Workstream presentation, right panel, and approval overlay', async () => {
  const presentation = createPresentation();
  await ctx.page.evaluate(async (nextPresentation) => {
    const e2eApi = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
        setComposerDraftState: (state: { currentMode?: 'debugger' }) => void;
      };
    }).__RDC_AGENT_E2E__;
    const state = {
      projects: [{
        projectId: 'project-agent-workstream',
        name: 'Agent Workstream Project',
        rootPath: 'D:\\Utility\\DebugTest',
        slug: 'agent-workstream',
        resourcePath: 'D:\\Utility\\DebugTest\\.resource',
        knowledgePath: 'D:\\Utility\\DebugTest\\.resource\\knowledge',
        inputsPath: 'D:\\Utility\\DebugTest\\.resource\\inputs',
        inputs: [],
        inputsUpdatedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }],
      sessions: [{
        sessionId: 'session-agent-workstream',
        projectId: 'project-agent-workstream',
        title: 'Agent Workstream Session',
        goal: 'Validate workstream UI',
        sessionPath: 'D:\\Utility\\DebugTest\\sessions\\session-agent-workstream',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunId: 'run-agent-workstream',
      }],
      currentProject: {
        projectId: 'project-agent-workstream',
        name: 'Agent Workstream Project',
        rootPath: 'D:\\Utility\\DebugTest',
        slug: 'agent-workstream',
        resourcePath: 'D:\\Utility\\DebugTest\\.resource',
        knowledgePath: 'D:\\Utility\\DebugTest\\.resource\\knowledge',
        inputsPath: 'D:\\Utility\\DebugTest\\.resource\\inputs',
        inputs: [],
        inputsUpdatedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      currentSession: {
        sessionId: 'session-agent-workstream',
        projectId: 'project-agent-workstream',
        title: 'Agent Workstream Session',
        goal: 'Validate workstream UI',
        sessionPath: 'D:\\Utility\\DebugTest\\sessions\\session-agent-workstream',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastRunId: 'run-agent-workstream',
      },
      rightRailTarget: 'session',
      currentRun: {
        runId: 'run-agent-workstream',
        projectId: 'project-agent-workstream',
        sessionId: 'session-agent-workstream',
        caseId: 'session-agent-workstream',
        mode: 'debugger',
        goal: 'Validate workstream UI',
        captures: [],
        startedAt: Date.now(),
        status: 'awaiting_approval',
        lastStage: 'plan',
        backend: 'local',
      },
      currentRunUsage: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: [],
      openedCapture: {
        projectId: 'project-agent-workstream',
        inputId: 'input-capture',
        filePath: 'D:\\Utility\\DebugTest\\Character_EyeSpark_Desktop.rdc',
        captureId: 'input-capture',
        captureFileId: 'input-capture',
        sessionId: 'session-agent-workstream',
        contextId: 'context-agent-workstream',
        replaySessionId: 'replay-agent-workstream',
        backend: 'local',
        deviceId: 'local',
        deviceLabel: 'Local',
        status: 'open',
        openedAt: Date.now(),
        preview: null,
      },
      conversationMessages: [],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      workstreamPresentation: nextPresentation,
      runs: [],
    };
    e2eApi?.seedWorkbenchState(state);
    e2eApi?.setComposerDraftState({ currentMode: 'debugger' });
    await new Promise((resolve) => window.setTimeout(resolve, 64));
    e2eApi?.seedWorkbenchState(state);
    e2eApi?.setComposerDraftState({ currentMode: 'debugger' });
  }, presentation);

  await expect(ctx.page.locator('[data-testid="agent-workstream"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="aw-user-prompt"]')).toContainText('请分析当前打开的 capture');
  await expect(ctx.page.locator('[data-testid="aw-thinking-bubble"]')).toContainText('产品级 workstream');
  await expect(ctx.page.locator('[data-testid="aw-tool-row"]')).toContainText('Inspect pipeline state');
  await expect(ctx.page.locator('[data-testid="aw-subagent-row"]')).toContainText('pixel_forensics_agent');
  await expect(ctx.page.locator('[data-testid="aw-result-block"]')).toContainText('Debugger Plan');
  await expect(ctx.page.locator('[data-testid="composer-approval-overlay"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="composer-approve-button"]')).toContainText('同意执行');
  await expect(ctx.page.locator('[data-testid="cp-section-workstream-progress"]')).toContainText('Approve structured plan');
  await expect(ctx.page.locator('[data-testid="cp-section-workstream-artifacts"]')).toContainText('plan.md');
  await expect(ctx.page.locator('[data-testid="cp-section-workstream-context"]')).toContainText('Character_EyeSpark_Desktop.rdc');
  await expect(ctx.page.locator('[data-testid="workstream-export-actions"]')).toContainText('Export raw trace');
  await expect(ctx.page.locator('[data-testid="aw-branch-navigator"]')).toContainText('1/2');

  const tool = ctx.page.locator('[data-testid="aw-tool-row"]').first();
  await tool.locator('.aw-row-head').click();
  await tool.getByRole('button', { name: 'raw' }).click();
  await expect(tool).toContainText('raw-tool-1');
});
