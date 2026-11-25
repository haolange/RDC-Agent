/**
 * The development renderer (Vite URL, `unsafe-eval` in the CSP) is only for an unpackaged source run. A packaged build
 * never enters it, whatever its environment says, so an environment variable cannot weaken a shipped app.
 */
export function isDevelopmentRun(input: { isPackaged: boolean; env: NodeJS.ProcessEnv }): boolean {
  return !input.isPackaged && input.env.NODE_ENV === 'development';
}
