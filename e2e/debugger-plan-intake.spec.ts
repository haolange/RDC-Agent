import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext, configureTestDebuggerRoutes } from './helpers/electron-app';

let ctx: AppContext;

async function seedProject(page: AppContext['page'], projectRoot: string) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.resource', 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'Character_EyeSpark_Desktop.rdc'), 'fixture', 'utf8');

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }
    const sessionResult = await window.electronAPI.session.create(projectResult.project.projectId, 'Debugger Plan Session');
    if (!sessionResult.success || !sessionResult.session) {
      throw new Error(sessionResult.error || 'Failed to create session');
    }
    const sessions = await window.electronAPI.session.list(projectResult.project.projectId);
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: sessions.sessions,
      currentProject: projectResult.project,
      currentSession: sessionResult.session,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: projectResult.project.inputs,
      openedCapture: null,
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
    return {
      projectId: projectResult.project.projectId,
      sessionId: sessionResult.session.sessionId,
    };
  }, projectRoot);
}

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('Plan / Intake 自动发现任务文件、目标 capture 和 event，并在批准后进入 dispatch', async () => {
  const projectRoot = path.join(ctx.tempDir, 'plan-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  const taskFile = path.join(ctx.tempDir, 'TestTask.txt');
  fs.writeFileSync(taskFile, [
    '需求：local 模式调试 Character_EyeSpark_Desktop.rdc。',
    '已知：Event ID 是 6152。',
    '目标：确认白色亮点根因，并验证 fix，最后给完整 report。',
  ].join('\n'), 'utf8');

  await ctx.page.locator('input.chat-input').fill(taskFile);
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Character_EyeSpark_Desktop.rdc');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Event 6152');
  await expect(ctx.page.locator('[data-testid="plan-questions"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="plan-approve-button"]')).toBeEnabled();

  await ctx.page.locator('[data-testid="plan-approve-button"]').click();
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('调试报告已生成', { timeout: 15000 });
});

test('provider 已配置但 route 缺失时，Debugger 会先给自然语言兜底，不创建正式 run', async () => {
  const projectRoot = path.join(ctx.tempDir, 'plan-blocked-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page, { withRoutes: false });

  const taskFile = path.join(ctx.tempDir, 'BlockedTask.txt');
  fs.writeFileSync(taskFile, [
    '需求：local 模式调试 Character_EyeSpark_Desktop.rdc。',
    '已知：Event ID 是 6152。',
    '目标：确认白色亮点根因，并验证 fix，最后给完整 report。',
  ].join('\n'), 'utf8');

  await ctx.page.locator('input.chat-input').fill(taskFile);
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('当前调试链路还没绑定可用模型');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);

  await expect.poll(async () => {
    return ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentRun: { status?: string } | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.status ?? null);
  }, { timeout: 10000 }).toBeNull();
});
