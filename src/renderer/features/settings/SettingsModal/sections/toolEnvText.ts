/** `NAME=value` per line ⇄ record, shared by the local tool forms (RenderDoc CLI, RDX actions). */
export function envToText(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');
}

export function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key) continue;
    env[key] = line.slice(separatorIndex + 1);
  }
  return env;
}

export function splitArgs(text: string): string[] {
  return text.split(/\s+/).map((entry) => entry.trim()).filter(Boolean);
}
