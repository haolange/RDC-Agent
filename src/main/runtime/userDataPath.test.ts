import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveCanonicalUserDataPath } from './userDataPath';

describe('canonical userData path', () => {
  it('uses the same appData location regardless of renderer carrier', () => {
    expect(resolveCanonicalUserDataPath(undefined, path.join('C:', 'Users', 'Vip', 'AppData', 'Roaming')))
      .toBe(path.join('C:', 'Users', 'Vip', 'AppData', 'Roaming', 'rdc-agent'));
  });

  it('honors an explicit automation override', () => {
    const configured = path.join('D:', 'Temp', 'rdc-agent-smoke');
    expect(resolveCanonicalUserDataPath(`  ${configured}  `, 'ignored')).toBe(path.resolve(configured));
  });
});
