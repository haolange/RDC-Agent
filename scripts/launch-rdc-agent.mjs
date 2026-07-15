#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE = [22, 13, 0];
const REQUIRED_PNPM = '11.7.0';
const STATE_SCHEMA_VERSION = 1;
const VALID_MODES = new Set(['desktop', 'desktop-dev', 'browser', 'browser-dev', 'prepare-only']);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const nodeModulesPath = path.join(repoRoot, 'node_modules');
const stateRoot = path.join(nodeModulesPath, '.cache', 'rdc-agent');
const dependencyStatePath = path.join(stateRoot, 'dependency-state.json');
const buildStatePath = path.join(stateRoot, 'build-state.json');
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
  let forcePrepare = false;
  let rebuildSettingsOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--prepare-only') {
      prepareOnly = true;
    } else if (argument === '--force-prepare') {
      forcePrepare = true;
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
  return {
    mode,
    prepareOnly: prepareOnly || mode === 'prepare-only',
    forcePrepare,
    rebuildSettingsOnly,
  };
}

function assertNodeVersion() {
  const current = process.versions.node.split('.').map(Number);
  const supported = current[0] > REQUIRED_NODE[0]
    || (current[0] === REQUIRED_NODE[0] && current[1] > REQUIRED_NODE[1])
    || (current[0] === REQUIRED_NODE[0] && current[1] === REQUIRED_NODE[1] && current[2] >= REQUIRED_NODE[2]);
  if (!supported) {
    fail(`Node.js >=${REQUIRED_NODE.join('.')} is required; current runtime is ${process.versions.node} (${process.execPath}).`);
  }
  console.log(`[RDC-Agent] Node runtime: ${process.execPath} (${process.versions.node}).`);
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

function executableCandidate(command, prefix, label) {
  return { command, prefix, shell: false, label };
}

function pathPnpmCandidate() {
  if (process.platform !== 'win32') return executableCandidate('pnpm', [], 'pnpm');
  const commandInterpreter = process.env.ComSpec || 'cmd.exe';
  return executableCandidate(commandInterpreter, ['/d', '/s', '/c', 'pnpm.cmd'], 'pnpm.cmd');
}

function pnpmCandidates() {
  const candidates = [];
  const runtimeRoot = path.resolve(path.dirname(process.execPath), '..');
  const adjacentPnpm = path.join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  if (existsSync(adjacentPnpm)) {
    candidates.push(executableCandidate(process.execPath, [adjacentPnpm], adjacentPnpm));
  }

  candidates.push(pathPnpmCandidate());

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
    if (existsSync(bundledPnpm) && bundledPnpm !== adjacentPnpm) {
      candidates.push(executableCandidate(process.execPath, [bundledPnpm], bundledPnpm));
    }
  }
  return candidates;
}

function resolvePnpm() {
  const observed = [];
  for (const candidate of pnpmCandidates()) {
    const result = runSync(candidate.command, [...candidate.prefix, '--version'], { capture: true });
    if (result.status === 0) {
      const version = result.output.split(/\s+/).find((value) => /^\d+\.\d+\.\d+$/.test(value));
      observed.push(`${candidate.label}=${version ?? 'unknown'}`);
      if (version === REQUIRED_PNPM) return candidate;
    }
  }
  fail(`pnpm ${REQUIRED_PNPM} is required. Checked: ${observed.join(', ') || 'no pnpm runtime found'}.`);
}

function runPnpm(pnpm, args, options = {}) {
  const result = runSync(pnpm.command, [...pnpm.prefix, ...args], { capture: options.capture });
  if (result.status !== 0) {
    fail(`pnpm ${args.join(' ')} failed (Node: ${process.execPath}, pnpm: ${pnpm.label}, lockfile: ${path.join(repoRoot, 'pnpm-lock.yaml')}).${result.output ? `\n${result.output}` : ''}`);
  }
  return result.output;
}

function resolvePnpmStore(pnpm) {
  const output = runPnpm(pnpm, ['store', 'path'], { capture: true });
  const storePath = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!storePath || !path.isAbsolute(storePath)) {
    fail(`pnpm returned an invalid store path: ${output || '(empty)'}.`);
  }
  const resolved = path.resolve(storePath);
  console.log(`[RDC-Agent] pnpm runtime: ${pnpm.label} (${REQUIRED_PNPM}); store: ${resolved}.`);
  return resolved;
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

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, filePath);
}

function pathEquals(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function modulesStorePath() {
  const modules = readJson(path.join(nodeModulesPath, '.modules.yaml'));
  return typeof modules?.storeDir === 'string' ? modules.storeDir : null;
}

function hashPaths(paths) {
  const hash = createHash('sha256');
  const visit = (targetPath) => {
    if (!existsSync(targetPath)) {
      hash.update(`missing\0${path.relative(repoRoot, targetPath)}\0`);
      return;
    }
    const stats = statSync(targetPath);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(targetPath).sort()) visit(path.join(targetPath, entry));
      return;
    }
    hash.update(`file\0${path.relative(repoRoot, targetPath).replaceAll('\\', '/')}\0`);
    hash.update(readFileSync(targetPath));
    hash.update('\0');
  };
  for (const targetPath of paths) visit(targetPath);
  return hash.digest('hex');
}

function dependencyFingerprint(storePath) {
  const inputHash = hashPaths([
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'pnpm-lock.yaml'),
    path.join(repoRoot, 'pnpm-workspace.yaml'),
  ]);
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: STATE_SCHEMA_VERSION,
    inputHash,
    pnpmVersion: REQUIRED_PNPM,
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
    storePath: path.resolve(storePath),
  })).digest('hex');
}

function criticalDependencyPaths() {
  return [
    path.join(nodeModulesPath, '.modules.yaml'),
    path.join(nodeModulesPath, 'electron-vite', 'bin', 'electron-vite.js'),
    path.join(nodeModulesPath, 'vite', 'bin', 'vite.js'),
  ];
}

function ensureDependencies(pnpm, storePath, forcePrepare) {
  const fingerprint = dependencyFingerprint(storePath);
  const state = readJson(dependencyStatePath);
  const installedStore = modulesStorePath();
  const storeMatches = Boolean(installedStore && pathEquals(installedStore, storePath));
  const criticalDependenciesExist = criticalDependencyPaths().every(existsSync);
  const installRequired = forcePrepare
    || state?.schemaVersion !== STATE_SCHEMA_VERSION
    || state?.fingerprint !== fingerprint
    || !storeMatches
    || !criticalDependenciesExist;

  if (installRequired) {
    if (installedStore && !storeMatches) {
      console.log(`[RDC-Agent] Dependency store changed (${installedStore} -> ${storePath}); rebuilding node_modules.`);
      rmSync(nodeModulesPath, { recursive: true, force: true });
    }
    console.log(`[RDC-Agent] Synchronizing dependencies with pnpm ${REQUIRED_PNPM}...`);
    const installArgs = ['install', '--frozen-lockfile', '--prefer-offline'];
    if (forcePrepare) installArgs.push('--force');
    runPnpm(pnpm, installArgs);
  } else {
    console.log('[RDC-Agent] Dependencies are current; skipping pnpm install.');
  }

  let electronExecutable = resolveElectronExecutable();
  if (forcePrepare || !electronExecutable) {
    console.log('[RDC-Agent] Rebuilding the Electron platform runtime...');
    runPnpm(pnpm, ['rebuild', 'electron']);
    electronExecutable = resolveElectronExecutable();
  }
  if (!electronExecutable) {
    fail(`Electron runtime is unavailable after pnpm rebuild (Node: ${process.execPath}, pnpm: ${pnpm.label}, store: ${storePath}, lockfile: ${path.join(repoRoot, 'pnpm-lock.yaml')}).`);
  }

  const resultingStore = modulesStorePath();
  if (!resultingStore || !pathEquals(resultingStore, storePath) || !criticalDependencyPaths().every(existsSync)) {
    fail(`Dependency preparation completed with an invalid node_modules state (expected store: ${storePath}, actual store: ${resultingStore ?? 'missing'}).`);
  }
  writeJsonAtomic(dependencyStatePath, {
    schemaVersion: STATE_SCHEMA_VERSION,
    fingerprint,
    storePath,
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
    pnpmVersion: REQUIRED_PNPM,
  });
  return { fingerprint, electronExecutable };
}

function buildFingerprint(dependencyKey) {
  const inputHash = hashPaths([
    path.join(repoRoot, 'src'),
    path.join(repoRoot, 'electron.vite.config.ts'),
    path.join(repoRoot, 'vite.renderer.config.ts'),
    path.join(repoRoot, 'tsconfig.json'),
    path.join(repoRoot, 'package.json'),
    path.join(repoRoot, 'pnpm-lock.yaml'),
  ]);
  return createHash('sha256').update(`${dependencyKey}\0${inputHash}`).digest('hex');
}

function runNodeCli(cliPath, args, env) {
  if (!existsSync(cliPath)) fail(`Required CLI is missing after dependency preparation: ${cliPath}`);
  const result = runSync(process.execPath, [cliPath, ...args], { env });
  if (result.status !== 0) fail(`${path.basename(cliPath)} ${args.join(' ')} failed.`);
}

function ensureBuild(dependencyKey, env, forcePrepare) {
  const electronVite = path.join(nodeModulesPath, 'electron-vite', 'bin', 'electron-vite.js');
  const outputs = [
    path.join(repoRoot, 'out', 'main', 'index.js'),
    path.join(repoRoot, 'out', 'main', 'provider-catalog', 'index.json'),
    path.join(repoRoot, 'out', 'preload', 'index.js'),
    path.join(repoRoot, 'out', 'renderer', 'index.html'),
  ];
  const fingerprint = buildFingerprint(dependencyKey);
  const state = readJson(buildStatePath);
  const buildRequired = forcePrepare
    || state?.schemaVersion !== STATE_SCHEMA_VERSION
    || state?.fingerprint !== fingerprint
    || !outputs.every(existsSync);
  if (buildRequired) {
    console.log('[RDC-Agent] Building current application sources...');
    runNodeCli(electronVite, ['build'], env);
    if (!outputs.every(existsSync)) fail(`Build completed without all required outputs: ${outputs.join(', ')}`);
    writeJsonAtomic(buildStatePath, { schemaVersion: STATE_SCHEMA_VERSION, fingerprint });
  } else {
    console.log('[RDC-Agent] Build outputs are current; skipping build.');
  }
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
  if (env.RDC_AGENT_USER_DATA?.trim()) mkdirSync(path.resolve(env.RDC_AGENT_USER_DATA), { recursive: true });
  return env;
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
  await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function main() {
  const { mode, prepareOnly, forcePrepare, rebuildSettingsOnly } = parseArgs(process.argv.slice(2));
  assertNodeVersion();
  for (const requiredFile of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    if (!existsSync(path.join(repoRoot, requiredFile))) fail(`Required repository file is missing: ${requiredFile} (${repoRoot}).`);
  }

  const pnpm = resolvePnpm();
  const storePath = resolvePnpmStore(pnpm);
  const dependencyState = ensureDependencies(pnpm, storePath, forcePrepare);
  const effectiveMode = mode === 'prepare-only' ? 'desktop' : mode;
  const env = modeEnvironment(effectiveMode, rebuildSettingsOnly);
  const mainEntry = path.join(repoRoot, 'out', 'main', 'index.js');

  if (effectiveMode === 'desktop-dev' && !prepareOnly) {
    console.log('[RDC-Agent] Starting visible Electron app in development mode...');
    runNodeCli(path.join(nodeModulesPath, 'electron-vite', 'bin', 'electron-vite.js'), ['dev'], env);
    return;
  }

  ensureBuild(dependencyState.fingerprint, env, forcePrepare);
  if (prepareOnly) {
    console.log(`[RDC-Agent] Preparation complete (${process.platform}, ${process.arch}, Electron: ${dependencyState.electronExecutable}).`);
    return;
  }

  if (effectiveMode === 'browser-dev') {
    if (await isPortOpen(5173)) fail('Port 5173 is already in use; browser-dev requires that exact renderer port.');
    console.log('[RDC-Agent] Starting renderer dev server at http://127.0.0.1:5173/...');
    const renderer = runChild(process.execPath, [
      path.join(nodeModulesPath, 'vite', 'bin', 'vite.js'),
      '--config', 'vite.renderer.config.ts', '--host', '127.0.0.1', '--port', '5173', '--strictPort',
    ], env);
    const cleanup = () => { void terminate(renderer); };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    try {
      await waitForRenderer(renderer);
      const browserEnv = { ...env, ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173' };
      console.log('[RDC-Agent] Starting headless main process for browser verification...');
      const electron = runChild(dependencyState.electronExecutable, [mainEntry], browserEnv);
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
  const electron = runChild(dependencyState.electronExecutable, [mainEntry], env);
  process.exitCode = await waitForExit(electron);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
