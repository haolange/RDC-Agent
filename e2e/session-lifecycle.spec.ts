import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('Session 右键菜单支持删除并自动切到剩余 Session', async () => {
  const page = ctx.page;
  const projectRoot = path.join(ctx.tempDir, 'sample-project');

  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.resource', 'knowledge'), { recursive: true });

  const seeded = await page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    const alpha = await window.electronAPI.session.create(projectResult.project.projectId, 'Alpha Session');
    const beta = await window.electronAPI.session.create(projectResult.project.projectId, 'Beta Session');
    if (!alpha.success || !alpha.session || !beta.success || !beta.session) {
      throw new Error('Failed to create sessions');
    }

    const sessionsResult = await window.electronAPI.session.list(projectResult.project.projectId);
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: sessionsResult.sessions,
      currentProject: projectResult.project,
      currentSession: alpha.session,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: [],
      openedCapture: null,
      timeline: [],
      runs: [],
    });

    return {
      projectId: projectResult.project.projectId,
      alphaTitle: alpha.session.title,
      betaTitle: beta.session.title,
    };
  }, projectRoot);

  const alphaItem = page.locator('.session-item', { hasText: seeded.alphaTitle }).first();
  await expect(alphaItem).toBeVisible();

  await alphaItem.hover();
  await alphaItem.getByRole('button', { name: '删除会话' }).click();

  await expect(page.locator('.session-item', { hasText: seeded.alphaTitle })).toHaveCount(0);
  await expect(page.locator('.session-item.active', { hasText: seeded.betaTitle })).toBeVisible();
});
