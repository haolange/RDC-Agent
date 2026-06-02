import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  launchApp,
  closeApp,
  configureTestDebuggerRoutes,
  startDebuggerPlanFromFirstInput,
  type AppContext,
} from './helpers/electron-app';

async function seedProject(page: AppContext['page'], projectRoot: string) {
  fs.mkdirSync(path.join(projectRoot, '.resource', 'inputs'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, '.resource', 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.resource', 'inputs', 'Character_EyeSpark_Desktop.rdc'), 'fixture', 'utf8');

  return page.evaluate(async (rootPath) => {
    const projectResult = await window.electronAPI.project.add(rootPath);
    if (!projectResult.success || !projectResult.project) {
      throw new Error(projectResult.error || 'Failed to create project');
    }
    const sessionResult = await window.electronAPI.session.create(projectResult.project.projectId, 'Report Session');
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
    return sessionResult.session.sessionId;
  }, projectRoot);
}

test('report 发布会真实写入 reports 目录，并且 action_chain 包含关键事件', async () => {
  const ctx = await launchApp();
  try {
    const projectRoot = path.join(ctx.tempDir, 'report-project');
    const sessionId = await seedProject(ctx.page, projectRoot);
    await configureTestDebuggerRoutes(ctx.page);

    await startDebuggerPlanFromFirstInput(
      ctx.page,
      '调试 Character_EyeSpark_Desktop.rdc，Event ID 6152，并生成 report',
    );
    await expect(ctx.page.locator('[data-testid="plan-approve-button"]')).toBeEnabled();
    await ctx.page.locator('[data-testid="plan-approve-button"]').click();

    await expect.poll(async () => {
      return ctx.page.evaluate(() => (window as typeof window & {
        __RDC_AGENT_E2E__?: {
          getWorkbenchState: () => { currentRun: { status?: string } | null };
        };
      }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.status ?? null);
    }, { timeout: 15000 }).toBe('completed');

    const runId = await ctx.page.evaluate(() => (window as typeof window & {
      __RDC_AGENT_E2E__?: {
        getWorkbenchState: () => { currentRun: { runId?: string } | null };
      };
    }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.runId ?? null);

    const reportDir = path.join(projectRoot, 'sessions', sessionId, 'runs', runId, 'reports');
    const markdownPath = path.join(reportDir, 'report.md');
    const jsonPath = path.join(reportDir, 'report.json');
    const htmlPath = path.join(reportDir, 'visual_report.html');

    await expect.poll(() => fs.existsSync(markdownPath), { timeout: 15000 }).toBe(true);
    await expect.poll(() => fs.existsSync(jsonPath), { timeout: 15000 }).toBe(true);
    await expect.poll(() => fs.existsSync(htmlPath), { timeout: 15000 }).toBe(true);

    const actionChainPath = path.join(projectRoot, 'sessions', sessionId, 'action_chain.jsonl');
    const actionChain = fs.readFileSync(actionChainPath, 'utf8');
    const reportJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      llmExecution?: {
        providerId: string;
        modelId: string;
        successfulCallCount: number;
      } | null;
    };
    expect(actionChain).toContain('"event_type":"dispatch"');
    expect(actionChain).toContain('"event_type":"llm_call"');
    expect(actionChain).toContain('"event_type":"tool_execution"');
    expect(actionChain).toContain('"event_type":"verification"');
    expect(actionChain).toContain('"event_type":"report_published"');
    expect(reportJson.llmExecution?.providerId).toBe('ollama');
    expect(reportJson.llmExecution?.modelId).toBe('debugger-test-model');
    expect(reportJson.llmExecution?.successfulCallCount ?? 0).toBeGreaterThan(0);
    expect(fs.readFileSync(markdownPath, 'utf8')).toContain('## LLM Execution');
  } finally {
    await closeApp(ctx);
  }
});
