import { expect, test, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { closeApp, launchApp, type AppContext } from './helpers/electron-app';

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

const configureVisualSettings = async (appContext: AppContext): Promise<AppContext> => {
  const tempDir = appContext.tempDir;
  await appContext.page.evaluate(async () => {
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

  await closeApp(appContext, { cleanup: false });
  const relaunched = await launchApp({ tempDir, cleanupOnClose: true });
  await relaunched.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1080, 900);
  });
  await relaunched.page.waitForTimeout(400);
  return relaunched;
};

const setWindowSize = async (appContext: AppContext, width: number, height: number) => {
  await appContext.app.evaluate(({ BrowserWindow }, size) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(size.width, size.height);
  }, { width, height });
  await appContext.page.waitForTimeout(350);
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
          content: 'Both sidebars are collapsed in this preview. The assistant bubble should expand with the main canvas instead of staying inside the old narrow layout.',
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
  const previewAssetUrl = `data:image/png;base64,${fs.readFileSync(previewAssetPath).toString('base64')}`;
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
    sessionPath: 'D:/Utility/DebugTest/custom/sessions/session-visual',
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
      actionEvents: [],
      workflowState: null,
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
          resolvedEventId: 1847,
          presentEventId: 1847,
          textureId: 'ResourceId::3410',
          targetSource: 'swapchain_present',
          targetSemantic: 'swapchain',
          updatedAt: fixedNow,
        },
        previewError: null,
        previewAttempts: [
          {
            source: 'framebuffer_screenshot',
            status: 'success',
            resolvedEventId: 1847,
            presentEventId: 1847,
            textureId: 'ResourceId::3410',
            targetSource: 'swapchain_present',
            targetSemantic: 'swapchain',
            imagePath: previewAssetPath,
          },
        ],
      },
    });
  }, { project, session, projectInputs, captures, previewAssetPath, previewAssetUrl, fixedNow: FIXED_NOW });
};

const resetWorkbenchState = async (page: Page) => {
  await page.evaluate(() => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        resetWorkbenchState: () => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!hook) {
      throw new Error('Missing E2E state hook');
    }

    hook.resetWorkbenchState();
  });
};

const seedPersistedSessionWorkbench = async (page: Page, projectRoot: string) => {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'RightRail_Main.rdc'), 'fixture', 'utf8');

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    const sessionResult = await window.electronAPI.session.create(projectResult.project.projectId, 'Right Rail Session');
    if (!sessionResult.success || !sessionResult.session) {
      throw new Error(sessionResult.error || 'Failed to create session');
    }

    const sessions = await window.electronAPI.session.list(projectResult.project.projectId);
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!hook) {
      throw new Error('Missing E2E state hook');
    }

    hook.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: sessions.sessions,
      currentProject: projectResult.project,
      currentSession: sessionResult.session,
      rightRailTarget: 'session',
      currentRun: null,
      currentRunUsage: null,
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

    return {
      projectId: projectResult.project.projectId,
      sessionId: sessionResult.session.sessionId,
    };
  }, projectRoot);
};

const seedMultiSessionWorkbench = async (page: Page, projectRoot: string) => {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'MultiSession_Main.rdc'), 'fixture', 'utf8');

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    const alpha = await window.electronAPI.session.create(projectResult.project.projectId, 'Alpha Session');
    const beta = await window.electronAPI.session.create(projectResult.project.projectId, 'Beta Session');
    if (!alpha.success || !alpha.session || !beta.success || !beta.session) {
      throw new Error('Failed to create sessions');
    }

    const projects = await window.electronAPI.project.list();
    const project = projects.projects.find((entry) => entry.projectId === projectResult.project?.projectId) ?? projectResult.project;
    const sessions = await window.electronAPI.session.list(project.projectId);
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
      sessions: sessions.sessions,
      currentProject: project,
      currentSession: alpha.session,
      rightRailTarget: 'session',
      currentRun: null,
      currentRunUsage: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: project.inputs,
      openedCapture: null,
      conversationMessages: [],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });

    return {
      projectId: project.projectId,
      alphaSessionId: alpha.session.sessionId,
      betaSessionId: beta.session.sessionId,
      alphaTitle: alpha.session.title,
      betaTitle: beta.session.title,
    };
  }, projectRoot);
};

const seedProjectOnlyWorkbench = async (page: Page) => {
  await seedVisualWorkbench(page);
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
      currentSession: null,
      currentRun: null,
      conversationMessages: [],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  });
};

const seedSessionWorkbenchWithoutCapture = async (page: Page) => {
  await seedVisualWorkbench(page);
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
      captures: [],
      contextSnapshot: null,
      openedCapture: null,
      currentRun: null,
      workflowState: null,
      runs: [],
    });
  });
};

const seedRunningSessionWorkbench = async (page: Page) => {
  await seedVisualWorkbench(page);
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
      captures: unknown[];
    };

    const activeRun = {
      runId: 'run-visual',
      projectId: 'project-visual',
      sessionId: 'session-visual',
      caseId: 'session-visual',
      mode: 'debugger' as const,
      goal: 'Inspect current capture',
      captures: state.captures,
      startedAt: fixedNow,
      status: 'running' as const,
      lastStage: 'investigate',
      backend: 'local' as const,
    };

    hook.seedWorkbenchState({
      ...state,
      currentRun: activeRun,
      runs: [activeRun],
      workflowState: {
        caseId: 'session-visual',
        runId: 'run-visual',
        sessionId: 'session-visual',
        currentStage: 'investigate',
        previousStages: ['preflight', 'entry_gate', 'intake_gate', 'plan', 'dispatch'],
        entryMode: 'cli',
        backend: 'local',
        orchestrationMode: 'multi_agent',
        coordinationMode: 'staged_handoff',
        blockers: [
          {
            code: 'waiting-for-frame-annotation',
            reason: 'Waiting for the user to confirm the problematic frame.',
            refs: ['frame-327'],
            detectedAt: new Date(fixedNow).toISOString(),
          },
        ],
        reasoningSummaries: [
          {
            summaryId: 'summary-triage',
            stage: 'investigate',
            agentId: 'triage_agent',
            summary: 'Potential DrawCall isolated. Verifying the runtime context next.',
            evidence: ['capture:frame-327'],
            nextStep: 'Wait for frame confirmation before branching the analysis.',
            confidence: 0.82,
            createdAt: new Date(fixedNow).toISOString(),
          },
          {
            summaryId: 'summary-driver',
            stage: 'investigate',
            agentId: 'driver_device_agent',
            summary: 'Device and replay runtime connection are healthy.',
            evidence: ['device:local'],
            nextStep: 'Continue narrowing the issue down to the shader path.',
            confidence: 0.91,
            createdAt: new Date(fixedNow + 1_000).toISOString(),
          },
        ],
        lastUpdated: new Date(fixedNow + 1_000).toISOString(),
      },
    });
  }, { fixedNow: FIXED_NOW });
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
  expect(mainShellWidth).toBeGreaterThan(470);

  await expect(emptyPrompt).toHaveScreenshot('empty-workbench.png');
});

test('no project hides the right rail and its chrome', async () => {
  const page = ctx.page;
  await resetWorkbenchState(page);

  await expect(page.locator('[data-testid="titlebar-right-panel-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveCount(0);
  await expect(page.locator('.panel-resize-handle-right')).toHaveCount(0);

  const mainWidth = await page.locator('.app-main').evaluate((element) => element.getBoundingClientRect().width);
  const bodyWidth = await page.locator('.app-body').evaluate((element) => element.getBoundingClientRect().width);
  expect(mainWidth).toBeGreaterThan(bodyWidth * 0.45);

  await expect(page.locator('.app-body')).toHaveScreenshot('no-project-right-rail-hidden.png');
});

test('project mode keeps only Capture Library on the right rail', async () => {
  const page = ctx.page;
  await seedProjectOnlyWorkbench(page);

  await expect(page.locator('[data-testid="titlebar-right-panel-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-openedCapture"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="cp-section-runtimeContext"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="capture-library-open-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveScreenshot('right-panel-project.png');
});

test('clicking project switches the right rail to project mode without clearing the active session', async () => {
  const page = ctx.page;
  const seeded = await seedPersistedSessionWorkbench(page, path.join(ctx.tempDir, 'right-rail-project'));

  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();

  await page.locator('.project-item-title').first().click();
  await expect.poll(async () => page.evaluate(() => (
    (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { rightRailTarget?: string };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().rightRailTarget ?? null
  ))).toBe('project');
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toHaveCount(0);

  const currentSessionId = await page.evaluate(() => (
    (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentSession: { sessionId: string } | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentSession?.sessionId ?? null
  ));
  expect(currentSessionId).toBe(seeded.sessionId);

  await page.locator('.session-subitem').first().click();
  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toHaveCount(0);
});

test('clicking project after creating a session keeps the latest project selection in the right rail', async () => {
  const page = ctx.page;
  const seeded = await seedPersistedSessionWorkbench(page, path.join(ctx.tempDir, 'right-rail-after-create'));

  await page.evaluate(async ({ projectId }) => {
    const created = await window.electronAPI.session.create(projectId, 'Fresh Session');
    if (!created.success || !created.session) {
      throw new Error(created.error || 'Failed to create session');
    }

    const projects = await window.electronAPI.project.list();
    const project = projects.projects.find((entry) => entry.projectId === projectId);
    const sessions = await window.electronAPI.session.list(projectId);
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!project || !hook) {
      throw new Error('Missing project or E2E hook');
    }

    hook.seedWorkbenchState({
      projects: [project],
      sessions: sessions.sessions,
      currentProject: project,
      currentSession: created.session,
      rightRailTarget: 'session',
      currentRun: null,
      currentRunUsage: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: project.inputs,
      openedCapture: null,
      conversationMessages: [],
      timeline: [],
      actionEvents: [],
      workflowState: null,
      runs: [],
    });
  }, { projectId: seeded.projectId });

  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await expect(page.locator('.session-subitem.active')).toHaveCount(1);

  await page.locator('.project-item').first().click();

  await expect.poll(async () => page.evaluate(() => (
    (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { rightRailTarget?: string };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().rightRailTarget ?? null
  ))).toBe('project');
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toHaveCount(0);
  await expect(page.locator('.project-item.active')).toHaveCount(1);
  await expect(page.locator('.session-subitem.active')).toHaveCount(0);
});

test('clicking sessions in the same project updates the active session highlight and keeps session rail mode', async () => {
  const page = ctx.page;
  const seeded = await seedMultiSessionWorkbench(page, path.join(ctx.tempDir, 'right-rail-multi-session'));

  const alphaItem = page.locator('.session-subitem', { hasText: seeded.alphaTitle }).first();
  const betaItem = page.locator('.session-subitem', { hasText: seeded.betaTitle }).first();

  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await expect(alphaItem).toHaveClass(/active/);
  await expect(betaItem).not.toHaveClass(/active/);
  await expect(page.locator('.project-item.active')).toHaveCount(0);

  await betaItem.click();

  await expect.poll(async () => page.evaluate(() => {
    const state = (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentSession: { sessionId: string } | null; rightRailTarget?: string };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState();
    return `${state?.rightRailTarget ?? ''}:${state?.currentSession?.sessionId ?? ''}`;
  })).toBe(`session:${seeded.betaSessionId}`);
  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toHaveCount(0);
  await expect(alphaItem).not.toHaveClass(/active/);
  await expect(betaItem).toHaveClass(/active/);
  await expect(page.locator('.session-subitem.active')).toHaveCount(1);
  await expect(page.locator('.project-item.active')).toHaveCount(0);
});

test('Capture Library toolbar and cards do not clip horizontally', async () => {
  const page = ctx.page;
  await seedProjectOnlyWorkbench(page);
  const toolbar = page.locator('[data-testid="capture-library-toolbar"]');
  const librarySection = page.locator('[data-testid="cp-section-captureLibrary"]');

  await librarySection.evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  await page.waitForTimeout(200);

  await expect(toolbar).toBeVisible();
  await expect(page.locator('[data-testid="capture-library-import"]')).toBeVisible();
  await expect(page.locator('[data-testid="capture-library-refresh"]')).toBeVisible();
  await expect(page.locator('[data-testid="capture-library-card-input-0"]')).toBeVisible();
  await expect(page.locator('[data-testid^="capture-library-open-"]')).toHaveCount(0);

  expect(await isChildFullyWithinContainer(
    page,
    '[data-testid="capture-library-toolbar"]',
    '[data-testid="capture-library-import"]',
  )).toBe(true);
  expect(await isChildFullyWithinContainer(
    page,
    '[data-testid="capture-library-toolbar"]',
    '[data-testid="capture-library-refresh"]',
  )).toBe(true);
  expect(await isChildHorizontallyWithinContainer(
    page,
    '[data-testid="capture-library-card-input-0"]',
    '.capture-library-item-meta',
  )).toBe(true);

  await expect(librarySection).toHaveScreenshot('capture-library-section.png');
});

test('session mode shows opened capture context inside Context panel', async () => {
  const page = ctx.page;
  const contextSection = page.locator('[data-testid="cp-section-sessionContext"]');

  await contextSection.evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  await page.waitForTimeout(200);

  await expect(page.locator('[data-testid="opened-capture-preview-window"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-context-copy-id"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-context-clear-opened"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toHaveCount(0);
  await expect(contextSection).toContainText('HairSparkWhite.rdc');
  await expect(contextSection).toContainText('local-runtime');
  await expect(contextSection).toContainText('ctx-device-visual');
  await expect(contextSection).toHaveScreenshot('session-context-opened.png');
});

test('session mode renders framebuffer preview image for opened capture', async () => {
  const page = ctx.page;
  const previewWindow = page.locator('[data-testid="opened-capture-preview-window"]');
  const previewImage = previewWindow.locator('img.opened-capture-preview-image');

  await expect(previewWindow).toBeVisible();
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(previewWindow.locator('.opened-capture-preview-badge.framebuffer_screenshot')).toContainText(/Swapchain \/ Present/);
});

test('session mode labels event output fallback preview explicitly', async () => {
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
      openedCapture: state.openedCapture
        ? {
            ...state.openedCapture,
            preview: {
              ...(state.openedCapture as { preview: Record<string, unknown> }).preview,
              targetSource: 'event_output_fallback',
              targetSemantic: 'swapchain',
              fallbackReason: 'swapchain_target_unavailable',
              summaryDegraded: true,
            },
          }
        : null,
    });
  });

  const previewWindow = page.locator('[data-testid="opened-capture-preview-window"]');
  await expect(previewWindow).toBeVisible();
  await expect(previewWindow.locator('.opened-capture-preview-badge.event_output_fallback')).toContainText(/Fallback RT/);
  await expect(previewWindow).toContainText(/Swapchain unavailable|未能解析 Swapchain/);
});

test('session mode shows structured preview failure for opened capture', async () => {
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

    const state = hook.getWorkbenchState() as { openedCapture?: Record<string, unknown> | null };
    hook.seedWorkbenchState({
      ...state,
      openedCapture: state.openedCapture
        ? {
            ...state.openedCapture,
            preview: null,
            previewError: {
              message: 'Active event 1847 does not expose a previewable output target',
              code: 'preview_event_output_unavailable',
              attempts: [
                {
                  source: 'framebuffer_screenshot',
                  status: 'failed',
                  eventId: 1847,
                  message: 'Active event 1847 does not expose a previewable output target',
                  code: 'preview_event_output_unavailable',
                },
              ],
            },
            previewAttempts: [
              {
                source: 'framebuffer_screenshot',
                status: 'failed',
                eventId: 1847,
                message: 'Active event 1847 does not expose a previewable output target',
                code: 'preview_event_output_unavailable',
              },
            ],
          }
        : null,
    });
  });

  const previewWindow = page.locator('[data-testid="opened-capture-preview-window"]');
  await expect(previewWindow).toBeVisible();
  await expect(previewWindow.locator('img.opened-capture-preview-image')).toHaveCount(0);
  await expect(previewWindow).toContainText('preview_event_output_unavailable');
  await expect(previewWindow).toContainText('Active event 1847 does not expose a previewable output target');
});

test('session mode shows task-first cards and quick capture entry when nothing is opened', async () => {
  const page = ctx.page;
  await seedSessionWorkbenchWithoutCapture(page);

  await expect(page.locator('[data-testid="cp-section-sessionProgress"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-sessionWorkingFolder"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="cp-section-sessionContext"] .cp-section-content')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-sessionProgress"] .cp-section-content')).toHaveCount(0);
  await expect(page.locator('[data-testid="cp-section-sessionWorkingFolder"] .cp-section-content')).toHaveCount(0);
  await expect(page.locator('[data-testid="session-context-capture-select"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-context-open-selected"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveScreenshot('right-panel-session-empty.png');
  await page.locator('[data-testid="session-context-capture-select"]').click();
  await expect(page.locator('[data-testid="session-context-capture-select-menu"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-context-capture-option-input-0"]')).toBeVisible();
  await expect(page.locator('[data-testid="session-context-capture-option-input-1"]')).toBeVisible();
});

test('session Context can be collapsed after the default idle expansion', async () => {
  const page = ctx.page;
  await seedSessionWorkbenchWithoutCapture(page);

  const contextSection = page.locator('[data-testid="cp-section-sessionContext"]');
  await expect(contextSection.locator('.cp-section-content')).toBeVisible();

  await contextSection.locator('.cp-section-header').click();
  await expect(contextSection.locator('.cp-section-content')).toHaveCount(0);
});

test('session mode reflects an active run without falling back to project panels', async () => {
  const page = ctx.page;
  await seedRunningSessionWorkbench(page);

  await expect(page.locator('[data-testid="cp-section-sessionProgress"]')).toBeVisible();
  await expect(page.locator('[data-testid="cp-section-captureLibrary"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="cp-section-sessionProgress"]')).toContainText('33%');
  await page.locator('[data-testid="cp-section-sessionProgress"] .cp-section-header').click();
  await page.locator('[data-testid="cp-section-sessionContext"] .cp-section-header').click();
  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toContainText('HairSparkWhite.rdc');
  await expect(page.locator('[data-testid="session-context-clear-opened"]')).toBeDisabled();
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveScreenshot('right-panel-session-running.png');
});

test('session Context stays readable in a narrow visible right rail', async () => {
  const page = ctx.page;
  await setWindowSize(ctx, 980, 900);

  const contextSection = page.locator('[data-testid="cp-section-sessionContext"]');
  await contextSection.evaluate((element) => {
    element.scrollIntoView({ block: 'start', inline: 'nearest' });
  });
  await page.waitForTimeout(200);

  await expect(page.locator('[data-testid="opened-capture-preview-window"]')).toBeVisible();
  expect(await isChildHorizontallyWithinContainer(
    page,
    '[data-testid="cp-section-sessionContext"]',
    '[data-testid="opened-capture-preview-window"]',
  )).toBe(true);
  expect(await isChildHorizontallyWithinContainer(
    page,
    '[data-testid="cp-section-sessionContext"]',
    '[data-testid="session-context-clear-opened"]',
  )).toBe(true);
  await expect(contextSection).toHaveScreenshot('session-context-narrow.png');
});

test('Terminal drawer appears below the prompt bar when opened', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="terminal-toggle"]').click();
  await expect(page.locator('[data-testid="runtime-terminal-activity-pane"]')).toBeVisible();
  await expect(page.locator('.runtime-terminal-shell-tab')).toHaveCount(0);
  await page.locator('[data-testid="runtime-terminal-scope"]').click();
  await page.locator('[data-testid="runtime-terminal-scope-option-app"]').click();
  await page.locator('[data-testid="runtime-terminal-filter-toggle"]').click();
  await page.locator('[data-testid="runtime-terminal-severity"]').click();
  await page.locator('[data-testid="runtime-terminal-severity-option-success"]').click();
  await expect(page.locator('.runtime-terminal-entry.severity-success')).toHaveCount(2);
  await page.locator('[data-testid="runtime-terminal-severity"]').click();
  await page.locator('[data-testid="runtime-terminal-severity-option-all"]').click();
  await page.locator('[data-testid="runtime-terminal-filter-toggle"]').click();

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

  await page.locator('[data-testid="runtime-terminal-shell-tab"]').click();
  await expect(page.locator('[data-testid="runtime-terminal-shell-pane"]')).toBeVisible();
  await expect(page.locator('.runtime-terminal-shell-empty')).toBeVisible();
  await expect(page.locator('.app-main')).toHaveScreenshot('runtime-terminal-shell-empty.png');
});

test('sidebar footer remains visually stable', async () => {
  const page = ctx.page;
  await expect(page.locator('[data-testid="sidebar-footer"]')).toHaveScreenshot('sidebar-footer.png');
});

test('top utility pills show Replay Device next to Terminal', async () => {
  const page = ctx.page;
  await expect(page.locator('[data-testid="utility-device-selector-trigger"]')).toBeVisible();
  await expect(page.locator('[data-testid="terminal-toggle"]')).toBeVisible();
  await expect(page.locator('.main-floating-utilities')).toHaveScreenshot('main-utilities.png');
});

test('collapsed left sidebar keeps footer utilities reachable', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);
  await page.waitForTimeout(320);
  await expect(page.locator('[data-testid="sidebar-user-settings-trigger"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="utility-device-selector-trigger"]')).toBeVisible();
  const leftWidth = await page.locator('[data-testid="app-sidebar-left"]').evaluate((element) => element.getBoundingClientRect().width);
  expect(leftWidth).toBeLessThanOrEqual(1);
});

test('device dropdown stays within the viewport when the left sidebar is collapsed', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);

  await page.locator('[data-testid="utility-device-selector-trigger"]').click();
  await expect(page.locator('[data-testid="utility-device-selector-dropdown"]')).toBeVisible();
  await expect(page.locator('[data-testid="utility-device-selector-dropdown"]')).toHaveScreenshot('device-dropdown.png');
  expect(await isElementWithinViewport(page, '[data-testid="utility-device-selector-dropdown"]')).toBe(true);
});

test('collapsing the right rail does not break the device utility entry', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="titlebar-right-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveClass(/collapsed/);
  await page.waitForTimeout(320);
  const rightWidth = await page.locator('[data-testid="app-sidebar-right"]').evaluate((element) => element.getBoundingClientRect().width);
  expect(rightWidth).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-testid="utility-device-selector-trigger"]')).toBeVisible();
});

test('mode menu remains visually stable', async () => {
  const page = ctx.page;

  await page.locator('[data-testid="composer-mode-pill"]').click();
  await expect(page.locator('.composer-agent-menu-popup')).toBeVisible();
  await expect(page.locator('.composer-agent-menu-popup')).toHaveScreenshot('mode-menu.png');
});

test('the right rail auto-collapses at 768px while keeping the main surface readable', async () => {
  const page = ctx.page;
  await setWindowSize(ctx, 768, 900);

  await expect(page.locator('[data-testid="titlebar-right-panel-toggle"]')).toBeVisible();
  await expect(page.locator('.main-input-bar')).toBeVisible();
  await expect(page.locator('.debugger-idle-simple-title')).toBeVisible();
  await expect(page.locator('.app-body')).toHaveScreenshot('tablet-layout-768.png');
});

test('both sidebars auto-collapse at 375px and the bottom entry points remain reachable', async () => {
  const page = ctx.page;
  await setWindowSize(ctx, 375, 900);

  await expect(page.locator('[data-testid="sidebar-user-settings-trigger"]')).not.toBeVisible();
  await expect(page.locator('[data-testid="utility-device-selector-trigger"]')).toBeVisible();
  await expect(page.locator('.main-input-bar')).toBeVisible();
  await expect(page.locator('.app-body')).toHaveScreenshot('mobile-layout-375.png');
});

test('the main input bar keeps a clear focus state', async () => {
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
  await setWindowSize(ctx, 1720, 980);

  await page.locator('[data-testid="titlebar-left-panel-toggle"]').click();
  await page.locator('[data-testid="titlebar-right-panel-toggle"]').click();
  await expect(page.locator('[data-testid="app-sidebar-left"]')).toHaveClass(/collapsed/);
  await expect(page.locator('[data-testid="app-sidebar-right"]')).toHaveClass(/collapsed/);
  await page.waitForTimeout(320);

  const widths = await page.evaluate(() => ({
    left: document.querySelector('[data-testid="app-sidebar-left"]')?.getBoundingClientRect().width ?? 0,
    right: document.querySelector('[data-testid="app-sidebar-right"]')?.getBoundingClientRect().width ?? 0,
    main: document.querySelector('.app-main')?.getBoundingClientRect().width ?? 0,
    body: document.querySelector('.app-body')?.getBoundingClientRect().width ?? 0,
  }));

  expect(widths.left).toBeLessThanOrEqual(1);
  expect(widths.right).toBeLessThanOrEqual(1);
  expect(widths.main).toBeGreaterThan(widths.body * 0.9);
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
  await expect(page.locator('.app-main')).toContainText('Both sidebars are collapsed in this preview.');

  const layout = await page.evaluate(() => {
    const main = document.querySelector('.app-main');
    const message = document.querySelector('.chat-message.assistant');
    const bubble = document.querySelector('.chat-message.assistant .message-bubble.assistant');

    return {
      mainWidth: main?.getBoundingClientRect().width ?? 0,
      messageWidth: message?.getBoundingClientRect().width ?? 0,
      bubbleWidth: bubble?.getBoundingClientRect().width ?? 0,
    };
  });

  expect(layout.messageWidth).toBeGreaterThan(layout.mainWidth * 0.4);
  expect(layout.messageWidth).toBeLessThan(layout.mainWidth * 0.65);
  expect(layout.bubbleWidth).toBeLessThanOrEqual(layout.messageWidth);
});
