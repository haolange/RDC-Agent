import { create } from 'zustand';
import type { ProjectInputRecord, ProjectRecord, SessionRecord } from '@shared/types/session';

export type RightRailTarget = 'project' | 'session';

const areProjectInputsEqual = (leftInputs: ProjectInputRecord[], rightInputs: ProjectInputRecord[]): boolean =>
  leftInputs.length === rightInputs.length &&
  leftInputs.every((leftInput, index) => {
    const rightInput = rightInputs[index];
    return (
      Boolean(rightInput) &&
      leftInput.inputId === rightInput.inputId &&
      leftInput.filePath === rightInput.filePath &&
      leftInput.lastModifiedAt === rightInput.lastModifiedAt &&
      leftInput.size === rightInput.size
    );
  });

interface ProjectState {
  projects: ProjectRecord[];
  /** Sidebar list rows. Session facts (Agent, model, controls) come from `sessionRecordStore`, not from here. */
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  /** The renderer's one active session; its record is `useCurrentSessionView()`. */
  currentSessionId: string | null;
  rightRailTarget: RightRailTarget;
  projectInputs: ProjectInputRecord[];
  /** Bumped to ask the sidebar to open its add-project dialog. */
  addProjectRequest: number;

  requestAddProject: () => void;
  setProjects: (projects: ProjectRecord[]) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentProject: (project: ProjectRecord | null) => void;
  setCurrentSessionId: (sessionId: string | null) => void;
  setRightRailTarget: (target: RightRailTarget) => void;
  setProjectInputs: (inputs: ProjectInputRecord[]) => void;
  updateProjectInputs: (projectId: string, inputs: ProjectInputRecord[]) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  addProjectRequest: 0,
  requestAddProject: () => set((state) => ({ addProjectRequest: state.addProjectRequest + 1 })),
  projects: [],
  sessions: [],
  currentProject: null,
  currentSessionId: null,
  rightRailTarget: 'project',
  projectInputs: [],

  setProjects: (projects) => set({ projects }),
  setSessions: (sessions) => set({ sessions }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
  setRightRailTarget: (rightRailTarget) => set({ rightRailTarget }),
  setProjectInputs: (inputs) => set({ projectInputs: inputs }),
  updateProjectInputs: (projectId, inputs) =>
    set((state) => {
      const inputsUpdatedAt = Date.now();
      const shouldUpdateProjectInputs =
        state.currentProject?.projectId === projectId && !areProjectInputsEqual(state.projectInputs, inputs);
      const shouldUpdateCurrentProject =
        state.currentProject?.projectId === projectId && !areProjectInputsEqual(state.currentProject.inputs, inputs);
      const projects = state.projects.map((project) => {
        if (project.projectId !== projectId) {
          return project;
        }
        if (areProjectInputsEqual(project.inputs, inputs)) {
          return project;
        }
        return {
          ...project,
          inputs,
          inputsUpdatedAt,
        };
      });
      const didUpdateProjectList = projects.some((project, index) => project !== state.projects[index]);

      if (!shouldUpdateProjectInputs && !shouldUpdateCurrentProject && !didUpdateProjectList) {
        return state;
      }

      return {
        ...state,
        projectInputs: shouldUpdateProjectInputs ? inputs : state.projectInputs,
        currentProject:
          shouldUpdateCurrentProject && state.currentProject
            ? {
                ...state.currentProject,
                inputs,
                inputsUpdatedAt,
              }
            : state.currentProject,
        projects,
      };
    }, true),
}));
