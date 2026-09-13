import { useMemo } from 'react';
import type {
  AgentShellSettings,
  AppSettings,
  CodeInterpreterSettings,
  RdxCliInvokerSettings,
} from '@shared/types/settings';

export interface ToolsDrafts {
  rdxCli: RdxCliInvokerSettings;
  codeInterpreter: CodeInterpreterSettings;
  shell: AgentShellSettings;
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, entry: unknown) => {
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    return Object.keys(entry as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (entry as Record<string, unknown>)[key];
      return acc;
    }, {});
  }
  return entry;
});

/** Manual-save forms only; auto-saved surfaces (Agents, Appearance) never register here. */
export type ManualSaveForm = 'tools' | 'profile' | 'personalization';

export type SettingsDirtyState = Record<ManualSaveForm, boolean>;

export function computeSettingsDirty(
  settings: AppSettings,
  drafts: {
    tools: ToolsDrafts;
    profile: AppSettings['profile'];
    globalInstructions: string;
  },
): SettingsDirtyState {
  const toolsBaseline: ToolsDrafts = {
    rdxCli: settings.tooling.rdxCli,
    codeInterpreter: settings.tooling.codeInterpreter,
    shell: settings.tooling.shell,
  };
  return {
    tools: stable(toolsBaseline) !== stable(drafts.tools),
    profile: stable(settings.profile) !== stable(drafts.profile),
    personalization: settings.agents.globalInstructions !== drafts.globalInstructions,
  };
}

export function dirtyForms(state: SettingsDirtyState): ManualSaveForm[] {
  return (Object.keys(state) as ManualSaveForm[]).filter((key) => state[key]);
}

/** Memoized dirty state for the Settings modal drafts. */
export function useSettingsDirty(
  settings: AppSettings,
  drafts: { tools: ToolsDrafts; profile: AppSettings['profile']; globalInstructions: string },
): SettingsDirtyState {
  const { rdxCli, codeInterpreter, shell } = drafts.tools;
  const { profile, globalInstructions } = drafts;
  return useMemo(
    () => computeSettingsDirty(settings, { tools: { rdxCli, codeInterpreter, shell }, profile, globalInstructions }),
    [settings, rdxCli, codeInterpreter, shell, profile, globalInstructions],
  );
}
