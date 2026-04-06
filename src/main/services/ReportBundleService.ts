import fs from 'fs';
import path from 'path';
import type { Report } from '@shared/types/workflow';
import type { RunLlmExecutionSummary } from './DebuggerLlmService';

export interface ReportBundleInput {
  projectRoot: string;
  sessionId: string;
  runId: string;
  goal: string;
  report: Report;
  evidenceSummary?: string[];
  verificationSummary?: string[];
  eventCount?: number;
  artifactPaths?: string[];
  llmExecution?: RunLlmExecutionSummary | null;
}

export interface ReportBundleResult {
  reportsDir: string;
  markdownPath: string;
  jsonPath: string;
  htmlPath: string;
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export class ReportBundleService {
  publish(input: ReportBundleInput): ReportBundleResult {
    const reportsDir = path.join(
      input.projectRoot,
      'sessions',
      input.sessionId,
      'runs',
      input.runId,
      'reports',
    );
    fs.mkdirSync(reportsDir, { recursive: true });

    const markdownPath = path.join(reportsDir, 'report.md');
    const jsonPath = path.join(reportsDir, 'report.json');
    const htmlPath = path.join(reportsDir, 'visual_report.html');

    const payload = {
      sessionId: input.sessionId,
      runId: input.runId,
      goal: input.goal,
      eventCount: input.eventCount ?? 0,
      artifactPaths: input.artifactPaths ?? [],
      evidenceSummary: input.evidenceSummary ?? input.report.evidenceSummary,
      verificationSummary: input.verificationSummary ?? [],
      llmExecution: input.llmExecution ?? null,
      report: input.report,
    };

    fs.writeFileSync(markdownPath, this.buildMarkdown(payload), 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    fs.writeFileSync(htmlPath, this.buildHtml(payload), 'utf8');

    return {
      reportsDir,
      markdownPath,
      jsonPath,
      htmlPath,
    };
  }

  private buildMarkdown(payload: {
    sessionId: string;
    runId: string;
    goal: string;
    eventCount: number;
    artifactPaths: string[];
    evidenceSummary: string[];
    verificationSummary: string[];
    llmExecution: RunLlmExecutionSummary | null;
    report: Report;
  }): string {
    const lines: string[] = [
      `# ${payload.report.title}`,
      '',
      '## Task Goal',
      payload.goal || 'N/A',
      '',
      '## Summary',
      payload.report.summary || 'N/A',
      '',
      '## Root Cause',
      payload.report.rootCause || 'N/A',
      '',
      '## Fix Verification',
      payload.report.fixDescription || 'N/A',
      '',
      '## Evidence Summary',
      ...(payload.evidenceSummary.length > 0 ? payload.evidenceSummary.map((item) => `- ${item}`) : ['- N/A']),
      '',
      '## Verification Notes',
      ...(payload.verificationSummary.length > 0 ? payload.verificationSummary.map((item) => `- ${item}`) : ['- N/A']),
      '',
      '## LLM Execution',
      ...(payload.llmExecution
        ? [
            `- Provider ID: ${payload.llmExecution.providerId}`,
            `- Model ID: ${payload.llmExecution.modelId}`,
            `- Successful Calls: ${payload.llmExecution.successfulCallCount}`,
            `- Failed Calls: ${payload.llmExecution.failedCallCount}`,
            `- First Request ID: ${payload.llmExecution.firstRequestId || 'N/A'}`,
            `- Token Usage: input=${payload.llmExecution.totalInputTokens}, output=${payload.llmExecution.totalOutputTokens}`,
          ]
        : ['- N/A']),
      '',
      '## Recommendations',
      ...(payload.report.recommendations.length > 0 ? payload.report.recommendations.map((item) => `- ${item}`) : ['- N/A']),
      '',
      '## Run Metadata',
      `- Session ID: ${payload.sessionId}`,
      `- Run ID: ${payload.runId}`,
      `- Event Count: ${payload.eventCount}`,
      `- Confidence: ${payload.report.confidence}`,
      '',
      '## Related Artifacts',
      ...(payload.artifactPaths.length > 0 ? payload.artifactPaths.map((item) => `- ${item}`) : ['- N/A']),
      '',
    ];

    return lines.join('\n');
  }

  private buildHtml(payload: {
    sessionId: string;
    runId: string;
    goal: string;
    eventCount: number;
    artifactPaths: string[];
    evidenceSummary: string[];
    verificationSummary: string[];
    llmExecution: RunLlmExecutionSummary | null;
    report: Report;
  }): string {
    const evidenceItems = (payload.evidenceSummary.length > 0 ? payload.evidenceSummary : ['N/A'])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const verificationItems = (payload.verificationSummary.length > 0 ? payload.verificationSummary : ['N/A'])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const recommendationItems = (payload.report.recommendations.length > 0 ? payload.report.recommendations : ['N/A'])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const artifactItems = (payload.artifactPaths.length > 0 ? payload.artifactPaths : ['N/A'])
      .map((item) => `<li><code>${escapeHtml(item)}</code></li>`)
      .join('');
    const llmItems = payload.llmExecution
      ? [
          `<li>Provider ID: <code>${escapeHtml(payload.llmExecution.providerId)}</code></li>`,
          `<li>Model ID: <code>${escapeHtml(payload.llmExecution.modelId)}</code></li>`,
          `<li>Successful Calls: ${payload.llmExecution.successfulCallCount}</li>`,
          `<li>Failed Calls: ${payload.llmExecution.failedCallCount}</li>`,
          `<li>First Request ID: <code>${escapeHtml(payload.llmExecution.firstRequestId || 'N/A')}</code></li>`,
          `<li>Token Usage: input=${payload.llmExecution.totalInputTokens}, output=${payload.llmExecution.totalOutputTokens}</li>`,
        ].join('')
      : '<li>N/A</li>';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.report.title)}</title>
  <style>
    :root {
      --bg: #0d1117;
      --panel: #161b22;
      --muted: #8b949e;
      --text: #e6edf3;
      --accent: #4cc2ff;
      --border: #30363d;
      --success: #3fb950;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", sans-serif;
      background: radial-gradient(circle at top, #162234, var(--bg) 55%);
      color: var(--text);
    }
    .page {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }
    .hero, .section {
      background: color-mix(in srgb, var(--panel) 92%, black);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
    }
    .eyebrow {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 12px;
      margin-bottom: 8px;
    }
    h1, h2 { margin: 0 0 12px; }
    p { line-height: 1.6; color: var(--text); }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .meta-item {
      background: rgba(255,255,255,0.02);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
    }
    .meta-item .label {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .meta-item .value {
      color: var(--text);
      font-weight: 600;
      word-break: break-word;
    }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 8px 0; color: var(--text); }
    .confidence {
      color: var(--success);
      font-weight: 700;
    }
    code {
      font-family: "JetBrains Mono", Consolas, monospace;
      color: #9cdcfe;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="eyebrow">RDC Agent Report</div>
      <h1>${escapeHtml(payload.report.title)}</h1>
      <p>${escapeHtml(payload.report.summary || 'N/A')}</p>
      <div class="meta">
        <div class="meta-item"><div class="label">Session</div><div class="value">${escapeHtml(payload.sessionId)}</div></div>
        <div class="meta-item"><div class="label">Run</div><div class="value">${escapeHtml(payload.runId)}</div></div>
        <div class="meta-item"><div class="label">Events</div><div class="value">${payload.eventCount}</div></div>
        <div class="meta-item"><div class="label">Confidence</div><div class="value confidence">${escapeHtml(String(payload.report.confidence))}</div></div>
      </div>
    </section>
    <section class="section">
      <div class="eyebrow">Task Goal</div>
      <p>${escapeHtml(payload.goal || 'N/A')}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Root Cause</div>
      <p>${escapeHtml(payload.report.rootCause || 'N/A')}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Fix Verification</div>
      <p>${escapeHtml(payload.report.fixDescription || 'N/A')}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Evidence Summary</div>
      <ul>${evidenceItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">Verification Notes</div>
      <ul>${verificationItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">LLM Execution</div>
      <ul>${llmItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">Recommendations</div>
      <ul>${recommendationItems}</ul>
    </section>
    <section class="section">
      <div class="eyebrow">Artifacts</div>
      <ul>${artifactItems}</ul>
    </section>
  </main>
</body>
</html>`;
  }
}

export const reportBundleService = new ReportBundleService();
