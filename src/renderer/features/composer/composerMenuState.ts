export const COMPOSER_MENU_IDS = ['agent', 'permission', 'modelEffort', 'usage'] as const;

export type ComposerMenuId = (typeof COMPOSER_MENU_IDS)[number];

export type ComposerMenuAction =
  | { type: 'open'; id: ComposerMenuId }
  | { type: 'close'; id?: ComposerMenuId }
  | { type: 'toggle'; id: ComposerMenuId };

export function reduceComposerMenu(
  current: ComposerMenuId | null,
  action: ComposerMenuAction,
): ComposerMenuId | null {
  if (action.type === 'open') {
    return action.id;
  }
  if (action.type === 'close') {
    return !action.id || action.id === current ? null : current;
  }
  return current === action.id ? null : action.id;
}

export function isInsideComposerMenuRoot(
  root: HTMLElement | null,
  target: EventTarget | null,
): boolean {
  return Boolean(root && target instanceof Node && root.contains(target));
}
