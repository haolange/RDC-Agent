import type { CommandDefinition } from '@shared/types/command';

function openSourceControl(message: string): {
  success: boolean;
  message: string;
  uiAction: { type: 'open-panel'; payload: { panel: string } };
} {
  return {
    success: true,
    message,
    uiAction: { type: 'open-panel', payload: { panel: 'source-control' } },
  };
}

export const commitCommand: CommandDefinition = {
  id: 'commit',
  name: 'commit',
  description: 'Open Source Control to stage and commit changes',
  category: 'workflow',

  async execute() {
    return openSourceControl('Opened Source Control. Stage changes and commit from the panel.');
  },
};

export const diffCommand: CommandDefinition = {
  id: 'diff',
  name: 'diff',
  description: 'Open Source Control to inspect current git diff',
  category: 'workflow',

  async execute() {
    return openSourceControl('Opened Source Control for the current diff.');
  },
};

export const reviewCommand: CommandDefinition = {
  id: 'review',
  name: 'review',
  description: 'Open Source Control for code review context',
  category: 'workflow',

  async execute() {
    return openSourceControl('Opened Source Control for review.');
  },
};
