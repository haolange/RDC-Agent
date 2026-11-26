import { app } from 'electron';

/** Browser QA is a debug-only surface: a packaged build never runs it, whatever the environment says. */
export function isBrowserQaRun(): boolean {
  return !app.isPackaged && process.env.RDC_AGENT_BROWSER_QA === '1';
}

/**
 * A Browser QA run whose operator explicitly granted full access. Only such a run lets a main-process confirmation
 * proceed without a focused window; a packaged build never is one.
 */
export function isBrowserQaFullAccessRun(): boolean {
  return isBrowserQaRun() && process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS === '1';
}
