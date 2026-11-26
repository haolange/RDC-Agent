interface MdastCode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  children?: MdastCode[];
}

/** ```ts:src/app.ts``` declares a file the way ```ts title="src/app.ts"``` does; both end up as the fence's title. */
export function remarkCodeFenceTitle() {
  return (tree: MdastCode) => {
    const walk = (node: MdastCode) => {
      if (node.type === 'code' && node.lang?.includes(':')) {
        const [language, file] = node.lang.split(':', 2);
        node.lang = language;
        node.meta = [`title="${file}"`, node.meta ?? ''].filter(Boolean).join(' ');
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** The language a fenced block declares (its `language-*` class) and the file named in its meta string. */
export function parseCodeFence(className: unknown, meta: unknown): { language: string; fileName?: string } {
  const classes = Array.isArray(className) ? className : typeof className === 'string' ? className.split(/\s+/) : [];
  const languageClass = classes.find(
    (name): name is string => typeof name === 'string' && name.startsWith('language-'),
  );
  const language = languageClass?.slice('language-'.length) ?? '';
  const titled = typeof meta === 'string' ? /(?:title|file|filename)=(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(meta) : null;
  const fileName = titled?.[1] || titled?.[2] || titled?.[3] || undefined;
  return { language, ...(fileName ? { fileName } : {}) };
}
