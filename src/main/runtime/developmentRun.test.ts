import { describe, expect, it } from 'vitest';
import { isDevelopmentRun } from './developmentRun';

describe('development run', () => {
  it('is never entered by a packaged build, whatever the environment says', () => {
    expect(isDevelopmentRun({ isPackaged: true, env: { NODE_ENV: 'development' } })).toBe(false);
    expect(isDevelopmentRun({ isPackaged: false, env: { NODE_ENV: 'development' } })).toBe(true);
    expect(isDevelopmentRun({ isPackaged: false, env: { NODE_ENV: 'production' } })).toBe(false);
  });
});
