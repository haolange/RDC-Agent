import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

const switchMode = async (page: AppContext['page'], mode: 'debugger' | 'analyzer' | 'optimizer') => {
  await page.locator('[data-testid="composer-mode-pill"]').click();
  await page.locator(`[data-testid="mode-menu-item-${mode}"]`).click();
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

  await expect(page.locator('[data-testid="debugger-workbench-page"]')).toBeVisible();
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

  await page.locator('[data-testid="composer-mode-pill"]').click();
  await expect(page.locator('.composer-agent-menu-popup')).toBeVisible();
  await expect(page.locator('.composer-agent-menu-popup')).toHaveScreenshot('mode-menu.png');
  await page.keyboard.press('Escape');

  await switchMode(page, 'analyzer');
  await expect(page.locator('[data-testid="analyzer-workbench-page"]')).toBeVisible();
  await expect(page.locator('textarea.chat-input')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveCount(0);
  await expect(page.locator('.empty-workbench-kicker')).toContainText('Analyzer');

  await switchMode(page, 'optimizer');
  await expect(page.locator('[data-testid="optimizer-workbench-page"]')).toBeVisible();
  await expect(page.locator('textarea.chat-input')).toBeVisible();
  await expect(page.locator('.empty-workbench-kicker')).toContainText('Optimizer');
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
          sessionId: null,
          projectId: null,
          role: 'assistant',
          agentId: 'rdc-debugger',
          modeContext: 'optimizer',
          content: 'Optimizer answer',
          createdAt: now + 1,
        },
      ],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  });

  await expect(page.locator('.message-mode-badge').filter({ hasText: 'Debugger' })).toHaveCount(1);
  await expect(page.locator('.message-mode-badge').filter({ hasText: 'Optimizer' })).toHaveCount(1);
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
