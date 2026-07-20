/**
 * Progressive Skill 强制预载引用：`$skill-id` 与 pending/profile id 合并。
 */

/** Skill id token：字母开头，后续字母/数字/连字符/下划线（对齐磁盘 skill 目录 id）。 */
const DOLLAR_SKILL_REF_PATTERN = /\$([a-zA-Z][a-zA-Z0-9_-]*)/g;

export function extractDollarSkillRefs(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(DOLLAR_SKILL_REF_PATTERN)) {
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function mergeTurnPreloadSkillIds(input: {
  profileSkills: readonly string[];
  messageText: string;
  pendingSkillIds?: readonly string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const id = raw.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of input.profileSkills) push(id);
  for (const id of extractDollarSkillRefs(input.messageText)) push(id);
  for (const id of input.pendingSkillIds ?? []) push(id);
  return out;
}
