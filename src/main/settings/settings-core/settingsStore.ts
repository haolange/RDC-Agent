import { deepFreeze } from '@shared/utils/deepFreeze';
import { createDefaultSettingsFile } from './settingsDefaults';
import { readSettingsFile, stableSerialize, writeSettingsFile } from './settingsServiceHelpers';
import type { SettingsFile } from './settingsFileSchema';
import type { SettingsChangedPayload, SettingsFileSection } from '@shared/types/settings';

/** The user's settings as committed, frozen: every reader shares it and nobody can change it in place. */
export interface SettingsSnapshot {
  readonly revision: number;
  readonly user: SettingsFile;
}

const FILE_SECTIONS = [
  'appearance', 'layout', 'profile', 'tooling', 'agentRuntime', 'agentModels', 'providers',
] as const satisfies ReadonlyArray<SettingsFileSection & keyof SettingsFile>;

/**
 * The single owner of the settings file in memory. It reads the file once; every later read is the frozen snapshot.
 * `commit` writes the next document (only when it differs), replaces the snapshot, bumps the revision and tells the
 * listeners which sections changed.
 */
export class SettingsStore {
  private current: SettingsSnapshot | null = null;
  private readonly listeners = new Set<(change: SettingsChangedPayload) => void>();

  load(): SettingsSnapshot {
    const user = readSettingsFile() ?? structuredClone(createDefaultSettingsFile());
    this.current = { revision: 1, user: deepFreeze(user) };
    return this.current;
  }

  get loaded(): boolean {
    return this.current !== null;
  }

  snapshot(): SettingsSnapshot {
    return this.current ?? this.load();
  }

  /** Writes `next` when it differs from the snapshot; returns the change, or null when nothing changed. */
  commit(next: SettingsFile, extraSections: SettingsFileSection[] = []): SettingsChangedPayload | null {
    const previous = this.snapshot();
    const sections: SettingsFileSection[] = [
      ...FILE_SECTIONS.filter((section) => stableSerialize(previous.user[section]) !== stableSerialize(next[section])),
      ...extraSections,
    ];
    if (sections.length === 0) return null;
    if (sections.some((section) => (FILE_SECTIONS as readonly string[]).includes(section))) writeSettingsFile(next);
    this.current = { revision: previous.revision + 1, user: deepFreeze(next) };
    const change = { revision: this.current.revision, sections };
    for (const listener of [...this.listeners]) {
      // The committed file stays authoritative when an observer fails; the failure is reported, not rethrown.
      try { listener(change); } catch (error) { console.error('[SettingsStore] A settings change observer failed:', error); }
    }
    return change;
  }

  onChanged(listener: (change: SettingsChangedPayload) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
