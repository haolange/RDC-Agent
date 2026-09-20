import fs from 'fs';
import path from 'path';
import { appPathService } from './AppPathService';

/** UI acknowledgement only; never evidence that a provider or tool is configured. */
export function hasSeenGettingStarted(): boolean {
  return fs.existsSync(path.join(appPathService.getAppStatePaths().profileStatePath, 'getting-started.seen'));
}

export function acknowledgeGettingStarted(): void {
  const directory = appPathService.getAppStatePaths().profileStatePath;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'getting-started.seen'), '', { flag: 'a' });
}
