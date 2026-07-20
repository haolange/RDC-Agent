import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import { buildComposerSessionScopeKey } from './composerSessionScope';

export function useComposerPendingSkills(options: {
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
}) {
  const { currentProject, currentSession } = options;
  const [pendingSkillsByScope, setPendingSkillsByScope] = useState<Record<string, string[]>>({});
  const skillScopeKey = useMemo(
    () => buildComposerSessionScopeKey(currentProject?.projectId, currentSession?.sessionId),
    [currentProject?.projectId, currentSession?.sessionId],
  );
  const pendingSkillIds = pendingSkillsByScope[skillScopeKey] ?? [];

  const setPendingSkillIds: Dispatch<SetStateAction<string[]>> = useCallback((next) => {
    setPendingSkillsByScope((current) => {
      const previous = current[skillScopeKey] ?? [];
      const value = typeof next === 'function'
        ? (next as (prev: string[]) => string[])(previous)
        : next;
      if (value.length === 0) {
        const { [skillScopeKey]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [skillScopeKey]: value };
    });
  }, [skillScopeKey]);

  const armPendingSkill = useCallback((skillId: string) => {
    const id = skillId.trim();
    if (!id) return;
    setPendingSkillIds((current) => (current.includes(id) ? current : [...current, id]));
  }, [setPendingSkillIds]);

  const removePendingSkill = useCallback((skillId: string) => {
    setPendingSkillIds((current) => current.filter((id) => id !== skillId));
  }, [setPendingSkillIds]);

  return {
    pendingSkillIds,
    setPendingSkillIds,
    armPendingSkill,
    removePendingSkill,
  };
}
