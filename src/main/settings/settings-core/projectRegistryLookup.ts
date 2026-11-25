import path from 'node:path';
import { appPathService } from '../../runtime/AppPathService';
import { StorageIo } from '../../sessions/store/StorageIo';
import { PROJECT_REGISTRY_MIGRATIONS, SelectionStateSchema } from '../../sessions/store/storageSchema';
import { StampedValue, fileStamp } from './externalInput';

const io = new StorageIo();

/**
 * The project registry and the current selection are written by the session store, which changes them whenever the
 * user switches project. Each lookup checks the file's stamp (one stat) and parses it again only after it changed.
 */
const stampedFiles = new Map<string, StampedValue<unknown>>();

function readStamped<T>(filePath: string, read: () => T): T {
  let value = stampedFiles.get(filePath) as StampedValue<T> | undefined;
  if (!value) {
    value = new StampedValue(() => fileStamp(filePath), read);
    stampedFiles.set(filePath, value as StampedValue<unknown>);
  }
  value.revalidate();
  return value.get();
}

function projectRegistryPath(): string {
  return path.join(appPathService.getRuntimePaths().projectsPath, 'registry.json');
}

function projectSelectionPath(): string {
  return path.join(appPathService.getRuntimePaths().projectsPath, 'selection.json');
}

export function lookupProjectById(projectId: string): { projectId: string; rootPath: string } | null {
  const filePath = projectRegistryPath();
  const registry = readStamped(filePath, () => io.readJson(filePath, PROJECT_REGISTRY_MIGRATIONS));
  const project = registry?.projects.find((entry) => entry.projectId === projectId);
  if (!project?.rootPath) return null;
  return { projectId: project.projectId, rootPath: project.rootPath };
}

export function lookupCurrentProjectId(): string | null {
  const filePath = projectSelectionPath();
  return readStamped(filePath, () => {
    const raw = io.readJson(filePath);
    if (raw == null) return null;
    const parsed = SelectionStateSchema.safeParse(raw);
    return parsed.success ? parsed.data.projectId : null;
  });
}
