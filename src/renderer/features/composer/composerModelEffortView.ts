export type ComposerModelEffortView = 'effort' | 'models';

export type ComposerModelEffortViewEvent = 'open-models' | 'chosen' | 'escape' | 'menu-closed';

/** The view an event leads to; it does not depend on the view it leaves. */
export function nextComposerModelEffortView(event: ComposerModelEffortViewEvent): ComposerModelEffortView {
  return event === 'open-models' ? 'models' : 'effort';
}
