import type { IconPart } from './iconParts';

/** Knowledge tool glyphs: browsing, searching, reading, compiling and proposing knowledge cards. */
export const KNOWLEDGE_ICONS = {
  'knowledge-browse': [
    { d: 'M5 6h6v13H6a1 1 0 0 1-1-1V6Z' },
    { d: 'M13 6h6v12a1 1 0 0 1-1 1h-5V6Z' },
    { d: 'M8 9h2M15 9h2' },
  ],
  'knowledge-search': [{ d: 'M5 6h8v13H6a1 1 0 0 1-1-1V6Z' }, { c: [16.5, 10.5, 2.5] }, { d: 'm18.2 12.7 2.3 2.3' }],
  'knowledge-read': [{ d: 'M5 6h8v13H6a1 1 0 0 1-1-1V6Z' }, { d: 'M15 8h5M15 11h5M15 14h3' }],
  'knowledge-compile': [{ d: 'M5 6h8v13H6a1 1 0 0 1-1-1V6Z' }, { d: 'M15 8h5l-1.5 3H20l-5 6v-4h-2l2-5Z' }],
  'knowledge-candidate': [{ d: 'M5 6h8v13H6a1 1 0 0 1-1-1V6Z' }, { d: 'M16 9h4M18 7v4' }, { d: 'M15 15h5' }],
} satisfies Record<string, readonly IconPart[]>;
