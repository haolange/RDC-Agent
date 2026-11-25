import { mergeUiPreferences } from '@shared/theme/uiPreferences';
import {
  applyAgentModelOp,
  mergeAgentRuntimePatch,
  mergeLayoutPatch,
  mergeToolingPatch,
  normalizeGlobalInstructions,
} from '@shared/utils/settingsPatch';
import { LEFT_DEFAULTS, RIGHT_DEFAULTS } from './settingsDefaults';
import {
  sanitizeAgentPermissionSettings,
  sanitizeAgentRuntimeContextSettings,
  sanitizeAgentShellSettings,
  sanitizeCodeInterpreterSettings,
  sanitizeRdcCliInvokerSettings,
  sanitizeSidebar,
  sanitizeTerminal,
  sanitizeWindow,
} from './settingsSanitize';
import { sanitizeAgentModelSettings } from './agentModelSettings';
import type { SettingsFile } from './settingsFileSchema';
import type { SettingsPatchOp } from '@shared/types/settings';

export interface SettingsPatchPlan {
  next: SettingsFile;
  /** The global instructions to store, when an op set them. */
  globalInstructions?: string;
}

/**
 * Applies `settings:patch` ops in order to the committed file. Each op merges like the renderer's optimistic apply
 * (`@shared/utils/settingsPatch`) and is then sanitized against the section it replaces, so an invalid value keeps
 * the committed one. Provider state is never part of a patch.
 */
export function planSettingsPatch(current: SettingsFile, ops: readonly SettingsPatchOp[]): SettingsPatchPlan {
  let next = current;
  let globalInstructions: string | undefined;
  for (const op of ops) {
    switch (op.op) {
      case 'appearance':
        next = { ...next, appearance: mergeUiPreferences(next.appearance, op.value) };
        break;
      case 'layout': {
        const merged = mergeLayoutPatch(next.layout, op.value);
        next = { ...next, layout: {
          leftSidebar: sanitizeSidebar(merged.leftSidebar, LEFT_DEFAULTS, next.layout.leftSidebar),
          rightPanel: sanitizeSidebar(merged.rightPanel, RIGHT_DEFAULTS, next.layout.rightPanel),
          terminal: sanitizeTerminal(merged.terminal, next.layout.terminal),
          window: sanitizeWindow(merged.window, next.layout.window),
        } };
        break;
      }
      case 'profile': {
        const nickname = op.value.nickname?.trim();
        next = { ...next, profile: {
          nickname: nickname || next.profile.nickname,
          avatarPath: typeof op.value.avatarPath === 'string' ? op.value.avatarPath : next.profile.avatarPath,
        } };
        break;
      }
      case 'tooling': {
        const merged = mergeToolingPatch(next.tooling, op.value);
        next = { ...next, tooling: {
          rdcCli: sanitizeRdcCliInvokerSettings(merged.rdcCli, next.tooling.rdcCli, op.value.rdcCli !== undefined),
          codeInterpreter: sanitizeCodeInterpreterSettings(merged.codeInterpreter, next.tooling.codeInterpreter),
          shell: sanitizeAgentShellSettings(merged.shell, next.tooling.shell),
        } };
        break;
      }
      case 'agentRuntime': {
        const merged = mergeAgentRuntimePatch(next.agentRuntime, op.value);
        next = { ...next, agentRuntime: {
          permissions: sanitizeAgentPermissionSettings(merged.permissions, next.agentRuntime.permissions),
          context: sanitizeAgentRuntimeContextSettings(merged.context, next.agentRuntime.context),
        } };
        break;
      }
      case 'globalInstructions':
        globalInstructions = normalizeGlobalInstructions(op.value);
        break;
      default:
        next = { ...next, agentModels: sanitizeAgentModelSettings(applyAgentModelOp(next.agentModels, op)) };
    }
  }
  return globalInstructions === undefined ? { next } : { next, globalInstructions };
}
