import fs from 'node:fs';
import path from 'node:path';

/** Isolate native CLI context accounting without copying the bundled runtime or touching other contexts. */
export function isolatedRdxTools(directory: string, python: string): Record<string, string> {
  const source = path.resolve(path.dirname(python), '../../../..');
  const root = path.join(directory, 'tools');
  fs.mkdirSync(root);
  for (const name of ['rdx', 'binaries', 'cli', 'policy', 'spec']) {
    const target = path.join(source, name);
    if (fs.existsSync(target)) fs.symlinkSync(target, path.join(root, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  return { RDX_TOOLS_ROOT: root };
}
