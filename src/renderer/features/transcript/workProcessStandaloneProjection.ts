import type { ConversationWorkBlock } from '@shared/types/conversation';
import { formatDurationMs } from './workProcessFormat';
import type { PresentationUnit, StandalonePresentationUnit } from './workProcessUnits';
import type { WorkProcessRow } from './workProcessTypes';
import { isVisibleToolCall } from './workProcessLlmProjection';
import type { BlockProjectionContext, LoopProjectionDeps } from './workProcessBlockProjection';

export function pushStandaloneBlock(
  block: ConversationWorkBlock,
  units: PresentationUnit[],
  deps: LoopProjectionDeps,
  ctx: BlockProjectionContext,
): void {
  const { t } = ctx;
    if (block.kind === 'plan_review') {
      const planReviewRows = ctx.groupProcessRows(block.toolCalls.filter(isVisibleToolCall).map((call) => ctx.createToolRow(call)));
      if (planReviewRows.length > 0) {
        ctx.hasVisibleProcessEvidence = true;
        const lastUnit = units[units.length - 1];
        if (lastUnit?.kind === 'loop') {
          const sectionRow = lastUnit.rows.find((row): row is Extract<WorkProcessRow, { type: 'section' }> => row.type === 'section');
          if (sectionRow) {
            sectionRow.steps.push(...planReviewRows);
            sectionRow.stepCount = deps.countToolSteps(sectionRow.steps);
            if (sectionRow.status === 'complete' && planReviewRows.some((child) => child.status === 'running' || child.status === 'pending')) {
              sectionRow.status = 'running';
            }
            if (planReviewRows.some((child) => child.status === 'error')) {
              sectionRow.status = 'error';
              sectionRow.defaultOpen = true;
            }
            return;
          }
        }
        units.push({
          kind: 'standalone',
          rows: planReviewRows,
          loopIds: [],
        } satisfies StandalonePresentationUnit);
      }
      return;
    }

    if (block.kind === 'user_input') {
      const userInputRows = ctx.groupProcessRows(block.toolCalls.filter(isVisibleToolCall).map((call) => ctx.createToolRow(call)));
      if (userInputRows.length > 0) {
        ctx.hasVisibleProcessEvidence = true;
        const lastUnit = units[units.length - 1];
        if (lastUnit?.kind === 'loop') {
          const sectionRow = lastUnit.rows.find((row): row is Extract<WorkProcessRow, { type: 'section' }> => row.type === 'section');
          if (sectionRow) {
            sectionRow.steps.push(...userInputRows);
            sectionRow.stepCount = deps.countToolSteps(sectionRow.steps);
            if (sectionRow.status === 'complete' && userInputRows.some((child) => child.status === 'running' || child.status === 'pending')) {
              sectionRow.status = 'running';
            }
            if (userInputRows.some((child) => child.status === 'error')) {
              sectionRow.status = 'error';
              sectionRow.defaultOpen = true;
            }
            return;
          }
        }
        units.push({
          kind: 'standalone',
          rows: userInputRows,
          loopIds: [],
        } satisfies StandalonePresentationUnit);
      }
      return;
    }

    if (block.kind === 'output' || deps.shouldSkipBlock(block)) {
      return;
    }

    if (block.kind === 'approval') {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [deps.createApprovalRow(block)],
        loopIds: [],
      });
      return;
    }

    if (block.kind === 'compaction') {
      ctx.hasVisibleProcessEvidence = true;
      const stats = block.compactionStats;
      const detailLines: string[] = block.summary ? [block.summary] : [];
      if (stats?.usage) detailLines.push(t('chat.compactionUsage', { input: stats.usage.inputTokens, output: stats.usage.outputTokens }));
      if (stats?.sourceUri) detailLines.push(`${stats.sourceUri} sha256:${stats.sourceHash ?? ""}`);
      if (stats?.messagesBefore != null && stats.messagesAfter != null) {
        detailLines.push(t('chat.compactionMessages', { before: stats.messagesBefore, after: stats.messagesAfter }));
      }
      if (stats?.tokensBefore != null && stats.tokensAfter != null) {
        detailLines.push(t('chat.compactionTokens', { before: stats.tokensBefore, after: stats.tokensAfter }));
      } else if (stats?.tokensBefore != null) {
        detailLines.push(t('chat.compactionTokensBefore', { count: stats.tokensBefore }));
      }
      units.push({
        kind: 'standalone',
        rows: [{
          type: 'summary',
          id: block.id,
          status: block.status,
          text: block.status === 'running' ? t('chat.workProcessCompactRunning') : block.status === 'error' ? t('chat.workProcessCompactFailed') : t('chat.workProcessCompactComplete'),
          detailLines,
          duration: formatDurationMs(block.startedAt, block.completedAt),
          compactionProvenance: stats?.provenance,
        }],
        loopIds: [block.id],
      });
      return;
    }

    if (block.kind === 'task_snapshot' && block.taskSnapshot) {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [{
          type: 'taskSnapshot',
          id: block.id,
          status: block.status,
          change: block.taskSnapshot.change,
          completed: block.taskSnapshot.completed,
          total: block.taskSnapshot.total,
          items: block.taskSnapshot.items,
          duration: formatDurationMs(block.startedAt, block.completedAt),
        }],
        loopIds: [block.id],
      });
      return;
    }

    if (block.kind === 'command') {
      return;
    }

    if (block.kind === 'diagnostic' || block.status === 'error') {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [deps.createDiagnosticRow(block)],
        loopIds: [block.id],
      });
      return;
    }

    const summaryText = deps.getMeaningfulBlockSummary(block);
    if (summaryText) {
      ctx.hasVisibleProcessEvidence = true;
      units.push({
        kind: 'standalone',
        rows: [{
          type: 'summary',
          id: block.id,
          status: block.status,
          text: summaryText,
          detailLines: [],
          duration: formatDurationMs(block.startedAt, block.completedAt),
        }],
        loopIds: [block.id],
      });
    }
}


