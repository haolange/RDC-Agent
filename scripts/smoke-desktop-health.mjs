#!/usr/bin/env node
/**
 * Desktop unpacked health smoke — start Electron briefly under the OS, then kill.
 *
 * Usage (after `pnpm run pack`):
 *   node scripts/smoke-desktop-health.mjs
 *   xvfb-run -a node scripts/smoke-desktop-health.mjs
 *
 * Optional:
 *   RDC_AGENT_SMOKE_DESKTOP_DIR=release/linux-unpacked
 *   RDC_AGENT_SMOKE_DESKTOP_MS=8000
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOLD_MS = Number(process.env.RDC_AGENT_SMOKE_DESKTOP_MS || 8_000);

function fail(message) {
  console.error(`[smoke:desktop] ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`[smoke:desktop] ${message}`);
}

function resolveUnpackedDir() {
  const override = process.env.RDC_AGENT_SMOKE_DESKTOP_DIR?.trim();
  if (override) {
    return path.resolve(repoRoot, override);
  }
  const candidates = [
    path.join(repoRoot, 'release', 'linux-unpacked'),
    path.join(repoRoot, 'release', 'win-unpacked'),
    path.join(repoRoot, 'release', 'mac'),
    path.join(repoRoot, 'release', 'mac-arm64'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

function resolveExecutable(unpackedDir) {
  const platform = process.platform;
  if (platform === 'linux') {
    const named = path.join(unpackedDir, 'RdcAgent');
    if (existsSync(named)) return named;
    const entries = readdirSync(unpackedDir);
    const hit = entries.find((name) => {
      const absolute = path.join(unpackedDir, name);
      try {
        return statSync(absolute).isFile() && !name.includes('.');
      } catch {
        return false;
      }
    });
    return hit ? path.join(unpackedDir, hit) : null;
  }
  if (platform === 'win32') {
    const named = path.join(unpackedDir, 'RdcAgent.exe');
    if (existsSync(named)) return named;
    const hit = readdirSync(unpackedDir).find((name) => name.endsWith('.exe'));
    return hit ? path.join(unpackedDir, hit) : null;
  }
  if (platform === 'darwin') {
    const apps = readdirSync(unpackedDir).filter((name) => name.endsWith('.app'));
    if (apps[0]) {
      const macOSDir = path.join(unpackedDir, apps[0], 'Contents', 'MacOS');
      if (existsSync(macOSDir)) {
        const bin = readdirSync(macOSDir)[0];
        if (bin) return path.join(macOSDir, bin);
      }
    }
  }
  return null;
}

async function stopChild(child) {
  if (!child || child.exitCode != null || !child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function main() {
  const unpacked = resolveUnpackedDir();
  if (!unpacked) {
    fail('No unpacked Electron dir under release/. Run `pnpm run pack` first.');
    return;
  }
  const executable = resolveExecutable(unpacked);
  if (!executable || !existsSync(executable)) {
    fail(`Could not resolve Electron executable under ${unpacked}`);
    return;
  }
  ok(`Starting ${executable} for ${HOLD_MS}ms`);

  const child = spawn(executable, ['--no-sandbox'], {
    cwd: unpacked,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      RDC_AGENT_SMOKE_DESKTOP: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let spawned = false;
  child.once('spawn', () => {
    spawned = true;
    ok(`pid=${child.pid}`);
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));

  const earlyExit = new Promise((resolve) => {
    child.once('error', (error) => resolve({ type: 'error', error }));
    child.once('exit', (code, signal) => resolve({ type: 'exit', code, signal }));
  });

  const held = await Promise.race([
    earlyExit,
    new Promise((resolve) => setTimeout(() => resolve({ type: 'hold' }), HOLD_MS)),
  ]);

  if (held.type === 'error') {
    fail(`Electron failed to start: ${held.error instanceof Error ? held.error.message : String(held.error)}`);
    return;
  }
  if (held.type === 'exit' && !spawned) {
    fail(`Electron exited before spawn settled (code=${held.code}, signal=${held.signal})`);
    return;
  }
  if (held.type === 'exit' && held.code !== 0 && held.code != null) {
    // Instant crash is a hard fail; a clean early exit is unusual but treat non-zero as fail.
    fail(`Electron exited early with code=${held.code} signal=${held.signal}`);
    return;
  }

  await stopChild(child);
  ok('PASS (started and terminated)');
}

await main();
if (process.exitCode) process.exit(process.exitCode);
