/** Minimal mdast shapes this plugin rewrites. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];

const MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n)?/i;

/** `> [!NOTE]` style blockquotes become callouts; the marker leaves the text and the kind moves to `data-callout`. */
export function remarkCallouts() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (node.type === 'blockquote') {
        const paragraph = node.children?.[0];
        const text = paragraph?.type === 'paragraph' ? paragraph.children?.[0] : undefined;
        const match = text?.type === 'text' && text.value ? MARKER.exec(text.value) : null;
        if (paragraph && text && match) {
          text.value = text.value!.slice(match[0].length);
          if (!text.value) paragraph.children = paragraph.children?.slice(1).filter((child, index) => index > 0 || child.type !== 'break');
          if (!paragraph.children?.length) node.children = node.children?.slice(1);
          node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataCallout: match[1].toLowerCase() } };
        }
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
