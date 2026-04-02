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
const langgraph = require("@langchain/langgraph");
const child_process = require("child_process");
const fs = require("fs");
const uuid = require("uuid");
const yaml = require("yaml");
const load = require("@langchain/core/load");
const tools = require("@langchain/core/tools");
const zod = require("zod");
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
function nowIso$1() {
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
      created_at: nowIso$1(),
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
    await writeYaml(casePath, { ...existing, ...data, updated_at: nowIso$1() });
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
      created_at: nowIso$1(),
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
        last_updated: nowIso$1(),
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
    await writeYaml(runPath, { ...existing, ...data, updated_at: nowIso$1() });
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
      lastUpdated: nowIso$1()
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
        board.hypothesis_board.last_updated = nowIso$1();
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
      lastUpdated: nowIso$1()
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
    this.state.lastUpdated = nowIso$1();
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
        timestamp: nowIso$1()
      }
    });
    await storageAdapter.appendActionEvent(this.state.sessionId, event);
  }
  createErrorResult(code, reason) {
    return {
      stage: this.state?.currentStage || "unknown",
      status: "blocked",
      blockers: [{ code, reason, refs: [], detectedAt: nowIso$1() }],
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
      generated_at: nowIso$1(),
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
      detectedAt: nowIso$1()
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
const DEFAULT_TOKEN_TTL_SECONDS = 1800;
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
        lastActivity: nowIso$1()
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
        dispatch_time: nowIso$1()
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
          completed_at: nowIso$1()
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
      state.lastActivity = nowIso$1();
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
const BLOCKER_CODES = {
  // Capture相关
  BLOCKED_MISSING_CAPTURE: {
    code: "BLOCKED_MISSING_CAPTURE",
    category: "capture",
    severity: "critical",
    description: "Missing .rdc capture file",
    resolution: "Provide a valid .rdc file path"
  },
  BLOCKED_CAPTURE_IMPORT_FAILED: {
    code: "BLOCKED_CAPTURE_IMPORT_FAILED",
    category: "capture",
    severity: "critical",
    description: "Failed to import capture file"
  },
  // Gate相关
  BLOCKED_ENTRY_PREFLIGHT: {
    code: "BLOCKED_ENTRY_PREFLIGHT",
    category: "gate",
    severity: "critical",
    description: "Entry preflight check failed"
  },
  BLOCKED_PLATFORM_MODE_UNSUPPORTED: {
    code: "BLOCKED_PLATFORM_MODE_UNSUPPORTED",
    category: "gate",
    severity: "critical",
    description: "Platform mode not supported"
  },
  BLOCKED_INTAKE_GATE_REQUIRED: {
    code: "BLOCKED_INTAKE_GATE_REQUIRED",
    category: "gate",
    severity: "critical",
    description: "Intake gate check failed"
  },
  BLOCKED_RUNTIME_TOPOLOGY_REQUIRED: {
    code: "BLOCKED_RUNTIME_TOPOLOGY_REQUIRED",
    category: "gate",
    severity: "critical",
    description: "Runtime topology check failed"
  },
  BLOCKED_REQUIRED_ARTIFACT_MISSING: {
    code: "BLOCKED_REQUIRED_ARTIFACT_MISSING",
    category: "gate",
    severity: "critical",
    description: "Required artifact is missing"
  },
  // Runtime相关
  BLOCKED_RUNTIME_OWNER_CONFLICT: {
    code: "BLOCKED_RUNTIME_OWNER_CONFLICT",
    category: "runtime",
    severity: "critical",
    description: "Runtime owner conflict detected"
  },
  BLOCKED_RUNTIME_LOCK_EXPIRED: {
    code: "BLOCKED_RUNTIME_LOCK_EXPIRED",
    category: "runtime",
    severity: "warning",
    description: "Runtime lock has expired"
  },
  BLOCKED_CAPABILITY_TOKEN_EXPIRED: {
    code: "BLOCKED_CAPABILITY_TOKEN_EXPIRED",
    category: "runtime",
    severity: "warning",
    description: "Capability token has expired"
  },
  // Specialist相关
  BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT: {
    code: "BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT",
    category: "specialist",
    severity: "critical",
    description: "Specialist feedback timeout",
    resolution: "Redispatch or skip investigation"
  },
  BLOCKED_UNKNOWN_SPECIALIST: {
    code: "BLOCKED_UNKNOWN_SPECIALIST",
    category: "specialist",
    severity: "critical",
    description: "Unknown specialist agent"
  },
  BLOCKED_SINGLE_AGENT_MODE_NO_DISPATCH: {
    code: "BLOCKED_SINGLE_AGENT_MODE_NO_DISPATCH",
    category: "specialist",
    severity: "info",
    description: "Single agent mode - no dispatch allowed"
  },
  // Verification相关
  BLOCKED_FIX_VERIFICATION_FAILED: {
    code: "BLOCKED_FIX_VERIFICATION_FAILED",
    category: "verification",
    severity: "critical",
    description: "Fix verification failed"
  },
  BLOCKED_SKEPTIC_SIGNOFF_REQUIRED: {
    code: "BLOCKED_SKEPTIC_SIGNOFF_REQUIRED",
    category: "verification",
    severity: "critical",
    description: "Skeptic signoff required"
  },
  BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY: {
    code: "BLOCKED_SHADER_REPLACEMENT_OBSERVABILITY",
    category: "verification",
    severity: "warning",
    description: "Shader replacement observability blocked"
  },
  // Process相关
  PROCESS_DEVIATION_MAIN_AGENT_OVERREACH: {
    code: "PROCESS_DEVIATION_MAIN_AGENT_OVERREACH",
    category: "process",
    severity: "critical",
    description: "Main agent overreach during specialist brief"
  },
  BLOCKED_FREEZE_STATE_ACTIVE: {
    code: "BLOCKED_FREEZE_STATE_ACTIVE",
    category: "process",
    severity: "critical",
    description: "Run is frozen due to process deviation"
  },
  // 新增：修复参照缺失
  BLOCKED_MISSING_FIX_REFERENCE: {
    code: "BLOCKED_MISSING_FIX_REFERENCE",
    category: "gate",
    severity: "critical",
    description: "Missing fix reference for verification",
    resolution: "Provide fix_reference (description + comparison/baseline .rdc)"
  }
};
function createStageTransitionEvidence(state, newStage, agentId = "rdc-debugger") {
  return {
    eventId: crypto.randomUUID(),
    eventType: "workflow_stage_transition",
    agentId,
    status: "ok",
    timestamp: Date.now(),
    payload: {
      fromStage: state.currentStage,
      toStage: newStage,
      runId: state.runId,
      sessionId: state.sessionId
    }
  };
}
function createToolExecutionEvidence(state, toolName, args, result, agentId = "rdc-debugger") {
  return {
    eventId: crypto.randomUUID(),
    eventType: "tool_execution",
    agentId,
    status: result.ok ? "ok" : "error",
    timestamp: Date.now(),
    payload: {
      toolName,
      args,
      result: result.ok ? "success" : "failed",
      error: result.error,
      runId: state.runId,
      sessionId: state.sessionId
    }
  };
}
function createDispatchEvidence(state, targetAgent, objective, tokenId, agentId = "rdc-debugger") {
  return {
    eventId: crypto.randomUUID(),
    eventType: "dispatch",
    agentId,
    status: "sent",
    timestamp: Date.now(),
    payload: {
      targetAgent,
      objective: objective.substring(0, 500),
      // 截断避免过大
      capabilityTokenId: tokenId,
      dispatchTime: (/* @__PURE__ */ new Date()).toISOString(),
      runId: state.runId,
      sessionId: state.sessionId
    }
  };
}
function createSpecialistCompleteEvidence(state, agentId, brief, artifacts) {
  return {
    eventId: crypto.randomUUID(),
    eventType: "specialist_complete",
    agentId,
    status: "ok",
    timestamp: Date.now(),
    payload: {
      brief: brief.substring(0, 500),
      artifacts,
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      runId: state.runId,
      sessionId: state.sessionId
    }
  };
}
function projectToWorkflowState(graphState) {
  return {
    caseId: graphState.caseId,
    runId: graphState.runId,
    sessionId: graphState.sessionId,
    currentStage: graphState.currentStage,
    previousStages: graphState.stageHistory,
    entryMode: graphState.entryMode,
    backend: graphState.backend,
    orchestrationMode: graphState.orchestrationMode,
    coordinationMode: graphState.coordinationMode,
    blockers: graphState.blockers,
    lastUpdated: graphState.lastUpdated
  };
}
function createBlocker(code, reason, refs = []) {
  return {
    code,
    reason,
    refs,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function createInitialSpecialistState(agentId) {
  return {
    agentId,
    status: "pending",
    artifacts: [],
    retryCount: 0
  };
}
function createArtifact(type, path2, agentId) {
  return {
    id: crypto.randomUUID(),
    type,
    path: path2,
    agentId,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function preflightNode(state, config = {}) {
  const blockers = [];
  const evidenceChain = [];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "preflight_pending"
    )
  );
  if (config.checkToolsPath !== false) {
    const toolsPath = config.toolsPath || process.env.RDC_TOOLS_PATH;
    if (!toolsPath) {
      blockers.push(
        createBlocker(
          BLOCKER_CODES.BLOCKED_ENTRY_PREFLIGHT.code,
          "RDC_TOOLS_PATH not set. Please set environment variable or provide toolsPath in config.",
          ["env:RDC_TOOLS_PATH"]
        )
      );
    } else if (!fs__namespace.existsSync(toolsPath)) {
      blockers.push(
        createBlocker(
          BLOCKER_CODES.BLOCKED_ENTRY_PREFLIGHT.code,
          `RDC-Agent-Tools path does not exist: ${toolsPath}`,
          [toolsPath]
        )
      );
    } else {
      const requiredSubdirs = ["bin", "lib", "tools"];
      for (const subdir of requiredSubdirs) {
        const subdirPath = path__namespace.join(toolsPath, subdir);
        if (!fs__namespace.existsSync(subdirPath)) {
          console.warn(`[preflight] Missing subdirectory: ${subdirPath}`);
        }
      }
    }
  }
  if (state.capturePaths && state.capturePaths.length > 0) {
    for (const capturePath of state.capturePaths) {
      if (!fs__namespace.existsSync(capturePath)) {
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
            `Capture file not found: ${capturePath}`,
            [capturePath]
          )
        );
      } else if (!capturePath.endsWith(".rdc")) {
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_CAPTURE_IMPORT_FAILED.code,
            `Invalid capture file format (expected .rdc): ${capturePath}`,
            [capturePath]
          )
        );
      }
    }
  }
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "preflight_complete",
    agentId: "rdc-debugger",
    status: blockers.length === 0 ? "ok" : "blocked",
    timestamp: Date.now(),
    payload: {
      checksPerformed: ["tools_path", "capture_files"],
      blockersFound: blockers.length,
      runId: state.runId,
      sessionId: state.sessionId
    }
  });
  return {
    currentStage: "preflight_pending",
    stageHistory: [state.currentStage],
    evidenceChain,
    blockers: [...state.blockers, ...blockers],
    lastUpdated: nowIso()
  };
}
function routeAfterPreflight(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  return "intent_gate";
}
async function analyzeIntent(userGoal, config) {
  const systemPrompt = `You are an expert graphics debugging assistant. Analyze the user's problem description and classify it into categories.

Output a JSON object with the following structure:
{
  "category": "rendering|performance|crash|artifact|shader|unknown",
  "severity": "critical|high|medium|low",
  "subsystems": ["list", "of", "affected", "subsystems"],
  "recommendedAgents": ["agent_role_1", "agent_role_2"],
  "confidence": 0.0-1.0,
  "summary": "Brief analysis summary",
  "keywords": ["key", "words"]
}

Available agent roles:
- triage_agent: Symptom classification and SOP recommendation
- capture_repro_agent: Capture quality verification and baseline establishment
- pass_graph_pipeline_agent: Render pass and pipeline dependency analysis
- pixel_forensics_agent: Pixel-level evidence collection and first-bad event localization
- shader_ir_agent: Shader source and IR evidence analysis
- driver_device_agent: Cross-device attribution and platform-specific checks

Rules:
1. category must be one of the allowed values
2. severity should reflect business impact
3. recommendedAgents should be relevant to the problem type
4. confidence should reflect how well the intent is understood
5. Be concise but informative`;
  const response = await llmAdapter.chat(
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze this problem description:

${userGoal}` }
      ],
      model: config.modelName || "anthropic/claude-3-sonnet",
      maxTokens: 2048,
      temperature: 0.3
    },
    config.modelProvider || "openrouter"
  );
  const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("No JSON found in response");
  } catch {
    return {
      category: "unknown",
      severity: "medium",
      subsystems: [],
      recommendedAgents: ["triage_agent"],
      confidence: 0.5,
      summary: "Failed to parse intent analysis",
      keywords: []
    };
  }
}
async function intentGateNode(state, config = {}) {
  const evidenceChain = [];
  const blockers = [];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "intent_gate_passed"
    )
  );
  if (!state.userGoal || state.userGoal.trim().length === 0) {
    blockers.push(
      createBlocker(
        BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
        "User goal is required for intent analysis",
        ["userGoal"]
      )
    );
    return {
      currentStage: "intent_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      lastUpdated: nowIso()
    };
  }
  try {
    const analysisResult = await analyzeIntent(state.userGoal, config);
    const minConfidence = config.minConfidence ?? 0.3;
    if (analysisResult.confidence < minConfidence) {
      blockers.push(
        createBlocker(
          BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
          `Intent analysis confidence (${analysisResult.confidence}) below threshold (${minConfidence}). Please provide more details.`,
          ["userGoal", "confidence"]
        )
      );
    }
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "intent_analysis",
        { userGoal: state.userGoal },
        { ok: true, data: analysisResult },
        "rdc-debugger"
      )
    );
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "intent_analysis_complete",
      agentId: "rdc-debugger",
      status: blockers.length === 0 ? "ok" : "blocked",
      timestamp: Date.now(),
      payload: {
        category: analysisResult.category,
        severity: analysisResult.severity,
        recommendedAgents: analysisResult.recommendedAgents,
        confidence: analysisResult.confidence,
        summary: analysisResult.summary,
        keywords: analysisResult.keywords,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "intent_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "intent_analysis",
        { userGoal: state.userGoal },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        },
        "rdc-debugger"
      )
    );
    console.warn("[intentGate] Analysis failed, continuing with default routing:", error);
    return {
      currentStage: "intent_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterIntentGate(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  return "entry_gate";
}
async function entryGateNode(state, config = {}) {
  const evidenceChain = [];
  const blockers = [...state.blockers];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "entry_gate_passed"
    )
  );
  try {
    const gateResult = await harnessController.executeEntryGate({
      capturePaths: state.capturePaths,
      platform: config.platform || "windows",
      entryMode: state.entryMode,
      backend: state.backend
    });
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "entry_gate_check",
        {
          capturePaths: state.capturePaths,
          platform: config.platform,
          entryMode: state.entryMode,
          backend: state.backend
        },
        {
          ok: gateResult.status === "passed",
          data: { stage: gateResult.stage, status: gateResult.status }
        },
        "rdc-debugger"
      )
    );
    if (gateResult.blockers && gateResult.blockers.length > 0) {
      for (const blocker of gateResult.blockers) {
        const exists = blockers.some((b) => b.code === blocker.code && !b.resolvedAt);
        if (!exists) {
          blockers.push({
            ...blocker,
            detectedAt: blocker.detectedAt || nowIso()
          });
        }
      }
    }
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "entry_gate_complete",
      agentId: "rdc-debugger",
      status: gateResult.status,
      timestamp: Date.now(),
      payload: {
        stage: gateResult.stage,
        status: gateResult.status,
        blockerCount: gateResult.blockers.length,
        refs: gateResult.refs,
        paths: gateResult.paths,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    if (config.checkPlatform !== false && state.backend === "remote") {
      const platformBlockers = await checkPlatformCompatibility(
        state.capturePaths,
        config.platform || "windows"
      );
      blockers.push(...platformBlockers);
    }
    return {
      currentStage: "entry_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "entry_gate_check",
        { capturePaths: state.capturePaths },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        },
        "rdc-debugger"
      )
    );
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_ENTRY_PREFLIGHT.code,
      reason: `Entry gate check failed: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
      detectedAt: nowIso()
    });
    return {
      currentStage: "entry_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso()
    };
  }
}
async function checkPlatformCompatibility(_capturePaths, targetPlatform) {
  const blockers = [];
  if (targetPlatform === "unsupported_platform") {
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_PLATFORM_MODE_UNSUPPORTED.code,
      reason: `Platform ${targetPlatform} is not supported`,
      refs: [],
      detectedAt: nowIso()
    });
  }
  return blockers;
}
function routeAfterEntryGate(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  return "intake_init";
}
async function extractCaptureMetadata(capturePath) {
  try {
    const stats = fs__namespace.statSync(capturePath);
    return {
      api: "unknown",
      device: "unknown",
      driverVersion: "unknown",
      frameCount: 0,
      eventCount: 0,
      captureDate: stats.mtime.toISOString(),
      fileSize: stats.size,
      features: []
    };
  } catch {
    return null;
  }
}
function generateFileId(capturePath) {
  const basename = path__namespace.basename(capturePath, ".rdc");
  const timestamp = Date.now().toString(36);
  return `capture-${basename}-${timestamp}`;
}
async function intakeInitNode(state, config = {}) {
  const evidenceChain = [];
  const blockers = [...state.blockers];
  const artifacts = [...state.artifacts];
  let captureInfo = state.captureInfo;
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "accepted_intake_initialized"
    )
  );
  try {
    const casePath = storageAdapter.getCasePath(state.caseId);
    if (!fs__namespace.existsSync(casePath)) {
      fs__namespace.mkdirSync(casePath, { recursive: true });
    }
    const runPath = storageAdapter.getRunPath(state.caseId, state.runId);
    if (!fs__namespace.existsSync(runPath)) {
      fs__namespace.mkdirSync(runPath, { recursive: true });
    }
    const subdirs = ["artifacts", "notes", "reports"];
    for (const subdir of subdirs) {
      const subdirPath = path__namespace.join(runPath, subdir);
      if (!fs__namespace.existsSync(subdirPath)) {
        fs__namespace.mkdirSync(subdirPath, { recursive: true });
      }
    }
    if (state.capturePaths && state.capturePaths.length > 0 && !captureInfo) {
      const primaryCapture = state.capturePaths[0];
      let metadata = null;
      if (config.extractMetadata !== false) {
        metadata = await extractCaptureMetadata(primaryCapture);
      }
      captureInfo = {
        fileId: generateFileId(primaryCapture),
        filePath: primaryCapture,
        metadata: metadata || {
          api: "unknown",
          device: "unknown",
          driverVersion: "unknown",
          frameCount: 0,
          eventCount: 0,
          captureDate: nowIso(),
          fileSize: 0,
          features: []
        }
      };
      const captureArtifact = createArtifact(
        "capture_info",
        path__namespace.join(runPath, "artifacts", "capture_info.json"),
        "rdc-debugger"
      );
      artifacts.push(captureArtifact);
      fs__namespace.writeFileSync(
        captureArtifact.path,
        JSON.stringify(captureInfo, null, 2),
        "utf-8"
      );
    }
    const caseInput = {
      schema_version: "2",
      generated_at: nowIso(),
      session: {
        case_id: state.caseId,
        run_id: state.runId,
        session_id: state.sessionId
      },
      symptom: {
        description: state.userGoal
      },
      captures: state.capturePaths.map((p, i) => ({
        capture_id: captureInfo?.fileId || `capture-${i}`,
        capture_role: i === 0 ? "primary" : "reference",
        path: p
      })),
      reference_contract: {
        source_refs: state.capturePaths.length > 1 ? [state.capturePaths[1]] : []
      }
    };
    const caseInputPath = path__namespace.join(runPath, "case_input.yaml");
    const yaml2 = await import("yaml");
    fs__namespace.writeFileSync(caseInputPath, yaml2.stringify(caseInput), "utf-8");
    artifacts.push(
      createArtifact("case_input", caseInputPath, "rdc-debugger")
    );
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "intake_init",
        {
          caseId: state.caseId,
          runId: state.runId,
          capturePaths: state.capturePaths
        },
        { ok: true, data: { casePath, runPath } },
        "rdc-debugger"
      )
    );
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "intake_init_complete",
      agentId: "rdc-debugger",
      status: "ok",
      timestamp: Date.now(),
      payload: {
        caseId: state.caseId,
        runId: state.runId,
        captureInfo: captureInfo ? {
          fileId: captureInfo.fileId,
          filePath: captureInfo.filePath,
          metadata: {
            api: captureInfo.metadata.api,
            device: captureInfo.metadata.device,
            fileSize: captureInfo.metadata.fileSize
          }
        } : null,
        artifactCount: artifacts.length,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "accepted_intake_initialized",
      stageHistory: [state.currentStage],
      evidenceChain,
      captureInfo,
      artifacts,
      blockers,
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "intake_init",
        { caseId: state.caseId, runId: state.runId },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        },
        "rdc-debugger"
      )
    );
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
      reason: `Intake initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
      detectedAt: nowIso()
    });
    return {
      currentStage: "accepted_intake_initialized",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterIntakeInit(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  return "intake_gate";
}
async function readCaseInput(caseId, runId) {
  try {
    const runPath = storageAdapter.getRunPath(caseId, runId);
    const caseInputPath = path__namespace.join(runPath, "case_input.yaml");
    if (!fs__namespace.existsSync(caseInputPath)) {
      return null;
    }
    const content = fs__namespace.readFileSync(caseInputPath, "utf-8");
    const yaml2 = await import("yaml");
    return yaml2.parse(content);
  } catch {
    return null;
  }
}
function extractCaptureRefs(caseInput) {
  if (!caseInput) return [];
  const captures = caseInput.captures;
  if (!Array.isArray(captures)) return [];
  return captures.map((c) => ({
    capture_id: c.capture_id,
    capture_role: c.capture_role
  }));
}
async function intakeGateNode(state, config = {}) {
  const evidenceChain = [];
  const blockers = [...state.blockers];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "intake_gate_passed"
    )
  );
  try {
    const caseInput = await readCaseInput(state.caseId, state.runId);
    const captureRefs = extractCaptureRefs(caseInput);
    const gateResult = await harnessController.executeIntakeGate(
      state.caseId,
      state.runId,
      {
        caseInput: caseInput || {},
        captureRefs
      }
    );
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "intake_gate_check",
        {
          caseId: state.caseId,
          runId: state.runId,
          captureRefCount: captureRefs.length
        },
        {
          ok: gateResult.status === "passed",
          data: { stage: gateResult.stage, status: gateResult.status }
        },
        "rdc-debugger"
      )
    );
    if (gateResult.blockers && gateResult.blockers.length > 0) {
      for (const blocker of gateResult.blockers) {
        const exists = blockers.some((b) => b.code === blocker.code && !b.resolvedAt);
        if (!exists) {
          blockers.push({
            ...blocker,
            detectedAt: blocker.detectedAt || nowIso()
          });
        }
      }
    }
    if (config.requireFixReference !== false) {
      const referenceContract = caseInput?.reference_contract;
      if (!referenceContract || !referenceContract.source_refs) {
        const exists = blockers.some(
          (b) => b.code === BLOCKER_CODES.BLOCKED_MISSING_FIX_REFERENCE.code && !b.resolvedAt
        );
        if (!exists) {
          blockers.push({
            code: BLOCKER_CODES.BLOCKED_MISSING_FIX_REFERENCE.code,
            reason: BLOCKER_CODES.BLOCKED_MISSING_FIX_REFERENCE.description,
            refs: [],
            detectedAt: nowIso()
          });
        }
      }
    }
    if (state.capturePaths) {
      for (const capturePath of state.capturePaths) {
        if (!fs__namespace.existsSync(capturePath)) {
          const exists = blockers.some(
            (b) => b.code === BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code && b.refs.includes(capturePath)
          );
          if (!exists) {
            blockers.push({
              code: BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
              reason: `Capture file no longer accessible: ${capturePath}`,
              refs: [capturePath],
              detectedAt: nowIso()
            });
          }
        }
      }
    }
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "intake_gate_complete",
      agentId: "rdc-debugger",
      status: gateResult.status,
      timestamp: Date.now(),
      payload: {
        stage: gateResult.stage,
        status: gateResult.status,
        blockerCount: blockers.filter((b) => !b.resolvedAt).length,
        refs: gateResult.refs,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "intake_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push(
      createToolExecutionEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        "intake_gate_check",
        { caseId: state.caseId, runId: state.runId },
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        },
        "rdc-debugger"
      )
    );
    blockers.push({
      code: BLOCKER_CODES.BLOCKED_INTAKE_GATE_REQUIRED.code,
      reason: `Intake gate check failed: ${error instanceof Error ? error.message : String(error)}`,
      refs: [],
      detectedAt: nowIso()
    });
    return {
      currentStage: "intake_gate_passed",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterIntakeGate(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  return "specialist_dispatch";
}
function selectSpecialistsByIntent(state, skipAgents = []) {
  const intentEvent = state.evidenceChain.find(
    (e) => e.eventType === "intent_analysis_complete"
  );
  if (intentEvent?.payload?.recommendedAgents) {
    const recommended = intentEvent.payload.recommendedAgents;
    return recommended.filter(
      (agent) => INVESTIGATOR_AGENTS.includes(agent) && !skipAgents.includes(agent)
    );
  }
  return INVESTIGATOR_AGENTS.filter((agent) => !skipAgents.includes(agent));
}
function generateObjective(agentRole, state) {
  const baseContext = `
Case ID: ${state.caseId}
Run ID: ${state.runId}
Session ID: ${state.sessionId}
User Goal: ${state.userGoal}
Capture Files: ${state.capturePaths?.join(", ") || "N/A"}
`;
  const objectives = {
    triage_agent: `Analyze the problem and classify symptoms. Recommend investigation SOPs.

${baseContext}

Your task:
1. Classify the symptom type (rendering, performance, crash, etc.)
2. Identify potential root cause categories
3. Recommend which specialists should investigate
4. Output a triage report with confidence scores`,
    capture_repro_agent: `Verify capture quality and establish baseline.

${baseContext}

Your task:
1. Verify capture file integrity
2. Check if the issue is reproducible
3. Establish baseline metrics
4. Document capture characteristics`,
    pass_graph_pipeline_agent: `Analyze render passes and pipeline dependencies.

${baseContext}

Your task:
1. Analyze render pass structure
2. Identify pipeline dependencies
3. Check for pipeline state issues
4. Document pass-level findings`,
    pixel_forensics_agent: `Perform pixel-level evidence collection.

${baseContext}

Your task:
1. Locate first-bad event/frame
2. Analyze pixel value anomalies
3. Identify corruption patterns
4. Document visual evidence`,
    shader_ir_agent: `Analyze shader source and IR evidence.

${baseContext}

Your task:
1. Analyze shader source code
2. Check IR compilation issues
3. Identify shader-related bugs
4. Document shader findings`,
    driver_device_agent: `Perform cross-device attribution and platform checks.

${baseContext}

Your task:
1. Check driver version compatibility
2. Identify platform-specific issues
3. Analyze device capabilities
4. Document driver/device findings`,
    // 非 investigator agents 不应该被分派，但提供默认值
    skeptic_agent: `Review and challenge evidence.`,
    curator_agent: `Generate final report.`,
    "rdc-debugger": `Orchestrate workflow.`
  };
  return objectives[agentRole] || `Investigate the problem:
${baseContext}`;
}
async function specialistDispatchNode(state, config = {}) {
  const evidenceChain = [];
  const activeSpecialists = { ...state.activeSpecialists };
  const pendingBriefs = [...state.pendingBriefs];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "waiting_for_specialist_brief"
    )
  );
  let selectedAgents;
  if (config.forceDispatch && config.forceDispatch.length > 0) {
    selectedAgents = config.forceDispatch;
  } else if (config.intentBasedSelection !== false) {
    selectedAgents = selectSpecialistsByIntent(state, config.skipAgents);
  } else {
    selectedAgents = INVESTIGATOR_AGENTS.filter(
      (agent) => !config.skipAgents?.includes(agent)
    );
  }
  const dispatchTargets = selectedAgents.map((agentRole) => ({
    agentRole,
    objective: generateObjective(agentRole, state)
  }));
  for (const target of dispatchTargets) {
    const tokenId = crypto.randomUUID();
    activeSpecialists[target.agentRole] = createInitialSpecialistState(target.agentRole);
    activeSpecialists[target.agentRole].status = "running";
    activeSpecialists[target.agentRole].startedAt = nowIso();
    if (!pendingBriefs.includes(target.agentRole)) {
      pendingBriefs.push(target.agentRole);
    }
    evidenceChain.push(
      createDispatchEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        target.agentRole,
        target.objective,
        tokenId
      )
    );
  }
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "specialist_dispatch_complete",
    agentId: "rdc-debugger",
    status: "ok",
    timestamp: Date.now(),
    payload: {
      dispatchedAgents: selectedAgents,
      dispatchCount: selectedAgents.length,
      parallelMode: config.parallelDispatch !== false,
      runId: state.runId,
      sessionId: state.sessionId
    }
  });
  return {
    currentStage: "waiting_for_specialist_brief",
    stageHistory: [state.currentStage],
    evidenceChain,
    activeSpecialists,
    pendingBriefs,
    lastUpdated: nowIso()
  };
}
function createSpecialistSends(state, config = {}) {
  let selectedAgents;
  if (config.forceDispatch && config.forceDispatch.length > 0) {
    selectedAgents = config.forceDispatch;
  } else if (config.intentBasedSelection !== false) {
    selectedAgents = selectSpecialistsByIntent(state, config.skipAgents);
  } else {
    selectedAgents = INVESTIGATOR_AGENTS.filter(
      (agent) => !config.skipAgents?.includes(agent)
    );
  }
  return selectedAgents.map(
    (agentRole) => new langgraph.Send("specialist_exec", {
      agentRole,
      objective: generateObjective(agentRole, state),
      context: {
        caseId: state.caseId,
        runId: state.runId,
        sessionId: state.sessionId,
        capturePaths: state.capturePaths,
        userGoal: state.userGoal
      }
    })
  );
}
function isSpecialistTimeout(specialist, timeoutSeconds) {
  if (!specialist.startedAt) return false;
  const startTime = new Date(specialist.startedAt).getTime();
  const currentTime = Date.now();
  return currentTime - startTime > timeoutSeconds * 1e3;
}
async function specialistBriefsNode(state, config = {}) {
  const timeoutSeconds = config.timeoutSeconds || DEFAULT_TOKEN_TTL_SECONDS;
  const maxRetries = config.maxRetries || 3;
  const evidenceChain = [];
  const blockers = [];
  const activeSpecialists = { ...state.activeSpecialists };
  const collectedBriefs = { ...state.collectedBriefs };
  const backtrackCount = { ...state.backtrackCount };
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "specialist_briefs_collected"
    )
  );
  const specialistEntries = Object.entries(activeSpecialists);
  let completedCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;
  for (const [agentId, specialist] of specialistEntries) {
    if (specialist.status === "running" && isSpecialistTimeout(specialist, timeoutSeconds)) {
      specialist.status = "timeout";
      specialist.error = `Timeout after ${timeoutSeconds}s`;
      timeoutCount++;
      evidenceChain.push({
        eventId: crypto.randomUUID(),
        eventType: "specialist_timeout",
        agentId,
        status: "timeout",
        timestamp: Date.now(),
        payload: {
          agentId,
          timeoutSeconds,
          startedAt: specialist.startedAt,
          runId: state.runId,
          sessionId: state.sessionId
        }
      });
      const currentRetryCount = backtrackCount["specialist_timeout"] || 0;
      if (currentRetryCount < maxRetries) {
        backtrackCount["specialist_timeout"] = currentRetryCount + 1;
      } else {
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_VALIDATION_FAILED.code,
            `Specialist ${agentId} timed out after ${maxRetries} retries`,
            [agentId]
          )
        );
      }
    }
    if (specialist.status === "completed" && specialist.brief) {
      if (!collectedBriefs[agentId]) {
        collectedBriefs[agentId] = specialist.brief;
        completedCount++;
        evidenceChain.push(
          createSpecialistCompleteEvidence(
            { sessionId: state.sessionId, runId: state.runId },
            agentId,
            specialist.brief,
            specialist.artifacts
          )
        );
      }
    }
    if (specialist.status === "failed") {
      failedCount++;
      evidenceChain.push({
        eventId: crypto.randomUUID(),
        eventType: "specialist_failed",
        agentId,
        status: "failed",
        timestamp: Date.now(),
        payload: {
          agentId,
          error: specialist.error,
          runId: state.runId,
          sessionId: state.sessionId
        }
      });
    }
  }
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "specialist_briefs_summary",
    agentId: "rdc-debugger",
    status: "ok",
    timestamp: Date.now(),
    payload: {
      totalSpecialists: specialistEntries.length,
      completedCount,
      failedCount,
      timeoutCount,
      collectedBriefsCount: Object.keys(collectedBriefs).length,
      runId: state.runId,
      sessionId: state.sessionId
    }
  });
  return {
    currentStage: "specialist_briefs_collected",
    stageHistory: [state.currentStage],
    evidenceChain,
    blockers: [...state.blockers, ...blockers],
    activeSpecialists,
    collectedBriefs,
    backtrackCount,
    lastUpdated: nowIso()
  };
}
function routeAfterSpecialistBriefs(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  const hasTimeoutSpecialist = Object.values(state.activeSpecialists).some(
    (s) => s.status === "timeout"
  );
  const retryCount = state.backtrackCount["specialist_timeout"] || 0;
  if (hasTimeoutSpecialist && retryCount < 3) {
    return "specialist_dispatch";
  }
  const collectedCount = Object.keys(state.collectedBriefs).length;
  const totalSpecialists = Object.keys(state.activeSpecialists).length;
  if (collectedCount === 0 && totalSpecialists > 0) {
    return "validation_blocked";
  }
  return "expert_investigation";
}
function buildExpertSystemPrompt() {
  return `You are the RDC Debugger, an expert graphics debugging AI assistant.
Your role is to analyze specialist briefs and form a comprehensive diagnosis.

## Your Task
1. Review all specialist briefs and identify patterns
2. Correlate findings across different analysis domains
3. Form a hypothesis about the root cause
4. Propose specific fixes or workarounds
5. Identify any gaps in the investigation that need further verification

## Output Format
Provide your analysis in the following structure:
- **Summary**: Brief overview of the issue
- **Root Cause Analysis**: Your diagnosis based on evidence
- **Proposed Fix**: Specific steps to resolve the issue
- **Confidence Level**: High/Medium/Low with reasoning
- **Verification Needed**: Any additional checks recommended`;
}
function buildInvestigationPrompt(state) {
  const briefsSummary = Object.entries(state.collectedBriefs).map(([agentId, brief]) => `### ${agentId}
${brief.substring(0, 2e3)}`).join("\n\n");
  const artifactsSummary = state.artifacts.map((a) => `- ${a.type}: ${a.path}`).join("\n");
  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- User Goal: ${state.userGoal}
- Capture Files: ${state.capturePaths?.join(", ") || "N/A"}

## Specialist Briefs
${briefsSummary}

## Artifacts
${artifactsSummary || "No artifacts generated"}

## Task
Analyze the above briefs and provide your expert diagnosis. Focus on:
1. Identifying the most likely root cause
2. Proposing concrete fix steps
3. Highlighting any conflicting evidence
4. Suggesting verification steps`;
}
async function expertInvestigationNode(state, config = {}) {
  const evidenceChain = [];
  const artifacts = [];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "expert_investigation_complete"
    )
  );
  try {
    const modelConfig = DEFAULT_MODEL_ROUTING["rdc-debugger"];
    const request = {
      messages: [
        { role: "system", content: buildExpertSystemPrompt() },
        { role: "user", content: buildInvestigationPrompt(state) }
      ],
      model: modelConfig.model,
      maxTokens: 4096,
      temperature: 0.3
      // 较低温度以获得更确定的分析
    };
    const response = await llmAdapter.chat(request, modelConfig.provider);
    const investigationResult = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "expert_investigation_complete",
      agentId: "rdc-debugger",
      status: "ok",
      timestamp: Date.now(),
      payload: {
        model: modelConfig.model,
        provider: modelConfig.provider,
        briefsAnalyzed: Object.keys(state.collectedBriefs).length,
        resultLength: investigationResult.length,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    const investigationArtifact = createArtifact(
      "expert_investigation",
      `investigation/${state.runId}_expert_analysis.md`,
      "rdc-debugger"
    );
    artifacts.push(investigationArtifact);
    if (config.enableToolVerification && response.toolCalls) {
      for (const toolCall of response.toolCalls) {
        evidenceChain.push(
          createToolExecutionEvidence(
            { sessionId: state.sessionId, runId: state.runId },
            toolCall.name,
            toolCall.arguments,
            { ok: true, data: "Tool execution simulated" },
            "rdc-debugger"
          )
        );
      }
    }
    return {
      currentStage: "expert_investigation_complete",
      stageHistory: [state.currentStage],
      evidenceChain,
      artifacts: [...state.artifacts, ...artifacts],
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "expert_investigation_error",
      agentId: "rdc-debugger",
      status: "error",
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "expert_investigation_complete",
      stageHistory: [state.currentStage],
      evidenceChain,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterExpertInvestigation(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  const hasInvestigationEvidence = state.evidenceChain.some(
    (e) => e.eventType === "expert_investigation_complete" && e.status === "ok"
  );
  if (!hasInvestigationEvidence) {
    const retryCount = state.backtrackCount["expert_investigation"] || 0;
    if (retryCount < 2) {
      return "expert_investigation";
    }
  }
  return "fix_verification";
}
function buildVerificationSystemPrompt() {
  return `You are the RDC Debugger Fix Verification system.
Your role is to verify that the proposed fix will actually resolve the issue.

## Your Task
1. Review the expert investigation findings
2. Analyze the proposed fix steps
3. Verify fix feasibility and completeness
4. Identify any risks or side effects
5. Confirm or reject the fix with reasoning

## Verification Criteria
- Does the fix address the root cause?
- Are the fix steps actionable?
- Are there any potential side effects?
- Is the fix validated by the evidence chain?

## Output Format
Provide your verification result:
- **Verification Status**: VERIFIED / REJECTED / NEEDS_MORE_INFO
- **Reasoning**: Detailed explanation
- **Confidence**: High/Medium/Low
- **Recommendations**: Any additional steps needed`;
}
function buildVerificationPrompt(state) {
  const investigationEvidence = state.evidenceChain.filter((e) => e.eventType === "expert_investigation_complete").map((e) => JSON.stringify(e.payload)).join("\n");
  const briefsSummary = Object.entries(state.collectedBriefs).map(([agentId, brief]) => `### ${agentId}
${brief.substring(0, 1e3)}`).join("\n\n");
  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- User Goal: ${state.userGoal}

## Specialist Briefs Summary
${briefsSummary}

## Expert Investigation Results
${investigationEvidence}

## Task
Verify the proposed fix based on the evidence above. Determine if:
1. The root cause is correctly identified
2. The fix addresses the root cause
3. The fix is practical and actionable
4. Any additional verification is needed`;
}
async function fixVerificationNode(state, config = {}) {
  const evidenceChain = [];
  const blockers = [];
  const backtrackCount = { ...state.backtrackCount };
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "fix_verification_complete"
    )
  );
  let fixVerified = false;
  let verificationStatus = "pending";
  try {
    const modelConfig = DEFAULT_MODEL_ROUTING["rdc-debugger"];
    const request = {
      messages: [
        { role: "system", content: buildVerificationSystemPrompt() },
        { role: "user", content: buildVerificationPrompt(state) }
      ],
      model: modelConfig.model,
      maxTokens: 2048,
      temperature: 0.2
    };
    const response = await llmAdapter.chat(request, modelConfig.provider);
    const verificationResult = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const resultLower = verificationResult.toLowerCase();
    if (resultLower.includes("verified") || resultLower.includes("approved")) {
      fixVerified = true;
      verificationStatus = "verified";
    } else if (resultLower.includes("rejected") || resultLower.includes("failed")) {
      fixVerified = false;
      verificationStatus = "rejected";
    } else {
      fixVerified = false;
      verificationStatus = "needs_review";
    }
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "fix_verification_result",
      agentId: "rdc-debugger",
      status: fixVerified ? "ok" : "warning",
      timestamp: Date.now(),
      payload: {
        fixVerified,
        verificationStatus,
        resultLength: verificationResult.length,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    if (!fixVerified && verificationStatus === "rejected") {
      const currentRetryCount = backtrackCount["fix_verification"] || 0;
      const maxRetries = config.maxRetries || 2;
      if (currentRetryCount >= maxRetries) {
        blockers.push(
          createBlocker(
            BLOCKER_CODES.BLOCKED_VALIDATION_FAILED.code,
            `Fix verification failed after ${maxRetries} attempts`,
            ["fix_verification"]
          )
        );
      } else {
        backtrackCount["fix_verification"] = currentRetryCount + 1;
      }
    }
    return {
      currentStage: "fix_verification_complete",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      fixVerified,
      backtrackCount,
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "fix_verification_error",
      agentId: "rdc-debugger",
      status: "error",
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "fix_verification_complete",
      stageHistory: [state.currentStage],
      evidenceChain,
      fixVerified: false,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterFixVerification(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  if (!state.fixVerified) {
    const retryCount = state.backtrackCount["fix_verification"] || 0;
    if (retryCount < 2) {
      return "expert_investigation";
    }
  }
  return "skeptic";
}
function buildSkepticSystemPrompt() {
  return `You are the Skeptic Agent, an independent validation AI.
Your role is to critically review the entire investigation and challenge weak claims.

## Your Task
1. Review all evidence in the chain
2. Challenge assumptions and weak claims
3. Verify logical consistency
4. Check for confirmation bias
5. Validate that conclusions follow from evidence

## Review Criteria
- Is the evidence sufficient to support the conclusion?
- Are there alternative explanations?
- Are there gaps in the investigation?
- Is the fix properly validated?
- Are there any logical fallacies?

## Output Format
Provide your review in the following structure:
- **Review Status**: APPROVED / REJECTED / NEEDS_CLARIFICATION
- **Critical Issues**: List any major problems found
- **Recommendations**: Suggested improvements
- **Confidence**: Your confidence in the investigation quality`;
}
function buildSkepticPrompt(state) {
  const stageTransitions = state.evidenceChain.filter((e) => e.eventType === "workflow_stage_transition").map((e) => `- ${e.payload?.fromStage} -> ${e.payload?.toStage}`).join("\n");
  const specialistBriefs = Object.entries(state.collectedBriefs).map(([agentId, brief]) => `### ${agentId}
${brief.substring(0, 1500)}`).join("\n\n");
  const investigationResults = state.evidenceChain.filter((e) => e.eventType === "expert_investigation_complete").map((e) => JSON.stringify(e.payload, null, 2)).join("\n");
  const fixVerification = state.evidenceChain.filter((e) => e.eventType === "fix_verification_result").map((e) => JSON.stringify(e.payload, null, 2)).join("\n");
  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- User Goal: ${state.userGoal}
- Fix Verified: ${state.fixVerified}

## Stage Transitions
${stageTransitions}

## Specialist Briefs
${specialistBriefs}

## Expert Investigation
${investigationResults}

## Fix Verification Results
${fixVerification}

## Task
Critically review the entire investigation. Look for:
1. Logical gaps or inconsistencies
2. Insufficient evidence for conclusions
3. Alternative explanations not considered
4. Confirmation bias
5. Unvalidated assumptions

Provide your independent assessment.`;
}
async function skepticNode(state, config = {}) {
  const evidenceChain = [];
  const blockers = [];
  const backtrackCount = { ...state.backtrackCount };
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "skeptic_ready",
      "skeptic_agent"
    )
  );
  let skepticApproved = false;
  let reviewStatus = "pending";
  try {
    const modelConfig = DEFAULT_MODEL_ROUTING["skeptic_agent"];
    const request = {
      messages: [
        { role: "system", content: buildSkepticSystemPrompt() },
        { role: "user", content: buildSkepticPrompt(state) }
      ],
      model: modelConfig.model,
      maxTokens: 4096,
      temperature: 0.2
      // 较低温度以获得更批判性的分析
    };
    const response = await llmAdapter.chat(request, modelConfig.provider);
    const skepticResult = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const resultLower = skepticResult.toLowerCase();
    if (resultLower.includes("approved") || resultLower.includes("pass")) {
      skepticApproved = true;
      reviewStatus = "approved";
    } else if (resultLower.includes("rejected") || resultLower.includes("fail")) {
      skepticApproved = false;
      reviewStatus = "rejected";
    } else {
      skepticApproved = false;
      reviewStatus = "needs_clarification";
    }
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "skeptic_review_complete",
      agentId: "skeptic_agent",
      status: skepticApproved ? "ok" : "warning",
      timestamp: Date.now(),
      payload: {
        skepticApproved,
        reviewStatus,
        resultLength: skepticResult.length,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    if (!skepticApproved && reviewStatus === "rejected") {
      const currentRetryCount = backtrackCount["skeptic_rejected"] || 0;
      const maxRetries = config.maxRetries || 2;
      if (currentRetryCount >= maxRetries) {
        if (config.requiresUserConfirmation !== false) {
          blockers.push(
            createBlocker(
              BLOCKER_CODES.BLOCKED_VALIDATION_FAILED.code,
              `Skeptic rejected the investigation after ${maxRetries} attempts. User confirmation required.`,
              ["skeptic_rejected"]
            )
          );
        }
      } else {
        backtrackCount["skeptic_rejected"] = currentRetryCount + 1;
      }
    }
    return {
      currentStage: "skeptic_ready",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      backtrackCount,
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "skeptic_review_error",
      agentId: "skeptic_agent",
      status: "error",
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "skeptic_ready",
      stageHistory: [state.currentStage],
      evidenceChain,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterSkeptic(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  const skepticReview = state.evidenceChain.find(
    (e) => e.eventType === "skeptic_review_complete"
  );
  if (skepticReview && skepticReview.payload) {
    const payload = skepticReview.payload;
    if (!payload.skepticApproved && payload.reviewStatus === "rejected") {
      const retryCount = state.backtrackCount["skeptic_rejected"] || 0;
      if (retryCount < 2) {
        return "fix_verification";
      }
    }
  }
  return "curator";
}
function buildCuratorSystemPrompt() {
  return `You are the Curator Agent, responsible for generating the final investigation report.
Your role is to synthesize all evidence into a clear, actionable report.

## Your Task
1. Review all evidence from the investigation
2. Summarize findings in a structured format
3. Document the root cause clearly
4. Provide actionable fix instructions
5. Include confidence assessment

## Report Structure
Generate a report with the following sections:
- **Title**: Concise problem description
- **Summary**: Executive summary of the issue
- **Root Cause**: Clear explanation of what caused the problem
- **Fix Description**: Step-by-step fix instructions
- **Evidence Summary**: Key evidence supporting the conclusion
- **Recommendations**: Additional suggestions
- **Confidence**: Overall confidence level (0-1)

## Output Format
Return the report as a JSON object matching the Report type structure.`;
}
function buildCuratorPrompt(state) {
  const allEvidence = state.evidenceChain.map((e) => `[${e.eventType}] ${e.agentId}: ${JSON.stringify(e.payload).substring(0, 500)}`).join("\n");
  const specialistBriefs = Object.entries(state.collectedBriefs).map(([agentId, brief]) => `### ${agentId}
${brief.substring(0, 2e3)}`).join("\n\n");
  const artifacts = state.artifacts.map((a) => `- ${a.type}: ${a.path} (by ${a.agentId})`).join("\n");
  const investigationResults = state.evidenceChain.filter((e) => e.eventType === "expert_investigation_complete").map((e) => JSON.stringify(e.payload, null, 2)).join("\n");
  const fixVerification = state.evidenceChain.filter((e) => e.eventType === "fix_verification_result").map((e) => JSON.stringify(e.payload, null, 2)).join("\n");
  const skepticReview = state.evidenceChain.filter((e) => e.eventType === "skeptic_review_complete").map((e) => JSON.stringify(e.payload, null, 2)).join("\n");
  return `
## Case Information
- Case ID: ${state.caseId}
- Run ID: ${state.runId}
- Session ID: ${state.sessionId}
- User Goal: ${state.userGoal}
- Fix Verified: ${state.fixVerified}

## All Evidence
${allEvidence}

## Specialist Briefs
${specialistBriefs}

## Artifacts Generated
${artifacts || "No artifacts"}

## Expert Investigation
${investigationResults}

## Fix Verification
${fixVerification}

## Skeptic Review
${skepticReview}

## Task
Generate a comprehensive final report based on all the evidence above.
Structure your response as a valid JSON object with these fields:
{
  "title": "string",
  "summary": "string",
  "rootCause": "string",
  "fixDescription": "string",
  "evidenceSummary": ["string"],
  "recommendations": ["string"],
  "confidence": number (0-1),
  "generatedAt": "ISO timestamp",
  "curatorAgentId": "curator_agent"
}`;
}
function parseReportFromResponse(content) {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title || "Investigation Report",
        summary: parsed.summary || "No summary provided",
        rootCause: parsed.rootCause || "Root cause not determined",
        fixDescription: parsed.fixDescription || "No fix provided",
        evidenceSummary: Array.isArray(parsed.evidenceSummary) ? parsed.evidenceSummary : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        generatedAt: nowIso(),
        curatorAgentId: "curator_agent"
      };
    }
  } catch {
  }
  return {
    title: "Investigation Report",
    summary: content.substring(0, 500),
    rootCause: "See summary for details",
    fixDescription: "See summary for details",
    evidenceSummary: [],
    recommendations: [],
    confidence: 0.5,
    generatedAt: nowIso(),
    curatorAgentId: "curator_agent"
  };
}
async function curatorNode(state, _config = {}) {
  const evidenceChain = [];
  const artifacts = [];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "curator_ready",
      "curator_agent"
    )
  );
  try {
    const modelConfig = DEFAULT_MODEL_ROUTING["curator_agent"];
    const request = {
      messages: [
        { role: "system", content: buildCuratorSystemPrompt() },
        { role: "user", content: buildCuratorPrompt(state) }
      ],
      model: modelConfig.model,
      maxTokens: 4096,
      temperature: 0.3
    };
    const response = await llmAdapter.chat(request, modelConfig.provider);
    const reportContent = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const finalReport = parseReportFromResponse(reportContent);
    const reportArtifact = createArtifact(
      "final_report",
      `reports/${state.runId}_final_report.json`,
      "curator_agent"
    );
    artifacts.push(reportArtifact);
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "curator_report_generated",
      agentId: "curator_agent",
      status: "ok",
      timestamp: Date.now(),
      payload: {
        reportTitle: finalReport.title,
        confidence: finalReport.confidence,
        evidenceCount: finalReport.evidenceSummary.length,
        recommendationCount: finalReport.recommendations.length,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    return {
      currentStage: "curator_ready",
      stageHistory: [state.currentStage],
      evidenceChain,
      artifacts: [...state.artifacts, ...artifacts],
      finalReport,
      lastUpdated: nowIso()
    };
  } catch (error) {
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "curator_report_error",
      agentId: "curator_agent",
      status: "error",
      timestamp: Date.now(),
      payload: {
        error: error instanceof Error ? error.message : String(error),
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
    const errorReport = {
      title: "Error Generating Report",
      summary: `Failed to generate report: ${error instanceof Error ? error.message : String(error)}`,
      rootCause: "Report generation failed",
      fixDescription: "Please retry or check system logs",
      evidenceSummary: [],
      recommendations: ["Retry report generation"],
      confidence: 0,
      generatedAt: nowIso(),
      curatorAgentId: "curator_agent"
    };
    return {
      currentStage: "curator_ready",
      stageHistory: [state.currentStage],
      evidenceChain,
      finalReport: errorReport,
      lastUpdated: nowIso()
    };
  }
}
function routeAfterCurator(state) {
  const hasCriticalBlocker = state.blockers.some(
    (b) => !b.resolvedAt && b.code.startsWith("BLOCKED_")
  );
  if (hasCriticalBlocker) {
    return "validation_blocked";
  }
  if (!state.finalReport) {
    return "curator";
  }
  return "finalize";
}
async function finalizeNode(state, _config = {}) {
  const evidenceChain = [];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "finalized",
      "rdc-debugger"
    )
  );
  const stageTransitionCount = state.evidenceChain.filter(
    (e) => e.eventType === "workflow_stage_transition"
  ).length;
  const specialistCount = Object.keys(state.activeSpecialists).length;
  const completedSpecialists = Object.values(state.activeSpecialists).filter(
    (s) => s.status === "completed"
  ).length;
  const artifactCount = state.artifacts.length;
  const totalEvidenceCount = state.evidenceChain.length + evidenceChain.length;
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "workflow_finalized",
    agentId: "rdc-debugger",
    status: "ok",
    timestamp: Date.now(),
    payload: {
      caseId: state.caseId,
      runId: state.runId,
      sessionId: state.sessionId,
      finalStage: "finalized",
      totalStages: stageTransitionCount,
      specialistCount,
      completedSpecialists,
      artifactCount,
      totalEvidenceCount,
      fixVerified: state.fixVerified,
      hasFinalReport: !!state.finalReport,
      finalReportConfidence: state.finalReport?.confidence || 0,
      startedAt: state.stageHistory[0] || state.currentStage,
      completedAt: nowIso(),
      duration: Date.now()
      // 简化处理，实际应该计算开始时间
    }
  });
  if (state.finalReport) {
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "final_report_summary",
      agentId: "curator_agent",
      status: "ok",
      timestamp: Date.now(),
      payload: {
        title: state.finalReport.title,
        summary: state.finalReport.summary.substring(0, 500),
        confidence: state.finalReport.confidence,
        evidenceCount: state.finalReport.evidenceSummary.length,
        recommendationCount: state.finalReport.recommendations.length,
        runId: state.runId,
        sessionId: state.sessionId
      }
    });
  }
  const evidenceTypes = new Set(state.evidenceChain.map((e) => e.eventType));
  const requiredEvidenceTypes = [
    "workflow_stage_transition",
    "specialist_dispatch_complete",
    "specialist_complete",
    "expert_investigation_complete",
    "fix_verification_result",
    "skeptic_review_complete",
    "curator_report_generated"
  ];
  const missingEvidenceTypes = requiredEvidenceTypes.filter(
    (type) => !evidenceTypes.has(type)
  );
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "evidence_chain_validation",
    agentId: "rdc-debugger",
    status: missingEvidenceTypes.length === 0 ? "ok" : "warning",
    timestamp: Date.now(),
    payload: {
      totalEvidenceEvents: totalEvidenceCount,
      uniqueEvidenceTypes: Array.from(evidenceTypes),
      missingEvidenceTypes,
      evidenceChainComplete: missingEvidenceTypes.length === 0,
      runId: state.runId,
      sessionId: state.sessionId
    }
  });
  return {
    currentStage: "finalized",
    stageHistory: [state.currentStage],
    evidenceChain,
    lastUpdated: nowIso()
  };
}
const SpecialistAnnotation = langgraph.Annotation.Root({
  agentRole: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "triage_agent"
  }),
  objective: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  context: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ({ caseId: "", runId: "", sessionId: "" })
  }),
  messages: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  toolCalls: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  iterationCount: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => 0
  }),
  brief: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  artifacts: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  status: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "running"
  }),
  error: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => void 0
  })
});
const MAX_ITERATIONS = 10;
function createSpecialistSubgraph(config) {
  const allTools = [
    ...config.rdcTools,
    ...config.systemTools,
    ...config.skillTools
  ];
  async function llmCallNode(state) {
    const agentConfig = config.agentConfigs[state.agentRole];
    if (!agentConfig) {
      return {
        status: "failed",
        error: `Agent config not found for ${state.agentRole}`
      };
    }
    let messages = state.messages;
    if (messages.length === 0) {
      messages = [
        { role: "system", content: agentConfig.systemPrompt },
        { role: "user", content: state.objective }
      ];
    }
    try {
      const request = {
        messages: messages.map((m) => ({
          role: m.role === "tool" ? "assistant" : m.role,
          content: m.content
        })),
        model: agentConfig.modelName,
        maxTokens: agentConfig.maxTokens || 4096,
        temperature: agentConfig.temperature ?? 0.7,
        tools: allTools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: {
            type: "object",
            properties: {}
          }
        }))
      };
      const response = await llmAdapter.chat(request, agentConfig.modelProvider);
      const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCalls = response.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        }));
        return {
          messages: [{ role: "assistant", content }, ...toolCalls.map((tc) => ({
            role: "assistant",
            content: `Tool call: ${tc.name}`
          }))],
          toolCalls,
          iterationCount: state.iterationCount + 1
        };
      }
      return {
        messages: [{ role: "assistant", content }],
        brief: content,
        status: "completed",
        iterationCount: state.iterationCount + 1
      };
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async function toolExecutionNode(state) {
    const results = [];
    const artifacts = [];
    for (const toolCall of state.toolCalls) {
      const tool = allTools.find((t) => t.name === toolCall.name);
      if (!tool) {
        results.push({
          role: "tool",
          content: JSON.stringify({ error: `Tool not found: ${toolCall.name}` }),
          tool_call_id: toolCall.id,
          name: toolCall.name
        });
        continue;
      }
      try {
        const result = await tool.invoke(toolCall.arguments);
        results.push({
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
          tool_call_id: toolCall.id,
          name: toolCall.name
        });
        if (typeof result === "string") {
          try {
            const parsed = JSON.parse(result);
            if (parsed.artifactPath) {
              artifacts.push(parsed.artifactPath);
            }
          } catch {
          }
        }
      } catch (error) {
        results.push({
          role: "tool",
          content: JSON.stringify({
            error: error instanceof Error ? error.message : String(error)
          }),
          tool_call_id: toolCall.id,
          name: toolCall.name
        });
      }
    }
    return {
      messages: results,
      artifacts: [...state.artifacts, ...artifacts],
      toolCalls: []
      // 清空已处理的工具调用
    };
  }
  function routeAfterLLMCall(state) {
    if (state.status === "failed") {
      return langgraph.END;
    }
    if (state.status === "completed") {
      return langgraph.END;
    }
    if (state.iterationCount >= MAX_ITERATIONS) {
      return "timeout";
    }
    if (state.toolCalls.length > 0) {
      return "tool_execution";
    }
    return "llm_call";
  }
  async function timeoutNode(state) {
    return {
      status: "timeout",
      error: `Max iterations (${MAX_ITERATIONS}) exceeded`,
      brief: state.brief || `Task timed out after ${MAX_ITERATIONS} iterations. Partial results may be available.`
    };
  }
  const graph = new langgraph.StateGraph(SpecialistAnnotation).addNode("llm_call", llmCallNode).addNode("tool_execution", toolExecutionNode).addNode("timeout", timeoutNode).addEdge(langgraph.START, "llm_call").addConditionalEdges("llm_call", routeAfterLLMCall, {
    tool_execution: "tool_execution",
    timeout: "timeout",
    [langgraph.END]: langgraph.END
  }).addEdge("tool_execution", "llm_call").addEdge("timeout", langgraph.END);
  return graph.compile();
}
const WorkflowAnnotation = langgraph.Annotation.Root({
  // 身份字段 - last-write-wins
  caseId: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  runId: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  sessionId: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  // 阶段字段 - last-write-wins
  currentStage: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "preflight_pending"
  }),
  stageHistory: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  // 用户输入 - last-write-wins
  userGoal: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  capturePaths: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  // RDC 上下文 - last-write-wins
  captureInfo: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => void 0
  }),
  replaySession: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => void 0
  }),
  // 证据链 - append reducer
  evidenceChain: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  // 工件 - append reducer
  artifacts: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  // Specialist 追踪 - merge reducer
  activeSpecialists: langgraph.Annotation({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({})
  }),
  pendingBriefs: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  collectedBriefs: langgraph.Annotation({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({})
  }),
  // 阻断/等待 - last-write-wins
  blockers: langgraph.Annotation({
    reducer: (a, b) => [...a, ...b],
    default: () => []
  }),
  interruptReason: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => void 0
  }),
  // 回转追踪 - merge reducer
  backtrackCount: langgraph.Annotation({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({})
  }),
  // 结果 - last-write-wins
  finalReport: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => void 0
  }),
  fixVerified: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => false
  }),
  // 元数据 - last-write-wins
  entryMode: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "cli"
  }),
  backend: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "local"
  }),
  orchestrationMode: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "multi_agent"
  }),
  coordinationMode: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "staged_handoff"
  }),
  lastUpdated: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => (/* @__PURE__ */ new Date()).toISOString()
  })
});
async function specialistExecNode(_state) {
  return {};
}
function validationBlockedNode(state) {
  const unresolvedBlockers = state.blockers.filter((b) => !b.resolvedAt);
  langgraph.interrupt({
    type: "validation_blocked",
    blockers: unresolvedBlockers,
    currentStage: state.currentStage,
    message: `Workflow blocked with ${unresolvedBlockers.length} unresolved blockers`
  });
  return {};
}
function awaitingUserInputNode(state) {
  langgraph.interrupt({
    type: "awaiting_user_input",
    reason: state.interruptReason || "User input required",
    currentStage: state.currentStage
  });
  return {};
}
function createWorkflowGraph(config = {}) {
  if (config.specialistConfig) {
    createSpecialistSubgraph(config.specialistConfig);
  }
  const preflightNodeWrapper = (state) => preflightNode(state);
  const intentGateNodeWrapper = (state) => intentGateNode(state);
  const entryGateNodeWrapper = (state) => entryGateNode(state);
  const intakeInitNodeWrapper = (state) => intakeInitNode(state);
  const intakeGateNodeWrapper = (state) => intakeGateNode(state);
  const specialistDispatchNodeWrapper = (state) => specialistDispatchNode(state);
  const specialistBriefsNodeWrapper = (state) => specialistBriefsNode(state);
  const expertInvestigationNodeWrapper = (state) => expertInvestigationNode(state);
  const fixVerificationNodeWrapper = (state) => fixVerificationNode(state);
  const skepticNodeWrapper = (state) => skepticNode(state);
  const curatorNodeWrapper = (state) => curatorNode(state);
  const finalizeNodeWrapper = (state) => finalizeNode(state);
  const graph = new langgraph.StateGraph(WorkflowAnnotation).addNode("preflight", preflightNodeWrapper).addNode("intent_gate", intentGateNodeWrapper).addNode("entry_gate", entryGateNodeWrapper).addNode("intake_init", intakeInitNodeWrapper).addNode("intake_gate", intakeGateNodeWrapper).addNode("specialist_dispatch", specialistDispatchNodeWrapper).addNode("specialist_briefs", specialistBriefsNodeWrapper).addNode("expert_investigation", expertInvestigationNodeWrapper).addNode("fix_verification", fixVerificationNodeWrapper).addNode("skeptic", skepticNodeWrapper).addNode("curator", curatorNodeWrapper).addNode("finalize", finalizeNodeWrapper).addNode("validation_blocked", validationBlockedNode).addNode("awaiting_user_input", awaitingUserInputNode).addNode("specialist_exec", specialistExecNode);
  graph.addEdge(langgraph.START, "preflight");
  graph.addConditionalEdges("preflight", (state) => {
    const route = routeAfterPreflight(state);
    return route === "validation_blocked" ? "validation_blocked" : "intent_gate";
  });
  graph.addConditionalEdges("intent_gate", (state) => {
    const route = routeAfterIntentGate(state);
    return route === "validation_blocked" ? "validation_blocked" : "entry_gate";
  });
  graph.addConditionalEdges("entry_gate", (state) => {
    const route = routeAfterEntryGate(state);
    return route === "validation_blocked" ? "validation_blocked" : "intake_init";
  });
  graph.addConditionalEdges("intake_init", (state) => {
    const route = routeAfterIntakeInit(state);
    return route === "validation_blocked" ? "validation_blocked" : "intake_gate";
  });
  graph.addConditionalEdges("intake_gate", (state) => {
    const route = routeAfterIntakeGate(state);
    return route === "validation_blocked" ? "validation_blocked" : "specialist_dispatch";
  });
  graph.addConditionalEdges("specialist_dispatch", (state) => {
    const sends = createSpecialistSends(state);
    return sends;
  });
  graph.addConditionalEdges("specialist_briefs", (state) => routeAfterSpecialistBriefs(state));
  graph.addConditionalEdges("expert_investigation", (state) => routeAfterExpertInvestigation(state));
  graph.addConditionalEdges("fix_verification", (state) => routeAfterFixVerification(state));
  graph.addConditionalEdges("skeptic", (state) => routeAfterSkeptic(state));
  graph.addConditionalEdges("curator", (state) => routeAfterCurator(state));
  graph.addConditionalEdges("validation_blocked", (state) => {
    const hasUnresolved = state.blockers.some((b) => !b.resolvedAt);
    return hasUnresolved ? langgraph.END : state.currentStage;
  });
  graph.addConditionalEdges("awaiting_user_input", (state) => {
    return state.interruptReason ? langgraph.END : state.currentStage;
  });
  graph.addEdge("specialist_exec", "specialist_briefs");
  graph.addEdge("finalize", langgraph.END);
  return graph.compile({
    checkpointer: config.checkpointer || new langgraph.MemorySaver()
  });
}
var LIMIT_REPLACE_NODE = "[...]";
var CIRCULAR_REPLACE_NODE = "[Circular]";
var arr = [];
var replacerStack = [];
function defaultOptions() {
  return {
    depthLimit: Number.MAX_SAFE_INTEGER,
    edgesLimit: Number.MAX_SAFE_INTEGER
  };
}
function stringify(obj, replacer, spacer, options) {
  if (typeof options === "undefined") options = defaultOptions();
  decirc(obj, "", 0, [], void 0, 0, options);
  var res;
  try {
    if (replacerStack.length === 0) res = JSON.stringify(obj, replacer, spacer);
    else res = JSON.stringify(obj, replaceGetterValues(replacer), spacer);
  } catch (_) {
    return JSON.stringify("[unable to serialize, circular reference is too complex to analyze]");
  } finally {
    while (arr.length !== 0) {
      var part = arr.pop();
      if (part.length === 4) Object.defineProperty(part[0], part[1], part[3]);
      else part[0][part[1]] = part[2];
    }
  }
  return res;
}
function setReplace(replace, val, k, parent) {
  var propertyDescriptor = Object.getOwnPropertyDescriptor(parent, k);
  if (propertyDescriptor.get !== void 0) if (propertyDescriptor.configurable) {
    Object.defineProperty(parent, k, { value: replace });
    arr.push([
      parent,
      k,
      val,
      propertyDescriptor
    ]);
  } else replacerStack.push([
    val,
    k,
    replace
  ]);
  else {
    parent[k] = replace;
    arr.push([
      parent,
      k,
      val
    ]);
  }
}
function decirc(val, k, edgeIndex, stack, parent, depth, options) {
  depth += 1;
  var i;
  if (typeof val === "object" && val !== null) {
    for (i = 0; i < stack.length; i++) if (stack[i] === val) {
      setReplace(CIRCULAR_REPLACE_NODE, val, k, parent);
      return;
    }
    if (typeof options.depthLimit !== "undefined" && depth > options.depthLimit) {
      setReplace(LIMIT_REPLACE_NODE, val, k, parent);
      return;
    }
    if (typeof options.edgesLimit !== "undefined" && edgeIndex + 1 > options.edgesLimit) {
      setReplace(LIMIT_REPLACE_NODE, val, k, parent);
      return;
    }
    stack.push(val);
    if (Array.isArray(val)) for (i = 0; i < val.length; i++) decirc(val[i], i, i, stack, val, depth, options);
    else {
      var keys = Object.keys(val);
      for (i = 0; i < keys.length; i++) {
        var key = keys[i];
        decirc(val[key], key, i, stack, val, depth, options);
      }
    }
    stack.pop();
  }
}
function replaceGetterValues(replacer) {
  replacer = typeof replacer !== "undefined" ? replacer : function(k, v) {
    return v;
  };
  return function(key, val) {
    if (replacerStack.length > 0) for (var i = 0; i < replacerStack.length; i++) {
      var part = replacerStack[i];
      if (part[1] === key && part[0] === val) {
        val = part[2];
        replacerStack.splice(i, 1);
        break;
      }
    }
    return replacer.call(this, key, val);
  };
}
function isLangChainSerializedObject(value) {
  return value !== null && value.lc === 1 && value.type === "constructor" && Array.isArray(value.id);
}
async function _reviver(value) {
  if (value && typeof value === "object") if (Array.isArray(value)) return await Promise.all(value.map((item) => _reviver(item)));
  else {
    const revivedObj = {};
    for (const [k, v] of Object.entries(value)) revivedObj[k] = await _reviver(v);
    if (revivedObj.lc === 2 && revivedObj.type === "undefined") return;
    else if (revivedObj.lc === 2 && revivedObj.type === "constructor" && Array.isArray(revivedObj.id)) try {
      const constructorName = revivedObj.id[revivedObj.id.length - 1];
      let constructor;
      switch (constructorName) {
        case "Set":
          constructor = Set;
          break;
        case "Map":
          constructor = Map;
          break;
        case "RegExp":
          constructor = RegExp;
          break;
        case "Error":
          constructor = Error;
          break;
        case "Uint8Array":
          constructor = Uint8Array;
          break;
        default:
          return revivedObj;
      }
      if (revivedObj.method) return constructor[revivedObj.method](...revivedObj.args || []);
      else return new constructor(...revivedObj.args || []);
    } catch (error) {
      return revivedObj;
    }
    else if (isLangChainSerializedObject(revivedObj)) return load.load(JSON.stringify(revivedObj));
    return revivedObj;
  }
  return value;
}
function _encodeConstructorArgs(constructor, method, args, kwargs) {
  return {
    lc: 2,
    type: "constructor",
    id: [constructor.name],
    method: method ?? null,
    args: args ?? [],
    kwargs: kwargs ?? {}
  };
}
function _default(obj) {
  if (obj === void 0) return {
    lc: 2,
    type: "undefined"
  };
  else if (obj instanceof Set || obj instanceof Map) return _encodeConstructorArgs(obj.constructor, void 0, [Array.from(obj)]);
  else if (obj instanceof RegExp) return _encodeConstructorArgs(RegExp, void 0, [obj.source, obj.flags]);
  else if (obj instanceof Error) return _encodeConstructorArgs(obj.constructor, void 0, [obj.message]);
  else if (obj?.lg_name === "Send") return {
    node: obj.node,
    args: obj.args
  };
  else if (obj instanceof Uint8Array) return _encodeConstructorArgs(Uint8Array, "from", [Array.from(obj)]);
  else return obj;
}
var JsonPlusSerializer = class {
  _dumps(obj) {
    return new TextEncoder().encode(stringify(obj, (_, value) => {
      return _default(value);
    }));
  }
  async dumpsTyped(obj) {
    if (obj instanceof Uint8Array) return ["bytes", obj];
    else return ["json", this._dumps(obj)];
  }
  async _loads(data) {
    return _reviver(JSON.parse(data));
  }
  async loadsTyped(type, data) {
    if (type === "bytes") return typeof data === "string" ? new TextEncoder().encode(data) : data;
    else if (type === "json") return this._loads(typeof data === "string" ? data : new TextDecoder().decode(data));
    else throw new Error(`Unknown serialization type: ${type}`);
  }
};
var BaseCheckpointSaver = class {
  serde = new JsonPlusSerializer();
  constructor(serde) {
    this.serde = serde || this.serde;
  }
  async get(config) {
    const value = await this.getTuple(config);
    return value ? value.checkpoint : void 0;
  }
  /**
  * Generate the next version ID for a channel.
  *
  * Default is to use integer versions, incrementing by 1. If you override, you can use str/int/float versions,
  * as long as they are monotonically increasing.
  */
  getNextVersion(current) {
    if (typeof current === "string") throw new Error("Please override this method to use string versions.");
    return current !== void 0 && typeof current === "number" ? current + 1 : 1;
  }
};
class FileCheckpointSaver extends BaseCheckpointSaver {
  basePath;
  constructor(workspacePath) {
    super();
    this.basePath = path__namespace.join(workspacePath, "checkpoints");
    this.ensureDir(this.basePath);
  }
  ensureDir(dirPath) {
    if (!fs__namespace.existsSync(dirPath)) {
      fs__namespace.mkdirSync(dirPath, { recursive: true });
    }
  }
  getThreadDir(threadId) {
    const dir = path__namespace.join(this.basePath, threadId);
    this.ensureDir(dir);
    return dir;
  }
  getCheckpointPath(threadId, checkpointNs, checkpointId) {
    const ns = checkpointNs || "__root__";
    const dir = path__namespace.join(this.getThreadDir(threadId), ns);
    this.ensureDir(dir);
    return path__namespace.join(dir, `${checkpointId}.json`);
  }
  getWritesPath(threadId, checkpointNs, checkpointId, taskId) {
    const ns = checkpointNs || "__root__";
    const dir = path__namespace.join(this.getThreadDir(threadId), ns, "writes");
    this.ensureDir(dir);
    return path__namespace.join(dir, `${checkpointId}_${taskId}.json`);
  }
  getIndexPath(threadId, checkpointNs) {
    const ns = checkpointNs || "__root__";
    const dir = path__namespace.join(this.getThreadDir(threadId), ns);
    this.ensureDir(dir);
    return path__namespace.join(dir, "index.json");
  }
  // 读取索引文件（维护检查点列表，按时间排序）
  readIndex(threadId, checkpointNs) {
    const indexPath = this.getIndexPath(threadId, checkpointNs);
    if (fs__namespace.existsSync(indexPath)) {
      try {
        return JSON.parse(fs__namespace.readFileSync(indexPath, "utf-8"));
      } catch {
        return [];
      }
    }
    return [];
  }
  writeIndex(threadId, checkpointNs, index) {
    const indexPath = this.getIndexPath(threadId, checkpointNs);
    fs__namespace.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }
  async getTuple(config) {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns || "";
    const checkpointId = config.configurable?.checkpoint_id;
    if (!threadId) return void 0;
    let targetId = checkpointId;
    if (!targetId) {
      const index = this.readIndex(threadId, checkpointNs);
      if (index.length === 0) return void 0;
      targetId = index[index.length - 1].checkpointId;
    }
    const filePath = this.getCheckpointPath(threadId, checkpointNs, targetId);
    if (!fs__namespace.existsSync(filePath)) return void 0;
    try {
      const data = JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
      const writesDir = path__namespace.join(this.getThreadDir(threadId), checkpointNs || "__root__", "writes");
      const pendingWrites = [];
      if (fs__namespace.existsSync(writesDir)) {
        const writeFiles = fs__namespace.readdirSync(writesDir).filter((f) => f.startsWith(`${targetId}_`));
        for (const wf of writeFiles) {
          try {
            const writes = JSON.parse(fs__namespace.readFileSync(path__namespace.join(writesDir, wf), "utf-8"));
            pendingWrites.push(...writes);
          } catch {
          }
        }
      }
      const resultConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: targetId
        }
      };
      const parentConfig = data.parentId ? {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: data.parentId
        }
      } : void 0;
      return {
        config: resultConfig,
        checkpoint: data.checkpoint,
        metadata: data.metadata,
        parentConfig,
        pendingWrites
      };
    } catch {
      return void 0;
    }
  }
  async put(config, checkpoint, metadata, newVersions) {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns || "";
    const checkpointId = checkpoint.id;
    const parentId = config.configurable?.checkpoint_id;
    const filePath = this.getCheckpointPath(threadId, checkpointNs, checkpointId);
    const data = {
      checkpoint,
      metadata,
      parentId,
      newVersions,
      savedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    const index = this.readIndex(threadId, checkpointNs);
    index.push({
      checkpointId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      parentId
    });
    this.writeIndex(threadId, checkpointNs, index);
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId
      }
    };
  }
  async putWrites(config, writes, taskId) {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns || "";
    const checkpointId = config.configurable?.checkpoint_id;
    if (!threadId || !checkpointId) return;
    const filePath = this.getWritesPath(threadId, checkpointNs, checkpointId, taskId);
    fs__namespace.writeFileSync(filePath, JSON.stringify(writes, null, 2), "utf-8");
  }
  async *list(config, options) {
    const threadId = config.configurable?.thread_id;
    const checkpointNs = config.configurable?.checkpoint_ns || "";
    if (!threadId) return;
    const index = this.readIndex(threadId, checkpointNs);
    const limit = options?.limit;
    const before = options?.before;
    let entries = [...index].reverse();
    if (before?.configurable?.checkpoint_id) {
      const beforeIdx = entries.findIndex(
        (e) => e.checkpointId === before.configurable.checkpoint_id
      );
      if (beforeIdx >= 0) {
        entries = entries.slice(beforeIdx + 1);
      }
    }
    if (limit) {
      entries = entries.slice(0, limit);
    }
    for (const entry of entries) {
      const tuple = await this.getTuple({
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: entry.checkpointId
        }
      });
      if (tuple) {
        yield tuple;
      }
    }
  }
  /**
   * 删除指定 thread 的所有检查点和写入数据
   * @param threadId 要删除的线程 ID
   */
  async deleteThread(threadId) {
    const threadDir = path__namespace.join(this.basePath, threadId);
    if (fs__namespace.existsSync(threadDir)) {
      fs__namespace.rmSync(threadDir, { recursive: true, force: true });
    }
  }
}
const RDC_TOOL_GROUPS = [
  "core",
  "capture",
  "event",
  "pipeline",
  "resource",
  "texture",
  "buffer",
  "shader",
  "shader_debug",
  "counters",
  "export",
  "diagnose",
  "macro",
  "snapshot",
  "mesh",
  "replay",
  "remote",
  "vfs"
];
class RDCToolAdapter {
  tools = /* @__PURE__ */ new Map();
  catalog = [];
  initialized = false;
  /**
   * 初始化：从 ToolBridge 加载 catalog 并转换为 LangGraph 工具
   */
  async initialize() {
    if (this.initialized) return;
    try {
      const catalogResult = await toolBridge.loadCatalog();
      if (catalogResult && Array.isArray(catalogResult.tools)) {
        this.catalog = catalogResult.tools;
      } else if (Array.isArray(catalogResult)) {
        this.catalog = catalogResult;
      }
      for (const toolDef of this.catalog) {
        const langchainTool = this.convertToStructuredTool(toolDef);
        this.tools.set(toolDef.name, langchainTool);
      }
      this.initialized = true;
    } catch (error) {
      console.error("[RDCToolAdapter] Failed to initialize:", error);
      throw error;
    }
  }
  /**
   * 将 ToolDefinition 转换为 DynamicStructuredTool
   */
  convertToStructuredTool(toolDef) {
    const schema = this.buildZodSchema(toolDef.parameters);
    return new tools.DynamicStructuredTool({
      name: toolDef.name.replace(/\./g, "_"),
      // LangGraph 工具名不允许点号
      description: toolDef.description || `RDC tool: ${toolDef.name}`,
      schema,
      func: async (args) => {
        const result = await this.call(toolDef.name, args);
        if (result.ok) {
          return JSON.stringify(result.data ?? { success: true });
        } else {
          return JSON.stringify({
            error: true,
            code: result.error?.code,
            message: result.error?.message
          });
        }
      },
      metadata: {
        layer: "rdc",
        originalName: toolDef.name,
        namespace: toolDef.namespace,
        group: toolDef.group
      }
    });
  }
  /**
   * 从 ToolParameter[] 构建 Zod schema
   */
  buildZodSchema(parameters) {
    const shape = {};
    if (!parameters || parameters.length === 0) {
      return zod.z.object({});
    }
    for (const param of parameters) {
      let zodType;
      switch (param.type) {
        case "string":
          zodType = zod.z.string().describe(param.description || param.name);
          break;
        case "number":
          zodType = zod.z.number().describe(param.description || param.name);
          break;
        case "boolean":
          zodType = zod.z.boolean().describe(param.description || param.name);
          break;
        case "array":
          zodType = zod.z.array(zod.z.unknown()).describe(param.description || param.name);
          break;
        case "object":
          zodType = zod.z.record(zod.z.string(), zod.z.unknown()).describe(param.description || param.name);
          break;
        default:
          zodType = zod.z.unknown().describe(param.description || param.name);
      }
      if (!param.required) {
        zodType = zodType.optional();
      }
      shape[param.name] = zodType;
    }
    return zod.z.object(shape);
  }
  /**
   * 调用 RDC 工具（委托给 ToolBridge）
   */
  async call(toolName, args) {
    return toolBridge.call({
      toolName,
      args
    });
  }
  /**
   * 获取所有 LangGraph 兼容的工具实例
   */
  getTools() {
    return Array.from(this.tools.values());
  }
  /**
   * 按功能组过滤工具
   */
  getToolsByGroup(group) {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.metadata?.group === group
    );
  }
  /**
   * 按命名空间过滤工具
   */
  getToolsByNamespace(namespace) {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.metadata?.namespace === namespace
    );
  }
  /**
   * 获取原始工具定义列表（用于 IPC tool:getCatalog）
   */
  getCatalog() {
    return this.catalog;
  }
  /**
   * 按名称获取单个工具（使用原始 rd.* 名称）
   */
  getToolByOriginalName(name) {
    return Array.from(this.tools.values()).find(
      (tool) => tool.metadata?.originalName === name
    );
  }
  /**
   * 获取特定 Agent 角色可用的工具集
   * 基于角色过滤相关工具组
   */
  getToolsForAgent(agentRole) {
    const roleToolGroups = {
      "triage_agent": ["core", "capture", "event", "pipeline", "diagnose"],
      "capture_repro_agent": ["capture", "replay", "event", "snapshot"],
      "pass_graph_pipeline_agent": ["pipeline", "event", "resource", "buffer"],
      "pixel_forensics_agent": ["texture", "shader_debug", "buffer", "mesh"],
      "shader_ir_agent": ["shader", "shader_debug", "pipeline"],
      "driver_device_agent": ["core", "diagnose", "counters", "remote"],
      "skeptic_agent": ["core", "capture", "diagnose", "snapshot"],
      "curator_agent": ["export", "snapshot", "diagnose"],
      "rdc-debugger": RDC_TOOL_GROUPS.slice()
    };
    const groups = roleToolGroups[agentRole] || [];
    return groups.flatMap((group) => this.getToolsByGroup(group));
  }
}
const rdcToolAdapter = new RDCToolAdapter();
let compiledGraph = null;
let checkpointSaver = null;
let currentSessionId = null;
let mainWindow$1 = null;
function initWorkflowGraph(workspacePath) {
  checkpointSaver = new FileCheckpointSaver(workspacePath);
  compiledGraph = createWorkflowGraph({ checkpointer: checkpointSaver });
}
function getThreadId() {
  return currentSessionId || "default-thread";
}
function ensureGraphInitialized() {
  if (!compiledGraph) {
    console.error("[IPC] WorkflowGraph not initialized");
    return false;
  }
  return true;
}
function notifyWorkflowStateChanged(graphState) {
  if (mainWindow$1 && !mainWindow$1.isDestroyed()) {
    const workflowState = projectToWorkflowState(graphState);
    mainWindow$1.webContents.send("workflow:stateChanged", workflowState);
    mainWindow$1.webContents.send("workflow:stageChanged", {
      stage: graphState.currentStage,
      blockers: graphState.blockers
    });
  }
}
function isInterrupted(result) {
  return result !== null && typeof result === "object" && "__interrupt__" in result && Array.isArray(result.__interrupt__);
}
function registerIPCHandlers() {
  storageAdapter.initializeWorkspace().catch(console.error);
  rdcToolAdapter.initialize().catch(console.error);
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
    if (!ensureGraphInitialized()) {
      return null;
    }
    try {
      const config = { configurable: { thread_id: getThreadId() } };
      const state = await compiledGraph.getState(config);
      if (state && state.values) {
        return projectToWorkflowState(state.values);
      }
      return null;
    } catch (error) {
      console.error("[IPC] Failed to get workflow state:", error);
      return null;
    }
  });
  electron.ipcMain.handle("workflow:start", async (_event, capturePaths, userGoal) => {
    try {
      if (!ensureGraphInitialized()) {
        return {
          success: false,
          error: "WorkflowGraph not initialized"
        };
      }
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
      currentSessionId = sessionId;
      const config = { configurable: { thread_id: sessionId } };
      const initialState = {
        caseId,
        runId,
        sessionId,
        userGoal,
        capturePaths,
        currentStage: "preflight_pending",
        stageHistory: [],
        evidenceChain: [],
        artifacts: [],
        activeSpecialists: {},
        pendingBriefs: [],
        collectedBriefs: {},
        blockers: [],
        backtrackCount: {},
        fixVerified: false,
        entryMode: "cli",
        backend: "local",
        orchestrationMode: "multi_agent",
        coordinationMode: "staged_handoff",
        lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
      };
      const result = await compiledGraph.invoke(initialState, config);
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        console.log("[IPC] Workflow interrupted:", interruptData);
        if (mainWindow$1 && !mainWindow$1.isDestroyed()) {
          mainWindow$1.webContents.send("workflow:blocked", {
            type: interruptData?.type || "unknown",
            data: interruptData
          });
        }
      } else {
        notifyWorkflowStateChanged(result);
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
    if (!ensureGraphInitialized()) {
      return {
        success: false,
        error: "WorkflowGraph not initialized"
      };
    }
    try {
      const config = { configurable: { thread_id: getThreadId() } };
      const result = await compiledGraph.invoke(
        new langgraph.Command({ resume: { action: "advance" } }),
        config
      );
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        return {
          success: false,
          currentStage: interruptData?.currentStage,
          error: `Workflow blocked: ${interruptData?.message || "Unknown reason"}`
        };
      }
      notifyWorkflowStateChanged(result);
      return {
        success: true,
        currentStage: result.currentStage
      };
    } catch (error) {
      console.error("[IPC] Failed to advance stage:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("workflow:backtrack", async (_event, reason, trigger) => {
    if (!ensureGraphInitialized()) {
      return {
        success: false,
        error: "WorkflowGraph not initialized"
      };
    }
    try {
      const config = { configurable: { thread_id: getThreadId() } };
      const result = await compiledGraph.invoke(
        new langgraph.Command({
          resume: {
            action: "backtrack",
            reason,
            trigger
          }
        }),
        config
      );
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        return {
          success: false,
          error: `Backtrack blocked: ${interruptData?.message || "Unknown reason"}`
        };
      }
      notifyWorkflowStateChanged(result);
      return {
        success: true
      };
    } catch (error) {
      console.error("[IPC] Failed to backtrack:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("workflow:dispatchSpecialist", async (_event, agentId, objective) => {
    if (!ensureGraphInitialized()) {
      return { success: false, error: "WorkflowGraph not initialized" };
    }
    try {
      const config = { configurable: { thread_id: getThreadId() } };
      const currentState = await compiledGraph.getState(config);
      if (!currentState || !currentState.values) {
        return { success: false, error: "No active workflow" };
      }
      const state = currentState.values;
      const result = await compiledGraph.invoke(
        new langgraph.Command({
          resume: {
            action: "dispatchSpecialist",
            agentId,
            objective
          }
        }),
        config
      );
      if (isInterrupted(result)) {
        const interruptData = result.__interrupt__[0];
        return {
          success: false,
          error: `Dispatch blocked: ${interruptData?.message || "Unknown reason"}`
        };
      }
      notifyWorkflowStateChanged(result);
      return agentOrchestrator.dispatchSpecialist(agentId, objective, {
        caseId: state.caseId,
        runId: state.runId,
        sessionId: state.sessionId
      });
    } catch (error) {
      console.error("[IPC] Failed to dispatch specialist:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("agent:sendMessage", async (_event, agentId, content) => {
    try {
      let context;
      if (compiledGraph && currentSessionId) {
        const config = { configurable: { thread_id: currentSessionId } };
        const state = await compiledGraph.getState(config);
        if (state && state.values) {
          const values = state.values;
          context = {
            caseId: values.caseId,
            runId: values.runId,
            sessionId: values.sessionId
          };
        }
      }
      const response = await agentOrchestrator.sendMessage(agentId, content, context);
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
    let runId = "";
    if (compiledGraph && currentSessionId) {
      const config = { configurable: { thread_id: currentSessionId } };
      const state = await compiledGraph.getState(config);
      if (state && state.values) {
        const values = state.values;
        runId = values.runId;
      }
    }
    return {
      sessionId,
      runId: runId || "",
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
  mainWindow$1 = window;
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
electron.app.whenReady().then(async () => {
  registerIPCHandlers();
  await initializeServices();
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
async function initializeServices() {
  try {
    const workspacePath = storageAdapter.getWorkspacePath();
    await rdcToolAdapter.initialize();
    console.log("[Main] RDCToolAdapter initialized");
    initWorkflowGraph(workspacePath);
    console.log("[Main] WorkflowGraph initialized");
  } catch (error) {
    console.error("[Main] Failed to initialize services:", error);
  }
}
function getMainWindow() {
  return mainWindow;
}
exports.getMainWindow = getMainWindow;
