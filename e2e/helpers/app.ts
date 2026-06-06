import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface SmokeAppContext {
  app: ElectronApplication;
  page: Page;
  bridgeUrl: string;
  tempDir: string;
  userDataDir: string;
  workspaceDir: string;
}

export async function launchSmokeApp(): Promise<SmokeAppContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-smoke-'));
  const userDataDir = path.join(tempDir, 'userData');
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RDC_AGENT_TEST_MODE: '1',
      RDC_AGENT_USER_DATA: userDataDir,
      RDC_AGENT_WORKSPACE: workspaceDir,
      RDC_AGENT_BROWSER_BRIDGE_PORT: '0',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });

  const bridgeUrl = await waitForBridgeUrl(app);
  return {
    app,
    page,
    bridgeUrl,
    tempDir,
    userDataDir,
    workspaceDir,
  };
}

export async function closeSmokeApp(context: SmokeAppContext): Promise<void> {
  await context.app.evaluate(({ app }) => {
    app.quit();
    setTimeout(() => app.exit(0), 100).unref?.();
  }).catch(() => undefined);
  await context.app.close().catch(() => undefined);
  fs.rmSync(context.tempDir, { recursive: true, force: true });
}

async function waitForBridgeUrl(app: ElectronApplication): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const bridgeUrl = await app.evaluate(() => (
      globalThis as typeof globalThis & { __RDC_AGENT_BROWSER_BRIDGE_URL__?: string }
    ).__RDC_AGENT_BROWSER_BRIDGE_URL__ ?? null);
    if (bridgeUrl) {
      return bridgeUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser app bridge URL was not published by main process');
}
