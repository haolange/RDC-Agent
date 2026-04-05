import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { pathToFileURL } from 'url';
import { launchApp, closeApp, type AppContext } from './helpers/electron-app';

let ctx: AppContext;

const FIXED_NOW = Date.UTC(2026, 3, 6, 3, 12, 16);

const isChildFullyWithinContainer = async (
  page: Page,
  containerSelector: string,
  childSelector: string,
) => page.evaluate(({ containerSelector, childSelector }) => {
  const container = document.querySelector(containerSelector);
  const child = document.querySelector(childSelector);
  if (!(container instanceof HTMLElement) || !(child instanceof HTMLElement)) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const tolerance = 4;

  return (
    childRect.left >= containerRect.left - tolerance
    && childRect.right <= containerRect.right + tolerance
    && childRect.top >= containerRect.top - tolerance
    && childRect.bottom <= containerRect.bottom + tolerance
  );
}, { containerSelector, childSelector });

const isChildHorizontallyWithinContainer = async (
  page: Page,
  containerSelector: string,
  childSelector: string,
) => page.evaluate(({ containerSelector, childSelector }) => {
  const container = document.querySelector(containerSelector);
  const child = document.querySelector(childSelector);
  if (!(container instanceof HTMLElement) || !(child instanceof HTMLElement)) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const tolerance = 4;

  return childRect.left >= containerRect.left - tolerance && childRect.right <= containerRect.right + tolerance;
}, { containerSelector, childSelector });

const isElementWithinViewport = async (page: Page, selector: string) => page.evaluate((targetSelector) => {
  const element = document.querySelector(targetSelector);
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const tolerance = 4;

  return (
    rect.left >= 0 - tolerance
    && rect.top >= 0 - tolerance
    && rect.right <= window.innerWidth + tolerance
    && rect.bottom <= window.innerHeight + tolerance
  );
}, selector);

const isElementDescendantOf = async (page: Page, selector: string, ancestorSelector: string) => page.evaluate((params) => {
  const element = document.querySelector(params.selector);
  const ancestor = document.querySelector(params.ancestorSelector);
  if (!(element instanceof HTMLElement) || !(ancestor instanceof HTMLElement)) {
    return false;
  }

  return ancestor.contains(element);
}, { selector, ancestorSelector });

const doesElementOverflowSidebar = async (page: Page, selector: string, sidebarSelector: string) => page.evaluate((params) => {
  const element = document.querySelector(params.selector);
  const sidebar = document.querySelector(params.sidebarSelector);
  if (!(element instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) {
    return false;
  }

  const elementRect = element.getBoundingClientRect();
  const sidebarRect = sidebar.getBoundingClientRect();
  return elementRect.right > sidebarRect.right + 80;
}, { selector, sidebarSelector });

const configureVisualSettings = async (ctx: AppContext): Promise<AppContext> => {
  const tempDir = ctx.tempDir;
  await ctx.page.evaluate(async () => {
    await window.electronAPI.settings.set({
      appearance: {
        theme: 'dark',
        language: 'zh-CN',
        fontScale: 'medium',
      },
      profile: {
        nickname: 'CGBull',
      },
      layout: {
        leftSidebar: {
          collapsed: false,
          width: 280,
          expandedWidth: 280,
        },
        rightPanel: {
          collapsed: false,
          width: 280,
          expandedWidth: 280,
        },
      },
    });
  });

  await closeApp(ctx, { cleanup: false });
  const relaunched = await launchApp({ tempDir, cleanupOnClose: true });
  await relaunched.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1080, 900);
  });
  await relaunched.page.waitForTimeout(400);
  return relaunched;
};

const seedVisualWorkbench = async (page: Page) => {
  const previewAssetPath = path.resolve('src/renderer/assets/images/hero-bg.png');
  const previewAssetUrl = pathToFileURL(previewAssetPath).toString();
  const projectInputs = Array.from({ length: 3 }, (_, index) => ({
    inputId: `input-${index}`,
    fileName: index === 0 ? 'HairSparkWhite.rdc' : `Capture-${index}.rdc`,
    filePath: index === 0
      ? 'D:/Utility/DebugTest/custom/.resource/inputs/HairSparkWhite.rdc'
      : `D:/Utility/DebugTest/custom/.resource/inputs/Capture-${index}.rdc`,
    source: 'project_resource' as const,
    discoveredAt: FIXED_NOW - index * 1_000,
    lastModifiedAt: FIXED_NOW - index * 1_000,
    size: 160_800_000 - index * 2048,
  }));

  const project = {
    projectId: 'project-visual',
    name: 'custom',
    rootPath: 'D:/Utility/DebugTest/custom',
    slug: 'custom',
    resourcePath: 'D:/Utility/DebugTest/custom/.resource',
    knowledgePath: 'D:/Utility/DebugTest/custom/.knowledge',
    inputsPath: 'D:/Utility/DebugTest/custom/.resource/inputs',
    inputs: projectInputs,
    inputsUpdatedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    lastSessionId: 'session-visual',
  };

  const session = {
    sessionId: 'session-visual',
    projectId: project.projectId,
    title: 'HairSpark',
    goal: '',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    lastRunId: undefined,
  };

  const captures = [
    {
      id: projectInputs[0].inputId,
      filePath: projectInputs[0].filePath,
      role: 'primary' as const,
      backendHint: 'local' as const,
      status: 'open' as const,
      contextId: 'ctx-device-visual',
      sessionId: 'replay-session-visual',
      replaySessionId: 'replay-visual',
    },
  ];

  await page.evaluate(({ project, session, projectInputs, captures, previewAssetPath, previewAssetUrl, fixedNow }) => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!hook) {
      throw new Error('Missing E2E state hook');
    }

    hook.seedWorkbenchState({
      projects: [project],
      sessions: [session],
      currentProject: project,
      currentSession: session,
      currentRun: null,
      captures,
      projectInputs,
      timeline: [],
      runs: [],
      contextSnapshot: {
        contextId: 'ctx-device-visual',
        sessionId: 'replay-session-visual',
        backend: 'local',
        runtimeOwner: 'local-runtime',
        ownerLeaseId: 'lease-visual',
        captureDescriptors: captures,
        activeCapture: captures[0].id,
        deviceLabel: 'Local',
      },
      openedCapture: {
        projectId: project.projectId,
        inputId: projectInputs[0].inputId,
        filePath: projectInputs[0].filePath,
        captureId: captures[0].id,
        sessionId: 'replay-session-visual',
        contextId: 'ctx-device-visual',
        replaySessionId: 'replay-visual',
        backend: 'local',
        deviceId: 'local',
        deviceLabel: 'Local',
        status: 'open',
        openedAt: fixedNow,
        preview: {
          imagePath: previewAssetPath,
          imageUrl: previewAssetUrl,
          width: 1280,
          height: 720,
          source: 'framebuffer_screenshot',
          updatedAt: fixedNow,
        },
      },
    });
  }, { project, session, projectInputs, captures, previewAssetPath, previewAssetUrl, fixedNow: FIXED_NOW });
};

test.beforeEach(async () => {
  ctx = await launchApp();
  ctx = await configureVisualSettings(ctx);
  await expect(ctx.page.locator('.session-empty').first()).toBeVisible();
  await seedVisualWorkbench(ctx.page);
  await expect.poll(async () => ctx.page.evaluate(() => (
    (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentProject: { name: string } | null; projectInputs: Array<unknown> };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentProject?.name ?? null
  ))).toBe('custom');
  await expect.poll(async () => ctx.page.evaluate(() => (
    (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { projectInputs: Array<unknown> };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().projectInputs.length ?? 0
  ))).toBe(3);
  await expect(ctx.page.locator('text=custom').first()).toBeVisible();
  await ctx.page.locator('[data-testid="cp-section-runtimeContext"] .cp-section-header').click();
  await ctx.page.waitForTimeout(350);
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('右栏窄态视觉回归', async () => {
  const page = ctx.page;
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveScreenshot('right-panel-narrow.png');
});

test('Capture Library 工具栏和操作按钮不会横向裁剪', async () => {
  const page = ctx.page;
  const toolbar = page.locator('[data-testid="capture-library-toolbar"]');
  const importButton = page.locator('[data-testid="capture-library-import"]');
  const openButton = page.locator('[data-testid="capture-library-open-input-0"]');
  const librarySection = page.locator('[data-testid="cp-section-captureLibrary"]');

  await librarySection.evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  await page.waitForTimeout(200);

  await expect(toolbar).toBeVisible();
  await expect(importButton).toBeVisible();
  await expect(openButton).toBeVisible();
  await expect(page.locator('[data-testid="capture-library-card-input-0"]')).toContainText('Opened');

  expect(await isChildFullyWithinContainer(
    page,
    '[data-testid="capture-library-toolbar"]',
    '[data-testid="capture-library-import"]',
  )).toBe(true);
  expect(await isChildHorizontallyWithinContainer(
    page,
    '[data-testid="capture-library-card-input-0"]',
    '[data-testid="capture-library-actions-input-0"]',
  )).toBe(true);
  expect(await isChildFullyWithinContainer(
    page,
    '[data-testid="capture-library-actions-input-0"]',
    '[data-testid="capture-library-open-input-0"]',
  )).toBe(true);

  await expect(librarySection).toHaveScreenshot('capture-library-section.png');
});

test('Opened Capture 面板视觉回归', async () => {
  const page = ctx.page;
  const openedCaptureSection = page.locator('[data-testid="cp-section-openedCapture"]');

  await openedCaptureSection.evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  await page.waitForTimeout(200);

  await expect(page.locator('[data-testid="opened-capture-preview-window"]')).toBeVisible();
  await expect(openedCaptureSection).toHaveScreenshot('opened-capture-section.png');
});

test('运行中会禁用 Capture Library 的打开按钮，并禁止清理 opened capture', async () => {
  const page = ctx.page;

  await page.evaluate(() => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => Record<string, unknown>;
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;
    if (!hook) {
      throw new Error('Missing E2E state hook');
    }

    const state = hook.getWorkbenchState();
    hook.seedWorkbenchState({
      ...state,
      currentRun: {
        runId: 'run-visual',
        projectId: 'project-visual',
        sessionId: 'session-visual',
        caseId: 'session-visual',
        mode: 'debugger',
        goal: 'Inspect current capture',
        captures: state.captures,
        startedAt: Date.now(),
        status: 'running',
        lastStage: 'investigate',
        backend: 'local',
      },
    });
  });

  await expect(page.locator('[data-testid="capture-library-open-input-0"]')).toBeDisabled();
  await expect(page.locator('.capture-library-run-lock')).toBeVisible();
  await expect(page.locator('[data-testid="opened-capture-clear"]')).toBeDisabled();
  await expect(page.locator('[data-testid="runtime-context-panel"]')).not.toContainText('HairSparkWhite.rdc');
});

test('Terminal drawer 展开后会显示日志并位于 prompt 下方', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="terminal-toggle"]').click();
  await page.locator('[data-testid="runtime-terminal-scope"]').selectOption('app');

  const promptBar = page.locator('.main-input-bar');
  const terminal = page.locator('[data-testid="runtime-terminal"]');

  await expect(terminal).toBeVisible();
  await expect(page.locator('.runtime-terminal-entry').first()).toBeVisible();

  const [promptBox, terminalBox] = await Promise.all([
    promptBar.boundingBox(),
    terminal.boundingBox(),
  ]);

  expect(promptBox).not.toBeNull();
  expect(terminalBox).not.toBeNull();
  expect((promptBox?.y ?? 0) + (promptBox?.height ?? 0)).toBeLessThanOrEqual((terminalBox?.y ?? 0) + 4);

  await page.evaluate(() => {
    document.querySelectorAll('.runtime-terminal-entry-time').forEach((element) => {
      element.textContent = '00:00:00';
    });
  });

  await expect(page.locator('.app-main')).toHaveScreenshot('runtime-terminal-open.png');
});

test('左下 footer 视觉回归', async () => {
  const page = ctx.page;
  await expect(page.locator('[data-testid="sidebar-footer"]')).toHaveScreenshot('sidebar-footer.png');
});

test('左栏收起后 footer 仍保留用户与设备缩略入口', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="app-sidebar-left"] .shell-panel-toggle').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);
  await expect(page.locator('[data-testid="sidebar-user-settings-trigger"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-device-selector-trigger"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-footer"]')).toHaveScreenshot('sidebar-footer-collapsed.png');
});

test('左栏收起后用户菜单保持在窗口可视范围内', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="app-sidebar-left"] .shell-panel-toggle').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);

  await page.locator('[data-testid="sidebar-user-settings-trigger"]').click();
  await expect(page.locator('[data-testid="sidebar-user-menu"]')).toBeVisible();
  expect(await isElementWithinViewport(page, '[data-testid="sidebar-user-menu"]')).toBe(true);
});

test('左栏收起后设备菜单展开不越界', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="app-sidebar-left"] .shell-panel-toggle').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);

  await page.locator('[data-testid="sidebar-device-selector-trigger"]').click();
  await expect(page.locator('[data-testid="sidebar-device-selector-dropdown"]')).toBeVisible();
  expect(await isElementWithinViewport(page, '[data-testid="sidebar-device-selector-dropdown"]')).toBe(true);
  expect(await isElementDescendantOf(
    page,
    '[data-testid="sidebar-device-selector-dropdown"]',
    '[data-testid="app-sidebar-left"]',
  )).toBe(false);
  expect(await doesElementOverflowSidebar(
    page,
    '[data-testid="sidebar-device-selector-dropdown"]',
    '[data-testid="app-sidebar-left"]',
  )).toBe(true);
});
