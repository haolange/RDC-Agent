import fs from 'fs';
import path from 'path';

/**
 * Settings inputs the settings service does not write itself (secrets, Agent manifests, trust, global instructions,
 * project selection) are read once and kept with a stamp of the files they came from. Writes through the app
 * invalidate them directly; edits made outside the app are noticed when the stamp is checked again (at turn
 * preparation and when Settings opens). Nothing polls.
 */

/** Modification time and size of a file, or `-` when it does not exist. */
export function fileStamp(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '-';
    throw error;
  }
}

/** The entries of a directory that `include` accepts, each with its file stamp. */
export function directoryStamp(directory: string, include: (name: string) => boolean): string {
  let names: string[];
  try {
    names = fs.readdirSync(directory).filter(include).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '-';
    throw error;
  }
  return names.map((name) => `${name}=${fileStamp(path.join(directory, name))}`).join('|');
}

/** One external input: loaded on first use, kept until invalidated or until its stamp no longer matches. */
export class StampedValue<T> {
  private entry: { stamp: string; value: T } | null = null;
  private revisionValue = 0;

  constructor(private readonly stamp: () => string, private readonly load: () => T) {}

  get revision(): number {
    return this.revisionValue;
  }

  get(): T {
    if (!this.entry) {
      const stamp = this.stamp();
      this.entry = { stamp, value: this.load() };
    }
    return this.entry.value;
  }

  /** Keeps a value the app just wrote, stamped with the file as it is now. */
  set(value: T): void {
    this.entry = { stamp: this.stamp(), value };
    this.revisionValue += 1;
  }

  invalidate(): void {
    this.entry = null;
    this.revisionValue += 1;
  }

  /** True when the files changed since the value was loaded; the next `get` loads them again. */
  revalidate(): boolean {
    if (!this.entry || this.entry.stamp === this.stamp()) return false;
    this.invalidate();
    return true;
  }
}
