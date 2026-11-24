import { markdownLanguage } from '@codemirror/lang-markdown';

type MarkdownNode = ReturnType<typeof markdownLanguage.parser.parse>['topNode'];

function isRenderableBlock(node: MarkdownNode, source: string): boolean {
  return node.name !== 'LinkReference'
    && !(/^ATXHeading/u.test(node.name) && /^#{1,6}(?:[ \t]+#+)?[ \t]*$/u.test(source.slice(node.from, node.to)));
}

export function hasVisibleThinkingMarkdown(source: string): boolean {
  if (!source.trim()) return false;
  const document = markdownLanguage.parser.parse(source).topNode;
  for (let block = document.firstChild; block; block = block.nextSibling) {
    if (isRenderableBlock(block, source)) return true;
  }
  return false;
}
