import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

// Independent renderer reporting: the main/shared coverage ratchet remains unchanged.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/renderer/**/*.test.ts'],
    coverage: {
      ...base.test?.coverage,
      include: ['src/renderer/**/*.{ts,tsx}'],
      reportsDirectory: './coverage/renderer',
      thresholds: undefined,
    },
  },
});
