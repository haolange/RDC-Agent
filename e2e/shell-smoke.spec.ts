import { expect, test } from '@playwright/test';
import { closeSmokeApp, launchSmokeApp } from './helpers/app';

test('Electron shell exposes preload IPC and local tool boundary', async () => {
  const context = await launchSmokeApp();
  try {
    const result = await context.page.evaluate(async () => {
      const meta = await window.electronAPI.appMeta.get();
      const settings = await window.electronAPI.settings.get();
      const projects = await window.electronAPI.project.list();
      const toolSummary = await window.electronAPI.tool.getRuntimeSummary();
      return {
        productName: meta.productName,
        testMode: meta.testMode,
        workspaceRoot: settings.workspace.rootPath,
        projectCount: projects.projects.length,
        toolSummary,
      };
    });

    expect(result.productName).toBeTruthy();
    expect(result.testMode).toBe(true);
    expect(result.workspaceRoot).toContain(context.workspaceDir);
    expect(Array.isArray(result.toolSummary.namespaces)).toBe(true);
    expect(result.projectCount).toBeGreaterThanOrEqual(0);
  } finally {
    await closeSmokeApp(context);
  }
});
