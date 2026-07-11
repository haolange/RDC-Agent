import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActiveSignalText } from './ActiveSignalText';

describe('ActiveSignalText', () => {
  it('marks active text with a tone-specific signal attribute', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ActiveSignalText, { active: true, tone: 'info', children: 'Working' }),
    );

    expect(markup).toContain('active-signal-text');
    expect(markup).toContain('is-active');
    expect(markup).toContain('tone-info');
    expect(markup).toContain('data-active-signal="info"');
  });

  it('uses clipped-gradient energy shimmer for the active state', () => {
    const cssPath = path.resolve(process.cwd(), 'src/renderer/styles/design-system.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const activeBlock = css.match(/\.active-signal-text\.is-active\s*\{[\s\S]*?\}/)?.[0] ?? '';

    expect(activeBlock).toContain('background-clip: text');
    expect(activeBlock).toContain('color: transparent');
    expect(css).toContain('@keyframes active-signal-shimmer');
    expect(css).not.toContain('active-signal-pulse');
    expect(activeBlock).not.toContain('::after');
  });

  it('keeps inactive text static', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ActiveSignalText, { tone: 'interaction', children: 'Asked' }),
    );

    expect(markup).toContain('active-signal-text');
    expect(markup).toContain('tone-interaction');
    expect(markup).not.toContain('is-active');
    expect(markup).not.toContain('data-active-signal');
  });
});
