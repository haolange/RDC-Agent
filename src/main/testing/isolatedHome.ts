import os from 'os';
import { vi } from 'vitest';

/**
 * Points the user's home directory at `home` for code under test, so the user resource root becomes
 * `<home>/.rdc-agent`. Returns the function that restores the real home.
 */
export function isolateHome(home: string): () => void {
  const spy = vi.spyOn(os, 'homedir').mockReturnValue(home);
  return () => spy.mockRestore();
}
