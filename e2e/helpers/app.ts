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

export interface HeadlessSmokeAppContext {
  app: ElectronApplication;
  bridgeUrl: string;
  tempDir: string;
  userDataDir: string;
  workspaceDir: string;
}

export async function launchSmokeApp(): Promise<SmokeAppContext> {
  const paths = createSmokePaths();

  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RDC_AGENT_TEST_MODE: '1',
      RDC_AGENT_USER_DATA: paths.userDataDir,
      RDC_AGENT_WORKSPACE: paths.workspaceDir,
      RDC_AGENT_BROWSER_BRIDGE_PORT: '0',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.app-titlebar').waitFor({ state: 'visible', timeout: 15000 });

  const bridgeUrl = await waitForBridgeUrlFromMain(app);
  return {
    app,
    page,
    bridgeUrl,
    ...paths,
  };
}

export async function launchHeadlessSmokeApp(): Promise<HeadlessSmokeAppContext> {
  const paths = createSmokePaths();

  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      RDC_AGENT_HEADLESS: '1',
      RDC_AGENT_TEST_MODE: '1',
      RDC_AGENT_USER_DATA: paths.userDataDir,
      RDC_AGENT_WORKSPACE: paths.workspaceDir,
      RDC_AGENT_BROWSER_BRIDGE_PORT: '0',
    },
  });

  const bridgeUrl = await waitForBridgeUrlFromProcess(app);
  return {
    app,
    bridgeUrl,
    ...paths,
  };
}

export async function closeSmokeApp(context: SmokeAppContext | HeadlessSmokeAppContext): Promise<void> {
  await context.app.evaluate(({ app }) => {
    app.quit();
    setTimeout(() => app.exit(0), 100).unref?.();
  }).catch(() => undefined);
  await context.app.close().catch(() => undefined);
  fs.rmSync(context.tempDir, { recursive: true, force: true });
}

function createSmokePaths(): Pick<SmokeAppContext, 'tempDir' | 'userDataDir' | 'workspaceDir'> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-smoke-'));
  const userDataDir = path.join(tempDir, 'userData');
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });
  return { tempDir, userDataDir, workspaceDir };
}

async function waitForBridgeUrlFromMain(app: ElectronApplication): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const bridgeUrl = await app.evaluate(() => (
      globalThis as typeof globalThis & { __RDC_AGENT_BROWSER_BRIDGE_URL__?: string }
    ).__RDC_AGENT_BROWSER_BRIDGE_URL__ ?? null).catch(() => null);
    if (bridgeUrl) {
      return bridgeUrl;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Browser app bridge URL was not published by main process');
}

async function waitForBridgeUrlFromProcess(app: ElectronApplication): Promise<string> {
  const child = app.process();
  const bridgePattern = /\[BrowserAppBridge\] Browser app session: (http:\/\/127\.0\.0\.1:\d+)\/app/;

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      callback();
    };

    const onData = (chunk: Buffer | string): void => {
      output += chunk.toString();
      const match = bridgePattern.exec(output);
      if (match?.[1]) {
        settle(() => resolve(match[1]));
      }
    };

    const onExit = (): void => {
      settle(() => reject(new Error(`Electron exited before publishing browser app bridge URL.\n${output.slice(-2000)}`)));
    };

    const timeout = setTimeout(() => {
      settle(() => reject(new Error(`Browser app bridge URL was not published by main process.\n${output.slice(-2000)}`)));
    }, 15000);

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', onExit);
  });
}
