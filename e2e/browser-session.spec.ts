import { expect, test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { closeSmokeApp, launchHeadlessSmokeApp } from './helpers/app';

const DEFAULT_SEEDED_PROVIDER_IDS = ['deepseek', 'openrouter', 'xai', 'google-ai-studio', 'kimi-code'];

test('browser app session uses real main runtime bridge', async ({ page, request }) => {
  const context = await launchHeadlessSmokeApp();
  try {
    expect(context.app.windows()).toHaveLength(0);

    const consoleMessages: string[] = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        consoleMessages.push(message.text());
      }
    });

    const health = await request.get(`${context.bridgeUrl}/health`);
    expect(health.ok()).toBe(true);
    await expect(await health.json()).toMatchObject({
      ok: true,
      mode: 'browser-app-session',
    });

    await page.goto(`${context.bridgeUrl}/app`);
    await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });
    await expect(page.getByTestId('app-sidebar-left')).toBeVisible();
    await expect(page.getByRole('heading', { name: '先 Ask，Open Capture 后再执行' })).toBeVisible();
    await expect(page.locator('[data-testid^="empty-workbench-tool-"]')).toHaveCount(4);
    await expect(page.getByTestId('composer-footer-bar')).toBeVisible();
    await expect(page.getByPlaceholder('向 Ask 描述问题、目标或需要打开的 .rdc Capture')).toBeVisible();
    await expect(page.getByTestId('terminal-toggle')).toBeVisible();

    const result = await page.evaluate(async (projectRoot) => {
      const meta = await window.electronAPI.appMeta.get();
      const settings = await window.electronAPI.settings.get();
      const maximized = await window.electronAPI.windowControls.isMaximized();
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
        maximized,
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
    expect(result.maximized).toBe(false);
    expect(result.projectCountAfter).toBeGreaterThanOrEqual(result.projectCountBefore);
    expect(result.sessionCount).toBeGreaterThanOrEqual(1);
    expect(result.inputEventSeen).toBe(true);
    expect(result.toolNamespacesIsArray).toBe(true);
    expect((await page.context().pages()).length).toBeGreaterThanOrEqual(1);
    expect(context.app.windows()).toHaveLength(0);

    const fetchFailures = await page.evaluate(() => {
      const entries = performance.getEntriesByType('resource');
      return entries.filter((entry) => entry.name.includes('/invoke') && entry.duration === 0).length;
    });
    expect(fetchFailures).toBe(0);
    expect(consoleMessages.filter((message) => message.includes('Failed to fetch'))).toHaveLength(0);
  } finally {
    await closeSmokeApp(context);
  }
});

test('default provider seeds repair existing unconfigured catalog settings', async ({ page }) => {
  const context = await launchHeadlessSmokeApp({
    prepareWorkspace: ({ workspaceDir }) => {
      fs.writeFileSync(path.join(workspaceDir, 'settings.json'), JSON.stringify({
        appearance: {
          theme: 'dark',
          language: 'zh-CN',
          fontScale: 'medium',
        },
        workspace: {
          rootPath: workspaceDir,
        },
        llm: {
          providers: DEFAULT_SEEDED_PROVIDER_IDS.map((id) => ({
            id,
            apiKey: '',
            models: [],
            status: 'unconfigured',
            isConfigured: false,
          })),
          agentRoutes: [
            { agentId: 'ask_agent', providerId: '', modelId: '' },
            { agentId: 'rdc-debugger', providerId: 'openrouter', modelId: 'missing-model' },
          ],
        },
      }, null, 2), 'utf8');
    },
  });

  try {
    await page.goto(`${context.bridgeUrl}/app`);
    await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });

    const settingsState = await page.evaluate(async (providerIds) => {
      const settings = await window.electronAPI.settings.get();
      return {
        providers: providerIds.map((id) => {
          const provider = settings.llm.providers.find((entry) => entry.id === id);
          return provider
            ? {
              id: provider.id,
              apiKey: provider.apiKey,
              hasStoredSecret: provider.hasStoredSecret,
              isConfigured: provider.isConfigured,
              modelIds: provider.models.map((model) => model.id),
              status: provider.status,
            }
            : null;
        }),
        routes: settings.llm.agentRoutes.filter((route) => (
          route.agentId === 'ask_agent' || route.agentId === 'rdc-debugger'
        )),
      };
    }, DEFAULT_SEEDED_PROVIDER_IDS);

    expect(settingsState.providers).toEqual(expect.arrayContaining(
      DEFAULT_SEEDED_PROVIDER_IDS.map((id) => expect.objectContaining({
        id,
        apiKey: '',
        hasStoredSecret: true,
        isConfigured: true,
        status: 'verified',
      })),
    ));
    expect(settingsState.providers.every((provider) => provider && provider.modelIds.length > 0)).toBe(true);
    expect(settingsState.routes).toEqual(expect.arrayContaining([
      { agentId: 'ask_agent', providerId: 'deepseek', modelId: 'deepseek-chat' },
      { agentId: 'rdc-debugger', providerId: 'deepseek', modelId: 'deepseek-chat' },
    ]));
  } finally {
    await closeSmokeApp(context);
  }
});

test('Ask mode shows readonly tool trace and denies mutation tools', async ({ page }) => {
  const context = await launchHeadlessSmokeApp();
  const deniedPath = path.join(context.workspaceDir, 'should-not-exist.txt');

  try {
    await page.goto(`${context.bridgeUrl}/app`);
    await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });

    const setup = await page.evaluate(async (projectRoot) => {
      const addedProject = await window.electronAPI.project.add(projectRoot);
      if (!addedProject.success || !addedProject.project) {
        throw new Error(addedProject.error || 'project.add failed');
      }
      const createdSession = await window.electronAPI.session.create(
        addedProject.project.projectId,
        'Ask Readonly Tool Trace Smoke',
      );
      if (!createdSession.success || !createdSession.session) {
        throw new Error(createdSession.error || 'session.create failed');
      }
      await window.electronAPI.project.select(addedProject.project.projectId);
      await window.electronAPI.session.select(createdSession.session.sessionId);
      return {
        projectId: addedProject.project.projectId,
        sessionId: createdSession.session.sessionId,
      };
    }, context.workspaceDir);

    await page.evaluate(() => {
      const target = window as Window & {
        __askReadonlyEvents?: Array<import('../src/shared/types/conversation').ConversationStreamEvent>;
      };
      target.__askReadonlyEvents = [];
      window.electronAPI.conversation.onEvent((event) => {
        target.__askReadonlyEvents?.push(event);
      });
    });

    const readonlyTurn = await page.evaluate(async ({ projectId, sessionId }) => (
      window.electronAPI.conversation.sendMessage({
        projectId,
        sessionId,
        currentRunId: null,
        replayDeviceId: null,
        mode: 'ask',
        message: '__RDC_AGENT_E2E_ASK_READONLY_TOOL__ search ConversationService',
        attachments: [],
      })
    ), setup);

    await expect.poll(async () => page.evaluate((turnId) => {
      const events = ((window as Window & {
        __askReadonlyEvents?: Array<import('../src/shared/types/conversation').ConversationStreamEvent>;
      }).__askReadonlyEvents ?? []);
      return events.some((event) => (
        event.type === 'agent_event'
        && event.turnId === turnId
        && event.event.type === 'tool.completed'
        && event.event.payload.toolName === 'grep'
      ));
    }, readonlyTurn.userMessage.turnId), { timeout: 10000 }).toBe(true);

    const deniedTurn = await page.evaluate(async ({ projectId, sessionId }) => (
      window.electronAPI.conversation.sendMessage({
        projectId,
        sessionId,
        currentRunId: null,
        replayDeviceId: null,
        mode: 'ask',
        message: '__RDC_AGENT_E2E_ASK_DENY_WRITE__ create a file',
        attachments: [],
      })
    ), setup);

    await expect.poll(async () => page.evaluate((turnId) => {
      const events = ((window as Window & {
        __askReadonlyEvents?: Array<import('../src/shared/types/conversation').ConversationStreamEvent>;
      }).__askReadonlyEvents ?? []);
      const event = events.find((entry) => (
        entry.type === 'agent_event'
        && entry.turnId === turnId
        && entry.event.type === 'tool.denied'
        && entry.event.payload.toolName === 'write_file'
      ));
      return event?.type === 'agent_event'
        ? {
          toolName: event.event.payload.toolName,
          reason: event.event.payload.reason,
        }
        : {
          toolName: '',
          reason: '',
        };
    }, deniedTurn.userMessage.turnId), { timeout: 10000 }).toMatchObject({
      toolName: 'write_file',
      reason: expect.stringContaining('Policy denied'),
    });
    expect(fs.existsSync(deniedPath)).toBe(false);
  } finally {
    await closeSmokeApp(context);
  }
});
