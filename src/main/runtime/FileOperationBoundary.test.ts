import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appPathService } from './AppPathService';
import { assertFileWriteBoundary, fileOperationBoundary } from './FileOperationBoundary';

const userData = path.resolve('/fixture/user-data');
const userRoot = path.resolve('/fixture/home/.rdc-agent');

function useFixtureRoots(): void {
  vi.spyOn(appPathService, 'getAppStatePaths').mockReturnValue({
    ...appPathService.getAppStatePaths(),
    appStateRoot: path.join(userData, 'state'),
    secretsPath: path.join(userData, 'secrets'),
  });
  vi.spyOn(appPathService, 'getUserRdcPaths').mockReturnValue({
    ...appPathService.getUserRdcPaths(),
    userRdcRoot: userRoot,
    configPath: path.join(userRoot, 'config.json'),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('application-owned files', () => {
  it("refuses writes that would forge history or widen the agent's own authority", () => {
    useFixtureRoots();
    for (const target of [
      path.join(userData, 'state', 'audit.jsonl'),
      path.join(userData, 'state', 'sessions', 's1', 'session.json'),
      path.join(userData, 'secrets', 'provider.key'),
      path.join(userRoot, 'secrets', 'token'),
      path.join(userRoot, 'config.json'),
      path.join(userData, 'state', 'hook-trust.json'),
      path.join(userRoot, 'mcp-trust.json'),
    ]) {
      expect(fileOperationBoundary(target)).toMatchObject({ readOnly: true, protected: true });
      expect(() => assertFileWriteBoundary(target)).toThrow(/^FILE_WRITE_PROTECTED: /u);
    }
  });

  it('leaves run artifacts writable and keeps ordinary user configuration under approval', () => {
    useFixtureRoots();
    const artifact = path.join(userData, 'state', 'sessions', 's1', 'runs', 'r1', 'artifacts', 'texture.png');
    expect(fileOperationBoundary(artifact)).toMatchObject({ readOnly: false, protected: false });
    expect(fileOperationBoundary(path.join(userRoot, 'policies', 'team.policy.yml'))).toMatchObject({
      readOnly: false,
      protected: true,
    });
  });
});
