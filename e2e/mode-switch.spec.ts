import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

const switchMode = async (page: AppContext['page'], mode: 'debugger' | 'analyzer' | 'optimizer') => {
  await page.locator('[data-testid="composer-mode-pill"]').click();
  await page.locator(`[data-testid="mode-menu-item-${mode}"]`).click();
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

  const titleBox = await page.locator('.empty-workbench-title').boundingBox();
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(titleBox).not.toBeNull();
  expect(titleBox!.height).toBeLessThan(140);
  expect(titleBox!.width).toBeLessThan(viewport.width * 0.8);

  await switchMode(page, 'analyzer');
  await expect(page.locator('[data-testid="analyzer-workbench-page"]')).toBeVisible();
  await expect(page.locator('textarea.chat-input')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toBeVisible();
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
