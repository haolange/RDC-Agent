import { useCallback, useMemo, useState } from 'react';
import { buildComposerSessionScopeKey } from './composerSessionScope';

export function useScopedPromptDraft(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
) {
  const [promptDraftsByScope, setPromptDraftsByScope] = useState<Record<string, string>>({});
  const scopeKey = useMemo(
    () => buildComposerSessionScopeKey(projectId, sessionId),
    [projectId, sessionId],
  );
  const promptValue = promptDraftsByScope[scopeKey] ?? '';
  const setPromptValue = useCallback((value: string) => {
    setPromptDraftsByScope((current) => {
      if (!value) {
        const { [scopeKey]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [scopeKey]: value };
    });
  }, [scopeKey]);

  return { promptValue, setPromptValue };
}