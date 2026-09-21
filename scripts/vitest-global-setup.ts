import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest must never discover or mutate the developer's real ~/.rdc-agent or app data.
 * A single isolated root is inherited by every worker for the duration of a run.
 */
export default function setup(): () => void {
  // macOS exposes /var as a symlink to /private/var. Keep the isolated test
  // root canonical so security-sensitive path tests exercise real user paths,
  // not the platform alias that production code must reject.
  const canonicalTempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(canonicalTempRoot, 'rdc-agent-vitest-'));
  const temporaryEnvironment = Object.fromEntries(['TMP', 'TEMP', 'TMPDIR'].map(key => [key, process.env[key]]));
  const temporaryRoot = path.join(root, 'temp');
  fs.mkdirSync(temporaryRoot);
  for (const key of Object.keys(temporaryEnvironment)) process.env[key] = temporaryRoot;
  process.env.RDC_AGENT_HOME = path.join(root, 'user', '.rdc-agent');
  process.env.RDC_AGENT_USER_DATA = path.join(root, 'app-data');
  process.env.RDC_AGENT_QA_INSTANCE_ID = `vitest-${process.pid}`;
  fs.mkdirSync(process.env.RDC_AGENT_HOME, { recursive: true });
  fs.mkdirSync(process.env.RDC_AGENT_USER_DATA, { recursive: true });

  return () => {
    for (const [key, value] of Object.entries(temporaryEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  };
}
