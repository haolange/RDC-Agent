import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

export interface AppContext {
  app: ElectronApplication;
  page: Page;
  tempDir: string;
}

/**
 * 启动 Electron app，使用临时 userData 和 workspace
 */
export async function launchApp(): Promise<AppContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-e2e-'));
  const userDataDir = path.join(tempDir, 'userData');
  const workspaceDir = path.join(tempDir, 'workspace');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  // 复制 fixture .rdc 文件到临时 workspace
  const manifestPath = path.join(__dirname, '..', 'fixtures', 'fixture-manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    for (const fixture of manifest.captures ?? []) {
      if (fs.existsSync(fixture.sourcePath)) {
        const destPath = path.join(workspaceDir, path.basename(fixture.sourcePath));
        fs.copyFileSync(fixture.sourcePath, destPath);
      }
    }
  }

  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      RDC_AGENT_TEST_MODE: '1',
      RDC_AGENT_USER_DATA: userDataDir,
      RDC_AGENT_WORKSPACE: workspaceDir,
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return { app, page, tempDir };
}

/**
 * 关闭 app 并清理临时目录
 */
export async function closeApp(ctx: AppContext): Promise<void> {
  await ctx.app.close();
  // 清理临时目录
  try {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
