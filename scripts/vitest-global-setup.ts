import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest must never discover or mutate the developer's real ~/.rdx or app data.
 * A single isolated root is inherited by every worker for the duration of a run.
 */
export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-vitest-'));
  process.env.RDC_AGENT_HOME = path.join(root, 'user', '.rdx');
  process.env.RDC_AGENT_USER_DATA = path.join(root, 'app-data');
  process.env.RDC_AGENT_QA_INSTANCE_ID = `vitest-${process.pid}`;
  fs.mkdirSync(process.env.RDC_AGENT_HOME, { recursive: true });
  fs.mkdirSync(process.env.RDC_AGENT_USER_DATA, { recursive: true });

  return () => {
    fs.rmSync(root, { recursive: true, force: true });
  };
}
