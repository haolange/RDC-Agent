import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

const switchMode = async (page: AppContext['page'], mode: 'debugger' | 'analyzer' | 'optimizer') => {
  await page.locator('[data-testid="composer-mode-pill"]').click();
  await page.locator(`[data-testid="mode-menu-item-${mode}"]`).click();
};

const seedOpenedCaptureProject = async (page: AppContext['page']) => {
  await page.evaluate(() => {
    const now = Date.now();
    const input = {
      inputId: 'input-opened-capture',
      fileName: 'Character_EyeSpark_Desktop.rdc',
      filePath: 'H:/fake/project/.resource/inputs/Character_EyeSpark_Desktop.rdc',
      source: 'project_resource' as const,
      discoveredAt: now,
      lastModifiedAt: now,
      size: 128,
    };
    const project = {
      projectId: 'proj-opened-capture',
      name: 'Opened Capture Project',
      rootPath: 'H:/fake/project',
      slug: 'opened-capture-project',
      resourcePath: 'H:/fake/project/.resource',
      knowledgePath: 'H:/fake/project/.resource/knowledge',
      inputsPath: 'H:/fake/project/.resource/inputs',
      inputs: [input],
      inputsUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [project],
      sessions: [],
      currentProject: project,
      currentSession: null,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: [input],
      openedCapture: {
        projectId: project.projectId,
        inputId: input.inputId,
        filePath: input.filePath,
        captureId: 'capture-opened-capture',
        sessionId: 'session-opened-capture',
        contextId: 'ctx-opened-capture',
        replaySessionId: 'replay-opened-capture',
        backend: 'local',
        deviceId: 'local',
        deviceLabel: 'Local',
        status: 'open',
        openedAt: now,
      },
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  });
};

const assertComposerFooterOrder = async (page: AppContext['page']) => {
  const selectors = [
    '[data-testid="composer-attach-button"]',
    '[data-testid="composer-mode-pill"]',
    '[data-testid="composer-usage-indicator"]',
    '[data-testid="debugger-start-button"]',
  ];
  const boxes = await Promise.all(selectors.map(async (selector) => page.locator(selector).boundingBox()));

  for (const box of boxes) {
    expect(box).not.toBeNull();
  }

  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  expect(boxes[2]!.x).toBeLessThan(boxes[3]!.x);
};

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('共享工作台在三种模式下都可交互，空状态保持紧凑', async () => {
  const page = ctx.page;

  await expect(page.locator('[data-testid="ask-workbench-page"]')).toBeVisible();
  await expect(page.locator('textarea.chat-input')).toBeVisible();
  await expect(page.locator('[data-testid="composer-attach-button"]')).toBeVisible();
  await expect(page.locator('[data-testid="composer-usage-indicator"]')).toContainText('0%');
  await assertComposerFooterOrder(page);

  const titleBox = await page.locator('.empty-workbench-title').boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(titleBox).not.toBeNull();
  expect(titleBox!.height).toBeLessThan(140);
  expect(titleBox!.width).toBeLessThan(viewport.width * 0.8);
  await expect(page.locator('.agent-chat')).toHaveClass(/is-empty/);
  await expect(page.locator('.empty-workbench-step')).toHaveCount(0);
  await expect(page.locator('.empty-workbench-title')).toContainText('先 Ask，Open Capture 后再执行');
  await expect(page.locator('[data-testid="empty-workbench-tool-ask"]')).toContainText('先把问题说清楚');
  await expect(page.locator('[data-testid="empty-workbench-tool-debugger"]')).toContainText('从异常现象出发');
  await expect(page.locator('[data-testid="empty-workbench-tool-analyzer"]')).toContainText('拆开线索');
  await expect(page.locator('[data-testid="empty-workbench-tool-optimizer"]')).toContainText('先找瓶颈');

  await page.locator('[data-testid="composer-mode-pill"]').click();
  await expect(page.locator('.composer-agent-menu-popup')).toBeVisible();
  await expect(page.locator('[data-testid="mode-menu-item-ask"]')).toBeEnabled();
  await expect(page.locator('[data-testid="mode-menu-item-debugger"]')).toBeDisabled();
  await expect(page.locator('[data-testid="mode-menu-item-analyzer"]')).toBeDisabled();
  await expect(page.locator('[data-testid="mode-menu-item-optimizer"]')).toBeDisabled();
  await expect(page.locator('[data-testid="mode-menu-item-debugger"]')).toContainText('先在应用内 Open');
  await page.keyboard.press('Escape');

  await seedOpenedCaptureProject(page);

  await switchMode(page, 'analyzer');
  await expect(page.locator('[data-testid="analyzer-workbench-page"]')).toBeVisible();
  await expect(page.locator('textarea.chat-input')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toBeVisible();
  await expect(page.locator('.empty-workbench-title')).toContainText('先 Ask，Open Capture 后再执行');
  await expect(page.locator('[data-testid="empty-workbench-tool-ask"]')).toContainText('Ask');
  await expect(page.locator('[data-testid="empty-workbench-tool-debugger"]')).toContainText('Debugger');
  await expect(page.locator('[data-testid="empty-workbench-tool-analyzer"]')).toContainText('Analyzer');
  await expect(page.locator('[data-testid="empty-workbench-tool-optimizer"]')).toContainText('Optimizer');

  await switchMode(page, 'optimizer');
  await expect(page.locator('[data-testid="optimizer-workbench-page"]')).toBeVisible();
  await expect(page.locator('textarea.chat-input')).toBeVisible();
  await expect(page.locator('.empty-workbench-title')).toContainText('先 Ask，Open Capture 后再执行');
  await expect(page.locator('[data-testid="empty-workbench-tool-ask"]')).toContainText('Ask');
  await expect(page.locator('[data-testid="empty-workbench-tool-debugger"]')).toContainText('Debugger');
  await expect(page.locator('[data-testid="empty-workbench-tool-analyzer"]')).toContainText('Analyzer');
  await expect(page.locator('[data-testid="empty-workbench-tool-optimizer"]')).toContainText('Optimizer');
});

test('无项目时点击加号会给出提示，有附件时切换模式不丢失', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="composer-attach-button"]').click();
  await expect(page.locator('.shell-notice')).toContainText('请先选择一个项目');

  await page.evaluate(() => {
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [
        {
          projectId: 'proj-ui-smoke',
          name: 'UI Smoke',
          rootPath: 'H:/fake/project',
          slug: 'ui-smoke',
          resourcePath: 'H:/fake/project/resources',
          knowledgePath: 'H:/fake/project/knowledge',
          inputsPath: 'H:/fake/project/inputs',
          inputs: [],
          inputsUpdatedAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      sessions: [],
      currentProject: {
        projectId: 'proj-ui-smoke',
        name: 'UI Smoke',
        rootPath: 'H:/fake/project',
        slug: 'ui-smoke',
        resourcePath: 'H:/fake/project/resources',
        knowledgePath: 'H:/fake/project/knowledge',
        inputsPath: 'H:/fake/project/inputs',
        inputs: [],
        inputsUpdatedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      currentSession: null,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: [],
      openedCapture: null,
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  });
  await seedOpenedCaptureProject(page);

  const stagedFile = path.join(ctx.tempDir, 'mode-switch-note.txt');
  fs.writeFileSync(stagedFile, 'attachment smoke');

  await page.evaluate((selectedPath) => {
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        setComposerDraftState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__?.setComposerDraftState({
      pendingAttachments: [
        {
          id: 'draft-smoke',
          sourcePath: selectedPath,
          fileName: 'mode-switch-note.txt',
          mimeType: 'text/plain',
          size: 16,
          kind: 'file',
          isCapture: false,
        },
      ],
    });
  }, stagedFile);

  await expect(page.locator('[data-testid="composer-attachments"]')).toContainText('mode-switch-note.txt');

  await switchMode(page, 'analyzer');
  await expect(page.locator('[data-testid="composer-attachments"]')).toContainText('mode-switch-note.txt');

  await switchMode(page, 'optimizer');
  await expect(page.locator('[data-testid="composer-attachments"]')).toContainText('mode-switch-note.txt');
});

test('共享历史保留各自消息的模式标识', async () => {
  const page = ctx.page;

  await page.evaluate(() => {
    const now = Date.now();
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [],
      sessions: [],
      currentProject: null,
      currentSession: null,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: [],
      openedCapture: null,
      conversationMessages: [
        {
          id: 'msg-debugger',
          turnId: 'turn-debugger',
          sessionId: null,
          projectId: null,
          role: 'assistant',
          agentId: 'rdc-debugger',
          modeContext: 'debugger',
          content: 'Debugger answer',
          createdAt: now,
        },
        {
          id: 'msg-optimizer',
          turnId: 'turn-optimizer',
          sessionId: null,
          projectId: null,
          role: 'assistant',
          agentId: 'rdc-debugger',
          modeContext: 'optimizer',
          content: 'Optimizer answer',
          createdAt: now + 1,
        },
      ],
      workstreamPresentation: {
        sessionId: 'mode-switch-session',
        activeBranchId: 'branch-main',
        mode: 'ask',
        items: [
          {
            kind: 'task_workstream',
            id: 'ws-mode-debugger',
            type: 'debugger',
            status: 'completed',
            density: 'compact',
            title: 'Agent Task',
            startedAt: new Date(now).toISOString(),
            process: { collapsed: true, items: [] },
            result: {
              id: 'result-mode-debugger',
              workstreamId: 'ws-mode-debugger',
              kind: 'answer',
              status: 'completed',
              title: 'Ask Answer',
              sections: [{ id: 'answer', title: '回答', body: 'Debugger answer' }],
              artifactIds: [],
              createdAt: new Date(now).toISOString(),
              artifacts: [],
            },
          },
          {
            kind: 'task_workstream',
            id: 'ws-mode-optimizer',
            type: 'optimizer',
            status: 'completed',
            density: 'compact',
            title: 'Agent Task',
            startedAt: new Date(now + 1).toISOString(),
            process: { collapsed: true, items: [] },
            result: {
              id: 'result-mode-optimizer',
              workstreamId: 'ws-mode-optimizer',
              kind: 'answer',
              status: 'completed',
              title: 'Ask Answer',
              sections: [{ id: 'answer', title: '回答', body: 'Optimizer answer' }],
              artifactIds: [],
              createdAt: new Date(now + 1).toISOString(),
              artifacts: [],
            },
          },
        ],
        rightPanel: {
          progress: { current: [], history: [] },
          artifacts: { current: [], previous: [] },
          context: { groups: [] },
        },
        approval: null,
        branchNavigator: null,
        rawAuditRefs: [],
        updatedAt: new Date(now + 1).toISOString(),
      },
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  });

  await expect(page.locator('[data-testid="chat-messages"]')).toContainText('Debugger answer');
  await expect(page.locator('[data-testid="chat-messages"]')).toContainText('Optimizer answer');
  await expect.poll(async () => page.evaluate(() => (window as typeof window & {
    __RDC_AGENT_E2E__?: {
      getWorkbenchState: () => {
        conversationMessages: Array<{ modeContext?: string }>;
      };
    };
  }).__RDC_AGENT_E2E__?.getWorkbenchState().conversationMessages.map((message) => message.modeContext))).toEqual([
    'debugger',
    'optimizer',
  ]);
});

test('composer usage tooltip supports configured and fallback states', async () => {
  const page = ctx.page;
  const now = Date.now();

  const seedRunUsageState = async (usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextWindowTokens: number | null;
    usagePercent: number;
    hasConfiguredContextWindow: boolean;
  }) => {
    await page.evaluate(({ seedNow, nextUsage }) => {
      (window as typeof window & {
        __RDC_AGENT_E2E__?: {
          seedWorkbenchState: (state: Record<string, unknown>) => void;
        };
      }).__RDC_AGENT_E2E__?.seedWorkbenchState({
        projects: [],
        sessions: [],
        currentProject: null,
        currentSession: {
          sessionId: 'session-usage',
          projectId: 'project-usage',
          title: 'Usage Session',
          goal: '',
          sessionPath: 'H:/fake/session',
          createdAt: seedNow,
          updatedAt: seedNow,
        },
        currentRun: {
          runId: 'run-usage',
          projectId: 'project-usage',
          sessionId: 'session-usage',
          caseId: 'case-usage',
          mode: 'debugger',
          goal: 'Inspect usage indicator',
          captures: [],
          startedAt: seedNow,
          status: 'running',
          lastStage: 'investigate',
          backend: 'local',
        },
        currentRunUsage: {
          runId: 'run-usage',
          providerId: 'test-provider',
          modelId: 'test-model',
          ...nextUsage,
        },
        contextSnapshot: null,
        captures: [],
        projectInputs: [],
        openedCapture: null,
        timeline: [],
        actionEvents: [],
        workflowState: null,
        runs: [],
      });
    }, { seedNow: now, nextUsage: usage });
  };

  const usageIndicator = page.locator('[data-testid="composer-usage-indicator"]');

  await seedRunUsageState({
    inputTokens: 1800,
    outputTokens: 600,
    totalTokens: 2400,
    contextWindowTokens: 8000,
    usagePercent: 30,
    hasConfiguredContextWindow: true,
  });
  await expect(usageIndicator).toContainText('30%');
  await usageIndicator.hover();
  await expect(page.locator('.composer-usage-tooltip-line-strong')).toContainText('30');
  await expect(page.locator('.composer-usage-tooltip-line').last()).toContainText('2,400');

  await seedRunUsageState({
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    contextWindowTokens: null,
    usagePercent: 0,
    hasConfiguredContextWindow: false,
  });
  await expect(usageIndicator).toContainText('0%');
  await usageIndicator.hover();
  await expect(page.locator('.composer-usage-tooltip-line-strong')).toContainText(/0|未配置|not set/i);
});
