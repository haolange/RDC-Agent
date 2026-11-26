import type { InterruptionCause } from '../types/lifecycle';

/** Runtime-owned Task reasons remain stable in storage; the renderer localizes their presentation. */
export const TASK_STATUS_REASONS = {
  parentTurnStopped: 'Parent turn stopped after its producers joined.',
  createdTurnStopped: 'Creating turn stopped before this Task started.',
} as const;

/**
 * The summary of a Task execution a launch left running, by how that launch ended. The model reads the English text;
 * the renderer recognises it and words it in the interface language.
 */
export const TASK_INTERRUPTED_REASONS: Record<InterruptionCause, string> = {
  'js-fatal': 'Execution was interrupted when the app stopped after an uncaught error; it requires explicit recovery.',
  'native-crash-suspected': 'Execution was interrupted when the app crashed; it requires explicit recovery.',
  'renderer-gone': 'Execution was interrupted after the app window stopped; it requires explicit recovery.',
  'child-process-gone': 'Execution was interrupted after an app helper process stopped; it requires explicit recovery.',
  'shutdown-interrupted':
    'Execution was interrupted when the app did not finish closing; it requires explicit recovery.',
  'killed-or-power-loss-suspected':
    'Execution was interrupted when the app was killed or lost power; it requires explicit recovery.',
  unknown: 'Execution was interrupted by runtime restart and requires explicit recovery.',
};
