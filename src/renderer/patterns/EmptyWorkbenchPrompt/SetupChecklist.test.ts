import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SetupChecklist } from './SetupChecklist';

vi.mock('../../i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, number>) => (params ? `${key}:${params.done}/${params.total}` : key) }),
}));

describe('SetupChecklist', () => {
  it('marks finished steps done and gives only the first open step the primary action', () => {
    const html = renderToStaticMarkup(React.createElement(SetupChecklist, {
      steps: [
        { id: 'rdc', done: true, act: () => undefined },
        { id: 'model', done: false, act: () => undefined },
        { id: 'project', done: false, act: () => undefined },
      ],
    }));
    expect(html).toContain('setup.title:1/3');
    expect(html).toMatch(/data-state="done"[^>]*data-testid="setup-step-rdc"/);
    expect(html).toContain('setup.rdc.doneTitle');
    expect(html).not.toContain('setup.rdc.action');
    expect(html).toMatch(/data-state="active"[^>]*data-testid="setup-step-model"/);
    expect(html).toMatch(/data-state="pending"[^>]*data-testid="setup-step-project"/);
    expect(html.match(/button-primary/g)).toHaveLength(1);
    expect(html).toContain('setup.project.action');
  });
});
