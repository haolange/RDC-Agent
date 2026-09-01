import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { SessionRecord } from '@shared/types/session';

const {
  findEffectiveAgentProfile,
  resolveAgentRoutePreflight,
  lookupProjectById,
  readSession,
  log,
} = vi.hoisted(() => ({
  findEffectiveAgentProfile: vi.fn(),
  resolveAgentRoutePreflight: vi.fn(),
  lookupProjectById: vi.fn(),
  readSession: vi.fn(),
  log: vi.fn(),
}));

vi.mock('../../conversation/ConversationRoutePreflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../conversation/ConversationRoutePreflight')>();
  return {
    ...actual,
    findEffectiveAgentProfile,
    resolveAgentRoutePreflight,
  };
});

vi.mock('../../settings/projectRegistryLookup', () => ({
  lookupProjectById,
}));

vi.mock('../../sessions/StorageAdapter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sessions/StorageAdapter')>();
  return {
    ...actual,
    storageAdapter: {
      ...actual.storageAdapter,
      readSession,
    },
  };
});

vi.mock('../../runtime/RuntimeLogService', () => ({
  runtimeLogService: { log },
}));

import {
  generateSessionCompactionSections,
  isWithinSessionCompactionLine,
  resolveCompactionAgentId,
} from './CompactionHandoffService';

function message(role: 'user' | 'assistant', agentId?: string): ConversationMessage {
  return {
    id: `${role}-1`,
    turnId: 'turn-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    role,
    agentId,
    content: 'hello',
    createdAt: 1,
  };
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'session-1',
    projectId: 'project-1',
    title: 'session',
    goal: '',
    sessionPath: 'D:/sessions/session-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('session compaction line', () => {
  it('treats occupancy at or below the threshold as a no-op', () => {
    expect(isWithinSessionCompactionLine(100_000, 160_000, 8)).toBe(true);
    expect(isWithinSessionCompactionLine(160_000, 160_000, 8)).toBe(true);
  });

  it('treats short histories as a no-op even when occupancy is over the line', () => {
    expect(isWithinSessionCompactionLine(180_000, 160_000, 3)).toBe(true);
  });

  it('requires a model-generated handoff once occupancy and turn count both exceed the line', () => {
    expect(isWithinSessionCompactionLine(180_000, 160_000, 4)).toBe(false);
  });
});

describe('resolveCompactionAgentId', () => {
  afterEach(() => {
    findEffectiveAgentProfile.mockReset();
  });

  it('keeps an enabled custom ask profile from history when the snapshot is project-aware', () => {
    findEffectiveAgentProfile.mockReturnValue({ found: true, enabled: true, profile: { id: 'ask' } });
    expect(resolveCompactionAgentId([
      message('user', 'ask'),
      message('assistant', 'ask'),
    ], 'D:/Project')).toEqual({ agentId: 'ask', source: 'history' });
    expect(findEffectiveAgentProfile).toHaveBeenCalledWith('ask', 'D:/Project');
  });

  it('does not consult a user/builtin-only snapshot when project root is missing', () => {
    expect(resolveCompactionAgentId([
      message('assistant', 'ask'),
    ], null)).toEqual({ agentId: 'ask', source: 'history' });
    expect(findEffectiveAgentProfile).not.toHaveBeenCalled();
  });

  it('falls back to the session agent and records unknown when history ask is absent from the project snapshot', () => {
    findEffectiveAgentProfile.mockImplementation((agentId: string) => (
      agentId === 'general'
        ? { found: true, enabled: true, profile: { id: 'general' } }
        : { found: false, enabled: false, profile: null }
    ));
    expect(resolveCompactionAgentId([
      message('user', 'general'),
      message('assistant', 'ask'),
    ], 'D:/Project')).toEqual({
      agentId: 'general',
      source: 'session',
      fallbackReason: 'unknown',
    });
  });

  it('falls back to general and records disabled when the history profile exists but is disabled', () => {
    findEffectiveAgentProfile.mockReturnValue({ found: true, enabled: false, profile: { id: 'ask' } });
    expect(resolveCompactionAgentId([
      message('assistant', 'ask'),
    ], 'D:/Project')).toEqual({
      agentId: 'general',
      source: 'default',
      fallbackReason: 'disabled',
    });
  });
});

describe('generateSessionCompactionSections route binding', () => {
  afterEach(() => {
    findEffectiveAgentProfile.mockReset();
    resolveAgentRoutePreflight.mockReset();
    lookupProjectById.mockReset();
    readSession.mockReset();
    log.mockReset();
  });

  it('passes the project root and keeps custom ask for route preflight', async () => {
    readSession.mockReturnValue(session({
      modelOverride: { providerId: 'cline-pass', modelId: 'kimi' },
    }));
    lookupProjectById.mockReturnValue({ projectId: 'project-1', rootPath: 'D:/Project' });
    findEffectiveAgentProfile.mockReturnValue({ found: true, enabled: true, profile: { id: 'ask' } });
    resolveAgentRoutePreflight.mockReturnValue({
      ok: false,
      diagnostic: { userMessage: 'route blocked' },
    });

    await expect(generateSessionCompactionSections({
      sessionId: 'session-1',
      history: [message('assistant', 'ask')],
      sourceMessages: [],
    })).rejects.toThrow(/COMPACTION_ROUTE_UNAVAILABLE/);

    expect(resolveAgentRoutePreflight).toHaveBeenCalledWith(
      'ask',
      undefined,
      { providerId: 'cline-pass', modelId: 'kimi' },
      'D:/Project',
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('does not use a user/builtin-only snapshot when project root lookup fails', async () => {
    readSession.mockReturnValue(session());
    lookupProjectById.mockReturnValue(null);
    findEffectiveAgentProfile.mockReturnValue({ found: false, enabled: false, profile: null });
    resolveAgentRoutePreflight.mockReturnValue({
      ok: false,
      diagnostic: { userMessage: 'route blocked' },
    });

    await expect(generateSessionCompactionSections({
      sessionId: 'session-1',
      history: [message('assistant', 'ask')],
      sourceMessages: [],
    })).rejects.toThrow(/COMPACTION_ROUTE_UNAVAILABLE/);

    expect(findEffectiveAgentProfile).not.toHaveBeenCalled();
    expect(resolveAgentRoutePreflight).toHaveBeenCalledWith('ask', undefined, undefined, null);
    expect(log).not.toHaveBeenCalled();
  });

  it('writes a fallback diagnostic instead of silently rewriting ask to general', async () => {
    readSession.mockReturnValue(session());
    lookupProjectById.mockReturnValue({ projectId: 'project-1', rootPath: 'D:/Project' });
    findEffectiveAgentProfile.mockReturnValue({ found: false, enabled: false, profile: null });
    resolveAgentRoutePreflight.mockReturnValue({
      ok: false,
      diagnostic: { userMessage: 'route blocked' },
    });

    await expect(generateSessionCompactionSections({
      sessionId: 'session-1',
      history: [message('assistant', 'ask')],
      sourceMessages: [],
    })).rejects.toThrow(/COMPACTION_ROUTE_UNAVAILABLE/);

    expect(resolveAgentRoutePreflight).toHaveBeenCalledWith('general', undefined, undefined, 'D:/Project');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      title: 'COMPACTION_PROFILE_FALLBACK',
      raw: expect.objectContaining({
        code: 'COMPACTION_PROFILE_FALLBACK',
        requestedAgentId: 'ask',
        resolvedAgentId: 'general',
        reason: 'unknown',
      }),
    }));
  });
});
