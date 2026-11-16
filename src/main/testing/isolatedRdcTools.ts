import path from 'node:path';

/** Isolate native runtime state for an explicit test; the installation is the one the bundled Python belongs to. */
export function isolatedRdcTools(directory: string): Record<string, string> {
  return { RDC_TOOL_INTERMEDIATE_ROOT: path.join(directory, 'runtime') };
}
