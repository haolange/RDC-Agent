import { normalizeToolName } from './workProcessToolCatalog';
import type { Translator } from '../../i18n/messages';
import type { WorkProcessRow } from './workProcessTypes';
import type { ToolRowModel } from './workProcessToolTypes';

const OBJECT_LIMIT = 48;

const shorten = (text: string): string => (text.length > OBJECT_LIMIT ? `${text.slice(0, OBJECT_LIMIT - 1)}…` : text);

/** The file a path names; directories and quotes are noise in a title. */
const fileName = (target: string): string => {
  const clean = target.replace(/^['"`]|['"`]$/g, '').split(/\s+->\s+/).at(-1) ?? target;
  return clean.split(/[\\/]/).filter(Boolean).at(-1) ?? clean;
};

const isRunning = (status: ToolRowModel['status']) => status === 'running' || status === 'pending';

/** A read titles itself with the site and page: 读取 platform.claude.com 的《Models overview》. */
function webFetchHeadline(row: ToolRowModel, t: Translator): string {
  const page = row.webPages?.[0];
  if (!page) return row.verb;
  if (isRunning(row.status)) return t('chat.webFetchHeadlineRunning', { site: page.domain });
  if (page.state === 'failed') return t('chat.webFetchHeadlineFailed', { site: page.domain });
  return page.title ? t('chat.webFetchHeadline', { site: page.domain, title: page.title }) : t('chat.webFetchHeadlineSite', { site: page.domain });
}

function webSearchHeadline(row: ToolRowModel, t: Translator): string {
  if (!row.webQuery) return row.verb;
  const query = shorten(row.webQuery);
  return t(isRunning(row.status) ? 'chat.webSearchHeadlineRunning' : 'chat.webSearchHeadline', { query });
}

/**
 * A card title says what the tool did to what: the verb, then the object a person recognises — the file name, the
 * pattern, the page, the query. Tools whose target is an internal id keep the verb alone.
 */
export function toolHeadline(row: ToolRowModel, t: Translator): string {
  const name = normalizeToolName(row.toolName);
  if (name === 'web_fetch') return webFetchHeadline(row, t);
  if (name === 'web_search') return webSearchHeadline(row, t);
  if (row.planReview || row.approval?.status === 'pending' || row.imageCalls) return row.verb;
  const target = row.target.trim();
  if (!target) return row.verb;
  if (row.family === 'file' && name !== 'artifact_read') return `${row.verb} ${shorten(fileName(target))}`;
  if (row.family === 'search') return t('chat.toolHeadlineQuoted', { verb: row.verb, object: shorten(target) });
  return row.verb;
}

export function webGroupHeadline(row: Extract<WorkProcessRow, { type: 'webGroup' }>, t: Translator): string {
  const count = row.pages.length;
  return t(row.members.some((member) => isRunning(member.status)) ? 'chat.webGroupHeadlineRunning' : 'chat.webGroupHeadline', { count });
}
