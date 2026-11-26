import { useAppSettingsStore } from '../stores/appSettingsStore';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsNavigationStore } from '../stores/settingsNavigationStore';

export type WorkbenchSetupStepId = 'rdcTool' | 'model' | 'project';

export interface WorkbenchSetupStep {
  id: WorkbenchSetupStepId;
  done: boolean;
  act: () => void;
}

/**
 * What still stands between the person and a first investigation, read from the live configuration:
 * an RDC tool, a connected model service and a project. Nothing is remembered as "seen".
 */
export function useWorkbenchSetup(): WorkbenchSetupStep[] {
  const rdcCli = useAppSettingsStore((state) => state.settings.tooling.rdcCli);
  const modelConnected = useAppSettingsStore((state) =>
    state.settings.llm.providers.some((provider) => provider.enabled && provider.isConfigured),
  );
  const hasProject = useProjectStore((state) => state.projects.length > 0);
  const requestAddProject = useProjectStore((state) => state.requestAddProject);
  const openSection = useSettingsNavigationStore((state) => state.openSection);
  return [
    { id: 'rdcTool', done: rdcCli.enabled && rdcCli.command.trim().length > 0, act: () => openSection('tools') },
    { id: 'model', done: modelConnected, act: () => openSection('models') },
    { id: 'project', done: hasProject, act: requestAddProject },
  ];
}
