import { expect, test } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeApp, launchApp } from './helpers/electron-app';

const MODEL_KEY_PATH = 'C:\\Users\\a1824\\Desktop\\Model Key.txt';
const PROVIDER_ID = 'deepseek-openai-compatible';
const MODEL_ID = 'deepseek-v4-flash';
const MODEL_LABEL = 'v4-flash';
const SECRET_REF = `provider-${PROVIDER_ID}-api-key`;
const LIVE_SENTINEL = 'RDC_AGENT_LIVE_SMOKE_OK';
const AGENT_IDS = [
  'rdc-debugger',
  'triage_agent',
  'capture_repro_agent',
  'pass_graph_pipeline_agent',
  'pixel_forensics_agent',
  'shader_ir_agent',
  'driver_device_agent',
  'skeptic_agent',
  'curator_agent',
] as const;

interface ParsedModelKeyFile {
  apiKey: string;
  openAiBaseUrl: string;
  anthropicBaseUrl: string | null;
  diagnostics: {
    urlCount: number;
    keyPresent: boolean;
    openAiUrlPresent: boolean;
    anthropicUrlPresent: boolean;
  };
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["'`]+|["'`]+$/g, '');
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(stripQuotes(value));
  return parsed.toString().replace(/\/$/, '');
}

function findUrlInLine(line: string | undefined): string | null {
  return line?.match(/https?:\/\/[^\s"'`<>]+/i)?.[0] ?? null;
}

function readModelKeyFile(): ParsedModelKeyFile {
  if (!fs.existsSync(MODEL_KEY_PATH)) {
    throw new Error(`Model key file is missing: ${MODEL_KEY_PATH}`);
  }

  const content = fs.readFileSync(MODEL_KEY_PATH, 'utf8');
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const urlMatches = [...content.matchAll(/https?:\/\/[^\s"'`<>]+/gi)].map((match) => stripQuotes(match[0]));
  const openAiLine = lines.find((line) => /openai/i.test(line) && /https?:\/\//i.test(line));
  const anthropicLine = lines.find((line) => /anthropic/i.test(line) && /https?:\/\//i.test(line));
  const openAiUrl = findUrlInLine(openAiLine);
  const anthropicUrl = findUrlInLine(anthropicLine);
  const openAiBaseUrl = openAiUrl ? normalizeBaseUrl(openAiUrl) : '';
  const anthropicBaseUrl = anthropicUrl ? normalizeBaseUrl(anthropicUrl) : null;

  let currentSection = '';
  const keyCandidates = lines
    .reduce<Array<{ value: string; line: string; section: string }>>((candidates, line) => {
      if (/open\s*rout?er|openrouter/i.test(line)) {
        currentSection = 'openrouter';
      } else if (/deep\s*seek|deepseek/i.test(line)) {
        currentSection = 'deepseek';
      }
      if (/https?:\/\//i.test(line)) {
        return candidates;
      }
      const explicitMatches = line.match(/\b(?:sk|ds|ak|rk)-[a-z0-9._-]{12,}\b/gi);
      if (explicitMatches?.length) {
        candidates.push(...explicitMatches.map((value) => ({ value, line, section: currentSection })));
        return candidates;
      }
      const tail = stripQuotes(line.split(/[:：]/).pop() ?? '');
      if (tail.length >= 20 && !/\s/.test(tail)) {
        candidates.push({ value: tail, line, section: currentSection });
      }
      return candidates;
    }, []);
  const preferredKey = keyCandidates.find((candidate) => candidate.section === 'deepseek')
    ?? keyCandidates.find((candidate) => /deepseek|api|key/i.test(candidate.line) && !/openrouter/i.test(candidate.line))
    ?? keyCandidates.find((candidate) => !/openrouter/i.test(candidate.line))
    ?? keyCandidates[0];

  if (!preferredKey?.value) {
    throw new Error('DeepSeek API key is missing from model key file');
  }
  if (!openAiBaseUrl) {
    throw new Error('DeepSeek OpenAI-compatible base URL is missing from model key file');
  }

  return {
    apiKey: preferredKey.value,
    openAiBaseUrl,
    anthropicBaseUrl,
    diagnostics: {
      urlCount: urlMatches.length,
      keyPresent: true,
      openAiUrlPresent: true,
      anthropicUrlPresent: Boolean(anthropicBaseUrl),
    },
  };
}

test.skip(process.env.RDC_AGENT_DEEPSEEK_LIVE !== '1', 'Set RDC_AGENT_DEEPSEEK_LIVE=1 to run the real DeepSeek SDK smoke.');

test('DeepSeek v4-flash enters Settings secret route and OpenAI Agent SDK adapter', async () => {
  const parsed = readModelKeyFile();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-deepseek-live-'));
  const ctx = await launchApp({
    testMode: false,
    tempDir,
    userDataDir: path.join(tempDir, 'userData'),
    workspaceDir: path.join(tempDir, 'workspace'),
    cleanupOnClose: true,
  });

  try {
    const setup = await ctx.page.evaluate(async ({ providerId, modelId, modelLabel, secretRef, apiKey, baseUrl, agentIds }) => {
      const settings = await window.electronAPI.settings.get();
      const existingRoutes = settings.llm.agentRoutes.length > 0
        ? settings.llm.agentRoutes
        : agentIds.map((agentId) => ({ agentId, providerId: '', modelId: '' }));

      await window.electronAPI.settings.set({
        llm: {
          providers: [
            {
              id: providerId,
              kind: 'openai-compatible',
              label: 'DeepSeek OpenAI-compatible',
              enabled: true,
              apiKey,
              secretRef,
              hasStoredSecret: false,
              baseUrl,
              models: [{
                id: modelId,
                label: modelLabel,
                enabled: true,
                contextWindowTokens: null,
              }],
              recommendedModels: [modelId],
              docsUrl: '',
              isConfigured: true,
            },
          ],
          agentRoutes: existingRoutes.map((route) => ({
            ...route,
            providerId: route.agentId === 'rdc-debugger' ? providerId : route.providerId,
            modelId: route.agentId === 'rdc-debugger' ? modelId : route.modelId,
          })),
        },
      });

      const confirmed = await window.electronAPI.settings.get();
      const provider = confirmed.llm.providers.find((entry) => entry.id === providerId);
      const route = confirmed.llm.agentRoutes.find((entry) => entry.agentId === 'rdc-debugger');
      const secret = await window.electronAPI.settings.getProviderSecret(providerId);
      return {
        providerKind: provider?.kind ?? null,
        providerConfigured: Boolean(provider?.enabled && provider?.isConfigured),
        providerApiKeyPersisted: Boolean(provider?.apiKey),
        hasStoredSecret: Boolean(provider?.hasStoredSecret),
        secretPresent: Boolean(secret),
        routeProviderId: route?.providerId ?? null,
        routeModelId: route?.modelId ?? null,
      };
    }, {
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      modelLabel: MODEL_LABEL,
      secretRef: SECRET_REF,
      apiKey: parsed.apiKey,
      baseUrl: parsed.openAiBaseUrl,
      agentIds: AGENT_IDS,
    });

    expect(parsed.diagnostics).toMatchObject({
      keyPresent: true,
      openAiUrlPresent: true,
      anthropicUrlPresent: true,
    });
    expect(setup).toMatchObject({
      providerKind: 'openai-compatible',
      providerConfigured: true,
      providerApiKeyPersisted: false,
      hasStoredSecret: true,
      secretPresent: true,
      routeProviderId: PROVIDER_ID,
      routeModelId: MODEL_ID,
    });

    const liveResult = await ctx.page.evaluate(async ({ sentinel }) => {
      const response = await window.electronAPI.agent.sendMessage(
        'rdc-debugger',
        `Reply with exactly: ${sentinel}`,
      );
      if (response.error) {
        throw new Error(`agent_send_failed: ${response.error}`);
      }
      const logs = await window.electronAPI.runtimeLog.list({ scope: 'app' });
      const selected = logs.entries
        .filter((entry) => entry.title === 'Agent runner selected')
        .reverse()
        .find((entry) => {
          const raw = entry.raw as Record<string, unknown> | undefined;
          return raw?.providerId === 'deepseek-openai-compatible' && raw?.modelId === 'deepseek-v4-flash';
        });

      return {
        response: response.response ?? '',
        selectedRaw: (selected?.raw ?? null) as Record<string, unknown> | null,
      };
    }, {
      sentinel: LIVE_SENTINEL,
    });

    expect(liveResult.response).toContain(LIVE_SENTINEL);
    expect(liveResult.selectedRaw).toMatchObject({
      agentId: 'rdc-debugger',
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      adapter: 'openai-agents-sdk',
    });
  } finally {
    await closeApp(ctx);
  }
});
