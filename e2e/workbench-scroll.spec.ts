import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

const getScrollTop = async (selector: string, page: AppContext['page']) =>
  page.locator(selector).evaluate((element) => element.scrollTop);

const isElementTopWithinContainer = async (
  containerSelector: string,
  childSelector: string,
  page: AppContext['page'],
) => page.evaluate(({ containerSelector, childSelector }) => {
  const container = document.querySelector(containerSelector);
  const child = document.querySelector(childSelector);
  if (!(container instanceof HTMLElement) || !(child instanceof HTMLElement)) {
    return false;
  }
  const containerRect = container.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  return childRect.top >= containerRect.top && childRect.top <= containerRect.bottom;
}, { containerSelector, childSelector });

const seedPreviewWorkbench = async (page: AppContext['page']) => {
  const now = Date.now();
  const projectInputs = Array.from({ length: 18 }, (_, index) => ({
    inputId: `input-${index}`,
    fileName: `Capture-${index}.rdc`,
    filePath: `C:/workspace/project-0/.resource/inputs/Capture-${index}.rdc`,
    source: 'project_resource' as const,
    discoveredAt: now - index * 3_000,
    lastModifiedAt: now - index * 2_000,
    size: 1024 * 1024 * (index + 1),
  }));

  const projects = Array.from({ length: 9 }, (_, index) => ({
    projectId: `project-${index}`,
    name: `Project ${index}`,
    rootPath: `C:/workspace/project-${index}`,
    slug: `project-${index}`,
    resourcePath: `C:/workspace/project-${index}/.resource`,
    knowledgePath: `C:/workspace/project-${index}/.knowledge`,
    inputsPath: `C:/workspace/project-${index}/.resource/inputs`,
    inputs: index === 0 ? projectInputs : [],
    inputsUpdatedAt: now,
    createdAt: now - index * 10_000,
    updatedAt: now - index * 5_000,
    lastSessionId: 'session-0',
  }));

  const sessions = Array.from({ length: 28 }, (_, index) => ({
    sessionId: `session-${index}`,
    projectId: projects[0].projectId,
    title: `HairSpark Session ${index}`,
    goal: `Investigate capture issue ${index}`,
    createdAt: now - index * 60_000,
    updatedAt: now - index * 15_000,
    lastRunId: `run-${index}`,
  }));

  const captures = projectInputs.slice(0, 10).map((input, index) => ({
    id: input.inputId,
    filePath: input.filePath,
    role: index === 0 ? 'primary' as const : 'reference' as const,
    backendHint: 'remote' as const,
    status: 'open' as const,
    contextId: 'ctx-preview',
    sessionId: sessions[0].sessionId,
    replaySessionId: 'replay-preview',
  }));

  const currentRun = {
    runId: 'run-preview',
    projectId: projects[0].projectId,
    sessionId: sessions[0].sessionId,
    caseId: 'case-preview',
    mode: 'debugger' as const,
    goal: 'Validate workbench sidebar scrolling',
    captures,
    startedAt: now - 5_000,
    status: 'running' as const,
    lastStage: 'preflight',
    backend: 'remote' as const,
  };

  await page.evaluate(({ projects, sessions, projectInputs, captures, currentRun, now }) => {
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!hook) {
      throw new Error('Missing E2E state hook');
    }

    hook.seedWorkbenchState({
      projects,
      sessions,
      currentProject: projects[0],
      currentSession: sessions[0],
      currentRun,
      captures,
      projectInputs,
      timeline: [],
      runs: [currentRun],
      contextSnapshot: {
        contextId: 'ctx-preview',
        sessionId: sessions[0].sessionId,
        backend: 'remote',
        remoteStatus: 'online',
        runtimeOwner: 'rdc-agent-preview-owner',
        ownerLeaseId: 'lease-preview',
        captureDescriptors: captures,
        activeCapture: captures[0].id,
        deviceLabel: 'Android Preview Device',
      },
      openedCapture: {
        projectId: projects[0].projectId,
        inputId: projectInputs[0].inputId,
        filePath: projectInputs[0].filePath,
        captureId: captures[0].id,
        sessionId: sessions[0].sessionId,
        contextId: 'ctx-preview',
        replaySessionId: 'replay-preview',
        backend: 'remote',
        deviceId: 'device-preview',
        deviceLabel: 'Android Preview Device',
        status: 'open',
        openedAt: now,
        preview: {
          imagePath: 'C:/workspace/mock-preview.png',
          width: 1920,
          height: 1080,
          source: 'capture_thumbnail',
          updatedAt: now,
        },
      },
    });
  }, { projects, sessions, projectInputs, captures, currentRun, now });
};

const seedChatWorkbench = async (page: AppContext['page']) => {
  const now = Date.now();
  const project = {
    projectId: 'project-chat',
    name: 'HairSpark',
    rootPath: 'C:/workspace/hairspark',
    slug: 'hairspark',
    resourcePath: 'C:/workspace/hairspark/.resource',
    knowledgePath: 'C:/workspace/hairspark/.knowledge',
    inputsPath: 'C:/workspace/hairspark/.resource/inputs',
    inputs: [],
    inputsUpdatedAt: now,
    createdAt: now - 10_000,
    updatedAt: now,
    lastSessionId: 'session-chat',
  };

  const session = {
    sessionId: 'session-chat',
    projectId: project.projectId,
    title: 'HairSpark Scroll Debug',
    goal: 'Verify timeline scrolling',
    createdAt: now - 9_000,
    updatedAt: now,
    lastRunId: 'run-chat',
  };

  const currentRun = {
    runId: 'run-chat',
    projectId: project.projectId,
    sessionId: session.sessionId,
    caseId: 'case-chat',
    mode: 'debugger' as const,
    goal: 'Verify timeline scrolling',
    captures: [],
    startedAt: now - 8_000,
    status: 'running' as const,
    lastStage: 'investigation',
    backend: 'remote' as const,
  };

  const timeline = Array.from({ length: 40 }, (_, index) => ({
    id: `timeline-${index}`,
    type: index % 2 === 0 ? 'agent' as const : 'user' as const,
    agentRole: 'rdc-debugger' as const,
    content: `Timeline entry ${index} `.repeat(6),
    timestamp: now - (40 - index) * 1_000,
  }));

  await page.evaluate(({ project, session, currentRun, timeline }) => {
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
      currentRun,
      captures: [],
      projectInputs: [],
      openedCapture: null,
      contextSnapshot: null,
      timeline,
      runs: [currentRun],
    });
  }, { project, session, currentRun, timeline });
};

test.beforeEach(async () => {
  ctx = await launchApp();
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    mainWindow.setSize(1180, 420);
  });
  await ctx.page.waitForTimeout(300);
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('主壳层左栏和右栏支持独立滚轮滚动', async () => {
  const page = ctx.page;
  await seedPreviewWorkbench(page);

  const sidebar = page.locator('[data-testid="sidebar-scroll"]');
  await expect(sidebar).toBeVisible();
  await sidebar.hover();

  const sidebarScrollBefore = await getScrollTop('[data-testid="sidebar-scroll"]', page);
  await page.mouse.wheel(0, 1200);
  await expect.poll(async () => getScrollTop('[data-testid="sidebar-scroll"]', page)).toBeGreaterThan(sidebarScrollBefore);

  await page.locator('[data-testid="cp-section-contextInfo"] .cp-section-header').click();
  await page.waitForTimeout(400);

  const panelIsScrollable = await page.locator('[data-testid="control-panel-scroll"]').evaluate((element) => (
    element.scrollHeight > element.clientHeight
  ));
  expect(panelIsScrollable).toBe(true);

  const panelScrollBefore = await getScrollTop('[data-testid="control-panel-scroll"]', page);
  await page.locator('[data-testid="control-panel-scroll"]').hover({ position: { x: 24, y: 24 } });
  await page.mouse.wheel(0, 3200);
  await page.mouse.wheel(0, 3200);
  await page.mouse.wheel(0, 3200);

  await expect.poll(async () => getScrollTop('[data-testid="control-panel-scroll"]', page)).toBeGreaterThan(panelScrollBefore);
});

test('聊天态下中间消息区支持独立滚动且主输入栏保持可见', async () => {
  const page = ctx.page;
  await seedChatWorkbench(page);

  const chatMessages = page.locator('[data-testid="chat-messages"]');
  await expect(chatMessages).toBeVisible();
  await chatMessages.hover();

  const chatScrollBefore = await getScrollTop('[data-testid="chat-messages"]', page);
  await page.mouse.wheel(0, 1800);

  await expect.poll(async () => getScrollTop('[data-testid="chat-messages"]', page)).toBeGreaterThan(chatScrollBefore);
  await expect.poll(async () => isElementTopWithinContainer(
    '.app-main',
    '.main-input-bar',
    page,
  )).toBe(true);
});
