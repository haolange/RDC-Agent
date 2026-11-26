#!/usr/bin/env node
// Differential rendering harness.
//   node scripts/visual-diff/run.mjs record [id...]   record scenarios against a disposable Browser QA instance
//     (scenarios whose setup connects Ollama expect `node scripts/qa-ollama-stub.mjs` to be running)
//   node scripts/visual-diff/run.mjs capture <dir> [--build <root>]   replay every scenario and write L1/L2/L3 results
//   node scripts/visual-diff/run.mjs compare <base-dir> <head-dir>   fail on differences not declared by Visual-Diff-Allow
// Recordings live in scripts/visual-diff/scenarios; responses larger than 4 KiB are stored once in shared.json.
// Definitions (scenarios.json) name reusable setup sequences in `presets`; a step `{ "preset": "<name>" }` expands
// to that sequence. Each scenario renders in every theme × width variant unless it declares `variants`.
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

const fail = (message) => {
  console.error(`[visual-diff] ${message}`);
  process.exit(1);
};
const electronBinary = () =>
  process.env.VISUAL_DIFF_ELECTRON ||
  path.join(repoRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

/** The host command line: under xvfb on a Linux machine without a display. */
function hostCommand(args, profileDir) {
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  const hostArgs = [
    path.join(here, 'host', 'main.mjs'),
    '--',
    ...args,
    ...(profileDir ? ['--profile', profileDir] : []),
  ];
  return xvfb
    ? ['xvfb-run', ['-a', '-s', '-screen 0 1920x1200x24', electronBinary(), ...hostArgs]]
    : [electronBinary(), hostArgs];
}

/** Runs a host that renders nothing (the image diff) and waits for it. */
function runHost(args) {
  const [command, full] = hostCommand(args, null);
  const result = spawnSync(command, full, { cwd: repoRoot, encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0)
    fail(`host failed (${args.join(' ')}):\n${(result.stderr || result.stdout || '').slice(-2000)}`);
  return result.stdout;
}

/**
 * Runs a rendering host to completion. It gets a throwaway Electron profile that is removed here once the host is
 * gone, whether it exited, crashed or timed out: the host itself ends with app.exit(), which skips process exit
 * handlers.
 */
function renderHost(args, timeoutMs) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-visual-diff-host-'));
  const [command, full] = hostCommand(args, profileDir);
  return new Promise((resolve) => {
    const child = spawn(command, full, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => process.kill(-child.pid, 'SIGKILL'), timeoutMs);
    child.on('close', (status) => {
      clearTimeout(timer);
      // Whatever the host left in its group (a virtual display xvfb-run could not clean up) goes with it.
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* the group is already gone */
      }
      fs.rmSync(profileDir, { recursive: true, force: true });
      resolve({ status, stdout, stderr });
    });
  });
}

/** Pixels that changed beyond antialiasing noise; bitmaps with equal hashes are identical. */
function changedPixels(basePng, headPng) {
  const output = runHost(['--mode', 'diff', '--a', basePng, '--b', headPng]);
  return JSON.parse(
    output
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .at(-1),
  ).pixels;
}

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);

/** Large answers (the settings DTO, histories) are kept once and referenced by content hash. */
function externalize(responses, shared) {
  return Object.fromEntries(
    Object.entries(responses).map(([channel, entries]) => [
      channel,
      entries.map((entry) => {
        const text = JSON.stringify(entry);
        if (text.length < SHARED_MIN_BYTES) return entry;
        const ref = createHash('sha256').update(text).digest('hex').slice(0, 24);
        shared[ref] = entry;
        return { ref };
      }),
    ]),
  );
}

function internalize(responses, shared) {
  return Object.fromEntries(
    Object.entries(responses).map(([channel, entries]) => [
      channel,
      entries.map((entry) => (entry.ref ? shared[entry.ref] : entry)),
    ]),
  );
}

/** The processes of a group other than its leader. */
function groupMembers(pgid) {
  const listing = spawnSync('ps', ['-eo', 'pid=,pgid='], { encoding: 'utf8' }).stdout ?? '';
  return listing
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, group]) => group === pgid && pid !== pgid)
    .map(([pid]) => pid);
}

/**
 * Stops the instance's whole process group and waits until it is gone, so the next instance can take the port. Under
 * xvfb-run the members go first: xvfb-run, the group leader, then sees its program exit and removes its virtual
 * display and temporary directory itself, which a signal to the whole group would not let it do.
 */
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
  const wait = async (attempts) => {
    for (let attempt = 0; attempt < attempts && alive(); attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 100));
  };
  if (child.spawnargs[0] === 'xvfb-run') {
    for (const pid of groupMembers(child.pid).filter((pid) => !/Xvfb/.test(processName(pid)))) {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
    await wait(50);
  }
  if (alive()) process.kill(-child.pid);
  await wait(100);
}

function processName(pid) {
  return (spawnSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim();
}

async function startQaInstance(workDir) {
  const log = path.join(workDir, 'qa.log');
  // No RDC_AGENT_USER_DATA: the launcher then creates a disposable userData with its own user resource root, so a
  // recording never reads or writes the machine's ~/.rdc-agent.
  const env = { ...process.env, RDC_AGENT_BROWSER_QA_FULL_ACCESS: '1' };
  delete env.RDC_AGENT_USER_DATA;
  const xvfb = process.platform === 'linux' && !process.env.DISPLAY;
  // With VISUAL_DIFF_ELECTRON the instance is that Electron on the current build (run `pnpm run build` first), in
  // the launcher's browser mode environment; otherwise the shared launcher prepares and starts it.
  const direct = Boolean(process.env.VISUAL_DIFF_ELECTRON);
  if (direct) Object.assign(env, { NODE_ENV: 'production', RDC_AGENT_HEADLESS: '1', RDC_AGENT_BROWSER_QA: '1' });
  const instance = direct
    ? [electronBinary(), repoRoot]
    : [process.execPath, 'scripts/launch-rdc-agent.mjs', '--mode', 'browser'];
  const child = spawn(xvfb ? 'xvfb-run' : instance[0], xvfb ? ['-a', ...instance] : instance.slice(1), {
    cwd: repoRoot,
    env,
    stdio: ['ignore', fs.openSync(log, 'w'), fs.openSync(log, 'a')],
    detached: true,
  });
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

/** A definition with its preset steps expanded in place. */
function expandPresets(definition, presets) {
  const expand = (steps) =>
    (steps ?? []).flatMap((step) => {
      if (!step.preset) return [step];
      if (!presets[step.preset]) fail(`${definition.id}: unknown preset ${step.preset}`);
      return expand(presets[step.preset]);
    });
  return { ...definition, setup: expand(definition.setup), steps: expand(definition.steps) };
}

async function record(ids) {
  const { presets = {}, scenarios: definitions = [] } = readJson(definitionsPath, {});
  const selected = (ids.length ? definitions.filter((definition) => ids.includes(definition.id)) : definitions).map(
    (definition) => expandPresets(definition, presets),
  );
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
      const args = ['--mode', 'record', '--scenario', definitionPath, '--bridge', url, '--out', recordedPath];
      const result = await renderHost([...args, '--build', repoRoot, '--userdata', userData], 10 * 60_000);
      // Thrown, not fail(): the finally below still stops the instance and removes its directories.
      if (result.status !== 0)
        throw new Error(`recording ${definition.id} failed:\n${(result.stderr || result.stdout || '').slice(-2000)}`);
      // The disposable instance's directories and the checkout's location differ per run and machine; fixed
      // placeholders keep machine paths out of the recordings and let identical answers dedupe.
      const recorded = JSON.parse(
        fs
          .readFileSync(recordedPath, 'utf8')
          .split(JSON.stringify(userData).slice(1, -1))
          .join('/visual-diff')
          .split(JSON.stringify(repoRoot).slice(1, -1))
          .join('/visual-diff-repo'),
      );
      writeJson(path.join(scenarioDir, `${definition.id}.json`), {
        ...recorded,
        responses: externalize(recorded.responses, shared),
      });
      // Kept after every scenario, so a later failure leaves no recording pointing at an unsaved shared answer.
      writeJson(sharedPath, shared);
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
  const referenced = new Set(
    fs
      .readdirSync(scenarioDir)
      .filter((name) => name !== 'shared.json' && name.endsWith('.json'))
      .flatMap((name) =>
        Object.values(readJson(path.join(scenarioDir, name), {}).responses ?? {})
          .flat()
          .map((entry) => entry.ref)
          .filter(Boolean),
      ),
  );
  writeJson(
    sharedPath,
    Object.fromEntries(
      Object.entries(shared)
        .filter(([ref]) => referenced.has(ref))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

/** Scenario shards rendered side by side, each by its own host on its own virtual display. */
const captureJobs = () =>
  Math.max(1, Number(process.env.VISUAL_DIFF_JOBS) || Math.min(3, Math.max(1, os.availableParallelism() - 1)));

async function capture(outDir, buildRoot) {
  const shared = readJson(sharedPath, {});
  const scenarios = fs
    .readdirSync(scenarioDir)
    .filter((name) => name !== 'shared.json' && name.endsWith('.json'))
    .sort();
  if (!scenarios.length) fail('no recorded scenarios');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-visual-diff-'));
  const otherBuild = path.resolve(buildRoot) !== repoRoot;
  const started = Date.now();
  try {
    const resolved = scenarios.map((name) => {
      const scenario = readJson(path.join(scenarioDir, name));
      const file = path.join(workDir, name);
      writeJson(file, { ...scenario, responses: internalize(scenario.responses, shared) });
      return file;
    });
    const jobs = Math.min(captureJobs(), resolved.length);
    const shards = Array.from({ length: jobs }, (_, shard) => resolved.filter((_, index) => index % jobs === shard));
    const results = await Promise.all(
      shards.map((files, shard) => {
        const list = path.join(workDir, `shard-${shard}.list.json`);
        writeJson(list, files);
        const args = ['--mode', 'replay', '--scenarios', list, '--out', path.resolve(outDir)];
        return renderHost([...args, '--build', path.resolve(buildRoot)], 20 * 60_000);
      }),
    );
    const failed = [];
    for (const result of results) {
      const summary = result.stdout
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .at(-1);
      if (result.status !== 0 || !summary) fail(`host failed:\n${(result.stderr || result.stdout || '').slice(-3000)}`);
      failed.push(...JSON.parse(summary).failed);
      if (JSON.parse(summary).failed.length) console.error(result.stderr.slice(-3000));
    }
    // Another build (the comparison base) may predate the UI a newer scenario reaches; it then has no result and
    // compare reports the scenario as new. The checkout's own build must render every scenario.
    if (failed.length && !otherBuild) fail(`scenarios failed to render: ${failed.join(', ')}`);
    for (const id of failed) console.log(`[visual-diff] ${id}: not renderable in ${buildRoot}`);
    const renders = fs.readdirSync(outDir).filter((name) => name.endsWith('.json')).length;
    console.log(
      `[visual-diff] captured ${scenarios.length - failed.length} scenarios (${renders} renders, ${jobs} hosts, ` +
        `${Math.round((Date.now() - started) / 1000)} s) into ${outDir}`,
    );
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Scenario ids declared by `Visual-Diff-Allow:` trailers on the commits under comparison. */
function allowedScenarios() {
  const range = process.env.VISUAL_DIFF_RANGE;
  if (!range)
    return new Set(
      (process.env.VISUAL_DIFF_ALLOW ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  const log = spawnSync('git', ['log', '--format=%B', range], { cwd: repoRoot, encoding: 'utf8' }).stdout ?? '';
  return new Set(
    [...log.matchAll(/^Visual-Diff-Allow:\s*(.+)$/gm)].flatMap((match) => match[1].split(',').map((id) => id.trim())),
  );
}

/** The interaction steps whose settled state or flicker set differ, with the first differing keys. */
function interactionChanges(base, head) {
  const lines = [];
  const steps = Math.max(base.steps.length, head.steps.length);
  for (let index = 0; index < steps; index += 1) {
    const [before, after] = [base.steps[index], head.steps[index]];
    if (!before || !after) {
      lines.push(`step ${(before ?? after).step}: sampled only in ${before ? 'base' : 'head'}`);
      continue;
    }
    const label = `step ${after.step}`;
    const keys = new Set([...Object.keys(before.settled ?? {}), ...Object.keys(after.settled ?? {})]);
    const settled = [...keys].filter((key) => before.settled?.[key] !== after.settled?.[key]);
    for (const key of settled.slice(0, 6))
      lines.push(`${label} settled ${key}: ${before.settled?.[key] ?? '-'} -> ${after.settled?.[key] ?? '-'}`);
    if (before.flicker.join() !== after.flicker.join())
      for (const key of after.flicker.filter((name) => !before.flicker.includes(name)))
        lines.push(`${label} flickers ${key}: ${after.changes[key]?.join(' -> ')}`);
    for (const key of before.flicker.filter((name) => !after.flicker.includes(name)))
      lines.push(`${label} no longer flickers ${key}`);
  }
  return lines;
}

function compare(baseDir, headDir) {
  const allowed = allowedScenarios();
  const results = fs.readdirSync(headDir).filter((name) => name.endsWith('.json'));
  const unexpected = new Set();
  for (const name of results) {
    const head = readJson(path.join(headDir, name));
    const base = readJson(path.join(baseDir, name), null);
    if (!base) {
      console.log(`[visual-diff] ${head.id}: new scenario`);
      continue;
    }
    const pixels =
      base.l2 === head.l2
        ? 0
        : changedPixels(path.join(baseDir, `${head.id}.png`), path.join(headDir, `${head.id}.png`));
    const changed = [base.l1 !== head.l1 && 'L1', pixels > 0 && `L2 (${pixels} px)`, base.l3 !== head.l3 && 'L3'];
    if (!changed.some(Boolean)) continue;
    const declared = allowed.has(head.scenario) || allowed.has(head.id) || allowed.has('*');
    console.log(
      `[visual-diff] ${head.id}: ${changed.filter(Boolean).join('+')} changed${declared ? ' (declared)' : ''}`,
    );
    if (base.l1 !== head.l1) {
      const before = new Set(base.nodes);
      const after = new Set(head.nodes);
      for (const node of head.nodes.filter((entry) => !before.has(entry)).slice(0, 8)) console.log(`    + ${node}`);
      for (const node of base.nodes.filter((entry) => !after.has(entry)).slice(0, 8)) console.log(`    - ${node}`);
    }
    if (base.l3 !== head.l3) for (const line of interactionChanges(base, head).slice(0, 12)) console.log(`    ${line}`);
    if (!declared) unexpected.add(head.scenario);
  }
  if (unexpected.size)
    fail(
      `undeclared differences: ${[...unexpected].join(', ')} (add "Visual-Diff-Allow: <ids>" to the commit that intends them)`,
    );
  console.log(`[visual-diff] OK (${results.length} renders)`);
}

const [command, ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : fallback;
};
if (command === 'record') await record(rest);
else if (command === 'capture')
  await capture(rest[0] ?? fail('capture needs an output directory'), option('--build', repoRoot));
else if (command === 'compare')
  compare(rest[0] ?? fail('compare needs a base directory'), rest[1] ?? fail('compare needs a head directory'));
else fail('usage: run.mjs record [id...] | capture <dir> [--build <root>] | compare <base-dir> <head-dir>');
