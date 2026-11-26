/**
 * The document's FontFaceSet. Chromium always has one, but the renderer's test DOM (happy-dom) has none, so the
 * layout code that remeasures when web fonts finish loading reads it here, typed as optional, instead of each
 * caller guarding a value its DOM types call present.
 */
export const documentFonts = (): FontFaceSet | undefined => document.fonts as FontFaceSet | undefined;
