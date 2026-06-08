import type { AgentRunPresentation } from '@shared/types/agenticTrace';

export function shouldShowTraceRightRail(
  presentation: AgentRunPresentation | null | undefined,
): boolean {
  if (!presentation) {
    return false;
  }

  if ((presentation.runs?.length ?? 0) > 0) {
    return true;
  }

  const rightPanel = presentation.rightPanel;
  if (!rightPanel) {
    return false;
  }

  return (
    rightPanel.progress.current.length > 0
    || rightPanel.progress.history.length > 0
    || rightPanel.artifacts.current.length > 0
    || rightPanel.artifacts.previous.length > 0
    || (rightPanel.context.groups?.length ?? 0) > 0
  );
}

