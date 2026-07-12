/** Prompt 运行期时钟：为 PromptPlan 提供本地日期与时区（runtime-fact 段输入）。 */
export function resolvePromptClock(): { currentDate: string; timeZone: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  return {
    currentDate: formatPromptDate(new Date(), timeZone),
    timeZone,
  };
}

function formatPromptDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone === 'local' ? undefined : timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : date.toISOString().slice(0, 10);
}
