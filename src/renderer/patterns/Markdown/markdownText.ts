import type { ReactNode } from 'react';
import { isValidElement } from 'react';

/** Flatten react-markdown / rehype-highlight children into plain source text. */
export function flattenMarkdownText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenMarkdownText).join('');
  }
  if (isValidElement(node)) {
    return flattenMarkdownText((node.props as { children?: ReactNode }).children);
  }
  return '';
}
