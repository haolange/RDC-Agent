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

const assertComposerFooterOrder = async (page: Page) => {
  const selectors = [
    '[data-testid="composer-attach-button"]',
    '[data-testid="composer-mode-pill"]',
    '[data-testid="composer-usage-indicator"]',
    '[data-testid="debugger-start-button"]',
  ];
  const boxes = await Promise.all(selectors.map(async (selector) => page.locator(selector).boundingBox()));

  for (const box of boxes) {
    expect(box).not.toBeNull();
  }

  expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
  expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
  expect(boxes[2]!.x).toBeLessThan(boxes[3]!.x);
};

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
          width: 256,
          expandedWidth: 256,
        },
        rightPanel: {
          collapsed: false,
          width: 312,
          expandedWidth: 312,
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

const setWindowSize = async (ctx: AppContext, width: number, height: number) => {
  await ctx.app.evaluate(({ BrowserWindow }, size) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(size.width, size.height);
  }, { width, height });
  await ctx.page.waitForTimeout(350);
};

const seedConversationPreview = async (page: Page) => {
  await page.evaluate(({ fixedNow }) => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => Record<string, unknown>;
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!hook) {
      throw new Error('Missing E2E state hook');
    }

    const state = hook.getWorkbenchState() as {
      currentProject: { projectId: string } | null;
      currentSession: { sessionId: string } | null;
    };

    if (!state.currentProject || !state.currentSession) {
      throw new Error('Missing project or session state');
    }

    hook.seedWorkbenchState({
      ...state,
      conversationMessages: [
        {
          id: 'message-assistant-wide',
          sessionId: state.currentSession.sessionId,
          projectId: state.currentProject.projectId,
          runId: 'run-wide-preview',
          modeContext: 'debugger',
          role: 'assistant',
          agentId: 'rdc-debugger',
          status: 'complete',
          content: '你好！我在呢。咱们已经在项目里了，手头有 Character_EyeSpark_Desktop.rdc 和 HairSparkWhite.rdc 这两个 Capture 文件。如果是双侧栏都收起的大画布场景，聊天气泡应该能继续放宽，而不是停留在过窄的固定宽度上。这里我故意把文本拉成长段落，用来验证 assistant 气泡是否会随着主区域变宽而继续扩展，避免左右留出过多无意义的黑边，并且确保一条较长的连续段落能把新的宽度上限真正利用起来。',
          attachments: [],
          createdAt: fixedNow - 2000,
        },
        {
          id: 'message-user-wide',
          sessionId: state.currentSession.sessionId,
          projectId: state.currentProject.projectId,
          runId: 'run-wide-preview',
          modeContext: 'debugger',
          role: 'user',
          status: 'complete',
          content: 'hello?',
          attachments: [],
          createdAt: fixedNow - 1000,
        },
      ],
    });
  }, { fixedNow: FIXED_NOW });
};

const getCenterDelta = async (page: Page, outerSelector: string, innerSelector: string) => page.evaluate((params) => {
  const outer = document.querySelector(params.outerSelector);
  const inner = document.querySelector(params.innerSelector);
  if (!(outer instanceof HTMLElement) || !(inner instanceof HTMLElement)) {
    return null;
  }

  const outerRect = outer.getBoundingClientRect();
  const innerRect = inner.getBoundingClientRect();

  return {
    deltaX: Math.abs((outerRect.left + outerRect.width / 2) - (innerRect.left + innerRect.width / 2)),
    deltaY: Math.abs((outerRect.top + outerRect.height / 2) - (innerRect.top + innerRect.height / 2)),
  };
}, { outerSelector, innerSelector });

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
  await expect(ctx.page.locator('.session-section-header').first()).toBeVisible();
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
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('empty workbench keeps a continuous background and centered focus', async () => {
  const page = ctx.page;
  const emptyPrompt = page.locator('[data-testid="empty-workbench-prompt"]');
  const mainShell = page.locator('.main-page-shell');

  await expect(emptyPrompt).toBeVisible();
  await expect(page.locator('.agent-chat')).toHaveClass(/is-empty/);

  const centerDelta = await getCenterDelta(page, '.chat-messages', '.empty-workbench-content');
  expect(centerDelta).not.toBeNull();
  expect(centerDelta?.deltaX ?? 99).toBeLessThanOrEqual(2);
  expect(centerDelta?.deltaY ?? 99).toBeLessThanOrEqual(2);

  const mainShellWidth = await mainShell.evaluate((element) => element.getBoundingClientRect().width);
  expect(mainShellWidth).toBeGreaterThan(480);

  await expect(emptyPrompt).toHaveScreenshot('empty-workbench.png');
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
  await expect(page.locator('[data-testid="capture-library-card-input-0"]')).toContainText('已打开');

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
});

test('Terminal drawer 展开后会显示日志并位于 prompt 下方', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="terminal-toggle"]').click();
  await page.locator('[data-testid="runtime-terminal-scope"]').click();
  await page.locator('[data-testid="runtime-terminal-scope-option-app"]').click();

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

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);
  await expect(page.locator('[data-testid="sidebar-user-settings-trigger"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-device-selector-trigger"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-footer"]')).toHaveScreenshot('sidebar-footer-collapsed.png');
});

test('左栏收起后用户菜单保持在窗口可视范围内', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);

  await page.locator('[data-testid="sidebar-user-settings-trigger"]').click();
  await expect(page.locator('[data-testid="sidebar-user-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-user-menu"]')).toHaveScreenshot('user-menu.png');
  expect(await isElementWithinViewport(page, '[data-testid="sidebar-user-menu"]')).toBe(true);
});

test('左栏收起后设备菜单展开不越界', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);

  await page.locator('[data-testid="sidebar-device-selector-trigger"]').click();
  await expect(page.locator('[data-testid="sidebar-device-selector-dropdown"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-device-selector-dropdown"]')).toHaveScreenshot('device-dropdown.png');
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

test('模式菜单视觉回归', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="composer-mode-pill"]').click();
  await expect(page.locator('.composer-agent-menu-popup')).toBeVisible();
  await expect(page.locator('.composer-agent-menu-popup')).toHaveScreenshot('mode-menu.png');
});

test('768px 宽度下自动收起右栏，主内容保持可见', async () => {
  const page = ctx.page;
  await setWindowSize(ctx, 768, 900);

  await expect(page.locator('[data-testid="titlebar-right-panel-toggle"]')).toBeVisible();
  await expect(page.locator('.main-input-bar')).toBeVisible();
  await expect(page.locator('.debugger-idle-simple-title')).toBeVisible();
  await expect(page.locator('.app-body')).toHaveScreenshot('tablet-layout-768.png');
});

test('375px 宽度下双侧栏自动收起，底部入口仍可达', async () => {
  const page = ctx.page;
  await setWindowSize(ctx, 375, 900);

  await expect(page.locator('[data-testid="sidebar-user-settings-trigger"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-device-selector-trigger"]')).toBeVisible();
  await expect(page.locator('.main-input-bar')).toBeVisible();
  await expect(page.locator('.app-body')).toHaveScreenshot('mobile-layout-375.png');
});

test('主输入条 focus 态保持清晰可见', async () => {
  const page = ctx.page;
const input = page.locator('textarea.chat-input').first();

  await input.focus();
  await page.waitForTimeout(180);

  await expect(page.locator('.main-input-bar')).toHaveScreenshot('main-input-focus.png');
});

test('composer footer keeps Upload, Mode, Usage, Send order', async () => {
  const page = ctx.page;

  await expect(page.locator('[data-testid="composer-usage-indicator"]')).toContainText('0%');
  await assertComposerFooterOrder(page);
});

test('collapsed footer icons stay centered in their buttons', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);

  const userDelta = await getCenterDelta(
    page,
    '[data-testid="sidebar-user-settings-trigger"]',
    '[data-testid="sidebar-user-settings-trigger"] .footer-entry-avatar',
  );
  const deviceDelta = await getCenterDelta(
    page,
    '[data-testid="sidebar-device-selector-trigger"]',
    '[data-testid="sidebar-device-selector-trigger"] .device-selector-trigger-icon',
  );

  expect(userDelta).not.toBeNull();
  expect(deviceDelta).not.toBeNull();
  expect(userDelta?.deltaX ?? 99).toBeLessThanOrEqual(1.5);
  expect(userDelta?.deltaY ?? 99).toBeLessThanOrEqual(1.5);
  expect(deviceDelta?.deltaX ?? 99).toBeLessThanOrEqual(1.5);
  expect(deviceDelta?.deltaY ?? 99).toBeLessThanOrEqual(1.5);
});

test('chat bubbles expand with the main canvas when both sidebars are collapsed', async () => {
  const page = ctx.page;
  await setWindowSize(ctx, 1720, 980);
  await seedConversationPreview(page);

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await page.locator('[data-testid="titlebar-right-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveClass(/collapsed/);

  const assistantBubble = page.locator('.chat-message.assistant .message-bubble.assistant').first();
  const userBubble = page.locator('.chat-message.user .message-bubble.user').first();

  await expect(assistantBubble).toBeVisible();
  await expect(userBubble).toBeVisible();
  await expect(page.locator('.app-main')).toContainText('Character_EyeSpark_Desktop.rdc');

  const assistantWidth = await assistantBubble.evaluate((element) => element.getBoundingClientRect().width);
  expect(assistantWidth).toBeGreaterThan(900);
});
