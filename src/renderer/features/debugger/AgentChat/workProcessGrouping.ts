import type {
  WorkProcessGroupThinking,
  WorkProcessRow,
  WorkProcessRowStatus,
  WorkProcessStepGroup,
} from './workProcessTypes';
import {
  SEMANTIC_STEP_TITLES,
  type WorkProcessSemanticStepKind,
} from './workProcessSemanticKind';

export const MAX_LOOPS_PER_GROUP = 8;
export const MAX_ACTIONS_PER_GROUP = 16;

export interface LoopPresentationUnit {
  kind: 'loop';
  loopId: string;
  semanticKind: WorkProcessSemanticStepKind;
  actionCount: number;
  rows: WorkProcessRow[];
  hasDisplayableThinking: boolean;
  hasSummaryThinking: boolean;
  forceNewGroup?: boolean;
  isResponseBoundary?: boolean;
}

export interface StandalonePresentationUnit {
  kind: 'standalone';
  semanticKind: WorkProcessSemanticStepKind;
  rows: WorkProcessRow[];
  loopIds: string[];
}

export type PresentationUnit = LoopPresentationUnit | StandalonePresentationUnit;

function deriveGroupStatus(rows: WorkProcessRow[]): WorkProcessRowStatus {
  if (rows.some((row) => row.status === 'error')) return 'error';
  if (rows.some((row) => row.status === 'running')) return 'running';
  if (rows.some((row) => row.status === 'pending')) return 'pending';
  return 'complete';
}

function countActionsInRows(rows: WorkProcessRow[]): number {
  return rows.reduce((total, row) => {
    if (row.type === 'section') return total + row.stepCount;
    if (row.type === 'tool' || row.type === 'userInput') return total + 1;
    return total;
  }, 0);
}

function sectionHasDisplayableThinking(row: WorkProcessRow): boolean {
  return row.type === 'section' && row.thinkingExpandable && Boolean(row.thinkingPreview);
}

function sectionHasSummaryThinking(row: WorkProcessRow): boolean {
  return row.type === 'section' && row.thinkingKind === 'summary' && Boolean(row.thinkingPreview);
}

function extractGroupThinking(section: Extract<WorkProcessRow, { type: 'section' }>): WorkProcessGroupThinking {
  return {
    preview: section.thinkingPreview,
    label: '阶段思考摘要',
    kind: section.thinkingKind,
    visibility: section.thinkingVisibility,
    status: section.thinkingStatus,
  };
}

function clearSectionThinking(section: Extract<WorkProcessRow, { type: 'section' }>): Extract<WorkProcessRow, { type: 'section' }> {
  return {
    ...section,
    thinkingPreview: '',
    thinkingLabel: '',
    thinkingExpandable: false,
    thinkingOpenByDefault: false,
  };
}

function applyGroupThinkingPromotion(units: LoopPresentationUnit[]): {
  units: LoopPresentationUnit[];
  groupThinking?: WorkProcessGroupThinking;
} {
  if (units.length < 2) return { units };

  const firstSection = units[0].rows.find((row): row is Extract<WorkProcessRow, { type: 'section' }> => row.type === 'section');
  if (!firstSection || !sectionHasSummaryThinking(firstSection)) return { units };

  const laterDisplayable = units.slice(1).some((unit) => (
    unit.hasDisplayableThinking || unit.rows.some((row) => sectionHasDisplayableThinking(row))
  ));
  if (laterDisplayable) return { units };

  const groupThinking = extractGroupThinking(firstSection);
  const promotedUnits = units.map((unit, index) => {
    if (index !== 0) return unit;
    return {
      ...unit,
      rows: unit.rows.map((row) => (
        row.type === 'section' && row.id === firstSection.id ? clearSectionThinking(row) : row
      )),
      hasDisplayableThinking: false,
      hasSummaryThinking: false,
    };
  });

  return { units: promotedUnits, groupThinking };
}

function shouldSplitGroup(
  currentKind: WorkProcessSemanticStepKind,
  currentLoopIds: string[],
  currentRows: WorkProcessRow[],
  next: LoopPresentationUnit,
): boolean {
  if (next.forceNewGroup) return true;
  if (currentKind !== next.semanticKind) return true;
  if (currentLoopIds.length >= MAX_LOOPS_PER_GROUP) return true;
  if (countActionsInRows(currentRows) + next.actionCount > MAX_ACTIONS_PER_GROUP) return true;
  return false;
}

function finalizeLoopGroup(
  kind: WorkProcessSemanticStepKind,
  units: LoopPresentationUnit[],
  groupIndex: number,
): WorkProcessStepGroup {
  const { units: promotedUnits, groupThinking } = applyGroupThinkingPromotion(units);
  const rows = promotedUnits.flatMap((unit) => unit.rows);
  const loopIds = promotedUnits.map((unit) => unit.loopId);

  return {
    id: `step-group-${groupIndex}-${loopIds[0] ?? kind}`,
    kind,
    title: SEMANTIC_STEP_TITLES[kind],
    status: deriveGroupStatus(rows),
    rows,
    loopIds,
    groupThinking,
  };
}

export function buildSemanticStepGroups(units: PresentationUnit[]): WorkProcessStepGroup[] {
  const groups: WorkProcessStepGroup[] = [];
  let bucket: LoopPresentationUnit[] = [];
  let bucketKind: WorkProcessSemanticStepKind | null = null;
  let groupIndex = 0;

  const flushBucket = (): void => {
    if (bucket.length === 0 || !bucketKind) return;
    groups.push(finalizeLoopGroup(bucketKind, bucket, groupIndex));
    groupIndex += 1;
    bucket = [];
    bucketKind = null;
  };

  for (const unit of units) {
    if (unit.kind === 'standalone') {
      flushBucket();
      groups.push({
        id: `step-group-${groupIndex}-${unit.semanticKind}`,
        kind: unit.semanticKind,
        title: SEMANTIC_STEP_TITLES[unit.semanticKind],
        status: deriveGroupStatus(unit.rows),
        rows: unit.rows,
        loopIds: unit.loopIds,
      });
      groupIndex += 1;
      continue;
    }

    if (unit.isResponseBoundary) {
      flushBucket();
      groups.push({
        id: `step-group-${groupIndex}-response`,
        kind: unit.semanticKind,
        title: '回复',
        status: deriveGroupStatus(unit.rows),
        rows: unit.rows,
        loopIds: [unit.loopId],
      });
      groupIndex += 1;
      continue;
    }

    if (unit.forceNewGroup) {
      flushBucket();
      bucketKind = unit.semanticKind;
      bucket = [unit];
      flushBucket();
      continue;
    }

    if (
      bucketKind
      && shouldSplitGroup(bucketKind, bucket.map((item) => item.loopId), bucket.flatMap((item) => item.rows), unit)
    ) {
      flushBucket();
    }

    if (!bucketKind) bucketKind = unit.semanticKind;
    bucket.push(unit);
  }

  flushBucket();
  return groups;
}

export function flattenStepGroups(groups: WorkProcessStepGroup[]): WorkProcessRow[] {
  return groups.flatMap((group) => group.rows);
}
