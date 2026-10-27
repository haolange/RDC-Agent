import path from 'node:path';

/** Canonical path policy shared by file approval and RDC artifact writes. */
export function fileOperationBoundary(target: string): { readOnly: boolean; protected: boolean; reason: string } {
  const parts = path.resolve(target).replace(/\\/g, '/').toLowerCase().split('/');
  const name = parts.at(-1) ?? '';
  const scope = parts.lastIndexOf('.rdc-agent');
  const category = scope >= 0 ? parts[scope + 1] : '';
  const readOnly = name.endsWith('.rdc') || parts.includes('.git') || ['knowledge', 'inputs'].includes(category);
  const protectedPath = readOnly || ['agents', 'skills', 'hooks', 'policies', 'mcp', 'memory', 'secrets'].includes(category)
    || parts.some(part => ['.agents', '.codex', '.aws', '.ssh'].includes(part))
    || name === '.env' || name.startsWith('.env.') || name === 'config.json' && scope >= 0;
  return { readOnly, protected: protectedPath, reason: readOnly ? 'Capture inputs, Git metadata and canonical knowledge are not generic write targets.'
    : protectedPath ? 'Writing runtime configuration or credential-related paths requires specific authorization.' : 'Ordinary workspace text target.' };
}

export function assertFileWriteBoundary(target: string): void {
  const boundary = fileOperationBoundary(target);
  if (boundary.readOnly) throw new Error(`FILE_WRITE_PROTECTED: ${boundary.reason}`);
}
