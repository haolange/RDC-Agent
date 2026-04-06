import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from './helpers/electron-app';

const LIVE_PROJECT_ROOT = 'D:\\Utility\\DebugTest\\custom';
const LIVE_TASK_PATH = 'C:\\Users\\a1824\\Desktop\\TestTask.txt';

test.describe('live debugger mainchain', () => {
  test.skip(process.env.RDC_AGENT_LIVE_E2E !== '1', 'Live acceptance only');
  test.setTimeout(600000);

  test('真实本地主链会产出三份报告并写入关键 action events', async () => {
    if (!fs.existsSync(LIVE_PROJECT_ROOT)) {
      test.skip(true, `Missing live project root: ${LIVE_PROJECT_ROOT}`);
    }
    if (!fs.existsSync(LIVE_TASK_PATH)) {
      test.skip(true, `Missing live task file: ${LIVE_TASK_PATH}`);
    }

    const ctx = await launchApp({ testMode: false, cleanupOnClose: false });
    try {
      const seeded = await ctx.page.evaluate(async (projectRoot) => {
        const project = (await window.electronAPI.project.list()).projects.find((entry) => entry.rootPath === projectRoot);
        if (!project) {
          throw new Error(`Project not found: ${projectRoot}`);
        }
        const created = await window.electronAPI.session.create(project.projectId, 'Live Debugger Session');
        if (!created.success || !created.session) {
          throw new Error(created.error || 'Failed to create session');
        }
        const sessions = await window.electronAPI.session.list(project.projectId);
        (window as typeof window & {
          __RDC_AGENT_E2E__?: {
            seedWorkbenchState: (state: unknown) => void;
          };
        }).__RDC_AGENT_E2E__?.seedWorkbenchState({
          projects: [project],
          sessions: sessions.sessions,
          currentProject: project,
          currentSession: created.session,
          currentRun: null,
          contextSnapshot: null,
          captures: [],
          projectInputs: project.inputs,
          openedCapture: null,
          timeline: [],
          actionEvents: [],
          workflowState: null,
          runs: [],
        });
        return {
          sessionId: created.session.sessionId,
        };
      }, LIVE_PROJECT_ROOT);

      await ctx.page.locator('input.chat-input').fill(LIVE_TASK_PATH);
      await ctx.page.locator('[data-testid="debugger-start-button"]').click();
      await expect(ctx.page.locator('[data-testid="plan-intake-panel"]')).toContainText('Character_EyeSpark_Desktop.rdc', { timeout: 180000 });
      await expect(ctx.page.locator('[data-testid="plan-approve-button"]')).toBeEnabled({ timeout: 60000 });
      await ctx.page.locator('[data-testid="plan-approve-button"]').click();

      await expect.poll(async () => {
        return ctx.page.evaluate(() => (window as typeof window & {
          __RDC_AGENT_E2E__?: {
            getWorkbenchState: () => { currentRun: { status?: string } | null };
          };
        }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.status ?? null);
      }, { timeout: 360000 }).toBe('completed');

      const runId = await ctx.page.evaluate(() => (window as typeof window & {
        __RDC_AGENT_E2E__?: {
          getWorkbenchState: () => { currentRun: { runId?: string } | null };
        };
      }).__RDC_AGENT_E2E__?.getWorkbenchState().currentRun?.runId ?? null);

      const reportDir = path.join(LIVE_PROJECT_ROOT, 'sessions', seeded.sessionId, 'runs', String(runId), 'reports');
      expect(fs.existsSync(path.join(reportDir, 'report.md'))).toBe(true);
      expect(fs.existsSync(path.join(reportDir, 'report.json'))).toBe(true);
      expect(fs.existsSync(path.join(reportDir, 'visual_report.html'))).toBe(true);

      const actionChain = fs.readFileSync(path.join(LIVE_PROJECT_ROOT, 'sessions', seeded.sessionId, 'action_chain.jsonl'), 'utf8');
      const reportJson = JSON.parse(fs.readFileSync(path.join(reportDir, 'report.json'), 'utf8')) as {
        llmExecution?: {
          providerId: string;
          modelId: string;
          successfulCallCount: number;
          firstRequestId?: string;
        } | null;
      };
      expect(actionChain).toContain('"event_type":"dispatch"');
      expect(actionChain).toContain('"event_type":"llm_call"');
      expect(actionChain).toContain('"providerId":"custom.b61a538b-100b-475c-8830-ca4a87db5c76"');
      expect(actionChain).toContain('"modelId":"moonshotai/kimi-k2.5"');
      expect(actionChain).toContain('"event_type":"tool_execution"');
      expect(actionChain).toContain('"event_type":"verification"');
      expect(actionChain).toContain('"event_type":"report_published"');
      expect(reportJson.llmExecution?.providerId).toBe('custom.b61a538b-100b-475c-8830-ca4a87db5c76');
      expect(reportJson.llmExecution?.modelId).toBe('moonshotai/kimi-k2.5');
      expect(reportJson.llmExecution?.successfulCallCount ?? 0).toBeGreaterThan(0);
      expect(reportJson.llmExecution?.firstRequestId).toBeTruthy();
    } finally {
      await closeApp(ctx, { cleanup: true });
    }
  });
});
