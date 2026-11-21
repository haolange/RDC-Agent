import type { IconPart } from './iconParts';

/** Investigation glyphs: the investigation tools and the artifact kinds listed in the right rail. */
export const INVESTIGATION_ICONS = {
  'investigation-schema': [
    { d: 'M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3' },
    { d: 'M10 11h4M10 14h4M10 17h2' },
  ],
  'investigation-read': [
    { d: 'M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3' },
    { c: [16.5, 16.5, 2.2] },
    { d: 'm18 18 1.6 1.6' },
  ],
  'investigation-write': [
    { d: 'M7 3.5h7l3 3V20H7V3.5Zm7 0v3h3' },
    { d: 'M10 16h6M13 13v6' },
  ],
  'investigation-list': [
    { d: 'M7 4h10v16H7V4Z' },
    { d: 'M10 8h4M10 12h4M10 16h3' },
  ],
  'artifact-world-state': [
    { c: [12, 12, 7.5] },
    { d: 'M4.5 12h15M12 4.5c2.4 2.2 3.6 4.7 3.6 7.5S14.4 17.3 12 19.5C9.6 17.3 8.4 14.8 8.4 12S9.6 6.7 12 4.5Z' },
  ],
  'artifact-evidence': [{ r: [5, 4.5, 14, 15, 2] }, { d: 'M8 9h8M8 12.5h8M8 16h5' }],
  'artifact-claim': [{ d: 'M6 6.5h12v8.5H10L6 19z' }, { d: 'M9 10h6M9 13h4' }],
  'artifact-experiment': [{ d: 'M9 4.5h6M10.5 4.5v5.2L6.8 18.2A2 2 0 0 0 8.6 21h6.8a2 2 0 0 0 1.8-2.8L13.5 9.7V4.5' }, { d: 'M8.2 15.5h7.6' }],
  'artifact-challenge': [{ c: [12, 12, 7.5] }, { d: 'M12 8.2v4.1M12 16.2h.01' }],
  'artifact-checkpoint': [{ d: 'M12 4.5 18.5 8v8L12 19.5 5.5 16V8Z' }, { d: 'm9.2 12 1.9 1.9 3.7-3.8' }],
  'artifact-report': [{ d: 'M7 4.5h7l4 4V19.5H7z' }, { d: 'M14 4.5v4h4M9.5 12h5M9.5 15h3.5' }],
} satisfies Record<string, readonly IconPart[]>;
