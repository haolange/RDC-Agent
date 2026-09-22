import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { moduleReferences, patternStoreActions } from './renderer-source-analysis.mjs';

test('module graph includes side effects, re-exports, dynamic imports and type imports without comment false positives', () => {
  assert.deepEqual(moduleReferences(`
    // import('./fake');
    const text = "from './also-fake'";
    import './style.css';
    import type { State } from './types';
    export { value } from './value';
    export type { Shape } from './shape';
    import { type OnlyType } from './only-type';
    import { type T, value } from './mixed';
    const lazy = import('./lazy');
    type Inline = import('./inline').Inline;
  `), [
    { path: './style.css', runtime: true },
    { path: './types', runtime: false },
    { path: './value', runtime: true },
    { path: './shape', runtime: false },
    { path: './only-type', runtime: false },
    { path: './mixed', runtime: true },
    { path: './lazy', runtime: true },
    { path: './inline', runtime: false },
  ]);
});

test('pattern action detection follows declared callable state through aliases and destructuring', () => {
  const filename = '/src/renderer/stores/example.ts';
  const source = ts.createSourceFile(filename, `
    interface State { open: boolean; rename: (name: string) => void }
    declare const state: State;
    const value = state.open;
    const action = state.rename;
    const { rename: alias } = state;
    const keyedAction = state['rename'];
  `, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost({ noLib: true });
  host.getSourceFile = (name) => name === filename ? source : undefined;
  const program = ts.createProgram([filename], { noLib: true }, host);
  assert.deepEqual(patternStoreActions(source, program.getTypeChecker()), ['state.rename', 'alias', "state['rename']"]);
});

test('Zustand writes cannot bypass action checks through indexed access or destructuring external API methods', () => {
  const filename = '/src/renderer/patterns/example.ts';
  const external = '/node_modules/zustand/index.d.ts';
  const source = ts.createSourceFile(filename, `
    useStore.setState({ open: true });
    useStore['setState']({ open: true });
    const { setState: write } = useStore;
    write({ open: true });
    const state = useStore.getState();
  `, ts.ScriptTarget.Latest, true);
  const library = ts.createSourceFile(external, `
    interface StoreApi { (): { open: boolean }; getState(): { open: boolean }; setState(value: { open: boolean }): void; }
    declare const useStore: StoreApi;
  `, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost({ noLib: true });
  host.getSourceFile = (name) => name === filename ? source : name === external ? library : undefined;
  const program = ts.createProgram([filename, external], { noLib: true }, host);
  assert.deepEqual(patternStoreActions(source, program.getTypeChecker()), ['useStore.setState', "useStore['setState']", 'write']);
});
