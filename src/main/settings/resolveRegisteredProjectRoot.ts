import { lookupCurrentProjectId, lookupProjectById } from './projectRegistryLookup';

const PATH_LIKE_PROJECT_ID = /[\\/]|^[A-Za-z]:|\.\./;

export function assertRegisteredProjectId(projectId?: string | null): string {
  const id = projectId?.trim() ?? '';
  if (!id) {
    throw new Error('AGENT_MANIFEST_PROJECT_ID_REQUIRED: project scope requires a registered projectId.');
  }
  if (PATH_LIKE_PROJECT_ID.test(id)) {
    throw new Error('AGENT_MANIFEST_PROJECT_ID_INVALID: projectId is a registry id, not a filesystem path.');
  }
  return id;
}

export function resolveRegisteredProjectRoot(projectId?: string | null): string {
  const id = assertRegisteredProjectId(projectId);
  const project = lookupProjectById(id);
  if (!project?.rootPath) {
    throw new Error(`AGENT_MANIFEST_PROJECT_UNKNOWN: ${id} is not in the project registry.`);
  }
  return project.rootPath;
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
