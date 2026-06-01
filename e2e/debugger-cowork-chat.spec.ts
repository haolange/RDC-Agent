import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { AppContext, closeApp, configureTestDebuggerRoutes, launchApp } from './helpers/electron-app';

let ctx: AppContext;

async function seedProject(page: AppContext['page'], projectRoot: string) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'Character_EyeSpark_Desktop.rdc'), 'fixture', 'utf8');

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }

    (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        seedWorkbenchState: (state: unknown) => void;
      };
    }).__RDC_AGENT_E2E__?.seedWorkbenchState({
      projects: [projectResult.project],
      sessions: [],
      currentProject: projectResult.project,
      currentSession: null,
      currentRun: null,
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
  }, projectRoot);
}

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('Ask 普通寒暄不会伪装成 Debugger，也不创建 run', async () => {
  const projectRoot = path.join(ctx.tempDir, 'cowork-greeting-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('textarea.chat-input').fill('你好');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('你好');
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).not.toContainText('RDC Debugger');
  await expect(ctx.page.locator('[data-testid="assistant-reasoning-toggle"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="assistant-reasoning-panel"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
  await expect.poll(async () => {
    return ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentRun: unknown | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun ?? null);
  }, { timeout: 10000 }).toBeNull();
});

test('配置好 route 后，通用技术问题会得到正常回答，而不是 intake 模板', async () => {
  const projectRoot = path.join(ctx.tempDir, 'cowork-knowledge-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('textarea.chat-input').fill('你知道什么是UE4吗?');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('Unreal Engine 4', { timeout: 20000 });
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).not.toContainText('你可以先告诉我你遇到了什么现象');
  await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toHaveCount(0);
});

test('Ask 发送后用户消息立即入流、assistant 不出现执行式 reasoning rail，且不会重复新增消息', async () => {
  const projectRoot = path.join(ctx.tempDir, 'cowork-stream-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('textarea.chat-input').fill('你好');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect.poll(async () => {
    return ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { conversationMessages: Array<{ role: string; content: string }> };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().conversationMessages.length ?? 0);
  }, { timeout: 5000 }).toBe(2);

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('你好');
  await expect(ctx.page.locator('[data-testid="aw-task-workstream"]')).toHaveCount(1);
  await expect(ctx.page.locator('[data-testid="aw-user-prompt"]')).toHaveCount(1);
  await expect(ctx.page.locator('[data-testid="aw-result-block"]')).toHaveCount(1, { timeout: 20000 });
  await expect(ctx.page.locator('[data-testid="assistant-reasoning-toggle"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="assistant-reasoning-panel"]')).toHaveCount(0);

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).not.toContainText('RDC Debugger');
  const resultBox = await ctx.page.locator('[data-testid="aw-result-block"]').first().boundingBox();
  expect(resultBox).not.toBeNull();
  await expect.poll(async () => ctx.page.locator('[data-testid="aw-result-block"]').first().evaluate((element) => {
    const text = element.textContent ?? '';
    return (text.match(/RDC Debugger/g) ?? []).length;
  })).toBe(0);
  await expect.poll(async () => {
    return ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { conversationMessages: Array<{ role: string; content: string }> };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().conversationMessages.length ?? 0);
  }, { timeout: 5000 }).toBe(2);

});

test('Cowork 模型请求失败时显示诊断，不伪装成本地兜底成功', async () => {
  const projectRoot = path.join(ctx.tempDir, 'cowork-failure-project');
  await seedProject(ctx.page, projectRoot);
  await configureTestDebuggerRoutes(ctx.page);

  await ctx.page.locator('textarea.chat-input').fill('你好 __RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__');
  await ctx.page.locator('[data-testid="debugger-start-button"]').click();

  await expect(ctx.page.locator('[data-testid="chat-messages"]')).toContainText('模型请求失败', { timeout: 20000 });
  await expect(ctx.page.locator('[data-testid="aw-result-block"]')).toContainText('CONVERSATION_LLM_REQUEST_FAILED', { timeout: 20000 });
  await expect(ctx.page.locator('[data-testid="aw-result-block"]')).toContainText('ollama/debugger-test-model');
  await expect(ctx.page.locator('[data-testid="agent-thinking-trace"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="agent-thinking-area"]')).toHaveCount(0);
  await expect(ctx.page.locator('[data-testid="chat-messages"]')).not.toContainText('已降级到本地兜底回复');

  await expect.poll(async () => ctx.page.evaluate(() => {
    const messages = (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => {
          conversationMessages: Array<{
            role: string;
            status?: string;
            diagnostic?: { code?: string; providerId?: string; modelId?: string } | null;
          }>;
        };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().conversationMessages ?? [];
    const assistant = messages.find((message) => message.role === 'assistant');
    return {
      status: assistant?.status,
      code: assistant?.diagnostic?.code,
      providerId: assistant?.diagnostic?.providerId,
      modelId: assistant?.diagnostic?.modelId,
    };
  }), { timeout: 5000 }).toEqual({
    status: 'error',
    code: 'CONVERSATION_LLM_REQUEST_FAILED',
    providerId: 'ollama',
    modelId: 'debugger-test-model',
  });
});
