import { INVESTIGATION_ARTIFACT_KINDS, INVESTIGATION_ARTIFACT_STATUSES } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactKind, InvestigationArtifactStatus } from '@shared/types/renderdocInvestigation';
import { UNRESOLVED_BLOCKERS, type UnresolvedItem } from '@shared/types/unresolvedWork';
import { parsePreview, toRecord } from './workProcessContentText';
import { getDetailsRecord } from './workProcessWebPresentation';

export type ToolOutcome =
  | { type: 'investigation'; title: string; kind?: InvestigationArtifactKind; status?: InvestigationArtifactStatus }
  | { type: 'completion'; disposition: 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget_paused'; unresolved?: UnresolvedItem[] }
  | { type: 'toolSearch'; count: number; names: string[] };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Present structured results; protocol receipts remain in the existing details/raw path. */
export function getToolOutcome(toolName: string, parsed: unknown, argsPreview?: string): ToolOutcome | undefined {
  const record = toRecord(parsed);
  const details = getDetailsRecord(record) ?? record;
  const args = toRecord(parsePreview(argsPreview));
  if (toolName === 'investigation_read' || toolName === 'investigation_write' || toolName === 'investigation_schema') {
    const manifest = toRecord(details?.manifest);
    const kind = manifest?.kind ?? details?.kind ?? args?.kind;
    const status = manifest?.status;
    return {
      type: 'investigation',
      title: text(manifest?.title) || (toolName === 'investigation_write' ? text(args?.title) : ''),
      kind: INVESTIGATION_ARTIFACT_KINDS.find(value => value === kind),
      status: INVESTIGATION_ARTIFACT_STATUSES.find(value => value === status),
    };
  }
  if (toolName === 'turn_complete') {
    const disposition = args?.disposition;
    if (disposition === 'completed' || disposition === 'partial' || disposition === 'blocked'
      || disposition === 'cancelled' || disposition === 'budget_paused') {
      // Structured items come from the recorded declaration; older results carry none and show only the disposition.
      const unresolved = Array.isArray(details?.unresolved) ? details.unresolved.flatMap(item => {
        const entry = toRecord(item);
        const blocker = UNRESOLVED_BLOCKERS.find(value => value === entry?.blocker);
        return entry && blocker && text(entry.gap)
          ? [{ gap: text(entry.gap), attempted: text(entry.attempted), blocker, resumeWhen: text(entry.resumeWhen) }] : [];
      }) : [];
      return unresolved.length ? { type: 'completion', disposition, unresolved } : { type: 'completion', disposition };
    }
  }
  if (toolName === 'tool_search' && Array.isArray(details?.matches)) {
    const names = details.matches.map(item => text(toRecord(item)?.name)).filter(Boolean);
    const count = typeof details.total === 'number' && Number.isFinite(details.total) ? details.total : details.matches.length;
    return { type: 'toolSearch', count, names };
  }
  return undefined;
}
