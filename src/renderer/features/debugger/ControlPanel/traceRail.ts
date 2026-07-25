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
    // buildRightPanel always materializes the four kind groups; only treat the context
    // lane as populated when at least one group carries real records.
    || (rightPanel.context.groups ?? []).some((group) => group.all.length > 0)
  );
}

