import fs from 'fs';
import path from 'path';
import { test, expect, type Page } from '@playwright/test';
import { launchApp, closeApp, AppContext } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

interface PersistedSessionSeed {
  projectId: string;
  projectName: string;
  sessions: Array<{
    sessionId: string;
    title: string;
  }>;
}

const createPersistedWorkbench = async (
  page: Page,
  projectRoot: string,
  sessionTitles: string[],
): Promise<PersistedSessionSeed> => {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.resource', 'knowledge'), { recursive: true });

  const seeded = await page.evaluate(async ({ rootPath, titles }) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    const sessions: Array<{ sessionId: string; title: string }> = [];
    for (const title of titles) {
      const result = await window.electronAPI.session.create(projectResult.project.projectId, title);
      if (!result.success || !result.session) {
        throw new Error(result.error || `Failed to create session: ${title}`);
      }
      sessions.push({
        sessionId: result.session.sessionId,
        title: result.session.title,
      });
    }

    const projectsResult = await window.electronAPI.project.list();
    const project = projectsResult.projects.find((entry) => entry.projectId === projectResult.project?.projectId)
      ?? projectResult.project;
    const sessionsResult = await window.electronAPI.session.list(project.projectId);
    const currentSession = sessionsResult.sessions.find((session) => session.sessionId === sessions[sessions.length - 1].sessionId)
      ?? sessionsResult.sessions[0]
      ?? null;
    const hook = (window as Window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: Record<string, unknown>) => void;
      };
    }).__RDC_AGENT_E2E__;

    if (!hook || !currentSession) {
      throw new Error('Missing E2E hook or current session');
    }

    hook.seedWorkbenchState({
      projects: [project],
      sessions: sessionsResult.sessions,
      currentProject: project,
      currentSession,
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
      projectId: projectResult.project.projectId,
      projectName: project.name,
      sessions,
    };
  }, { rootPath: projectRoot, titles: sessionTitles });

  await expect(page.locator('.project-item-title', { hasText: seeded.projectName })).toBeVisible();
  await expect(page.locator('.session-subitem', { hasText: seeded.sessions[seeded.sessions.length - 1].title })).toBeVisible();
  await page.waitForFunction((sessionId) => {
    const state = (window as Window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          currentSession: { sessionId: string } | null;
          rightRailTarget?: string;
        };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState();
    return state?.currentSession?.sessionId === sessionId && state.rightRailTarget === 'session';
  }, seeded.sessions[seeded.sessions.length - 1].sessionId, { timeout: 10000 });
  return seeded;
};

const getWorkbenchSelection = async (page: Page) => page.evaluate(() => {
  const state = (window as Window & {
    __RDC_AGENT_E2E__?: {
      getWorkbenchState: () => {
        currentSession: { sessionId: string } | null;
        rightRailTarget?: string;
      };
    };
  }).__RDC_AGENT_E2E__?.getWorkbenchState();

  return {
    currentSessionId: state?.currentSession?.sessionId ?? null,
    rightRailTarget: state?.rightRailTarget ?? null,
  };
});

const waitForActiveSession = async (page: Page, title: string | null) => {
  await page.waitForFunction((targetTitle) => {
    const activeTexts = Array.from(document.querySelectorAll('.session-subitem.active'))
      .map((element) => element.textContent ?? '');
    return targetTitle === null
      ? activeTexts.length === 0
      : activeTexts.length === 1 && activeTexts[0].includes(targetTitle);
  }, title, { timeout: 10000 });
};

const waitForProjectActiveCount = async (page: Page, count: number) => {
  await page.waitForFunction((expectedCount) => (
    document.querySelectorAll('.project-item.active').length === expectedCount
  ), count, { timeout: 10000 });
};

const waitForRailSections = async (
  page: Page,
  expected: { captureLibrary: boolean; sessionContext: boolean },
) => {
  await page.waitForFunction(({ captureLibrary, sessionContext }) => (
    Boolean(document.querySelector('[data-testid="cp-section-captureLibrary"]')) === captureLibrary
    && Boolean(document.querySelector('[data-testid="cp-section-sessionContext"]')) === sessionContext
  ), expected, { timeout: 10000 });
};

const waitForSessionList = async (
  page: Page,
  expected: { includes?: string[]; excludes?: string[]; empty?: boolean },
) => {
  await page.waitForFunction(({ includes = [], excludes = [], empty = false }) => {
    const copy = Array.from(document.querySelectorAll('.session-subitem'))
      .map((element) => element.textContent ?? '')
      .join('\n');
    return (!empty || copy.length === 0)
      && includes.every((title) => copy.includes(title))
      && excludes.every((title) => !copy.includes(title));
  }, expected, { timeout: 10000 });
};

const clickSessionByTitle = async (page: Page, title: string) => {
  await page.evaluate((targetTitle) => {
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('.session-subitem'))
      .find((element) => element.textContent?.includes(targetTitle));
    if (!item) {
      throw new Error(`Session item not found: ${targetTitle}`);
    }
    item.click();
  }, title);
};

const clickSessionRemove = async (page: Page, title: string) => {
  await page.evaluate((targetTitle) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('.session-subitem'))
      .find((element) => element.textContent?.includes(targetTitle));
    const button = item?.querySelector<HTMLElement>('.session-item-icon-button.danger');
    if (!button) {
      throw new Error(`Session remove button not found: ${targetTitle}`);
    }
    button.click();
  }, title);
};

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

test('real IPC session click switches active highlight and session rail', async () => {
  const page = ctx.page;
  const seeded = await createPersistedWorkbench(page, path.join(ctx.tempDir, 'real-ipc-session-click'), [
    'Beta Session',
    'Alpha Session',
  ]);
  const beta = seeded.sessions[0];
  const alpha = seeded.sessions[1];

  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await waitForActiveSession(page, alpha.title);
  await waitForProjectActiveCount(page, 0);
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });

  await clickSessionByTitle(page, beta.title);

  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: beta.sessionId,
    rightRailTarget: 'session',
  });
  await waitForActiveSession(page, beta.title);
  await waitForProjectActiveCount(page, 0);
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });
});

test('real IPC project click switches rail without clearing active session', async () => {
  const page = ctx.page;
  const seeded = await createPersistedWorkbench(page, path.join(ctx.tempDir, 'real-ipc-project-click'), [
    'Beta Session',
    'Alpha Session',
  ]);
  const alpha = seeded.sessions[1];

  await expect(page.locator('[data-testid="cp-section-sessionContext"]')).toBeVisible();
  await waitForActiveSession(page, alpha.title);

  await page.locator('.project-item').first().click();

  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: alpha.sessionId,
    rightRailTarget: 'project',
  });
  await waitForActiveSession(page, null);
  await waitForProjectActiveCount(page, 1);
  await waitForRailSections(page, { captureLibrary: true, sessionContext: false });

  await clickSessionByTitle(page, alpha.title);

  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: alpha.sessionId,
    rightRailTarget: 'session',
  });
  await waitForActiveSession(page, alpha.title);
  await waitForProjectActiveCount(page, 0);
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });
});

test('real IPC removing active session selects remaining session', async () => {
  const page = ctx.page;
  const seeded = await createPersistedWorkbench(page, path.join(ctx.tempDir, 'real-ipc-remove-active'), [
    'Beta Session',
    'Alpha Session',
  ]);
  const beta = seeded.sessions[0];
  const alpha = seeded.sessions[1];

  await clickSessionRemove(page, alpha.title);

  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: beta.sessionId,
    rightRailTarget: 'session',
  });
  await waitForSessionList(page, { includes: [beta.title], excludes: [alpha.title] });
  await waitForActiveSession(page, beta.title);
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });
});

test('real IPC removing last active session returns to project rail', async () => {
  const page = ctx.page;
  const seeded = await createPersistedWorkbench(page, path.join(ctx.tempDir, 'real-ipc-remove-last'), [
    'Only Session',
  ]);
  const only = seeded.sessions[0];

  await clickSessionRemove(page, only.title);

  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: null,
    rightRailTarget: 'project',
  });
  await waitForSessionList(page, { empty: true });
  await waitForActiveSession(page, null);
  await waitForRailSections(page, { captureLibrary: true, sessionContext: false });
});

test('real IPC removing inactive session preserves current session and rail target', async () => {
  const page = ctx.page;
  const seeded = await createPersistedWorkbench(page, path.join(ctx.tempDir, 'real-ipc-remove-inactive'), [
    'Gamma Session',
    'Beta Session',
    'Alpha Session',
  ]);
  const beta = seeded.sessions[1];
  const alpha = seeded.sessions[2];

  await clickSessionRemove(page, beta.title);

  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: alpha.sessionId,
    rightRailTarget: 'session',
  });
  await waitForSessionList(page, { includes: [alpha.title, 'Gamma Session'], excludes: [beta.title] });
  await waitForActiveSession(page, alpha.title);
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });
});

test('session remove failure keeps list intact and shows an error', async () => {
  const page = ctx.page;
  const seeded = await createPersistedWorkbench(page, path.join(ctx.tempDir, 'real-ipc-remove-failure'), [
    'Only Session',
  ]);
  const only = seeded.sessions[0];

  await page.evaluate(async (sessionId) => {
    await window.electronAPI.session.remove(sessionId);
  }, only.sessionId);

  await clickSessionRemove(page, only.title);

  await expect(page.getByRole('alert')).toContainText('Session not found');
  await expect.poll(async () => getWorkbenchSelection(page)).toEqual({
    currentSessionId: only.sessionId,
    rightRailTarget: 'session',
  });
  await waitForSessionList(page, { includes: [only.title] });
  await waitForActiveSession(page, only.title);
});

const stubProjectAndCaptureDialogs = async (
  app: AppContext['app'],
  projectRoot: string,
  capturePath: string,
) => {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showOpenDialog = async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as { properties?: string[] } | undefined;
      const properties = options?.properties ?? [];
      if (properties.includes('openDirectory')) {
        return { canceled: false, filePaths: [payload.projectRoot] };
      }
      return { canceled: false, filePaths: [payload.capturePath] };
    };
  }, { projectRoot, capturePath });
};

const openProjectMenu = async (page: Page, projectName: string) => {
  const projectItem = page.locator('.project-item', { hasText: projectName }).first();
  await projectItem.hover();
  await projectItem.locator('.session-item-icon-button').first().click();
};

const createSessionFromProjectMenu = async (page: Page, projectName: string) => {
  await openProjectMenu(page, projectName);
  await page.getByRole('button', { name: /新建会话|New Session/ }).click();
};

test('real UI sidebar project and session lifecycle has stable rails and no browser errors', async () => {
  const page = ctx.page;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const projectRoot = path.join(ctx.tempDir, 'real-ui-sidebar-project');
  const capturePath = path.join(ctx.tempDir, 'fixture-capture.rdc');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(capturePath, 'RDC fixture', 'utf-8');
  await stubProjectAndCaptureDialogs(ctx.app, projectRoot, capturePath);

  await page.getByTitle(/添加项目|Add Project/).click();
  await expect(page.locator('.project-item-title', { hasText: 'real-ui-sidebar-project' })).toBeVisible();
  await waitForRailSections(page, { captureLibrary: true, sessionContext: false });
  await expect(page.getByTestId('capture-library-toolbar')).toBeVisible();

  await page.getByTestId('capture-library-import').click();
  await expect(page.locator('.capture-library-item-name', { hasText: 'fixture-capture.rdc' })).toBeVisible();

  await createSessionFromProjectMenu(page, 'real-ui-sidebar-project');
  await createSessionFromProjectMenu(page, 'real-ui-sidebar-project');
  await createSessionFromProjectMenu(page, 'real-ui-sidebar-project');
  await waitForSessionList(page, { includes: ['new session 0', 'new session 1', 'new session 2'] });
  await waitForActiveSession(page, 'new session 2');
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });

  await page.locator('.project-item', { hasText: 'real-ui-sidebar-project' }).first().click();
  await waitForProjectActiveCount(page, 1);
  await waitForActiveSession(page, null);
  await waitForRailSections(page, { captureLibrary: true, sessionContext: false });
  await expect(page.locator('.capture-library-item-name', { hasText: 'fixture-capture.rdc' })).toBeVisible();

  await clickSessionByTitle(page, 'new session 1');
  await waitForActiveSession(page, 'new session 1');
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });

  await clickSessionByTitle(page, 'new session 2');
  await waitForActiveSession(page, 'new session 2');
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });

  await clickSessionRemove(page, 'new session 0');
  await expect(page.locator('.session-subitem')).toHaveCount(2);
  await waitForActiveSession(page, 'new session 1');

  await clickSessionRemove(page, 'new session 1');
  await expect(page.locator('.session-subitem')).toHaveCount(1);
  await waitForActiveSession(page, 'new session 0');
  await waitForRailSections(page, { captureLibrary: false, sessionContext: true });

  await clickSessionRemove(page, 'new session 0');
  await waitForSessionList(page, { empty: true });
  await waitForActiveSession(page, null);
  await waitForProjectActiveCount(page, 1);
  await waitForRailSections(page, { captureLibrary: true, sessionContext: false });
  await expect(page.locator('.capture-library-item-name', { hasText: 'fixture-capture.rdc' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect([...consoleErrors, ...pageErrors]).toEqual([]);
});
