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
