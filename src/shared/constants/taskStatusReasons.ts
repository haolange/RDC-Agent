/** Runtime-owned Task reasons remain stable in storage; the renderer localizes their presentation. */
export const TASK_STATUS_REASONS = {
  parentTurnStopped: 'Parent turn stopped after its producers joined.',
  createdTurnStopped: 'Creating turn stopped before this Task started.',
} as const;
