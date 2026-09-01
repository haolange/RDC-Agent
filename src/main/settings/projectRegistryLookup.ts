import path from 'node:path';
import { appPathService } from '../runtime/AppPathService';
import { StorageIo } from '../sessions/StorageIo';
import { PROJECT_REGISTRY_MIGRATIONS, SelectionStateSchema } from '../sessions/storageSchema';

const io = new StorageIo();

function projectRegistryPath(): string {
  return path.join(appPathService.getRuntimePaths().projectsPath, 'registry.json');
}

function projectSelectionPath(): string {
  return path.join(appPathService.getRuntimePaths().projectsPath, 'selection.json');
}

export function lookupProjectById(projectId: string): { projectId: string; rootPath: string } | null {
  const registry = io.readJson(projectRegistryPath(), PROJECT_REGISTRY_MIGRATIONS);
  const project = registry?.projects.find((entry) => entry.projectId === projectId);
  if (!project?.rootPath) return null;
  return { projectId: project.projectId, rootPath: project.rootPath };
}

export function lookupCurrentProjectId(): string | null {
  const raw = io.readJson(projectSelectionPath());
  if (raw == null) return null;
  const parsed = SelectionStateSchema.safeParse(raw);
  return parsed.success ? parsed.data.projectId : null;
}
