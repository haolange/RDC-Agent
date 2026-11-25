#!/usr/bin/env node
// Differential rendering harness.
//   node scripts/visual-diff/run.mjs record [id...]   record scenarios against a disposable Browser QA instance
//   node scripts/visual-diff/run.mjs capture <dir> [--build <root>]   replay every scenario and write L1/L2 results
//   node scripts/visual-diff/run.mjs compare <base-dir> <head-dir>   fail on differences not declared by Visual-Diff-Allow
// Recordings live in scripts/visual-diff/scenarios; responses larger than 4 KiB are stored once in shared.json.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const scenarioDir = path.join(here, 'scenarios');
const definitionsPath = path.join(here, 'scenarios.json');
const sharedPath = path.join(scenarioDir, 'shared.json');
const SHARED_MIN_BYTES = 4096;

const fail = (message) => { console.error(`[visual-diff] ${message}`); process.exit(1); };
const electronBinary = () => process.env.VISUAL_DIFF_ELECTRON
  || path.join(repoRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

function runHost(args, capture = false) {
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const command = xvfb ? 'xvfb-run' : electronBinary();
  const hostArgs = [path.join(here, 'host', 'main.mjs'), '--', ...args];
  const full = xvfb ? ['-a', '-s', '-screen 0 1920x1200x24', electronBinary(), ...hostArgs] : hostArgs;
  const result = spawnSync(command, full, { cwd: repoRoot, encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0) fail(`host failed (${args.join(' ')}):\n${(result.stderr || result.stdout || '').slice(-2000)}`);
  return capture ? result.stdout : undefined;
}

/** Pixels that changed beyond antialiasing noise; bitmaps with equal hashes are identical. */
function changedPixels(basePng, headPng) {
  const output = runHost(['--mode', 'diff', '--a', basePng, '--b', headPng], true);
  return JSON.parse(output.trim().split('\n').filter((line) => line.startsWith('{')).at(-1)).pixels;
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);

/** Large answers (the settings DTO, histories) are kept once and referenced by content hash. */
function externalize(responses, shared) {
  return Object.fromEntries(Object.entries(responses).map(([channel, entries]) => [channel, entries.map((entry) => {
    const text = JSON.stringify(entry);
    if (text.length < SHARED_MIN_BYTES) return entry;
    const ref = createHash('sha256').update(text).digest('hex').slice(0, 24);
    shared[ref] = entry;
    return { ref };
  })]));
}

function internalize(responses, shared) {
  return Object.fromEntries(Object.entries(responses).map(([channel, entries]) => [channel, entries.map((entry) => (
    entry.ref ? shared[entry.ref] : entry))]));
}

/** Stops the instance's whole process group and waits until it is gone, so the next instance can take the port. */
async function stopQaInstance(child) {
  const alive = () => {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  if (alive()) process.kill(-child.pid);
  for (let attempt = 0; attempt < 100 && alive(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
}

async function startQaInstance(workDir) {
  const log = path.join(workDir, 'qa.log');
  // No RDC_AGENT_USER_DATA: the launcher then creates a disposable userData with its own user resource root, so a
  // recording never reads or writes the machine's ~/.rdc-agent.
  const env = { ...process.env, RDC_AGENT_BROWSER_QA_FULL_ACCESS: '1' };
  delete env.RDC_AGENT_USER_DATA;
  delete env.RDC_AGENT_HOME;
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const child = spawn(xvfb ? 'xvfb-run' : process.execPath,
    xvfb ? ['-a', process.execPath, 'scripts/launch-rdc-agent.mjs', '--mode', 'browser'] : ['scripts/launch-rdc-agent.mjs', '--mode', 'browser'],
    { cwd: repoRoot, env, stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')], detached: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const url = text.match(/https?:\/\/\S+qaBootstrap=\S+/g)?.at(-1);
    const identity = text.match(/Startup identity: (\{.*\})/)?.[1];
    if (url && identity) return { child, url, userData: JSON.parse(identity).userData };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await stopQaInstance(child);
  fail(`QA instance printed no bootstrap url:\n${fs.readFileSync(log, 'utf8').slice(-2000)}`);
}

async function record(ids) {
  const definitions = readJson(definitionsPath, []);
  const selected = ids.length ? definitions.filter((definition) => ids.includes(definition.id)) : definitions;
  if (!selected.length) fail('no scenario definitions selected');
  const shared = readJson(sharedPath, {});
  fs.mkdirSync(scenarioDir, { recursive: true });
  for (const definition of selected) {
    // Each recording starts from a fresh disposable QA instance, so scenarios never see each other's state.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-visual-diff-'));
    const { child, url, userData } = await startQaInstance(workDir);
    try {
      const definitionPath = path.join(workDir, 'definition.json');
      const recordedPath = path.join(workDir, 'recorded.json');
      writeJson(definitionPath, definition);
      runHost(['--mode', 'record', '--scenario', definitionPath, '--bridge', url, '--out', recordedPath, '--build', repoRoot]);
      // The disposable instance's directories differ per run; a fixed placeholder lets identical answers dedupe.
      const recorded = JSON.parse(fs.readFileSync(recordedPath, 'utf8')
        .split(JSON.stringify(userData).slice(1, -1)).join('/visual-diff'));
      writeJson(path.join(scenarioDir, `${definition.id}.json`), { ...recorded, responses: externalize(recorded.responses, shared) });
      console.log(`[visual-diff] recorded ${definition.id}`);
    } finally {
      await stopQaInstance(child);
      // The launcher's disposable userData (with its user resource root) is this run's own; a killed instance
      // cannot remove it itself.
      if (path.basename(userData).startsWith('qa-')) fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  // Drop shared answers no scenario references any more.
  const referenced = new Set(fs.readdirSync(scenarioDir).filter((name) => name !== 'shared.json' && name.endsWith('.json'))
    .flatMap((name) => Object.values(readJson(path.join(scenarioDir, name), {}).responses ?? {}).flat().map((entry) => entry.ref).filter(Boolean)));
  writeJson(sharedPath, Object.fromEntries(Object.entries(shared).filter(([ref]) => referenced.has(ref)).sort(([a], [b]) => a.localeCompare(b))));
}

function capture(outDir, buildRoot) {
  const shared = readJson(sharedPath, {});
  const scenarios = fs.readdirSync(scenarioDir).filter((name) => name !== 'shared.json' && name.endsWith('.json')).sort();
  if (!scenarios.length) fail('no recorded scenarios');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-visual-diff-'));
  try {
    for (const name of scenarios) {
      const scenario = readJson(path.join(scenarioDir, name));
      const resolved = path.join(workDir, name);
      writeJson(resolved, { ...scenario, responses: internalize(scenario.responses, shared) });
      runHost(['--mode', 'replay', '--scenario', resolved, '--out', path.resolve(outDir), '--build', path.resolve(buildRoot)]);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`[visual-diff] captured ${scenarios.length} scenarios into ${outDir}`);
}

/** Scenario ids declared by `Visual-Diff-Allow:` trailers on the commits under comparison. */
function allowedScenarios() {
  const range = process.env.VISUAL_DIFF_RANGE;
  if (!range) return new Set((process.env.VISUAL_DIFF_ALLOW ?? '').split(',').map((id) => id.trim()).filter(Boolean));
  const log = spawnSync('git', ['log', '--format=%B', range], { cwd: repoRoot, encoding: 'utf8' }).stdout ?? '';
  return new Set([...log.matchAll(/^Visual-Diff-Allow:\s*(.+)$/gm)].flatMap((match) => match[1].split(',').map((id) => id.trim())));
}

function compare(baseDir, headDir) {
  const allowed = allowedScenarios();
  const results = fs.readdirSync(headDir).filter((name) => name.endsWith('.json'));
  const unexpected = [];
  for (const name of results) {
    const head = readJson(path.join(headDir, name));
    const base = readJson(path.join(baseDir, name), null);
    if (!base) { console.log(`[visual-diff] ${head.id}: new scenario`); continue; }
    const pixels = base.l2 === head.l2 ? 0 : changedPixels(path.join(baseDir, `${head.id}.png`), path.join(headDir, `${head.id}.png`));
    const changed = [base.l1 !== head.l1 && 'L1', pixels > 0 && `L2 (${pixels} px)`].filter(Boolean);
    if (!changed.length) continue;
    const declared = allowed.has(head.id) || allowed.has('*');
    console.log(`[visual-diff] ${head.id}: ${changed.join('+')} changed${declared ? ' (declared)' : ''}`);
    if (base.l1 !== head.l1) {
      const before = new Set(base.nodes); const after = new Set(head.nodes);
      for (const node of head.nodes.filter((entry) => !before.has(entry)).slice(0, 8)) console.log(`    + ${node}`);
      for (const node of base.nodes.filter((entry) => !after.has(entry)).slice(0, 8)) console.log(`    - ${node}`);
    }
    if (!declared) unexpected.push(head.id);
  }
  if (unexpected.length) fail(`undeclared differences: ${unexpected.join(', ')} (add "Visual-Diff-Allow: <ids>" to the commit that intends them)`);
  console.log('[visual-diff] OK');
}

const [command, ...rest] = process.argv.slice(2);
const option = (name, fallback) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : fallback; };
if (command === 'record') await record(rest);
else if (command === 'capture') capture(rest[0] ?? fail('capture needs an output directory'), option('--build', repoRoot));
else if (command === 'compare') compare(rest[0] ?? fail('compare needs a base directory'), rest[1] ?? fail('compare needs a head directory'));
else fail('usage: run.mjs record [id...] | capture <dir> [--build <root>] | compare <base-dir> <head-dir>');
