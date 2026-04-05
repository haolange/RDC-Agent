const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_ENTRY = path.join(REPO_ROOT, 'out', 'main', 'index.js');

const LOCAL_CAPTURE = process.env.RDC_SMOKE_LOCAL_CAPTURE || 'D:\\Utility\\DebugTest\\IRP_Desktop.rdc';
const REMOTE_CAPTURE = process.env.RDC_SMOKE_REMOTE_CAPTURE || 'D:\\Utility\\DebugTest\\HairSparkWhite.rdc';
const REMOTE_SERIAL = process.env.RDC_SMOKE_REMOTE_SERIAL || '8361c816';

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function poll(page, fn, options = {}, arg) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const intervalMs = options.intervalMs ?? 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await page.evaluate(fn, arg);
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms while polling.`);
}

async function evaluate(page, callback, arg) {
  return page.evaluate(callback, arg);
}

async function resolveWorkflowSnapshot(page, sessionId, runId) {
  await evaluate(page, async (targetSessionId) => {
    await window.electronAPI.workflow.resume(targetSessionId);
    return window.electronAPI.session.select(targetSessionId);
  }, sessionId);

  return poll(page, async ({ targetSessionId, targetRunId }) => {
    const state = await window.electronAPI.workflow.getState();
    if (state?.runId === targetRunId) {
      return { source: 'workflow', payload: state };
    }

    const runsResult = await window.electronAPI.run.list(targetSessionId);
    const currentRun = runsResult.runs?.find((entry) => entry.runId === targetRunId) ?? null;
    if (currentRun) {
      return { source: 'run', payload: currentRun };
    }

    return null;
  }, {
    timeoutMs: 120000,
    intervalMs: 1000,
  }, { targetSessionId: sessionId, targetRunId: runId });
}

async function main() {
  ensureFileExists(APP_ENTRY);
  ensureFileExists(LOCAL_CAPTURE);
  ensureFileExists(REMOTE_CAPTURE);

  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-agent-runtime-smoke-'));
  const projectRoot = path.join(smokeRoot, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });

  const app = await electron.launch({
    args: [APP_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  });

  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    const settingsSummary = await evaluate(page, async () => {
      const settings = await window.electronAPI.settings.get();
      const openrouterConnection = await window.electronAPI.llm.testConnection('openrouter');
      return {
        workspaceRoot: settings.workspace.rootPath,
        settingsPath: settings.paths.settingsPath,
        activeModeProfileId: settings.configuration.activeModeProfileId,
        openrouterConnection,
        configuredProviders: settings.llm.providers
          .filter((provider) => provider.isConfigured)
          .map((provider) => ({
            id: provider.id,
            enabled: provider.enabled,
            hasStoredSecret: provider.hasStoredSecret,
            apiKeyLength: provider.apiKey?.length ?? 0,
          })),
      };
    });

    console.log('[smoke] settings', JSON.stringify(settingsSummary, null, 2));
    assert(settingsSummary.activeModeProfileId === 'debugger.default', 'Active mode profile is not debugger.default.');
    assert(settingsSummary.configuredProviders.length > 0, 'No configured LLM provider available in real userData.');

    const projectResult = await evaluate(page, async (rootPath) => {
      return window.electronAPI.project.add(rootPath);
    }, projectRoot);
    assert(projectResult.success && projectResult.project, projectResult.error || 'Failed to create smoke project.');
    const projectId = projectResult.project.projectId;

    const devices = await evaluate(page, async () => {
      return window.electronAPI.device.refresh();
    });
    const localDevice = devices.find((device) => device.id === 'local');
    const remoteDevice = devices.find((device) => device.serial === REMOTE_SERIAL);
    assert(localDevice, 'Local replay device not found.');
    assert(remoteDevice, `Android replay device with serial ${REMOTE_SERIAL} not found.`);

    const localSessionResult = await evaluate(page, async ({ projectId }) => {
      return window.electronAPI.session.create(projectId, 'Runtime Smoke Local');
    }, { projectId });
    assert(localSessionResult.success && localSessionResult.session, localSessionResult.error || 'Failed to create local smoke session.');

    const localStartResult = await evaluate(page, async ({ projectId, sessionId, localCapture, localDevice }) => {
      return window.electronAPI.workflow.start({
        projectId,
        sessionId,
        mode: 'debugger',
        goal: 'Runtime smoke: validate local debugger production flow.',
        captures: [
          {
            id: 'local-primary',
            filePath: localCapture,
            role: 'primary',
            backendHint: 'local',
            status: 'pending',
          },
        ],
        primaryCaptureId: 'local-primary',
        replayDevice: localDevice,
      });
    }, {
      projectId,
      sessionId: localSessionResult.session.sessionId,
      localCapture: LOCAL_CAPTURE,
      localDevice,
    });
    console.log('[smoke] localStartResult', JSON.stringify(localStartResult, null, 2));
    assert(localStartResult.success, localStartResult.error || 'Local workflow.start failed.');

    const localSnapshot = await resolveWorkflowSnapshot(
      page,
      localSessionResult.session.sessionId,
      localStartResult.runId,
    );
    const localWorkflowState = await evaluate(page, async () => window.electronAPI.workflow.getState());
    const localContext = await evaluate(page, async () => window.electronAPI.context.get());
    const localEvidence = await evaluate(page, async () => window.electronAPI.evidence.getChain());
    const localRecentEvents = (localEvidence.events ?? []).slice(-8).map((event) => ({
      eventType: event.event_type,
      status: event.status,
      payload: event.payload,
    }));

    console.log('[smoke] local', JSON.stringify({
      source: localSnapshot.source,
      runId: localSnapshot.payload.runId,
      stage: localSnapshot.payload.currentStage ?? localSnapshot.payload.lastStage,
      blockers: localSnapshot.payload.blockers?.length ?? 0,
      evidenceCount: localEvidence.events?.length ?? 0,
      backend: localContext.backend,
      activeCapture: localContext.activeCapture,
      workflowState: localWorkflowState,
      recentEvents: localRecentEvents,
    }, null, 2));

    assert(localContext.backend === 'local', `Expected local backend, got ${localContext.backend}.`);
    assert((localSnapshot.payload.currentStage ?? localSnapshot.payload.lastStage) !== 'blocked', 'Local workflow ended in blocked stage.');
    assert((localEvidence.events?.length ?? 0) > 0, 'Local workflow did not emit evidence events.');

    const remoteSessionResult = await evaluate(page, async ({ projectId }) => {
      return window.electronAPI.session.create(projectId, 'Runtime Smoke Remote');
    }, { projectId });
    assert(remoteSessionResult.success && remoteSessionResult.session, remoteSessionResult.error || 'Failed to create remote smoke session.');

    const remoteStartResult = await evaluate(page, async ({ projectId, sessionId, remoteCapture, remoteDevice }) => {
      return window.electronAPI.workflow.start({
        projectId,
        sessionId,
        mode: 'debugger',
        goal: 'Runtime smoke: validate strict remote replay flow without local fallback.',
        captures: [
          {
            id: 'remote-primary',
            filePath: remoteCapture,
            role: 'primary',
            backendHint: 'remote',
            status: 'pending',
          },
        ],
        primaryCaptureId: 'remote-primary',
        replayDevice: remoteDevice,
      });
    }, {
      projectId,
      sessionId: remoteSessionResult.session.sessionId,
      remoteCapture: REMOTE_CAPTURE,
      remoteDevice,
    });
    console.log('[smoke] remoteStartResult', JSON.stringify(remoteStartResult, null, 2));
    assert(remoteStartResult.success, remoteStartResult.error || 'Remote workflow.start failed.');

    const remoteSnapshot = await resolveWorkflowSnapshot(
      page,
      remoteSessionResult.session.sessionId,
      remoteStartResult.runId,
    );
    const remoteContext = await evaluate(page, async () => window.electronAPI.context.get());
    const remoteEvidence = await evaluate(page, async () => window.electronAPI.evidence.getChain());

    console.log('[smoke] remote', JSON.stringify({
      source: remoteSnapshot.source,
      runId: remoteSnapshot.payload.runId,
      stage: remoteSnapshot.payload.currentStage ?? remoteSnapshot.payload.lastStage,
      blockers: remoteSnapshot.payload.blockers?.length ?? 0,
      evidenceCount: remoteEvidence.events?.length ?? 0,
      backend: remoteContext.backend,
      remoteStatus: remoteContext.remoteStatus,
      activeCapture: remoteContext.activeCapture,
      deviceLabel: remoteContext.deviceLabel,
    }, null, 2));

    assert(remoteContext.backend === 'remote', `Expected remote backend, got ${remoteContext.backend}.`);
    assert(remoteContext.remoteStatus === 'online', `Expected remote status online, got ${remoteContext.remoteStatus}.`);
    assert((remoteSnapshot.payload.currentStage ?? remoteSnapshot.payload.lastStage) !== 'blocked', 'Remote workflow ended in blocked stage.');
    assert((remoteEvidence.events?.length ?? 0) > 0, 'Remote workflow did not emit evidence events.');

    console.log('[smoke] success');
  } finally {
    await app.close();
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('[smoke] failure', error);
  process.exitCode = 1;
});
