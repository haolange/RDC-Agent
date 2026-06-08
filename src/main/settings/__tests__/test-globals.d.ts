/**
 * Ambient type declarations for test globals (describe, test, expect).
 * Allows test files to pass TypeScript type checking without requiring
 * a test runner to be installed.
 */

declare function describe(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function expect<T>(value: T): {
  toBe(expected: unknown): void;
  toBeDefined(): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toBeGreaterThanOrEqual(expected: number): void;
  not: {
    toContain(expected: unknown): void;
  };
};
