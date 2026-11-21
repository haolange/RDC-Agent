import { expect, it } from 'vitest';
import { toolResultDisplay } from './toolResultDisplay';

it('reads the page, the query and its results, the command and the file from tool details', () => {
  expect(toolResultDisplay('web_fetch', { kind: 'fetch', url: 'https://a.dev/x', title: 'X', status: 200, sourceHash: 'h' }))
    .toEqual({ kind: 'fetch', url: 'https://a.dev/x', title: 'X', status: 200 });
  const search = toolResultDisplay('web_search', { kind: 'search', query: 'opus id', results: [
    { url: 'https://a.dev', title: 'A', snippet: 's'.repeat(400) }, { title: 'no url' }] });
  expect(search).toMatchObject({ kind: 'search', query: 'opus id', results: [{ url: 'https://a.dev', title: 'A' }] });
  expect(search?.kind === 'search' && search.results[0].snippet?.length).toBe(240);
  expect(toolResultDisplay('shell', { command: 'pnpm test', exitCode: 0, cwd: '/w' })).toEqual({ kind: 'command', command: 'pnpm test', exitCode: 0 });
  expect(toolResultDisplay('read_file', { path: '/w/src/a.ts', sha256: 'h' })).toEqual({ kind: 'file', path: '/w/src/a.ts' });
  expect(toolResultDisplay('runtime_context', { snapshot: {} })).toBeUndefined();
});
