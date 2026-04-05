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
const fs = require("fs");
const langgraph = require("@langchain/langgraph");
const child_process = require("child_process");
const uuid = require("uuid");
const yaml = require("yaml");
const Store = require("electron-store");
const tools = require("@langchain/core/tools");
const zod = require("zod");
const crypto = require("crypto");
const langgraphCheckpoint = require("@langchain/langgraph-checkpoint");
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
function generateId() {
  return uuid.v4();
}
function generateShortId() {
  return uuid.v4().replace(/-/g, "").slice(0, 12);
}
function generateEventId(prefix = "evt") {
  return `${prefix}-${generateShortId()}-${Date.now()}`;
}
function generateRunId() {
  const random = Math.random().toString(36).slice(2, 6);
  return `run_${random}`;
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
function nowIso$2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
class ToolBridge {
  toolsPath;
  catalog = null;
  activeProcesses = /* @__PURE__ */ new Map();
  traceListeners = /* @__PURE__ */ new Set();
  constructor() {
    this.toolsPath = this.resolveToolsPath();
  }
  resolveToolsPath() {
    const appPath = electron.app.getAppPath();
    const candidates = electron.app.isPackaged ? [
      path__namespace.join(process.resourcesPath, "tools")
    ] : [
      path__namespace.join(appPath, "resources", "tools"),
      path__namespace.join(appPath, "..", "resources", "tools"),
      path__namespace.join(appPath, "..", "..", "resources", "tools"),
      path__namespace.join(appPath, "..", "..", "..", "resources", "tools"),
      path__namespace.join(process.cwd(), "resources", "tools")
    ];
    for (const candidate of candidates) {
      const resolved = path__namespace.resolve(candidate);
      if (fs__namespace.existsSync(resolved)) {
        return resolved;
      }
    }
    return path__namespace.resolve(candidates[0]);
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
  resolveWindowsLauncher() {
    const toolsRoot = path__namespace.resolve(this.toolsPath);
    if (!fs__namespace.existsSync(toolsRoot)) {
      throw new Error(`RDX tools root not found: ${toolsRoot}`);
    }
    const launcherScriptPath = path__namespace.join(toolsRoot, "scripts", "rdx_bat_launcher.ps1");
    if (!fs__namespace.existsSync(launcherScriptPath)) {
      throw new Error(`RDX launcher script not found: ${launcherScriptPath}`);
    }
    const systemRoot = process.env.SystemRoot?.trim() || process.env.windir?.trim() || "C:\\Windows";
    const powershellPath = path__namespace.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (!fs__namespace.existsSync(powershellPath)) {
      throw new Error(`Windows PowerShell launcher not found: ${powershellPath}`);
    }
    return {
      powershellPath,
      launcherScriptPath,
      systemRoot,
      comSpec: process.env.ComSpec?.trim() || path__namespace.join(systemRoot, "System32", "cmd.exe")
    };
  }
  /**
   * 检查工具是否可用
   */
  isAvailable() {
    if (process.platform !== "win32") {
      return false;
    }
    try {
      const launcher = this.resolveWindowsLauncher();
      return fs__namespace.existsSync(launcher.launcherScriptPath);
    } catch {
      return false;
    }
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
      console.warn("[ToolBridge] Tool catalog not found, starting with empty RDC tool catalog: " + catalogPath);
      this.catalog = {
        schema_version: "1",
        tools: [],
        namespaces: {}
      };
      return this.catalog;
    }
    const content = await fs__namespace.promises.readFile(catalogPath, "utf-8");
    this.catalog = JSON.parse(content);
    return this.catalog;
  }
  /**
   * 执行CLI命令（参数数组模式，避免命令字符串注入风险）
   * command: 子命令名称，如 'call', 'daemon'
   * args: 子命令参数数组
   */
  async executeCLI(command, args = [], options = {}) {
    const startTime = nowMs();
    if (process.platform !== "win32") {
      return {
        exitCode: 2,
        stdout: "",
        stderr: "RDC-Agent currently supports the bundled Windows launcher only.",
        duration_ms: nowMs() - startTime
      };
    }
    let launcher;
    try {
      launcher = this.resolveWindowsLauncher();
    } catch (error) {
      return {
        exitCode: 2,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        duration_ms: nowMs() - startTime
      };
    }
    return new Promise((resolve, reject) => {
      const proc = child_process.spawn(
        launcher.powershellPath,
        [
          "-NoProfile",
          "-NoLogo",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          launcher.launcherScriptPath,
          "--non-interactive",
          "cli",
          command,
          ...args
        ],
        {
          cwd: options.cwd || this.toolsPath,
          env: {
            ...process.env,
            ...options.env,
            RDX_TOOLS_ROOT: this.toolsPath,
            PYTHONIOENCODING: "utf-8",
            SystemRoot: launcher.systemRoot,
            ComSpec: launcher.comSpec
          },
          windowsHide: true
        }
      );
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
        resolve({
          exitCode: 2,
          stdout,
          stderr: error instanceof Error ? error.message : String(error),
          duration_ms: nowMs() - startTime
        });
      });
    });
  }
  onToolTrace(listener) {
    this.traceListeners.add(listener);
    return () => {
      this.traceListeners.delete(listener);
    };
  }
  emitToolTrace(request, result) {
    const trace = {
      traceId: result.trace_id || generateEventId("tool-trace"),
      toolName: request.toolName,
      args: request.args,
      result,
      timestamp: nowMs(),
      contextId: request.contextId ?? "",
      runtimeOwner: request.runtimeOwner ?? "",
      ownerLeaseId: request.ownerLeaseId
    };
    for (const listener of this.traceListeners) {
      listener(trace);
    }
  }
  /**
   * 调用rd.*工具
   * 使用参数数组模式，避免命令字符串拼接注入风险
   */
  async call(request) {
    const startTime = nowMs();
    let response;
    try {
      const cliArgs = [request.toolName];
      if (request.args && Object.keys(request.args).length > 0) {
        cliArgs.push("--args-json", JSON.stringify(request.args));
      }
      if (request.contextId) {
        cliArgs.push("--context-id", request.contextId);
      }
      if (request.runtimeOwner) {
        cliArgs.push("--runtime-owner", request.runtimeOwner);
      }
      if (request.ownerLeaseId) {
        cliArgs.push("--owner-lease-id", request.ownerLeaseId);
      }
      const result = await this.executeCLI("call", cliArgs, {
        timeout: 6e4
        // 60秒超时
      });
      if (result.stdout.trim()) {
        let parsed = null;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          if (result.exitCode === 0) {
            response = {
              ok: true,
              data: { raw: result.stdout },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId("tool")
            };
            this.emitToolTrace(request, response);
            return response;
          }
        }
        if (parsed) {
          if (parsed.ok === false) {
            const errObj = parsed.error ?? {};
            response = {
              ok: false,
              data: null,
              artifacts: [],
              error: {
                code: errObj.code ?? "TOOL_ERROR",
                message: errObj.message ?? "Tool returned ok:false",
                category: errObj.category ?? "execution",
                details: errObj.details ?? void 0
              },
              duration_ms: nowMs() - startTime,
              trace_id: generateEventId("tool")
            };
            this.emitToolTrace(request, response);
            return response;
          }
          response = {
            ok: true,
            data: parsed.data ?? parsed,
            artifacts: parsed.artifacts,
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId("tool")
          };
          this.emitToolTrace(request, response);
          return response;
        }
      }
      response = {
        ok: false,
        data: null,
        artifacts: [],
        error: {
          code: "CLI_ERROR",
          message: result.stderr.trim() || `Exit code: ${result.exitCode}`,
          category: "execution",
          details: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode
          }
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId("tool")
      };
      this.emitToolTrace(request, response);
      return response;
    } catch (error) {
      response = {
        ok: false,
        data: null,
        artifacts: [],
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : String(error),
          category: "internal"
        },
        duration_ms: nowMs() - startTime,
        trace_id: generateEventId("tool")
      };
      this.emitToolTrace(request, response);
      return response;
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
const MAIN_STAGES = [
  "preflight",
  "entry_gate",
  "intake_gate",
  "plan",
  "speclist",
  "dispatch",
  "investigate",
  "fix_verify",
  "skepti",
  "curate",
  "finalize"
];
const SPECIAL_STAGES = [
  "blocked",
  "awaiting_user_input"
];
const ALL_STAGES = [...MAIN_STAGES, ...SPECIAL_STAGES];
const STAGE_PHASES = {
  preflight: "planner",
  entry_gate: "planner",
  intake_gate: "planner",
  plan: "planner",
  speclist: "planner",
  dispatch: "generator",
  investigate: "generator",
  fix_verify: "evaluator",
  skepti: "evaluator",
  curate: "evaluator",
  finalize: "evaluator",
  blocked: "evaluator",
  awaiting_user_input: "planner"
};
const LEGACY_STAGE_MIGRATION = {
  preflight_pending: "preflight",
  intent_gate_passed: "plan",
  entry_gate_passed: "entry_gate",
  accepted_intake_initialized: "intake_gate",
  intake_gate_passed: "intake_gate",
  waiting_for_specialist_brief: "dispatch",
  specialist_briefs_collected: "dispatch",
  expert_investigation_complete: "investigate",
  fix_verification_complete: "fix_verify",
  skeptic_ready: "skepti",
  curator_ready: "curate",
  finalized: "finalize",
  validation_blocked: "blocked"
};
const normalizeWorkflowStage = (stage) => {
  if (!stage) {
    return "preflight";
  }
  if (ALL_STAGES.includes(stage)) {
    return stage;
  }
  return LEGACY_STAGE_MIGRATION[stage] || "preflight";
};
const SETTINGS_FILE_NAME = "settings.json";
const LOG_FILE_NAME = "rdc-agent.log";
const sanitizePathSegment = (value) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
const normalizePath = (targetPath) => path.resolve(targetPath);
const isSamePath = (left, right) => {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
};
class AppPathService {
  workspaceRootCache = null;
  shouldSkipLegacyImport() {
    return process.env.RDC_AGENT_TEST_MODE === "1" || Boolean(process.env.RDC_AGENT_USER_DATA?.trim()) || Boolean(process.env.RDC_AGENT_WORKSPACE?.trim());
  }
  getUserDataRoot() {
    return normalizePath(process.env.RDC_AGENT_USER_DATA?.trim() || electron.app.getPath("userData"));
  }
  getBootstrapDir() {
    return this.getUserDataRoot();
  }
  getBootstrapPath() {
    return path.join(this.getBootstrapDir(), "workspace-bootstrap.json");
  }
  getLegacyBootstrapPath() {
    return path.join(electron.app.getPath("appData"), "RdcAgent", "workspace-bootstrap.json");
  }
  getDefaultWorkspaceRoot() {
    return normalizePath(process.env.RDC_AGENT_WORKSPACE?.trim() || path.join(this.getUserDataRoot(), "workspace"));
  }
  getWorkspaceRoot() {
    if (this.workspaceRootCache) {
      return this.workspaceRootCache;
    }
    const bootstrapState = this.readBootstrapState();
    const workspaceRoot = normalizePath(bootstrapState.workspaceRoot || this.getDefaultWorkspaceRoot());
    this.workspaceRootCache = workspaceRoot;
    return workspaceRoot;
  }
  getWorkspacePaths(workspaceRoot = this.getWorkspaceRoot()) {
    const root = normalizePath(workspaceRoot);
    const logsPath = path.join(root, "logs");
    return {
      workspaceRoot: root,
      defaultWorkspaceRoot: this.getDefaultWorkspaceRoot(),
      settingsPath: path.join(root, SETTINGS_FILE_NAME),
      logsPath,
      logPath: path.join(logsPath, LOG_FILE_NAME),
      projectsPath: path.join(root, "projects"),
      knowledgePath: path.join(root, "knowledge"),
      migrationOrphansPath: path.join(root, "migration-orphans"),
      profilesPath: path.join(root, "profiles"),
      policiesPath: path.join(root, "policies"),
      secretsPath: path.join(root, "secrets"),
      migrationReportsPath: path.join(root, "migration-reports")
    };
  }
  initializeWorkspaceRoot() {
    const bootstrapState = this.readBootstrapState();
    const workspaceRoot = normalizePath(bootstrapState.workspaceRoot || this.getDefaultWorkspaceRoot());
    const paths = this.getWorkspacePaths(workspaceRoot);
    this.ensureWorkspaceStructure(paths);
    if (!this.shouldSkipLegacyImport() && !bootstrapState.legacyMigrationCompleted && this.shouldImportLegacyData(paths.workspaceRoot)) {
      this.copyLegacyData(paths.workspaceRoot);
    }
    this.workspaceRootCache = paths.workspaceRoot;
    this.writeBootstrapState({
      workspaceRoot: paths.workspaceRoot,
      legacyMigrationCompleted: true
    });
    return paths;
  }
  setWorkspaceRoot(nextRoot) {
    const bootstrapState = this.readBootstrapState();
    const currentRoot = this.getWorkspaceRoot();
    const resolvedRoot = normalizePath(nextRoot || this.getDefaultWorkspaceRoot());
    const nextPaths = this.getWorkspacePaths(resolvedRoot);
    this.ensureWorkspaceStructure(nextPaths);
    if (!isSamePath(currentRoot, resolvedRoot)) {
      this.copyWorkspaceData(currentRoot, resolvedRoot);
    }
    if (!this.shouldSkipLegacyImport() && !bootstrapState.legacyMigrationCompleted && this.shouldImportLegacyData(resolvedRoot)) {
      this.copyLegacyData(resolvedRoot);
    }
    this.workspaceRootCache = resolvedRoot;
    this.writeBootstrapState({
      workspaceRoot: resolvedRoot,
      legacyMigrationCompleted: true
    });
    return nextPaths;
  }
  resetWorkspaceRoot() {
    return this.setWorkspaceRoot(this.getDefaultWorkspaceRoot());
  }
  getCapturePreviewDir(projectId) {
    const paths = this.getWorkspacePaths();
    return path.join(paths.logsPath, "capture-previews", sanitizePathSegment(projectId || "default"));
  }
  getCapturePreviewPath(projectId, inputId) {
    return path.join(
      this.getCapturePreviewDir(projectId),
      `${sanitizePathSegment(inputId || "capture")}-latest.png`
    );
  }
  readBootstrapState() {
    const candidates = this.shouldSkipLegacyImport() ? [this.getBootstrapPath()] : [this.getBootstrapPath(), this.getLegacyBootstrapPath()];
    for (const bootstrapPath of candidates) {
      try {
        if (!fs.existsSync(bootstrapPath)) {
          continue;
        }
        return JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
      } catch (error) {
        console.warn("[AppPathService] Failed to read bootstrap state:", error);
      }
    }
    return {};
  }
  writeBootstrapState(state) {
    const bootstrapPath = this.getBootstrapPath();
    fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
    fs.writeFileSync(bootstrapPath, JSON.stringify(state, null, 2), "utf8");
  }
  ensureWorkspaceStructure(paths) {
    fs.mkdirSync(paths.workspaceRoot, { recursive: true });
    fs.mkdirSync(paths.logsPath, { recursive: true });
    fs.mkdirSync(paths.projectsPath, { recursive: true });
    fs.mkdirSync(paths.knowledgePath, { recursive: true });
    fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
    fs.mkdirSync(paths.profilesPath, { recursive: true });
    fs.mkdirSync(paths.policiesPath, { recursive: true });
    fs.mkdirSync(paths.secretsPath, { recursive: true });
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
  }
  shouldImportLegacyData(targetRoot) {
    const paths = this.getWorkspacePaths(targetRoot);
    return !fs.existsSync(paths.settingsPath) && !this.hasDirectoryEntries(paths.projectsPath) && !this.hasDirectoryEntries(paths.knowledgePath) && !this.hasDirectoryEntries(paths.logsPath) && !this.hasDirectoryEntries(paths.migrationOrphansPath) && !this.hasDirectoryEntries(paths.profilesPath) && !this.hasDirectoryEntries(paths.policiesPath) && !this.hasDirectoryEntries(paths.secretsPath) && !this.hasDirectoryEntries(paths.migrationReportsPath);
  }
  hasDirectoryEntries(dirPath) {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return false;
    }
    return fs.readdirSync(dirPath).length > 0;
  }
  copyLegacyData(targetRoot) {
    const targetPaths = this.getWorkspacePaths(targetRoot);
    const legacyRoots = [
      electron.app.getPath("userData"),
      path.join(electron.app.getPath("appData"), "RdcAgent"),
      path.join(electron.app.getPath("appData"), "rdc-agent"),
      path.join(electron.app.getAppPath(), "workspace"),
      path.join(path.dirname(electron.app.getPath("exe")), "workspace")
    ];
    for (const legacyRoot of legacyRoots) {
      this.copyWorkspaceData(legacyRoot, targetRoot);
    }
    this.copyLogFile(path.join(electron.app.getAppPath(), "dev-stdout.log"), targetPaths.logPath);
  }
  copyWorkspaceData(sourceRoot, targetRoot) {
    if (!sourceRoot || !fs.existsSync(sourceRoot) || isSamePath(sourceRoot, targetRoot)) {
      return;
    }
    const targetPaths = this.getWorkspacePaths(targetRoot);
    this.copyFileIfMissing(path.join(sourceRoot, SETTINGS_FILE_NAME), targetPaths.settingsPath);
    this.copyDirContents(path.join(sourceRoot, "projects"), targetPaths.projectsPath);
    this.copyDirContents(path.join(sourceRoot, "knowledge"), targetPaths.knowledgePath);
    this.copyDirContents(path.join(sourceRoot, "migration-orphans"), targetPaths.migrationOrphansPath);
    this.copyDirContents(path.join(sourceRoot, "profiles"), targetPaths.profilesPath);
    this.copyDirContents(path.join(sourceRoot, "policies"), targetPaths.policiesPath);
    this.copyDirContents(path.join(sourceRoot, "secrets"), targetPaths.secretsPath);
    this.copyDirContents(path.join(sourceRoot, "migration-reports"), targetPaths.migrationReportsPath);
    this.copyDirContents(path.join(sourceRoot, "logs"), targetPaths.logsPath);
    this.copyLogFile(path.join(sourceRoot, LOG_FILE_NAME), targetPaths.logPath);
    this.copyLogFile(path.join(sourceRoot, "dev-stdout.log"), targetPaths.logPath);
  }
  copyDirContents(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirContents(sourcePath, targetPath);
        continue;
      }
      this.copyFileIfMissing(sourcePath, targetPath);
    }
  }
  copyLogFile(sourcePath, targetPath) {
    this.copyFileIfMissing(sourcePath, targetPath);
  }
  copyFileIfMissing(sourcePath, targetPath) {
    if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
      return;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}
const appPathService = new AppPathService();
class StorageAdapter {
  dataRootPath = "";
  projectsRootPath = "";
  globalKnowledgePath = "";
  migrationOrphansPath = "";
  registryPath = "";
  selectionPath = "";
  constructor() {
    this.syncWorkspacePaths();
  }
  getWorkspacePath() {
    this.syncWorkspacePaths();
    return this.dataRootPath;
  }
  getGlobalKnowledgePath() {
    this.syncWorkspacePaths();
    return this.globalKnowledgePath;
  }
  async initializeWorkspace() {
    this.syncWorkspacePaths();
    this.ensureDir(this.dataRootPath);
    this.ensureDir(this.projectsRootPath);
    this.ensureDir(this.migrationOrphansPath);
    this.ensureRegistry();
    this.ensureSelection();
    this.bootstrapGlobalKnowledge();
    this.migrateLegacyWorkspace();
  }
  setWorkspaceRoot(workspaceRoot) {
    appPathService.setWorkspaceRoot(workspaceRoot);
    this.syncWorkspacePaths();
  }
  listProjects() {
    return this.readRegistry().projects.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  createProject(rootPath) {
    const normalizedRootPath = path__namespace.resolve(rootPath);
    if (!fs__namespace.existsSync(normalizedRootPath) || !fs__namespace.statSync(normalizedRootPath).isDirectory()) {
      throw new Error(`Project root is not a directory: ${normalizedRootPath}`);
    }
    const registry = this.readRegistry();
    const existing = registry.projects.find((project2) => project2.rootPath === normalizedRootPath);
    if (existing) {
      this.setCurrentProjectId(existing.projectId);
      return existing;
    }
    const projectName = path__namespace.basename(normalizedRootPath) || normalizedRootPath;
    const slug = this.createUniqueProjectSlug(projectName, registry.projects);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(normalizedRootPath);
    const inputs = this.collectProjectInputs(inputsPath);
    const timestamp = nowMs();
    const project = {
      projectId: `proj_${generateShortId()}`,
      name: projectName,
      rootPath: normalizedRootPath,
      slug,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    registry.projects.push(project);
    this.writeRegistry(registry);
    this.ensureDir(this.getProjectDataPath(project));
    this.ensureDir(this.getProjectSessionsRoot(project));
    this.writeProjectMetadata(project);
    this.setCurrentProjectId(project.projectId);
    return project;
  }
  removeProject(projectId) {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) return;
    registry.projects = registry.projects.filter((project) => project.projectId !== projectId);
    this.writeRegistry(registry);
    const projectPath = this.getProjectDataPath(target);
    if (fs__namespace.existsSync(projectPath)) {
      fs__namespace.rmSync(projectPath, { recursive: true, force: true });
    }
    const selection = this.readSelection();
    if (selection.projectId === projectId) {
      selection.projectId = null;
      selection.sessionId = null;
      this.writeSelection(selection);
    }
  }
  getProjectById(projectId) {
    return this.readRegistry().projects.find((project) => project.projectId === projectId) || null;
  }
  listProjectInputs(projectId) {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    return this.refreshProjectInputs(projectId);
  }
  refreshProjectInputs(projectId) {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    const normalizedProject = this.normalizeProjectRecord(project);
    const inputs = this.collectProjectInputs(normalizedProject.inputsPath);
    const nextProject = {
      ...normalizedProject,
      inputs,
      inputsUpdatedAt: nowMs()
    };
    this.persistProject(nextProject);
    return nextProject.inputs;
  }
  importProjectInputs(projectId, filePaths) {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const normalizedProject = this.normalizeProjectRecord(project);
    this.ensureDir(normalizedProject.inputsPath);
    for (const filePath of filePaths) {
      const sourcePath = path__namespace.resolve(filePath);
      if (!fs__namespace.existsSync(sourcePath) || !fs__namespace.statSync(sourcePath).isFile()) {
        continue;
      }
      if (path__namespace.extname(sourcePath).toLowerCase() !== ".rdc") {
        continue;
      }
      const targetPath = this.resolveImportedInputPath(normalizedProject.inputsPath, path__namespace.basename(sourcePath));
      fs__namespace.copyFileSync(sourcePath, targetPath);
    }
    return this.refreshProjectInputs(projectId);
  }
  listSessions(projectId) {
    const project = this.getProjectById(projectId);
    if (!project) return [];
    const sessionsRoot = this.getProjectSessionsRoot(project);
    if (!fs__namespace.existsSync(sessionsRoot)) {
      return [];
    }
    return fs__namespace.readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => this.readJson(path__namespace.join(sessionsRoot, entry.name, "session.json"))).filter((session) => session !== null).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  createSession(projectId, title, goal = "") {
    const project = this.getProjectById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const timestamp = nowMs();
    const session = {
      sessionId: `sess_${generateShortId()}`,
      projectId,
      title: this.normalizeSessionTitle(title),
      goal,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const sessionPath = path__namespace.join(this.getProjectSessionsRoot(project), session.sessionId);
    this.ensureDir(sessionPath);
    this.ensureDir(path__namespace.join(sessionPath, "timeline"));
    this.ensureDir(path__namespace.join(sessionPath, "runs"));
    this.writeJson(path__namespace.join(sessionPath, "session.json"), session);
    this.touchProject(project.projectId, session.sessionId, timestamp);
    this.setCurrentProjectId(projectId);
    this.setCurrentSessionId(session.sessionId);
    return session;
  }
  readSession(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    return this.readJson(path__namespace.join(location.sessionPath, "session.json"));
  }
  updateSession(sessionId, patch) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const existing = this.readJson(path__namespace.join(location.sessionPath, "session.json"));
    if (!existing) return null;
    const nextSession = {
      ...existing,
      ...patch,
      sessionId: existing.sessionId,
      projectId: existing.projectId,
      updatedAt: nowMs()
    };
    this.writeJson(path__namespace.join(location.sessionPath, "session.json"), nextSession);
    this.touchProject(existing.projectId, nextSession.sessionId, nextSession.updatedAt);
    return nextSession;
  }
  listRuns(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return [];
    const runsRoot = path__namespace.join(location.sessionPath, "runs");
    if (!fs__namespace.existsSync(runsRoot)) {
      return [];
    }
    return fs__namespace.readdirSync(runsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => this.readPersistedRun(sessionId, entry.name)).filter((run) => run !== null).sort((a, b) => b.startedAt - a.startedAt).map((run) => this.toRunSummary(run));
  }
  getLatestRun(sessionId) {
    return this.listRuns(sessionId)[0] ?? null;
  }
  getCasePath(caseId) {
    const location = this.findSessionLocation(caseId);
    if (!location) {
      throw new Error(`Session not found for case lookup: ${caseId}`);
    }
    return location.sessionPath;
  }
  getRunPath(caseId, runId) {
    const location = this.findSessionLocation(caseId);
    if (!location) {
      throw new Error(`Session not found for run lookup: ${caseId}`);
    }
    return path__namespace.join(location.sessionPath, "runs", runId);
  }
  async createCase(input) {
    const projectId = input.projectId || this.getCurrentProjectId();
    if (!projectId) {
      throw new Error("Project is required before creating a session.");
    }
    if (input.caseId) {
      const existingSession = this.readSession(input.caseId);
      if (existingSession) {
        return existingSession.sessionId;
      }
    }
    const session = this.createSession(
      projectId,
      input.userGoal || input.symptomSummary,
      input.userGoal || input.symptomSummary
    );
    return session.sessionId;
  }
  async readCase(caseId) {
    const session = this.readSession(caseId);
    if (!session) return null;
    return {
      case_id: session.sessionId,
      project_id: session.projectId,
      title: session.title,
      user_goal: session.goal,
      current_run: session.lastRunId ?? null,
      created_at: new Date(session.createdAt).toISOString(),
      updated_at: new Date(session.updatedAt).toISOString()
    };
  }
  async updateCase(caseId, data) {
    const title = typeof data.title === "string" ? data.title : typeof data.symptom_summary === "string" ? data.symptom_summary : void 0;
    const goal = typeof data.user_goal === "string" ? data.user_goal : void 0;
    const lastRunId = typeof data.current_run === "string" ? data.current_run : void 0;
    this.updateSession(caseId, {
      title,
      goal,
      lastRunId
    });
  }
  async createRun(input) {
    const sessionId = input.sessionId || input.caseId;
    const session = this.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const runId = input.runId || generateRunId();
    const runPath = this.getRunPath(sessionId, runId);
    this.ensureDir(runPath);
    this.ensureDir(path__namespace.join(runPath, "artifacts"));
    this.ensureDir(path__namespace.join(runPath, "notes"));
    this.ensureDir(path__namespace.join(runPath, "reports"));
    this.ensureDir(path__namespace.join(runPath, "logs"));
    this.ensureDir(path__namespace.join(runPath, "screenshots"));
    this.ensureDir(path__namespace.join(runPath, "checkpoints"));
    const captures = input.captures && input.captures.length > 0 ? input.captures : input.capturePaths.map((filePath, index) => ({
      id: `cap-${index}`,
      filePath,
      role: index === 0 ? "primary" : "reference",
      backendHint: "local",
      status: "pending"
    }));
    const backend = input.backend || (captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local");
    const startedAt = nowMs();
    const persistedRun = {
      runId,
      projectId: session.projectId,
      sessionId,
      caseId: sessionId,
      mode: input.mode || "debugger",
      goal: input.goal || session.goal,
      captures,
      startedAt,
      status: "running",
      lastStage: "preflight",
      backend,
      createdAt: startedAt,
      updatedAt: startedAt,
      runtime: {
        backend,
        entry_mode: "cli",
        context_id: null,
        runtime_owner: null,
        session_id: sessionId,
        workflow_stage: "preflight"
      }
    };
    this.writeRunFiles(persistedRun);
    writeYaml(path__namespace.join(runPath, "capture_refs.yaml"), {
      captures: captures.map((capture, index) => ({
        capture_id: capture.id || `cap-${index}`,
        capture_role: capture.role,
        source_path: capture.filePath
      }))
    });
    writeYaml(path__namespace.join(runPath, "notes", "hypothesis_board.yaml"), {
      hypothesis_board: {
        session_id: sessionId,
        entry_skill: "rdc-debugger",
        user_goal: persistedRun.goal,
        intake_state: "handoff_ready",
        current_phase: "intake",
        current_task: "",
        active_owner: "rdc-debugger",
        pending_requirements: [],
        blocking_issues: [],
        progress_summary: ["accepted intake complete"],
        next_actions: ["run dispatch_readiness before specialist dispatch"],
        last_updated: nowIso$2(),
        hypotheses: []
      }
    });
    this.updateSession(sessionId, {
      goal: persistedRun.goal,
      lastRunId: runId
    });
    this.touchProject(session.projectId, sessionId);
    this.setCurrentProjectId(session.projectId);
    this.setCurrentSessionId(sessionId);
    return { runId, sessionId };
  }
  async readRun(caseId, runId) {
    const run = this.readPersistedRun(caseId, runId);
    return run ? run : null;
  }
  async updateRun(caseId, runId, data) {
    const existing = this.readPersistedRun(caseId, runId);
    if (!existing) {
      return;
    }
    const merged = this.deepMerge(
      existing,
      data
    );
    const workflowStage = merged.runtime?.workflow_stage || existing.runtime.workflow_stage;
    merged.runtime = {
      ...existing.runtime,
      ...merged.runtime || {},
      workflow_stage: workflowStage
    };
    merged.lastStage = workflowStage;
    merged.updatedAt = nowMs();
    if (workflowStage === "finalize" && merged.status === "running") {
      merged.status = "completed";
      merged.finishedAt = merged.finishedAt || merged.updatedAt;
    }
    this.writeRunFiles(merged);
    this.updateSession(caseId, {
      lastRunId: runId
    });
  }
  async writeArtifact(caseId, runId, artifactName, data) {
    const artifactPath = path__namespace.join(this.getRunPath(caseId, runId), "artifacts", artifactName);
    writeYaml(artifactPath, data);
    return artifactPath;
  }
  async readArtifact(caseId, runId, artifactName) {
    const artifactPath = path__namespace.join(this.getRunPath(caseId, runId), "artifacts", artifactName);
    return readYaml(artifactPath);
  }
  getActionChainPath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for action chain: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "timeline", "action_chain.jsonl");
  }
  async appendActionEvent(sessionId, event) {
    appendJsonl(this.getActionChainPath(sessionId), event);
    this.updateSession(sessionId, {});
  }
  async readActionChain(sessionId) {
    const actionChainPath = this.getActionChainPath(sessionId);
    return readJsonl(actionChainPath);
  }
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
  async getWorkflowState(caseId, runId) {
    const run = this.readPersistedRun(caseId, runId);
    if (!run) return null;
    return {
      caseId,
      runId,
      sessionId: run.sessionId,
      currentStage: run.runtime.workflow_stage,
      previousStages: [],
      entryMode: run.runtime.entry_mode,
      backend: run.runtime.backend,
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers: [],
      lastUpdated: new Date(run.updatedAt).toISOString()
    };
  }
  async updateWorkflowStage(caseId, runId, stage, blockers = []) {
    const run = this.readPersistedRun(caseId, runId);
    if (!run) return;
    run.runtime.workflow_stage = stage;
    run.lastStage = stage;
    run.updatedAt = nowMs();
    if (stage === "finalize") {
      run.status = "completed";
      run.finishedAt = run.finishedAt || run.updatedAt;
    }
    this.writeRunFiles(run);
    if (blockers.length > 0) {
      const boardPath = path__namespace.join(this.getRunPath(caseId, runId), "notes", "hypothesis_board.yaml");
      const board = readYaml(boardPath) || {};
      const hypothesisBoard = board.hypothesis_board || {};
      hypothesisBoard.blocking_issues = blockers;
      hypothesisBoard.last_updated = nowIso$2();
      board.hypothesis_board = hypothesisBoard;
      writeYaml(boardPath, board);
    }
  }
  getCurrentProjectId() {
    return this.readSelection().projectId;
  }
  setCurrentProjectId(projectId) {
    const selection = this.readSelection();
    selection.projectId = projectId;
    if (!projectId) {
      selection.sessionId = null;
    }
    this.writeSelection(selection);
  }
  async getCurrentSessionId() {
    return this.readSelection().sessionId;
  }
  async setCurrentSessionId(sessionId) {
    const selection = this.readSelection();
    selection.sessionId = sessionId;
    if (sessionId) {
      const session = this.readSession(sessionId);
      if (session) {
        selection.projectId = session.projectId;
      }
    }
    this.writeSelection(selection);
  }
  bootstrapGlobalKnowledge() {
    this.syncWorkspacePaths();
    this.ensureDir(this.globalKnowledgePath);
    this.ensureDir(path__namespace.join(this.globalKnowledgePath, "library"));
    this.ensureDir(path__namespace.join(this.globalKnowledgePath, "spec"));
    const seededMarker = path__namespace.join(this.globalKnowledgePath, ".seeded");
    if (fs__namespace.existsSync(seededMarker)) {
      return;
    }
    const seedPath = path__namespace.join(electron.app.getAppPath(), "resources", "knowledge", "seed");
    if (fs__namespace.existsSync(seedPath)) {
      this.copyDirectoryContents(seedPath, this.globalKnowledgePath, false);
    }
    fs__namespace.writeFileSync(seededMarker, nowIso$2(), "utf-8");
  }
  migrateLegacyWorkspace() {
    for (const legacyRoot of this.getLegacyWorkspacePaths()) {
      if (!legacyRoot || !fs__namespace.existsSync(legacyRoot) || legacyRoot === this.dataRootPath) {
        continue;
      }
      const legacyKnowledge = path__namespace.join(legacyRoot, "common", "knowledge");
      if (fs__namespace.existsSync(legacyKnowledge)) {
        this.copyDirectoryContents(legacyKnowledge, this.globalKnowledgePath, false);
      }
      const legacyCases = path__namespace.join(legacyRoot, "cases");
      if (fs__namespace.existsSync(legacyCases)) {
        this.copyDirectoryContents(legacyCases, path__namespace.join(this.migrationOrphansPath, "cases"), false);
      }
      const legacyCheckpoints = path__namespace.join(legacyRoot, "checkpoints");
      if (fs__namespace.existsSync(legacyCheckpoints)) {
        this.copyDirectoryContents(legacyCheckpoints, path__namespace.join(this.migrationOrphansPath, "checkpoints"), false);
      }
      const legacyCommon = path__namespace.join(legacyRoot, "common");
      if (fs__namespace.existsSync(legacyCommon)) {
        const configPath = path__namespace.join(legacyCommon, "config");
        const skillsPath = path__namespace.join(legacyCommon, "skills");
        if (fs__namespace.existsSync(configPath)) {
          this.copyDirectoryContents(configPath, path__namespace.join(this.migrationOrphansPath, "common", "config"), false);
        }
        if (fs__namespace.existsSync(skillsPath)) {
          this.copyDirectoryContents(skillsPath, path__namespace.join(this.migrationOrphansPath, "common", "skills"), false);
        }
      }
      fs__namespace.rmSync(legacyRoot, { recursive: true, force: true });
    }
  }
  getLegacyWorkspacePaths() {
    const devWorkspace = path__namespace.join(electron.app.getAppPath(), "workspace");
    const packagedWorkspace = path__namespace.join(path__namespace.dirname(electron.app.getPath("exe")), "workspace");
    return [.../* @__PURE__ */ new Set([devWorkspace, packagedWorkspace])];
  }
  syncWorkspacePaths() {
    const paths = appPathService.getWorkspacePaths();
    this.dataRootPath = paths.workspaceRoot;
    this.projectsRootPath = paths.projectsPath;
    this.globalKnowledgePath = paths.knowledgePath;
    this.migrationOrphansPath = paths.migrationOrphansPath;
    this.registryPath = path__namespace.join(this.projectsRootPath, "registry.json");
    this.selectionPath = path__namespace.join(this.projectsRootPath, "selection.json");
  }
  ensureRegistry() {
    if (fs__namespace.existsSync(this.registryPath)) {
      return;
    }
    this.writeJson(this.registryPath, {
      schemaVersion: "1",
      projects: []
    });
  }
  ensureSelection() {
    if (fs__namespace.existsSync(this.selectionPath)) {
      return;
    }
    this.writeJson(this.selectionPath, {
      projectId: null,
      sessionId: null
    });
  }
  readRegistry() {
    const registry = this.readJson(this.registryPath) || {
      schemaVersion: "1",
      projects: []
    };
    const normalizedProjects = registry.projects.map((project) => this.normalizeProjectRecord(project));
    const changed = JSON.stringify(normalizedProjects) !== JSON.stringify(registry.projects);
    if (changed) {
      registry.projects = normalizedProjects;
      this.writeRegistry(registry);
    } else {
      registry.projects = normalizedProjects;
    }
    return registry;
  }
  writeRegistry(registry) {
    this.writeJson(this.registryPath, registry);
  }
  readSelection() {
    return this.readJson(this.selectionPath) || {
      projectId: null,
      sessionId: null
    };
  }
  writeSelection(selection) {
    this.writeJson(this.selectionPath, selection);
  }
  writeProjectMetadata(project) {
    const normalizedProject = this.normalizeProjectRecord(project);
    this.ensureDir(this.getProjectDataPath(normalizedProject));
    this.writeJson(path__namespace.join(this.getProjectDataPath(normalizedProject), "project.json"), normalizedProject);
  }
  writeRunFiles(run) {
    const runPath = this.getRunPath(run.sessionId, run.runId);
    this.ensureDir(runPath);
    this.writeJson(path__namespace.join(runPath, "run.json"), run);
    writeYaml(path__namespace.join(runPath, "run.yaml"), {
      run_id: run.runId,
      session_id: run.sessionId,
      case_id: run.caseId,
      project_id: run.projectId,
      created_at: new Date(run.createdAt).toISOString(),
      updated_at: new Date(run.updatedAt).toISOString(),
      mode: run.mode,
      goal: run.goal,
      status: run.status,
      last_stage: run.lastStage,
      coordination_mode: "staged_handoff",
      orchestration_mode: "multi_agent",
      runtime: run.runtime,
      captures: run.captures
    });
  }
  touchProject(projectId, lastSessionId, updatedAt = nowMs()) {
    const registry = this.readRegistry();
    const nextProjects = registry.projects.map((project2) => {
      if (project2.projectId !== projectId) return project2;
      return {
        ...project2,
        updatedAt,
        lastSessionId: lastSessionId || project2.lastSessionId
      };
    });
    registry.projects = nextProjects;
    this.writeRegistry(registry);
    const project = registry.projects.find((item) => item.projectId === projectId);
    if (project) {
      this.writeProjectMetadata(project);
    }
  }
  getProjectDataPath(project) {
    const target = typeof project === "string" ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path__namespace.join(this.projectsRootPath, target.slug);
  }
  getProjectSessionsRoot(project) {
    return path__namespace.join(this.getProjectDataPath(project), "sessions");
  }
  findSessionLocation(sessionId) {
    for (const project of this.listProjects()) {
      const sessionPath = path__namespace.join(this.getProjectSessionsRoot(project), sessionId);
      if (fs__namespace.existsSync(path__namespace.join(sessionPath, "session.json"))) {
        return { project, sessionPath };
      }
    }
    return null;
  }
  readPersistedRun(sessionId, runId) {
    const runJsonPath = path__namespace.join(this.getRunPath(sessionId, runId), "run.json");
    const runJson = this.readJson(runJsonPath);
    if (runJson) {
      runJson.lastStage = normalizeWorkflowStage(runJson.lastStage);
      runJson.runtime.workflow_stage = normalizeWorkflowStage(runJson.runtime.workflow_stage);
      return runJson;
    }
    const runYaml = readYaml(path__namespace.join(this.getRunPath(sessionId, runId), "run.yaml"));
    if (!runYaml) {
      return null;
    }
    return {
      runId,
      projectId: String(runYaml.project_id || ""),
      sessionId,
      caseId: String(runYaml.case_id || sessionId),
      mode: runYaml.mode || "debugger",
      goal: String(runYaml.goal || ""),
      captures: runYaml.captures || [],
      startedAt: Date.parse(String(runYaml.created_at || nowIso$2())),
      finishedAt: runYaml.finished_at ? Date.parse(String(runYaml.finished_at)) : void 0,
      status: runYaml.status || "running",
      lastStage: normalizeWorkflowStage(String(runYaml.last_stage || "preflight")),
      backend: runYaml.runtime?.backend || "local",
      createdAt: Date.parse(String(runYaml.created_at || nowIso$2())),
      updatedAt: Date.parse(String(runYaml.updated_at || runYaml.created_at || nowIso$2())),
      runtime: {
        backend: runYaml.runtime?.backend || "local",
        entry_mode: runYaml.runtime?.entry_mode || "cli",
        context_id: runYaml.runtime?.context_id || null,
        runtime_owner: runYaml.runtime?.runtime_owner || null,
        session_id: String(runYaml.runtime?.session_id || sessionId),
        workflow_stage: normalizeWorkflowStage(runYaml.runtime?.workflow_stage)
      }
    };
  }
  toRunSummary(run) {
    return {
      runId: run.runId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      caseId: run.caseId,
      mode: run.mode,
      goal: run.goal,
      captures: run.captures,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      lastStage: run.lastStage,
      backend: run.backend
    };
  }
  normalizeSessionTitle(title) {
    const normalized = title?.trim();
    if (normalized) {
      return normalized.slice(0, 80);
    }
    const timestamp = /* @__PURE__ */ new Date();
    return `Session ${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}-${String(timestamp.getDate()).padStart(2, "0")} ${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}`;
  }
  createUniqueProjectSlug(projectName, existingProjects) {
    const baseSlug = sanitizeToken(projectName.toLowerCase());
    const existingSlugs = new Set(existingProjects.map((project) => project.slug));
    if (!existingSlugs.has(baseSlug)) {
      return baseSlug;
    }
    let counter = 2;
    while (existingSlugs.has(`${baseSlug}-${counter}`)) {
      counter += 1;
    }
    return `${baseSlug}-${counter}`;
  }
  ensureDir(dirPath) {
    if (!fs__namespace.existsSync(dirPath)) {
      fs__namespace.mkdirSync(dirPath, { recursive: true });
    }
  }
  copyDirectoryContents(sourceDir, targetDir, overwrite) {
    if (!fs__namespace.existsSync(sourceDir)) return;
    this.ensureDir(targetDir);
    for (const entry of fs__namespace.readdirSync(sourceDir, { withFileTypes: true })) {
      const sourcePath = path__namespace.join(sourceDir, entry.name);
      const targetPath = path__namespace.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        this.copyDirectoryContents(sourcePath, targetPath, overwrite);
        continue;
      }
      if (!overwrite && fs__namespace.existsSync(targetPath)) {
        continue;
      }
      this.ensureDir(path__namespace.dirname(targetPath));
      fs__namespace.copyFileSync(sourcePath, targetPath);
    }
  }
  readJson(filePath) {
    try {
      if (!fs__namespace.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
    } catch (error) {
      console.error(`Failed to read JSON file: ${filePath}`, error);
      return null;
    }
  }
  writeJson(filePath, data) {
    this.ensureDir(path__namespace.dirname(filePath));
    fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }
  deepMerge(base, patch) {
    const output = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) {
        output[key] = value;
        continue;
      }
      if (value && typeof value === "object") {
        const existingValue = output[key];
        output[key] = this.deepMerge(
          existingValue && typeof existingValue === "object" && !Array.isArray(existingValue) ? existingValue : {},
          value
        );
        continue;
      }
      output[key] = value;
    }
    return output;
  }
  persistProject(project) {
    const registry = this.readRegistry();
    registry.projects = registry.projects.map((entry) => entry.projectId === project.projectId ? project : entry);
    this.writeRegistry(registry);
    this.writeProjectMetadata(project);
  }
  buildProjectPaths(rootPath) {
    const resourcePath = path__namespace.join(rootPath, ".resource");
    return {
      resourcePath,
      knowledgePath: path__namespace.join(resourcePath, "knowledge"),
      inputsPath: path__namespace.join(resourcePath, "inputs")
    };
  }
  ensureProjectResourceLayout(rootPath) {
    const paths = this.buildProjectPaths(rootPath);
    this.ensureDir(paths.resourcePath);
    this.ensureDir(paths.knowledgePath);
    this.ensureDir(paths.inputsPath);
    const legacyKnowledgePath = path__namespace.join(rootPath, ".rdc-agent", "knowledge");
    if (fs__namespace.existsSync(legacyKnowledgePath)) {
      this.copyDirectoryContents(legacyKnowledgePath, paths.knowledgePath, false);
    }
    return paths;
  }
  normalizeProjectRecord(project) {
    const rootPath = path__namespace.resolve(project.rootPath);
    const { resourcePath, knowledgePath, inputsPath } = this.ensureProjectResourceLayout(rootPath);
    const inputs = this.collectProjectInputs(inputsPath);
    return {
      ...project,
      rootPath,
      resourcePath,
      knowledgePath,
      inputsPath,
      inputs,
      inputsUpdatedAt: project.inputsUpdatedAt || nowMs()
    };
  }
  collectProjectInputs(inputsPath) {
    if (!fs__namespace.existsSync(inputsPath)) {
      return [];
    }
    const records = [];
    const walk = (dirPath) => {
      for (const entry of fs__namespace.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path__namespace.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (path__namespace.extname(entry.name).toLowerCase() !== ".rdc") {
          continue;
        }
        const stats = fs__namespace.statSync(fullPath);
        records.push({
          inputId: this.createProjectInputId(inputsPath, fullPath),
          fileName: path__namespace.basename(fullPath),
          filePath: fullPath,
          source: "project_resource",
          discoveredAt: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
          lastModifiedAt: stats.mtimeMs,
          size: stats.size
        });
      }
    };
    walk(inputsPath);
    return records.sort((a, b) => a.fileName.localeCompare(b.fileName));
  }
  createProjectInputId(inputsPath, filePath) {
    const relativePath = path__namespace.relative(inputsPath, filePath).replace(/[\\/]+/g, "_");
    const sanitized = sanitizeToken(relativePath.toLowerCase().replace(/\.rdc$/i, ""));
    return `input_${sanitized}`;
  }
  resolveImportedInputPath(inputsPath, fileName) {
    const extension = path__namespace.extname(fileName);
    const baseName = path__namespace.basename(fileName, extension);
    let candidate = path__namespace.join(inputsPath, fileName);
    let counter = 2;
    while (fs__namespace.existsSync(candidate)) {
      candidate = path__namespace.join(inputsPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }
}
const storageAdapter = new StorageAdapter();
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
const LEFT_SIDEBAR_DEFAULT_WIDTH = 280;
const LEFT_SIDEBAR_MIN_WIDTH = 220;
const LEFT_SIDEBAR_MAX_WIDTH = 420;
const LEFT_SIDEBAR_COLLAPSED_WIDTH = 56;
const RIGHT_PANEL_DEFAULT_WIDTH = 340;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_COLLAPSED_WIDTH = 44;
const BUILTIN_LLM_PROVIDER_DEFINITIONS = [
  {
    id: "openrouter",
    kind: "openrouter",
    label: "OpenRouter",
    enabled: true,
    baseUrl: "https://openrouter.ai/api/v1",
    recommendedModels: [
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-opus-4.1",
      "moonshotai/kimi-k2.5",
      "openai/gpt-5.2"
    ],
    defaultModels: [
      "anthropic/claude-3-opus",
      "anthropic/claude-3-sonnet",
      "google/gemini-pro-1.5",
      "openai/gpt-4o"
    ],
    docsUrl: "https://openrouter.ai/keys"
  },
  {
    id: "minimax",
    kind: "openai-compatible",
    label: "MiniMax",
    enabled: false,
    baseUrl: "https://api.minimax.chat/v1",
    recommendedModels: ["MiniMax-M1", "abab6.5s-chat"],
    docsUrl: "https://platform.minimaxi.com/"
  },
  {
    id: "zai",
    kind: "openai-compatible",
    label: "Z.ai",
    enabled: false,
    baseUrl: "https://api.z.ai/api/paas/v4",
    recommendedModels: ["glm-4.6", "glm-4.5-air"],
    docsUrl: "https://platform.z.ai/"
  },
  {
    id: "volcengine",
    kind: "openai-compatible",
    label: "Volcengine",
    enabled: false,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    recommendedModels: ["doubao-seed-1-6", "doubao-pro-32k"],
    docsUrl: "https://www.volcengine.com/docs/82379"
  },
  {
    id: "302ai",
    kind: "openai-compatible",
    label: "302.AI",
    enabled: false,
    baseUrl: "https://api.302.ai/v1",
    recommendedModels: ["gpt-4o", "claude-3-7-sonnet"],
    docsUrl: "https://302.ai/"
  },
  {
    id: "ollama",
    kind: "ollama",
    label: "Ollama",
    enabled: false,
    baseUrl: "http://127.0.0.1:11434/v1",
    recommendedModels: ["qwen2.5-coder:14b", "llama3.1:8b"],
    docsUrl: "https://ollama.com/download"
  },
  {
    id: "siliconflow",
    kind: "openai-compatible",
    label: "SiliconFlow",
    enabled: false,
    baseUrl: "https://api.siliconflow.cn/v1",
    recommendedModels: ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3"],
    docsUrl: "https://siliconflow.cn/"
  },
  {
    id: "openai",
    kind: "openai-compatible",
    label: "OpenAI",
    enabled: false,
    baseUrl: "https://api.openai.com/v1",
    recommendedModels: ["gpt-4o", "gpt-4.1"],
    docsUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "anthropic",
    kind: "anthropic",
    label: "Anthropic",
    enabled: false,
    baseUrl: "https://api.anthropic.com/v1",
    recommendedModels: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest"],
    docsUrl: "https://console.anthropic.com/settings/keys"
  }
];
function isBuiltinProviderId(id) {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.some((entry) => entry.id === id);
}
function getBuiltinProviderDefinition(id) {
  return BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === id) ?? null;
}
const toModels = (modelIds) => Array.from(new Set(modelIds)).map((modelId) => ({
  id: modelId,
  label: modelId,
  enabled: true
}));
const createBuiltinProviderEntry = (id) => {
  const definition = getBuiltinProviderDefinition(id);
  if (!definition) {
    throw new Error(`Unknown builtin provider: ${id}`);
  }
  const defaultModels = definition.defaultModels ?? [];
  return {
    id: definition.id,
    kind: definition.kind,
    label: definition.label,
    enabled: definition.enabled,
    apiKey: "",
    hasStoredSecret: false,
    baseUrl: definition.baseUrl,
    models: toModels(defaultModels),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    isConfigured: false
  };
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
const AGENT_CATEGORIES = {
  "rdc-debugger": "orchestrator",
  "triage_agent": "investigator",
  "capture_repro_agent": "investigator",
  "pass_graph_pipeline_agent": "investigator",
  "pixel_forensics_agent": "investigator",
  "shader_ir_agent": "investigator",
  "driver_device_agent": "investigator",
  "skeptic_agent": "verifier",
  "curator_agent": "reporter"
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
const AGENT_WRITE_SCOPES = {
  "rdc-debugger": ["workspace_control"],
  "triage_agent": ["workspace_notes"],
  "capture_repro_agent": ["workspace_notes"],
  "pass_graph_pipeline_agent": ["workspace_notes"],
  "pixel_forensics_agent": ["workspace_notes"],
  "shader_ir_agent": ["workspace_notes"],
  "driver_device_agent": ["workspace_notes"],
  "skeptic_agent": ["session_signoff"],
  "curator_agent": ["workspace_reports", "session_artifacts", "knowledge_library"]
};
const DEFAULT_MODE_PROFILE_ID = "debugger.default";
const DEFAULT_AGENT_PROMPTS = {
  "rdc-debugger": "You are the RDC Debugger orchestrator. Coordinate the workflow, keep the run truthful, and drive the next best debugging step.",
  "triage_agent": "You are the triage specialist. Classify the rendering issue, narrow the symptom family, and suggest the right investigation surfaces.",
  "capture_repro_agent": "You are the capture reproduction specialist. Validate capture quality, frame consistency, and reproducibility anchors.",
  "pass_graph_pipeline_agent": "You are the pass/pipeline specialist. Analyze render-pass sequencing, pipeline state, and dependency shifts.",
  "pixel_forensics_agent": "You are the pixel forensics specialist. Explain visible corruption with concrete pixel-, target-, and event-level evidence.",
  "shader_ir_agent": "You are the shader IR specialist. Inspect shader source, compiled IR, and precision or replacement risks.",
  "driver_device_agent": "You are the driver/device specialist. Compare backend, device, and driver specific behavior and identify remote-runtime risks.",
  "skeptic_agent": "You are the skeptic. Challenge weak claims and reject conclusions not proven by the evidence chain.",
  "curator_agent": "You are the curator. Turn accepted evidence into a structured final report and operator-ready summary."
};
const DEFAULT_AGENT_TOOLS = {
  "rdc-debugger": ["rd.core.*", "rd.session.*", "rd.capture.*", "rd.remote.*"],
  "triage_agent": ["rd.session.get_context", "rd.event.get_action_tree", "rd.macro.summarize_frame"],
  "capture_repro_agent": ["rd.capture.get_info", "rd.capture.list_frames", "rd.context.snapshot"],
  "pass_graph_pipeline_agent": ["rd.pipeline.get_state_summary", "rd.pipeline.get_output_targets", "rd.macro.find_state_change_point"],
  "pixel_forensics_agent": ["rd.macro.explain_pixel", "rd.texture.get_pixel_value", "rd.export.screenshot"],
  "shader_ir_agent": ["rd.shader.get_disassembly", "rd.shader.debug_start"],
  "driver_device_agent": ["rd.session.get_context", "rd.remote.connect", "rd.remote.ping", "rd.remote.list_targets"],
  "skeptic_agent": [],
  "curator_agent": []
};
const DEFAULT_STAGE_POLICIES = [
  {
    id: "stage.preflight",
    label: "Preflight",
    stage: "preflight",
    phase: "planner",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Verify runtime prerequisites, capture availability, and operator configuration before the run starts.",
    notes: "Fail early on invalid runtime preconditions.",
    toolPolicy: { allowGroups: ["core", "session", "capture", "remote"] }
  },
  {
    id: "stage.entry_gate",
    label: "Entry Gate",
    stage: "entry_gate",
    phase: "planner",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Validate entry contract, backend truth, and capture/device compatibility.",
    notes: "Reject remote/local mismatches and missing providers.",
    toolPolicy: { allowGroups: ["core", "session", "capture", "remote"] }
  },
  {
    id: "stage.intake_gate",
    label: "Intake Gate",
    stage: "intake_gate",
    phase: "planner",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Establish case input, capture references, and canonical intake state for downstream agents.",
    notes: "Produce the durable intake truth object.",
    toolPolicy: { allowGroups: ["capture", "session"] }
  },
  {
    id: "stage.plan",
    label: "Plan",
    stage: "plan",
    phase: "planner",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Expand the user goal into a structured investigation plan, hypotheses, and risk map.",
    notes: "Planner phase.",
    toolPolicy: { allowGroups: ["core", "session"] }
  },
  {
    id: "stage.speclist",
    label: "Speclist",
    stage: "speclist",
    phase: "planner",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Produce specialist briefs, ownership boundaries, and tool constraints for each investigator.",
    notes: "Last planner step before specialist execution.",
    toolPolicy: { allowGroups: ["core", "session"] }
  },
  {
    id: "stage.dispatch",
    label: "Dispatch",
    stage: "dispatch",
    phase: "generator",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Run specialist work, collect their briefs, and preserve every dispatch and tool trace.",
    notes: "Generator phase.",
    toolPolicy: { allowGroups: ["core", "session", "capture", "event", "pipeline", "texture", "shader", "remote", "macro"] }
  },
  {
    id: "stage.investigate",
    label: "Investigate",
    stage: "investigate",
    phase: "generator",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Synthesize specialist evidence into a concrete diagnosis and next verification target.",
    notes: "Generator synthesis step.",
    toolPolicy: { allowGroups: ["core", "session", "capture", "event", "pipeline", "texture", "shader", "remote", "macro"] }
  },
  {
    id: "stage.fix_verify",
    label: "Fix Verify",
    stage: "fix_verify",
    phase: "evaluator",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Verify the proposed fix against real tool evidence and return pass, retry, or blocked.",
    notes: "Evaluator oracle step.",
    toolPolicy: { allowGroups: ["core", "session", "capture", "event", "pipeline", "texture", "shader", "remote", "macro"] }
  },
  {
    id: "stage.skepti",
    label: "Skepti",
    stage: "skepti",
    phase: "evaluator",
    agentPromptId: "agent.skeptic_agent",
    systemPrompt: "Challenge unsupported claims and require hard evidence for every conclusion.",
    notes: "Evaluator skeptic step.",
    toolPolicy: { allowGroups: [] }
  },
  {
    id: "stage.curate",
    label: "Curate",
    stage: "curate",
    phase: "evaluator",
    agentPromptId: "agent.curator_agent",
    systemPrompt: "Compile the accepted investigation into a structured, operator-ready final report.",
    notes: "Evaluator report step.",
    toolPolicy: { allowGroups: [] }
  },
  {
    id: "stage.finalize",
    label: "Finalize",
    stage: "finalize",
    phase: "evaluator",
    agentPromptId: "agent.rdc-debugger",
    systemPrompt: "Finalize only when all gates, evidence, skeptic signoff, and backend truth checks pass.",
    notes: "Strict close-out gate.",
    toolPolicy: { allowGroups: ["core", "session"] }
  }
];
const DEFAULT_MODE_PROFILE = {
  id: DEFAULT_MODE_PROFILE_ID,
  label: "Debugger Production",
  mode: "debugger",
  stagePolicies: {
    preflight: "stage.preflight",
    entry_gate: "stage.entry_gate",
    intake_gate: "stage.intake_gate",
    plan: "stage.plan",
    speclist: "stage.speclist",
    dispatch: "stage.dispatch",
    investigate: "stage.investigate",
    fix_verify: "stage.fix_verify",
    skepti: "stage.skepti",
    curate: "stage.curate",
    finalize: "stage.finalize"
  },
  defaultAgentPrompts: {
    "rdc-debugger": "agent.rdc-debugger",
    "triage_agent": "agent.triage_agent",
    "capture_repro_agent": "agent.capture_repro_agent",
    "pass_graph_pipeline_agent": "agent.pass_graph_pipeline_agent",
    "pixel_forensics_agent": "agent.pixel_forensics_agent",
    "shader_ir_agent": "agent.shader_ir_agent",
    "driver_device_agent": "agent.driver_device_agent",
    "skeptic_agent": "agent.skeptic_agent",
    "curator_agent": "agent.curator_agent"
  }
};
const DEFAULT_AGENT_PROFILES = Object.entries(DEFAULT_MODEL_ROUTING).map(([agentId, routing]) => ({
  id: `agent.${agentId}`,
  label: agentId,
  agentId,
  systemPrompt: DEFAULT_AGENT_PROMPTS[agentId],
  modelProvider: routing.provider,
  modelName: routing.model,
  temperature: ["skeptic_agent", "curator_agent"].includes(agentId) ? 0.2 : 0.3,
  maxTokens: 4096,
  toolPolicy: {
    allowTools: DEFAULT_AGENT_TOOLS[agentId]
  }
}));
class ExecutionProfileService {
  getModeProfilesPath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "modes");
  }
  getAgentProfilesPath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "agents");
  }
  getStagePoliciesPath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).policiesPath, "stages");
  }
  ensureScaffold(workspaceRoot = appPathService.getWorkspaceRoot()) {
    fs.mkdirSync(this.getModeProfilesPath(workspaceRoot), { recursive: true });
    fs.mkdirSync(this.getAgentProfilesPath(workspaceRoot), { recursive: true });
    fs.mkdirSync(this.getStagePoliciesPath(workspaceRoot), { recursive: true });
    this.writeJsonIfMissing(
      path.join(this.getModeProfilesPath(workspaceRoot), `${DEFAULT_MODE_PROFILE.id}.json`),
      DEFAULT_MODE_PROFILE
    );
    for (const profile of DEFAULT_AGENT_PROFILES) {
      this.writeJsonIfMissing(
        path.join(this.getAgentProfilesPath(workspaceRoot), `${profile.agentId}.json`),
        profile
      );
    }
    for (const stagePolicy of DEFAULT_STAGE_POLICIES) {
      this.writeJsonIfMissing(
        path.join(this.getStagePoliciesPath(workspaceRoot), `${stagePolicy.stage}.json`),
        stagePolicy
      );
    }
  }
  normalizeConfiguration(configuration, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    const availableModeProfiles = this.listModeProfiles(workspaceRoot);
    const hasActiveProfile = availableModeProfiles.some((profile) => profile.id === configuration.activeModeProfileId);
    return {
      ...configuration,
      activeModeProfileId: hasActiveProfile ? configuration.activeModeProfileId : DEFAULT_MODE_PROFILE_ID,
      availableModeProfiles
    };
  }
  listModeProfiles(workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    return fs.readdirSync(this.getModeProfilesPath(workspaceRoot)).filter((entry) => entry.endsWith(".json")).map((entry) => this.readJson(path.join(this.getModeProfilesPath(workspaceRoot), entry))).filter((profile) => profile !== null).map((profile) => ({ id: profile.id, label: profile.label }));
  }
  resolveAgentRuntimeProfile(settings, stage, agentId) {
    const workspaceRoot = settings.workspace.rootPath;
    this.ensureScaffold(workspaceRoot);
    const modeProfile = this.readJson(
      path.join(this.getModeProfilesPath(workspaceRoot), `${settings.configuration.activeModeProfileId}.json`)
    ) || DEFAULT_MODE_PROFILE;
    const agentPromptId = modeProfile.defaultAgentPrompts[agentId] || `agent.${agentId}`;
    const agentProfile = this.readJson(
      path.join(this.getAgentProfilesPath(workspaceRoot), `${agentId}.json`)
    ) || DEFAULT_AGENT_PROFILES.find((profile) => profile.agentId === agentId);
    const stagePolicyId = modeProfile.stagePolicies[stage] || `stage.${stage}`;
    const stagePolicy = this.readJson(
      path.join(this.getStagePoliciesPath(workspaceRoot), `${stage}.json`)
    ) || DEFAULT_STAGE_POLICIES.find((policy) => policy.stage === stage);
    const route = this.resolveAgentRoute(settings.llm.agentRoutes, settings.llm.providers, agentId);
    return {
      agentId,
      systemPrompt: [
        agentProfile.systemPrompt,
        stagePolicy.systemPrompt ? `

Stage Policy:
${stagePolicy.systemPrompt}` : ""
      ].join("").trim(),
      providerId: route?.providerId || "",
      modelId: route?.modelId || "",
      temperature: agentProfile.temperature,
      maxTokens: agentProfile.maxTokens,
      category: AGENT_CATEGORIES[agentId],
      writeScope: AGENT_WRITE_SCOPES[agentId],
      stage,
      phase: stagePolicy.phase || STAGE_PHASES[stage],
      toolAllowlist: Array.from(/* @__PURE__ */ new Set([
        ...stagePolicy.toolPolicy?.allowTools ?? [],
        ...agentProfile.toolPolicy?.allowTools ?? []
      ])),
      source: {
        modeProfileId: modeProfile.id,
        stagePolicyId,
        agentProfileId: agentPromptId
      }
    };
  }
  getDiagnostics(settings) {
    const diagnostics = [];
    if (!settings.configuration.availableModeProfiles.length) {
      diagnostics.push({
        code: "missing_mode_profile",
        severity: "warning",
        message: "No execution mode profile found. Falling back to debugger.default."
      });
    }
    if (!settings.llm.providers.some((provider) => provider.isConfigured)) {
      diagnostics.push({
        code: "missing_configured_provider",
        severity: "warning",
        message: "No configured provider available for Debugger mode."
      });
    }
    return diagnostics;
  }
  resolveAgentRoute(routes, providers, agentId) {
    const route = routes.find((entry) => entry.agentId === agentId) || null;
    if (!route) {
      return null;
    }
    const provider = providers.find((entry) => entry.id === route.providerId);
    if (!provider || !provider.enabled || !provider.isConfigured) {
      return null;
    }
    const modelExists = provider.models.some((model) => model.enabled && model.id === route.modelId);
    return modelExists ? route : null;
  }
  readJson(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.warn("[ExecutionProfileService] Failed to read JSON:", filePath, error);
      return null;
    }
  }
  writeJsonIfMissing(filePath, value) {
    if (fs.existsSync(filePath)) {
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  }
}
const executionProfileService = new ExecutionProfileService();
const SECRET_FILE_NAME = "provider-secrets.json";
class SecretStorageService {
  getSecretFilePath(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).secretsPath, SECRET_FILE_NAME);
  }
  readSecretMap(workspaceRoot) {
    const filePath = this.getSecretFilePath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      console.warn("[SecretStorageService] Failed to read secrets file:", error);
      return {};
    }
  }
  writeSecretMap(secretMap, workspaceRoot) {
    const filePath = this.getSecretFilePath(workspaceRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(secretMap, null, 2), "utf8");
  }
  createProviderSecretRef(providerId) {
    return `provider-${sanitizeToken(providerId)}-api-key`;
  }
  getSecret(secretRef, workspaceRoot) {
    if (!secretRef) {
      return "";
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    const entry = secretMap[secretRef];
    if (!entry) {
      return "";
    }
    try {
      if (entry.encoding === "safeStorage" && electron.safeStorage.isEncryptionAvailable()) {
        return electron.safeStorage.decryptString(Buffer.from(entry.payload, "base64"));
      }
      return Buffer.from(entry.payload, "base64").toString("utf8");
    } catch (error) {
      console.warn("[SecretStorageService] Failed to decrypt secret:", error);
      return "";
    }
  }
  setSecret(secretRef, plaintext, workspaceRoot) {
    if (!secretRef) {
      return;
    }
    const normalized = plaintext.trim();
    const secretMap = this.readSecretMap(workspaceRoot);
    if (!normalized) {
      delete secretMap[secretRef];
      this.writeSecretMap(secretMap, workspaceRoot);
      return;
    }
    const encryptionAvailable = electron.safeStorage.isEncryptionAvailable();
    secretMap[secretRef] = {
      encoding: encryptionAvailable ? "safeStorage" : "base64",
      payload: encryptionAvailable ? electron.safeStorage.encryptString(normalized).toString("base64") : Buffer.from(normalized, "utf8").toString("base64"),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.writeSecretMap(secretMap, workspaceRoot);
  }
  deleteSecret(secretRef, workspaceRoot) {
    if (!secretRef) {
      return;
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    if (!(secretRef in secretMap)) {
      return;
    }
    delete secretMap[secretRef];
    this.writeSecretMap(secretMap, workspaceRoot);
  }
  hasSecret(secretRef, workspaceRoot) {
    return Boolean(secretRef && this.getSecret(secretRef, workspaceRoot));
  }
}
const secretStorageService = new SecretStorageService();
const LEFT_DEFAULTS = {
  width: LEFT_SIDEBAR_DEFAULT_WIDTH,
  min: LEFT_SIDEBAR_MIN_WIDTH,
  max: LEFT_SIDEBAR_MAX_WIDTH,
  collapsedWidth: LEFT_SIDEBAR_COLLAPSED_WIDTH
};
const RIGHT_DEFAULTS = {
  width: RIGHT_PANEL_DEFAULT_WIDTH,
  min: RIGHT_PANEL_MIN_WIDTH,
  max: RIGHT_PANEL_MAX_WIDTH,
  collapsedWidth: RIGHT_PANEL_COLLAPSED_WIDTH
};
const VALID_THEMES = ["dark", "light", "system"];
const VALID_LANGUAGES = ["zh-CN", "en"];
const VALID_FONT_SCALES = ["small", "medium", "large"];
const VALID_PROVIDER_KINDS = ["openrouter", "openai-compatible", "anthropic", "ollama"];
const KNOWN_AGENT_IDS = new Set(Object.keys(DEFAULT_MODEL_ROUTING));
const EMPTY_PATHS = {
  workspaceRoot: "",
  defaultWorkspaceRoot: "",
  settingsPath: "",
  logsPath: "",
  logPath: "",
  projectsPath: "",
  knowledgePath: "",
  migrationOrphansPath: "",
  profilesPath: "",
  policiesPath: "",
  secretsPath: "",
  migrationReportsPath: ""
};
const DEFAULT_APPEARANCE = {
  theme: "dark",
  language: "zh-CN",
  fontScale: "medium"
};
const DEFAULT_LAYOUT = {
  leftSidebar: {
    collapsed: false,
    width: LEFT_DEFAULTS.width,
    expandedWidth: LEFT_DEFAULTS.width
  },
  rightPanel: {
    collapsed: false,
    width: RIGHT_DEFAULTS.width,
    expandedWidth: RIGHT_DEFAULTS.width
  }
};
const DEFAULT_PROFILE = {
  nickname: "RDC Operator",
  avatarPath: ""
};
const DEFAULT_CONFIGURATION = {
  activeModeProfileId: "debugger.default"
};
function nowIso$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function pickEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function dedupeStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn("[SettingsService] Failed to read JSON:", filePath, error);
    return null;
  }
}
function isVendorSecretUsable(providerId, secret) {
  const normalized = secret.trim();
  if (!normalized) {
    return false;
  }
  if (providerId === "openrouter") {
    return /^sk-or-/i.test(normalized);
  }
  if (providerId === "openai") {
    return /^sk-/i.test(normalized);
  }
  if (providerId === "anthropic") {
    return /^sk-ant-/i.test(normalized);
  }
  return true;
}
function getResolvedProviderSecret(providerId, secretRef, workspaceRoot) {
  const secret = secretStorageService.getSecret(secretRef, workspaceRoot).trim();
  return isVendorSecretUsable(providerId, secret) ? secret : "";
}
function sanitizeSidebar(input, defaults, fallback) {
  const candidate = input ?? {};
  const expandedWidth = clamp(
    typeof candidate.expandedWidth === "number" ? candidate.expandedWidth : fallback.expandedWidth,
    defaults.min,
    defaults.max
  );
  return {
    collapsed: typeof candidate.collapsed === "boolean" ? candidate.collapsed : fallback.collapsed,
    expandedWidth,
    width: clamp(
      typeof candidate.width === "number" ? candidate.width : fallback.collapsed ? defaults.collapsedWidth : expandedWidth,
      defaults.collapsedWidth,
      defaults.max
    )
  };
}
function sanitizeModels(models) {
  const candidates = Array.isArray(models) ? models : [];
  const modelMap = /* @__PURE__ */ new Map();
  for (const entry of candidates) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry;
    const modelId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!modelId || modelMap.has(modelId)) {
      continue;
    }
    modelMap.set(modelId, {
      id: modelId,
      label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false
    });
  }
  return Array.from(modelMap.values());
}
function createEmptyAgentRoutes() {
  return Object.keys(DEFAULT_MODEL_ROUTING).map((agentId) => ({
    agentId,
    providerId: "",
    modelId: ""
  }));
}
function createDefaultPersistedSettings(workspaceRoot = appPathService.getWorkspaceRoot()) {
  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    workspace: {
      rootPath: workspaceRoot
    },
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes()
    },
    configuration: DEFAULT_CONFIGURATION
  };
}
function createDefaultRuntimeSettings(workspaceRoot = appPathService.getWorkspaceRoot()) {
  const configuration = executionProfileService.normalizeConfiguration({
    activeModeProfileId: DEFAULT_CONFIGURATION.activeModeProfileId || "debugger.default",
    availableModeProfiles: [],
    lastMigrationReportPath: void 0,
    lastMigrationSummary: [],
    diagnostics: []
  }, workspaceRoot);
  return {
    appearance: DEFAULT_APPEARANCE,
    layout: DEFAULT_LAYOUT,
    profile: DEFAULT_PROFILE,
    workspace: {
      rootPath: workspaceRoot
    },
    llm: {
      providers: [],
      agentRoutes: createEmptyAgentRoutes()
    },
    configuration,
    paths: EMPTY_PATHS
  };
}
function sanitizeRoute(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const route = entry;
  if (typeof route.agentId !== "string" || !KNOWN_AGENT_IDS.has(route.agentId)) {
    return null;
  }
  return {
    agentId: route.agentId,
    providerId: typeof route.providerId === "string" ? route.providerId.trim() : "",
    modelId: typeof route.modelId === "string" ? route.modelId.trim() : ""
  };
}
function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
function isBuiltinProviderExplicitlyCustomized(provider) {
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  if (!id || !isBuiltinProviderId(id)) {
    return false;
  }
  const builtin = createBuiltinProviderEntry(id);
  const providerModels = sanitizeModels(provider.models).map((model) => model.id);
  const builtinModels = builtin.models.map((model) => model.id);
  const recommendedModels = Array.isArray(provider.recommendedModels) ? provider.recommendedModels.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean) : [];
  return typeof provider.label === "string" && provider.label.trim() && provider.label.trim() !== builtin.label || typeof provider.baseUrl === "string" && provider.baseUrl.trim() && provider.baseUrl.trim() !== (builtin.baseUrl || "") || typeof provider.docsUrl === "string" && provider.docsUrl.trim() && provider.docsUrl.trim() !== (builtin.docsUrl || "") || !arraysEqual(providerModels, builtinModels) || recommendedModels.length > 0 && !arraysEqual(recommendedModels, builtin.recommendedModels);
}
function isFixtureProvider(provider) {
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim().toLowerCase() : "";
  return /^provider-\d+$/i.test(id) || id === "acme" || id === "vendorx" || baseUrl.includes("example.com") || baseUrl.includes("acme.local") || baseUrl.includes("vendorx.ai");
}
function sanitizeUserProvider(provider, workspaceRoot = appPathService.getWorkspaceRoot()) {
  const rawId = typeof provider.id === "string" ? provider.id.trim() : "";
  if (!rawId) {
    return null;
  }
  const builtinFallback = isBuiltinProviderId(rawId) ? createBuiltinProviderEntry(rawId) : void 0;
  const secretRef = provider.secretRef || secretStorageService.createProviderSecretRef(rawId);
  const kind = pickEnum(provider.kind, VALID_PROVIDER_KINDS, builtinFallback?.kind ?? "openai-compatible");
  const enabled = typeof provider.enabled === "boolean" ? provider.enabled : builtinFallback?.enabled ?? false;
  const resolvedSecret = kind === "ollama" ? "" : getResolvedProviderSecret(rawId, secretRef, workspaceRoot);
  const hasStoredSecret = kind === "ollama" ? true : Boolean(resolvedSecret);
  return {
    id: rawId,
    kind,
    label: typeof provider.label === "string" && provider.label.trim() ? provider.label.trim() : builtinFallback?.label ?? "",
    enabled,
    apiKey: "",
    secretRef,
    hasStoredSecret,
    baseUrl: typeof provider.baseUrl === "string" && provider.baseUrl.trim() ? provider.baseUrl.trim() : builtinFallback?.baseUrl,
    models: sanitizeModels(provider.models ?? builtinFallback?.models ?? []),
    recommendedModels: dedupeStrings(
      Array.isArray(provider.recommendedModels) ? provider.recommendedModels.filter((value) => typeof value === "string").map((value) => value.trim()) : builtinFallback?.recommendedModels ?? []
    ),
    docsUrl: typeof provider.docsUrl === "string" && provider.docsUrl.trim() ? provider.docsUrl.trim() : builtinFallback?.docsUrl,
    isConfigured: enabled && (kind === "ollama" || Boolean(resolvedSecret))
  };
}
function normalizeUserProviders(providers, workspaceRoot) {
  const nextProviders = [];
  const seenIds = /* @__PURE__ */ new Set();
  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const provider = sanitizeUserProvider(entry, workspaceRoot);
    if (!provider || seenIds.has(provider.id)) {
      continue;
    }
    seenIds.add(provider.id);
    nextProviders.push(provider);
  }
  return nextProviders;
}
function hydrateProviderSecrets(providers, workspaceRoot) {
  return providers.map((provider) => {
    const resolvedSecret = provider.kind === "ollama" ? "" : getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
    return {
      ...provider,
      // The renderer only needs to know whether a secret exists.
      // Keep plaintext secrets out of settings:get payloads.
      apiKey: "",
      hasStoredSecret: provider.kind === "ollama" ? true : Boolean(resolvedSecret),
      isConfigured: provider.enabled && (provider.kind === "ollama" || Boolean(resolvedSecret))
    };
  });
}
function normalizeUserRoutes(routes, providers) {
  const routeMap = /* @__PURE__ */ new Map();
  for (const route of Array.isArray(routes) ? routes.map(sanitizeRoute) : []) {
    if (!route) {
      continue;
    }
    routeMap.set(route.agentId, route);
  }
  return createEmptyAgentRoutes().map((route) => {
    const incoming = routeMap.get(route.agentId);
    if (!incoming?.providerId || !incoming.modelId) {
      return route;
    }
    const provider = providers.find((entry) => entry.id === incoming.providerId);
    const isValid = Boolean(
      provider && provider.enabled && provider.isConfigured && provider.models.some((model) => model.enabled && model.id === incoming.modelId)
    );
    return isValid ? incoming : route;
  });
}
function parseMigrationSummary(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return [];
  }
  try {
    const content = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return [...content.fixes ?? [], ...content.warnings ?? []];
  } catch (error) {
    console.warn("[SettingsService] Failed to read migration report:", error);
    return [];
  }
}
class SettingsService {
  legacyStore;
  initialized = false;
  constructor() {
    this.legacyStore = new Store({
      name: "rdc-agent-settings"
    });
  }
  initialize() {
    const runtimePaths = appPathService.initializeWorkspaceRoot();
    executionProfileService.ensureScaffold(runtimePaths.workspaceRoot);
    const rawPersisted = readJsonFile(runtimePaths.settingsPath);
    const rebuildResult = this.rebuildPersistedSettings(rawPersisted, runtimePaths.workspaceRoot, true);
    if (rebuildResult.changed || !fs.existsSync(runtimePaths.settingsPath)) {
      this.persistHardRebuild(runtimePaths, rawPersisted, rebuildResult);
    }
    this.initialized = true;
    return this.getAll(runtimePaths);
  }
  ensureInitialized() {
    if (!this.initialized) {
      this.initialize();
    }
  }
  rebuildPersistedSettings(raw, workspaceRoot, includeLegacySecrets) {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const fixes = [];
    const warnings = [];
    const rawProviders = Array.isArray(candidate.llm?.providers) ? candidate.llm?.providers : [];
    const rawRoutes = Array.isArray(candidate.llm?.agentRoutes) ? candidate.llm?.agentRoutes : [];
    const routeRefs = new Set(
      rawRoutes.map(sanitizeRoute).filter((route) => route !== null && Boolean(route.providerId)).map((route) => route.providerId)
    );
    const nextProviders = [];
    for (const entry of rawProviders) {
      if (isFixtureProvider(entry)) {
        fixes.push(`Removed fixture provider ${entry.id}`);
        secretStorageService.deleteSecret(entry.secretRef, workspaceRoot);
        continue;
      }
      const rawId = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!rawId) {
        fixes.push("Removed provider with empty id");
        continue;
      }
      const secretRef = entry.secretRef || secretStorageService.createProviderSecretRef(rawId);
      if (entry.apiKey?.trim()) {
        secretStorageService.setSecret(secretRef, entry.apiKey.trim(), workspaceRoot);
        fixes.push(`Migrated plaintext secret for ${rawId}`);
      }
      const sanitized = sanitizeUserProvider({ ...entry, secretRef }, workspaceRoot);
      if (!sanitized) {
        continue;
      }
      if (isBuiltinProviderId(sanitized.id)) {
        const keepBuiltin = sanitized.isConfigured || isBuiltinProviderExplicitlyCustomized(entry) && routeRefs.has(sanitized.id);
        if (!keepBuiltin) {
          fixes.push(`Removed auto-injected builtin provider ${sanitized.id}`);
          continue;
        }
      }
      if (!nextProviders.some((provider) => provider.id === sanitized.id)) {
        nextProviders.push(sanitized);
      } else {
        fixes.push(`Removed duplicated provider ${sanitized.id}`);
      }
    }
    if (includeLegacySecrets) {
      const legacyOpenRouter = this.legacyStore.get("openRouter");
      if (legacyOpenRouter?.apiKey?.trim()) {
        const secretRef = secretStorageService.createProviderSecretRef("openrouter");
        secretStorageService.setSecret(secretRef, legacyOpenRouter.apiKey.trim(), workspaceRoot);
        const sanitized = sanitizeUserProvider({
          ...createBuiltinProviderEntry("openrouter"),
          enabled: true,
          secretRef,
          baseUrl: legacyOpenRouter.baseUrl || createBuiltinProviderEntry("openrouter").baseUrl
        }, workspaceRoot);
        if (sanitized?.isConfigured && !nextProviders.some((provider) => provider.id === "openrouter")) {
          nextProviders.push(sanitized);
          fixes.push("Imported legacy OpenRouter provider");
        }
      }
    }
    const nextRoutes = normalizeUserRoutes(rawRoutes, nextProviders);
    const incomingRoutes = Array.isArray(rawRoutes) ? rawRoutes.map(sanitizeRoute).filter((route) => route !== null) : [];
    for (const route of incomingRoutes) {
      const normalized = nextRoutes.find((entry) => entry.agentId === route.agentId);
      if (!normalized || normalized.providerId !== route.providerId || normalized.modelId !== route.modelId) {
        if (route.providerId || route.modelId) {
          fixes.push(`Cleared invalid route for ${route.agentId}`);
        }
      }
    }
    if (!nextProviders.some((provider) => provider.isConfigured)) {
      warnings.push("No configured provider available for Debugger mode.");
    }
    const nextSettings = {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? "dark"),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? "zh-CN"),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? "medium")
      },
      layout: {
        leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel)
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === "string" && candidate.profile.nickname.trim() ? candidate.profile.nickname.trim() : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === "string" ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot
      },
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath
      }
    };
    return {
      settings: nextSettings,
      changed: JSON.stringify(candidate) !== JSON.stringify(nextSettings),
      fixes,
      warnings
    };
  }
  normalizePersistedSettings(raw, workspaceRoot) {
    const fallback = createDefaultPersistedSettings(workspaceRoot);
    const candidate = raw ?? fallback;
    const nextProviders = normalizeUserProviders(candidate.llm?.providers, workspaceRoot).map((provider) => ({
      ...provider,
      apiKey: ""
    }));
    const nextRoutes = normalizeUserRoutes(candidate.llm?.agentRoutes, nextProviders);
    return {
      appearance: {
        theme: pickEnum(candidate.appearance?.theme, VALID_THEMES, fallback.appearance?.theme ?? "dark"),
        language: pickEnum(candidate.appearance?.language, VALID_LANGUAGES, fallback.appearance?.language ?? "zh-CN"),
        fontScale: pickEnum(candidate.appearance?.fontScale, VALID_FONT_SCALES, fallback.appearance?.fontScale ?? "medium")
      },
      layout: {
        leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar),
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel)
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === "string" && candidate.profile.nickname.trim() ? candidate.profile.nickname.trim() : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === "string" ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot
      },
      llm: {
        providers: nextProviders,
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath
      }
    };
  }
  writeMigrationReport(paths, fixes, warnings) {
    const reportPath = path.join(paths.migrationReportsPath, `settings-rebuild-${Date.now()}.json`);
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: nowIso$1(),
      fixes,
      warnings
    }, null, 2), "utf8");
    return reportPath;
  }
  persistHardRebuild(paths, previous, result) {
    const nextSettings = {
      ...result.settings,
      configuration: {
        ...result.settings.configuration
      }
    };
    if (result.changed && previous && fs.existsSync(paths.settingsPath)) {
      fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
      const backupPath = path.join(paths.migrationOrphansPath, `settings.backup.${Date.now()}.json`);
      fs.copyFileSync(paths.settingsPath, backupPath);
    }
    if (result.changed && (result.fixes.length > 0 || result.warnings.length > 0)) {
      nextSettings.configuration = {
        ...nextSettings.configuration,
        lastMigrationReportPath: this.writeMigrationReport(paths, result.fixes, result.warnings)
      };
    }
    this.writeSettings(nextSettings, paths.workspaceRoot);
  }
  toRuntimeSettings(persisted, runtimePaths) {
    const workspaceRoot = persisted.workspace?.rootPath?.trim() || appPathService.getWorkspaceRoot();
    const normalized = this.normalizePersistedSettings(persisted, workspaceRoot);
    const hydratedProviders = hydrateProviderSecrets(normalized.llm.providers, workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const configuration = executionProfileService.normalizeConfiguration({
      activeModeProfileId: normalized.configuration?.activeModeProfileId || DEFAULT_CONFIGURATION.activeModeProfileId || "debugger.default",
      availableModeProfiles: [],
      lastMigrationReportPath: normalized.configuration?.lastMigrationReportPath,
      lastMigrationSummary: parseMigrationSummary(normalized.configuration?.lastMigrationReportPath),
      diagnostics: []
    }, workspaceRoot);
    const settings = {
      ...createDefaultRuntimeSettings(workspaceRoot),
      appearance: normalized.appearance,
      layout: normalized.layout,
      profile: normalized.profile,
      workspace: {
        rootPath: workspaceRoot
      },
      llm: {
        providers: hydratedProviders,
        agentRoutes: normalizeUserRoutes(normalized.llm?.agentRoutes ?? createEmptyAgentRoutes(), hydratedProviders)
      },
      configuration,
      paths: {
        ...paths,
        ...runtimePaths ?? {}
      }
    };
    settings.configuration.diagnostics = executionProfileService.getDiagnostics(settings);
    return settings;
  }
  writeSettings(settings, workspaceRoot = settings.workspace?.rootPath || appPathService.getWorkspaceRoot()) {
    const filePath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
  }
  getAll(runtimePaths) {
    this.ensureInitialized();
    const paths = appPathService.getWorkspacePaths();
    const persisted = readJsonFile(paths.settingsPath) ?? createDefaultPersistedSettings(paths.workspaceRoot);
    return this.toRuntimeSettings(persisted, runtimePaths);
  }
  getProviderSecret(providerId, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureInitialized();
    const persisted = this.normalizePersistedSettings(
      readJsonFile(appPathService.getWorkspacePaths(workspaceRoot).settingsPath) ?? createDefaultPersistedSettings(workspaceRoot),
      workspaceRoot
    );
    const provider = persisted.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || provider.kind === "ollama") {
      return "";
    }
    return getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
  }
  setAll(patch, runtimePaths) {
    this.ensureInitialized();
    const currentRuntime = this.getAll();
    const requestedRoot = patch.workspace?.rootPath?.trim() || currentRuntime.workspace.rootPath || appPathService.getWorkspacePaths().workspaceRoot;
    const nextPaths = appPathService.setWorkspaceRoot(requestedRoot);
    executionProfileService.ensureScaffold(nextPaths.workspaceRoot);
    const currentPersisted = this.normalizePersistedSettings(
      readJsonFile(nextPaths.settingsPath) ?? createDefaultPersistedSettings(nextPaths.workspaceRoot),
      nextPaths.workspaceRoot
    );
    const nextProviders = (patch.llm?.providers ?? currentPersisted.llm?.providers ?? []).map((provider) => {
      const secretRef = provider.secretRef || secretStorageService.createProviderSecretRef(provider.id);
      if (provider.apiKey.trim()) {
        secretStorageService.setSecret(secretRef, provider.apiKey.trim(), nextPaths.workspaceRoot);
      } else if (!provider.hasStoredSecret) {
        secretStorageService.deleteSecret(secretRef, nextPaths.workspaceRoot);
      }
      return sanitizeUserProvider({
        ...provider,
        secretRef
      }, nextPaths.workspaceRoot);
    }).filter((provider) => provider !== null);
    const nextPersisted = {
      appearance: {
        theme: pickEnum(
          patch.appearance?.theme ?? currentPersisted.appearance?.theme,
          VALID_THEMES,
          DEFAULT_APPEARANCE.theme
        ),
        language: pickEnum(
          patch.appearance?.language ?? currentPersisted.appearance?.language,
          VALID_LANGUAGES,
          DEFAULT_APPEARANCE.language
        ),
        fontScale: pickEnum(
          patch.appearance?.fontScale ?? currentPersisted.appearance?.fontScale,
          VALID_FONT_SCALES,
          DEFAULT_APPEARANCE.fontScale
        )
      },
      layout: {
        leftSidebar: sanitizeSidebar(
          {
            ...currentPersisted.layout?.leftSidebar ?? DEFAULT_LAYOUT.leftSidebar,
            ...patch.layout?.leftSidebar ?? {}
          },
          LEFT_DEFAULTS,
          DEFAULT_LAYOUT.leftSidebar
        ),
        rightPanel: sanitizeSidebar(
          {
            ...currentPersisted.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel,
            ...patch.layout?.rightPanel ?? {}
          },
          RIGHT_DEFAULTS,
          DEFAULT_LAYOUT.rightPanel
        )
      },
      profile: {
        nickname: typeof patch.profile?.nickname === "string" && patch.profile.nickname.trim() ? patch.profile.nickname.trim() : currentPersisted.profile?.nickname || DEFAULT_PROFILE.nickname,
        avatarPath: typeof patch.profile?.avatarPath === "string" ? patch.profile.avatarPath : currentPersisted.profile?.avatarPath || DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: nextPaths.workspaceRoot
      },
      llm: {
        providers: nextProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: normalizeUserRoutes(patch.llm?.agentRoutes ?? currentPersisted.llm?.agentRoutes ?? [], nextProviders)
      },
      configuration: {
        activeModeProfileId: patch.configuration?.activeModeProfileId || currentPersisted.configuration?.activeModeProfileId || DEFAULT_CONFIGURATION.activeModeProfileId,
        lastMigrationReportPath: currentPersisted.configuration?.lastMigrationReportPath
      }
    };
    this.writeSettings(nextPersisted, nextPaths.workspaceRoot);
    return this.getAll({
      ...nextPaths,
      ...runtimePaths ?? {}
    });
  }
  getLlmConfig() {
    const settings = this.getAll();
    const providers = settings.llm.providers.map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      label: provider.label,
      enabled: provider.enabled,
      apiKey: provider.kind === "ollama" ? "" : provider.secretRef ? getResolvedProviderSecret(provider.id, provider.secretRef, settings.workspace.rootPath) : "",
      baseUrl: provider.baseUrl,
      models: provider.models.filter((model) => model.enabled).map((model) => model.id),
      docsUrl: provider.docsUrl
    }));
    return {
      providers,
      agentRoutes: settings.llm.agentRoutes
    };
  }
  hasConfiguredProvider() {
    return this.getAll().llm.providers.some((provider) => provider.isConfigured);
  }
  getSettingsPath() {
    return appPathService.getWorkspacePaths().settingsPath;
  }
}
const settingsService = new SettingsService();
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
    if (input.mode === "debugger") {
      if (!settingsService.hasConfiguredProvider()) {
        blockers.push(this.createBlocker(
          "LLM_KEY_MISSING",
          "At least one configured provider is required for Debugger mode",
          ["settings:models"]
        ));
      }
    }
    if (input.captures && input.captures.length > 0) {
      const hasRemoteCapture = input.captures.some((c) => c.backendHint === "remote");
      if (hasRemoteCapture && (!input.replayDevice || input.replayDevice.type === "local" || input.replayDevice.status !== "online")) {
        blockers.push(this.createBlocker(
          "REMOTE_CONFIG_MISSING",
          "Remote capture requires an online Replay Device",
          []
        ));
      }
    }
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
      generated_at: nowIso$2(),
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
    return { hasBlockers: blockers.length > 0, blockers };
  }
  // ========== 辅助方法 ==========
  createBlocker(code, reason, refs = []) {
    return {
      code,
      reason,
      refs,
      detectedAt: nowIso$2()
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
const toContentBlocks = (messages) => messages.map((message) => {
  if (typeof message.content === "string") {
    return { role: message.role, content: message.content };
  }
  const content = message.content.map((block) => {
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
  return { role: message.role, content };
});
class OpenRouterProvider {
  name;
  apiKey = "";
  baseUrl = "https://openrouter.ai/api/v1";
  models = [];
  constructor(name) {
    this.name = name;
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || "https://openrouter.ai/api/v1").trim();
    this.models = config.models;
  }
  async chat(request) {
    const model = request.model || this.models[0] || "anthropic/claude-3-opus";
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: request.tools,
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
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
  async streamChat(request, onChunk) {
    const response = await this.chat(request);
    onChunk(typeof response.content === "string" ? response.content : JSON.stringify(response.content));
    return response;
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
class OpenAICompatibleProvider {
  name;
  apiKey = "";
  baseUrl = "https://api.openai.com/v1";
  models = [];
  requireApiKey = true;
  constructor(name, requireApiKey = true) {
    this.name = name;
    this.requireApiKey = requireApiKey;
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim();
    this.models = config.models;
  }
  async chat(request) {
    const model = request.model || this.models[0] || "gpt-4o";
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7
      })
    });
    if (!response.ok) {
      throw new Error(`${this.name} API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      id: data.id || `${this.name}-${Date.now()}`,
      model: data.model || model,
      content: choice?.message?.content || "",
      toolCalls: choice?.message?.tool_calls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : choice?.finish_reason === "stop" ? "end_turn" : "max_tokens"
    };
  }
  async streamChat(request, onChunk) {
    const response = await this.chat(request);
    onChunk(typeof response.content === "string" ? response.content : JSON.stringify(response.content));
    return response;
  }
  async isAvailable() {
    return this.requireApiKey ? Boolean(this.apiKey) : true;
  }
  getModels() {
    return this.models;
  }
}
class AnthropicProvider {
  name;
  apiKey = "";
  baseUrl = "https://api.anthropic.com/v1";
  models = [];
  constructor(name) {
    this.name = name;
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").trim();
    this.models = config.models;
  }
  async chat(request) {
    const model = request.model || this.models[0] || "claude-3-7-sonnet-latest";
    const systemMessage = request.messages.find((message) => message.role === "system");
    const otherMessages = request.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens || 4096,
        system: typeof systemMessage?.content === "string" ? systemMessage.content : void 0,
        messages: otherMessages.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content
        }))
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    return {
      id: data.id || `anthropic-${Date.now()}`,
      model: data.model || model,
      content: data.content?.[0]?.text || "",
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0
      },
      stopReason: data.stop_reason === "end_turn" ? "end_turn" : "max_tokens"
    };
  }
  async streamChat(request, onChunk) {
    const response = await this.chat(request);
    onChunk(typeof response.content === "string" ? response.content : JSON.stringify(response.content));
    return response;
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
const createProviderByKind = (providerId, kind) => {
  if (kind === "openrouter") {
    return new OpenRouterProvider(providerId);
  }
  if (kind === "anthropic") {
    return new AnthropicProvider(providerId);
  }
  if (kind === "ollama") {
    return new OpenAICompatibleProvider(providerId, false);
  }
  return new OpenAICompatibleProvider(providerId, true);
};
class LLMAdapter {
  providers = /* @__PURE__ */ new Map();
  fallbackProviderId = null;
  configure(config) {
    this.providers.clear();
    this.fallbackProviderId = null;
    for (const providerConfig of config.providers) {
      const provider = createProviderByKind(providerConfig.id, providerConfig.kind);
      if ("configure" in provider && typeof provider.configure === "function") {
        provider.configure(providerConfig);
      }
      this.providers.set(providerConfig.id, {
        config: providerConfig,
        provider
      });
      if (!this.fallbackProviderId && providerConfig.enabled) {
        this.fallbackProviderId = providerConfig.id;
      }
    }
  }
  async chat(request, providerId) {
    const resolvedProviderId = providerId || this.fallbackProviderId;
    if (!resolvedProviderId) {
      throw new Error("No LLM provider configured");
    }
    const runtimeProvider = this.providers.get(resolvedProviderId);
    if (!runtimeProvider) {
      throw new Error(`Provider not found: ${resolvedProviderId}`);
    }
    if (!runtimeProvider.config.enabled) {
      throw new Error(`Provider disabled: ${resolvedProviderId}`);
    }
    if (!await runtimeProvider.provider.isAvailable()) {
      throw new Error(`Provider not configured: ${resolvedProviderId}`);
    }
    return runtimeProvider.provider.chat(request);
  }
  async streamChat(request, onChunk, providerId) {
    const resolvedProviderId = providerId || this.fallbackProviderId;
    if (!resolvedProviderId) {
      throw new Error("No LLM provider configured");
    }
    const runtimeProvider = this.providers.get(resolvedProviderId);
    if (!runtimeProvider) {
      throw new Error(`Provider not found: ${resolvedProviderId}`);
    }
    return runtimeProvider.provider.streamChat(request, onChunk);
  }
  async testConnection(providerId) {
    const runtimeProvider = this.providers.get(providerId);
    if (!runtimeProvider) {
      return { success: false, error: `Provider not found: ${providerId}` };
    }
    try {
      const available = await runtimeProvider.provider.isAvailable();
      return { success: available, error: available ? void 0 : "Provider not configured" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  getAvailableModels(providerId) {
    return this.providers.get(providerId)?.config.models || [];
  }
  getDefaultProvider() {
    return this.fallbackProviderId || "openrouter";
  }
}
const llmAdapter = new LLMAdapter();
const APP_LOG_LIMIT = 1e3;
const SESSION_LOG_LIMIT = 500;
class RuntimeLogService {
  appEntries = [];
  sessionEntries = /* @__PURE__ */ new Map();
  log(input) {
    const entry = {
      id: generateEventId("rlog"),
      timestamp: input.timestamp ?? nowMs(),
      scope: input.scope,
      namespace: input.namespace,
      severity: input.severity ?? "info",
      title: input.title,
      summary: input.summary,
      detail: input.detail,
      sessionId: input.sessionId ?? null,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      raw: input.raw ?? null
    };
    this.pushWithLimit(this.appEntries, entry, APP_LOG_LIMIT);
    if (entry.sessionId) {
      const bucket = this.sessionEntries.get(entry.sessionId) ?? [];
      this.pushWithLimit(bucket, entry, SESSION_LOG_LIMIT);
      this.sessionEntries.set(entry.sessionId, bucket);
    }
    this.broadcast(entry);
    return entry;
  }
  list(scope, sessionId) {
    if (scope === "session") {
      if (!sessionId) {
        return [];
      }
      return [...this.sessionEntries.get(sessionId) ?? []];
    }
    return [...this.appEntries];
  }
  pushWithLimit(target, entry, limit) {
    target.push(entry);
    if (target.length > limit) {
      target.splice(0, target.length - limit);
    }
  }
  broadcast(entry) {
    const windows = electron.BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send("runtime:logAppended", entry);
      }
    }
  }
}
const runtimeLogService = new RuntimeLogService();
const SPECIALIST_TOOL_BINDINGS = {
  triage_agent: [
    "rd.session.get_context",
    "rd.event.get_action_tree",
    "rd.macro.summarize_frame"
  ],
  capture_repro_agent: [
    "rd.capture.get_info",
    "rd.capture.list_frames",
    "rd.context.snapshot"
  ],
  pass_graph_pipeline_agent: [
    "rd.pipeline.get_state_summary",
    "rd.pipeline.get_output_targets",
    "rd.macro.find_state_change_point"
  ],
  pixel_forensics_agent: [
    "rd.macro.explain_pixel",
    "rd.texture.get_pixel_value",
    "rd.export.screenshot"
  ],
  shader_ir_agent: [
    "rd.shader.get_disassembly",
    "rd.shader.debug_start"
  ],
  driver_device_agent: [
    "rd.session.get_context",
    "rd.remote.connect",
    "rd.remote.ping",
    "rd.remote.list_devices"
  ],
  // skeptic_agent 和 curator_agent 不直接使用 live tool
  skeptic_agent: [],
  curator_agent: []
};
const SHADER_EDIT_TOOLS = ["rd.shader.edit_and_replace", "rd.macro.shader_hotfix_validate"];
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
        lastActivity: nowIso$2()
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
  applyLlmConfig(config) {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallback = DEFAULT_MODEL_ROUTING[agentId];
      const route = routeMap.get(agentId);
      this.agentConfigs.set(agentId, {
        ...agentConfig,
        modelProvider: route ? route.providerId : fallback.provider,
        modelName: route ? route.modelId : fallback.model
      });
    }
  }
  resolveRuntimeProfile(agentId, stage) {
    const settings = settingsService.getAll();
    return executionProfileService.resolveAgentRuntimeProfile(settings, stage || "investigate", agentId);
  }
  /**
   * 发送消息给Agent
   */
  async sendMessage(agentId, content, context) {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    this.updateAgentStatus(agentId, "thinking");
    try {
      const runtimeProfile = this.resolveRuntimeProfile(agentId, context?.stageId);
      const config = {
        ...fallbackConfig,
        systemPrompt: runtimeProfile.systemPrompt,
        modelProvider: runtimeProfile.providerId,
        modelName: runtimeProfile.modelId,
        temperature: runtimeProfile.temperature ?? fallbackConfig.temperature,
        maxTokens: runtimeProfile.maxTokens ?? fallbackConfig.maxTokens
      };
      const messages = [
        { role: "system", content: config.systemPrompt || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}` },
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
   * 获取 Specialist 可用工具清单（Task 4b）
   * 根据角色过滤可用工具，确保 skeptic_agent 和 curator_agent 不接收任何 live tool
   */
  getToolsForRole(agentId) {
    const runtimeProfile = this.resolveRuntimeProfile(agentId);
    const profileTools = runtimeProfile.toolAllowlist ?? [];
    if (profileTools.length > 0) {
      return profileTools;
    }
    return SPECIALIST_TOOL_BINDINGS[agentId] ?? [];
  }
  /**
   * 检查工具是否允许被指定角色使用（Task 4b）
   * shader 编辑工具默认只读，不在任何 specialist 的工具清单中
   */
  isToolAllowedForRole(toolName, agentId) {
    if (SHADER_EDIT_TOOLS.includes(toolName)) {
      return false;
    }
    const allowedTools = this.getToolsForRole(agentId);
    for (const pattern of allowedTools) {
      if (pattern.endsWith(".*")) {
        const prefix = pattern.slice(0, -2);
        if (toolName.startsWith(prefix + ".")) {
          return true;
        }
      } else if (toolName === pattern) {
        return true;
      }
    }
    return false;
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
    const allowedTools = this.getToolsForRole(agentId);
    console.log(`[AgentOrchestrator] Dispatching ${agentId} with ${allowedTools.length} allowed tools:`, allowedTools);
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
        dispatch_time: nowIso$2()
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
          completed_at: nowIso$2()
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
      state.lastActivity = nowIso$2();
      runtimeLogService.log({
        scope: "app",
        namespace: "agent",
        severity: status === "error" ? "error" : status === "complete" ? "success" : "info",
        title: AGENT_DISPLAY_NAMES[agentId] || agentId,
        summary: `状态切换为 ${status}。`,
        raw: {
          agentId,
          status
        }
      });
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
    this.notifyMessage(message, context?.sessionId);
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
  notifyMessage(message, sessionId) {
    runtimeLogService.log({
      scope: sessionId ? "session" : "app",
      namespace: "agent",
      severity: message.role === "system" ? "warning" : "info",
      title: AGENT_DISPLAY_NAMES[message.agentId] || message.agentId,
      summary: message.content.slice(0, 120) || "空消息",
      sessionId,
      raw: {
        agentId: message.agentId,
        role: message.role,
        messageId: message.id,
        content: message.content
      },
      timestamp: message.timestamp
    });
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("agent:message", message);
    }
  }
}
const agentOrchestrator = new AgentOrchestrator();
const POLL_INTERVAL_MS = 5e3;
const ACTIVATE_TIMEOUT_MS = 9e4;
const PREPARED_REMOTE_TTL_MS = 10 * 60 * 1e3;
const LOCAL_DEVICE = {
  id: "local",
  label: "Local",
  type: "local",
  status: "online",
  transport: "local",
  detailText: "Local replay ready"
};
function sanitizeDeviceId(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}
function adbUnavailableMessage() {
  return "adb executable not found. Configure RDX_ANDROID_ADB_PATH or install Android platform-tools.";
}
function candidateAdbPaths() {
  const candidates = [];
  const push = (value) => {
    const trimmed = value?.trim();
    if (trimmed) {
      candidates.push(trimmed);
    }
  };
  push(process.env.RDX_ANDROID_ADB_PATH);
  push(process.env.ADB);
  for (const envName of ["ANDROID_SDK_ROOT", "ANDROID_HOME"]) {
    const root = process.env[envName]?.trim();
    if (!root) {
      continue;
    }
    push(path__namespace.join(root, "platform-tools", "adb.exe"));
    push(path__namespace.join(root, "platform-tools", "adb"));
  }
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    push(path__namespace.join(localAppData, "Android", "Sdk", "platform-tools", "adb.exe"));
  }
  return candidates;
}
function resolveAdbExecutable() {
  for (const candidate of candidateAdbPaths()) {
    if (fs__namespace.existsSync(candidate)) {
      return path__namespace.resolve(candidate);
    }
  }
  for (const entry of (process.env.PATH ?? "").split(path__namespace.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    for (const adbName of ["adb.exe", "adb"]) {
      const candidate = path__namespace.join(trimmed, adbName);
      if (fs__namespace.existsSync(candidate)) {
        return path__namespace.resolve(candidate);
      }
    }
  }
  throw new Error(adbUnavailableMessage());
}
function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function normalizeBoolean(value) {
  return typeof value === "boolean" ? value : void 0;
}
function normalizeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function parseAndroidBootstrapMetadata(payload) {
  if (!payload || typeof payload !== "object") {
    return void 0;
  }
  const record = payload;
  const cleanupActions = Array.isArray(record.cleanup_actions) ? record.cleanup_actions.filter((item) => typeof item === "string") : void 0;
  const metadata = {
    packageName: normalizeString(record.package_name),
    activityName: normalizeString(record.activity_name),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apk_path),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remote_port),
    forwardSpec: normalizeString(record.forward_spec),
    configRemotePath: normalizeString(record.config_remote_path),
    cleanupActions,
    installedApk: normalizeBoolean(record.installed_apk),
    pushedConfig: normalizeBoolean(record.pushed_config),
    startedActivity: normalizeBoolean(record.started_activity),
    createdForward: normalizeBoolean(record.created_forward),
    installMode: record.install_mode === "upgrade" || record.install_mode === "force_replace" ? record.install_mode : void 0,
    installReason: record.install_reason === "fresh_install" || record.install_reason === "mismatched_existing_apk" || record.install_reason === "version_downgrade" || record.install_reason === "signature_mismatch" ? record.install_reason : void 0,
    uninstalledExisting: normalizeBoolean(record.uninstalled_existing)
  };
  return Object.values(metadata).some((value) => value !== void 0) ? metadata : void 0;
}
function parsePersistedAndroidBootstrapMetadata(payload) {
  if (!payload || typeof payload !== "object") {
    return void 0;
  }
  const record = payload;
  const cleanupActions = Array.isArray(record.cleanupActions) ? record.cleanupActions.filter((item) => typeof item === "string") : void 0;
  const metadata = {
    packageName: normalizeString(record.packageName),
    activityName: normalizeString(record.activityName),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apkPath),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remotePort),
    forwardSpec: normalizeString(record.forwardSpec),
    configRemotePath: normalizeString(record.configRemotePath),
    cleanupActions,
    installedApk: normalizeBoolean(record.installedApk),
    pushedConfig: normalizeBoolean(record.pushedConfig),
    startedActivity: normalizeBoolean(record.startedActivity),
    createdForward: normalizeBoolean(record.createdForward),
    installMode: record.installMode === "upgrade" || record.installMode === "force_replace" ? record.installMode : void 0,
    installReason: record.installReason === "fresh_install" || record.installReason === "mismatched_existing_apk" || record.installReason === "version_downgrade" || record.installReason === "signature_mismatch" ? record.installReason : void 0,
    uninstalledExisting: normalizeBoolean(record.uninstalledExisting)
  };
  return Object.values(metadata).some((value) => value !== void 0) ? metadata : void 0;
}
function parseResumeCacheRecord(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload;
  const deviceId = normalizeString(record.deviceId);
  const serial = normalizeString(record.serial);
  const label = normalizeString(record.label);
  const transport = record.transport === "local" || record.transport === "adb_android" ? record.transport : void 0;
  const lastValidatedAt = normalizeNumber(record.lastValidatedAt);
  if (!deviceId || !serial || !label || !transport || !lastValidatedAt) {
    return null;
  }
  return {
    deviceId,
    serial,
    label,
    transport,
    lastValidatedAt,
    bootstrap: parsePersistedAndroidBootstrapMetadata(record.bootstrap)
  };
}
function hasBootstrapManagedLaunch(bootstrap) {
  return Boolean(
    bootstrap && (bootstrap.startedActivity || bootstrap.installedApk || bootstrap.installMode || bootstrap.uninstalledExisting)
  );
}
function buildBootstrapDetailText(bootstrap) {
  if (!bootstrap) {
    return [];
  }
  const suffix = [];
  if (bootstrap.installMode === "force_replace") {
    suffix.push("APK force replaced");
  } else if (bootstrap.installedApk && bootstrap.installReason === "fresh_install") {
    suffix.push("APK installed");
  } else if (bootstrap.installedApk) {
    suffix.push("APK upgraded");
  } else if (bootstrap.packageName) {
    suffix.push("APK verified");
  }
  if (bootstrap.abi) {
    suffix.push(bootstrap.abi);
  }
  if (bootstrap.forwardSpec) {
    suffix.push(bootstrap.forwardSpec);
  }
  return suffix;
}
function buildRemoteReadyText(bootstrap) {
  const prefix = hasBootstrapManagedLaunch(bootstrap) ? "Started Android RenderDoc and connected" : "Connected to Android RenderDoc server";
  const suffix = buildBootstrapDetailText(bootstrap);
  return suffix.length > 0 ? `${prefix} · ${suffix.join(" · ")}` : prefix;
}
function parseToolError(result, fallbackMessage) {
  return {
    message: result.error?.message ?? fallbackMessage,
    code: result.error?.code
  };
}
function applyActivationFailure(device, phase, message, code) {
  return {
    ...device,
    status: "offline",
    detailText: message,
    lastError: message,
    remoteId: void 0,
    activationPhase: phase,
    activationErrorCode: code,
    activationErrorMessage: message,
    activationUpdatedAt: Date.now()
  };
}
function parseAdbDeviceLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("List of devices attached")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const serial = parts[0];
  const adbState = parts[1];
  const metadata = /* @__PURE__ */ new Map();
  for (const token of parts.slice(2)) {
    const separatorIndex = token.indexOf(":");
    if (separatorIndex > 0) {
      metadata.set(token.slice(0, separatorIndex), token.slice(separatorIndex + 1));
    }
  }
  const model = metadata.get("model");
  const deviceName = metadata.get("device");
  const transportId = metadata.get("transport_id");
  const label = model ?? deviceName ?? serial;
  let detailText = "Ready to connect to Android RenderDoc server";
  let lastError;
  let status = "offline";
  if (adbState === "device") {
    status = "offline";
  } else if (adbState === "offline") {
    detailText = "ADB reports this device as offline.";
    lastError = detailText;
  } else if (adbState === "unauthorized") {
    detailText = "ADB authorization required on the device.";
    lastError = detailText;
  } else {
    detailText = `ADB state: ${adbState}`;
    lastError = detailText;
  }
  if (transportId) {
    detailText = `${detailText}${detailText.endsWith(".") ? "" : "."} transport ${transportId}`;
  }
  return {
    id: `android-${sanitizeDeviceId(serial)}`,
    label,
    serial,
    type: "android",
    status,
    transport: "adb_android",
    detailText,
    lastError,
    lastSeen: Date.now()
  };
}
class ReplayDeviceService {
  devices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
  pollTimer = null;
  mainWindow = null;
  initialized = false;
  refreshPromise = null;
  activationPromises = /* @__PURE__ */ new Map();
  preparedRemotes = /* @__PURE__ */ new Map();
  resumeCache = null;
  setMainWindow(window) {
    this.mainWindow = window;
  }
  async initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    await this.loadResumeCache();
    await this.refreshDevices();
    this.pollTimer = setInterval(() => {
      void this.refreshDevices().catch((error) => {
        console.warn("[ReplayDeviceService] Poll refresh failed:", error);
      });
    }, POLL_INTERVAL_MS);
  }
  dispose() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  listDevices() {
    return this.getSortedDevices();
  }
  getDeviceById(deviceId) {
    return this.devices.get(deviceId) ?? null;
  }
  async refreshDevices() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.performRefresh();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
  async activateDevice(deviceId) {
    const existingPromise = this.activationPromises.get(deviceId);
    if (existingPromise) {
      return existingPromise;
    }
    const activationPromise = this.performActivation(deviceId).finally(() => {
      this.activationPromises.delete(deviceId);
    });
    this.activationPromises.set(deviceId, activationPromise);
    return activationPromise;
  }
  peekPreparedRemote(deviceId) {
    const prepared = this.resolvePreparedRemote(deviceId);
    return prepared ? { ...prepared } : null;
  }
  consumePreparedRemote(deviceId) {
    const prepared = this.resolvePreparedRemote(deviceId);
    if (!prepared) {
      return null;
    }
    this.preparedRemotes.delete(deviceId);
    return { ...prepared };
  }
  invalidatePreparedRemote(deviceId) {
    this.preparedRemotes.delete(deviceId);
    const device = this.devices.get(deviceId);
    if (!device || device.type !== "android" || device.status === "offline") {
      return;
    }
    this.updateDevice({
      ...device,
      status: "offline",
      remoteId: void 0,
      detailText: "Ready to connect to Android RenderDoc server",
      lastError: void 0,
      activationPhase: "idle",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now()
    });
  }
  getResumeCachePath() {
    return path__namespace.join(storageAdapter.getWorkspacePath(), "common", "config", "device_resume.json");
  }
  async loadResumeCache() {
    try {
      const cachePath = this.getResumeCachePath();
      if (!fs__namespace.existsSync(cachePath)) {
        this.resumeCache = null;
        return;
      }
      const content = await fs__namespace.promises.readFile(cachePath, "utf-8");
      const parsed = JSON.parse(content);
      this.resumeCache = parseResumeCacheRecord(parsed.lastDevice);
    } catch (error) {
      console.warn("[ReplayDeviceService] Failed to read device resume cache:", error);
      this.resumeCache = null;
    }
  }
  async persistResumeCache(device, validatedAt) {
    if (device.type !== "android" || !device.serial) {
      return;
    }
    const nextRecord = {
      deviceId: device.id,
      serial: device.serial,
      label: device.label,
      transport: device.transport,
      bootstrap: device.bootstrap,
      lastValidatedAt: validatedAt
    };
    this.resumeCache = nextRecord;
    try {
      const cachePath = this.getResumeCachePath();
      await fs__namespace.promises.mkdir(path__namespace.dirname(cachePath), { recursive: true });
      await fs__namespace.promises.writeFile(
        cachePath,
        JSON.stringify({ lastDevice: nextRecord }, null, 2),
        "utf-8"
      );
    } catch (error) {
      console.warn("[ReplayDeviceService] Failed to persist device resume cache:", error);
    }
  }
  resolvePreparedRemote(deviceId) {
    const prepared = this.preparedRemotes.get(deviceId);
    if (!prepared) {
      return null;
    }
    const currentDevice = this.devices.get(deviceId);
    const expired = Date.now() - prepared.validatedAt > PREPARED_REMOTE_TTL_MS;
    const serialMismatch = Boolean(currentDevice?.serial && currentDevice.serial !== prepared.serial);
    if (expired || serialMismatch) {
      this.preparedRemotes.delete(deviceId);
      return null;
    }
    return prepared;
  }
  shouldPreserveTransientState(device) {
    return device.status !== "offline";
  }
  maybeDecorateFromResumeCache(device) {
    if (device.type !== "android" || !device.serial || !this.resumeCache || this.resumeCache.serial !== device.serial || device.bootstrap) {
      return device;
    }
    return {
      ...device,
      bootstrap: this.resumeCache.bootstrap
    };
  }
  async performRefresh() {
    const detectedDevices = await this.detectAdbDevices();
    const now = Date.now();
    const nextDevices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, { ...LOCAL_DEVICE, lastSeen: now }]]);
    const detectedIds = /* @__PURE__ */ new Set(["local"]);
    for (const detected of detectedDevices) {
      const decoratedDevice = this.maybeDecorateFromResumeCache(detected);
      detectedIds.add(decoratedDevice.id);
      const previous = this.devices.get(decoratedDevice.id);
      if (previous && this.shouldPreserveTransientState(previous) && decoratedDevice.lastError === void 0) {
        nextDevices.set(decoratedDevice.id, {
          ...decoratedDevice,
          status: previous.status,
          detailText: previous.detailText ?? decoratedDevice.detailText,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? decoratedDevice.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: decoratedDevice.lastSeen ?? previous.lastSeen
        });
      } else if (previous && previous.activationErrorMessage && previous.lastError && decoratedDevice.status === "offline" && decoratedDevice.lastError === void 0) {
        nextDevices.set(decoratedDevice.id, {
          ...decoratedDevice,
          detailText: previous.detailText ?? previous.activationErrorMessage,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? decoratedDevice.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: decoratedDevice.lastSeen ?? previous.lastSeen
        });
      } else {
        nextDevices.set(decoratedDevice.id, decoratedDevice);
      }
    }
    for (const [deviceId, device] of this.devices.entries()) {
      if (detectedIds.has(deviceId) || deviceId === "local") {
        continue;
      }
      this.preparedRemotes.delete(deviceId);
      nextDevices.set(deviceId, {
        ...device,
        status: "offline",
        detailText: "ADB device not detected.",
        lastError: "ADB device not detected."
      });
    }
    return this.replaceDevices(nextDevices);
  }
  async detectAdbDevices() {
    try {
      const lines = await this.runAdbCommand(["devices", "-l"]);
      return lines.map((line) => parseAdbDeviceLine(line)).filter((device) => device !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const offlineDevices = this.getSortedDevices().filter((device) => device.id !== "local").map((device) => ({
        ...device,
        status: "offline",
        detailText: message,
        lastError: message
      }));
      this.preparedRemotes.clear();
      const fallbackDevices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, LOCAL_DEVICE]]);
      for (const device of offlineDevices) {
        fallbackDevices.set(device.id, device);
      }
      return this.replaceDevices(fallbackDevices);
    }
  }
  async performActivation(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Replay device ${deviceId} not found.`);
    }
    if (device.type === "local") {
      this.updateDevice({
        ...device,
        status: "online",
        detailText: "Local replay ready",
        lastError: void 0
      });
      return this.devices.get(deviceId);
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Connecting to Android RenderDoc...",
      lastError: void 0,
      activationPhase: "daemon",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now()
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timed out while starting the remote server.")), ACTIVATE_TIMEOUT_MS);
    });
    try {
      const activated = await Promise.race([
        this.activateRemoteDevice(deviceId),
        timeoutPromise
      ]);
      this.updateDevice(activated);
      return activated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const currentDevice = this.devices.get(deviceId) ?? device;
      const failedDevice = applyActivationFailure(
        currentDevice,
        currentDevice.activationPhase ?? "connect",
        message,
        currentDevice.activationErrorCode
      );
      this.updateDevice(failedDevice);
      return failedDevice;
    }
  }
  async activateRemoteDevice(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device?.serial) {
      throw new Error("Android device serial is missing.");
    }
    await this.ensureDaemonReady();
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Allocating remote context...",
      lastError: void 0,
      activationPhase: "context",
      activationUpdatedAt: Date.now()
    });
    let contextId = `ctx-device-${sanitizeDeviceId(device.serial)}-${generateShortId()}`;
    const contextResult = await toolBridge.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId }
    });
    if (!contextResult.ok) {
      if (contextResult.error?.message?.includes("Context limit exceeded")) {
        const reusableContextId = await this.resolveReusableContextId();
        if (reusableContextId) {
          contextId = reusableContextId;
        } else {
          const parsedError = parseToolError(contextResult, "Failed to create a replay device context.");
          throw new Error(parsedError.message);
        }
      } else {
        const parsedError = parseToolError(contextResult, "Failed to create a replay device context.");
        throw new Error(parsedError.message);
      }
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Initializing remote capability...",
      lastError: void 0,
      activationPhase: "init",
      activationUpdatedAt: Date.now()
    });
    const initResult = await toolBridge.call({
      toolName: "rd.core.init",
      args: {},
      contextId
    });
    if (!initResult.ok) {
      const parsedError = parseToolError(initResult, "Failed to initialize remote capability.");
      throw new Error(parsedError.message);
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Connecting to Android RenderDoc server...",
      lastError: void 0,
      activationPhase: "connect",
      activationUpdatedAt: Date.now()
    });
    const connectResult = await toolBridge.call({
      toolName: "rd.remote.connect",
      args: {
        timeout_ms: 5e3,
        options: {
          transport: "adb_android",
          device_serial: device.serial
        }
      },
      contextId
    });
    if (!connectResult.ok) {
      const parsedError = parseToolError(connectResult, "Failed to connect to the Android RenderDoc server.");
      throw new Error(parsedError.message);
    }
    const remoteId = typeof connectResult.data?.remote_id === "string" ? connectResult.data.remote_id : void 0;
    if (!remoteId) {
      throw new Error("Remote connect did not return a remote_id.");
    }
    const bootstrap = parseAndroidBootstrapMetadata(
      connectResult.data?.detail && typeof connectResult.data.detail === "object" ? connectResult.data.detail.bootstrap : void 0
    );
    this.updateDevice({
      ...device,
      status: "connected",
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "ping",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now()
    });
    const pingResult = await toolBridge.call({
      toolName: "rd.remote.ping",
      args: { remote_id: remoteId },
      contextId
    });
    if (!pingResult.ok) {
      const parsedError = parseToolError(pingResult, "Remote server ping failed.");
      throw new Error(parsedError.message);
    }
    this.updateDevice({
      ...device,
      status: "connected",
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "targets",
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now()
    });
    const targetsResult = await toolBridge.call({
      toolName: "rd.remote.list_targets",
      args: { remote_id: remoteId },
      contextId
    });
    if (!targetsResult.ok) {
      const parsedError = parseToolError(targetsResult, "Remote target discovery failed.");
      throw new Error(parsedError.message);
    }
    const validatedAt = Date.now();
    this.preparedRemotes.set(deviceId, {
      deviceId,
      serial: device.serial,
      contextId,
      remoteId,
      validatedAt,
      bootstrap
    });
    await this.persistResumeCache({
      ...device,
      bootstrap
    }, validatedAt);
    return {
      ...device,
      status: "online",
      remoteId,
      bootstrap,
      detailText: buildRemoteReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "ready",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: validatedAt,
      lastSeen: Date.now()
    };
  }
  async ensureDaemonReady() {
    const statusResult = await toolBridge.executeCLI("daemon", ["status"]);
    if (statusResult.exitCode === 0) {
      try {
        const parsed = JSON.parse(statusResult.stdout);
        if (parsed.data?.running === true) {
          return;
        }
      } catch {
        return;
      }
    }
    const startResult = await toolBridge.executeCLI("daemon", ["start"]);
    if (startResult.exitCode !== 0) {
      const stderr = startResult.stderr.trim();
      throw new Error(stderr || "Failed to start the rdx daemon.");
    }
  }
  async resolveReusableContextId() {
    const daemonResult = await toolBridge.executeCLI("daemon", ["start"]);
    if (daemonResult.exitCode !== 0 || !daemonResult.stdout.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(daemonResult.stdout);
      return parsed.data?.state?.context_id ?? null;
    } catch {
      return null;
    }
  }
  async runAdbCommand(args) {
    const adbPath = resolveAdbExecutable();
    return new Promise((resolve, reject) => {
      const proc = child_process.spawn(adbPath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf-8");
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });
      proc.on("error", (error) => {
        reject(error);
      });
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `adb exited with code ${code ?? -1}.`));
          return;
        }
        resolve(stdout.split(/\r?\n/));
      });
    });
  }
  updateDevice(device) {
    const previous = this.devices.get(device.id);
    this.devices.set(device.id, device);
    if (!previous || previous.status !== device.status || previous.detailText !== device.detailText || previous.activationPhase !== device.activationPhase) {
      runtimeLogService.log({
        scope: "app",
        namespace: "device",
        severity: device.status === "online" ? "success" : device.status === "offline" ? "warning" : device.status === "loading" ? "info" : "info",
        title: device.label,
        summary: `${device.type === "local" ? "本地" : "Android"} Replay Device 状态：${device.status}`,
        detail: device.detailText,
        raw: {
          deviceId: device.id,
          status: device.status,
          activationPhase: device.activationPhase ?? null,
          remoteId: device.remoteId ?? null,
          lastError: device.lastError ?? null
        }
      });
    }
    this.broadcast({
      device,
      devices: this.getSortedDevices()
    });
  }
  replaceDevices(nextDevices) {
    const previous = this.getSortedDevices();
    this.devices = nextDevices;
    const devices = this.getSortedDevices();
    const changedDevice = devices.find((device, index) => JSON.stringify(device) !== JSON.stringify(previous[index]));
    const hasLengthChange = previous.length !== devices.length;
    if (changedDevice || hasLengthChange) {
      this.broadcast({
        device: changedDevice ?? devices[0] ?? LOCAL_DEVICE,
        devices
      });
    }
    return devices;
  }
  broadcast(payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send("device:statusChanged", payload);
  }
  getSortedDevices() {
    const devices = Array.from(this.devices.values());
    return devices.sort((a, b) => {
      if (a.id === "local") return -1;
      if (b.id === "local") return 1;
      return a.label.localeCompare(b.label);
    });
  }
}
const replayDeviceService = new ReplayDeviceService();
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
function resolveAgentRuntimeConfig(agentId, stageId) {
  const settings = settingsService.getAll();
  return executionProfileService.resolveAgentRuntimeProfile(settings, stageId, agentId);
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
      "preflight"
    )
  );
  if (config.checkToolsPath !== false) {
    const toolsPath = config.toolsPath || process.env.RDC_TOOLS_PATH || toolBridge.getToolsPath();
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
    currentStage: "preflight",
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
    return "blocked";
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
      "entry_gate"
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
      currentStage: "entry_gate",
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
      currentStage: "entry_gate",
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
    return "blocked";
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
function buildSyntheticCaseInput(state) {
  return {
    session: {
      case_id: state.caseId,
      run_id: state.runId,
      session_id: state.sessionId
    },
    symptom: {
      description: state.userGoal
    },
    captures: state.capturePaths.map((capturePath, index) => ({
      capture_id: `capture-${index}`,
      capture_role: index === 0 ? "primary" : "reference",
      path: capturePath
    })),
    reference_contract: {
      source_refs: state.capturePaths.slice(1)
    }
  };
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
      "intake_gate"
    )
  );
  try {
    const caseInput = await readCaseInput(state.caseId, state.runId) ?? buildSyntheticCaseInput(state);
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
    if (config.requireFixReference === true) {
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
      currentStage: "intake_gate",
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
      currentStage: "intake_gate",
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
    return "blocked";
  }
  return "plan";
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
      "plan"
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
      currentStage: "plan",
      stageHistory: [state.currentStage],
      evidenceChain,
      blockers: [...state.blockers, ...blockers],
      lastUpdated: nowIso()
    };
  }
  try {
    const runtimeConfig = resolveAgentRuntimeConfig("rdc-debugger", "plan");
    const analysisResult = await analyzeIntent(state.userGoal, {
      ...config,
      modelProvider: runtimeConfig.providerId,
      modelName: runtimeConfig.modelId
    });
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
      currentStage: "plan",
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
      currentStage: "plan",
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
    return "blocked";
  }
  return "speclist";
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
      "intake_gate"
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
      currentStage: "intake_gate",
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
      currentStage: "intake_gate",
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
    return "blocked";
  }
  return "intake_gate";
}
function selectSpecialists(state, config) {
  if (config.forceDispatch && config.forceDispatch.length > 0) {
    return config.forceDispatch;
  }
  const intentEvent = state.evidenceChain.find((event) => event.eventType === "intent_analysis_complete");
  const recommendedAgents = Array.isArray(intentEvent?.payload?.recommendedAgents) ? intentEvent.payload.recommendedAgents : INVESTIGATOR_AGENTS;
  return recommendedAgents.filter((agentId) => INVESTIGATOR_AGENTS.includes(agentId) && !config.skipAgents?.includes(agentId));
}
function generateObjective(agentRole, state) {
  return [
    `Case ID: ${state.caseId}`,
    `Run ID: ${state.runId}`,
    `Session ID: ${state.sessionId}`,
    `User Goal: ${state.userGoal}`,
    `Capture Files: ${state.capturePaths.join(", ")}`,
    "",
    "Deliver a specialist brief with concrete evidence, likely root cause, and next verification target.",
    `Focus area: ${agentRole}`
  ].join("\n");
}
async function specialistDispatchNode(state, config = {}) {
  const evidenceChain = [];
  const activeSpecialists = { ...state.activeSpecialists };
  const pendingBriefs = [];
  const selectedAgents = selectSpecialists(state, config);
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "speclist"
    )
  );
  for (const agentRole of selectedAgents) {
    const objective = generateObjective(agentRole, state);
    activeSpecialists[agentRole] = {
      ...createInitialSpecialistState(agentRole),
      objective,
      status: "pending",
      startedAt: nowIso()
    };
    pendingBriefs.push(agentRole);
    evidenceChain.push(
      createDispatchEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        agentRole,
        objective,
        `tok-${crypto.randomUUID()}`
      )
    );
  }
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "speclist_complete",
    agentId: "rdc-debugger",
    status: "ok",
    timestamp: Date.now(),
    payload: {
      selectedAgents,
      selectedCount: selectedAgents.length,
      runId: state.runId,
      sessionId: state.sessionId
    }
  });
  return {
    currentStage: "speclist",
    stageHistory: [state.currentStage],
    evidenceChain,
    activeSpecialists,
    pendingBriefs,
    lastUpdated: nowIso()
  };
}
async function specialistBriefsNode(state) {
  const evidenceChain = [];
  const activeSpecialists = { ...state.activeSpecialists };
  const collectedBriefs = { ...state.collectedBriefs };
  const blockers = [...state.blockers];
  evidenceChain.push(
    createStageTransitionEvidence(
      {
        sessionId: state.sessionId,
        runId: state.runId,
        currentStage: state.currentStage
      },
      "dispatch"
    )
  );
  const specialistIds = state.pendingBriefs.length > 0 ? state.pendingBriefs : Object.keys(activeSpecialists);
  let completedCount = 0;
  let failedCount = 0;
  for (const agentId of specialistIds) {
    const specialist = activeSpecialists[agentId];
    if (!specialist) {
      continue;
    }
    if (specialist.status === "completed" && specialist.brief) {
      collectedBriefs[agentId] = specialist.brief;
      completedCount += 1;
      continue;
    }
    if (specialist.status === "failed" || specialist.status === "timeout") {
      failedCount += 1;
    }
  }
  if (completedCount === 0 && specialistIds.length > 0) {
    blockers.push(
      createBlocker(
        BLOCKER_CODES.BLOCKED_SPECIALIST_FEEDBACK_TIMEOUT.code,
        "No specialist brief was collected from the dispatch phase.",
        specialistIds
      )
    );
  }
  evidenceChain.push({
    eventId: crypto.randomUUID(),
    eventType: "dispatch_complete",
    agentId: "rdc-debugger",
    status: blockers.length > state.blockers.length ? "blocked" : "ok",
    timestamp: Date.now(),
    payload: {
      collectedBriefsCount: Object.keys(collectedBriefs).length,
      totalSpecialists: specialistIds.length,
      completedCount,
      failedCount,
      runId: state.runId,
      sessionId: state.sessionId
    }
  });
  return {
    currentStage: "dispatch",
    stageHistory: [state.currentStage],
    evidenceChain,
    activeSpecialists,
    collectedBriefs,
    pendingBriefs: [],
    blockers,
    lastUpdated: nowIso()
  };
}
function routeAfterSpecialistBriefs(state) {
  const hasCriticalBlocker = state.blockers.some((blocker) => !blocker.resolvedAt && blocker.code.startsWith("BLOCKED_"));
  if (hasCriticalBlocker) {
    return "blocked";
  }
  return "investigate";
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
      "investigate"
    )
  );
  try {
    const modelConfig = resolveAgentRuntimeConfig("rdc-debugger", "investigate");
    const request = {
      messages: [
        { role: "system", content: buildExpertSystemPrompt() },
        { role: "user", content: buildInvestigationPrompt(state) }
      ],
      model: modelConfig.modelId,
      maxTokens: 4096,
      temperature: 0.3
      // 较低温度以获得更确定的分析
    };
    const response = await llmAdapter.chat(request, modelConfig.providerId);
    const investigationResult = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    evidenceChain.push({
      eventId: crypto.randomUUID(),
      eventType: "expert_investigation_complete",
      agentId: "rdc-debugger",
      status: "ok",
      timestamp: Date.now(),
      payload: {
        model: modelConfig.modelId,
        provider: modelConfig.providerId,
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
      currentStage: "investigate",
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
      currentStage: "investigate",
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
    return "blocked";
  }
  const hasInvestigationEvidence = state.evidenceChain.some(
    (e) => e.eventType === "expert_investigation_complete" && e.status === "ok"
  );
  if (!hasInvestigationEvidence) {
    const retryCount = state.backtrackCount["expert_investigation"] || 0;
    if (retryCount < 2) {
      return "investigate";
    }
  }
  return "fix_verify";
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
      "fix_verify"
    )
  );
  let fixVerified = false;
  let verificationStatus = "pending";
  try {
    const modelConfig = resolveAgentRuntimeConfig("rdc-debugger", "fix_verify");
    const request = {
      messages: [
        { role: "system", content: buildVerificationSystemPrompt() },
        { role: "user", content: buildVerificationPrompt(state) }
      ],
      model: modelConfig.modelId,
      maxTokens: 2048,
      temperature: 0.2
    };
    const response = await llmAdapter.chat(request, modelConfig.providerId);
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
            BLOCKER_CODES.BLOCKED_FIX_VERIFICATION_FAILED.code,
            `Fix verification failed after ${maxRetries} attempts`,
            ["fix_verification"]
          )
        );
      } else {
        backtrackCount["fix_verification"] = currentRetryCount + 1;
      }
    }
    return {
      currentStage: "fix_verify",
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
      currentStage: "fix_verify",
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
    return "blocked";
  }
  if (!state.fixVerified) {
    const retryCount = state.backtrackCount["fix_verification"] || 0;
    if (retryCount < 2) {
      return "investigate";
    }
  }
  return "skepti";
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
      "skepti",
      "skeptic_agent"
    )
  );
  let skepticApproved = false;
  let reviewStatus = "pending";
  try {
    const modelConfig = resolveAgentRuntimeConfig("skeptic_agent", "skepti");
    const request = {
      messages: [
        { role: "system", content: buildSkepticSystemPrompt() },
        { role: "user", content: buildSkepticPrompt(state) }
      ],
      model: modelConfig.modelId,
      maxTokens: 4096,
      temperature: 0.2
      // 较低温度以获得更批判性的分析
    };
    const response = await llmAdapter.chat(request, modelConfig.providerId);
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
              BLOCKER_CODES.BLOCKED_SKEPTIC_SIGNOFF_REQUIRED.code,
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
      currentStage: "skepti",
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
      currentStage: "skepti",
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
    return "blocked";
  }
  const skepticReview = state.evidenceChain.find(
    (e) => e.eventType === "skeptic_review_complete"
  );
  if (skepticReview && skepticReview.payload) {
    const payload = skepticReview.payload;
    if (!payload.skepticApproved && payload.reviewStatus === "rejected") {
      const retryCount = state.backtrackCount["skeptic_rejected"] || 0;
      if (retryCount < 2) {
        return "fix_verify";
      }
    }
  }
  return "curate";
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
      "curate",
      "curator_agent"
    )
  );
  try {
    const modelConfig = resolveAgentRuntimeConfig("curator_agent", "curate");
    const request = {
      messages: [
        { role: "system", content: buildCuratorSystemPrompt() },
        { role: "user", content: buildCuratorPrompt(state) }
      ],
      model: modelConfig.modelId,
      maxTokens: 4096,
      temperature: 0.3
    };
    const response = await llmAdapter.chat(request, modelConfig.providerId);
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
      currentStage: "curate",
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
      currentStage: "curate",
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
    return "blocked";
  }
  if (!state.finalReport) {
    return "curate";
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
      "finalize",
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
      finalStage: "finalize",
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
    "speclist_complete",
    "dispatch_complete",
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
    currentStage: "finalize",
    stageHistory: [state.currentStage],
    evidenceChain,
    lastUpdated: nowIso()
  };
}
const WorkflowAnnotation = langgraph.Annotation.Root({
  caseId: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "" }),
  runId: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "" }),
  sessionId: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "" }),
  currentStage: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "preflight" }),
  stageHistory: langgraph.Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  userGoal: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "" }),
  capturePaths: langgraph.Annotation({ reducer: (_a, b) => b, default: () => [] }),
  captures: langgraph.Annotation({ reducer: (_a, b) => b, default: () => [] }),
  primaryCaptureId: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "" }),
  replayDevice: langgraph.Annotation({ reducer: (_a, b) => b, default: () => null }),
  mode: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "debugger" }),
  goal: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "" }),
  captureInfo: langgraph.Annotation({ reducer: (_a, b) => b, default: () => void 0 }),
  replaySession: langgraph.Annotation({ reducer: (_a, b) => b, default: () => void 0 }),
  evidenceChain: langgraph.Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  artifacts: langgraph.Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  activeSpecialists: langgraph.Annotation({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  pendingBriefs: langgraph.Annotation({ reducer: (_a, b) => b, default: () => [] }),
  collectedBriefs: langgraph.Annotation({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  blockers: langgraph.Annotation({ reducer: (_a, b) => b, default: () => [] }),
  interruptReason: langgraph.Annotation({ reducer: (_a, b) => b, default: () => void 0 }),
  backtrackCount: langgraph.Annotation({ reducer: (a, b) => ({ ...a, ...b }), default: () => ({}) }),
  finalReport: langgraph.Annotation({ reducer: (_a, b) => b, default: () => void 0 }),
  fixVerified: langgraph.Annotation({ reducer: (_a, b) => b, default: () => false }),
  entryMode: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "cli" }),
  backend: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "local" }),
  orchestrationMode: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "multi_agent" }),
  coordinationMode: langgraph.Annotation({ reducer: (_a, b) => b, default: () => "staged_handoff" }),
  lastUpdated: langgraph.Annotation({ reducer: (_a, b) => b, default: () => nowIso() })
});
function mergeGraphState(state, patch) {
  return {
    ...state,
    ...patch,
    stageHistory: patch.stageHistory ? [...state.stageHistory, ...patch.stageHistory] : state.stageHistory,
    evidenceChain: patch.evidenceChain ? [...state.evidenceChain, ...patch.evidenceChain] : state.evidenceChain,
    artifacts: patch.artifacts ? [...state.artifacts, ...patch.artifacts] : state.artifacts,
    activeSpecialists: patch.activeSpecialists ? { ...state.activeSpecialists, ...patch.activeSpecialists } : state.activeSpecialists,
    collectedBriefs: patch.collectedBriefs ? { ...state.collectedBriefs, ...patch.collectedBriefs } : state.collectedBriefs,
    pendingBriefs: patch.pendingBriefs ?? state.pendingBriefs,
    blockers: patch.blockers ?? state.blockers,
    backtrackCount: patch.backtrackCount ? { ...state.backtrackCount, ...patch.backtrackCount } : state.backtrackCount
  };
}
async function persistNodePatch(state, patch) {
  const evidenceEvents = Array.isArray(patch.evidenceChain) ? patch.evidenceChain : [];
  for (const event of evidenceEvents) {
    const actionEvent = {
      schema_version: "2",
      event_id: event.eventId,
      ts_ms: event.timestamp,
      run_id: state.runId,
      session_id: state.sessionId,
      agent_id: event.agentId,
      event_type: event.eventType,
      status: ["ok", "error", "sent", "pass", "fail", "blocked", "entered", "warning", "timeout", "completed"].includes(event.status) ? event.status : "ok",
      duration_ms: 0,
      refs: [],
      payload: event.payload
    };
    await storageAdapter.appendActionEvent(state.sessionId, actionEvent);
    const win2 = electron.BrowserWindow.getAllWindows()[0];
    if (win2 && !win2.isDestroyed()) {
      win2.webContents.send("evidence:eventAdded", actionEvent);
    }
  }
  const nextState = mergeGraphState(state, patch);
  await storageAdapter.updateRun(state.caseId, state.runId, {
    lastStage: nextState.currentStage,
    runtime: {
      workflow_stage: nextState.currentStage
    }
  });
  const win = electron.BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send("workflow:stateChanged", projectToWorkflowState(nextState));
    win.webContents.send("workflow:stageChanged", {
      stage: nextState.currentStage,
      blockers: nextState.blockers
    });
  }
}
function wrapNode(nodeFn) {
  return async (state) => {
    const patch = await nodeFn(state);
    await persistNodePatch(state, patch);
    return patch;
  };
}
async function blockedNode(state) {
  const patch = {
    currentStage: "blocked",
    stageHistory: [state.currentStage],
    evidenceChain: [
      createStageTransitionEvidence(
        { sessionId: state.sessionId, runId: state.runId, currentStage: state.currentStage },
        "blocked"
      )
    ],
    lastUpdated: nowIso()
  };
  await persistNodePatch(state, patch);
  langgraph.interrupt({
    type: "blocked",
    currentStage: state.currentStage,
    blockers: state.blockers.filter((blocker) => !blocker.resolvedAt)
  });
  return patch;
}
async function awaitingUserInputNode(state) {
  const patch = {
    currentStage: "awaiting_user_input",
    stageHistory: [state.currentStage],
    evidenceChain: [
      createStageTransitionEvidence(
        { sessionId: state.sessionId, runId: state.runId, currentStage: state.currentStage },
        "awaiting_user_input"
      )
    ],
    lastUpdated: nowIso()
  };
  await persistNodePatch(state, patch);
  langgraph.interrupt({
    type: "awaiting_user_input",
    currentStage: state.currentStage,
    reason: state.interruptReason || "User input required"
  });
  return patch;
}
async function specialistExecNode(state) {
  const activeSpecialists = { ...state.activeSpecialists };
  const collectedBriefs = { ...state.collectedBriefs };
  const artifacts = [];
  const evidenceChain = [];
  const targets = Object.values(activeSpecialists).filter((specialist) => (specialist.status === "running" || specialist.status === "pending") && specialist.objective);
  await Promise.all(targets.map(async (specialist) => {
    try {
      const response = await agentOrchestrator.sendMessage(
        specialist.agentId,
        specialist.objective,
        {
          caseId: state.caseId,
          runId: state.runId,
          sessionId: state.sessionId
        }
      );
      const notePath = path.join(storageAdapter.getRunPath(state.caseId, state.runId), "notes", `${specialist.agentId}.md`);
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.writeFileSync(notePath, response, "utf8");
      artifacts.push(createArtifact("specialist_brief", notePath, specialist.agentId));
      activeSpecialists[specialist.agentId] = {
        ...specialist,
        status: "completed",
        brief: response,
        completedAt: nowIso(),
        artifacts: [...specialist.artifacts, notePath]
      };
      collectedBriefs[specialist.agentId] = response;
      evidenceChain.push(createSpecialistCompleteEvidence(
        { sessionId: state.sessionId, runId: state.runId },
        specialist.agentId,
        response,
        [notePath]
      ));
    } catch (error) {
      activeSpecialists[specialist.agentId] = {
        ...specialist,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
      evidenceChain.push({
        eventId: crypto.randomUUID(),
        eventType: "specialist_failed",
        agentId: specialist.agentId,
        status: "error",
        timestamp: Date.now(),
        payload: {
          error: error instanceof Error ? error.message : String(error),
          runId: state.runId,
          sessionId: state.sessionId
        }
      });
    }
  }));
  const patch = {
    currentStage: "dispatch",
    stageHistory: [state.currentStage],
    activeSpecialists,
    collectedBriefs,
    pendingBriefs: [],
    artifacts,
    evidenceChain,
    lastUpdated: nowIso()
  };
  await persistNodePatch(state, patch);
  return patch;
}
function createWorkflowGraph(config = {}) {
  const graph = new langgraph.StateGraph(WorkflowAnnotation).addNode("preflight", wrapNode(preflightNode)).addNode("entry_gate", wrapNode(entryGateNode)).addNode("intake_gate", wrapNode(intakeGateNode)).addNode("plan", wrapNode(intentGateNode)).addNode("speclist", wrapNode(intakeInitNode)).addNode("dispatch", wrapNode(specialistDispatchNode)).addNode("specialist_exec", specialistExecNode).addNode("specialist_briefs", wrapNode(specialistBriefsNode)).addNode("investigate", wrapNode(expertInvestigationNode)).addNode("fix_verify", wrapNode(fixVerificationNode)).addNode("skepti", wrapNode(skepticNode)).addNode("curate", wrapNode(curatorNode)).addNode("finalize", wrapNode(finalizeNode)).addNode("blocked", blockedNode).addNode("awaiting_user_input", awaitingUserInputNode);
  graph.addEdge(langgraph.START, "preflight");
  graph.addConditionalEdges("preflight", (state) => routeAfterPreflight(state) === "blocked" ? "blocked" : "entry_gate");
  graph.addConditionalEdges("entry_gate", (state) => routeAfterEntryGate(state) === "blocked" ? "blocked" : "intake_gate");
  graph.addConditionalEdges("intake_gate", (state) => routeAfterIntakeGate(state) === "blocked" ? "blocked" : "plan");
  graph.addConditionalEdges("plan", (state) => routeAfterIntentGate(state) === "blocked" ? "blocked" : "speclist");
  graph.addConditionalEdges("speclist", (state) => routeAfterIntakeInit(state) === "blocked" ? "blocked" : "dispatch");
  graph.addEdge("dispatch", "specialist_exec");
  graph.addEdge("specialist_exec", "specialist_briefs");
  graph.addConditionalEdges("specialist_briefs", (state) => {
    const route = routeAfterSpecialistBriefs(state);
    if (route === "blocked") return "blocked";
    if (route === "specialist_exec") return "specialist_exec";
    return "investigate";
  });
  graph.addConditionalEdges("investigate", (state) => routeAfterExpertInvestigation(state) === "blocked" ? "blocked" : "fix_verify");
  graph.addConditionalEdges("fix_verify", (state) => {
    const route = routeAfterFixVerification(state);
    if (route === "blocked") return "blocked";
    if (route === "expert_investigation") return "investigate";
    return "skepti";
  });
  graph.addConditionalEdges("skepti", (state) => {
    const route = routeAfterSkeptic(state);
    if (route === "blocked") return "blocked";
    if (route === "fix_verification") return "fix_verify";
    return "curate";
  });
  graph.addConditionalEdges("curate", (state) => {
    const route = routeAfterCurator(state);
    if (route === "blocked") return "blocked";
    return route === "curator" ? "curate" : "finalize";
  });
  graph.addEdge("finalize", langgraph.END);
  return graph.compile({
    checkpointer: config.checkpointer || new langgraph.MemorySaver()
  });
}
class FileCheckpointSaver extends langgraphCheckpoint.BaseCheckpointSaver {
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
let compiledGraph = null;
let checkpointSaver = null;
let currentSessionId = null;
let currentProjectId = null;
let currentRunId = null;
let mainWindow$1 = null;
let toolTraceSubscribed = false;
async function initWorkflowGraph(workspacePath) {
  checkpointSaver = new FileCheckpointSaver(workspacePath);
  compiledGraph = createWorkflowGraph({ checkpointer: checkpointSaver });
  try {
    currentSessionId = await storageAdapter.getCurrentSessionId();
    currentProjectId = storageAdapter.getCurrentProjectId();
  } catch (error) {
    console.warn("[IPC] Failed to restore current session id:", error);
    currentSessionId = null;
    currentProjectId = null;
  }
}
function getThreadId() {
  return currentSessionId || "default-thread";
}
function getGraphConfig() {
  return {
    configurable: {
      thread_id: getThreadId(),
      checkpoint_ns: currentRunId || void 0
    }
  };
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
function broadcastToRenderer(channel, ...args) {
  const windows = electron.BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}
function isInterrupted(result) {
  return result !== null && typeof result === "object" && "__interrupt__" in result && Array.isArray(result.__interrupt__);
}
function registerIPCHandlers() {
  if (!toolTraceSubscribed) {
    toolBridge.onToolTrace((trace) => {
      broadcastToRenderer("tool:executionComplete", trace);
      runtimeLogService.log({
        scope: currentSessionId ? "session" : "app",
        namespace: "tool",
        severity: trace.result.ok ? "success" : "error",
        title: trace.toolName,
        summary: trace.result.ok ? "工具调用已完成。" : trace.result.error?.message ?? "工具调用失败。",
        detail: trace.result.duration_ms ? `${trace.result.duration_ms}ms` : void 0,
        sessionId: currentSessionId,
        projectId: currentProjectId,
        runId: currentRunId,
        raw: {
          args: trace.args,
          result: trace.result,
          contextId: trace.contextId,
          runtimeOwner: trace.runtimeOwner,
          ownerLeaseId: trace.ownerLeaseId ?? null
        },
        timestamp: trace.timestamp
      });
    });
    toolTraceSubscribed = true;
  }
  try {
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    agentOrchestrator.applyLlmConfig(llmConfig);
    console.log("[IPC] Loaded persisted LLM config");
  } catch (err) {
    console.warn("[IPC] Failed to preload LLM config:", err);
  }
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
      productName: electron.app.getName(),
      systemTheme: electron.nativeTheme.shouldUseDarkColors ? "dark" : "light"
    };
  });
  electron.ipcMain.handle("app:selectAvatar", async () => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      properties: ["openFile"]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  electron.ipcMain.handle("app:openPath", async (_event, targetPath) => {
    if (!targetPath) return { success: false, error: "path is required" };
    try {
      const stats = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null;
      if (stats?.isDirectory()) {
        await electron.shell.openPath(targetPath);
      } else {
        electron.shell.showItemInFolder(targetPath);
      }
    } catch {
      electron.shell.showItemInFolder(targetPath);
    }
    return { success: true };
  });
  electron.ipcMain.handle("app:copyText", async (_event, text) => {
    electron.clipboard.writeText(text ?? "");
    return { success: true };
  });
  electron.ipcMain.handle("workflow:getState", async () => {
    if (!ensureGraphInitialized()) {
      return null;
    }
    try {
      const config = getGraphConfig();
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
  electron.ipcMain.handle("workflow:resume", async (_event, sessionId) => {
    try {
      if (sessionId) {
        currentSessionId = sessionId;
        await storageAdapter.setCurrentSessionId(sessionId);
        currentRunId = storageAdapter.getLatestRun(sessionId)?.runId || null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  electron.ipcMain.handle("workflow:listRuns", async () => {
    if (!currentSessionId) {
      return { runs: [] };
    }
    return { runs: storageAdapter.listRuns(currentSessionId) };
  });
  electron.ipcMain.handle("project:list", async () => {
    return { projects: storageAdapter.listProjects() };
  });
  electron.ipcMain.handle("project:add", async (_event, rootPath) => {
    try {
      const project = storageAdapter.createProject(rootPath);
      currentProjectId = project.projectId;
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:remove", async (_event, projectId) => {
    try {
      storageAdapter.removeProject(projectId);
      if (currentProjectId === projectId) {
        currentProjectId = null;
        currentSessionId = null;
        currentRunId = null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:inputs:list", async (_event, projectId) => {
    return { inputs: storageAdapter.listProjectInputs(projectId) };
  });
  electron.ipcMain.handle("project:inputs:refresh", async (_event, projectId) => {
    const inputs = storageAdapter.refreshProjectInputs(projectId);
    broadcastToRenderer("project:inputsChanged", { projectId, inputs });
    return { inputs };
  });
  electron.ipcMain.handle("project:inputs:import", async (_event, projectId) => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "RenderDoc Capture", extensions: ["rdc"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, inputs: storageAdapter.listProjectInputs(projectId) };
    }
    const inputs = storageAdapter.importProjectInputs(projectId, result.filePaths);
    broadcastToRenderer("project:inputsChanged", { projectId, inputs });
    return { success: true, inputs };
  });
  electron.ipcMain.handle("session:list", async (_event, projectId) => {
    const resolvedProjectId = projectId || currentProjectId;
    if (!resolvedProjectId) {
      return { sessions: [] };
    }
    return { sessions: storageAdapter.listSessions(resolvedProjectId) };
  });
  electron.ipcMain.handle("session:create", async (_event, projectId, title) => {
    try {
      const session = storageAdapter.createSession(projectId, title);
      currentProjectId = session.projectId;
      currentSessionId = session.sessionId;
      currentRunId = null;
      await storageAdapter.setCurrentSessionId(session.sessionId);
      return { success: true, session };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("session:rename", async (_event, id, title) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { success: false, error: "Session 名称不能为空。" };
    }
    const session = storageAdapter.updateSession(id, { title: trimmedTitle });
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    return { success: true, session };
  });
  electron.ipcMain.handle("session:select", async (_event, id) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    currentSessionId = id;
    currentProjectId = session.projectId;
    currentRunId = session.lastRunId || null;
    await storageAdapter.setCurrentSessionId(id);
    return {
      success: true,
      session,
      currentRun: storageAdapter.getLatestRun(id)
    };
  });
  electron.ipcMain.handle("run:list", async (_event, sessionId) => {
    return { runs: storageAdapter.listRuns(sessionId) };
  });
  electron.ipcMain.handle("runtimeLog:list", async (_event, request) => {
    return {
      entries: runtimeLogService.list(request.scope, request.sessionId)
    };
  });
  electron.ipcMain.handle("context:get", async () => {
    return rdxSessionService.snapshotContext();
  });
  electron.ipcMain.handle("capture:list", async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });
  electron.ipcMain.handle(
    "capture:openProjectInput",
    async (_event, request) => {
      try {
        runtimeLogService.log({
          scope: currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "info",
          title: "Open project input",
          summary: `开始打开 ${request.inputId}。`,
          detail: request.filePath,
          sessionId: currentSessionId,
          projectId: request.projectId,
          runId: currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath
          }
        });
        const input = storageAdapter.listProjectInputs(request.projectId).find((entry) => entry.inputId === request.inputId && entry.filePath === request.filePath);
        if (!input) {
          return { success: false, error: `Project input not found: ${request.inputId}` };
        }
        const replayDevice = replayDeviceService.getDeviceById(request.replayDeviceId);
        if (!replayDevice) {
          return { success: false, error: `Replay device not found: ${request.replayDeviceId}` };
        }
        const openedCapture = await rdxSessionService.openProjectInput({
          projectId: request.projectId,
          inputId: input.inputId,
          filePath: input.filePath,
          replayDevice
        });
        const contextSnapshot = rdxSessionService.snapshotContext();
        broadcastToRenderer("capture:openedStateChanged", openedCapture);
        broadcastToRenderer("context:changed", contextSnapshot);
        runtimeLogService.log({
          scope: currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "success",
          title: "Project input opened",
          summary: `${input.fileName} 已打开。`,
          detail: openedCapture.preview?.source === "framebuffer_screenshot" ? "预览来源：framebuffer" : openedCapture.preview?.source === "capture_thumbnail" ? "预览来源：thumbnail" : "当前无可用预览",
          sessionId: currentSessionId,
          projectId: request.projectId,
          runId: currentRunId,
          raw: {
            openedCapture,
            contextSnapshot
          }
        });
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
        runtimeLogService.log({
          scope: currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "error",
          title: "Project input open failed",
          summary: err instanceof Error ? err.message : String(err),
          sessionId: currentSessionId,
          projectId: request.projectId,
          runId: currentRunId,
          raw: {
            inputId: request.inputId,
            replayDeviceId: request.replayDeviceId,
            filePath: request.filePath
          }
        });
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
  electron.ipcMain.handle("capture:getOpenedState", async () => {
    return rdxSessionService.snapshotOpenedCapture();
  });
  electron.ipcMain.handle("capture:clearOpenedState", async () => {
    await rdxSessionService.closeOrReplaceOpenedCapture();
    broadcastToRenderer("capture:openedStateChanged", null);
    broadcastToRenderer("context:changed", rdxSessionService.snapshotContext());
    runtimeLogService.log({
      scope: currentSessionId ? "session" : "app",
      namespace: "capture",
      severity: "info",
      title: "Opened capture cleared",
      summary: "当前打开的 capture 已清理。",
      sessionId: currentSessionId,
      projectId: currentProjectId,
      runId: currentRunId
    });
    return { success: true };
  });
  electron.ipcMain.handle("capture:select", async (_event, captureId) => {
    try {
      await rdxSessionService.switchActiveCapture(captureId);
      broadcastToRenderer("capture:statusChanged", { captureId, status: "selected" });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  electron.ipcMain.handle("workflow:start", async (_event, request) => {
    const capturePaths = request.captures.map((capture) => capture.filePath);
    const goal = request.goal;
    try {
      if (!ensureGraphInitialized()) {
        return {
          success: false,
          error: "WorkflowGraph not initialized"
        };
      }
      let contextSnapshot;
      try {
        contextSnapshot = await rdxSessionService.bootstrap(request);
        broadcastToRenderer("context:changed", contextSnapshot);
        broadcastToRenderer("capture:openedStateChanged", rdxSessionService.snapshotOpenedCapture());
      } catch (bootstrapErr) {
        const message = bootstrapErr instanceof Error ? bootstrapErr.message : String(bootstrapErr);
        console.warn("[IPC] rdxSessionService bootstrap failed:", bootstrapErr);
        return {
          success: false,
          error: message
        };
      }
      const gateResult = await harnessController.executeEntryGate({
        capturePaths,
        platform: "rdc-agent",
        entryMode: "cli",
        backend: request.captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local",
        mode: request.mode,
        captures: request.captures,
        replayDevice: request.replayDevice
      });
      if (gateResult.status === "blocked") {
        return {
          success: false,
          error: gateResult.blockers.map((b) => b.reason).join("; ")
        };
      }
      const caseId = request.sessionId || await storageAdapter.createCase({
        projectId: request.projectId,
        userGoal: goal,
        symptomSummary: goal
      });
      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        capturePaths,
        mode: request.mode,
        goal,
        captures: request.captures,
        backend: request.captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local"
      });
      currentSessionId = sessionId;
      currentRunId = runId;
      currentProjectId = request.projectId;
      await storageAdapter.setCurrentSessionId(sessionId);
      if (contextSnapshot) {
        await storageAdapter.updateRun(sessionId, runId, {
          runtime: {
            context_id: contextSnapshot.contextId,
            runtime_owner: contextSnapshot.runtimeOwner,
            session_id: sessionId
          }
        });
      }
      const config = getGraphConfig();
      const initialState = {
        caseId,
        runId,
        sessionId,
        userGoal: goal,
        capturePaths,
        currentStage: "preflight",
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
        backend: request.captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local",
        mode: request.mode,
        goal,
        captures: request.captures,
        primaryCaptureId: request.primaryCaptureId,
        replayDevice: request.replayDevice,
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
      return { success: true, caseId, runId, sessionId, contextSnapshot };
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
      const config = getGraphConfig();
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
      const config = getGraphConfig();
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
      const config = getGraphConfig();
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
        const config = getGraphConfig();
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
    return {
      sessionId,
      runId: currentRunId || storageAdapter.getLatestRun(sessionId)?.runId || "",
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
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getAll({
      workspaceRoot: paths.workspaceRoot,
      defaultWorkspaceRoot: paths.defaultWorkspaceRoot,
      settingsPath: paths.settingsPath,
      logsPath: paths.logsPath,
      logPath: paths.logPath,
      projectsPath: paths.projectsPath,
      knowledgePath: paths.knowledgePath,
      migrationOrphansPath: paths.migrationOrphansPath,
      profilesPath: paths.profilesPath,
      policiesPath: paths.policiesPath,
      secretsPath: paths.secretsPath,
      migrationReportsPath: paths.migrationReportsPath
    });
  });
  electron.ipcMain.handle("settings:getProviderSecret", async (_event, providerId) => {
    const paths = appPathService.getWorkspacePaths();
    return settingsService.getProviderSecret(providerId, paths.workspaceRoot);
  });
  electron.ipcMain.handle("settings:set", async (_event, settings) => {
    const nextSettings = settingsService.setAll(settings, appPathService.getWorkspacePaths());
    storageAdapter.setWorkspaceRoot(nextSettings.workspace.rootPath);
    await storageAdapter.initializeWorkspace();
    await initWorkflowGraph(storageAdapter.getWorkspacePath());
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    agentOrchestrator.applyLlmConfig(llmConfig);
    return nextSettings;
  });
  electron.ipcMain.handle("device:list", async () => {
    return replayDeviceService.listDevices();
  });
  electron.ipcMain.handle("device:refresh", async () => {
    return replayDeviceService.refreshDevices();
  });
  electron.ipcMain.handle("device:activate", async (_event, deviceId) => {
    return replayDeviceService.activateDevice(deviceId);
  });
  electron.nativeTheme.on("updated", () => {
    broadcastToRenderer("app:themeChanged", electron.nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
}
function setMainWindow(window) {
  mainWindow$1 = window;
  replayDeviceService.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
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
class RdxSessionService {
  toolBridge;
  contextId = null;
  runtimeOwner = null;
  ownerLeaseId = null;
  captures = [];
  activeCaptureId = null;
  deviceLabel = "Local";
  replayDevice = null;
  remoteStatus = "disconnected";
  remoteId = null;
  openedCapture = null;
  constructor(toolBridge2) {
    this.toolBridge = toolBridge2;
  }
  async bootstrap(request) {
    if (this.canReuseOpenedCapture(request)) {
      this.captures = request.captures.map((capture) => capture.id === request.primaryCaptureId && this.openedCapture ? {
        ...capture,
        status: "open",
        sessionId: this.openedCapture.sessionId,
        replaySessionId: this.openedCapture.replaySessionId,
        contextId: this.openedCapture.contextId
      } : { ...capture });
      this.activeCaptureId = request.primaryCaptureId;
      return this.snapshotContext();
    }
    await this.ensureRuntimeReady();
    this.captures = request.captures.map((capture) => ({ ...capture }));
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === "remote");
    let replayDevice = request.replayDevice;
    let reusedPreparedRemote = false;
    if (hasRemoteCapture) {
      if (replayDevice.type === "local") {
        throw new Error("Remote capture requires an Android Replay Device.");
      }
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    if (!reusedPreparedRemote) {
      await this.prepareFreshContext();
    }
    try {
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
    } catch (error) {
      if (!reusedPreparedRemote) {
        throw error;
      }
      this.resetRemoteConnectionState();
      await this.prepareFreshContext();
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
      reusedPreparedRemote = false;
    }
    if (hasRemoteCapture) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = "disconnected";
          await this.ensureRemoteConnection(replayDevice);
        } else {
          this.remoteStatus = "online";
        }
      } else {
        await this.ensureRemoteConnection(replayDevice);
      }
    }
    const primaryCapture = this.captures.find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture) {
      throw new Error(`Primary capture ${request.primaryCaptureId} not found in captures list`);
    }
    await this.ensureCaptureSession(primaryCapture);
    this.activeCaptureId = primaryCapture.id;
    this.openedCapture = null;
    return this.snapshotContext();
  }
  async openProjectInput(request) {
    await this.closeOrReplaceOpenedCapture();
    await this.ensureRuntimeReady();
    let replayDevice = request.replayDevice;
    const isRemoteReplay = replayDevice.type === "android";
    if (isRemoteReplay) {
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
    }
    const capture = {
      id: request.inputId,
      filePath: request.filePath,
      role: "primary",
      backendHint: isRemoteReplay ? "remote" : "local",
      status: "pending"
    };
    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = replayDevice;
    this.deviceLabel = replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    let reusedPreparedRemote = false;
    if (isRemoteReplay) {
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }
    if (!reusedPreparedRemote) {
      await this.prepareFreshContext();
    }
    try {
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
    } catch (error) {
      if (!reusedPreparedRemote) {
        throw error;
      }
      this.resetRemoteConnectionState();
      await this.prepareFreshContext();
      const ownerResult = await this.claimOwner(this.contextId);
      this.runtimeOwner = ownerResult.owner;
      this.ownerLeaseId = ownerResult.leaseId;
      reusedPreparedRemote = false;
    }
    if (isRemoteReplay) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = "disconnected";
          await this.ensureRemoteConnection(replayDevice);
        } else {
          this.remoteStatus = "online";
        }
      } else {
        await this.ensureRemoteConnection(replayDevice);
      }
    }
    const preview = await this.ensureCaptureSession(capture, {
      projectId: request.projectId,
      inputId: request.inputId
    });
    const openedCapture = this.createOpenedCaptureState(
      request.projectId,
      request.inputId,
      request.filePath,
      replayDevice,
      preview
    );
    this.openedCapture = openedCapture;
    return openedCapture;
  }
  async closeOrReplaceOpenedCapture() {
    const previousCapture = this.openedCapture;
    this.openedCapture = null;
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.captures = [];
    this.activeCaptureId = null;
    this.deviceLabel = "Local";
    this.replayDevice = null;
    this.remoteStatus = "disconnected";
    this.remoteId = null;
    if (previousCapture) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "info",
        title: "Capture replaced",
        summary: `${previousCapture.inputId} 的打开态已清理。`,
        projectId: previousCapture.projectId,
        raw: previousCapture
      });
    }
  }
  async prepareFreshContext() {
    this.contextId = await this.allocateContext();
    await this.initializeContextRuntime();
  }
  async ensureRuntimeReady() {
    const statusResult = await this.toolBridge.executeCLI("daemon", ["status"]);
    if (statusResult.exitCode === 0) {
      try {
        const parsed = JSON.parse(statusResult.stdout);
        if (parsed.data?.running === true) {
          return;
        }
      } catch {
        return;
      }
    }
    const startResult = await this.toolBridge.executeCLI("daemon", ["start"]);
    if (startResult.exitCode !== 0) {
      const message = startResult.stderr.trim() || `Exit code: ${startResult.exitCode}`;
      throw new Error(`Failed to start rdx daemon: ${message}`);
    }
  }
  async allocateContext() {
    const contextId = `ctx-${generateShortId()}`;
    const result = await this.toolBridge.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId },
      contextId
    });
    if (!result.ok) {
      if (result.error?.message?.includes("Context limit exceeded")) {
        const reusableContextId = await this.resolveReusableContextId();
        if (reusableContextId) {
          return reusableContextId;
        }
      }
      throw new Error(`Failed to allocate context: ${result.error?.message ?? "unknown"}`);
    }
    return contextId;
  }
  async resolveReusableContextId() {
    const daemonResult = await this.toolBridge.executeCLI("daemon", ["start"]);
    if (daemonResult.exitCode !== 0 || !daemonResult.stdout.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(daemonResult.stdout);
      return parsed.data?.state?.context_id ?? null;
    } catch {
      return null;
    }
  }
  async initializeContextRuntime() {
    const result = await this.toolBridge.call({
      toolName: "rd.core.init",
      args: {},
      contextId: this.contextId
    });
    if (!result.ok) {
      throw new Error(`Failed to initialize runtime context: ${result.error?.message ?? "unknown"}`);
    }
  }
  async claimOwner(contextId) {
    const owner = `rdc-agent-${generateShortId()}`;
    const leaseId = generateId();
    const result = await this.toolBridge.call({
      toolName: "rd.session.claim_owner",
      args: { context_id: contextId, owner, lease_id: leaseId },
      contextId,
      runtimeOwner: owner
    });
    if (!result.ok) {
      throw new Error(`Failed to claim owner: ${result.error?.message ?? "unknown"}`);
    }
    return { owner, leaseId };
  }
  buildClaimedToolRequest(toolName, args) {
    return {
      toolName,
      args,
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId ?? void 0
    };
  }
  async ensureCaptureSession(capture, previewContext) {
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    if (captureIndex < 0) {
      throw new Error(`Capture ${capture.id} not in captures list`);
    }
    this.captures[captureIndex] = { ...this.captures[captureIndex], status: "opening" };
    try {
      const openResult = await this.toolBridge.call(this.buildClaimedToolRequest(
        "rd.capture.open_file",
        { file_path: capture.filePath }
      ));
      if (!openResult.ok) {
        throw new Error(`Failed to open capture file: ${openResult.error?.message ?? "unknown"}`);
      }
      const captureFileId = openResult.data?.capture_file_id;
      const replayArgs = {
        capture_file_id: captureFileId ?? capture.id
      };
      if (capture.backendHint === "remote") {
        if (!this.remoteId) {
          throw new Error("Remote replay requested but remote connection is not ready.");
        }
        replayArgs.options = {
          remote_id: this.remoteId
        };
      }
      const replayResult = await this.toolBridge.call(this.buildClaimedToolRequest(
        "rd.capture.open_replay",
        replayArgs
      ));
      if (!replayResult.ok) {
        if (capture.backendHint === "remote") {
          throw new Error(`Remote replay failed (hard fail, no local fallback): ${replayResult.error?.message ?? "unknown"}`);
        }
        throw new Error(`Failed to open replay session: ${replayResult.error?.message ?? "unknown"}`);
      }
      this.captures[captureIndex] = {
        ...this.captures[captureIndex],
        status: "open",
        sessionId: replayResult.data?.session_id,
        replaySessionId: replayResult.data?.replay_session_id,
        contextId: this.contextId
      };
      if (!previewContext || !captureFileId) {
        return null;
      }
      return this.loadPreferredPreview(
        previewContext.projectId,
        previewContext.inputId,
        this.captures[captureIndex].sessionId ?? "",
        captureFileId
      );
    } catch (error) {
      this.captures[captureIndex] = { ...this.captures[captureIndex], status: "error" };
      throw error;
    }
  }
  async switchActiveCapture(captureId) {
    const capture = this.captures.find((item) => item.id === captureId);
    if (!capture) {
      throw new Error(`Capture ${captureId} not found`);
    }
    if (capture.status === "pending") {
      await this.ensureCaptureSession(capture);
    }
    this.activeCaptureId = captureId;
  }
  async ensureRemoteConnection(device) {
    if (!device.serial) {
      throw new Error("Replay Device is missing an Android serial number.");
    }
    this.replayDevice = device;
    this.remoteStatus = "connected";
    const connectResult = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.remote.connect",
      {
        timeout_ms: 5e3,
        options: {
          transport: "adb_android",
          device_serial: device.serial
        }
      }
    ));
    if (!connectResult.ok) {
      this.remoteStatus = "error";
      const detail = [
        device.activationPhase ? `phase=${device.activationPhase}` : "",
        device.activationErrorCode ? `code=${device.activationErrorCode}` : ""
      ].filter(Boolean).join(" ");
      const suffix = detail ? ` (${detail})` : "";
      throw new Error(`Remote connect failed (hard fail): ${connectResult.error?.message ?? device.activationErrorMessage ?? "unknown"}${suffix}`);
    }
    const remoteId = connectResult.data?.remote_id;
    if (!remoteId) {
      this.remoteStatus = "error";
      throw new Error("Remote connect did not return a remote_id.");
    }
    this.remoteId = remoteId;
    const pingResult = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.remote.ping",
      { remote_id: remoteId }
    ));
    if (!pingResult.ok) {
      this.remoteStatus = "error";
      throw new Error(`Remote ping failed (hard fail): ${pingResult.error?.message ?? device.activationErrorMessage ?? "unknown"}`);
    }
    this.remoteStatus = "online";
  }
  async ensureReplayDeviceReady(device) {
    if (device.type === "local") {
      return device;
    }
    const currentDevice = replayDeviceService.getDeviceById(device.id) ?? device;
    if (currentDevice.type === "local") {
      return currentDevice;
    }
    if (["connected", "online"].includes(currentDevice.status)) {
      return currentDevice;
    }
    const activatedDevice = await replayDeviceService.activateDevice(currentDevice.id);
    if (activatedDevice.type === "local" || !["connected", "online"].includes(activatedDevice.status)) {
      throw new Error(
        activatedDevice.activationErrorMessage ?? activatedDevice.lastError ?? `Failed to connect Replay Device ${activatedDevice.label}.`
      );
    }
    return activatedDevice;
  }
  async tryAdoptPreparedRemote(device) {
    const prepared = replayDeviceService.consumePreparedRemote(device.id);
    if (!prepared) {
      return false;
    }
    if (!device.serial || prepared.serial !== device.serial) {
      replayDeviceService.invalidatePreparedRemote(device.id);
      return false;
    }
    this.adoptPreparedRemote(prepared);
    return true;
  }
  adoptPreparedRemote(prepared) {
    this.contextId = prepared.contextId;
    this.remoteId = prepared.remoteId;
    this.remoteStatus = "connected";
  }
  async validatePreparedRemoteHandle() {
    if (!this.contextId || !this.remoteId) {
      return false;
    }
    const pingResult = await this.toolBridge.call({
      toolName: "rd.remote.ping",
      args: { remote_id: this.remoteId },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner ?? void 0,
      ownerLeaseId: this.ownerLeaseId ?? void 0
    });
    if (!pingResult.ok) {
      return false;
    }
    return true;
  }
  resetRemoteConnectionState() {
    this.contextId = null;
    this.runtimeOwner = null;
    this.ownerLeaseId = null;
    this.remoteId = null;
    this.remoteStatus = "disconnected";
  }
  snapshotContext() {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId);
    return {
      contextId: this.contextId ?? "",
      sessionId: activeCapture?.sessionId ?? "",
      backend: activeCapture?.backendHint ?? "local",
      remoteStatus: this.replayDevice?.type === "android" ? this.remoteStatus : void 0,
      runtimeOwner: this.runtimeOwner ?? "",
      ownerLeaseId: this.ownerLeaseId ?? "",
      captureDescriptors: [...this.captures],
      activeCapture: this.activeCaptureId ?? "",
      deviceLabel: this.deviceLabel
    };
  }
  snapshotOpenedCapture() {
    return this.openedCapture ? { ...this.openedCapture } : null;
  }
  clearOpenedCapture() {
    this.openedCapture = null;
  }
  getCaptureDescriptors() {
    return [...this.captures];
  }
  getContextId() {
    return this.contextId;
  }
  getRuntimeOwner() {
    return this.runtimeOwner;
  }
  getOwnerLeaseId() {
    return this.ownerLeaseId;
  }
  createOpenedCaptureState(projectId, inputId, filePath, replayDevice, preview) {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId) ?? this.captures[0];
    return {
      projectId,
      inputId,
      filePath,
      captureId: activeCapture?.id ?? inputId,
      sessionId: activeCapture?.sessionId ?? "",
      contextId: this.contextId ?? "",
      replaySessionId: activeCapture?.replaySessionId ?? "",
      backend: activeCapture?.backendHint ?? "local",
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label,
      status: activeCapture?.status === "error" ? "error" : "open",
      openedAt: Date.now(),
      preview
    };
  }
  async loadPreferredPreview(projectId, inputId, sessionId, captureFileId) {
    const framebufferPreview = sessionId ? await this.loadFramebufferPreview(projectId, inputId, sessionId) : null;
    if (framebufferPreview) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "success",
        title: "Preview ready",
        summary: `已加载 ${inputId} 的最终渲染预览。`,
        detail: framebufferPreview.width > 0 && framebufferPreview.height > 0 ? `${framebufferPreview.width}x${framebufferPreview.height} · framebuffer` : "framebuffer",
        projectId
      });
      return framebufferPreview;
    }
    const thumbnailPreview = await this.loadCaptureThumbnail(captureFileId);
    if (thumbnailPreview) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "warning",
        title: "Preview fallback",
        summary: `最终 framebuffer 不可用，已回退为 ${inputId} 的 capture thumbnail。`,
        detail: thumbnailPreview.width > 0 && thumbnailPreview.height > 0 ? `${thumbnailPreview.width}x${thumbnailPreview.height} · thumbnail` : "thumbnail",
        projectId
      });
      return thumbnailPreview;
    }
    runtimeLogService.log({
      scope: "app",
      namespace: "capture",
      severity: "warning",
      title: "Preview unavailable",
      summary: `已打开 ${inputId}，但当前没有可用预览内容。`,
      projectId
    });
    return null;
  }
  async loadFramebufferPreview(projectId, inputId, sessionId) {
    const outputPath = appPathService.getCapturePreviewPath(projectId, inputId);
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const result = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.export.screenshot",
      {
        session_id: sessionId,
        output_path: outputPath,
        file_format: "png",
        include_alpha: true
      }
    ));
    if (!result.ok) {
      return null;
    }
    const imagePath = this.resolvePreviewPath(result, outputPath);
    return imagePath ? this.createPreviewFromPath(imagePath, "framebuffer_screenshot") : null;
  }
  async loadCaptureThumbnail(captureFileId) {
    const result = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.capture.get_thumbnail",
      {
        capture_file_id: captureFileId,
        max_size_px: 640
      }
    ));
    if (!result.ok) {
      return null;
    }
    const imagePath = this.resolvePreviewPath(result);
    if (!imagePath) {
      return null;
    }
    return this.createPreviewFromPath(
      imagePath,
      "capture_thumbnail",
      typeof result.data?.width === "number" ? result.data.width : void 0,
      typeof result.data?.height === "number" ? result.data.height : void 0
    );
  }
  resolvePreviewPath(result, fallbackPath) {
    const imagePath = typeof result.data?.image_path === "string" ? result.data.image_path : typeof result.data?.saved_path === "string" ? result.data.saved_path : typeof result.data?.artifact_path === "string" ? result.data.artifact_path : typeof result.data?.path === "string" ? result.data.path : result.artifacts?.[0]?.path ?? fallbackPath ?? null;
    return imagePath ? path.resolve(imagePath) : null;
  }
  createPreviewFromPath(imagePath, source, fallbackWidth, fallbackHeight) {
    const normalizedPath = path.resolve(imagePath);
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }
    const image = electron.nativeImage.createFromPath(normalizedPath);
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize();
    return {
      imagePath: normalizedPath,
      imageUrl: url.pathToFileURL(normalizedPath).toString(),
      width: size.width || fallbackWidth || 0,
      height: size.height || fallbackHeight || 0,
      source,
      updatedAt: Date.now()
    };
  }
  canReuseOpenedCapture(request) {
    const primaryCapture = request.captures.find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture || !this.openedCapture) {
      return false;
    }
    return Boolean(
      this.contextId && this.runtimeOwner && this.ownerLeaseId && this.openedCapture.status === "open" && primaryCapture.id === this.openedCapture.inputId && primaryCapture.filePath === this.openedCapture.filePath && primaryCapture.backendHint === this.openedCapture.backend && request.replayDevice.id === this.openedCapture.deviceId
    );
  }
}
const rdxSessionService = new RdxSessionService(toolBridge);
const __dirname$1 = path__namespace.dirname(url.fileURLToPath(require("url").pathToFileURL(__filename).href));
const isDev = (process.env.NODE_ENV === "development" || !electron.app.isPackaged) && process.env.RDC_AGENT_TEST_MODE !== "1";
const isSettingsRebuildOnly = process.env.RDC_AGENT_REBUILD_SETTINGS_ONLY === "1";
let mainWindow = null;
const allowedNavigationOrigins = /* @__PURE__ */ new Set();
function registerAllowedOrigin(url2) {
  try {
    allowedNavigationOrigins.add(new URL(url2).origin);
  } catch {
  }
}
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
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "info",
      title: "Open files",
      summary: `已选择 ${result.filePaths.length} 个外部 .rdc 文件。`,
      raw: {
        filePaths: result.filePaths
      }
    });
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
    // 绐楀彛鏍峰紡
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    backgroundColor: "#08080c"
  });
  if (isDev) {
    const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
    if (rendererUrl) {
      registerAllowedOrigin(rendererUrl);
      mainWindow.loadURL(rendererUrl);
    } else {
      const fallbackUrl = "http://localhost:5173";
      registerAllowedOrigin(fallbackUrl);
      mainWindow.loadURL(fallbackUrl);
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
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("[RendererConsole]", { level, message, line, sourceId });
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[RendererLoadFailed]", { errorCode, errorDescription, validatedURL });
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[RendererProcessGone]", details);
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
  const settings = settingsService.initialize();
  if (isSettingsRebuildOnly) {
    console.log("[SettingsRebuildOnly]", JSON.stringify({
      workspaceRoot: settings.workspace.rootPath,
      settingsPath: settings.paths.settingsPath,
      providerIds: settings.llm.providers.map((provider) => provider.id),
      lastMigrationReportPath: settings.configuration.lastMigrationReportPath ?? null,
      migrationSummary: settings.configuration.lastMigrationSummary
    }));
    electron.app.exit(0);
    return;
  }
  await storageAdapter.initializeWorkspace();
  runtimeLogService.log({
    scope: "app",
    namespace: "system",
    severity: "info",
    title: "App ready",
    summary: "RDC Agent 主进程已启动。",
    raw: {
      workspaceRoot: storageAdapter.getWorkspacePath()
    }
  });
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
  replayDeviceService.dispose();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  replayDeviceService.dispose();
});
electron.app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isAllowedDevOrigin = allowedNavigationOrigins.has(parsedUrl.origin);
    if (!isAllowedDevOrigin && parsedUrl.protocol !== "file:") {
      event.preventDefault();
    }
  });
});
async function initializeServices() {
  try {
    const workspacePath = storageAdapter.getWorkspacePath();
    const hasConfiguredProvider = settingsService.hasConfiguredProvider();
    console.log("[Main] SettingsService initialized, hasConfiguredProvider:", hasConfiguredProvider);
    await rdcToolAdapter.initialize();
    console.log("[Main] RDCToolAdapter initialized");
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "success",
      title: "Tool catalog ready",
      summary: "RDC 工具目录已加载。"
    });
    await initWorkflowGraph(workspacePath);
    console.log("[Main] WorkflowGraph initialized");
    await replayDeviceService.initialize();
    console.log("[Main] ReplayDeviceService initialized");
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "success",
      title: "Services ready",
      summary: "主进程服务初始化完成。"
    });
  } catch (error) {
    console.error("[Main] Failed to initialize services:", error);
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "error",
      title: "Service init failed",
      summary: error instanceof Error ? error.message : String(error)
    });
  }
}
function getMainWindow() {
  return mainWindow;
}
exports.getMainWindow = getMainWindow;
exports.rdxSessionService = rdxSessionService;
