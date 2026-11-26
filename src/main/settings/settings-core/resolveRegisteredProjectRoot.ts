import { AppError } from '@shared/errors/appError';
import { lookupCurrentProjectId, lookupProjectById } from './projectRegistryLookup';

const PATH_LIKE_PROJECT_ID = /[\\/]|^[A-Za-z]:|\.\./;

export function assertRegisteredProjectId(projectId?: string | null): string {
  const id = projectId?.trim() ?? '';
  if (!id) {
    throw new AppError('AGENT_MANIFEST_PROJECT_ID_REQUIRED', 'project scope requires a registered projectId.');
  }
  if (PATH_LIKE_PROJECT_ID.test(id)) {
    throw new AppError('AGENT_MANIFEST_PROJECT_ID_INVALID', 'projectId is a registry id, not a filesystem path.');
  }
  return id;
}

export function resolveRegisteredProjectRoot(projectId?: string | null): string {
  const id = assertRegisteredProjectId(projectId);
  const project = lookupProjectById(id);
  if (!project?.rootPath) {
    throw new AppError('AGENT_MANIFEST_PROJECT_UNKNOWN', `${id} is not in the project registry.`);
  }
  return project.rootPath;
}

/** The project main has selected, or null when none is (or the selection cannot be read). */
export function tryCurrentProjectId(): string | null {
  try {
    return lookupCurrentProjectId() || null;
  } catch {
    return null;
  }
}

export function tryCurrentProjectRoot(): string | undefined {
  try {
    const projectId = lookupCurrentProjectId();
    if (!projectId) return undefined;
    return lookupProjectById(projectId)?.rootPath;
  } catch {
    return undefined;
  }
}
