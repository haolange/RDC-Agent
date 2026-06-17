import { create } from 'zustand';
import type {
  ProjectInputRecord,
  ProjectRecord,
  SessionRecord,
} from '@shared/types/session';

export type RightRailTarget = 'project' | 'session' | 'source-control';

const areProjectInputsEqual = (
  leftInputs: ProjectInputRecord[],
  rightInputs: ProjectInputRecord[],
): boolean => (
  leftInputs.length === rightInputs.length
  && leftInputs.every((leftInput, index) => {
    const rightInput = rightInputs[index];
    return Boolean(rightInput)
      && leftInput.inputId === rightInput.inputId
      && leftInput.filePath === rightInput.filePath
      && leftInput.lastModifiedAt === rightInput.lastModifiedAt
      && leftInput.size === rightInput.size;
  })
);

interface ProjectState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  rightRailTarget: RightRailTarget;
  projectInputs: ProjectInputRecord[];

  setProjects: (projects: ProjectRecord[]) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentProject: (project: ProjectRecord | null) => void;
  setCurrentSession: (session: SessionRecord | null) => void;
  setRightRailTarget: (target: RightRailTarget) => void;
  setProjectInputs: (inputs: ProjectInputRecord[]) => void;
  updateProjectInputs: (projectId: string, inputs: ProjectInputRecord[]) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  sessions: [],
  currentProject: null,
  currentSession: null,
  rightRailTarget: 'project',
  projectInputs: [],

  setProjects: (projects) => set({ projects }),
  setSessions: (sessions) => set({ sessions }),
  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentSession: (session) => set({ currentSession: session }),
  setRightRailTarget: (rightRailTarget) => set({ rightRailTarget }),
  setProjectInputs: (inputs) => set({ projectInputs: inputs }),
  updateProjectInputs: (projectId, inputs) => set((state) => {
    const inputsUpdatedAt = Date.now();
    const shouldUpdateProjectInputs = state.currentProject?.projectId === projectId
      && !areProjectInputsEqual(state.projectInputs, inputs);
    const shouldUpdateCurrentProject = state.currentProject?.projectId === projectId
      && !areProjectInputsEqual(state.currentProject.inputs ?? [], inputs);
    let didUpdateProjectList = false;
    const projects = state.projects.map((project) => {
      if (project.projectId !== projectId) {
        return project;
      }
      if (areProjectInputsEqual(project.inputs ?? [], inputs)) {
        return project;
      }
      didUpdateProjectList = true;
      return {
        ...project,
        inputs,
        inputsUpdatedAt,
      };
    });

    if (!shouldUpdateProjectInputs && !shouldUpdateCurrentProject && !didUpdateProjectList) {
      return state;
    }

    return {
      ...state,
      projectInputs: shouldUpdateProjectInputs
        ? inputs
        : state.projectInputs,
      currentProject: shouldUpdateCurrentProject && state.currentProject
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
