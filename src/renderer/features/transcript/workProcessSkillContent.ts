import { type ToolContentInput, type UnwrappedToolContent, SKILL_DESCRIPTION_MAX, extractSkillDescription, sanitizeContentText } from './workProcessToolContentShared';
import { stringifyPreview, collectReadableText } from './workProcessContentText';
import { compactText } from './workProcessFormat';

export function unwrapSkillContent(input: ToolContentInput): UnwrappedToolContent | null {
  const { t, normalized, record, details, argsRecord, contentText } = input;
  if (normalized === 'skill_read') {
    const description = sanitizeContentText(
      stringifyPreview(details?.description)
      || extractSkillDescription(contentText),
    );
    const pathChip = sanitizeContentText(
      stringifyPreview(
        details?.sourcePath
        ?? details?.path
        ?? record?.sourcePath
        ?? record?.path,
      ),
    );
    const previewLines = description
      ? [compactText(description.replace(/\s+/g, ' ').trim(), SKILL_DESCRIPTION_MAX)]
      : [];
    const skillName = sanitizeContentText(stringifyPreview(
      details?.skillId ?? argsRecord?.skill_id ?? argsRecord?.skillId,
    ));
    return {
      previewKind: 'skill',
      pathChip: pathChip || undefined,
      bodyText: previewLines[0] || undefined,
      previewLines,
      chips: skillName ? [skillName] : undefined,
    };
  }

if (normalized === 'skills') {
    const names = collectReadableText(record?.skills ?? details?.skills ?? record?.items, 6);
    return {
      previewKind: 'generic',
      chips: names.slice(0, 4),
      bodyText: names.length > 0 ? t(names.length === 1 ? 'chat.previewSkillsOne' : 'chat.previewSkillsMany', { count: names.length }) : contentText || undefined,
      previewLines: names,
    };
  }
  return null;
}
