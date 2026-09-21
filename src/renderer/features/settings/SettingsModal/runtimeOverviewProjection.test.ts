import { describe, expect, it, vi } from 'vitest';
import type { SetStateAction } from 'react';
import { fenceOverviewSetter } from './runtimeOverviewProjection';

describe('runtime overview mutation projection fence', () => {
  it('lets a submitted write finish but discards its stale onChanged result', async () => {
    let finish!: (value: string) => void;
    const write = new Promise<string>((resolve) => { finish = resolve; });
    const lifetime = { active: true };
    const setState = vi.fn();
    const onChanged = fenceOverviewSetter<string>(lifetime, setState);
    const submitted = write.then(onChanged);
    lifetime.active = false;
    finish('old project overview');
    await submitted;
    expect(setState).not.toHaveBeenCalled();
    await expect(write).resolves.toBe('old project overview');
  });

  it('does not revive old callbacks when the same project reopens or refreshes', () => {
    const old = { active: true };
    const setState = vi.fn();
    const stale = fenceOverviewSetter<string>(old, setState);
    old.active = false;
    const current = fenceOverviewSetter<string>({ active: true }, setState);
    stale('stale');
    current('current');
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][0]('previous')).toBe('current');
  });

  it('rechecks ownership when React processes queued updates and preserves functional setters', () => {
    const lifetime = { active: true };
    let queued!: SetStateAction<string>;
    const update = vi.fn((value: string) => `${value}!`);
    const setter = fenceOverviewSetter<string>(lifetime, (value) => { queued = value; });
    setter(update);
    expect(typeof queued).toBe('function');
    const apply = queued as (value: string) => string;
    expect(apply('current')).toBe('current!');
    lifetime.active = false;
    expect(apply('new project')).toBe('new project');
    expect(update).toHaveBeenCalledTimes(1);
  });
});
