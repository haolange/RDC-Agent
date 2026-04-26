import { expect, test } from '@playwright/test';
import { closeApp, launchApp, type AppContext } from './helpers/electron-app';

let ctx: AppContext;

const openUserMenu = async (appContext: AppContext) => {
  await appContext.page.locator('[data-testid="sidebar-user-settings-trigger"]').click();
  await expect(appContext.page.locator('[data-testid="sidebar-user-menu"]')).toBeVisible();
};

const openSettings = async (appContext: AppContext) => {
  await openUserMenu(appContext);
  await appContext.page.locator('[data-testid="open-settings-entry"]').click();
  await expect(appContext.page.locator('[data-testid="settings-modal"]')).toBeVisible();
};

const readFontSize = async (appContext: AppContext, selector: string): Promise<number> => (
  appContext.page.locator(selector).evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))
);

const readUserMenuPillWidths = async (appContext: AppContext): Promise<number[][]> => (
  appContext.page.locator('.user-menu-pill-group').evaluateAll((groups) => groups.map((group) => (
    Array.from(group.querySelectorAll<HTMLElement>('.user-menu-pill')).map((button) => (
      Math.round(button.getBoundingClientRect().width)
    ))
  )))
);

const setWindowSize = async (appContext: AppContext, width: number, height: number) => {
  await appContext.app.evaluate(({ BrowserWindow }, size) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(size.width, size.height);
  }, { width, height });
  await appContext.page.waitForTimeout(320);
};

const seedSessionWorkbench = async (appContext: AppContext) => {
  const now = Date.now();
  await appContext.page.evaluate(({ fixedNow }) => {
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [
        {
          projectId: 'project-appearance',
          name: 'Appearance Demo',
          rootPath: 'D:/Appearance/Demo',
          slug: 'appearance-demo',
          resourcePath: 'D:/Appearance/Demo/.resource',
          knowledgePath: 'D:/Appearance/Demo/.knowledge',
          inputsPath: 'D:/Appearance/Demo/.resource/inputs',
          inputs: [],
          inputsUpdatedAt: fixedNow,
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      ],
      sessions: [
        {
          sessionId: 'session-appearance',
          projectId: 'project-appearance',
          title: 'Appearance Session',
          goal: '',
          sessionPath: 'D:/Appearance/Demo/sessions/session-appearance',
          createdAt: fixedNow,
          updatedAt: fixedNow,
        },
      ],
      currentProject: {
        projectId: 'project-appearance',
        name: 'Appearance Demo',
        rootPath: 'D:/Appearance/Demo',
        slug: 'appearance-demo',
        resourcePath: 'D:/Appearance/Demo/.resource',
        knowledgePath: 'D:/Appearance/Demo/.knowledge',
        inputsPath: 'D:/Appearance/Demo/.resource/inputs',
        inputs: [],
        inputsUpdatedAt: fixedNow,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      },
      currentSession: {
        sessionId: 'session-appearance',
        projectId: 'project-appearance',
        title: 'Appearance Session',
        goal: '',
        sessionPath: 'D:/Appearance/Demo/sessions/session-appearance',
        createdAt: fixedNow,
        updatedAt: fixedNow,
      },
      currentRun: null,
      currentRunUsage: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: [],
      openedCapture: null,
      conversationMessages: [],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  }, { fixedNow: now });
};

test.beforeEach(async () => {
  ctx = await launchApp();
  await seedSessionWorkbench(ctx);
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('user menu preference buttons stay equal width within each group', async () => {
  await openUserMenu(ctx);

  const groupWidths = await readUserMenuPillWidths(ctx);

  expect(groupWidths).toHaveLength(3);
  for (const widths of groupWidths) {
    expect(widths.length).toBeGreaterThan(1);
    const [firstWidth] = widths;
    for (const width of widths) {
      expect(Math.abs(width - firstWidth)).toBeLessThanOrEqual(1);
    }
  }
});

test('font scale propagates through user menu, settings, sidebar, and composer', async () => {
  await openUserMenu(ctx);
  await ctx.page.getByRole('button', { name: '小', exact: true }).click();
  await ctx.page.waitForTimeout(120);

  const smallMenuName = await readFontSize(ctx, '.user-menu-name');
  const smallSidebarTitle = await readFontSize(ctx, '.footer-entry-title');
  const smallComposerLabel = await readFontSize(ctx, '.composer-agent-pill-label');

  await ctx.page.getByRole('button', { name: '大', exact: true }).click();
  await ctx.page.waitForTimeout(120);

  const largeMenuName = await readFontSize(ctx, '.user-menu-name');
  const largeSidebarTitle = await readFontSize(ctx, '.footer-entry-title');
  const largeComposerLabel = await readFontSize(ctx, '.composer-agent-pill-label');

  expect(largeMenuName).toBeGreaterThan(smallMenuName);
  expect(largeSidebarTitle).toBeGreaterThan(smallSidebarTitle);
  expect(largeComposerLabel).toBeGreaterThan(smallComposerLabel);

  await ctx.page.locator('[data-testid="open-settings-entry"]').click();
  await expect(ctx.page.locator('[data-testid="settings-modal"]')).toBeVisible();
  await ctx.page.locator('[data-testid="settings-nav-general"]').click();
  await ctx.page.waitForTimeout(120);

  const largeSettingsTitle = await readFontSize(ctx, '.settings-modal-title');
  await ctx.page.getByRole('button', { name: '小', exact: true }).click();
  await ctx.page.waitForTimeout(120);
  const smallSettingsTitle = await readFontSize(ctx, '.settings-modal-title');

  expect(largeSettingsTitle).toBeGreaterThan(smallSettingsTitle);
});

test('language switching updates settings, empty workbench, and right rail copy together', async () => {
  await openSettings(ctx);
  await ctx.page.locator('[data-testid="settings-nav-general"]').click();

  await ctx.page.getByRole('button', { name: 'English', exact: true }).click();
  await ctx.page.waitForTimeout(160);

  await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toContainText('General');
  await expect(ctx.page.locator('.debugger-idle-simple-title')).toContainText('Three Orchestrators for end-to-end development');
  await expect(ctx.page.locator('[data-testid="cp-section-sessionProgress"] .cp-section-label')).toContainText('Progress');
  await expect(ctx.page.locator('[data-testid="cp-section-sessionWorkingFolder"] .cp-section-label')).toContainText('Working folder');
  await expect(ctx.page.locator('[data-testid="cp-section-sessionContext"] .cp-section-label')).toContainText('Context');
  await expect(ctx.page.locator('textarea.chat-input')).toHaveAttribute('placeholder', /Describe the goal/);

  await ctx.page.getByRole('button', { name: 'Simplified Chinese', exact: true }).click();
  await ctx.page.waitForTimeout(160);

  await expect(ctx.page.locator('[data-testid="settings-nav-general"]')).toContainText('通用');
  await expect(ctx.page.locator('.debugger-idle-simple-title')).toContainText('Orchestrator');
  await expect(ctx.page.locator('[data-testid="cp-section-sessionProgress"] .cp-section-label')).toContainText('进度');
  await expect(ctx.page.locator('[data-testid="cp-section-sessionWorkingFolder"] .cp-section-label')).toContainText('工作目录');
  await expect(ctx.page.locator('[data-testid="cp-section-sessionContext"] .cp-section-label')).toContainText('上下文');
  await expect(ctx.page.locator('textarea.chat-input')).toHaveAttribute('placeholder', /描述目标/);
});

test('light theme keeps settings and tablet workbench readable', async () => {
  await openSettings(ctx);
  await ctx.page.locator('[data-testid="settings-nav-general"]').click();
  await ctx.page.getByRole('button', { name: '浅色', exact: true }).click();
  await ctx.page.waitForTimeout(240);

  await expect(ctx.page.locator('[data-testid="settings-modal"]')).toHaveScreenshot('settings-light-theme.png');

  await ctx.page.keyboard.press('Escape');
  await expect(ctx.page.locator('[data-testid="settings-modal"]')).toBeHidden();

  await setWindowSize(ctx, 768, 900);
  await expect(ctx.page.locator('.app-body')).toHaveScreenshot('workbench-light-tablet-768.png');
});
