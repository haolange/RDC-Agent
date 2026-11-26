import { applyAgentModelChanges, applySettingsPatchOps, type SettingsPatchView } from '@shared/utils/settingsPatch';
import type { AppSettings, SettingsPatchChanges, SettingsPatchOp, SettingsPatchResult } from '@shared/types/settings';

/** How an intent, or main's answer to one, changes the settings. */
export type SettingsOverlay = (settings: AppSettings) => AppSettings;

const patchViewOf = (settings: AppSettings): SettingsPatchView => ({
  appearance: settings.appearance,
  layout: settings.layout,
  profile: settings.profile,
  tooling: settings.tooling,
  agentRuntime: settings.agentRuntime,
  agentModels: settings.agentModels,
  globalInstructions: settings.agents.globalInstructions,
});

const withPatchView = (settings: AppSettings, view: SettingsPatchView): AppSettings => ({
  ...settings,
  appearance: view.appearance,
  layout: view.layout,
  profile: view.profile,
  tooling: view.tooling,
  agentRuntime: view.agentRuntime,
  agentModels: view.agentModels,
  agents: { ...settings.agents, globalInstructions: view.globalInstructions },
});

function applyChanges(
  view: SettingsPatchView,
  changed: SettingsPatchChanges,
  ops: readonly SettingsPatchOp[],
): SettingsPatchView {
  const instructions = [...ops].reverse().find((op) => op.op === 'globalInstructions');
  return {
    appearance: changed.appearance ?? view.appearance,
    layout: changed.layout ?? view.layout,
    profile: changed.profile ?? view.profile,
    tooling: changed.tooling ?? view.tooling,
    agentRuntime: changed.agentRuntime ?? view.agentRuntime,
    agentModels: changed.agentModels ? applyAgentModelChanges(view.agentModels, changed.agentModels) : view.agentModels,
    // Main stores the instructions as sent (normalized); the committed text is the one the op carried.
    globalInstructions:
      changed.globalInstructions && instructions
        ? applySettingsPatchOps(view, [instructions]).globalInstructions
        : view.globalInstructions,
  };
}

/** A `settings:patch` shown before main answers: its ops replayed on the settings, in order. */
export const patchOverlay =
  (ops: readonly SettingsPatchOp[]): SettingsOverlay =>
  (settings) =>
    withPatchView(settings, applySettingsPatchOps(patchViewOf(settings), ops));

/** What main committed for a `settings:patch`: the sections it reported changed. */
export const patchCommit =
  (ops: readonly SettingsPatchOp[], result: SettingsPatchResult): SettingsOverlay =>
  (settings) =>
    withPatchView(settings, applyChanges(patchViewOf(settings), result.changed, ops));

/**
 * The renderer's settings: what main confirmed, at the settings revision it confirmed it, with every intent still in
 * flight replayed on top in the order it began. Each intent (a `settings:patch`, a provider's model choices, an Agent
 * definition) is an overlay. Main's answer folds into the confirmed settings; a failure only drops the overlay, which
 * rolls back exactly what that intent changed while later intents, and other fields of the same section, stay as the
 * person set them. Nothing replaces the settings whole except a view main sent at a revision not older than the one
 * confirmed.
 */
export class SettingsIntents {
  private revision = 0;
  private readonly pending = new Map<number, SettingsOverlay>();
  private sequence = 0;

  constructor(private confirmed: AppSettings) {}

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  /** Startup: the first view main sent, with nothing in flight yet. */
  start(settings: AppSettings, revision: number): AppSettings {
    this.pending.clear();
    this.confirmed = settings;
    this.revision = revision;
    return settings;
  }

  /** Adopts a view main sent whole at `revision`; one older than the confirmed settings changes nothing. */
  rebase(settings: AppSettings, revision: number): AppSettings {
    if (revision >= this.revision) {
      this.confirmed = settings;
      this.revision = revision;
    }
    return this.project();
  }

  /** A change main confirmed through another command (the permission mode). */
  confirm(commit: SettingsOverlay): AppSettings {
    this.confirmed = commit(this.confirmed);
    return this.project();
  }

  begin(overlay: SettingsOverlay): { id: number; settings: AppSettings } {
    const id = ++this.sequence;
    this.pending.set(id, overlay);
    return { id, settings: this.project() };
  }

  /** Main answered intent `id`: its overlay goes, `commit` folds what main reported into the confirmed settings. */
  settle(id: number, commit: SettingsOverlay | null, revision?: number): AppSettings {
    this.pending.delete(id);
    if (commit) this.confirmed = commit(this.confirmed);
    if (revision !== undefined) this.revision = Math.max(this.revision, revision);
    return this.project();
  }

  fail(id: number): AppSettings {
    return this.settle(id, null);
  }

  private project(): AppSettings {
    let settings = this.confirmed;
    for (const overlay of this.pending.values()) settings = overlay(settings);
    return settings;
  }
}
