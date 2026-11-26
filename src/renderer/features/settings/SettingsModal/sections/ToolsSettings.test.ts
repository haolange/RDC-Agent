import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { translate } from '../../../../i18n/messages';
import { detectRdcInstallations } from '../../../../platform/rdcInstallation';
import { ToolsSettings } from './ToolsSettings';
vi.mock('../../../../i18n', () => ({
  useI18n: () => ({
    t: (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params),
  }),
}));

vi.mock('../../../../platform/rdcInstallation', () => ({ detectRdcInstallations: vi.fn() }));

it('shows save for a changed draft and prevents installation operations from racing a page save', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const draft = createDefaultAppSettings().tooling;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let finishDetect!: () => void;
  let finishSave!: () => void;
  vi.mocked(detectRdcInstallations).mockReturnValue(
    new Promise((resolve) => {
      finishDetect = () => resolve([]);
    }),
  );
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
  );
  const render = (dirty: boolean) =>
    act(async () =>
      root.render(
        createElement(ToolsSettings, {
          rdcCliDraft: draft.rdcCli,
          codeInterpreterDraft: draft.codeInterpreter,
          shellDraft: draft.shell,
          onRdcCliDraftChange: vi.fn(),
          onCodeInterpreterDraftChange: vi.fn(),
          onShellDraftChange: vi.fn(),
          onSaveToolsConfig: save,
          dirty,
        }),
      ),
    );
  try {
    await render(false);
    const saveButton = () => host.querySelector<HTMLButtonElement>('[data-testid="settings-tools-save"]');
    expect(saveButton()).toBeNull();
    await render(true);
    const detect = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === translate('en', 'settings.rdcDetect'),
    )!;
    await act(async () => detect.click());
    expect(saveButton()?.disabled).toBe(true);
    await act(async () => finishDetect());
    expect(saveButton()?.disabled).toBe(false);
    await act(async () => saveButton()!.click());
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.querySelector('fieldset')?.disabled).toBe(true);
    await act(async () => finishSave());
    await render(false);
    expect(saveButton()).toBeNull();
    expect(host.querySelector('[data-testid="settings-tools-save-status"]')?.textContent).toBe(
      translate('en', 'settings.toolsSaved'),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
