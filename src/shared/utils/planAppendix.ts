import { PLAN_INVESTIGATION_HEADING } from '../types/planInvestigation';
import { PLAN_TASK_REQUIREMENTS_HEADING } from '../types/taskExecution';

/** Planner-written appendix holding the references only the executor needs. */
export const PLAN_EXECUTION_REFERENCES_HEADING = '## Execution references';

const APPENDIX_HEADINGS = [PLAN_EXECUTION_REFERENCES_HEADING, PLAN_INVESTIGATION_HEADING, PLAN_TASK_REQUIREMENTS_HEADING];

function headingLineIndex(text: string, heading: string): number {
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(heading, from);
    if (index < 0) return -1;
    const lineStart = index === 0 || text[index - 1] === '\n';
    const lineEnd = text.indexOf('\n', index);
    const rest = text.slice(index + heading.length, lineEnd < 0 ? text.length : lineEnd);
    if (lineStart && !rest.trim()) return index;
    from = index + heading.length;
  }
  return -1;
}

/**
 * A plan is a reader-facing body followed by an execution appendix. The appendix starts at the
 * first appendix heading — the planner's execution references or a host-generated contract — and
 * runs to the end of the document.
 */
export function splitPlanAppendix(markdown: string): { body: string; appendix: string } {
  const text = markdown.replace(/\r\n/g, '\n');
  const starts = APPENDIX_HEADINGS.map((heading) => headingLineIndex(text, heading)).filter((index) => index >= 0);
  if (!starts.length) return { body: text.trimEnd(), appendix: '' };
  const start = Math.min(...starts);
  return { body: text.slice(0, start).trimEnd(), appendix: text.slice(start).trim() };
}
