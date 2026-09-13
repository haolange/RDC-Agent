import type { CaptureReplayHistoryEntry } from '@shared/types/captureReplay';

export function latestSuccessfulHistoryIndex(entries: CaptureReplayHistoryEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index].imageSha256 && !entries[index].failure) return index;
  }
  return entries.length - 1;
}

/** Each mounted capture owns its cursor; discarded loads never publish a partial page. */
export async function readCaptureHistory(
  existing: CaptureReplayHistoryEntry[],
  readPage: (afterSequence?: number) => Promise<{ entries: CaptureReplayHistoryEntry[]; nextSequence?: number }>,
  isCurrent: () => boolean,
): Promise<CaptureReplayHistoryEntry[] | null> {
  const all = [...existing];
  let afterSequence = all.at(-1)?.sequence;
  do {
    const page = await readPage(afterSequence);
    if (!isCurrent()) return null;
    all.push(...page.entries);
    if (page.nextSequence === undefined || page.nextSequence === afterSequence) return all;
    afterSequence = page.nextSequence;
  } while (isCurrent());
  return null;
}
