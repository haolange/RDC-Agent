import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { buildRendererCsp } from './rendererCsp';

it('ships one renderer policy: the page meta tag equals the production header, which connects only to itself', () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, '../../renderer/index.html'), 'utf8');
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/u.exec(html)?.[1];
  expect(meta).toBe(buildRendererCsp('production'));
  expect(buildRendererCsp('production')).toContain("connect-src 'self';");
  expect(buildRendererCsp('production')).not.toMatch(/unsafe-|https:\/\//u);
});
