#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE = [22, 13, 0];
const REQUIRED_PNPM = '11.7.0';
const VALID_MODES = new Set(['desktop', 'desktop-dev', 'browser', 'browser-dev', 'prepare-only']);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const runtimeEnvironment = {
  ...process.env,
  [pathKey]: [path.dirname(process.execPath), process.env[pathKey]].filter(Boolean).join(path.delimiter),
};

function fail(message) {
  console.error(`[RDC-Agent] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let mode = 'desktop';
  let prepareOnly = false;
  let rebuildSettingsOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--prepare-only') {
      prepareOnly = true;
    } else if (argument === '--rebuild-settings-only') {
      rebuildSettingsOnly = true;
    } else if (argument === '--mode') {
      mode = argv[index + 1] ?? '';
      index += 1;
    } else {
      fail(`Unknown launcher argument: ${argument}`);
    }
  }
  if (!VALID_MODES.has(mode)) {
    fail(`Unsupported launcher mode: ${mode || '(empty)'}`);
  }
  return { mode, prepareOnly: prepareOnly || mode === 'prepare-only', rebuildSettingsOnly };
}

function assertNodeVersion() {
  const current = process.versions.node.split('.').map(Number);
  const supported = current[0] > REQUIRED_NODE[0]
    || (current[0] === REQUIRED_NODE[0] && current[1] > REQUIRED_NODE[1])
    || (current[0] === REQUIRED_NODE[0] && current[1] === REQUIRED_NODE[1] && current[2] >= REQUIRED_NODE[2]);
  if (!supported) {
    fail(`Node.js >=${REQUIRED_NODE.join('.')} is required; current runtime is ${process.versions.node} (${process.execPath}).`);
  }
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? runtimeEnvironment,
    encoding: 'utf8',
    shell: options.shell ?? false,
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) {
    return { status: 1, output: result.error.message };
  }
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function pnpmCandidates() {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
  const candidates = [];
  const runtimeRoot = path.resolve(path.dirname(process.execPath), '..');
  const adjacentPnpm = path.join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  if (existsSync(adjacentPnpm)) {
    candidates.push({ command: process.execPath, prefix: [adjacentPnpm], shell: false, label: adjacentPnpm });
  }
  const cacheRoots = [path.join(os.homedir(), '.cache'), path.join(os.homedir(), 'Library', 'Caches')];
  for (const cacheRoot of cacheRoots) {
    const bundledPnpm = path.join(
      cacheRoot,
      'codex-runtimes',
      'codex-primary-runtime',
      'dependencies',
      'node',
      'node_modules',
      'pnpm',
      'bin',
      'pnpm.mjs',
    );
    if (existsSync(bundledPnpm)) {
      candidates.push({ command: process.execPath, prefix: [bundledPnpm], shell: false, label: bundledPnpm });
    }
  }
  if (process.platform === 'win32') {
    const commandInterpreter = process.env.ComSpec || 'cmd.exe';
    candidates.push({ command: commandInterpreter, prefix: ['/d', '/s', '/c', executable], shell: false, label: executable });
    candidates.push({ command: commandInterpreter, prefix: ['/d', '/s', '/c', corepack, 'pnpm'], shell: false, label: `${corepack} pnpm` });
  } else {
    candidates.push({ command: executable, prefix: [], shell: false, label: executable });
    candidates.push({ command: corepack, prefix: ['pnpm'], shell: false, label: `${corepack} pnpm` });
  }
  return candidates;
}

function resolvePnpm() {
  const observed = [];
  for (const candidate of pnpmCandidates()) {
    const result = runSync(candidate.command, [...candidate.prefix, '--version'], {
      capture: true,
      shell: candidate.shell,
    });
    if (result.status === 0) {
      const version = result.output.split(/\s+/).find((value) => /^\d+\.\d+\.\d+$/.test(value));
      observed.push(`${candidate.label}=${version ?? 'unknown'}`);
      if (version === REQUIRED_PNPM) {
        return candidate;
      }
    }
  }
  fail(`pnpm ${REQUIRED_PNPM} is required. Checked: ${observed.join(', ') || 'no pnpm/corepack runtime found'}.`);
}

function runPnpm(pnpm, args) {
  const result = runSync(pnpm.command, [...pnpm.prefix, ...args], { shell: pnpm.shell });
  if (result.status !== 0) {
    fail(`pnpm ${args.join(' ')} failed (Node: ${process.execPath}, pnpm: ${pnpm.label}, lockfile: ${path.join(repoRoot, 'pnpm-lock.yaml')}).`);
  }
}

function resolveElectronExecutable() {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  try {
    const executable = require('electron');
    return typeof executable === 'string' && existsSync(executable) ? executable : null;
  } catch {
    return null;
  }
}

function ensureElectronRuntime() {
  let executable = resolveElectronExecutable();
  if (executable) return executable;
  const installer = path.join(repoRoot, 'node_modules', 'electron', 'install.js');
  if (!existsSync(installer)) {
    fail('Electron package is missing after dependency installation. Check pnpm output and pnpm-lock.yaml.');
  }
  console.log('[RDC-Agent] Electron runtime is incomplete; repairing the platform download...');
  const repair = runSync(process.execPath, [installer]);
  if (repair.status !== 0) {
    fail('Electron runtime repair failed. Check network/proxy access to the Electron download host and the pnpm store.');
  }
  executable = resolveElectronExecutable();
  if (!executable) {
    fail('Electron runtime is still unavailable after repair.');
  }
  return executable;
}

function modeEnvironment(mode, rebuildSettingsOnly) {
  const development = mode.endsWith('-dev');
  const headless = mode.startsWith('browser');
  const env = {
    ...runtimeEnvironment,
    NODE_ENV: development ? 'development' : 'production',
    RDC_AGENT_HEADLESS: headless ? '1' : '0',
    RDC_AGENT_TEST_MODE: '0',
    RDC_AGENT_REBUILD_SETTINGS_ONLY: rebuildSettingsOnly ? '1' : '0',
  };
  delete env.ELECTRON_RENDERER_URL;
  if (env.RDC_AGENT_USER_DATA?.trim()) {
    mkdirSync(path.resolve(env.RDC_AGENT_USER_DATA), { recursive: true });
  }
  return env;
}

function runNodeCli(cliPath, args, env) {
  if (!existsSync(cliPath)) fail(`Required CLI is missing after pnpm install: ${cliPath}`);
  const result = runSync(process.execPath, [cliPath, ...args], { env });
  if (result.status !== 0) fail(`${path.basename(cliPath)} ${args.join(' ')} failed.`);
}

function runChild(command, args, env) {
  return spawn(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

async function waitForRenderer(child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Renderer dev server exited before becoming reachable.');
    const ready = await new Promise((resolve) => {
      const request = http.get('http://127.0.0.1:5173/', (response) => {
        response.resume();
        resolve((response.statusCode ?? 500) < 500);
      });
      request.setTimeout(750, () => { request.destroy(); resolve(false); });
      request.once('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Renderer dev server did not become reachable at http://127.0.0.1:5173/.');
}

async function terminate(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    waitForExit(child),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const { mode, prepareOnly, rebuildSettingsOnly } = parseArgs(process.argv.slice(2));
  assertNodeVersion();
  if (!existsSync(path.join(repoRoot, 'package.json')) || !existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) {
    fail(`Run this launcher from an RDC-Agent checkout containing package.json and pnpm-lock.yaml (${repoRoot}).`);
  }
  const pnpm = resolvePnpm();
  console.log(`[RDC-Agent] Synchronizing dependencies with pnpm ${REQUIRED_PNPM}...`);
  runPnpm(pnpm, ['install', '--frozen-lockfile', '--prefer-offline']);
  const electronExecutable = ensureElectronRuntime();
  const effectiveMode = mode === 'prepare-only' ? 'desktop' : mode;
  const env = modeEnvironment(effectiveMode, rebuildSettingsOnly);
  const electronVite = path.join(repoRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
  const vite = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const mainEntry = path.join(repoRoot, 'out', 'main', 'index.js');

  if (effectiveMode === 'desktop-dev' && !prepareOnly) {
    console.log('[RDC-Agent] Starting visible Electron app in development mode...');
    runNodeCli(electronVite, ['dev'], env);
    return;
  }

  console.log('[RDC-Agent] Building current application sources...');
  runNodeCli(electronVite, ['build'], env);
  if (!existsSync(mainEntry)) fail(`Build completed without the main entry: ${mainEntry}`);
  if (prepareOnly) {
    console.log(`[RDC-Agent] Preparation complete (${process.platform}, ${process.arch}, Electron: ${electronExecutable}).`);
    return;
  }

  if (effectiveMode === 'browser-dev') {
    if (await isPortOpen(5173)) fail('Port 5173 is already in use; browser-dev requires that exact renderer port.');
    console.log('[RDC-Agent] Starting renderer dev server at http://127.0.0.1:5173/...');
    const renderer = runChild(process.execPath, [vite, '--config', 'vite.renderer.config.ts', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], env);
    const cleanup = () => { void terminate(renderer); };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    try {
      await waitForRenderer(renderer);
      const browserEnv = { ...env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' };
      console.log('[RDC-Agent] Starting headless main process for browser verification...');
      const electron = runChild(electronExecutable, [mainEntry], browserEnv);
      process.exitCode = await waitForExit(electron);
    } finally {
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      await terminate(renderer);
    }
    return;
  }

  console.log(effectiveMode === 'browser'
    ? '[RDC-Agent] Starting headless main process for browser verification...'
    : '[RDC-Agent] Starting visible Electron app from build output...');
  const electron = runChild(electronExecutable, [mainEntry], env);
  process.exitCode = await waitForExit(electron);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
