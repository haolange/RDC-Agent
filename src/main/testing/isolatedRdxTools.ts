import path from 'node:path';

/** Keep one canonical installation while isolating native runtime state for an explicit test. */
export function isolatedRdxTools(directory: string, python: string): Record<string, string> {
  return { RDX_TOOLS_ROOT: path.resolve(path.dirname(python), '../../../..'), RDX_INTERMEDIATE_ROOT: path.join(directory, 'runtime') };
}
