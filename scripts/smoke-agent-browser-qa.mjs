#!/usr/bin/env node
/**
 * Browser QA smoke (debug-only). Not part of default release pack.
 *
 * Usage:
 *   1) pnpm run start:agent-browser   # leave running
 *   2) pnpm run smoke:agent-browser
 *
 * Optional env:
 *   RDC_AGENT_SMOKE_BRIDGE_URL=http://127.0.0.1:5127
 *   RDC_AGENT_SMOKE_START=1  — spawn start:agent-browser and wait for /qa log line
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_BASE = process.env.RDC_AGENT_SMOKE_BRIDGE_URL?.trim() || 'http://127.0.0.1:5127';
const START = process.env.RDC_AGENT_SMOKE_START === '1';
const TIMEOUT_MS = Number(process.env.RDC_AGENT_SMOKE_TIMEOUT_MS || 120_000);

function fail(message) {
  console.error(`[smoke:agent-browser] ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[smoke:agent-browser] ${message}`);
}

async function fetchRaw(url, init = {}) {
  const response = await fetch(url, { redirect: 'manual', ...init });
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  return { response, contentType, text };
}

async function assertQaSurface(baseUrl, qaUrl) {
  const qa = await fetchRaw(qaUrl);
  if (qa.response.status !== 302) {
    fail(`GET /qa expected 302, got ${qa.response.status}`);
    return null;
  }
  const setCookie = qa.response.headers.get('set-cookie') || '';
  if (!setCookie.includes('rdcBridgeToken=')) {
    fail('GET /qa missing Set-Cookie rdcBridgeToken');
    return null;
  }
  ok('GET /qa → 302 + Set-Cookie');

  const cookie = setCookie.split(';')[0] || '';
  const location = qa.response.headers.get('location') || '/app';
  const appUrl = new URL(location, baseUrl).toString();
  const app = await fetchRaw(appUrl, { headers: { Cookie: cookie } });
  if (app.response.status !== 200 || !/text\/html/i.test(app.contentType)) {
    fail(`GET /app with cookie expected HTML 200, got ${app.response.status} ${app.contentType}`);
    return null;
  }
  if (app.text.trimStart().startsWith('{')) {
    fail('GET /app returned JSON instead of HTML (auth failed / white screen)');
    return null;
  }
  ok('GET /app with cookie → HTML');

  const unauth = await fetchRaw(`${baseUrl}/app`);
  if (unauth.response.status !== 401 || !/application\/json/i.test(unauth.contentType)) {
    fail(`GET /app without auth expected 401 JSON, got ${unauth.response.status} ${unauth.contentType}`);
    return null;
  }
  ok('GET /app without auth → 401 JSON');

  const origin = new URL(baseUrl).origin;
  const invokeNoOrigin = await fetchRaw(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ channel: 'app:getMeta', args: [] }),
  });
  if (invokeNoOrigin.response.status !== 401) {
    fail(`POST /invoke without Origin expected 401, got ${invokeNoOrigin.response.status}: ${invokeNoOrigin.text.slice(0, 200)}`);
    return null;
  }
  ok('POST /invoke cookie without Origin → 401');

  const eventsNoOrigin = await fetchRaw(`${baseUrl}/events`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  if (eventsNoOrigin.response.status !== 401) {
    fail(`POST /events without Origin expected 401, got ${eventsNoOrigin.response.status}: ${eventsNoOrigin.text.slice(0, 200)}`);
    return null;
  }
  ok('POST /events cookie without Origin → 401');

  const eventsEvilOrigin = await fetchRaw(`${baseUrl}/events`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://evil.example',
    },
  });
  if (eventsEvilOrigin.response.status !== 401 && eventsEvilOrigin.response.status !== 403) {
    fail(`POST /events foreign Origin expected 401/403, got ${eventsEvilOrigin.response.status}: ${eventsEvilOrigin.text.slice(0, 200)}`);
    return null;
  }
  ok('POST /events cookie + foreign Origin → denied');

  const invoke = await fetchRaw(`${baseUrl}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify({ channel: 'app:getMeta', args: [] }),
  });
  if (invoke.response.status !== 200) {
    fail(`POST /invoke app:getMeta expected 200, got ${invoke.response.status}: ${invoke.text.slice(0, 200)}`);
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(invoke.text);
  } catch {
    fail('POST /invoke response is not JSON');
    return null;
  }
  if (payload?.success === false) {
    fail(`POST /invoke failed: ${payload.error || invoke.text.slice(0, 200)}`);
    return null;
  }
  const expectedVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  if (payload?.result?.version !== expectedVersion) {
    fail(`Product version mismatch: expected ${expectedVersion}, received ${String(payload?.result?.version)}`);
    return null;
  }
  ok('POST /invoke app:getMeta → correct product version');
  return true;
}

async function waitForBridgeFromChild(userDataPath) {
  const child = spawn(
    process.execPath,
    [path.join(repoRoot, 'scripts/launch-rdc-agent.mjs'), '--mode', 'browser'],
    {
      cwd: repoRoot,
      env: { ...process.env, RDC_AGENT_USER_DATA: userDataPath, RDC_AGENT_HOME: path.join(userDataPath, '.rdc-agent') },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let qaUrl = null;
  const deadline = Date.now() + TIMEOUT_MS;

  const onLine = (line) => {
    const match = /Browser app session:\s*(https?:\/\/127\.0\.0\.1:\d+\/qa(?:\?qaBootstrap=[^\s]+)?)/i.exec(line);
    if (match) {
      qaUrl = match[1];
    }
  };

  for (const stream of [child.stdout, child.stderr]) {
    const rl = createInterface({ input: stream });
    rl.on('line', (line) => {
      console.log(line);
      onLine(line);
    });
  }

  while (!qaUrl && Date.now() < deadline) {
    if (child.exitCode != null) {
      fail(`start:agent-browser exited early with code ${child.exitCode}`);
      return { child, qaUrl: null };
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!qaUrl) {
    child.kill();
    fail(`Timed out waiting for BrowserAppBridge bootstrap /qa log (${TIMEOUT_MS}ms)`);
    return { child, qaUrl: null };
  }
  return { child, qaUrl };
}

async function stopChildTree(child) {
  if (!child || child.exitCode != null || !child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function removeSmokeUserData(smokeUserData) {
  const resolvedTempRoot = path.resolve(tmpdir());
  const resolvedSmokeRoot = path.resolve(smokeUserData);
  const safePrefix = `${resolvedTempRoot}${path.sep}rdc-agent-browser-smoke-`;
  if (!resolvedSmokeRoot.startsWith(safePrefix)) {
    fail(`Refusing to clean unexpected smoke userData path: ${resolvedSmokeRoot}`);
    return;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(resolvedSmokeRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 19) {
        fail(`Could not clean smoke userData ${resolvedSmokeRoot}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function main() {
  let child = null;
  let smokeUserData = null;
  let baseUrl = DEFAULT_BASE.replace(/\/$/, '');
  let qaUrl = process.env.RDC_AGENT_SMOKE_QA_URL?.trim() || `${baseUrl}/qa`;

  try {
    if (START) {
      smokeUserData = mkdtempSync(path.join(tmpdir(), 'rdc-agent-browser-smoke-'));
      const started = await waitForBridgeFromChild(smokeUserData);
      child = started.child;
      if (!started.qaUrl) return;
      qaUrl = started.qaUrl;
      baseUrl = new URL(qaUrl).origin;
      const lockPath = path.join(smokeUserData, 'instance.lock');
      if (!existsSync(lockPath)) {
        fail(`Explicit smoke userData was not activated: ${lockPath}`);
        return;
      }
      const lockOwner = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (lockOwner?.mode !== 'browser') {
        fail(`Explicit smoke userData lock has unexpected owner mode: ${String(lockOwner?.mode)}`);
        return;
      }
      ok('Explicit disposable RDC_AGENT_USER_DATA → active browser instance.lock');
    } else {
      try {
        const probe = await fetch(qaUrl, { redirect: 'manual' });
        if (probe.status !== 302 && probe.status !== 401 && probe.status !== 200) {
          fail(`Bridge not reachable at ${qaUrl} (status ${probe.status}). Start with pnpm run start:agent-browser and use its bootstrap URL, or set RDC_AGENT_SMOKE_START=1.`);
          return;
        }
      } catch (error) {
        fail(`Bridge not reachable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}. Start with pnpm run start:agent-browser, or set RDC_AGENT_SMOKE_START=1.`);
        return;
      }
    }

    const passed = await assertQaSurface(baseUrl, qaUrl);
    if (passed) {
      ok(`PASS (${baseUrl})`);
    }
  } finally {
    await stopChildTree(child);
    if (smokeUserData) {
      await removeSmokeUserData(smokeUserData);
    }
  }
}

await main();
if (process.exitCode) process.exit(process.exitCode);
