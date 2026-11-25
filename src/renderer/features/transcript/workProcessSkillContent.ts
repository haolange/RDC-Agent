import { type ToolContentInput, type UnwrappedToolContent, SKILL_DESCRIPTION_MAX, extractSkillDescription, sanitizeContentText } from './workProcessToolContentShared';
import { stringifyPreview, collectReadableText } from './workProcessContentText';
import { compactText } from './workProcessFormat';

/** A skill read: its description, where it lives, and its name as a chip. */
export function presentSkillReadContent(input: ToolContentInput): UnwrappedToolContent {
  const { record, details, argsRecord, contentText } = input;
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

/** The skills listing: their names as chips and a count. */
export function presentSkillsContent(input: ToolContentInput): UnwrappedToolContent {
  const { t, record, details, contentText } = input;
  const names = collectReadableText(record?.skills ?? details?.skills ?? record?.items, 6);
  return {
    previewKind: 'generic',
    chips: names.slice(0, 4),
    bodyText: names.length > 0 ? t(names.length === 1 ? 'chat.previewSkillsOne' : 'chat.previewSkillsMany', { count: names.length }) : contentText || undefined,
    previewLines: names,
  };
}
