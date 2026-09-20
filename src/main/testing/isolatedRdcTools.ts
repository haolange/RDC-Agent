import path from 'node:path';

/** Keep one canonical installation while isolating native runtime state for an explicit test. */
export function isolatedRdcTools(directory: string, python: string): Record<string, string> {
  return { RDC_TOOL_ROOT: path.resolve(path.dirname(python), '../../../..'), RDC_TOOL_INTERMEDIATE_ROOT: path.join(directory, 'runtime') };
}
