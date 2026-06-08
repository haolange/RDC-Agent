import { expect, test, type Page, type TestInfo } from '@playwright/test';
import path from 'path';
import { closeSmokeApp, launchHeadlessSmokeApp } from './helpers/app';

const PRODUCT_PROJECT_ROOT_ENV = 'RDC_AGENT_PRODUCT_SMOKE_PROJECT_ROOT';
const PRODUCT_RDC_PATH_ENV = 'RDC_AGENT_PRODUCT_SMOKE_RDC_PATH';

interface LayoutIssue {
  documentOverflow: number;
  offenders: Array<{
    tag: string;
    className: string;
    testId: string | null;
    text: string;
    left: number;
    right: number;
  }>;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const issue = await page.evaluate<LayoutIssue>(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const offenders = documentOverflow > 2 ? Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        return rect.left < -2 || rect.right > viewportWidth + 2;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || ''),
          testId: element.getAttribute('data-testid'),
          text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      }) : [];

    return {
      documentOverflow,
      offenders,
    };
  });

  expect(issue, JSON.stringify(issue, null, 2)).toMatchObject({
    documentOverflow: expect.any(Number),
    offenders: [],
  });
  expect(issue.documentOverflow).toBeLessThanOrEqual(2);
}

async function captureReviewShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
  });
}

async function openSettingsSection(page: Page, section: 'models' | 'agents'): Promise<void> {
  const modal = page.getByTestId('settings-modal');
  if (!(await modal.isVisible().catch(() => false))) {
    await page.getByTestId('sidebar-user-settings-trigger').click();
    await page.getByTestId('open-settings-entry').click();
    await expect(modal).toBeVisible();
  }

  await page.getByTestId(`settings-nav-${section}`).click();
  if (section === 'models') {
    await expect(page.getByTestId('settings-add-provider')).toBeVisible();
    return;
  }
  await expect(page.getByTestId('settings-agent-list')).toBeVisible();
}

test('product smoke covers project, session, real rdc input, settings, and visual review', async ({ page }, testInfo) => {
  const projectRoot = process.env[PRODUCT_PROJECT_ROOT_ENV];
  const rdcPath = process.env[PRODUCT_RDC_PATH_ENV];

  test.skip(!projectRoot || !rdcPath, `${PRODUCT_PROJECT_ROOT_ENV} and ${PRODUCT_RDC_PATH_ENV} are required`);

  const context = await launchHeadlessSmokeApp();
  const expectedRdcFileName = path.basename(rdcPath!);
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleMessages.push(message.text());
    }
  });

  try {
    await page.goto(`${context.bridgeUrl}/app`);
    await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });
    await captureReviewShot(page, testInfo, 'desktop-workbench-empty');

    const setup = await page.evaluate(async ({ projectRoot, rdcPath }) => {
      const settingsBefore = await window.electronAPI.settings.get();
      const settingsAfter = await window.electronAPI.settings.set({
        tooling: {
          rdxCli: settingsBefore.tooling.rdxCli,
        },
      });
      const projectResult = await window.electronAPI.project.add(projectRoot);
      if (!projectResult.success || !projectResult.project) {
        throw new Error(projectResult.error || 'project.add failed');
      }

      const sessionResult = await window.electronAPI.session.create(
        projectResult.project.projectId,
        'Product Smoke Session',
      );
      if (!sessionResult.success || !sessionResult.session) {
        throw new Error(sessionResult.error || 'session.create failed');
      }

      const importResult = await window.electronAPI.project.inputs.importPaths(
        projectResult.project.projectId,
        [rdcPath],
      );
      if (!importResult.success) {
        throw new Error(importResult.error || 'project.inputs.importPaths failed');
      }

      const refreshedInputs = await window.electronAPI.project.inputs.refresh(projectResult.project.projectId);
      const importedInput = refreshedInputs.inputs.find((input) => input.filePath === rdcPath)
        ?? refreshedInputs.inputs.find((input) => input.fileName === rdcPath.split(/[\\/]/).pop());
      const devices = await window.electronAPI.device.refresh().catch(async () => window.electronAPI.device.list());
      const replayDevice = devices.find((device) => device.type === 'local') ?? devices[0] ?? null;
      const toolSummary = await window.electronAPI.tool.getRuntimeSummary();

      const openResult = importedInput && replayDevice
        ? await window.electronAPI.capture.openProjectInput({
          projectId: projectResult.project.projectId,
          inputId: importedInput.inputId,
          filePath: importedInput.filePath,
          replayDeviceId: replayDevice.id,
        }).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }))
        : {
          success: false,
          error: importedInput ? 'No replay device available' : 'Imported .rdc input was not found',
        };

      const openedState = await window.electronAPI.capture.getOpenedState().catch(() => null);
      const contextSnapshot = await window.electronAPI.context.get().catch(() => null);
      const runtimeLogs = await window.electronAPI.runtimeLog.list({ scope: 'app' }).catch(() => ({ entries: [] }));

      return {
        settingsRoundTrip: settingsAfter.tooling.rdxCli.command === settingsBefore.tooling.rdxCli.command,
        project: projectResult.project,
        session: sessionResult.session,
        importedInputs: refreshedInputs.inputs,
        replayDevice,
        toolSummary,
        openResult,
        openedState,
        contextSnapshot,
        runtimeLogCount: runtimeLogs.entries.length,
      };
    }, { projectRoot, rdcPath });

    expect(setup.settingsRoundTrip).toBe(true);
    expect(setup.project.rootPath).toBe(projectRoot);
    expect(setup.session.projectId).toBe(setup.project.projectId);
    expect(setup.importedInputs.map((input) => input.fileName)).toContain(expectedRdcFileName);
    expect(Array.isArray(setup.toolSummary.namespaces)).toBe(true);
    expect(setup.toolSummary.runtime).toBeTruthy();
    expect(setup.runtimeLogCount).toBeGreaterThan(0);

    if (setup.openResult.success) {
      expect(setup.openedState?.filePath).toBe(rdcPath);
      expect(setup.contextSnapshot?.captureDescriptors?.length ?? 0).toBeGreaterThan(0);
    } else {
      expect(setup.openResult.error).toBeTruthy();
      expect(setup.openedState?.status).not.toBe('open');
    }

    await page.reload();
    await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });
    await expect(page.getByTestId('app-sidebar-left')).toBeVisible();
    await expect(page.getByTestId('session-context-capture-select')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('session-context-capture-select')).toContainText('.rdc');

    await page.getByTestId('app-sidebar-right').scrollIntoViewIfNeeded();
    await captureReviewShot(page, testInfo, 'desktop-capture-context');

    await openSettingsSection(page, 'models');
    await captureReviewShot(page, testInfo, 'desktop-settings-providers');
    await expect(page.getByTestId('settings-oauth-accounts')).toBeVisible();
    await expect(page.getByTestId('settings-provider-group-openai-compatible')).toBeVisible();
    await expect(page.getByTestId('settings-provider-group-anthropic-compatible')).toBeVisible();

    await openSettingsSection(page, 'agents');
    await captureReviewShot(page, testInfo, 'desktop-settings-agents');
    await expect(page.getByTestId('settings-agent-runtime-config')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await captureReviewShot(page, testInfo, 'mobile-settings-agents');
    await openSettingsSection(page, 'models');
    await captureReviewShot(page, testInfo, 'mobile-settings-providers');

    expect(consoleMessages.filter((message) => message.includes('Failed to fetch'))).toHaveLength(0);
  } finally {
    await closeSmokeApp(context);
  }
});
