import { describe, expect, it, vi } from 'vitest';
import { OAuthRefreshError, OAuthRefreshManager } from './OAuthRefreshManager';

describe('OAuthRefreshManager', () => {
  const key = { providerId: 'provider-a', accountId: 'account-a' };

  it('deduplicates concurrent refresh and commits a rotated token once', async () => {
    let resolveRefresh: ((value: { access: string; refresh: string }) => void) | undefined;
    const refresh = vi.fn(() => new Promise<{ access: string; refresh: string }>((resolve) => {
      resolveRefresh = resolve;
    }));
    const commit = vi.fn();
    const manager = new OAuthRefreshManager(() => 1_000);
    const request = {
      key,
      current: { access: 'old', refresh: 'old-refresh' },
      expiresAt: new Date(1_000).toISOString(),
      refresh,
      commit,
    };
    const first = manager.refresh(request);
    const second = manager.refresh(request);
    expect(second).toBe(first);
    resolveRefresh?.({ access: 'new', refresh: 'rotated-refresh' });

    await expect(first).resolves.toEqual({ access: 'new', refresh: 'rotated-refresh' });
    await expect(second).resolves.toEqual({ access: 'new', refresh: 'rotated-refresh' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not refresh outside the skew window unless forced', async () => {
    const manager = new OAuthRefreshManager(() => 1_000);
    const refresh = vi.fn(async () => ({ access: 'new' }));
    const current = { access: 'old' };
    await expect(manager.refresh({
      key,
      current,
      expiresAt: new Date(120_000).toISOString(),
      refresh,
      commit: vi.fn(),
    })).resolves.toBe(current);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('normalizes invalid_grant and invokes the account failure hook', async () => {
    const manager = new OAuthRefreshManager();
    const onInvalidGrant = vi.fn();
    await expect(manager.refresh({
      key,
      current: { access: 'old' },
      force: true,
      refresh: async () => { throw new Error('invalid_grant'); },
      commit: vi.fn(),
      onInvalidGrant,
    })).rejects.toBeInstanceOf(OAuthRefreshError);
    expect(onInvalidGrant).toHaveBeenCalledOnce();
  });
});
