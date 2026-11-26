/** Minimal hast shapes this plugin walks; the pipeline's own typings stay internal to react-markdown. */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** A fenced block is closed when its last source line repeats the opening fence (same character, at least as long). */
export function isFenceClosed(source: string): boolean {
  const lines = source.replace(/\n+$/, '').split('\n');
  const opening = FENCE.exec(lines[0] ?? '')?.[1];
  if (!opening) return true;
  if (lines.length < 2) return false;
  const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines.at(-1) ?? '')?.[1];
  return Boolean(closing && closing[0] === opening[0] && closing.length >= opening.length);
}

const languageClasses = (properties: Record<string, unknown> | undefined): string[] => {
  const className = properties?.className;
  return Array.isArray(className)
    ? className.filter((name): name is string => typeof name === 'string' && name.startsWith('language-'))
    : [];
};

/**
 * While an answer streams, a code block whose closing fence has not arrived yet stays plain; every closed block is
 * highlighted at once. The language moves to `data-language` so the header still names it and highlighting skips it.
 */
export function rehypeOpenFence() {
  return (tree: HastNode, file: { value?: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : '';
    const walk = (node: HastNode) => {
      if (node.type === 'element' && node.tagName === 'pre') {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        const code = node.children?.find((child) => child.type === 'element' && child.tagName === 'code');
        if (code && start !== undefined && end !== undefined && !isFenceClosed(source.slice(start, end))) {
          const classes = languageClasses(code.properties);
          if (classes.length) {
            const className = code.properties?.className as unknown[];
            code.properties = {
              ...code.properties,
              className: className.filter((name) => !classes.includes(name as string)),
              dataLanguage: classes[0].slice('language-'.length),
            };
          }
        }
        return;
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
