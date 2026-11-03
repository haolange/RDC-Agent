import { useEffect } from 'react';
import { useProjectStore } from '../../stores/projectStore';

export function useProjectInputsBootstrap(shellReady: boolean): void {
  const currentProject = useProjectStore((state) => state.currentProject);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!currentProject) {
      useProjectStore.getState().setProjectInputs([]);
      return;
    }
    if (!shellReady) return;
    if (!electronAPI) {
      useProjectStore.getState().updateProjectInputs(currentProject.projectId, currentProject.inputs ?? []);
      return;
    }
    void electronAPI.project.inputs.list(currentProject.projectId)
      .then((result) => {
        useProjectStore.getState().updateProjectInputs(currentProject.projectId, result.inputs ?? []);
      })
      .catch(() => {
        useProjectStore.getState().updateProjectInputs(currentProject.projectId, currentProject.inputs ?? []);
      });
  }, [currentProject, shellReady]);
}
