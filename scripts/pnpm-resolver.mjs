import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REQUIRED_PNPM = '11.7.0';

export function executableCandidate(command, prefix, label) {
  return { command, prefix, shell: false, label };
}

export function pathPnpmCandidate(platform = process.platform, comSpec = process.env.ComSpec) {
  if (platform !== 'win32') return executableCandidate('pnpm', [], 'pnpm');
  const commandInterpreter = comSpec || 'cmd.exe';
  return executableCandidate(commandInterpreter, ['/d', '/s', '/c', 'pnpm.cmd'], 'pnpm.cmd');
}

export function corepackPnpmCandidate(platform = process.platform, comSpec = process.env.ComSpec) {
  if (platform !== 'win32') return executableCandidate('corepack', ['pnpm'], 'corepack pnpm');
  const commandInterpreter = comSpec || 'cmd.exe';
  return executableCandidate(commandInterpreter, ['/d', '/s', '/c', 'corepack.cmd', 'pnpm'], 'corepack.cmd pnpm');
}

export function pnpmCandidates(options = {}) {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const homedir = options.homedir ?? os.homedir();
  const exists = options.existsSync ?? existsSync;
  const comSpec = options.comSpec ?? process.env.ComSpec;
  const candidates = [];
  const runtimeRoot = path.resolve(path.dirname(execPath), '..');
  const adjacentPnpm = path.join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  if (exists(adjacentPnpm)) {
    candidates.push(executableCandidate(execPath, [adjacentPnpm], adjacentPnpm));
  }

  candidates.push(corepackPnpmCandidate(platform, comSpec));
  candidates.push(pathPnpmCandidate(platform, comSpec));

  const cacheRoots = [path.join(homedir, '.cache'), path.join(homedir, 'Library', 'Caches')];
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
    if (exists(bundledPnpm) && bundledPnpm !== adjacentPnpm) {
      candidates.push(executableCandidate(execPath, [bundledPnpm], bundledPnpm));
    }
  }
  return candidates;
}

export function resolvePnpm(options = {}) {
  const required = options.required ?? REQUIRED_PNPM;
  const candidates = options.candidates ?? pnpmCandidates(options);
  const runSync = options.runSync;
  const fail = options.fail;
  const observed = [];
  for (const candidate of candidates) {
    const result = runSync(candidate.command, [...candidate.prefix, '--version'], { capture: true });
    if (result.status === 0) {
      const version = result.output.split(/\s+/).find((value) => /^\d+\.\d+\.\d+$/.test(value));
      observed.push(`${candidate.label}=${version ?? 'unknown'}`);
      if (version === required) return candidate;
    }
  }
  fail(`pnpm ${required} is required. Checked: ${observed.join(', ') || 'no pnpm runtime found'}.`);
}
