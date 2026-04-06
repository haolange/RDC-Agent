import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { AppContext, closeApp, configureTestDebuggerRoutes, launchApp } from './helpers/electron-app';

let ctx: AppContext;

async function seedProject(page: AppContext['page'], projectRoot: string) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'Character_EyeSpark_Desktop.rdc'), 'fixture', 'utf8');

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: [],
      currentProject: projectResult.project,
      currentSession: null,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: projectResult.project.inputs,
      openedCapture: null,
      conversationMessages: [],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  }, projectRoot);
}

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('配置好 route 后，普通寒暄会走 cowork agent 而不创建 run', async () => {
  const projectRoot = path.join(ctx.tempDir, 'cowork-greeting-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('input.chat-input').fill('你好');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('你好，我是 RDC Debugger');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
  await expect.poll(async () => {
    return ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentRun: unknown | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun ?? null);
  }, { timeout: 10000 }).toBeNull();
});

test('配置好 route 后，通用技术问题会得到正常回答，而不是 intake 模板', async () => {
  const projectRoot = path.join(ctx.tempDir, 'cowork-knowledge-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('input.chat-input').fill('你知道什么是UE4么');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('Unreal Engine 4');
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).not.toContainText('你可以先告诉我你遇到了什么现象');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
});
