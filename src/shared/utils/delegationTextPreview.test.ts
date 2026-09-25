import { expect, it } from 'vitest';
import { delegationTextPreview } from './delegationTextPreview';

it.each([
  ['**Top-level listing** (`D:\\Projects`, no recursion)\n\nRest', 'Top-level listing (D:\\Projects, no recursion)'],
  ['# Result\n\nBody', 'Result'],
  ['- [x] Read **config**\n- More', 'Read config'],
  ['```ts\nconst file_name = "**literal**";\n```', 'const file_name = "**literal**";'],
  ['[Report](https://example.test) and `file_name`', 'Report and file_name'],
  ['Short', 'Short'],
  ['', ''],
])('extracts visible opening from %s', (input, output) => expect(delegationTextPreview(input)).toBe(output));
