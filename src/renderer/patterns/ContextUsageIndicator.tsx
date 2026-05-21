import type { RunContextUsageSummary } from '@shared/types/session';

const formatTokenCount = (value: number): string => new Intl.NumberFormat('en-US').format(value);

const buildUsageCopy = (
  usage: RunContextUsageSummary | null,
  language: string,
): { ariaLabel: string; lineOne: string; lineTwo: string } => {
  const usagePercent = usage?.usagePercent ?? 0;
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? 0;

  if (language === 'zh-CN') {
    return {
      ariaLabel: usage?.hasConfiguredContextWindow
        ? `上下文窗口已用 ${usagePercent}%，输入 ${formatTokenCount(inputTokens)}，输出 ${formatTokenCount(outputTokens)}，总计 ${formatTokenCount(totalTokens)}，窗口上限 ${formatTokenCount(usage.contextWindowTokens ?? 0)}`
        : `上下文窗口已用 ${usagePercent}%，输入 ${formatTokenCount(inputTokens)}，输出 ${formatTokenCount(outputTokens)}，总计 ${formatTokenCount(totalTokens)}，当前模型未配置窗口上限`,
      lineOne: usage?.hasConfiguredContextWindow
        ? `已用 ${usagePercent}% · 窗口 ${formatTokenCount(usage.contextWindowTokens ?? 0)}`
        : `已用 ${usagePercent}% · 窗口未配置`,
      lineTwo: `输入 ${formatTokenCount(inputTokens)} · 输出 ${formatTokenCount(outputTokens)} · 总计 ${formatTokenCount(totalTokens)}`,
    };
  }

  return {
    ariaLabel: usage?.hasConfiguredContextWindow
      ? `Context window ${usagePercent}% used. Input ${formatTokenCount(inputTokens)}, output ${formatTokenCount(outputTokens)}, total ${formatTokenCount(totalTokens)}, window ${formatTokenCount(usage.contextWindowTokens ?? 0)}.`
      : `Context window ${usagePercent}% used. Input ${formatTokenCount(inputTokens)}, output ${formatTokenCount(outputTokens)}, total ${formatTokenCount(totalTokens)}. No context window configured for this model.`,
    lineOne: usage?.hasConfiguredContextWindow
      ? `${usagePercent}% used · window ${formatTokenCount(usage.contextWindowTokens ?? 0)}`
      : `${usagePercent}% used · window not set`,
    lineTwo: `In ${formatTokenCount(inputTokens)} · Out ${formatTokenCount(outputTokens)} · Total ${formatTokenCount(totalTokens)}`,
  };
};

export const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  language: string;
}> = ({ usage, language }) => {
  const usagePercent = usage?.usagePercent ?? 0;
  const normalizedPercent = Math.max(0, Math.min(100, usagePercent));
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (normalizedPercent / 100));
  const copy = buildUsageCopy(usage, language);

  return (
    <div
      className={`composer-usage-indicator ${usage?.hasConfiguredContextWindow ? 'is-configured' : 'is-unconfigured'}`}
      data-testid="composer-usage-indicator"
      tabIndex={0}
      role="img"
      aria-label={copy.ariaLabel}
    >
      <svg className="composer-usage-ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="composer-usage-ring-track" cx="22" cy="22" r={radius} />
        <circle
          className="composer-usage-ring-progress"
          cx="22"
          cy="22"
          r={radius}
          style={{
            strokeDasharray: `${circumference} ${circumference}`,
            strokeDashoffset: dashOffset,
          }}
        />
      </svg>
      <span className="composer-usage-value">{normalizedPercent}%</span>
      <div className="composer-usage-tooltip" role="tooltip">
        <div className="composer-usage-tooltip-line composer-usage-tooltip-line-strong">{copy.lineOne}</div>
        <div className="composer-usage-tooltip-line">{copy.lineTwo}</div>
      </div>
    </div>
  );
};
