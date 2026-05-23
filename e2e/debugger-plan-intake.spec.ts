import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, AppContext, configureTestDebuggerRoutes } from './helpers/electron-app';

let ctx: AppContext;

async function seedProject(
  page: AppContext['page'],
  projectRoot: string,
  captureNames = ['Character_EyeSpark_Desktop.rdc'],
) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.resource', 'knowledge'), { recursive: true });
  for (const captureName of captureNames) {
    fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', captureName), 'fixture', 'utf8');
  }

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }
    const sessionResult = await window.electronAPI.session.create(projectResult.project.projectId, 'Debugger Plan Session');
    if (!sessionResult.success || !sessionResult.session) {
      throw new Error(sessionResult.error || 'Failed to create session');
    }
    const sessions = await window.electronAPI.session.list(projectResult.project.projectId);
    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: sessions.sessions,
      currentProject: projectResult.project,
      currentSession: sessionResult.session,
      currentRun: null,
      contextSnapshot: null,
      captures: [],
      projectInputs: projectResult.project.inputs,
      openedCapture: null,
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
}

async function startDebuggerPlan(
  page: AppContext['page'],
  seeded: { projectId: string; sessionId: string },
  options: {
    goal: string;
    primaryCaptureId?: string;
  },
) {
  await page.evaluate(async ({ projectId, sessionId, goal, primaryCaptureId }) => {
    const hook = (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          projectInputs: Array<{ inputId: string; filePath: string }>;
        };
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__;
    const state = hook?.getWorkbenchState();
    const captures = (state?.projectInputs ?? []).map((input) => ({
      id: input.inputId,
      filePath: input.filePath,
      role: 'primary' as const,
      backendHint: 'local' as const,
      status: 'pending' as const,
    }));
    const started = await window.electronAPI.workflow.start({
      projectId,
      sessionId,
      mode: 'debugger',
      goal,
      captures,
      primaryCaptureId,
    });
    if (!started.success || !started.runId) {
      throw new Error(started.error || 'Failed to start debugger plan');
    }
    const runs = await window.electronAPI.run.list(sessionId);
    const workflow = await window.electronAPI.workflow.getState();
    const currentRun = runs.runs.find((run) => run.runId === started.runId) ?? null;
    hook?.seedWorkbenchState({
      ...(hook.getWorkbenchState() as Record<string, unknown>),
      currentRun,
      runs: runs.runs,
      workflowState: workflow,
    });
    return started;
  }, {
    projectId: seeded.projectId,
    sessionId: seeded.sessionId,
    goal: options.goal,
    primaryCaptureId: options.primaryCaptureId,
  });
}

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('Plan / Intake 展示单张可折叠计划卡，并在批准后进入 dispatch', async () => {
  const projectRoot = path.join(ctx.tempDir, 'plan-project');
  const seeded = await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);
  const firstInputId = await ctx.page.evaluate(() => (window as typeof window & {
    __RDC_AGENT_E2E__?: {
      getWorkbenchState: () => {
        projectInputs: Array<{ inputId: string }>;
      };
    };
  }).__RDC_AGENT_E2E__?.getWorkbenchState().projectInputs[0]?.inputId);

  await startDebuggerPlan(ctx.page, seeded, {
    goal: '需求：local 模式调试 Character_EyeSpark_Desktop.rdc。已知：Event ID 是 6152。目标：确认白色亮点根因，并验证 fix，最后给完整 report。',
    primaryCaptureId: firstInputId,
  });

  await expect(ctx.page.locator('.main-input-bar [data-testid="plan-intake-panel"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="chat-messages"] [data-testid="plan-intake-panel"]')).toBeVisible();
  await expect(ctx.page.locator('.plan-summary-grid')).toHaveCount(0);
  await expect(ctx.page.locator('.plan-document-card')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Character_EyeSpark_Desktop.rdc');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Event 6152');
  await expect(ctx.page.locator('[data-testid="plan-questions"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="plan-approve-button"]')).toBeEnabled();
  await expect(ctx.page.locator('[data-testid="task-board"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="phase-trace-plan"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="phase-trace-plan"]')).toContainText('Plan Phase');
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).not.toContainText('直接进入正式 Debugger');

  await expect(ctx.page.locator('.plan-document-card')).toHaveClass(/collapsed/);
  await ctx.page.locator('[data-testid="plan-collapse-toggle"]').click();
  await expect(ctx.page.locator('.plan-document-card')).toHaveClass(/expanded/);
  await ctx.page.locator('[data-testid="plan-collapse-toggle"]').click();
  await expect(ctx.page.locator('.plan-document-card')).toHaveClass(/collapsed/);

  await ctx.page.locator('[data-testid="plan-approve-button"]').click();
  await expect(ctx.page.locator('[data-testid="phase-trace-execution"]')).toBeVisible({ timeout: 10000 });
  await expect(ctx.page.locator('[data-testid="phase-trace-execution"]')).toContainText('Execution Phase');
  await expect(ctx.page.locator('[data-testid="task-board"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('调试报告已生成', { timeout: 15000 });
});

test('没有 Open capture 时，即使 prompt 写了 .rdc 路径也不会创建正式 run', async () => {
  const projectRoot = path.join(ctx.tempDir, 'plan-no-open-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('textarea.chat-input').fill('请正式调试 Character_EyeSpark_Desktop.rdc，Event ID 6152，定位根因并输出完整 report。');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('只能使用应用内已经 Open', { timeout: 10000 });
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);

  await expect.poll(async () => {
    return ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentRun: { status?: string } | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.status ?? null);
  }, { timeout: 10000 }).toBeNull();
});

test('AskUserQuestion 卡片要求先选择或填写，再提交进入待批准计划', async () => {
  const projectRoot = path.join(ctx.tempDir, 'plan-question-project');
  const seeded = await seedProject(ctx.page, projectRoot, [
    'Character_EyeSpark_Desktop.rdc',
    'Character_EyeSpark_Baseline.rdc',
  ]);
  await configureTestDebuggerRoutes(ctx.page);

  await startDebuggerPlan(ctx.page, seeded, {
    goal: '请正式调试多个 capture，确认这次主链目标并生成执行计划。',
  });

  await expect(ctx.page.locator('.main-input-bar [data-testid="ask-user-question-card"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="plan-submit-answers-button"]')).toBeDisabled();
  await expect(ctx.page.locator('.main-input-bar [data-testid="plan-intake-panel"]')).toHaveCount(0);

  const askTrace = ctx.page.locator('[data-testid="agent-timeline-tool-call"]').filter({ hasText: 'ui.ask_user_question' }).first();
  await expect(askTrace).toBeVisible();
  await expect(askTrace).toContainText('等待用户');

  const desktopOption = ctx.page.locator('[data-testid^="plan-option-target_capture-"]').filter({ hasText: 'Character_EyeSpark_Desktop.rdc' }).first();
  await desktopOption.click();
  await expect(ctx.page.locator('[data-testid="plan-submit-answers-button"]')).toBeEnabled();
  await ctx.page.locator('[data-testid="plan-submit-answers-button"]').click();

  await expect(ctx.page.locator('[data-testid="ask-user-question-card"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-timeline-tool-call"]').filter({ hasText: 'ui.ask_user_question' }).first()).toContainText('已回答');
  await expect(ctx.page.locator('[data-testid="plan-approve-button"]')).toBeEnabled();
  await expect(ctx.page.locator('.plan-document-card')).toContainText('Character_EyeSpark_Desktop.rdc');
});

test('终态 run 不会污染下一次正式 Debugger 任务', async () => {
  const projectRoot = path.join(ctx.tempDir, 'plan-rerun-project');
  const seeded = await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  const oldRunId = await ctx.page.evaluate(async ({ projectId, sessionId }) => {
    const state = (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          currentProject: { inputs: Array<{ inputId: string; filePath: string }> } | null;
        };
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState();
    const capture = state?.currentProject?.inputs[0];
    if (!capture) {
      throw new Error('Missing seeded capture');
    }

    const started = await window.electronAPI.workflow.start({
      projectId,
      sessionId,
      mode: 'debugger',
      goal: '旧的调试 run',
      captures: [{
        id: capture.inputId,
        filePath: capture.filePath,
        role: 'primary',
        backendHint: 'local',
        status: 'pending',
      }],
      primaryCaptureId: capture.inputId,
    });
    if (!started.success || !started.runId) {
      throw new Error(started.error || 'Failed to seed old run');
    }
    await window.electronAPI.workflow.stop(started.runId);
    const runs = await window.electronAPI.run.list(sessionId);
    const stoppedRun = runs.runs.find((run) => run.runId === started.runId);
    if (!stoppedRun || ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(stoppedRun.status)) {
      throw new Error('Seeded run did not reach a terminal state');
    }

    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => unknown;
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      ...(window as typeof window & {
        __RDC_AGENT_E2E__?: {
          getWorkbenchState: () => unknown;
        };
      }).__RDC_AGENT_E2E__?.getWorkbenchState(),
      currentRun: stoppedRun,
      runs: runs.runs,
      workflowState: null,
    });

    return started.runId;
  }, seeded);

  const firstInputId = await ctx.page.evaluate(() => (window as typeof window & {
    __RDC_AGENT_E2E__?: {
      getWorkbenchState: () => {
        projectInputs: Array<{ inputId: string }>;
      };
    };
  }).__RDC_AGENT_E2E__?.getWorkbenchState().projectInputs[0]?.inputId);

  await startDebuggerPlan(ctx.page, seeded, {
    goal: '请重新正式调试 Character_EyeSpark_Desktop.rdc，Event ID 6152，定位根因并输出完整 report。',
    primaryCaptureId: firstInputId,
  });

  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toBeVisible();
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Character_EyeSpark_Desktop.rdc');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Event 6152');

  await expect.poll(async () => ctx.page.evaluate((terminalRunId) => {
    const state = (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          currentRun: { runId?: string } | null;
          conversationMessages: Array<{ runId?: string | null }>;
        };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState();
    const newMessages = state?.conversationMessages.slice(-2) ?? [];
    return {
      currentRunChanged: Boolean(state?.currentRun?.runId && state.currentRun.runId !== terminalRunId),
      inheritedOldRun: newMessages.some((message) => message.runId === terminalRunId),
    };
  }, oldRunId), { timeout: 10000 }).toEqual({
    currentRunChanged: true,
    inheritedOldRun: false,
  });
});
