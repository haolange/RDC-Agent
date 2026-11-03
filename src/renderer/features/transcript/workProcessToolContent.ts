import type { Translator } from '../../i18n/messages';
import { normalizeToolName } from './workProcessToolCatalog';
import { toRecord, parsePreview } from './workProcessContentText';
import { getDetailsRecord } from './workProcessWebPresentation';
import {
  extractContentLayerText,
  sanitizeContentText,
  type ToolContentInput,
  type UnwrappedToolContent,
} from './workProcessToolContentShared';
import { unwrapArtifactContent } from './workProcessArtifactContent';
import { unwrapShellContent } from './workProcessShellContent';
import { unwrapSkillContent } from './workProcessSkillContent';
import { unwrapCatalogContent } from './workProcessCatalogContent';
import { unwrapFileContent } from './workProcessFileContent';
import { unwrapWebContent } from './workProcessWebContent';
import { unwrapGenericContent } from './workProcessGenericContent';

export const unwrapToolContentLayer = (
  toolName: string,
  parsed: unknown,
  raw: string | undefined,
  argsPreview: string | undefined,
  t: Translator,
): UnwrappedToolContent => {
  const normalized = normalizeToolName(toolName);
  const record = toRecord(parsed);
  const details = getDetailsRecord(record);
  const argsRecord = toRecord(parsePreview(argsPreview));
  const contentText = sanitizeContentText(extractContentLayerText(parsed, raw));
  const input: ToolContentInput = {
    toolName, parsed, raw, argsPreview, t, normalized, record, details, argsRecord, contentText,
  };
  return unwrapArtifactContent(input)
    ?? unwrapShellContent(input)
    ?? unwrapSkillContent(input)
    ?? unwrapCatalogContent(input)
    ?? unwrapFileContent(input)
    ?? unwrapWebContent(input)
    ?? unwrapGenericContent(input);
};
