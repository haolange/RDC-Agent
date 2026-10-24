// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RightRailArtifactList } from './RightRailArtifactList';
import { RightRailContext } from './RightRailContext';
import type { InvestigationArtifactRow, InvestigationListPage, TaskContextPanelViewModel } from '@shared/types/trace';
const data = vi.hoisted(() => ({ sessionId: 'session', list: vi.fn(), read: vi.fn(), copy: vi.fn(), open: vi.fn() }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (select: (state: unknown) => unknown) => select({ currentSession: { sessionId: data.sessionId, projectId: 'project' } }) }));
vi.mock('../../hooks/appShellBridge', () => ({ copyAppText: data.copy, openAppPath: data.open }));
vi.mock('./investigationPreviewActions', () => ({ listInvestigationArtifacts: data.list, readInvestigationArtifact: data.read }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, values?: {count: number}) => values ? `${key}:${values.count}` : key }) }));
const row = (index: number): InvestigationArtifactRow => ({ artifactId: `artifact-${index}`, kind: 'evidence', recordType: 'EvidenceRecord', status: 'ready', mission: 'debugger', title: `Evidence ${index}`, createdAt: '2026-01-01T00:00:00.000Z', contentHash: `sha256:${'a'.repeat(64)}`, contentHashShort: 'sha256:aaa', sourceRefCount: 1, degraded: false });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => { (element as HTMLElement).focus(); (element as HTMLElement).click(); }); };
const named = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find(el => el.textContent === text);
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); data.sessionId = 'session';
  data.list.mockReset(); data.copy.mockResolvedValue(undefined); data.open.mockResolvedValue(undefined);
  data.read.mockResolvedValue({ ok: false, status: 'hash-mismatch', error: 'Expected hash differs' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it.each([0, 5, 6])('shows only five artifact rows and a functional overflow entry for %i total', async total => {
  await act(async () => root.render(createElement(RightRailArtifactList, { artifacts: { rows: Array.from({length: Math.min(total, 5)}, (_,i) => row(i)), totalCount: total, storeDegraded: false } })));
  expect(host.querySelectorAll('.right-rail-compact-row')).toHaveLength(Math.min(total,5));
  expect(Boolean(host.querySelector('.right-rail-browse-all'))).toBe(total > 5);
  expect(host.textContent).not.toContain('copyId'); expect(host.textContent).not.toContain('status.ready');
});
it('pages beyond fifty, opens nested preview, copies full ID and closes only the top layer', async () => {
  data.list.mockResolvedValueOnce({ rows: Array.from({length:50}, (_,i) => row(i)), totalCount:57, storeDegraded:false, nextCursor:{ createdAt:row(0).createdAt, artifactId:'artifact-49' } });
  data.list.mockResolvedValueOnce({ rows:Array.from({length:7}, (_,i) => row(i+50)),totalCount:57,storeDegraded:false });
  await act(async () => root.render(createElement(RightRailArtifactList, { artifacts:{rows:[row(0)],totalCount:57,storeDegraded:false} })));
  await click(host.querySelector('.right-rail-browse-all'));
  const list = document.querySelector('[data-testid="investigation-list"]')!;
  expect(list.querySelectorAll('.right-rail-compact-row')).toHaveLength(50);
  await click(named(list,'control.rightRail.browse.more'));
  expect(list.querySelectorAll('.right-rail-compact-row')).toHaveLength(57);
  expect(data.list.mock.calls[1][0].cursor.artifactId).toBe('artifact-49');
  await click(list.querySelector('.right-rail-compact-row'));
  const preview = document.querySelector('[data-testid="investigation-preview"]')!;
  expect(preview.textContent).toContain('Expected hash differs');
  await click(named(preview,'control.rightRail.artifacts.copyId'));
  expect(data.copy).toHaveBeenCalledWith('artifact-0');
  expect(preview.textContent).toContain('control.rightRail.browse.copy.copied');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(document.querySelector('[data-testid="investigation-preview"]')).toBeNull();
  expect(document.querySelector('[data-testid="investigation-list"]')).toBe(list);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(document.querySelector('[data-testid="investigation-list"]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('.right-rail-browse-all'));
});
it('shows a retryable error and ignores a late page after switching sessions', async () => {
  data.list.mockRejectedValueOnce(new Error('offline'));
  const props = { artifacts:{rows:[row(0)],totalCount:6,storeDegraded:false} };
  await act(async () => root.render(createElement(RightRailArtifactList,props)));
  await click(host.querySelector('.right-rail-browse-all'));
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  let finish!: (page: InvestigationListPage) => void;
  data.list.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
  await click(named(document,'control.rightRail.browse.retry'));
  data.sessionId='other'; await act(async () => root.render(createElement(RightRailArtifactList,props)));
  await act(async () => finish({rows:[row(56)],totalCount:6,storeDegraded:false}));
  expect(document.querySelector('[data-testid="investigation-list"]')).toBeNull();
  expect(host.textContent).not.toContain('Evidence 56');
});
it('bounds context, mounts fifty at a time, opens a real path and provides readonly no-path details', async () => {
  const task = { projectId:'project',sessionId:'session',resources:Array.from({length:57},(_,i) => ({id:`resource-${i}`,kind:'file',label:`Resource ${i}`,summary:'Full resource summary',...(i===0 ? {path:'/actual/file'} : {})})) } as TaskContextPanelViewModel;
  await act(async () => root.render(createElement(RightRailContext,{task})));
  expect(host.querySelectorAll('.right-rail-compact-row')).toHaveLength(5);
  expect(host.textContent).not.toContain('Full resource summary');
  await click(host.querySelector('.right-rail-compact-row')); expect(data.open).toHaveBeenCalledWith('/actual/file');
  await click(host.querySelector('.right-rail-browse-all'));
  const list=document.querySelector('[data-testid="context-list"]')!;
  expect(list.querySelectorAll('.right-rail-compact-row')).toHaveLength(50);
  await click(named(list,'control.rightRail.browse.more'));
  expect(list.querySelectorAll('.right-rail-compact-row')).toHaveLength(57);
  await click(list.querySelectorAll('.right-rail-compact-row')[56]);
  expect(document.body.textContent).toContain('resource-56'); expect(document.body.textContent).toContain('Full resource summary');
  await act(async () => root.render(createElement(RightRailContext,{task:{...task,sessionId:'next'}})));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each([0,5,6])('keeps context overflow discoverable at boundary %i', async total => {
  const task={projectId:'project',sessionId:'session',resources:Array.from({length:total},(_,i)=>({id:`r-${i}`,kind:'file',label:`Resource ${i}`}))} as TaskContextPanelViewModel;
  await act(async()=>root.render(createElement(RightRailContext,{task})));
  expect(host.querySelectorAll('.right-rail-compact-row')).toHaveLength(Math.min(total,5));
  expect(Boolean(host.querySelector('.right-rail-browse-all'))).toBe(total>5);
});
it('reports ID clipboard failure inside preview without reporting success', async () => {
  data.copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
  await act(async()=>root.render(createElement(RightRailArtifactList,{artifacts:{rows:[row(0)],totalCount:1,storeDegraded:false}})));
  await click(host.querySelector('.right-rail-compact-row'));
  const preview=document.querySelector('[data-testid="investigation-preview"]')!;
  await click(named(preview,'control.rightRail.artifacts.copyId'));
  expect(preview.textContent).toContain('control.rightRail.browse.copy.failed');
  expect(preview.textContent).not.toContain('control.rightRail.browse.copy.copied');
});
