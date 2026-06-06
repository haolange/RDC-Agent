import { expect, test } from '@playwright/test';
import { closeSmokeApp, launchSmokeApp } from './helpers/app';

test('browser app session uses real main runtime bridge', async ({ page, request }) => {
  const context = await launchSmokeApp();
  try {
    const health = await request.get(`${context.bridgeUrl}/health`);
    expect(health.ok()).toBe(true);
    await expect(await health.json()).toMatchObject({
      ok: true,
      mode: 'browser-app-session',
    });

    await page.goto(`${context.bridgeUrl}/app`);
    await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });

    const result = await page.evaluate(async (projectRoot) => {
      const meta = await window.electronAPI.appMeta.get();
      const settings = await window.electronAPI.settings.get();
      const projectsBefore = await window.electronAPI.project.list();
      const addedProject = await window.electronAPI.project.add(projectRoot);
      if (!addedProject.success || !addedProject.project) {
        throw new Error(addedProject.error || 'project.add failed');
      }
      const createdSession = await window.electronAPI.session.create(
        addedProject.project.projectId,
        'Browser App Session Smoke',
      );
      if (!createdSession.success || !createdSession.session) {
        throw new Error(createdSession.error || 'session.create failed');
      }

      const inputEventSeen = await new Promise<boolean>((resolve) => {
        const timeoutId = window.setTimeout(() => {
          unsubscribe();
          resolve(false);
        }, 5000);
        const unsubscribe = window.electronAPI.events.onProjectInputsChanged((payload) => {
          if (payload.projectId === addedProject.project?.projectId) {
            window.clearTimeout(timeoutId);
            unsubscribe();
            resolve(true);
          }
        });
        void window.electronAPI.project.inputs.refresh(addedProject.project.projectId);
      });

      const projectsAfter = await window.electronAPI.project.list();
      const sessions = await window.electronAPI.session.list(addedProject.project.projectId);
      const toolSummary = await window.electronAPI.tool.getRuntimeSummary();

      return {
        productName: meta.productName,
        testMode: meta.testMode,
        workspaceRoot: settings.workspace.rootPath,
        projectCountBefore: projectsBefore.projects.length,
        projectCountAfter: projectsAfter.projects.length,
        sessionCount: sessions.sessions.length,
        inputEventSeen,
        toolNamespacesIsArray: Array.isArray(toolSummary.namespaces),
      };
    }, context.workspaceDir);

    expect(result.productName).toBeTruthy();
    expect(result.testMode).toBe(true);
    expect(result.workspaceRoot).toContain(context.workspaceDir);
    expect(result.projectCountAfter).toBeGreaterThanOrEqual(result.projectCountBefore);
    expect(result.sessionCount).toBeGreaterThanOrEqual(1);
    expect(result.inputEventSeen).toBe(true);
    expect(result.toolNamespacesIsArray).toBe(true);
  } finally {
    await closeSmokeApp(context);
  }
});
