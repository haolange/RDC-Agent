import { describe, expect, it } from 'vitest';
import type { GenerativeUiSource, GenerativeUiSpec } from '@shared/types/generativeUi';
import { GenerativeUiVerifier } from './GenerativeUiVerifier';

const spec: GenerativeUiSpec = {
  title: 'Calculator',
  intent: 'Calculate an amount',
  layout: 'grid',
  components: [
    { id: 'amount', kind: 'input', purpose: 'Amount input' },
    { id: 'calculate', kind: 'button', purpose: 'Run calculation' },
  ],
  interactions: [{ trigger: 'click calculate', effect: 'update result from amount' }],
  dataBindings: [{ source: 'amount', target: 'result' }],
  visualStyle: 'system',
  responsiveRequirements: ['narrow viewport'],
};

const checkMap = (checks: Array<{ id: string; passed: boolean }>) =>
  Object.fromEntries(checks.map(({ id, passed }) => [id, passed]));

describe('GenerativeUiVerifier', () => {
  it('accepts balanced, responsive, accessible source aligned to the spec', () => {
    const source: GenerativeUiSource = {
      html: '<main><label for="amount">Amount</label><input id="amount"><button id="calculate">Calculate</button><output id="result"></output></main>',
      css: 'main { display: grid; } @media (max-width: 40rem) { main { grid-template-columns: 1fr; } }',
      javascript: "document.getElementById('calculate').addEventListener('click', () => { document.getElementById('result').textContent = document.getElementById('amount').value; });",
    };
    const verifier = new GenerativeUiVerifier();
    expect(verifier.verifyLevel1(source).passed).toBe(true);
    expect(verifier.verifyLevel2(spec, source).passed).toBe(true);
  });

  it('rejects malformed source and incomplete spec implementation', () => {
    const source: GenerativeUiSource = {
      html: '<div><input id="other">',
      css: 'div { display: grid',
      javascript: "document.getElementById('other').addEventListener('change', () => {});",
    };
    const verifier = new GenerativeUiVerifier();
    const level1 = checkMap(verifier.verifyLevel1(source).checks);
    const level2 = checkMap(verifier.verifyLevel2(spec, source).checks);
    expect(level1['html-structure']).toBe(false);
    expect(level1['css-syntax']).toBe(false);
    expect(level2['spec-components']).toBe(false);
    expect(level2['interaction-code']).toBe(false);
    expect(level2['data-bindings']).toBe(false);
    expect(level2['semantic-root']).toBe(false);
    expect(level2['control-labels']).toBe(false);
  });

  it('rejects embedded executable fields, imports, remote URLs, and images without alt text', () => {
    const source: GenerativeUiSource = {
      html: '<main><script src="https://example.test/app.js"></script><img src="//example.test/a.png"></main>',
      css: '@import "https://example.test/theme.css"; main { display: grid; }',
      javascript: '',
    };
    const verifier = new GenerativeUiVerifier();
    const level1 = checkMap(verifier.verifyLevel1(source).checks);
    const level2 = checkMap(verifier.verifyLevel2({ ...spec, components: [], interactions: [], dataBindings: [] }, source).checks);
    expect(level1['html-structure']).toBe(false);
    expect(level1['css-syntax']).toBe(false);
    expect(level1['no-remote-url']).toBe(false);
    expect(level2['image-alt']).toBe(false);
  });
});
