"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const url = require("url");
const child_process = require("child_process");
const fs = require("fs");
const uuid = require("uuid");
const yaml = require("yaml");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
function generateShortId() {
  return uuid.v4().replace(/-/g, "").slice(0, 12);
}
function generateEventId(prefix = "evt") {
  return `${prefix}-${generateShortId()}-${Date.now()}`;
}
function generateCaseId() {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 6);
  return `case_${timestamp}_${random}`;
}
function generateRunId() {
  const random = Math.random().toString(36).slice(2, 6);
  return `run_${random}`;
}
function generateSessionId(caseId, runId) {
  return `sess_${sanitizeToken(caseId)}_${sanitizeToken(runId)}`;
}
function sanitizeToken(value) {
  const text = value.split("").map((ch) => ch.isAlphanumeric() || ch === "_" || ch === "-" ? ch : "-").join("").replace(/^-+|-+$/g, "");
  return text || "unknown";
}
String.prototype.isAlphanumeric = function() {
  return /^[a-zA-Z0-9]$/.test(this);
};
function nowMs() {
  return Date.now();
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
class ToolBridge {
  toolsPath;
  catalog = null;
  activeProcesses = /* @__PURE__ */ new Map();
  constructor() {
    if (electron.app.isPackaged) {
      this.toolsPath = path__namespace.join(path__namespace.dirname(electron.app.getPath("exe")), "resources", "tools");
    } else {
      this.toolsPath = path__namespace.resolve(__dirname, "../../../../resources/tools");
    }
  }
  /**
   * 获取工具目录路径
   */
  getToolsPath() {
    return this.toolsPath;
  }
  /**
   * 获取rdx.bat路径
   */
  getRdxPath() {
    return path__namespace.join(this.toolsPath, "rdx.bat");
  }
  /**
   * 检查工具是否可用
   */
  isAvailable() {
    const rdxPath = this.getRdxPath();
    return fs__namespace.existsSync(rdxPath);
  }
  /**
   * 加载工具目录
   */
  async loadCatalog() {
    if (this.catalog) {
      return this.catalog;
    }
    const catalogPath = path__namespace.join(this.toolsPath, "spec", "tool_catalog.json");
    if (!fs__namespace.existsSync(catalogPath)) {
      throw new Error(`Tool catalog not found at: ${catalogPath}`);
    }
    const content = await fs__namespace.promises.readFile(catalogPath, "utf-8");
    this.catalog = JSON.parse(content);
    return this.catalog;
  }
  /**
   * 执行CLI命令
   */
  async executeCLI(command, args = [], options = {}) {
    const startTime = nowMs();
    const rdxPath = this.getRdxPath();
    return new Promise((resolve, reject) => {
      const proc = child_process.spawn("cmd.exe", ["/c", rdxPath, "--non-interactive", "cli", command, ...args], {
        cwd: options.cwd || this.toolsPath,
        env: {
          ...process.env,
          ...options.env,
          PYTHONIOENCODING: "utf-8"
        },
        windowsHide: true
      });
      const procId = generateEventId("proc");
      this.activeProcesses.set(procId, proc);
      let stdout = "";
      let stderr = "";
      let timeoutId = null;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          proc.kill();
          this.activeProcesses.delete(procId);
          reject(new Error(`Process timeout after ${options.timeout}ms`));
        }, options.timeout);
      }
      proc.stdout.on("data", (data) => {
        stdout += data.toString("utf-8");
      });
      proc.stderr.on("data", (data) => {
        stderr += data.toString("utf-8");
      });
      proc.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          duration_ms: nowMs() - startTime
        });
      });
      proc.on("error", (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        reject(error);
      });
    });
  }
  /**
   * 调用rd.*工具
   */
  async call(request) {
    const startTime = nowMs();
    try {
      const args = ["call", request.toolName];
      if (request.args && Object.keys(request.args).length > 0) {
        const argsJson = JSON.stringify(request.args);
        args.push("--args-json", argsJson);
      }
      const result = await this.executeCLI(args.join(" "), [], {
        timeout: 6e4
        // 60秒超时
      });
      if (result.exitCode === 0 && result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout);
          return {
            ok: parsed.ok ?? true,
            data: parsed.data || parsed,
            artifacts: parsed.artifacts,
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId("tool")
          };
        } catch {
          return {
            ok: true,
            data: { raw: result.stdout },
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId("tool")
          };
        }
      } else {
        return {
          ok: false,
          error: {
            code: "CLI_ERROR",
            message: result.stderr || `Exit code: ${result.exitCode}`,
            category: "execution",
            details: { stdout: result.stdout, stderr: result.stderr }
          },
          duration_ms: nowMs() - startTime,
          trace_id: generateEventId("tool")
        };
      }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          category: "internal"
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId("tool")
      };
    }
  }
  /**
   * 打开capture文件
   */
  async openCapture(filePath, options = {}) {
    const args = {
      file: filePath
    };
    if (options.frameIndex !== void 0) {
      args["frame-index"] = options.frameIndex;
    }
    if (options.preview) {
      args["--preview"] = true;
    }
    return this.call({
      toolName: "rd.capture.open_file",
      args
    });
  }
  /**
   * 打开replay session
   */
  async openReplay(captureFileId, options = {}) {
    const args = {
      capture_file_id: captureFileId
    };
    if (options.remoteId) {
      args.options = { remote_id: options.remoteId };
    }
    return this.call({
      toolName: "rd.capture.open_replay",
      args
    });
  }
  /**
   * 获取session context
   */
  async getSessionContext(sessionId) {
    return this.call({
      toolName: "rd.session.get_context",
      args: sessionId ? { session_id: sessionId } : {}
    });
  }
  /**
   * 获取capture状态
   */
  async getCaptureStatus() {
    return this.call({
      toolName: "rd.capture.status",
      args: {}
    });
  }
  /**
   * 获取session状态
   */
  async getSessionStatus() {
    return this.call({
      toolName: "rd.session.status",
      args: {}
    });
  }
  /**
   * 列出可用工具
   */
  async listTools(options = {}) {
    return this.call({
      toolName: "rd.core.list_tools",
      args: options
    });
  }
  /**
   * 终止所有活动进程
   */
  terminateAll() {
    for (const [id, proc] of this.activeProcesses) {
      try {
        proc.kill();
      } catch (error) {
        console.error(`Failed to terminate process ${id}:`, error);
      }
    }
    this.activeProcesses.clear();
  }
}
const toolBridge = new ToolBridge();
function readYaml(filePath) {
  try {
    if (!fs__namespace.existsSync(filePath)) {
      return null;
    }
    const content = fs__namespace.readFileSync(filePath, "utf-8");
    return yaml.parse(content);
  } catch (error) {
    console.error(`Failed to read YAML file: ${filePath}`, error);
    return null;
  }
}
function writeYaml(filePath, data) {
  try {
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    const content = yaml.stringify(data, {
      indent: 2,
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN"
    });
    fs__namespace.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to write YAML file: ${filePath}`, error);
    return false;
  }
}
function readJsonl(filePath) {
  try {
    if (!fs__namespace.existsSync(filePath)) {
      return [];
    }
    const content = fs__namespace.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    const results = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
    return results;
  } catch (error) {
    console.error(`Failed to read JSONL file: ${filePath}`, error);
    return [];
  }
}
function appendJsonl(filePath, data) {
  try {
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    const serialized = JSON.stringify(data, null, 0);
    if (fs__namespace.existsSync(filePath)) {
      const existing = fs__namespace.readFileSync(filePath, "utf-8");
      if (existing.includes(serialized)) {
        return true;
      }
      if (existing && !existing.endsWith("\n")) {
        fs__namespace.appendFileSync(filePath, "\n", "utf-8");
      }
    }
    fs__namespace.appendFileSync(filePath, serialized + "\n", "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to append to JSONL file: ${filePath}`, error);
    return false;
  }
}
class StorageAdapter {
  workspacePath;
  constructor() {
    if (electron.app.isPackaged) {
      this.workspacePath = path__namespace.join(path__namespace.dirname(electron.app.getPath("exe")), "workspace");
    } else {
      this.workspacePath = path__namespace.resolve(__dirname, "../../../../workspace");
    }
  }
  /**
   * 获取workspace路径
   */
  getWorkspacePath() {
    return this.workspacePath;
  }
  /**
   * 初始化workspace目录结构
   */
  async initializeWorkspace() {
    const dirs = [
      this.workspacePath,
      path__namespace.join(this.workspacePath, "cases"),
      path__namespace.join(this.workspacePath, "common", "knowledge", "library", "sessions"),
      path__namespace.join(this.workspacePath, "common", "knowledge", "library", "bugcards"),
      path__namespace.join(this.workspacePath, "common", "knowledge", "library", "bugfull"),
      path__namespace.join(this.workspacePath, "common", "knowledge", "spec", "objects", "taxonomy"),
      path__namespace.join(this.workspacePath, "common", "knowledge", "spec", "objects", "sops"),
      path__namespace.join(this.workspacePath, "common", "knowledge", "spec", "registry"),
      path__namespace.join(this.workspacePath, "common", "config"),
      path__namespace.join(this.workspacePath, "common", "skills")
    ];
    for (const dir of dirs) {
      if (!fs__namespace.existsSync(dir)) {
        await fs__namespace.promises.mkdir(dir, { recursive: true });
      }
    }
  }
  // ========== Case 管理 ==========
  /**
   * 获取case目录路径
   */
  getCasePath(caseId) {
    return path__namespace.join(this.workspacePath, "cases", caseId);
  }
  /**
   * 创建新的case
   */
  async createCase(input) {
    const caseId = input.caseId || generateCaseId();
    const casePath = this.getCasePath(caseId);
    const dirs = [
      casePath,
      path__namespace.join(casePath, "artifacts"),
      path__namespace.join(casePath, "inputs", "captures"),
      path__namespace.join(casePath, "inputs", "references"),
      path__namespace.join(casePath, "runs")
    ];
    for (const dir of dirs) {
      if (!fs__namespace.existsSync(dir)) {
        await fs__namespace.promises.mkdir(dir, { recursive: true });
      }
    }
    const caseData = {
      case_id: caseId,
      created_at: nowIso(),
      user_goal: input.userGoal,
      symptom_summary: input.symptomSummary,
      current_run: null
    };
    await writeYaml(path__namespace.join(casePath, "case.yaml"), caseData);
    return caseId;
  }
  /**
   * 读取case数据
   */
  async readCase(caseId) {
    const casePath = path__namespace.join(this.getCasePath(caseId), "case.yaml");
    return readYaml(casePath);
  }
  /**
   * 更新case数据
   */
  async updateCase(caseId, data) {
    const existing = await this.readCase(caseId) || {};
    const casePath = path__namespace.join(this.getCasePath(caseId), "case.yaml");
    await writeYaml(casePath, { ...existing, ...data, updated_at: nowIso() });
  }
  // ========== Run 管理 ==========
  /**
   * 获取run目录路径
   */
  getRunPath(caseId, runId) {
    return path__namespace.join(this.getCasePath(caseId), "runs", runId);
  }
  /**
   * 创建新的run
   */
  async createRun(input) {
    const runId = input.runId || generateRunId();
    const sessionId = input.sessionId || generateSessionId(input.caseId, runId);
    const runPath = this.getRunPath(input.caseId, runId);
    const dirs = [
      runPath,
      path__namespace.join(runPath, "artifacts"),
      path__namespace.join(runPath, "artifacts", "runtime_batons"),
      path__namespace.join(runPath, "artifacts", "capability_tokens"),
      path__namespace.join(runPath, "artifacts", "runtime_locks"),
      path__namespace.join(runPath, "notes"),
      path__namespace.join(runPath, "screenshots"),
      path__namespace.join(runPath, "reports"),
      path__namespace.join(runPath, "logs")
    ];
    for (const dir of dirs) {
      if (!fs__namespace.existsSync(dir)) {
        await fs__namespace.promises.mkdir(dir, { recursive: true });
      }
    }
    const runData = {
      run_id: runId,
      session_id: sessionId,
      case_id: input.caseId,
      created_at: nowIso(),
      coordination_mode: "staged_handoff",
      orchestration_mode: "multi_agent",
      runtime: {
        backend: "local",
        entry_mode: "cli",
        context_id: "ctx-orchestrator",
        runtime_owner: "rdc-debugger",
        session_id: sessionId,
        workflow_stage: "accepted_intake_initialized"
      }
    };
    await writeYaml(path__namespace.join(runPath, "run.yaml"), runData);
    const captureRefs = {
      captures: input.capturePaths.map((p, i) => ({
        capture_id: `cap-${i === 0 ? "anomalous" : i === 1 ? "baseline" : "fixed"}-${String(i + 1).padStart(3, "0")}`,
        capture_role: i === 0 ? "anomalous" : i === 1 ? "baseline" : "fixed",
        source_path: p
      }))
    };
    await writeYaml(path__namespace.join(runPath, "capture_refs.yaml"), captureRefs);
    const hypothesisBoard = {
      hypothesis_board: {
        session_id: sessionId,
        entry_skill: "rdc-debugger",
        user_goal: "",
        intake_state: "handoff_ready",
        current_phase: "intake",
        current_task: "",
        active_owner: "rdc-debugger",
        pending_requirements: [],
        blocking_issues: [],
        progress_summary: ["accepted intake complete"],
        next_actions: ["run dispatch_readiness before specialist dispatch"],
        last_updated: nowIso(),
        hypotheses: []
      }
    };
    await writeYaml(path__namespace.join(runPath, "notes", "hypothesis_board.yaml"), hypothesisBoard);
    await this.updateCase(input.caseId, { current_run: runId });
    const sessionMarkerPath = path__namespace.join(
      this.workspacePath,
      "common",
      "knowledge",
      "library",
      "sessions",
      ".current_session"
    );
    await fs__namespace.promises.writeFile(sessionMarkerPath, `${sessionId}
`, "utf-8");
    return { runId, sessionId };
  }
  /**
   * 读取run数据
   */
  async readRun(caseId, runId) {
    const runPath = path__namespace.join(this.getRunPath(caseId, runId), "run.yaml");
    return readYaml(runPath);
  }
  /**
   * 更新run数据
   */
  async updateRun(caseId, runId, data) {
    const existing = await this.readRun(caseId, runId) || {};
    const runPath = path__namespace.join(this.getRunPath(caseId, runId), "run.yaml");
    await writeYaml(runPath, { ...existing, ...data, updated_at: nowIso() });
  }
  // ========== Artifact 管理 ==========
  /**
   * 写入artifact
   */
  async writeArtifact(caseId, runId, artifactName, data) {
    const artifactPath = path__namespace.join(this.getRunPath(caseId, runId), "artifacts", artifactName);
    await writeYaml(artifactPath, data);
    return artifactPath;
  }
  /**
   * 读取artifact
   */
  async readArtifact(caseId, runId, artifactName) {
    const artifactPath = path__namespace.join(this.getRunPath(caseId, runId), "artifacts", artifactName);
    return readYaml(artifactPath);
  }
  // ========== Action Chain ==========
  /**
   * 获取action_chain路径
   */
  getActionChainPath(sessionId) {
    return path__namespace.join(
      this.workspacePath,
      "common",
      "knowledge",
      "library",
      "sessions",
      sessionId,
      "action_chain.jsonl"
    );
  }
  /**
   * 追加事件到action_chain
   */
  async appendActionEvent(sessionId, event) {
    const chainPath = this.getActionChainPath(sessionId);
    const dir = path__namespace.dirname(chainPath);
    if (!fs__namespace.existsSync(dir)) {
      await fs__namespace.promises.mkdir(dir, { recursive: true });
    }
    await appendJsonl(chainPath, event);
  }
  /**
   * 读取action_chain
   */
  async readActionChain(sessionId) {
    const chainPath = this.getActionChainPath(sessionId);
    return readJsonl(chainPath);
  }
  /**
   * 创建新的事件
   */
  createActionEvent(input) {
    return {
      schema_version: "2",
      event_id: generateEventId("evt"),
      ts_ms: nowMs(),
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: input.eventType,
      status: input.status,
      duration_ms: 0,
      refs: input.refs || [],
      payload: input.payload
    };
  }
  // ========== Workflow State ==========
  /**
   * 获取workflow状态
   */
  async getWorkflowState(caseId, runId) {
    const runData = await this.readRun(caseId, runId);
    if (!runData) return null;
    const runtime = runData.runtime || {};
    return {
      caseId,
      runId,
      sessionId: runtime.session_id || "",
      currentStage: runtime.workflow_stage || "preflight_pending",
      previousStages: [],
      entryMode: runtime.entry_mode || "cli",
      backend: runtime.backend || "local",
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers: [],
      lastUpdated: nowIso()
    };
  }
  /**
   * 更新workflow状态
   */
  async updateWorkflowStage(caseId, runId, stage, blockers = []) {
    await this.updateRun(caseId, runId, {
      runtime: {
        workflow_stage: stage
      }
    });
    if (blockers.length > 0) {
      const boardPath = path__namespace.join(this.getRunPath(caseId, runId), "notes", "hypothesis_board.yaml");
      const board = readYaml(boardPath) || {};
      if (board.hypothesis_board) {
        board.hypothesis_board.blocking_issues = blockers;
        board.hypothesis_board.last_updated = nowIso();
        await writeYaml(boardPath, board);
      }
    }
  }
  // ========== Session Marker ==========
  /**
   * 获取当前session ID
   */
  async getCurrentSessionId() {
    const markerPath = path__namespace.join(
      this.workspacePath,
      "common",
      "knowledge",
      "library",
      "sessions",
      ".current_session"
    );
    if (!fs__namespace.existsSync(markerPath)) return null;
    const content = await fs__namespace.promises.readFile(markerPath, "utf-8");
    const sessionId = content.trim();
    return sessionId || null;
  }
  /**
   * 设置当前session ID
   */
  async setCurrentSessionId(sessionId) {
    const markerPath = path__namespace.join(
      this.workspacePath,
      "common",
      "knowledge",
      "library",
      "sessions",
      ".current_session"
    );
    const dir = path__namespace.dirname(markerPath);
    if (!fs__namespace.existsSync(dir)) {
      await fs__namespace.promises.mkdir(dir, { recursive: true });
    }
    await fs__namespace.promises.writeFile(markerPath, `${sessionId}
`, "utf-8");
  }
}
const storageAdapter = new StorageAdapter();
const MAIN_STAGES = [
  "preflight_pending",
  "intent_gate_passed",
  "entry_gate_passed",
  "accepted_intake_initialized",
  "intake_gate_passed",
  "waiting_for_specialist_brief",
  "specialist_briefs_collected",
  "expert_investigation_complete",
  "fix_verification_complete",
  "skeptic_ready",
  "curator_ready",
  "finalized"
];
const BACKTRACK_RULES = [
  {
    fromStage: "waiting_for_specialist_brief",
    toStage: "waiting_for_specialist_brief",
    // redispatch
    trigger: "specialist_timeout",
    maxRetries: 3,
    requiresUserConfirmation: false
  },
  {
    fromStage: "specialist_briefs_collected",
    toStage: "waiting_for_specialist_brief",
    trigger: "skeptic_rejected",
    maxRetries: 2,
    requiresUserConfirmation: true
  },
  {
    fromStage: "intake_gate_passed",
    toStage: "intent_gate_passed",
    trigger: "triage_low_confidence",
    maxRetries: 1,
    requiresUserConfirmation: true
  }
];
const STAGE_TRANSITIONS = {
  "preflight_pending": ["intent_gate_passed"],
  "intent_gate_passed": ["entry_gate_passed"],
  "entry_gate_passed": ["accepted_intake_initialized"],
  "accepted_intake_initialized": ["intake_gate_passed"],
  "intake_gate_passed": ["waiting_for_specialist_brief"],
  "waiting_for_specialist_brief": ["specialist_briefs_collected", "validation_blocked"],
  "specialist_briefs_collected": ["expert_investigation_complete", "waiting_for_specialist_brief"],
  "expert_investigation_complete": ["fix_verification_complete", "validation_blocked"],
  "fix_verification_complete": ["skeptic_ready", "validation_blocked"],
  "skeptic_ready": ["curator_ready", "fix_verification_complete"],
  "curator_ready": ["finalized"],
  "finalized": [],
  "validation_blocked": ["expert_investigation_complete", "fix_verification_complete"],
  "awaiting_user_input": ["intake_gate_passed", "waiting_for_specialist_brief"]
};
class WorkflowEngine {
  state = null;
  backtrackCounts = /* @__PURE__ */ new Map();
  mainWindow = null;
  /**
   * 设置主窗口引用
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }
  /**
   * 获取当前状态
   */
  getState() {
    return this.state;
  }
  /**
   * 加载状态（从存储）
   */
  async loadState(caseId, runId) {
    this.state = await storageAdapter.getWorkflowState(caseId, runId);
    return this.state;
  }
  /**
   * 初始化新工作流
   */
  async initialize(input) {
    this.state = {
      caseId: input.caseId,
      runId: input.runId,
      sessionId: input.sessionId,
      currentStage: "accepted_intake_initialized",
      previousStages: [],
      entryMode: "cli",
      backend: "local",
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers: [],
      lastUpdated: nowIso()
    };
    await this.recordStageTransition("preflight_pending", "accepted_intake_initialized");
    return this.state;
  }
  /**
   * 推进到下一阶段
   */
  async advanceStage() {
    if (!this.state) {
      return this.createErrorResult("NO_ACTIVE_WORKFLOW", "No active workflow state");
    }
    const currentStage = this.state.currentStage;
    const allowedTransitions = STAGE_TRANSITIONS[currentStage];
    if (!allowedTransitions || allowedTransitions.length === 0) {
      return this.createErrorResult("NO_VALID_TRANSITION", `No valid transition from ${currentStage}`);
    }
    const nextStage = allowedTransitions[0];
    const result = await this.transitionTo(nextStage);
    return result;
  }
  /**
   * 转换到指定阶段
   */
  async transitionTo(targetStage) {
    if (!this.state) {
      return this.createErrorResult("NO_ACTIVE_WORKFLOW", "No active workflow state");
    }
    const currentStage = this.state.currentStage;
    const allowedTransitions = STAGE_TRANSITIONS[currentStage];
    if (!allowedTransitions.includes(targetStage)) {
      return this.createErrorResult(
        "INVALID_TRANSITION",
        `Cannot transition from ${currentStage} to ${targetStage}`
      );
    }
    await this.recordStageTransition(currentStage, targetStage);
    const previousStage = this.state.currentStage;
    this.state.previousStages.push(previousStage);
    this.state.currentStage = targetStage;
    this.state.lastUpdated = nowIso();
    await storageAdapter.updateWorkflowStage(
      this.state.caseId,
      this.state.runId,
      targetStage,
      this.state.blockers
    );
    this.notifyStateChanged();
    return {
      stage: targetStage,
      status: "passed",
      blockers: [],
      refs: [],
      paths: {}
    };
  }
  /**
   * 执行回转
   */
  async backtrack(context) {
    if (!this.state) {
      return this.createErrorResult("NO_ACTIVE_WORKFLOW", "No active workflow state");
    }
    const rule = BACKTRACK_RULES.find(
      (r) => r.fromStage === this.state.currentStage && r.trigger === context.trigger
    );
    if (!rule) {
      return this.createErrorResult(
        "NO_BACKTRACK_RULE",
        `No backtrack rule for trigger ${context.trigger} from ${this.state.currentStage}`
      );
    }
    const ruleKey = `${rule.fromStage}-${rule.trigger}`;
    const currentCount = this.backtrackCounts.get(ruleKey) || 0;
    if (currentCount >= rule.maxRetries) {
      return this.createErrorResult(
        "MAX_RETRIES_EXCEEDED",
        `Max retries (${rule.maxRetries}) exceeded for ${rule.trigger}`
      );
    }
    if (rule.requiresUserConfirmation) ;
    const event = storageAdapter.createActionEvent({
      runId: this.state.runId,
      sessionId: this.state.sessionId,
      agentId: "rdc-debugger",
      eventType: "workflow_stage_transition",
      status: "ok",
      payload: {
        from_stage: this.state.currentStage,
        to_stage: rule.toStage,
        reason: "controlled_backtrack",
        trigger: context.trigger,
        context: context.details
      }
    });
    await storageAdapter.appendActionEvent(this.state.sessionId, event);
    this.backtrackCounts.set(ruleKey, currentCount + 1);
    return this.transitionTo(rule.toStage);
  }
  /**
   * 进入阻断状态
   */
  async enterBlockedState(blocker) {
    if (!this.state) return;
    this.state.blockers.push(blocker);
    const hasCriticalBlocker = this.state.blockers.some((b) => b.code.startsWith("BLOCKED_"));
    if (hasCriticalBlocker && this.state.currentStage !== "validation_blocked") {
      await this.transitionTo("validation_blocked");
    }
  }
  /**
   * 清除阻断
   */
  async clearBlocker(blockerCode) {
    if (!this.state) return;
    this.state.blockers = this.state.blockers.filter((b) => b.code !== blockerCode);
    await storageAdapter.updateWorkflowStage(
      this.state.caseId,
      this.state.runId,
      this.state.currentStage,
      this.state.blockers
    );
  }
  /**
   * 检查是否可以进入下一阶段
   */
  canAdvance() {
    if (!this.state) {
      return { canAdvance: false, reason: "No active workflow" };
    }
    if (this.state.blockers.length > 0) {
      return { canAdvance: false, reason: "Has unresolved blockers" };
    }
    if (this.state.currentStage === "validation_blocked") {
      return { canAdvance: false, reason: "In blocked state" };
    }
    if (this.state.currentStage === "finalized") {
      return { canAdvance: false, reason: "Already finalized" };
    }
    return { canAdvance: true };
  }
  /**
   * 获取阶段索引
   */
  getStageIndex(stage) {
    return MAIN_STAGES.indexOf(stage);
  }
  /**
   * 是否在主流程中
   */
  isInMainFlow() {
    if (!this.state) return false;
    return MAIN_STAGES.includes(this.state.currentStage);
  }
  // ========== 私有方法 ==========
  async recordStageTransition(fromStage, toStage) {
    if (!this.state) return;
    const event = storageAdapter.createActionEvent({
      runId: this.state.runId,
      sessionId: this.state.sessionId,
      agentId: "rdc-debugger",
      eventType: "workflow_stage_transition",
      status: "ok",
      payload: {
        from_stage: fromStage,
        to_stage: toStage,
        timestamp: nowIso()
      }
    });
    await storageAdapter.appendActionEvent(this.state.sessionId, event);
  }
  createErrorResult(code, reason) {
    return {
      stage: this.state?.currentStage || "unknown",
      status: "blocked",
      blockers: [{ code, reason, refs: [], detectedAt: nowIso() }],
      refs: [],
      paths: {}
    };
  }
  notifyStateChanged() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("workflow:stateChanged", this.state);
      if (this.state) {
        this.mainWindow.webContents.send("workflow:stageChanged", {
          stage: this.state.currentStage,
          blockers: this.state.blockers
        });
      }
    }
  }
}
const workflowEngine = new WorkflowEngine();
class HarnessController {
  _enabled = true;
  /**
   * 检查控制器是否启用
   */
  isEnabled() {
    return this._enabled;
  }
  /**
   * 启用/禁用控制器
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }
  // ========== 前置Gate层 ==========
  /**
   * EntryGate - 入口闸门
   * 检查：.rdc文件存在性、平台模式、环境配置
   */
  async executeEntryGate(input) {
    const blockers = [];
    if (!input.capturePaths || input.capturePaths.length === 0) {
      blockers.push(this.createBlocker("BLOCKED_MISSING_CAPTURE", "No .rdc capture files provided"));
    }
    for (const capturePath of input.capturePaths || []) {
      const fs2 = await import("fs");
      if (!fs2.existsSync(capturePath)) {
        blockers.push(this.createBlocker(
          "BLOCKED_CAPTURE_IMPORT_FAILED",
          `Capture file not found: ${capturePath}`,
          [capturePath]
        ));
      }
    }
    if (input.backend === "remote") ;
    return this.createGateResult("entry_gate", blockers);
  }
  /**
   * IntakeGate - Intake闸门
   * 检查：数据完整性、参照契约
   */
  async executeIntakeGate(caseId, runId, input) {
    const blockers = [];
    const requiredFields = ["session", "symptom", "captures"];
    for (const field of requiredFields) {
      if (!input.caseInput[field]) {
        blockers.push(this.createBlocker(
          "BLOCKED_INTAKE_GATE_REQUIRED",
          `Missing required field in case_input: ${field}`
        ));
      }
    }
    if (!input.captureRefs || input.captureRefs.length === 0) {
      blockers.push(this.createBlocker(
        "BLOCKED_INTAKE_GATE_REQUIRED",
        "No capture references defined"
      ));
    }
    const referenceContract = input.caseInput.reference_contract;
    if (!referenceContract || !referenceContract.source_refs) {
      blockers.push(this.createBlocker(
        "BLOCKED_MISSING_FIX_REFERENCE",
        "Missing fix_reference for verification. Provide description + comparison/baseline .rdc"
      ));
    }
    await storageAdapter.writeArtifact(caseId, runId, "intake_gate.yaml", {
      schema_version: "2",
      generated_at: nowIso(),
      status: blockers.length === 0 ? "passed" : "blocked",
      checks: requiredFields.map((f) => ({
        id: `check_${f}`,
        result: input.caseInput[f] ? "pass" : "fail"
      })),
      blocking_codes: blockers.map((b) => b.code)
    });
    return this.createGateResult("intake_gate", blockers);
  }
  /**
   * DispatchGate - 分派闸门
   * 检查：模式一致性、执行证据
   */
  async executeDispatchGate(_caseId, _runId, input) {
    const blockers = [];
    if (input.orchestrationMode === "multi_agent") {
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (sessionId) {
        const events = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events.filter((e) => e.event_type === "dispatch");
        if (dispatchEvents.length === 0) ;
        else {
          const pendingDispatch = dispatchEvents.find((e) => e.status === "sent");
          if (pendingDispatch) {
            blockers.push(this.createBlocker(
              "BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT",
              "Previous dispatch still pending feedback",
              [pendingDispatch.event_id]
            ));
          }
        }
      }
    }
    const validAgents = [
      "triage_agent",
      "capture_repro_agent",
      "pass_graph_pipeline_agent",
      "pixel_forensics_agent",
      "shader_ir_agent",
      "driver_device_agent",
      "skeptic_agent",
      "curator_agent"
    ];
    if (!validAgents.includes(input.targetAgent)) {
      blockers.push(this.createBlocker(
        "BLOCKED_UNKNOWN_SPECIALIST",
        `Unknown specialist: ${input.targetAgent}`,
        [input.targetAgent]
      ));
    }
    return this.createGateResult("dispatch_gate", blockers);
  }
  /**
   * VerifyGate - 验证闸门
   * 检查：fix_verification schema完整性
   */
  async executeVerifyGate(_caseId, _runId, input) {
    const blockers = [];
    const requiredFields = [
      "verdict",
      "verification_mode",
      "verification_confidence",
      "structural_verification",
      "semantic_verification",
      "overall_result"
    ];
    for (const field of requiredFields) {
      if (input.fixVerificationData[field] === void 0) {
        blockers.push(this.createBlocker(
          "BLOCKED_FIX_VERIFICATION_FAILED",
          `Missing required field in fix_verification: ${field}`
        ));
      }
    }
    const structural = input.fixVerificationData.structural_verification;
    if (structural && structural.status !== "passed") {
      blockers.push(this.createBlocker(
        "BLOCKED_FIX_VERIFICATION_FAILED",
        "Structural verification failed"
      ));
    }
    const semantic = input.fixVerificationData.semantic_verification;
    if (semantic && semantic.status === "fallback_only") {
      console.warn("Semantic verification is fallback_only");
    }
    return this.createGateResult("verify_gate", blockers);
  }
  // ========== 运行时监控层 ==========
  /**
   * 模式一致性检查
   * 验证声明的multi_agent是否有dispatch证据
   */
  async checkModeConsistency(caseId, runId) {
    const issues = [];
    const topology = await storageAdapter.readArtifact(caseId, runId, "runtime_topology.yaml");
    if (!topology) {
      issues.push("runtime_topology.yaml not found");
      return { isConsistent: false, issues };
    }
    const orchestrationMode = topology.orchestration_mode;
    if (orchestrationMode === "multi_agent") {
      const sessionId = await storageAdapter.getCurrentSessionId();
      if (sessionId) {
        const events = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events.filter((e) => e.event_type === "dispatch");
        if (dispatchEvents.length === 0) {
          issues.push("multi_agent declared but no dispatch events found");
        }
      }
    }
    return { isConsistent: issues.length === 0, issues };
  }
  /**
   * Stage推进校验
   * 验证workflow_stage是否与action_chain一致
   */
  async validateStageConsistency(caseId, runId) {
    const runData = await storageAdapter.readRun(caseId, runId);
    if (!runData) {
      return { isConsistent: false, currentStage: null, expectedStage: null };
    }
    const runtime = runData.runtime;
    const declaredStage = runtime?.workflow_stage;
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { isConsistent: true, currentStage: declaredStage, expectedStage: declaredStage };
    }
    const events = await storageAdapter.readActionChain(sessionId);
    const stageEvents = events.filter((e) => e.event_type === "workflow_stage_transition");
    if (stageEvents.length === 0) {
      return { isConsistent: true, currentStage: declaredStage, expectedStage: declaredStage };
    }
    const lastStageEvent = stageEvents[stageEvents.length - 1];
    const expectedStage = lastStageEvent.payload?.to_stage;
    return {
      isConsistent: declaredStage === expectedStage,
      currentStage: declaredStage,
      expectedStage
    };
  }
  /**
   * 工具执行包装器
   * 所有live rd.*调用必须经过此包装器，自动写入action_chain
   */
  async wrapToolExecution(input) {
    const startTime = nowMs();
    const result = await input.execute();
    const duration = nowMs() - startTime;
    const event = {
      schema_version: "2",
      event_id: `evt-tool-${nowMs()}`,
      ts_ms: startTime,
      run_id: input.runId,
      session_id: input.sessionId,
      agent_id: input.agentId,
      event_type: "tool_execution",
      status: result.ok ? "ok" : "error",
      duration_ms: duration,
      refs: [],
      payload: {
        tool_name: input.toolName,
        args: input.args,
        result: result.ok ? "success" : "failed",
        error: result.error
      }
    };
    await storageAdapter.appendActionEvent(input.sessionId, event);
    return result;
  }
  /**
   * 早期Blocker检测
   * 实时检测blocking_issues，而非等到final audit
   */
  async detectEarlyBlockers(caseId, runId) {
    const blockers = [];
    const runPath = storageAdapter.getRunPath(caseId, runId);
    const fs2 = await import("fs");
    const boardPath = `${runPath}/notes/hypothesis_board.yaml`;
    if (fs2.existsSync(boardPath)) {
      const yaml2 = await import("yaml");
      const content = await fs2.promises.readFile(boardPath, "utf-8");
      const board = yaml2.parse(content);
      if (board?.hypothesis_board?.blocking_issues) {
        for (const issue of board.hypothesis_board.blocking_issues) {
          blockers.push(this.createBlocker(
            issue.code || "BLOCKER_DETECTED",
            issue.reason || "Blocking issue detected",
            issue.refs || []
          ));
        }
      }
    }
    const freezePath = `${runPath}/artifacts/freeze_state.yaml`;
    if (fs2.existsSync(freezePath)) {
      const yaml2 = await import("yaml");
      const content = await fs2.promises.readFile(freezePath, "utf-8");
      const freeze = yaml2.parse(content);
      if (freeze?.status === "frozen") {
        blockers.push(this.createBlocker(
          "BLOCKED_FREEZE_STATE_ACTIVE",
          "Run is frozen due to process deviation",
          freeze.blocking_codes || []
        ));
      }
    }
    if (blockers.length > 0) {
      const state = workflowEngine.getState();
      if (state && state.currentStage !== "validation_blocked") {
        for (const blocker of blockers) {
          await workflowEngine.enterBlockedState(blocker);
        }
      }
    }
    return { hasBlockers: blockers.length > 0, blockers };
  }
  // ========== 辅助方法 ==========
  createBlocker(code, reason, refs = []) {
    return {
      code,
      reason,
      refs,
      detectedAt: nowIso()
    };
  }
  createGateResult(stage, blockers) {
    return {
      stage,
      status: blockers.length === 0 ? "passed" : "blocked",
      blockers,
      refs: [],
      paths: {}
    };
  }
}
const harnessController = new HarnessController();
const DEFAULT_MODEL_ROUTING = {
  "rdc-debugger": { provider: "openrouter", model: "anthropic/claude-3-opus" },
  "triage_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "capture_repro_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "pass_graph_pipeline_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "pixel_forensics_agent": { provider: "openrouter", model: "google/gemini-pro-1.5" },
  "shader_ir_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "driver_device_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
  "skeptic_agent": { provider: "openrouter", model: "openai/gpt-4o" },
  "curator_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" }
};
const AGENT_DISPLAY_NAMES = {
  "rdc-debugger": "RDC Debugger",
  "triage_agent": "Triage Agent",
  "capture_repro_agent": "Capture Repro Agent",
  "pass_graph_pipeline_agent": "Pass Graph Agent",
  "pixel_forensics_agent": "Pixel Forensics Agent",
  "shader_ir_agent": "Shader IR Agent",
  "driver_device_agent": "Driver Device Agent",
  "skeptic_agent": "Skeptic Agent",
  "curator_agent": "Curator Agent"
};
const AGENT_DESCRIPTIONS = {
  "rdc-debugger": "Main orchestrator responsible for workflow coordination, gates, and stage progression",
  "triage_agent": "Symptom classification and SOP recommendation",
  "capture_repro_agent": "Capture quality verification and baseline establishment",
  "pass_graph_pipeline_agent": "Render pass and pipeline dependency analysis",
  "pixel_forensics_agent": "Pixel-level evidence collection and first-bad event localization",
  "shader_ir_agent": "Shader source and IR evidence analysis",
  "driver_device_agent": "Cross-device attribution and platform-specific checks",
  "skeptic_agent": "Evidence chain challenger and weak claim detector",
  "curator_agent": "Final report generation and knowledge library curation"
};
const INVESTIGATOR_AGENTS = [
  "triage_agent",
  "capture_repro_agent",
  "pass_graph_pipeline_agent",
  "pixel_forensics_agent",
  "shader_ir_agent",
  "driver_device_agent"
];
const VERIFIER_AGENTS = ["skeptic_agent"];
const REPORTER_AGENTS = ["curator_agent"];
class OpenRouterProvider {
  name = "openrouter";
  apiKey = "";
  baseUrl = "https://openrouter.ai/api/v1";
  configure(config) {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }
  async chat(request) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      body: JSON.stringify({
        model: request.model || "anthropic/claude-3-opus",
        messages: this.normalizeMessages(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: request.tools,
        stream: false
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }
    const data = await response.json();
    return this.normalizeResponse(data, request.model || "anthropic/claude-3-opus");
  }
  async streamChat(request, onChunk) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      body: JSON.stringify({
        model: request.model || "anthropic/claude-3-opus",
        messages: this.normalizeMessages(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        stream: true
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((line) => line.startsWith("data:"));
      for (const line of lines) {
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || "";
          if (content) {
            fullContent += content;
            onChunk(content);
          }
        } catch {
        }
      }
    }
    return {
      id: `or-${Date.now()}`,
      model: request.model || "anthropic/claude-3-opus",
      content: fullContent,
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: "end_turn"
    };
  }
  async isAvailable() {
    return !!this.apiKey;
  }
  getModels() {
    return [
      "anthropic/claude-3-opus",
      "anthropic/claude-3-sonnet",
      "anthropic/claude-3-haiku",
      "openai/gpt-4o",
      "openai/gpt-4-turbo",
      "openai/gpt-3.5-turbo",
      "google/gemini-pro-1.5",
      "google/gemini-flash-1.5",
      "x-ai/grok-beta",
      "moonshot/kimi-latest",
      "meta-llama/llama-3-70b-instruct"
    ];
  }
  normalizeMessages(messages) {
    return messages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }
      const content = msg.content.map((block) => {
        if (block.type === "text") {
          return { type: "text", text: block.text };
        }
        if (block.type === "image" && block.source) {
          return {
            type: "image_url",
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`
            }
          };
        }
        return { type: "text", text: "" };
      });
      return { role: msg.role, content };
    });
  }
  normalizeResponse(data, model) {
    const choice = data.choices?.[0];
    return {
      id: data.id || `or-${Date.now()}`,
      model: data.model || model,
      content: choice?.message?.content || "",
      toolCalls: choice?.message?.tool_calls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn"
    };
  }
}
class OpenAIProvider {
  name = "openai";
  apiKey = "";
  baseUrl = "https://api.openai.com/v1";
  configure(config) {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }
  async chat(request) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model || "gpt-4o",
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7
      })
    });
    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      id: data.id,
      model: data.model,
      content: choice?.message?.content || "",
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: choice?.finish_reason === "stop" ? "end_turn" : "max_tokens"
    };
  }
  async streamChat(request, onChunk) {
    const result = await this.chat(request);
    onChunk(result.content);
    return result;
  }
  async isAvailable() {
    return !!this.apiKey;
  }
  getModels() {
    return ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
  }
}
class AnthropicProvider {
  name = "anthropic";
  apiKey = "";
  baseUrl = "https://api.anthropic.com/v1";
  configure(config) {
    this.apiKey = config.apiKey;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
  }
  async chat(request) {
    const systemMessage = request.messages.find((m) => m.role === "system");
    const otherMessages = request.messages.filter((m) => m.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model || "claude-3-opus-20240229",
        max_tokens: request.maxTokens || 4096,
        system: systemMessage?.content,
        messages: otherMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content
        }))
      })
    });
    const data = await response.json();
    return {
      id: data.id,
      model: data.model,
      content: data.content?.[0]?.text || "",
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0
      },
      stopReason: data.stop_reason === "end_turn" ? "end_turn" : "max_tokens"
    };
  }
  async streamChat(request, onChunk) {
    const result = await this.chat(request);
    onChunk(result.content);
    return result;
  }
  async isAvailable() {
    return !!this.apiKey;
  }
  getModels() {
    return ["claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"];
  }
}
class LLMAdapter {
  providers = /* @__PURE__ */ new Map();
  defaultProvider = "openrouter";
  constructor() {
    this.providers.set("openrouter", new OpenRouterProvider());
    this.providers.set("openai", new OpenAIProvider());
    this.providers.set("anthropic", new AnthropicProvider());
  }
  /**
   * 配置LLM
   */
  configure(config) {
    this.defaultProvider = config.defaultProvider || "openrouter";
    if (config.openrouter) {
      this.providers.get("openrouter")?.configure(config.openrouter);
    }
    if (config.openai) {
      this.providers.get("openai")?.configure(config.openai);
    }
    if (config.anthropic) {
      this.providers.get("anthropic")?.configure(config.anthropic);
    }
  }
  /**
   * 发送聊天请求
   */
  async chat(request, provider) {
    const providerName = provider || this.defaultProvider;
    const p = this.providers.get(providerName);
    if (!p) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    if (!await p.isAvailable()) {
      throw new Error(`Provider not configured: ${providerName}`);
    }
    return p.chat(request);
  }
  /**
   * 流式聊天
   */
  async streamChat(request, onChunk, provider) {
    const providerName = provider || this.defaultProvider;
    const p = this.providers.get(providerName);
    if (!p) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    return p.streamChat(request, onChunk);
  }
  /**
   * 测试连接
   */
  async testConnection(provider) {
    const p = this.providers.get(provider);
    if (!p) {
      return { success: false, error: `Provider not found: ${provider}` };
    }
    try {
      const available = await p.isAvailable();
      return { success: available, error: available ? void 0 : "Provider not configured" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  /**
   * 获取可用模型列表
   */
  getAvailableModels(provider) {
    const p = this.providers.get(provider);
    return p?.getModels() || [];
  }
  /**
   * 获取默认provider
   */
  getDefaultProvider() {
    return this.defaultProvider;
  }
}
const llmAdapter = new LLMAdapter();
class AgentOrchestrator {
  agentStates = /* @__PURE__ */ new Map();
  agentConfigs = /* @__PURE__ */ new Map();
  mainWindow = null;
  constructor() {
    this.initializeAgents();
  }
  /**
   * 设置主窗口引用
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }
  /**
   * 初始化所有Agent
   */
  initializeAgents() {
    const allRoles = [
      "rdc-debugger",
      "triage_agent",
      "capture_repro_agent",
      "pass_graph_pipeline_agent",
      "pixel_forensics_agent",
      "shader_ir_agent",
      "driver_device_agent",
      "skeptic_agent",
      "curator_agent"
    ];
    for (const role of allRoles) {
      this.agentStates.set(role, {
        agentId: role,
        status: "idle",
        lastActivity: nowIso()
      });
      const defaultRouting = DEFAULT_MODEL_ROUTING[role];
      this.agentConfigs.set(role, {
        agentId: role,
        systemPrompt: "",
        modelProvider: defaultRouting.provider,
        modelName: defaultRouting.model,
        temperature: 0.7,
        maxTokens: 4096,
        category: this.getAgentCategory(role),
        writeScope: this.getAgentWriteScopes(role)
      });
    }
  }
  /**
   * 获取Agent类别
   */
  getAgentCategory(role) {
    if (role === "rdc-debugger") return "orchestrator";
    if (INVESTIGATOR_AGENTS.includes(role)) return "investigator";
    if (VERIFIER_AGENTS.includes(role)) return "verifier";
    if (REPORTER_AGENTS.includes(role)) return "reporter";
    return "investigator";
  }
  /**
   * 获取Agent写入范围
   */
  getAgentWriteScopes(role) {
    if (role === "rdc-debugger") return ["workspace_control"];
    if (INVESTIGATOR_AGENTS.includes(role)) return ["workspace_notes"];
    if (role === "skeptic_agent") return ["session_signoff"];
    if (role === "curator_agent") return ["workspace_reports", "session_artifacts", "knowledge_library"];
    return [];
  }
  /**
   * 获取Agent状态
   */
  getAgentState(agentId) {
    return this.agentStates.get(agentId) || null;
  }
  /**
   * 获取所有Agent状态
   */
  getAllAgentStates() {
    return Array.from(this.agentStates.values());
  }
  /**
   * 配置Agent
   */
  configureAgent(agentId, config) {
    const existing = this.agentConfigs.get(agentId);
    if (existing) {
      this.agentConfigs.set(agentId, { ...existing, ...config });
    }
  }
  /**
   * 获取Agent配置
   */
  getAgentConfig(agentId) {
    return this.agentConfigs.get(agentId) || null;
  }
  /**
   * 加载Agent System Prompt
   */
  async loadAgentPrompt(agentId) {
    const promptPath = this.getPromptPath(agentId);
    if (promptPath && fs__namespace.existsSync(promptPath)) {
      return fs__namespace.readFileSync(promptPath, "utf-8");
    }
    return this.getDefaultPrompt(agentId);
  }
  /**
   * 获取Prompt文件路径
   */
  getPromptPath(agentId) {
    const promptFiles = {
      "rdc-debugger": "common/skills/rdc-debugger/SKILL.md",
      "triage_agent": "common/agents/02_triage_taxonomy.md",
      "capture_repro_agent": "common/agents/03_capture_repro.md",
      "pass_graph_pipeline_agent": "common/agents/04_pass_graph_pipeline.md",
      "pixel_forensics_agent": "common/agents/05_pixel_value_forensics.md",
      "shader_ir_agent": "common/agents/06_shader_ir.md",
      "driver_device_agent": "common/agents/07_driver_device.md",
      "skeptic_agent": "common/agents/08_skeptic.md",
      "curator_agent": "common/agents/09_report_knowledge_curator.md"
    };
    const filename = promptFiles[agentId];
    if (!filename) return null;
    const workspacePath = path__namespace.join(storageAdapter.getWorkspacePath(), "..", filename);
    if (fs__namespace.existsSync(workspacePath)) {
      return workspacePath;
    }
    return null;
  }
  /**
   * 获取默认Prompt
   */
  getDefaultPrompt(agentId) {
    const descriptions = {
      "rdc-debugger": `You are the RDC Debugger Orchestrator. Your role is to coordinate the debugging workflow, manage gates, and orchestrate specialist agents. You are the main entry point for all debugging tasks.`,
      "triage_agent": `You are the Triage Agent. Your role is to classify symptoms, match historical BugCards, and recommend SOPs for investigation.`,
      "capture_repro_agent": `You are the Capture Repro Agent. Your role is to verify capture quality, establish baselines, and create capture anchors.`,
      "pass_graph_pipeline_agent": `You are the Pass Graph Pipeline Agent. Your role is to analyze render passes and pipeline dependencies.`,
      "pixel_forensics_agent": `You are the Pixel Forensics Agent. Your role is to perform pixel-level evidence collection and locate first-bad events.`,
      "shader_ir_agent": `You are the Shader IR Agent. Your role is to analyze shader source code and IR evidence.`,
      "driver_device_agent": `You are the Driver Device Agent. Your role is to perform cross-device attribution and platform-specific checks.`,
      "skeptic_agent": `You are the Skeptic Agent. Your role is to challenge evidence chains and detect weak claims. You must verify all conclusions before signoff.`,
      "curator_agent": `You are the Curator Agent. Your role is to generate final reports and maintain the knowledge library.`
    };
    return descriptions[agentId] || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}`;
  }
  /**
   * 发送消息给Agent
   */
  async sendMessage(agentId, content, context) {
    const config = this.agentConfigs.get(agentId);
    if (!config) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    this.updateAgentStatus(agentId, "thinking");
    try {
      const systemPrompt = await this.loadAgentPrompt(agentId);
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content }
      ];
      const response = await llmAdapter.chat(
        {
          messages,
          model: config.modelName,
          maxTokens: config.maxTokens,
          temperature: config.temperature
        },
        config.modelProvider
      );
      await this.recordMessage(agentId, "user", content, context);
      const responseContent = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      await this.recordMessage(agentId, "assistant", responseContent, context);
      this.updateAgentStatus(agentId, "complete");
      return responseContent;
    } catch (error) {
      this.updateAgentStatus(agentId, "error");
      throw error;
    }
  }
  /**
   * 分派Specialist
   */
  async dispatchSpecialist(agentId, objective, context) {
    if (!INVESTIGATOR_AGENTS.includes(agentId) && !VERIFIER_AGENTS.includes(agentId)) {
      return { success: false, error: `Cannot dispatch non-specialist agent: ${agentId}` };
    }
    const gateResult = await harnessController.executeDispatchGate(
      context.caseId,
      context.runId,
      {
        targetAgent: agentId,
        objective,
        orchestrationMode: "multi_agent"
      }
    );
    if (gateResult.status === "blocked") {
      return {
        success: false,
        error: gateResult.blockers.map((b) => b.reason).join("; ")
      };
    }
    const tokenId = generateEventId("tok");
    const event = storageAdapter.createActionEvent({
      runId: context.runId,
      sessionId: context.sessionId,
      agentId: "rdc-debugger",
      eventType: "dispatch",
      status: "sent",
      payload: {
        target_agent: agentId,
        objective,
        capability_token_id: tokenId,
        dispatch_time: nowIso()
      }
    });
    await storageAdapter.appendActionEvent(context.sessionId, event);
    this.updateAgentStatus(agentId, "waiting");
    try {
      const response = await this.sendMessage(agentId, objective, context);
      const completeEvent = storageAdapter.createActionEvent({
        runId: context.runId,
        sessionId: context.sessionId,
        agentId,
        eventType: "artifact_write",
        status: "ok",
        payload: {
          brief: response.substring(0, 500),
          completed_at: nowIso()
        }
      });
      await storageAdapter.appendActionEvent(context.sessionId, completeEvent);
      this.updateAgentStatus(agentId, "complete");
      return { success: true, tokenId };
    } catch (error) {
      this.updateAgentStatus(agentId, "error");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  /**
   * 更新Agent状态
   */
  updateAgentStatus(agentId, status) {
    const state = this.agentStates.get(agentId);
    if (state) {
      state.status = status;
      state.lastActivity = nowIso();
      this.notifyAgentStateChanged(state);
    }
  }
  /**
   * 记录消息
   */
  async recordMessage(agentId, role, content, context) {
    if (!context?.sessionId) return;
    const message = {
      id: generateEventId("msg"),
      agentId,
      role,
      content,
      timestamp: nowMs()
    };
    this.notifyMessage(message);
  }
  /**
   * 通知Agent状态变化
   */
  notifyAgentStateChanged(state) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("agent:statusChanged", state);
    }
  }
  /**
   * 通知消息
   */
  notifyMessage(message) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("agent:message", message);
    }
  }
}
const agentOrchestrator = new AgentOrchestrator();
function registerIPCHandlers() {
  storageAdapter.initializeWorkspace().catch(console.error);
  electron.ipcMain.handle("dialog:selectRdcFiles", async () => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "RenderDoc Capture", extensions: ["rdc"] }],
      properties: ["openFile", "multiSelections"]
    });
    return result.canceled ? null : result.filePaths;
  });
  electron.ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("window:minimize", async (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  electron.ipcMain.handle("window:toggleMaximize", async (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }
    window.maximize();
    return true;
  });
  electron.ipcMain.handle("window:close", async (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.close();
  });
  electron.ipcMain.handle("window:isMaximized", async (event) => {
    return electron.BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  electron.ipcMain.handle("app:getMeta", async () => {
    return {
      version: electron.app.getVersion(),
      productName: electron.app.getName()
    };
  });
  electron.ipcMain.handle("workflow:getState", async () => {
    return workflowEngine.getState();
  });
  electron.ipcMain.handle("workflow:start", async (_event, capturePaths, userGoal) => {
    try {
      const gateResult = await harnessController.executeEntryGate({
        capturePaths,
        platform: "rdc-agent",
        entryMode: "cli",
        backend: "local"
      });
      if (gateResult.status === "blocked") {
        return {
          success: false,
          error: gateResult.blockers.map((b) => b.reason).join("; ")
        };
      }
      const caseId = await storageAdapter.createCase({
        userGoal,
        symptomSummary: userGoal
      });
      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        capturePaths
      });
      await workflowEngine.initialize({ caseId, runId, sessionId });
      const caseInput = {
        session: { mode: "single", goal: userGoal },
        symptom: { summary: userGoal },
        captures: capturePaths.map((_p, i) => ({
          capture_id: `cap-${i === 0 ? "anomalous" : "baseline"}-${i}`,
          capture_role: i === 0 ? "anomalous" : "baseline"
        }))
      };
      const intakeResult = await harnessController.executeIntakeGate(caseId, runId, {
        caseInput,
        captureRefs: caseInput.captures
      });
      if (intakeResult.status === "blocked") {
        return {
          success: false,
          error: intakeResult.blockers.map((b) => b.reason).join("; ")
        };
      }
      return { success: true, caseId, runId, sessionId };
    } catch (error) {
      console.error("Failed to start workflow:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("workflow:advanceStage", async () => {
    const result = await workflowEngine.advanceStage();
    return {
      success: result.status === "passed",
      currentStage: workflowEngine.getState()?.currentStage,
      error: result.status === "blocked" ? result.blockers.map((b) => b.reason).join("; ") : void 0
    };
  });
  electron.ipcMain.handle("workflow:backtrack", async (_event, reason, trigger) => {
    const result = await workflowEngine.backtrack({
      reason,
      trigger
    });
    return {
      success: result.status === "passed",
      error: result.status === "blocked" ? result.blockers.map((b) => b.reason).join("; ") : void 0
    };
  });
  electron.ipcMain.handle("workflow:dispatchSpecialist", async (_event, agentId, objective) => {
    const state = workflowEngine.getState();
    if (!state) {
      return { success: false, error: "No active workflow" };
    }
    return agentOrchestrator.dispatchSpecialist(agentId, objective, {
      caseId: state.caseId,
      runId: state.runId,
      sessionId: state.sessionId
    });
  });
  electron.ipcMain.handle("agent:sendMessage", async (_event, agentId, content) => {
    try {
      const state = workflowEngine.getState();
      const response = await agentOrchestrator.sendMessage(agentId, content, state ? {
        caseId: state.caseId,
        runId: state.runId,
        sessionId: state.sessionId
      } : void 0);
      return { response };
    } catch (error) {
      return {
        response: void 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("agent:getState", async (_event, agentId) => {
    return agentOrchestrator.getAgentState(agentId);
  });
  electron.ipcMain.handle("agent:getAllStates", async () => {
    return agentOrchestrator.getAllAgentStates();
  });
  electron.ipcMain.handle("agent:configure", async (_event, agentId, config) => {
    try {
      agentOrchestrator.configureAgent(agentId, config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("tool:getCatalog", async () => {
    try {
      return await toolBridge.loadCatalog();
    } catch {
      return { tools: [], namespaces: {} };
    }
  });
  electron.ipcMain.handle("tool:execute", async (_event, toolName, args) => {
    return toolBridge.call({
      toolName,
      args
    });
  });
  electron.ipcMain.handle("evidence:getChain", async () => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) {
      return { sessionId: "", runId: "", events: [], isValid: true };
    }
    const events = await storageAdapter.readActionChain(sessionId);
    return {
      sessionId,
      runId: workflowEngine.getState()?.runId || "",
      events,
      isValid: true
    };
  });
  electron.ipcMain.handle("evidence:getEvents", async (_event, eventType) => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) return [];
    const events = await storageAdapter.readActionChain(sessionId);
    if (eventType) {
      return events.filter((e) => e.event_type === eventType);
    }
    return events;
  });
  electron.ipcMain.handle("llm:configure", async (_event, config) => {
    llmAdapter.configure(config);
    return;
  });
  electron.ipcMain.handle("llm:testConnection", async (_event, provider) => {
    return llmAdapter.testConnection(provider);
  });
  electron.ipcMain.handle("llm:getAvailableModels", async (_event, provider) => {
    return llmAdapter.getAvailableModels(provider);
  });
  electron.ipcMain.handle("settings:get", async () => {
    return {
      theme: "dark",
      llm: {
        defaultProvider: llmAdapter.getDefaultProvider()
      },
      agents: {}
    };
  });
  electron.ipcMain.handle("settings:set", async (_event, settings) => {
    console.log("Set settings:", settings);
    return;
  });
}
function setMainWindow(window) {
  workflowEngine.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
}
const __dirname$1 = path__namespace.dirname(url.fileURLToPath(require("url").pathToFileURL(__filename).href));
const isDev = process.env.NODE_ENV === "development" || !electron.app.isPackaged;
let mainWindow = null;
function emitWindowMaximizedState() {
  if (!mainWindow) return;
  mainWindow.webContents.send("window:maximized-changed", mainWindow.isMaximized());
}
async function openRdcFiles() {
  const result = await electron.dialog.showOpenDialog({
    filters: [
      { name: "RenderDoc Capture", extensions: ["rdc"] }
    ],
    properties: ["openFile", "multiSelections"]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    mainWindow?.webContents.send("file:open", result.filePaths);
  }
}
function setupKeyboardShortcuts(window) {
  window.webContents.on("before-input-event", async (event, input) => {
    const commandOrControl = input.control || input.meta;
    if (!commandOrControl || input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (key === "o") {
      event.preventDefault();
      await openRdcFiles();
      return;
    }
    if (key === "n") {
      event.preventDefault();
      window.webContents.send("case:new");
      return;
    }
    if (key === ",") {
      event.preventDefault();
      window.webContents.send("settings:open");
    }
  });
}
function createMainWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1e3,
    minHeight: 700,
    title: "RdcAgent - RenderDoc Debug Agent",
    show: false,
    webPreferences: {
      preload: path__namespace.join(__dirname$1, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    // 窗口样式
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    backgroundColor: "#08080c"
  });
  if (isDev) {
    const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
    if (rendererUrl) {
      mainWindow.loadURL(rendererUrl);
    } else {
      mainWindow.loadURL("http://localhost:5173");
    }
  } else {
    mainWindow.loadFile(path__namespace.join(__dirname$1, "../renderer/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("maximize", emitWindowMaximizedState);
  mainWindow.on("unmaximize", emitWindowMaximizedState);
  mainWindow.on("enter-full-screen", emitWindowMaximizedState);
  mainWindow.on("leave-full-screen", emitWindowMaximizedState);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: url2 }) => {
    if (url2.startsWith("http://") || url2.startsWith("https://")) {
      electron.shell.openExternal(url2);
    }
    return { action: "deny" };
  });
  setMainWindow(mainWindow);
  setupKeyboardShortcuts(mainWindow);
  setupMenu();
}
function setupMenu() {
  if (process.platform === "darwin") {
    const template = [
      { role: "appMenu" },
      {
        label: "File",
        submenu: [
          {
            label: "Open .rdc File",
            accelerator: "CmdOrCtrl+O",
            click: async () => openRdcFiles()
          },
          {
            label: "New Case",
            accelerator: "CmdOrCtrl+N",
            click: () => mainWindow?.webContents.send("case:new")
          },
          {
            label: "Settings",
            accelerator: "CmdOrCtrl+,",
            click: () => mainWindow?.webContents.send("settings:open")
          },
          { type: "separator" },
          { role: "close" }
        ]
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" }
        ]
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "togglefullscreen" }
        ]
      },
      {
        label: "Help",
        submenu: [
          {
            label: "Documentation",
            click: () => {
              electron.shell.openExternal("https://github.com/rdc-agent/docs");
            }
          },
          {
            label: "Report Issue",
            click: () => {
              electron.shell.openExternal("https://github.com/rdc-agent/issues");
            }
          }
        ]
      }
    ];
    electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
    return;
  }
  electron.Menu.setApplicationMenu(null);
}
electron.app.whenReady().then(() => {
  registerIPCHandlers();
  createMainWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== "http://localhost:5173" && parsedUrl.protocol !== "file:") {
      event.preventDefault();
    }
  });
});
function getMainWindow() {
  return mainWindow;
}
exports.getMainWindow = getMainWindow;
