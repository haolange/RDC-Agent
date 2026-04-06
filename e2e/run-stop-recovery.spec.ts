import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, configureTestDebuggerRoutes, type AppContext } from './helpers/electron-app';

async function seedProject(page: AppContext['page'], projectRoot: string, sessionTitle: string) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.resource', 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'Character_EyeSpark_Desktop.rdc'), 'fixture', 'utf8');

  return page.evaluate(async ({ rootPath, title }) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }
    const sessionResult = await window.electronAPI.session.create(projectResult.project.projectId, title);
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
      project: projectResult.project,
      session: sessionResult.session,
    };
  }, { rootPath: projectRoot, title: sessionTitle });
}

test('运行中的 Debugger 任务可停止并最终转为 cancelled', async () => {
  const ctx = await launchApp();
  try {
    const projectRoot = path.join(ctx.tempDir, 'stop-project');
    const seeded = await seedProject(ctx.page, projectRoot, 'Stop Session');
    await configureTestDebuggerRoutes(ctx.page);

    await ctx.page.locator('input.chat-input').fill('slow-run 调试 Character_EyeSpark_Desktop.rdc，Event ID 6152');
    await ctx.page.locator('[data-testid="debugger-start-button"]').click();
    await expect(ctx.page.locator('[data-testid="plan-approve-button"]')).toBeEnabled();
    await ctx.page.locator('[data-testid="plan-approve-button"]').click();

    await expect(ctx.page.locator('[data-testid="debugger-stop-button"]')).toBeVisible();
    await ctx.page.locator('[data-testid="debugger-stop-button"]').click();

    await expect.poll(async () => {
      return ctx.page.evaluate(() => (window as typeof window & {
        __RDC_AGENT_E2E__?: {
          getWorkbenchState: () => { currentRun: { status?: string } | null };
        };
      }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.status ?? null);
    }, { timeout: 15000 }).toBe('cancelled');

    const actionChainPath = path.join(projectRoot, 'sessions', seeded.session.sessionId, 'action_chain.jsonl');
    await expect.poll(() => fs.readFileSync(actionChainPath, 'utf8'), { timeout: 15000 }).toContain('RUN_STOPPED');
  } finally {
    await closeApp(ctx);
  }
});

test('stale run 在应用重启后会被恢复为 interrupted，并支持 Restart Run', async () => {
  let ctx = await launchApp({ cleanupOnClose: false });
  const projectRoot = path.join(ctx.tempDir, 'recovery-project');
  const seeded = await seedProject(ctx.page, projectRoot, 'Recovery Session');
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('input.chat-input').fill('调试 Character_EyeSpark_Desktop.rdc，Event ID 6152');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  const runMeta = await ctx.page.evaluate(() => (window as typeof window & {
    __RDC_AGENT_E2E__?: {
      getWorkbenchState: () => { currentRun: { runId: string } | null };
    };
  }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun);

  await closeApp(ctx, { cleanup: false });

  const runJsonPath = path.join(projectRoot, 'sessions', seeded.session.sessionId, 'runs', runMeta?.runId || '', 'run.json');
  const runJson = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
  runJson.status = 'running';
  fs.writeFileSync(runJsonPath, JSON.stringify(runJson, null, 2), 'utf8');

  ctx = await launchApp({ tempDir: ctx.tempDir, cleanupOnClose: false });
  try {
    await ctx.page.evaluate(async ({ projectId, sessionId }) => {
      const sessions = await window.electronAPI.session.list(projectId);
      const selected = await window.electronAPI.session.select(sessionId);
      const currentRun = selected.currentRun ?? null;
      const currentProject = (await window.electronAPI.project.list()).projects.find((project) => project.projectId === projectId) ?? null;
      (window as typeof window & {
        __RDC_AGENT_E2E__?: {
          seedWorkbenchState: (state: unknown) => void;
        };
      }).__RDC_AGENT_E2E__?.seedWorkbenchState({
        projects: currentProject ? [currentProject] : [],
        sessions: sessions.sessions,
        currentProject,
        currentSession: selected.session ?? null,
        currentRun,
        contextSnapshot: null,
        captures: currentRun?.captures ?? [],
        projectInputs: currentProject?.inputs ?? [],
        openedCapture: null,
        timeline: [],
        actionEvents: [],
        workflowState: null,
        runs: currentRun ? [currentRun] : [],
      });
    }, { projectId: seeded.project.projectId, sessionId: seeded.session.sessionId });

    await expect(ctx.page.locator('[data-testid="plan-restart-button"]')).toBeVisible({ timeout: 15000 });
    const beforeRunId = await ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentRun: { runId: string } | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.runId ?? null);

    await ctx.page.locator('[data-testid="plan-restart-button"]').click();

    await expect.poll(async () => {
      return ctx.page.evaluate(() => (window as typeof window & {
        __RDC_AGENT_E2E__?: {
          getWorkbenchState: () => { currentRun: { runId: string } | null };
        };
      }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.runId ?? null);
    }, { timeout: 10000 }).not.toBe(beforeRunId);
  } finally {
    await closeApp(ctx);
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
  }
});
