import { expect, test } from '@playwright/test';
import { AppContext, closeApp, launchApp } from './helpers/electron-app';

let ctx: AppContext;

test.beforeEach(async () => {
  ctx = await launchApp();
});

test.afterEach(async () => {
  await closeApp(ctx);
});

test('workflow public API exposes only DebuggerRuntime entrypoints', async () => {
  const shape = await ctx.page.evaluate(() => {
    const workflow = window.electronAPI.workflow as Record<string, unknown>;
    return {
      hasStart: typeof workflow.start === 'function',
      hasGetPlan: typeof workflow.getPlan === 'function',
      hasSubmitQuestions: typeof workflow.submitQuestions === 'function',
      hasApprovePlan: typeof workflow.approvePlan === 'function',
      hasRestartRun: typeof workflow.restartRun === 'function',
      hasStop: typeof workflow.stop === 'function',
      hasAdvanceStage: 'advanceStage' in workflow,
      hasBacktrack: 'backtrack' in workflow,
      hasDispatchSpecialist: 'dispatchSpecialist' in workflow,
    };
  });

  expect(shape).toEqual({
    hasStart: true,
    hasGetPlan: true,
    hasSubmitQuestions: true,
    hasApprovePlan: true,
    hasRestartRun: true,
    hasStop: true,
    hasAdvanceStage: false,
    hasBacktrack: false,
    hasDispatchSpecialist: false,
  });
});
