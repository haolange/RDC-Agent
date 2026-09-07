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
    expect(activeBlock).toContain('background-size: 200% 100%');
    expect(activeBlock).toContain('background-repeat: repeat-x');
    expect(activeBlock).toContain('1.6s linear infinite');
    expect(activeBlock).toContain('color-mix(in srgb, var(--active-signal-highlight) 36%, transparent)');
    expect(css).toMatch(/@keyframes active-signal-shimmer \{\s*0% \{ background-position: 100% 0; \}\s*100% \{ background-position: -100% 0; \}\s*\}/);
    expect(css).not.toContain('78% { background-position');
    expect(activeBlock).not.toContain('--active-signal-base');
    expect(activeBlock).not.toContain('--active-signal-sheen');
    expect(css).toContain('@keyframes active-signal-shimmer');
    expect(css).not.toContain('active-signal-pulse');
    expect(activeBlock).not.toContain('::after');
    expect(css).toContain("html[data-reduce-motion='on'] .active-signal-text.is-active");
  });

  it('does not let Work Process running labels override active shimmer color', () => {
    const cssPath = path.resolve(process.cwd(), 'src/renderer/features/transcript/AgentChat.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const runningBlock = css.match(/\.work-process-label\.status-running\s*\{[\s\S]*?\}/)?.[0] ?? '';

    expect(runningBlock).toContain('--active-signal-highlight');
    expect(runningBlock).not.toMatch(/\bcolor:/);
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
