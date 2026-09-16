export type ComposerModelEffortView = 'effort' | 'models';

export type ComposerModelEffortViewEvent = 'open-models' | 'chosen' | 'escape' | 'menu-closed';

export function nextComposerModelEffortView(
  _current: ComposerModelEffortView,
  event: ComposerModelEffortViewEvent,
): ComposerModelEffortView {
  return event === 'open-models' ? 'models' : 'effort';
}
