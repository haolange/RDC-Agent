import { useCallback, useState, type MouseEvent } from 'react';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';

export const getProjectOriginName = (project: ProjectRecord): string => {
  const normalizedRootPath = project.rootPath.trim().replace(/[\\/]+$/, '');
  const segments = normalizedRootPath.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || project.rootPath;
};

export function useProjectTree() {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [showAllSessionsByProject, setShowAllSessionsByProject] = useState<Record<string, boolean>>({});
  const [projectSessionsByProject, setProjectSessionsByProject] = useState<Record<string, SessionRecord[]>>({});

  const ensureProjectExpanded = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => (
      current.includes(projectId) ? current : [...current, projectId]
    ));
  }, []);

  const loadProjectSessionList = useCallback(async (projectId: string) => {
    const result = await window.electronAPI.session.list(projectId);
    const nextSessions = result.sessions ?? [];
    setProjectSessionsByProject((current) => ({
      ...current,
      [projectId]: nextSessions,
    }));
    return nextSessions;
  }, []);

  const pruneTreeForProjects = useCallback((visibleProjectIds: Set<string>) => {
    setExpandedProjectIds((current) => current.filter((projectId) => visibleProjectIds.has(projectId)));
    setShowAllSessionsByProject((current) => Object.fromEntries(
      Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
    ));
    setProjectSessionsByProject((current) => Object.fromEntries(
      Object.entries(current).filter(([projectId]) => visibleProjectIds.has(projectId)),
    ));
  }, []);

  const resetTree = useCallback(() => {
    setShowAllSessionsByProject({});
    setProjectSessionsByProject({});
  }, []);

  const toggleProjectExpanded = useCallback(async (project: ProjectRecord) => {
    const isExpanded = expandedProjectIds.includes(project.projectId);
    if (isExpanded) {
      setExpandedProjectIds((current) => current.filter((projectId) => projectId !== project.projectId));
      return;
    }

    ensureProjectExpanded(project.projectId);
    if (!projectSessionsByProject[project.projectId]) {
      await loadProjectSessionList(project.projectId);
    }
  }, [ensureProjectExpanded, expandedProjectIds, loadProjectSessionList, projectSessionsByProject]);

  const toggleShowAllSessions = useCallback((event: MouseEvent, projectId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setShowAllSessionsByProject((current) => ({
      ...current,
      [projectId]: !current[projectId],
    }));
  }, []);

  return {
    expandedProjectIds,
    showAllSessionsByProject,
    projectSessionsByProject,
    setProjectSessionsByProject,
    ensureProjectExpanded,
    loadProjectSessionList,
    pruneTreeForProjects,
    resetTree,
    toggleProjectExpanded,
    toggleShowAllSessions,
  };
}
