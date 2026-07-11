import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isActiveThinkingStatus,
  isActiveWorkProcessStatus,
} from './workProcessActiveSignal';

describe('workProcessActiveSignal', () => {
  it('activates only live Work Process statuses', () => {
    expect(isActiveWorkProcessStatus('running')).toBe(true);
    expect(isActiveWorkProcessStatus('pending')).toBe(true);
    expect(isActiveWorkProcessStatus('complete')).toBe(false);
    expect(isActiveWorkProcessStatus('error')).toBe(false);
  });

  it('activates streaming thinking without making completed thinking live', () => {
    expect(isActiveThinkingStatus('streaming', 'complete')).toBe(true);
    expect(isActiveThinkingStatus('complete', 'complete')).toBe(false);
    expect(isActiveThinkingStatus(undefined, 'running')).toBe(true);
  });

  it('keeps active signal off tool aggregate summaries and ordinary tool verbs', () => {
    const root = process.cwd();
    const aggregateSource = fs.readFileSync(
      path.resolve(root, 'src/renderer/features/debugger/AgentChat/ToolAggregateRow.tsx'),
      'utf8',
    );
    const rowsSource = fs.readFileSync(
      path.resolve(root, 'src/renderer/features/debugger/AgentChat/WorkProcessRows.tsx'),
      'utf8',
    );

    expect(aggregateSource).not.toContain('ActiveSignalText');
    expect(rowsSource).not.toContain('className="work-process-tool-verb">{label(row.verb)}</ActiveSignalText>');
    expect(rowsSource).not.toContain('work-process-tool-approval-verb">{label(approval.verb)}</ActiveSignalText>');
    expect(rowsSource).not.toContain('work-process-tool-group-title');
    expect(rowsSource).toContain('<ActiveSignalText active tone="interaction" className="work-process-user-input-verb">');
  });
});
