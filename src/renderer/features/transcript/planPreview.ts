import { PLAN_EXECUTION_REFERENCES_HEADING } from '@shared/utils/planAppendix';
import type { ConversationPlanReview } from '@shared/types/planReview';

/** A bounded projection excerpt, never a replacement for verified plan.read. */
export function planPreview(plan: ConversationPlanReview): string {
  const summary = plan.summary.filter((line) => line.trim() !== plan.title.trim());
  const sections = plan.sections.slice(0, 3).map(({ heading, body }) => {
    const title = heading.trim();
    const content = body.replace(/^\s*#{1,6}\s+(.+?)\s*\n/, (line, value: string) => (
      value.trim() === plan.title.trim() || value.trim() === title ? '' : line
    ));
    return [title && title !== plan.title.trim() ? `### ${title}` : '', content].filter(Boolean).join('\n\n');
  });
  const sectionLines = new Set(sections.flatMap((section) => section.split('\n')
    .map((line) => line.replace(/^\s*[-*+]\s+/, '').trim())));
  return [...summary.filter((line) => !sectionLines.has(line.trim())), ...sections].join('\n\n').slice(0, 4000);
}

/** Appendix as shown inside its disclosure: the disclosure names it, so its own heading is dropped and contract headings sit one level down. */
export function planAppendixMarkdown(appendix: string): string {
  return appendix.replace(new RegExp(`^${PLAN_EXECUTION_REFERENCES_HEADING}[ \\t]*\\n*`), '').replace(/^##(?=[ \t])/gm, '###');
}
