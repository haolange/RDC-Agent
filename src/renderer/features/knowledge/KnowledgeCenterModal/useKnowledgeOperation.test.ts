// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RendererIpcError } from '@shared/errors/appError';
import { useKnowledgeOperation, type KnowledgeOperationControl } from './useKnowledgeOperation';
import type { KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

let host: HTMLDivElement;
let root: Root;
let report: (progress: KnowledgeOperationProgress) => void;
const cancel = vi.fn(async () => ({ cancelled: true }));
const unsubscribe = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', {
    events: {
      onKnowledgeProgress: (callback: typeof report) => {
        report = callback;
        return unsubscribe;
      },
    },
    knowledge: { cancel },
  });
  cancel.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mountOperation(): Promise<{ current: () => KnowledgeOperationControl }> {
  let latest!: KnowledgeOperationControl;
  function Probe() {
    latest = useKnowledgeOperation();
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  return { current: () => latest };
}

it("follows only its own run's progress, cancels that run by id and settles a cancel as a neutral outcome", async () => {
  const operation = await mountOperation();
  let operationId = '';
  let fail!: (error: unknown) => void;
  let outcome!: Promise<unknown>;
  await act(async () => {
    outcome = operation.current().run((id) => {
      operationId = id;
      return new Promise((_, reject) => {
        fail = reject;
      });
    });
  });
  expect(operation.current().running).toBe(true);
  expect(operation.current().progress).toBeNull();

  await act(async () => report({ operationId: 'someone-else', phase: 'writing', done: 9, total: 9 }));
  expect(operation.current().progress).toBeNull();
  await act(async () => report({ operationId, phase: 'writing', done: 2, total: 5 }));
  expect(operation.current().progress).toEqual({ operationId, phase: 'writing', done: 2, total: 5 });

  await act(async () => operation.current().cancel());
  expect(cancel).toHaveBeenCalledWith({ operationId });
  expect(operation.current().cancelling).toBe(true);

  await act(async () =>
    fail(
      new RendererIpcError('knowledge:import', {
        code: 'KNOWLEDGE_OPERATION_CANCELLED',
        params: {},
        category: 'availability',
      }),
    ),
  );
  await expect(outcome).resolves.toEqual({ cancelled: true });
  expect(operation.current().running).toBe(false);
  expect(operation.current().cancelling).toBe(false);
});

it('still rejects a real failure, so the caller shows it', async () => {
  const operation = await mountOperation();
  let outcome!: Promise<unknown>;
  await act(async () => {
    outcome = operation.current().run(() => Promise.reject(new Error('KNOWLEDGE_EXPORT_EMPTY_RESULT')));
    await outcome.catch(() => undefined);
  });
  await expect(outcome).rejects.toThrow('KNOWLEDGE_EXPORT_EMPTY_RESULT');
  expect(operation.current().running).toBe(false);
});
