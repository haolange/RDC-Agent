// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AppError, errorCodeOf } from '@shared/errors/appError';
import { useCaptureRecovery } from './useCaptureRecovery';
import { getCaptureRecovery, recoverCapture } from './capturePanelActions';

vi.mock('./capturePanelActions', () => ({ getCaptureRecovery: vi.fn(), recoverCapture: vi.fn() }));
const scope = { projectId: 'p', sessionId: 's' };

it('discards stale status reads and only requests recovery on explicit action', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  let finish!: (value: import('@shared/types/captureReplay').CaptureRecoveryStatus | null) => void;
  vi.mocked(getCaptureRecovery)
    .mockReset()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({
      kind: 'restore',
      pendingCount: 1,
      original: { inputId: 'new', fileName: 'new.rdc', deviceId: 'local', eventId: 7 },
    });
  vi.mocked(recoverCapture)
    .mockReset()
    .mockRejectedValue(new AppError('RDC_RECOVERY_OLD_PROCESS_UNCONFIRMED', 'old process still alive'));
  function Probe({ revision }: { revision: number }) {
    const recovery = useCaptureRecovery(scope, revision);
    return createElement(
      'button',
      {
        onClick: () => {
          void recovery.recover(3);
        },
      },
      recovery.error
        ? errorCodeOf(recovery.error.reason)
        : recovery.status?.kind === 'restore'
          ? (recovery.status.original?.fileName ?? 'none')
          : 'none',
    );
  }
  try {
    await act(async () => root.render(createElement(Probe, { revision: 1 })));
    await act(async () => root.render(createElement(Probe, { revision: 2 })));
    expect(host.textContent).toBe('new.rdc');
    await act(async () =>
      finish({
        kind: 'restore',
        pendingCount: 1,
        original: { inputId: 'old', fileName: 'old.rdc', deviceId: 'local', eventId: 1 },
      }),
    );
    expect(host.textContent).toBe('new.rdc');
    expect(recoverCapture).not.toHaveBeenCalled();
    await act(async () => host.querySelector('button')!.click());
    expect(recoverCapture).toHaveBeenCalledExactlyOnceWith({ ...scope, bindingGeneration: 3 });
    expect(host.textContent).toBe('RDC_RECOVERY_OLD_PROCESS_UNCONFIRMED');
  } finally {
    act(() => root.unmount());
  }
});
