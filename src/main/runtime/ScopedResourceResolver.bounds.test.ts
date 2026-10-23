import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('hashes a large shared payload in a fixed small heap without materializing its serialization', () => {
  const source = new URL('./ScopedResourceResolver.ts', import.meta.url).href;
  const script = `
    import { hashScopedResource } from ${JSON.stringify(source)};
    const content = 'evidence😀'.repeat(32768);
    const messages = Array.from({ length: 256 }, (_, index) => ({ index, content }));
    const digest = hashScopedResource(messages);
    messages[255].content += 'changed';
    if (hashScopedResource(messages) === digest) throw new Error('Tail mutation was lost');
    console.log(digest);
  `;
  const output = execFileSync(process.execPath,
    ['--max-old-space-size=64', '--experimental-strip-types', '--input-type=module', '-e', script],
    { cwd: fileURLToPath(new URL('../../../..', import.meta.url)), encoding: 'utf8', timeout: 20_000,
      maxBuffer: 16_384, env: { ...process.env, NODE_OPTIONS: '' } });
  expect(output.trim()).toMatch(/^[a-f0-9]{64}$/u);
});
