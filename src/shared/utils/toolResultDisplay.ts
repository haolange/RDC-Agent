/**
 * The human-readable gist of a tool result, kept beside an offloaded result so the Working card still says what the
 * tool did (the page it read, the query it ran, the command, the file) after the payload moved into a session file.
 */
export type ToolResultDisplay =
  | { kind: 'fetch'; url: string; title?: string; status?: number }
  | { kind: 'search'; query: string; results: Array<{ url: string; title?: string; snippet?: string }> }
  | { kind: 'command'; command: string; exitCode?: number }
  | { kind: 'file'; path: string };

const SEARCH_RESULT_LIMIT = 12;
const SNIPPET_LIMIT = 240;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Derives the display gist from the tool's own result details; unknown shapes have none. */
export function toolResultDisplay(toolName: string, details: unknown): ToolResultDisplay | undefined {
  const source = record(details);
  if (!source) return undefined;
  if (source.kind === 'fetch' && text(source.url)) {
    return { kind: 'fetch', url: text(source.url)!, title: text(source.title), status: number(source.status) };
  }
  if (source.kind === 'search' && text(source.query)) {
    const results = (Array.isArray(source.results) ? source.results : []).flatMap((entry) => {
      const result = record(entry);
      const url = text(result?.url);
      if (!url) return [];
      const snippet = text(result?.snippet);
      return [{ url, title: text(result?.title), snippet: snippet && snippet.length > SNIPPET_LIMIT ? `${snippet.slice(0, SNIPPET_LIMIT - 1)}…` : snippet }];
    }).slice(0, SEARCH_RESULT_LIMIT);
    return { kind: 'search', query: text(source.query)!, results };
  }
  if (toolName === 'shell' && text(source.command)) {
    return { kind: 'command', command: text(source.command)!, exitCode: number(source.exitCode) };
  }
  if (text(source.path)) return { kind: 'file', path: text(source.path)! };
  return undefined;
}
