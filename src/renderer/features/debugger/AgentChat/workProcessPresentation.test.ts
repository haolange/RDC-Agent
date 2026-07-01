import { describe, expect, it } from 'vitest';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import { buildWorkProcessPresentation } from './workProcessPresentation';

describe('buildWorkProcessPresentation', () => {
  it('keeps running tool progress visible as work process rows', () => {
    const trace: ConversationWorkTrace = {
      status: 'running',
      summary: 'Agent is working',
      updatedAt: 1,
      blocks: [
        {
          id: 'runtime-segment-1',
          kind: 'tool',
          title: 'Tool calls',
          stage: 'tool',
          status: 'running',
          summary: 'Inspecting capture metadata',
          startedAt: 1,
          toolCalls: [
            {
              id: 'tool-1',
              toolName: 'rdx_context',
              status: 'running',
              argsPreview: JSON.stringify({ path: 'capture.rdc' }),
              startedAt: 1,
            },
          ],
        },
      ],
    };

    const presentation = buildWorkProcessPresentation(trace);

    expect(presentation.defaultExpanded).toBe(true);
    expect(presentation.stepCount).toBe(1);
    expect(presentation.toolCount).toBe(1);
    expect(presentation.rows[0]).toMatchObject({
      type: 'section',
      status: 'running',
      primaryText: 'Inspecting capture metadata',
      stepCount: 1,
    });
  });
});
