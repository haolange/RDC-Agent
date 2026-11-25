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
import { presentInterpreterContent, presentShellContent } from './workProcessShellContent';
import { presentSkillReadContent, presentSkillsContent } from './workProcessSkillContent';
import {
  presentFileSearchContent,
  presentMcpContent,
  presentMemoryContent,
  presentOutputContent,
  presentRuntimeContextContent,
  presentToolSearchContent,
} from './workProcessCatalogContent';
import { presentFileContent } from './workProcessFileContent';
import { presentWebContent } from './workProcessWebContent';
import { presentGenericContent } from './workProcessGenericContent';
import type { Translator } from '../../i18n/messages';

type ContentPresenter = (input: ToolContentInput) => UnwrappedToolContent;

/** How each tool type's result reads on its card. A tool not listed here reads generically. */
const TOOL_CONTENT_PRESENTERS: Readonly<Record<string, ContentPresenter>> = {
  shell: presentShellContent,
  code_interpreter: presentInterpreterContent,
  skill_read: presentSkillReadContent,
  skills: presentSkillsContent,
  memory: presentMemoryContent,
  mcp: presentMcpContent,
  tool_search: presentToolSearchContent,
  output_register: presentOutputContent,
  plan_artifact: presentOutputContent,
  runtime_context: presentRuntimeContextContent,
  glob: presentFileSearchContent,
  grep: presentFileSearchContent,
  read_file: presentFileContent,
  read: presentFileContent,
  artifact_read: presentFileContent,
  write_file: presentFileContent,
  edit_file: presentFileContent,
  delete_file: presentFileContent,
  move_file: presentFileContent,
  copy_file: presentFileContent,
  web_search: presentWebContent,
  web_fetch: presentWebContent,
};

/** The presentation type of a tool: any tool named like a shell reads as one, and memory and MCP tools share theirs. */
const presentationType = (normalized: string): string => {
  if (normalized.includes('shell')) return 'shell';
  if (normalized.startsWith('memory_')) return 'memory';
  return normalized.startsWith('mcp__') ? 'mcp' : normalized;
};

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
  const type = presentationType(normalized);
  const presenter = Object.hasOwn(TOOL_CONTENT_PRESENTERS, type) ? TOOL_CONTENT_PRESENTERS[type]! : presentGenericContent;
  // A result moved into a session file reads from its display gist, whatever the tool.
  return unwrapArtifactContent(input) ?? presenter(input);
};
