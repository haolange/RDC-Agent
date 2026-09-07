import { describe, expect, it } from 'vitest';
import type { WorkProcessRow } from './workProcessTypes';
import { aggregateSectionSteps } from './workProcessToolAggregate';

const tool = (id: string): Extract<WorkProcessRow, { type: 'tool' }> => ({
  type: 'tool',
  id,
  status: 'complete',
  verb: 'Read',
  category: 'File',
  icon: 'fileRead',
  groupKind: 'explore',
  family: 'file',
  toolName: 'read_file',
  target: `${id}.md`,
  duration: '5ms',
  argsLines: [],
  previewLines: [],
  rawLines: [],
});

const separator = (type: 'approval' | 'userInput' | 'diagnostic', id: string): WorkProcessRow => {
  if (type === 'approval') {
    return {
      type,
      id,
      status: 'pending',
      verb: 'Approve',
      message: 'Approval required',
      duration: '',
      detailLines: [],
      metaLines: [],
    };
  }
  if (type === 'userInput') {
    return {
      type,
      id,
      status: 'pending',
      verb: 'Answer',
      questionCount: 1,
      items: [{ questionId: 'question-1', prompt: 'Continue?' }],
      answeredCount: 0,
      incomplete: true,
      duration: '',
    };
  }
  return {
    type,
    id,
    status: 'complete',
    severity: 'info',
    message: 'Capability is not verified yet.',
    detailLines: [],
    duration: '',
  };
};

describe('aggregateSectionSteps', () => {
  it('keeps one through seven consecutive tools flat and aggregates at eight', () => {
    for (let count = 1; count <= 7; count += 1) {
      expect(aggregateSectionSteps(Array.from({ length: count }, (_, index) => tool(`flat-${index}`))))
        .toHaveLength(count);
    }

    const aggregated = aggregateSectionSteps(Array.from({ length: 8 }, (_, index) => tool(`agg-${index}`)));
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({ type: 'toolAggregate', status: 'complete' });
    expect(aggregated[0]?.type === 'toolAggregate' ? aggregated[0].children : []).toHaveLength(8);
  });

  it.each(['approval', 'userInput', 'diagnostic'] as const)('%s cuts a consecutive tool run', (type) => {
    const rows = [
      ...Array.from({ length: 4 }, (_, index) => tool(`before-${index}`)),
      separator(type, `separator-${type}`),
      ...Array.from({ length: 4 }, (_, index) => tool(`after-${index}`)),
    ];

    expect(aggregateSectionSteps(rows).map((row) => row.type)).toEqual([
      'tool', 'tool', 'tool', 'tool', type, 'tool', 'tool', 'tool', 'tool',
    ]);
  });
});
