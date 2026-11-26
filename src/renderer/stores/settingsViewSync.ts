import { joinProviderEntry } from '@shared/utils/providerEntryView';
import type {
  AppSettings,
  LlmProviderCatalogResponse,
  SettingsChangedPayload,
  SettingsFileSection,
  SettingsView,
} from '@shared/types/settings';

/** The settings view joined with the catalog read once: what components read as `AppSettings`. */
export function joinSettingsView(view: SettingsView, catalog: LlmProviderCatalogResponse): AppSettings {
  const catalogById = new Map(catalog.providers.map((entry) => [entry.id, entry]));
  const {
    revision: _revision,
    llm,
    agents: { projectId: _projectId, ...agents },
    ...sections
  } = view;
  return {
    ...sections,
    llm: {
      providers: llm.connections.flatMap((state) => {
        const entry = catalogById.get(state.id);
        return entry ? [joinProviderEntry(entry, state)] : [];
      }),
      agentRoutes: llm.agentRoutes,
    },
    agents,
  };
}

/**
 * Sections whose change the renderer reads the view again for: provider state, and the Agent models and instructions
 * main derives routes and definitions from. The renderer writes the other sections itself (its patch results and
 * optimistic state already hold them; the window geometry is main's), so their changes need no read.
 */
const READ_SECTIONS: ReadonlySet<SettingsFileSection> = new Set(['providers', 'agentModels', 'globalInstructions']);

interface Read {
  promise: Promise<void>;
  /** The project the read was asked for (undefined: any). */
  projectId: string | null | undefined;
  /** The newest unseen change when the read started: the read covers it and everything before. */
  covers: number;
}

/**
 * When the renderer reads `settings:get`: once at startup, after a change it did not make itself, and when the
 * Agents shown belong to another project than the one asked for. A change arriving while the renderer's own write is
 * in flight waits for that write: its result names the revision it produced, which needs no read.
 */
export class SettingsViewSync {
  private revision = 0;
  private projectId: string | null = null;
  private readonly unseen = new Set<number>();
  private ownWrites = 0;
  private reading: Read | null = null;

  constructor(private readonly read: () => Promise<void>) {}

  /** A view adopted whole: startup, a read, or a command that answered with it. */
  adopted(view: SettingsView): void {
    this.revision = Math.max(this.revision, view.revision);
    this.projectId = view.agents.projectId;
    for (const revision of [...this.unseen]) if (revision <= view.revision) this.unseen.delete(revision);
  }

  changed(change: SettingsChangedPayload): void {
    if (change.revision <= this.revision || !change.sections.some((section) => READ_SECTIONS.has(section))) return;
    this.unseen.add(change.revision);
    this.readWhenIdle();
  }

  async ownWrite<T>(write: () => Promise<T>, revisionOf: (result: T) => number | undefined): Promise<T> {
    this.ownWrites += 1;
    try {
      const result = await write();
      const revision = revisionOf(result);
      if (revision !== undefined) this.unseen.delete(revision);
      return result;
    } finally {
      this.ownWrites -= 1;
      this.readWhenIdle();
    }
  }

  /** Out of date: a change this renderer did not make, or Agents of another project than `projectId` (when given). */
  stale(projectId: string | null | undefined): boolean {
    return this.unseen.size > 0 || (projectId !== undefined && projectId !== this.projectId);
  }

  /** Brings the view up to date for `projectId`; a read in flight that already covers the reason is joined. */
  readFor(projectId: string | null | undefined): Promise<void> {
    const reading = this.reading;
    if (
      reading &&
      reading.covers >= this.newestUnseen() &&
      (projectId === undefined || reading.projectId === projectId)
    ) {
      return reading.promise;
    }
    return this.readFresh(projectId);
  }

  /** Reads the view now. A read already in flight may predate the caller's reason, so this one starts after it. */
  async readFresh(projectId?: string | null): Promise<void> {
    while (this.reading) await this.reading.promise.catch(() => undefined);
    const read: Read = {
      projectId,
      covers: this.newestUnseen(),
      promise: this.read().finally(() => {
        if (this.reading === read) this.reading = null;
      }),
    };
    this.reading = read;
    await read.promise;
  }

  private newestUnseen(): number {
    return Math.max(0, ...this.unseen);
  }

  private readWhenIdle(): void {
    if (this.ownWrites === 0 && this.unseen.size > 0) {
      void this.readFor(undefined).catch((error: unknown) =>
        console.warn('[settings] could not read a changed settings view', error),
      );
    }
  }
}
