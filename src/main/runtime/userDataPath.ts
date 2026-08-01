import path from 'path';

export function resolveCanonicalUserDataPath(configuredPath: string | undefined, appDataRoot: string): string {
  const configured = configuredPath?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(appDataRoot, 'rdc-agent');
}
