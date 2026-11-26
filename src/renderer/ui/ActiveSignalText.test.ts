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
