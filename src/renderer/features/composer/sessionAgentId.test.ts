import { beforeEach, describe, expect, it, vi } from 'vitest';

const setAgentId = vi.fn();
vi.mock('../../platform/getElectronApi', () => ({
  getElectronApi: () => ({ session: { setAgentId } }),
}));

import { useProjectStore } from '../../stores/projectStore';
import { useSessionRecordStore } from '../../stores/sessionRecordStore';
import { useComposerModelDraftStore } from '../../stores/composerModelDraftStore';
import { readComposerAgentId } from '../../hooks/useComposerAgentId';
import { persistSessionAgentId } from './sessionAgentId';
import type { SessionRecord } from '@shared/types/session';

const record = (agentId?: string): SessionRecord => ({
  schemaVersion: '1', sessionId: 'sess_1', projectId: 'proj_1', title: 't', goal: '', sessionPath: 'D:/sess',
  createdAt: 1, updatedAt: 1, ...(agentId ? { agentId } : {}),
});

describe('Composer Agent pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionRecordStore.getState().reset();
    useComposerModelDraftStore.getState().reset();
    useProjectStore.setState({ currentProject: { projectId: 'proj_1' } as never, currentSessionId: 'sess_1' });
  });

  it('reads the session record, and General when the record names no Agent', () => {
    useSessionRecordStore.getState().accept({ record: record('debugger'), revision: { epoch: 'e', n: 1 } });
    expect(readComposerAgentId()).toBe('debugger');
    useSessionRecordStore.getState().accept({ record: record(), revision: { epoch: 'e', n: 2 } });
    expect(readComposerAgentId()).toBe('general');
  });

  it('keeps the choice as the project draft before a session exists', async () => {
    useProjectStore.setState({ currentSessionId: null });
    await expect(persistSessionAgentId(null, 'analyzer')).resolves.toEqual({ ok: true });
    expect(setAgentId).not.toHaveBeenCalled();
    expect(readComposerAgentId()).toBe('analyzer');
  });

  it('shows a switch while main confirms it, then the record main wrote', async () => {
    useSessionRecordStore.getState().accept({ record: record('general'), revision: { epoch: 'e', n: 1 } });
    let answer!: (value: unknown) => void;
    setAgentId.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const switching = persistSessionAgentId('sess_1', 'debugger');
    expect(readComposerAgentId()).toBe('debugger');
    answer({ success: true, session: { record: record('debugger'), revision: { epoch: 'e', n: 2 } } });
    await switching;
    expect(setAgentId).toHaveBeenCalledWith('sess_1', 'debugger');
    expect(useSessionRecordStore.getState().pending).toEqual({});
    expect(readComposerAgentId()).toBe('debugger');
  });
});
