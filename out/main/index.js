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
const crypto = require("crypto");
const http = require("http");
const Store = require("electron-store");
const zod = require("zod");
const events = require("events");
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
function nowIso$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
class ToolBridge {
  toolsPath;
  runtime;
  catalog = null;
  activeProcesses = /* @__PURE__ */ new Map();
  traceListeners = /* @__PURE__ */ new Set();
  constructor() {
    this.runtime = this.resolveToolRuntime();
    this.toolsPath = this.runtime.toolsRoot;
  }
  resolveToolRuntime() {
    const externalRoot = !electron.app.isPackaged ? process.env.RDX_TOOLS_ROOT?.trim() : void 0;
    const toolsRoot = externalRoot ? path__namespace.resolve(externalRoot) : this.resolveBundledToolsRoot();
    return {
      source: externalRoot ? "external" : "bundled",
      toolsRoot,
      version: this.readRuntimeVersion(toolsRoot),
      catalogPath: path__namespace.join(toolsRoot, "spec", "tool_catalog.json")
    };
  }
  resolveBundledToolsRoot() {
    const appPath = electron.app.getAppPath();
    const candidates = electron.app.isPackaged ? [
      path__namespace.join(process.resourcesPath, "resources", "tools"),
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
  readRuntimeVersion(toolsRoot) {
    const pyprojectPath = path__namespace.join(toolsRoot, "pyproject.toml");
    if (!fs__namespace.existsSync(pyprojectPath)) {
      return null;
    }
    try {
      const content = fs__namespace.readFileSync(pyprojectPath, "utf-8");
      const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }
  createRuntimeMetadata(catalog) {
    return {
      source: this.runtime.source,
      toolsRoot: this.runtime.toolsRoot,
      version: this.runtime.version,
      catalog: {
        path: this.runtime.catalogPath,
        exists: fs__namespace.existsSync(this.runtime.catalogPath),
        schemaVersion: catalog?.schema_version ?? null,
        generatedAt: catalog?.generated_at ?? null,
        toolCount: catalog?.tool_count ?? (Array.isArray(catalog?.tools) ? catalog.tools.length : null)
      }
    };
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
  getRuntimeMetadata() {
    return this.createRuntimeMetadata(this.catalog ?? void 0);
  }
  resolveDirectCliSpec() {
    const pythonPath = path__namespace.join(this.toolsPath, "binaries", "windows", "x64", "python", "python.exe");
    const runCliPath = path__namespace.join(this.toolsPath, "cli", "run_cli.py");
    if (!fs__namespace.existsSync(pythonPath)) {
      throw new Error(`RDX python runtime not found: ${pythonPath}`);
    }
    if (!fs__namespace.existsSync(runCliPath)) {
      throw new Error(`CLI launcher not found: ${runCliPath}`);
    }
    return {
      pythonPath,
      runCliPath
    };
  }
  normalizeCliArgs(args) {
    const normalized = [];
    for (let index = 0; index < args.length; index += 1) {
      const current = args[index];
      if (current === "--context-id") {
        normalized.push("--daemon-context");
        continue;
      }
      normalized.push(current);
    }
    return normalized;
  }
  buildDirectCliArgs(command, args) {
    const normalized = this.normalizeCliArgs(args);
    const globalArgs = [];
    const commandArgs = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const current = normalized[index];
      if (current === "--daemon-context") {
        const value = normalized[index + 1];
        if (value) {
          globalArgs.push(current, value);
          index += 1;
          continue;
        }
      }
      commandArgs.push(current);
    }
    return [
      ...globalArgs,
      command,
      ...commandArgs
    ];
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
  getAvailabilityFailure() {
    if (process.platform !== "win32") {
      return "RDX CLI is available only through the bundled Windows launcher in this app.";
    }
    try {
      this.resolveWindowsLauncher();
      return void 0;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  /**
   * 加载工具目录
   */
  async loadCatalog() {
    if (this.catalog) {
      return this.catalog;
    }
    const catalogPath = this.runtime.catalogPath;
    if (!fs__namespace.existsSync(catalogPath)) {
      console.warn("[ToolBridge] Tool catalog not found, starting with empty RDC tool catalog: " + catalogPath);
      this.catalog = {
        schema_version: "1",
        tools: [],
        namespaces: {},
        runtime: this.createRuntimeMetadata()
      };
      return this.catalog;
    }
    const content = await fs__namespace.promises.readFile(catalogPath, "utf-8");
    const catalog = JSON.parse(content);
    this.catalog = {
      ...catalog,
      runtime: this.createRuntimeMetadata(catalog)
    };
    return this.catalog;
  }
  async getRuntimeSummary() {
    const catalog = await this.loadCatalog();
    const namespaceCounts = /* @__PURE__ */ new Map();
    for (const tool of catalog.tools ?? []) {
      namespaceCounts.set(tool.namespace, (namespaceCounts.get(tool.namespace) ?? 0) + 1);
    }
    const namespaces = Object.keys(catalog.namespaces ?? {}).sort().map((namespace) => ({
      namespace: `rd.${namespace}.*`,
      toolCount: namespaceCounts.get(namespace) ?? 0,
      available: (namespaceCounts.get(namespace) ?? 0) > 0
    }));
    return {
      runtime: this.createRuntimeMetadata(catalog),
      cli: {
        available: this.isAvailable(),
        unavailableReason: this.getAvailabilityFailure()
      },
      namespaces,
      recommendedSpecialists: [
        "triage_agent",
        "capture_repro_agent",
        "pass_graph_pipeline_agent",
        "pixel_forensics_agent",
        "shader_ir_agent",
        "skeptic_agent",
        "curator_agent"
      ]
    };
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
    let directCli = null;
    try {
      directCli = this.resolveDirectCliSpec();
    } catch {
      directCli = null;
    }
    return new Promise((resolve, reject) => {
      let proc;
      if (directCli) {
        proc = child_process.spawn(
          directCli.pythonPath,
          [
            directCli.runCliPath,
            ...this.buildDirectCliArgs(command, args)
          ],
          {
            cwd: options.cwd || this.toolsPath,
            env: {
              ...process.env,
              ...options.env,
              RDX_TOOLS_ROOT: this.toolsPath,
              PYTHONIOENCODING: "utf-8",
              RDX_LAUNCHER_PROG: "rdx.bat"
            },
            windowsHide: true
          }
        );
      } else {
        let launcher;
        try {
          launcher = this.resolveWindowsLauncher();
        } catch (error) {
          resolve({
            exitCode: 2,
            stdout: "",
            stderr: error instanceof Error ? error.message : String(error),
            duration_ms: nowMs() - startTime
          });
          return;
        }
        proc = child_process.spawn(
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
      }
      const procId = generateEventId("proc");
      this.activeProcesses.set(procId, {
        process: proc,
        runId: options.runId
      });
      let stdout = "";
      let stderr = "";
      let timeoutId = null;
      let settled = false;
      const finalize = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        this.activeProcesses.delete(procId);
        if (options.abortSignal && abortHandler) {
          options.abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve(result);
      };
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          proc.kill();
          reject(new Error(`Process timeout after ${options.timeout}ms`));
        }, options.timeout);
      }
      const abortHandler = () => {
        try {
          proc.kill();
        } catch {
        }
      };
      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abortHandler();
        } else {
          options.abortSignal.addEventListener("abort", abortHandler, { once: true });
        }
      }
      proc.stdout?.on("data", (data) => {
        stdout += data.toString("utf-8");
      });
      proc.stderr?.on("data", (data) => {
        stderr += data.toString("utf-8");
      });
      proc.on("close", (code) => {
        finalize({
          exitCode: code || 0,
          stdout,
          stderr,
          duration_ms: nowMs() - startTime
        });
      });
      proc.on("error", (error) => {
        finalize({
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
      turnId: request.turnId,
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
      const effectiveArgs = {
        ...request.args || {}
      };
      if (request.contextId && effectiveArgs["context_id"] === void 0) {
        effectiveArgs["context_id"] = request.contextId;
      }
      if (request.runtimeOwner && effectiveArgs["runtime_owner"] === void 0) {
        effectiveArgs["runtime_owner"] = request.runtimeOwner;
      }
      if (request.ownerLeaseId && effectiveArgs["owner_lease_id"] === void 0) {
        effectiveArgs["owner_lease_id"] = request.ownerLeaseId;
      }
      if (Object.keys(effectiveArgs).length > 0) {
        cliArgs.push("--args-json", JSON.stringify(effectiveArgs));
      }
      if (request.contextId) {
        cliArgs.push("--daemon-context", request.contextId);
      }
      const result = await this.executeCLI("call", cliArgs, {
        timeout: 6e4,
        // 60秒超时
        runId: request.runId,
        abortSignal: request.abortSignal
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
  abortRun(runId) {
    for (const { process: process2, runId: activeRunId } of this.activeProcesses.values()) {
      if (activeRunId !== runId) {
        continue;
      }
      try {
        process2.kill();
      } catch {
      }
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
    for (const [id, active] of this.activeProcesses) {
      try {
        active.process.kill();
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
      if (existing && !existing.endsWith("\n")) {
        fs__namespace.appendFileSync(filePath, "\n", "utf-8");
      }
    }
    fs__namespace.appendFileSync(filePath, `${serialized}
`, "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to append to JSONL file: ${filePath}`, error);
    return false;
  }
}
function writeJsonl(filePath, items) {
  try {
    const dir = path__namespace.dirname(filePath);
    if (!fs__namespace.existsSync(dir)) {
      fs__namespace.mkdirSync(dir, { recursive: true });
    }
    const lines = items.map((item) => JSON.stringify(item, null, 0));
    fs__namespace.writeFileSync(filePath, `${lines.join("\n")}
`, "utf-8");
    return true;
  } catch (error) {
    console.error(`Failed to write JSONL file: ${filePath}`, error);
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
      skillsPath: path.join(root, "skills"),
      mcpPath: path.join(root, "mcp"),
      patternsPath: path.join(root, "patterns"),
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
  writeBootstrapState(state2) {
    const bootstrapPath = this.getBootstrapPath();
    fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
    fs.writeFileSync(bootstrapPath, JSON.stringify(state2, null, 2), "utf8");
  }
  ensureWorkspaceStructure(paths) {
    fs.mkdirSync(paths.workspaceRoot, { recursive: true });
    fs.mkdirSync(paths.logsPath, { recursive: true });
    fs.mkdirSync(paths.projectsPath, { recursive: true });
    fs.mkdirSync(paths.knowledgePath, { recursive: true });
    fs.mkdirSync(paths.migrationOrphansPath, { recursive: true });
    fs.mkdirSync(paths.profilesPath, { recursive: true });
    fs.mkdirSync(paths.policiesPath, { recursive: true });
    fs.mkdirSync(paths.skillsPath, { recursive: true });
    fs.mkdirSync(paths.mcpPath, { recursive: true });
    fs.mkdirSync(paths.patternsPath, { recursive: true });
    fs.mkdirSync(paths.secretsPath, { recursive: true });
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
  }
  shouldImportLegacyData(targetRoot) {
    const paths = this.getWorkspacePaths(targetRoot);
    return !fs.existsSync(paths.settingsPath) && !this.hasDirectoryEntries(paths.projectsPath) && !this.hasDirectoryEntries(paths.knowledgePath) && !this.hasDirectoryEntries(paths.logsPath) && !this.hasDirectoryEntries(paths.migrationOrphansPath) && !this.hasDirectoryEntries(paths.profilesPath) && !this.hasDirectoryEntries(paths.policiesPath) && !this.hasDirectoryEntries(paths.skillsPath) && !this.hasDirectoryEntries(paths.mcpPath) && !this.hasDirectoryEntries(paths.patternsPath) && !this.hasDirectoryEntries(paths.secretsPath) && !this.hasDirectoryEntries(paths.migrationReportsPath);
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
    this.copyDirContents(path.join(sourceRoot, "skills"), targetPaths.skillsPath);
    this.copyDirContents(path.join(sourceRoot, "mcp"), targetPaths.mcpPath);
    this.copyDirContents(path.join(sourceRoot, "patterns"), targetPaths.patternsPath);
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
  renameProject(projectId, newName) {
    const registry = this.readRegistry();
    const target = registry.projects.find((project) => project.projectId === projectId);
    if (!target) {
      throw new Error(`Project not found: ${projectId}`);
    }
    target.name = newName;
    target.updatedAt = nowMs();
    this.writeRegistry(registry);
    this.writeProjectMetadata(target);
    return target;
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
  removeSession(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return;
    if (fs__namespace.existsSync(location.sessionPath)) {
      fs__namespace.rmSync(location.sessionPath, { recursive: true, force: true });
    }
    const selection = this.readSelection();
    if (selection.sessionId === sessionId) {
      selection.sessionId = null;
      this.writeSelection(selection);
    }
    this.touchProject(location.project.projectId);
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
    return this.reconcileProjectSessionTitles(project).sort((a, b) => b.updatedAt - a.updatedAt);
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
      title: this.normalizeSessionTitle(projectId, title),
      goal,
      sessionPath: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const sessionPath = path__namespace.join(this.ensureProjectSessionsRoot(project), session.sessionId);
    session.sessionPath = sessionPath;
    this.ensureDir(sessionPath);
    this.ensureDir(path__namespace.join(sessionPath, "attachments"));
    this.ensureDir(path__namespace.join(sessionPath, "timeline"));
    this.ensureDir(path__namespace.join(sessionPath, "runs"));
    this.writeJson(path__namespace.join(sessionPath, "session.json"), session);
    if (!fs__namespace.existsSync(path__namespace.join(sessionPath, "action_chain.jsonl"))) {
      fs__namespace.writeFileSync(path__namespace.join(sessionPath, "action_chain.jsonl"), "", "utf-8");
    }
    if (!fs__namespace.existsSync(path__namespace.join(sessionPath, "conversation.jsonl"))) {
      fs__namespace.writeFileSync(path__namespace.join(sessionPath, "conversation.jsonl"), "", "utf-8");
    }
    if (!fs__namespace.existsSync(path__namespace.join(sessionPath, "attachments.json"))) {
      this.writeJson(path__namespace.join(sessionPath, "attachments.json"), []);
    }
    this.syncSessionEvidence(session.sessionId, session.projectId);
    this.touchProject(project.projectId, session.sessionId, timestamp);
    this.setCurrentProjectId(projectId);
    this.setCurrentSessionId(session.sessionId);
    return session;
  }
  readSession(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const sessions = this.reconcileProjectSessionTitles(location.project);
    return sessions.find((session) => session.sessionId === sessionId) ?? null;
  }
  updateSession(sessionId, patch) {
    const location = this.findSessionLocation(sessionId);
    if (!location) return null;
    const existing = this.readJson(path__namespace.join(location.sessionPath, "session.json"));
    if (!existing) return null;
    const nextSession = {
      ...this.normalizeSessionRecord(existing, location.sessionPath),
      ...patch,
      sessionId: existing.sessionId,
      projectId: existing.projectId,
      sessionPath: location.sessionPath,
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
    const captures = input.captures ? input.captures : input.capturePaths.map((filePath, index) => ({
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
      turnId: input.turnId,
      projectId: session.projectId,
      sessionId,
      caseId: sessionId,
      mode: input.mode || "debugger",
      goal: input.goal || session.goal,
      captures,
      startedAt,
      status: input.status || "queued",
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
    writeYaml(path__namespace.join(runPath, "notes", "debug_plan.yaml"), {
      debug_plan: null,
      pending_questions: null,
      approval_state: "not_requested"
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
        last_updated: nowIso$1(),
        hypotheses: []
      }
    });
    this.updateSession(sessionId, {
      goal: persistedRun.goal,
      lastRunId: runId
    });
    this.syncSessionEvidence(sessionId, session.projectId);
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
    this.syncSessionEvidence(caseId, existing.projectId);
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
    return path__namespace.join(location.sessionPath, "action_chain.jsonl");
  }
  getConversationPath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for conversation history: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "conversation.jsonl");
  }
  getSessionAttachmentsDir(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachments: ${sessionId}`);
    }
    const attachmentsDir = path__namespace.join(location.sessionPath, "attachments");
    this.ensureDir(attachmentsDir);
    return attachmentsDir;
  }
  getSessionAttachmentsManifestPath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for attachment manifest: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "attachments.json");
  }
  getSessionEvidencePath(sessionId) {
    const location = this.findSessionLocation(sessionId);
    if (!location) {
      throw new Error(`Session not found for session evidence: ${sessionId}`);
    }
    return path__namespace.join(location.sessionPath, "session_evidence.yaml");
  }
  getDebugPlanPath(sessionId, runId) {
    return path__namespace.join(this.getRunPath(sessionId, runId), "notes", "debug_plan.yaml");
  }
  readConversationHistory(sessionId) {
    const snapshots = readJsonl(this.getConversationPath(sessionId));
    const latestById = /* @__PURE__ */ new Map();
    for (const snapshot of snapshots) {
      const existing = latestById.get(snapshot.id);
      const existingUpdatedAt = existing?.updatedAt ?? existing?.createdAt ?? 0;
      const nextUpdatedAt = snapshot.updatedAt ?? snapshot.createdAt;
      if (!existing || nextUpdatedAt >= existingUpdatedAt) {
        latestById.set(snapshot.id, snapshot);
      }
    }
    return Array.from(latestById.values()).sort((left, right) => left.createdAt - right.createdAt);
  }
  appendConversationMessage(sessionId, message) {
    appendJsonl(this.getConversationPath(sessionId), message);
  }
  listSessionAttachments(sessionId) {
    return this.readSessionAttachments(sessionId).slice().sort((left, right) => left.createdAt - right.createdAt);
  }
  importSessionAttachments(sessionId, filePaths) {
    const session = this.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const attachmentsDir = this.getSessionAttachmentsDir(sessionId);
    const existing = this.readSessionAttachments(sessionId);
    const imported = [];
    for (const filePath of filePaths) {
      const sourcePath = path__namespace.resolve(filePath);
      if (!fs__namespace.existsSync(sourcePath) || !fs__namespace.statSync(sourcePath).isFile()) {
        continue;
      }
      const targetPath = this.resolveImportedFilePath(attachmentsDir, path__namespace.basename(sourcePath));
      fs__namespace.copyFileSync(sourcePath, targetPath);
      const stats = fs__namespace.statSync(targetPath);
      imported.push({
        attachmentId: `att_${generateShortId()}`,
        sessionId,
        projectId: session.projectId,
        kind: this.inferAttachmentKind(targetPath),
        fileName: path__namespace.basename(targetPath),
        filePath: targetPath,
        mimeType: this.inferMimeType(targetPath),
        size: stats.size,
        createdAt: stats.birthtimeMs || stats.ctimeMs || nowMs()
      });
    }
    if (imported.length > 0) {
      this.writeSessionAttachments(sessionId, existing.concat(imported));
      this.touchProject(session.projectId, session.sessionId);
    }
    return imported;
  }
  readSessionEvidence(sessionId) {
    return readYaml(this.getSessionEvidencePath(sessionId));
  }
  readDebugPlan(sessionId, runId) {
    const payload = readYaml(this.getDebugPlanPath(sessionId, runId));
    return payload?.debug_plan ?? null;
  }
  writeDebugPlan(sessionId, runId, debugPlan) {
    const existing = this.readPlanSnapshot(sessionId, runId);
    writeYaml(this.getDebugPlanPath(sessionId, runId), {
      debug_plan: debugPlan,
      pending_questions: existing?.pending_questions ?? null,
      approval_state: existing?.approval_state ?? "not_requested",
      intake_context: existing?.intake_context
    });
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
  }
  readPlanSnapshot(sessionId, runId) {
    return readYaml(this.getDebugPlanPath(sessionId, runId));
  }
  writePlanSnapshot(sessionId, runId, snapshot) {
    writeYaml(this.getDebugPlanPath(sessionId, runId), snapshot);
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
  }
  async appendActionEvent(sessionId, event) {
    appendJsonl(this.getActionChainPath(sessionId), event);
    this.updateSession(sessionId, {});
    const session = this.readSession(sessionId);
    if (session) {
      this.syncSessionEvidence(sessionId, session.projectId);
    }
  }
  async readActionChain(sessionId) {
    const actionChainPath = this.getActionChainPath(sessionId);
    return readJsonl(actionChainPath);
  }
  createActionEvent(input) {
    return {
      schema_version: "2",
      event_id: generateEventId("evt"),
      turn_id: input.turnId,
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
      hypothesisBoard.last_updated = nowIso$1();
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
    } else if (selection.sessionId) {
      const selectedSession = this.readSession(selection.sessionId);
      if (!selectedSession || selectedSession.projectId !== projectId) {
        selection.sessionId = null;
      }
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
  syncSessionEvidence(sessionId, projectId) {
    const latestRun = this.getLatestRun(sessionId);
    const actionEvents = fs__namespace.existsSync(this.getActionChainPath(sessionId)) ? readJsonl(this.getActionChainPath(sessionId)) : [];
    const eventCounts = actionEvents.reduce((acc, event) => {
      acc[event.event_type] = (acc[event.event_type] || 0) + 1;
      return acc;
    }, {});
    const debugPlan = latestRun ? this.readDebugPlan(sessionId, latestRun.runId) : null;
    const activeBlockers = actionEvents.filter((event) => event.event_type === "blocker").map((event) => ({
      code: String(event.payload.code || "BLOCKER"),
      reason: String(event.payload.reason || event.payload.message || "Blocker"),
      refs: Array.isArray(event.refs) ? event.refs : [],
      detectedAt: new Date(event.ts_ms).toISOString()
    }));
    const verificationSummary = actionEvents.filter((event) => event.event_type === "verification").slice(-5).map((event) => String(event.payload.summary || event.payload.verdict || event.payload.verification_kind || "verification"));
    const reasoningSummaries = actionEvents.filter((event) => event.event_type === "agent_summary").slice(-10).map((event, index) => ({
      summaryId: `summary-${index}-${event.event_id}`,
      stage: normalizeWorkflowStage(String(event.payload.stage || latestRun?.lastStage || "plan")),
      agentId: String(event.agent_id),
      summary: String(event.payload.summary || event.payload.content || ""),
      evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
      nextStep: String(event.payload.next_step || event.payload.nextStep || ""),
      confidence: typeof event.payload.confidence === "number" ? event.payload.confidence : 0.5,
      createdAt: new Date(event.ts_ms).toISOString()
    }));
    const record = {
      schema_version: "1",
      session_id: sessionId,
      project_id: projectId,
      latest_run_id: latestRun?.runId || null,
      latest_run_status: latestRun?.status || null,
      latest_stage: latestRun?.lastStage || null,
      updated_at: nowIso$1(),
      debug_plan: debugPlan ? {
        plan_id: debugPlan.planId,
        readiness: debugPlan.planReadiness,
        strict_ready: debugPlan.strictReady,
        target_capture: debugPlan.targetCapture?.fileName || null,
        target_scope: debugPlan.targetFrameOrEvent?.scope || null,
        deliverables: debugPlan.expectedDeliverables
      } : null,
      event_counts: eventCounts,
      active_blockers: activeBlockers,
      verification_summary: verificationSummary,
      reasoning_summaries: reasoningSummaries,
      report_paths: latestRun?.reportPaths || null
    };
    writeYaml(this.getSessionEvidencePath(sessionId), record);
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
    fs__namespace.writeFileSync(seededMarker, nowIso$1(), "utf-8");
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
      turn_id: run.turnId,
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
    const target = typeof project === "string" ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    return path__namespace.join(target.rootPath, "sessions");
  }
  getLegacyProjectSessionsRoot(project) {
    return path__namespace.join(this.getProjectDataPath(project), "sessions");
  }
  ensureProjectSessionsRoot(project) {
    const target = typeof project === "string" ? this.getProjectById(project) : project;
    if (!target) {
      throw new Error(`Project not found: ${project}`);
    }
    const sessionsRoot = this.getProjectSessionsRoot(target);
    this.ensureDir(sessionsRoot);
    const legacySessionsRoot = this.getLegacyProjectSessionsRoot(target);
    if (fs__namespace.existsSync(legacySessionsRoot) && legacySessionsRoot !== sessionsRoot) {
      this.copyDirectoryContents(legacySessionsRoot, sessionsRoot, false);
    }
    return sessionsRoot;
  }
  findSessionLocation(sessionId) {
    for (const project of this.listProjects()) {
      const sessionPath = path__namespace.join(this.ensureProjectSessionsRoot(project), sessionId);
      if (fs__namespace.existsSync(path__namespace.join(sessionPath, "session.json"))) {
        return { project, sessionPath };
      }
    }
    return null;
  }
  normalizeSessionRecord(session, sessionPath) {
    const resolvedSessionPath = sessionPath || this.findSessionLocation(session.sessionId)?.sessionPath || session.sessionPath;
    return {
      ...session,
      sessionPath: resolvedSessionPath || ""
    };
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
      turnId: typeof runYaml.turn_id === "string" ? runYaml.turn_id : void 0,
      projectId: String(runYaml.project_id || ""),
      sessionId,
      caseId: String(runYaml.case_id || sessionId),
      mode: runYaml.mode || "debugger",
      goal: String(runYaml.goal || ""),
      captures: runYaml.captures || [],
      startedAt: Date.parse(String(runYaml.created_at || nowIso$1())),
      finishedAt: runYaml.finished_at ? Date.parse(String(runYaml.finished_at)) : void 0,
      status: runYaml.status || "running",
      lastStage: normalizeWorkflowStage(String(runYaml.last_stage || "preflight")),
      backend: runYaml.runtime?.backend || "local",
      createdAt: Date.parse(String(runYaml.created_at || nowIso$1())),
      updatedAt: Date.parse(String(runYaml.updated_at || runYaml.created_at || nowIso$1())),
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
      turnId: run.turnId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      caseId: run.caseId,
      mode: run.mode,
      goal: run.goal,
      captures: run.captures,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      stoppedAt: run.stoppedAt,
      status: run.status,
      stopReason: run.stopReason,
      lastStage: run.lastStage,
      backend: run.backend,
      reportPaths: run.reportPaths
    };
  }
  normalizeSessionTitle(projectId, title) {
    const normalized = title?.trim();
    if (normalized) {
      return normalized.slice(0, 80);
    }
    const nextIndex = this.getNextDefaultSessionIndex(projectId);
    return `new session ${nextIndex}`;
  }
  getNextDefaultSessionIndex(projectId) {
    const sessions = this.listSessions(projectId);
    const defaultTitlePattern = /^new session (\d+)$/i;
    const usedIndexes = sessions.map((session) => {
      const match = session.title.trim().match(defaultTitlePattern);
      return match ? Number.parseInt(match[1], 10) : null;
    }).filter((value) => value !== null && Number.isInteger(value) && value >= 0);
    if (usedIndexes.length === 0) {
      return 0;
    }
    return Math.max(...usedIndexes) + 1;
  }
  reconcileProjectSessionTitles(project) {
    const storedSessions = this.readProjectSessions(project);
    const normalizedSessions = storedSessions.map(({ session, sessionPath }) => this.normalizeSessionRecord(session, sessionPath));
    const autoGeneratedTitlePattern = /^new session (\d+)$/i;
    const legacyTimestampTitlePattern = /^Session \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    const autoSessions = normalizedSessions.filter((session) => autoGeneratedTitlePattern.test(session.title.trim()) || legacyTimestampTitlePattern.test(session.title.trim())).sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return a.sessionId.localeCompare(b.sessionId);
    });
    if (autoSessions.length === 0) {
      return normalizedSessions;
    }
    const nextTitlesBySessionId = /* @__PURE__ */ new Map();
    autoSessions.forEach((session, index) => {
      nextTitlesBySessionId.set(session.sessionId, `new session ${index}`);
    });
    let didRewrite = false;
    const rewrittenBySessionId = /* @__PURE__ */ new Map();
    for (const { sessionPath } of storedSessions) {
      const session = normalizedSessions.find((entry) => entry.sessionPath === sessionPath);
      if (!session) {
        continue;
      }
      const nextTitle = nextTitlesBySessionId.get(session.sessionId);
      if (nextTitle && session.title !== nextTitle) {
        const rewrittenSession = {
          ...session,
          title: nextTitle
        };
        this.writeJson(path__namespace.join(sessionPath, "session.json"), rewrittenSession);
        rewrittenBySessionId.set(session.sessionId, rewrittenSession);
        didRewrite = true;
        continue;
      }
      rewrittenBySessionId.set(session.sessionId, session);
    }
    if (!didRewrite) {
      return normalizedSessions;
    }
    return normalizedSessions.map((session) => rewrittenBySessionId.get(session.sessionId) ?? session);
  }
  readProjectSessions(project) {
    const sessionsRoot = this.ensureProjectSessionsRoot(project);
    if (!fs__namespace.existsSync(sessionsRoot)) {
      return [];
    }
    return fs__namespace.readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
      const sessionPath = path__namespace.join(sessionsRoot, entry.name);
      const session = this.readJson(path__namespace.join(sessionPath, "session.json"));
      return session ? { session, sessionPath } : null;
    }).filter((entry) => entry !== null);
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
  readSessionAttachments(sessionId) {
    return this.readJson(this.getSessionAttachmentsManifestPath(sessionId)) ?? [];
  }
  writeSessionAttachments(sessionId, attachments) {
    this.writeJson(this.getSessionAttachmentsManifestPath(sessionId), attachments);
  }
  resolveImportedFilePath(dirPath, fileName) {
    const extension = path__namespace.extname(fileName);
    const baseName = path__namespace.basename(fileName, extension);
    let candidate = path__namespace.join(dirPath, fileName);
    let counter = 2;
    while (fs__namespace.existsSync(candidate)) {
      candidate = path__namespace.join(dirPath, `${baseName}-${counter}${extension}`);
      counter += 1;
    }
    return candidate;
  }
  inferAttachmentKind(filePath) {
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filePath) ? "image" : "file";
  }
  inferMimeType(filePath) {
    const extension = path__namespace.extname(filePath).toLowerCase();
    const mimeByExtension = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".json": "application/json",
      ".zip": "application/zip",
      ".7z": "application/x-7z-compressed",
      ".log": "text/plain"
    };
    return mimeByExtension[extension] || "application/octet-stream";
  }
}
const storageAdapter = new StorageAdapter();
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
const DEFAULT_MODEL_ROUTING = {
  "ask_agent": { provider: "openrouter", model: "anthropic/claude-3-sonnet" },
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
const AGENT_ROLES = [
  "ask_agent",
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
const AGENT_DISPLAY_NAMES = {
  "ask_agent": "Ask",
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
  "ask_agent": "Non-executing assistant for clarification, capability explanation, and Open capture guidance",
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
  "ask_agent": "orchestrator",
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
  "ask_agent": [],
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
const AGENT_MODES = [
  {
    id: "ask",
    label: "Ask",
    icon: "message-orbit",
    description: "澄清目标并引导打开 Capture",
    accentColor: "#38c6f4",
    disabled: false
  },
  {
    id: "debugger",
    label: "Debugger",
    icon: "crosshair-bug",
    description: "定位异常与验证修复",
    accentColor: "#33d1ff",
    disabled: false
  },
  {
    id: "analyzer",
    label: "Analyzer",
    icon: "waveform-gauge",
    description: "拆解现象并收敛证据",
    accentColor: "#8d8bff",
    disabled: false
  },
  {
    id: "optimizer",
    label: "Optimizer",
    icon: "spark-tuning",
    description: "判断瓶颈与优化顺序",
    accentColor: "#4ee3a0",
    disabled: false
  }
];
AGENT_MODES.reduce(
  (accumulator, mode) => {
    accumulator[mode.id] = mode;
    return accumulator;
  },
  {}
);
const RETIRED_BUILTIN_MCP_SERVER_IDS$1 = /* @__PURE__ */ new Set(["builtin.rdc-toolbridge"]);
const TEMPLATE_COPIES = [
  {
    source: ["profiles", "agents"],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "agents")
  },
  {
    source: ["profiles", "modes"],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).profilesPath, "modes")
  },
  {
    source: ["policies", "stages"],
    target: (workspaceRoot) => path.join(appPathService.getWorkspacePaths(workspaceRoot).policiesPath, "stages")
  },
  {
    source: ["patterns"],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).patternsPath
  },
  {
    source: ["skills"],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).skillsPath
  },
  {
    source: ["mcp"],
    target: (workspaceRoot) => appPathService.getWorkspacePaths(workspaceRoot).mcpPath
  }
];
function readJsonFile$1(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn("[AgentRuntimeConfigService] Failed to read JSON:", filePath, error);
    return null;
  }
}
function copyDirContentsIfMissing(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContentsIfMissing(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile() || fs.existsSync(targetPath)) {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}
class AgentRuntimeConfigService {
  resolveTemplateRoot() {
    const candidates = [
      path.join(electron.app.getAppPath(), "resources", "agent-runtime"),
      path.join(electron.app.getAppPath(), "..", "resources", "agent-runtime"),
      path.join(process.cwd(), "resources", "agent-runtime"),
      path.join(process.resourcesPath ?? "", "resources", "agent-runtime"),
      path.join(process.resourcesPath ?? "", "agent-runtime")
    ].filter(Boolean);
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return path.resolve(candidates[0]);
  }
  ensureScaffold(workspaceRoot = appPathService.getWorkspaceRoot()) {
    const templateRoot = this.resolveTemplateRoot();
    for (const copy of TEMPLATE_COPIES) {
      copyDirContentsIfMissing(path.join(templateRoot, ...copy.source), copy.target(workspaceRoot));
    }
  }
  listPatterns(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("patterns", workspaceRoot);
  }
  listSkills(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("skills", workspaceRoot);
  }
  listMcpServers(workspaceRoot = appPathService.getWorkspaceRoot()) {
    return this.readDescriptors("mcp", workspaceRoot).filter((descriptor) => !RETIRED_BUILTIN_MCP_SERVER_IDS$1.has(descriptor.id));
  }
  readDescriptors(kind, workspaceRoot) {
    this.ensureScaffold(workspaceRoot);
    const paths = appPathService.getWorkspacePaths(workspaceRoot);
    const dir = kind === "patterns" ? paths.patternsPath : kind === "skills" ? paths.skillsPath : paths.mcpPath;
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.readdirSync(dir).filter((entry) => entry.endsWith(".json")).map((entry) => readJsonFile$1(path.join(dir, entry))).filter((entry) => Boolean(entry?.id)).sort((left, right) => left.id.localeCompare(right.id));
  }
}
const agentRuntimeConfigService = new AgentRuntimeConfigService();
const COPILOT_CHAT_COMPLETIONS_FALLBACK_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gpt-4.1",
  "gpt-4o",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "gpt-5-mini"
];
function isCopilotChatCompletionsUnsupportedModel(modelId) {
  const normalized = modelId.toLowerCase();
  return /^gpt-5\.[3-9](?:-|$)/.test(normalized) || /^gpt-5\.[0-9]+-codex(?:-|$)/.test(normalized);
}
function isEnabledModel(provider, modelId) {
  return provider.models.some((model) => model.enabled !== false && model.id === modelId);
}
function resolveCopilotFallbackModel(routes, provider, agentId) {
  const debuggerRoute = routes.find((entry) => entry.agentId === "rdc-debugger");
  const candidates = [
    ...agentId !== "rdc-debugger" && debuggerRoute?.providerId === provider.id ? [debuggerRoute.modelId] : [],
    ...COPILOT_CHAT_COMPLETIONS_FALLBACK_MODELS,
    ...provider.models.map((model) => model.id)
  ];
  for (const modelId of candidates) {
    if (modelId && !isCopilotChatCompletionsUnsupportedModel(modelId) && isEnabledModel(provider, modelId)) {
      return modelId;
    }
  }
  return null;
}
function resolveCompatibleAgentRoute(routes, providers, agentId) {
  const route = routes.find((entry) => entry.agentId === agentId) || null;
  if (!route?.providerId || !route.modelId) {
    return { route: null, provider: null };
  }
  const provider = providers.find((entry) => entry.id === route.providerId) || null;
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return { route, provider };
  }
  if (!isEnabledModel(provider, route.modelId)) {
    return { route, provider };
  }
  if (provider.id !== "github-copilot" || !isCopilotChatCompletionsUnsupportedModel(route.modelId)) {
    return { route, provider };
  }
  const fallbackModelId = resolveCopilotFallbackModel(routes, provider, agentId);
  if (!fallbackModelId) {
    return { route, provider };
  }
  return {
    route: {
      ...route,
      modelId: fallbackModelId
    },
    provider,
    requestedModelId: route.modelId,
    remapReason: `${route.modelId} is not available on GitHub Copilot chat completions; using ${fallbackModelId}.`
  };
}
const DEFAULT_MODE_PROFILE_ID = "debugger.default";
const groupToAllowPattern = (group) => {
  if (group === "*") return "*";
  if (group === "primitive") return "primitive.*";
  if (group === "ui") return "ui.*";
  if (group.startsWith("rd.")) return group.endsWith(".*") ? group : `${group}.*`;
  return `rd.${group}.*`;
};
const expandToolPolicy = (policy) => [
  ...policy?.allowTools ?? [],
  ...(policy?.allowGroups ?? []).map(groupToAllowPattern)
].filter(Boolean);
const createFallbackModeProfile = () => ({
  id: DEFAULT_MODE_PROFILE_ID,
  label: "Debugger Production",
  mode: "debugger",
  patternId: "plan-generate-verify",
  skillIds: [],
  mcpServerIds: [],
  stagePolicies: {},
  defaultAgentPrompts: {}
});
const createFallbackAgentProfile = (agentId) => {
  const route = DEFAULT_MODEL_ROUTING[agentId];
  return {
    id: `agent.${agentId}`,
    label: agentId,
    agentId,
    systemPrompt: `You are ${agentId}.`,
    modelProvider: route.provider,
    modelName: route.model,
    temperature: 0.3,
    maxTokens: 4096,
    toolPolicy: { allowTools: [] }
  };
};
const createFallbackStagePolicy = (stage) => ({
  id: `stage.${stage}`,
  label: stage,
  stage,
  phase: STAGE_PHASES[stage],
  toolPolicy: { allowTools: [] }
});
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
    agentRuntimeConfigService.ensureScaffold(workspaceRoot);
  }
  normalizeConfiguration(configuration, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureScaffold(workspaceRoot);
    const availableModeProfiles = this.listModeProfiles(workspaceRoot);
    const hasActiveProfile = availableModeProfiles.some((profile) => profile.id === configuration.activeModeProfileId);
    const availablePatterns = agentRuntimeConfigService.listPatterns(workspaceRoot);
    const availableSkills = agentRuntimeConfigService.listSkills(workspaceRoot);
    const availableMcpServers = agentRuntimeConfigService.listMcpServers(workspaceRoot);
    const patternIds = new Set(availablePatterns.map((pattern) => pattern.id));
    const modePatternBindings = Object.fromEntries(
      Object.entries(configuration.modePatternBindings ?? {}).map(([mode, patternId]) => [mode, patternIds.has(patternId) ? patternId : "free-agent"])
    );
    return {
      ...configuration,
      activeModeProfileId: hasActiveProfile ? configuration.activeModeProfileId : DEFAULT_MODE_PROFILE_ID,
      availableModeProfiles,
      availablePatterns,
      availableSkills,
      availableMcpServers,
      enabledSkillIds: configuration.enabledSkillIds ?? [],
      enabledMcpServerIds: configuration.enabledMcpServerIds ?? [],
      modePatternBindings: {
        debugger: patternIds.has(modePatternBindings.debugger) ? modePatternBindings.debugger : "plan-generate-verify",
        analyzer: patternIds.has(modePatternBindings.analyzer) ? modePatternBindings.analyzer : "free-agent",
        optimizer: patternIds.has(modePatternBindings.optimizer) ? modePatternBindings.optimizer : "free-agent",
        ...modePatternBindings
      }
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
    ) || createFallbackModeProfile();
    const agentPromptId = modeProfile.defaultAgentPrompts[agentId] || `agent.${agentId}`;
    const agentProfile = this.readJson(
      path.join(this.getAgentProfilesPath(workspaceRoot), `${agentId}.json`)
    ) || createFallbackAgentProfile(agentId);
    const stagePolicyId = modeProfile.stagePolicies[stage] || `stage.${stage}`;
    const stagePolicy = this.readJson(
      path.join(this.getStagePoliciesPath(workspaceRoot), `${stage}.json`)
    ) || createFallbackStagePolicy(stage);
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
        ...expandToolPolicy(stagePolicy.toolPolicy),
        ...expandToolPolicy(agentProfile.toolPolicy)
      ])),
      patternId: modeProfile.patternId ?? settings.configuration.modePatternBindings[modeProfile.mode],
      skillIds: Array.from(/* @__PURE__ */ new Set([
        ...modeProfile.skillIds ?? [],
        ...settings.configuration.enabledSkillIds ?? []
      ])),
      mcpServerIds: Array.from(/* @__PURE__ */ new Set([
        ...modeProfile.mcpServerIds ?? [],
        ...settings.configuration.enabledMcpServerIds ?? []
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
    const resolution = resolveCompatibleAgentRoute(routes, providers, agentId);
    if (!resolution.route || !resolution.provider) {
      return null;
    }
    const modelExists = resolution.provider.models.some((model) => model.enabled && model.id === resolution.route?.modelId);
    return modelExists ? resolution.route : null;
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
}
const executionProfileService = new ExecutionProfileService();
const COPILOT_EDITOR_HEADERS = {
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0"
};
const COPILOT_WIRE_HEADERS = {
  ...COPILOT_EDITOR_HEADERS,
  "Copilot-Integration-Id": "vscode-chat"
};
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
const normalizeOpenRouterBaseUrl = (baseUrl) => {
  const trimmed = (baseUrl || "https://openrouter.ai/api/v1").trim().replace(/\/+$/, "");
  if (/^https:\/\/openrouter\.ai\/api$/i.test(trimmed)) {
    return `${trimmed}/v1`;
  }
  return trimmed;
};
const appendQueryParam$1 = (url2, key, value) => {
  const separator = url2.includes("?") ? "&" : "?";
  return `${url2}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};
const extractMessageContent = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const message = payload.message ?? null;
  const messageContent = message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent;
  }
  if (Array.isArray(messageContent) && messageContent.length > 0) {
    return messageContent;
  }
  if (messageContent && typeof messageContent === "object") {
    return JSON.stringify(messageContent);
  }
  const stringFallbacks = [
    message?.output_text,
    message?.reasoning_content,
    message?.reasoning,
    message?.refusal,
    payload.text,
    payload.output_text
  ];
  for (const candidate of stringFallbacks) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return "";
};
const toResponsesInput = (messages) => messages.map((message) => ({
  role: message.role === "assistant" || message.role === "system" ? message.role : "user",
  content: typeof message.content === "string" ? message.content : JSON.stringify(message.content)
}));
const toOpenAiTools = (tools) => {
  if (!tools?.length) {
    return void 0;
  }
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
};
const extractResponsesText = (payload) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const output = Array.isArray(record.output) ? record.output : [];
  const chunks = [];
  for (const item of output) {
    const itemRecord = item && typeof item === "object" ? item : {};
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
    for (const block of content) {
      const blockRecord = block && typeof block === "object" ? block : {};
      const text = typeof blockRecord.text === "string" ? blockRecord.text : typeof blockRecord.output_text === "string" ? blockRecord.output_text : "";
      if (text) {
        chunks.push(text);
      }
    }
  }
  if (chunks.length > 0) {
    return chunks.join("");
  }
  const fallback = extractMessageContent(payload);
  return typeof fallback === "string" ? fallback : JSON.stringify(fallback);
};
const extractResponsesUsage = (payload) => {
  const record = payload && typeof payload === "object" ? payload : {};
  const usage = record.usage && typeof record.usage === "object" ? record.usage : {};
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  return {
    inputTokens: typeof input === "number" ? input : 0,
    outputTokens: typeof output === "number" ? output : 0
  };
};
const createAccumulator = (model) => ({
  id: `stream-${Date.now()}`,
  model,
  content: "",
  toolCalls: [],
  inputTokens: 0,
  outputTokens: 0,
  stopReason: "end_turn"
});
const ensureToolCall = (toolCalls, index, id) => {
  while (toolCalls.length <= index) {
    toolCalls.push({
      id: id || `tool-call-${index}`,
      name: "",
      argumentsText: ""
    });
  }
  const existing = toolCalls[index];
  if (id && !existing.id) {
    existing.id = id;
  }
  return existing;
};
const parseToolArguments = (argumentsText) => {
  if (!argumentsText.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return {
    raw: argumentsText
  };
};
const buildResponseFromAccumulator = (accumulator) => {
  const toolCalls = accumulator.toolCalls.filter((toolCall) => toolCall.id || toolCall.name || toolCall.argumentsText).map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    arguments: parseToolArguments(toolCall.argumentsText)
  }));
  return {
    id: accumulator.id,
    model: accumulator.model,
    content: accumulator.content,
    toolCalls: toolCalls.length > 0 ? toolCalls : void 0,
    usage: {
      inputTokens: accumulator.inputTokens,
      outputTokens: accumulator.outputTokens
    },
    stopReason: accumulator.stopReason
  };
};
const emitTextChunk = (text, onChunk) => {
  if (!text) {
    return;
  }
  onChunk({
    type: "text-delta",
    text
  });
};
const emitToolCallDelta = (toolCall, onChunk) => {
  onChunk({
    type: "tool-call-delta",
    toolCall
  });
};
const emitFallbackChunks = (text, onChunk) => {
  const chunks = text.split(/(?<=[.!?。！？\n])|(?<=,|，)\s+/).map((chunk) => chunk.trim()).filter(Boolean);
  if (chunks.length === 0 && text) {
    emitTextChunk(text, onChunk);
    return;
  }
  for (const chunk of chunks) {
    emitTextChunk(chunk, onChunk);
  }
};
const tryParseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const mapFinishReason = (finishReason) => {
  if (finishReason === "tool_calls" || finishReason === "tool_use") {
    return "tool_use";
  }
  if (finishReason === "length" || finishReason === "max_tokens") {
    return "max_tokens";
  }
  return "end_turn";
};
const readSseStream = async (response, onEvent) => {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is unavailable.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines = [];
  const flush = () => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }
    const payload = dataLines.join("\n");
    dataLines = [];
    onEvent(eventName, payload);
    eventName = "message";
  };
  for (; ; ) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r$/, "");
      if (!line) {
        flush();
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      break;
    }
  }
  if (buffer.trim()) {
    const line = buffer.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  flush();
};
class BaseStreamingProvider {
  name;
  constructor(name) {
    this.name = name;
  }
  async streamChat(request, onChunk) {
    try {
      const response = await this.performStreamingChat(request, onChunk);
      onChunk({ type: "done" });
      return response;
    } catch (error) {
      if (request.signal?.aborted) {
        throw error;
      }
      const fallbackResponse = await this.chat(request);
      const fallbackText = typeof fallbackResponse.content === "string" ? fallbackResponse.content : JSON.stringify(fallbackResponse.content);
      emitFallbackChunks(fallbackText, onChunk);
      onChunk({ type: "done" });
      return fallbackResponse;
    }
  }
}
class OpenRouterProvider extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://openrouter.ai/api/v1";
  models = [];
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = normalizeOpenRouterBaseUrl(config.baseUrl || "https://openrouter.ai/api/v1");
    this.models = config.models;
  }
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0,
        stream: false
      })
    });
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    const content = extractMessageContent(choice);
    return {
      id: data.id || `or-${Date.now()}`,
      model: data.model || model,
      content,
      toolCalls: choice?.message?.tool_calls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: mapFinishReason(choice?.finish_reason)
    };
  }
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rdcagent.local",
        "X-Title": "RdcAgent"
      },
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0,
        stream: true
      })
    });
    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} - ${await response.text()}`);
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (_eventName, data) => {
      if (!data || data === "[DONE]") {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      accumulator.id = String(payload.id || accumulator.id);
      accumulator.model = String(payload.model || accumulator.model);
      const choice = payload.choices?.[0];
      const delta = choice?.delta ?? {};
      const text = typeof delta.content === "string" ? delta.content : "";
      if (text) {
        accumulator.content += text;
        emitTextChunk(text, onChunk);
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCallDelta of toolCalls) {
        const index = typeof toolCallDelta.index === "number" ? toolCallDelta.index : 0;
        const functionDelta = typeof toolCallDelta.function === "object" && toolCallDelta.function ? toolCallDelta.function : {};
        const toolCall = ensureToolCall(
          accumulator.toolCalls,
          index,
          typeof toolCallDelta.id === "string" ? toolCallDelta.id : void 0
        );
        if (typeof functionDelta.name === "string") {
          toolCall.name = functionDelta.name;
        }
        if (typeof functionDelta.arguments === "string") {
          toolCall.argumentsText += functionDelta.arguments;
        }
        emitToolCallDelta({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: toolCall.argumentsText
        }, onChunk);
      }
      accumulator.stopReason = mapFinishReason(
        typeof choice?.finish_reason === "string" ? choice.finish_reason : void 0
      );
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
class OpenAICompatibleProvider extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://api.openai.com/v1";
  models = [];
  requireApiKey = true;
  constructor(name, requireApiKey = true) {
    super(name);
    this.requireApiKey = requireApiKey;
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, "");
    this.models = config.models;
  }
  createHeaders() {
    const headers = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }
  createChatCompletionsUrl() {
    return `${this.baseUrl}/chat/completions`;
  }
  describeApiError(status, text) {
    return `${this.name} API error: ${status} - ${text}`;
  }
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createChatCompletionsUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0
      })
    });
    if (!response.ok) {
      throw new Error(this.describeApiError(response.status, await response.text()));
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    const content = extractMessageContent(choice);
    return {
      id: data.id || `${this.name}-${Date.now()}`,
      model: data.model || model,
      content,
      toolCalls: choice?.message?.tool_calls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      stopReason: mapFinishReason(choice?.finish_reason)
    };
  }
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createChatCompletionsUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        messages: toContentBlocks(request.messages),
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        tools: toOpenAiTools(request.tools),
        response_format: request.responseFormat ? { type: request.responseFormat } : void 0,
        stream: true
      })
    });
    if (!response.ok) {
      throw new Error(this.describeApiError(response.status, await response.text()));
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (_eventName, data) => {
      if (!data || data === "[DONE]") {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      accumulator.id = String(payload.id || accumulator.id);
      accumulator.model = String(payload.model || accumulator.model);
      const choice = payload.choices?.[0];
      const delta = choice?.delta ?? {};
      const text = typeof delta.content === "string" ? delta.content : "";
      if (text) {
        accumulator.content += text;
        emitTextChunk(text, onChunk);
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const toolCallDelta of toolCalls) {
        const index = typeof toolCallDelta.index === "number" ? toolCallDelta.index : 0;
        const functionDelta = typeof toolCallDelta.function === "object" && toolCallDelta.function ? toolCallDelta.function : {};
        const toolCall = ensureToolCall(
          accumulator.toolCalls,
          index,
          typeof toolCallDelta.id === "string" ? toolCallDelta.id : void 0
        );
        if (typeof functionDelta.name === "string") {
          toolCall.name = functionDelta.name;
        }
        if (typeof functionDelta.arguments === "string") {
          toolCall.argumentsText += functionDelta.arguments;
        }
        emitToolCallDelta({
          id: toolCall.id,
          name: toolCall.name,
          argumentsText: toolCall.argumentsText
        }, onChunk);
      }
      accumulator.stopReason = mapFinishReason(
        typeof choice?.finish_reason === "string" ? choice.finish_reason : void 0
      );
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return this.requireApiKey ? Boolean(this.apiKey) : true;
  }
  getModels() {
    return this.models;
  }
}
class ChatGptAccountProvider extends BaseStreamingProvider {
  accessToken = "";
  baseUrl = "https://chatgpt.com/backend-api/codex";
  accountId;
  models = [];
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.accessToken = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, "");
    this.accountId = config.accountId?.trim() || void 0;
    this.models = config.models;
  }
  createHeaders() {
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json"
    };
    if (this.accountId) {
      headers["chatgpt-account-id"] = this.accountId;
    }
    return headers;
  }
  createResponsesUrl() {
    return this.baseUrl.endsWith("/responses") ? this.baseUrl : `${this.baseUrl}/responses`;
  }
  createBody(request, model, stream) {
    return {
      model,
      input: toResponsesInput(request.messages),
      max_output_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream
    };
  }
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createResponsesUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(this.createBody(request, model, false))
    });
    if (!response.ok) {
      throw new Error(`ChatGPT Account API error: ${response.status} - ${await response.text()}`);
    }
    const payload = await response.json();
    return {
      id: typeof payload.id === "string" ? payload.id : `${this.name}-${Date.now()}`,
      model: typeof payload.model === "string" ? payload.model : model,
      content: extractResponsesText(payload),
      usage: extractResponsesUsage(payload),
      stopReason: mapFinishReason(typeof payload.status === "string" ? payload.status : void 0)
    };
  }
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(this.createResponsesUrl(), {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify(this.createBody(request, model, true))
    });
    if (!response.ok) {
      throw new Error(`ChatGPT Account API error: ${response.status} - ${await response.text()}`);
    }
    const accumulator = createAccumulator(model);
    await readSseStream(response, (eventName, data) => {
      if (!data || data === "[DONE]") {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      const eventType = typeof payload.type === "string" ? payload.type : eventName;
      if (typeof payload.id === "string") {
        accumulator.id = payload.id;
      }
      if (typeof payload.model === "string") {
        accumulator.model = payload.model;
      }
      if (eventType.includes("output_text.delta")) {
        const text = typeof payload.delta === "string" ? payload.delta : typeof payload.text === "string" ? payload.text : "";
        if (text) {
          accumulator.content += text;
          emitTextChunk(text, onChunk);
        }
      }
      if (eventType.includes("completed")) {
        const completed = payload.response && typeof payload.response === "object" ? payload.response : payload;
        if (!accumulator.content) {
          accumulator.content = extractResponsesText(completed);
        }
        if (typeof completed.id === "string") {
          accumulator.id = completed.id;
        }
        if (typeof completed.model === "string") {
          accumulator.model = completed.model;
        }
        const usage = extractResponsesUsage(completed);
        accumulator.inputTokens = usage.inputTokens;
        accumulator.outputTokens = usage.outputTokens;
      }
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return Boolean(this.accessToken);
  }
  getModels() {
    return this.models;
  }
}
class GitHubCopilotProvider extends OpenAICompatibleProvider {
  constructor(name) {
    super(name, true);
  }
  createHeaders() {
    return {
      ...super.createHeaders(),
      ...COPILOT_WIRE_HEADERS
    };
  }
  describeApiError(status, text) {
    if (status === 401) {
      return `GitHub Copilot account token was rejected. Sign in again or check token policy. ${text}`;
    }
    if (status === 403) {
      return `GitHub Copilot access was blocked by license, organization, or policy settings. ${text}`;
    }
    return `GitHub Copilot API error: ${status} - ${text}`;
  }
}
class AzureOpenAIProvider extends OpenAICompatibleProvider {
  createHeaders() {
    return {
      "api-key": this.apiKey,
      "Content-Type": "application/json"
    };
  }
  createChatCompletionsUrl() {
    const base = this.baseUrl.endsWith("/chat/completions") ? this.baseUrl : `${this.baseUrl}/chat/completions`;
    return appendQueryParam$1(base, "api-version", "2024-10-21");
  }
}
class GoogleAiStudioProvider extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  models = [];
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || this.baseUrl).trim().replace(/\/+$/, "");
    this.models = config.models;
  }
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const response = await fetch(appendQueryParam$1(`${this.baseUrl}/models/${model}:generateContent`, "key", this.apiKey), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: request.signal,
      body: JSON.stringify({
        contents: request.messages.filter((message) => message.role !== "system").map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }]
        })),
        generationConfig: {
          maxOutputTokens: request.maxTokens || 4096,
          temperature: request.temperature ?? 0.7
        },
        systemInstruction: request.messages.some((message) => message.role === "system") ? {
          parts: request.messages.filter((message) => message.role === "system").map((message) => ({ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content) }))
        } : void 0
      })
    });
    if (!response.ok) {
      throw new Error(`Google AI Studio API error: ${response.status} - ${await response.text()}`);
    }
    const data = await response.json();
    const text = Array.isArray(data.candidates?.[0]?.content?.parts) ? data.candidates[0].content.parts.map((part) => typeof part.text === "string" ? part.text : "").join("") : "";
    return {
      id: data.responseId || `google-ai-studio-${Date.now()}`,
      model,
      content: text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0
      },
      stopReason: "end_turn"
    };
  }
  async performStreamingChat(request, onChunk) {
    const response = await this.chat(request);
    const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    emitTextChunk(text, onChunk);
    return response;
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
class AnthropicProvider extends BaseStreamingProvider {
  apiKey = "";
  baseUrl = "https://api.anthropic.com/v1";
  models = [];
  useBearerAuth = false;
  constructor(name) {
    super(name);
  }
  configure(config) {
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").trim().replace(/\/+$/, "");
    this.models = config.models;
    this.useBearerAuth = config.authMode === "account";
  }
  createHeaders() {
    return {
      ...this.useBearerAuth ? { Authorization: `Bearer ${this.apiKey}` } : { "x-api-key": this.apiKey },
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    };
  }
  async chat(request) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request.messages.find((message) => message.role === "system");
    const otherMessages = request.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
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
      stopReason: mapFinishReason(data.stop_reason)
    };
  }
  async performStreamingChat(request, onChunk) {
    const model = request.model?.trim();
    if (!model) {
      throw new Error(`${this.name} requires an explicit model selection.`);
    }
    const systemMessage = request.messages.find((message) => message.role === "system");
    const otherMessages = request.messages.filter((message) => message.role !== "system");
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: this.createHeaders(),
      signal: request.signal,
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens || 4096,
        stream: true,
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
    const accumulator = createAccumulator(model);
    await readSseStream(response, (eventName, data) => {
      if (!data) {
        return;
      }
      const payload = tryParseJson(data);
      if (!payload) {
        return;
      }
      if (eventName === "message_start") {
        const message = payload.message;
        accumulator.id = String(message?.id || accumulator.id);
        accumulator.model = String(message?.model || accumulator.model);
        const usage = message?.usage;
        accumulator.inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : accumulator.inputTokens;
      }
      if (eventName === "content_block_delta") {
        const delta = payload.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          accumulator.content += delta.text;
          emitTextChunk(delta.text, onChunk);
        }
      }
      if (eventName === "message_delta") {
        const delta = payload.delta;
        const usage = payload.usage;
        accumulator.outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : accumulator.outputTokens;
        accumulator.stopReason = mapFinishReason(
          typeof delta?.stop_reason === "string" ? delta.stop_reason : void 0
        );
      }
    });
    return buildResponseFromAccumulator(accumulator);
  }
  async isAvailable() {
    return Boolean(this.apiKey);
  }
  getModels() {
    return this.models;
  }
}
const createProviderByKind = (providerId, kind) => {
  if (providerId === "chatgpt-account") {
    return new ChatGptAccountProvider(providerId);
  }
  if (providerId === "github-copilot") {
    return new GitHubCopilotProvider(providerId);
  }
  if (kind === "openrouter") {
    return new OpenRouterProvider(providerId);
  }
  if (kind === "anthropic") {
    return new AnthropicProvider(providerId);
  }
  if (kind === "ollama") {
    return new OpenAICompatibleProvider(providerId, false);
  }
  if (kind === "google-ai-studio") {
    return new GoogleAiStudioProvider(providerId);
  }
  if (kind === "azure-openai") {
    return new AzureOpenAIProvider(providerId);
  }
  return new OpenAICompatibleProvider(providerId, true);
};
class LLMAdapter {
  providers = /* @__PURE__ */ new Map();
  configure(config) {
    this.providers.clear();
    for (const providerConfig of config.providers) {
      const provider = createProviderByKind(providerConfig.id, providerConfig.kind);
      if ("configure" in provider && typeof provider.configure === "function") {
        provider.configure(providerConfig);
      }
      this.providers.set(providerConfig.id, {
        config: providerConfig,
        provider
      });
    }
  }
  async chat(request, providerId) {
    const resolvedProviderId = providerId?.trim();
    if (!resolvedProviderId) {
      throw new Error("No explicit LLM provider was supplied for this request.");
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
    const resolvedProviderId = providerId?.trim();
    if (!resolvedProviderId) {
      throw new Error("No explicit LLM provider was supplied for this request.");
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
    return "";
  }
}
const llmAdapter = new LLMAdapter();
const ANTHROPIC_ALIAS_MODELS = ["sonnet", "opus", "haiku"];
const ANTHROPIC_FIRST_PARTY_MODELS = ["sonnet", "opus"];
const CLAUDE_ACCOUNT_MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001"
];
const CHATGPT_ACCOUNT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.1-codex",
  "gpt-5",
  "o4-mini",
  "o3",
  "gpt-4o"
];
const GITHUB_COPILOT_ACCOUNT_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5-mini",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "gpt-4.1"
];
const OPENAI_CODE_MODELS = ["gpt-5.2", "gpt-4.1", "gpt-5-mini"];
const BUILTIN_LLM_PROVIDER_DEFINITIONS = [
  {
    id: "302ai",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "302.AI",
    baseUrl: "https://api.302.ai/v1",
    recommendedModels: ["gpt-4o", "claude-3-7-sonnet"],
    docsUrl: "https://302.ai/"
  },
  {
    id: "azure-openai",
    kind: "azure-openai",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "azure-openai",
    label: "Azure OpenAI",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ["gpt-4.1", "gpt-5-mini"],
    docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/"
  },
  {
    id: "bailian",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Alibaba Cloud Bailian",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    recommendedModels: ["qwen3.6-plus", "qwen3-coder-next", "qwen3-coder-plus", "kimi-k2.5", "glm-5", "glm-4.7"],
    docsUrl: "https://bailian.console.aliyun.com/"
  },
  {
    id: "anthropic",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    recommendedModels: ANTHROPIC_FIRST_PARTY_MODELS,
    docsUrl: "https://platform.claude.com/settings/keys"
  },
  {
    id: "anthropic-thirdparty",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Anthropic-compatible Endpoint",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://platform.claude.com/docs/en/api/overview"
  },
  {
    id: "cerebras",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    recommendedModels: ["llama-4-scout-17b-16e-instruct", "qwen-3-coder-480b"],
    docsUrl: "https://cloud.cerebras.ai/"
  },
  {
    id: "bedrock",
    kind: "bedrock",
    authMode: "environment",
    catalogGroup: "environment",
    modelDiscovery: "static",
    label: "Amazon Bedrock",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/amazon-bedrock"
  },
  {
    id: "custom-endpoint",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "OpenAI-compatible Endpoint",
    baseUrl: "",
    baseUrlEditable: true,
    recommendedModels: ["gpt-4.1"],
    docsUrl: "https://platform.openai.com/docs/api-reference"
  },
  {
    id: "claude-account",
    kind: "anthropic",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "Claude Account",
    recommendedModels: CLAUDE_ACCOUNT_MODELS,
    docsUrl: "https://claude.ai/",
    accountLoginConfigured: true
  },
  {
    id: "chatgpt-account",
    kind: "openai-compatible",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "ChatGPT Account",
    recommendedModels: CHATGPT_ACCOUNT_MODELS,
    docsUrl: "https://chatgpt.com/",
    accountLoginConfigured: true
  },
  {
    id: "deepseek",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/anthropic",
    recommendedModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
    docsUrl: "https://platform.deepseek.com/api_keys"
  },
  {
    id: "github-copilot",
    kind: "openai-compatible",
    authMode: "account",
    catalogGroup: "account",
    modelDiscovery: "account-catalog",
    label: "GitHub Copilot",
    recommendedModels: GITHUB_COPILOT_ACCOUNT_MODELS,
    docsUrl: "https://github.com/features/copilot",
    accountLoginConfigured: true
  },
  {
    id: "google-ai-studio",
    kind: "google-ai-studio",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "google-ai-studio",
    label: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    docsUrl: "https://aistudio.google.com/app/apikey"
  },
  {
    id: "groq",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    recommendedModels: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    docsUrl: "https://console.groq.com/keys"
  },
  {
    id: "glm-cn",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Zhipu AI GLM (CN)",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    recommendedModels: ["sonnet", "opus", "haiku"],
    docsUrl: "https://open.bigmodel.cn/"
  },
  {
    id: "glm-global",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Z.ai GLM (Global)",
    baseUrl: "https://api.z.ai/api/anthropic",
    recommendedModels: ["sonnet", "opus", "haiku"],
    docsUrl: "https://platform.z.ai/"
  },
  {
    id: "huggingface",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    recommendedModels: ["openai/gpt-oss-120b", "Qwen/Qwen3-Coder-480B-A35B-Instruct"],
    docsUrl: "https://huggingface.co/settings/tokens"
  },
  {
    id: "vertex",
    kind: "vertex",
    authMode: "environment",
    catalogGroup: "environment",
    modelDiscovery: "static",
    label: "Google Vertex AI",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/google-vertex-ai"
  },
  {
    id: "kimi-code",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Kimi Code",
    baseUrl: "https://api.kimi.com/coding/v1",
    recommendedModels: ["kimi-for-coding"],
    docsUrl: "https://www.kimi.com/code/docs/en/"
  },
  {
    id: "litellm",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "LiteLLM",
    baseUrl: "http://localhost:4000",
    recommendedModels: ANTHROPIC_ALIAS_MODELS,
    docsUrl: "https://docs.litellm.ai/docs/"
  },
  {
    id: "manifest",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Manifest",
    baseUrl: "https://app.manifest.build/v1",
    recommendedModels: ["gpt-4.1"],
    docsUrl: "https://app.manifest.build/"
  },
  {
    id: "minimax-cn",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "MiniMax (CN)",
    baseUrl: "https://api.minimaxi.com/anthropic",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/"
  },
  {
    id: "minimax-global",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "MiniMax (Global)",
    baseUrl: "https://api.minimax.io/anthropic",
    recommendedModels: ["MiniMax-M2.7"],
    docsUrl: "https://platform.minimaxi.com/"
  },
  {
    id: "mistral",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    recommendedModels: ["mistral-large-latest", "codestral-latest"],
    docsUrl: "https://console.mistral.ai/api-keys/"
  },
  {
    id: "moonshot",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Kimi / Moonshot AI",
    baseUrl: "https://api.moonshot.cn/anthropic",
    recommendedModels: ["sonnet"],
    docsUrl: "https://platform.moonshot.cn/console/api-keys"
  },
  {
    id: "openrouter",
    kind: "openrouter",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    recommendedModels: ["anthropic/claude-haiku-latest", "anthropic/claude-sonnet-4.5", "openai/gpt-5.2"],
    docsUrl: "https://openrouter.ai/keys"
  },
  {
    id: "openai",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "openai-eu",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "OpenAI (EU)",
    baseUrl: "https://eu.api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "openai-us",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "OpenAI (US)",
    baseUrl: "https://us.api.openai.com/v1",
    recommendedModels: OPENAI_CODE_MODELS,
    docsUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "qwen",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Qwen / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    recommendedModels: ["qwen-plus", "qwen-max"],
    docsUrl: "https://dashscope.console.aliyun.com/apiKey"
  },
  {
    id: "siliconflow",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    recommendedModels: ["Qwen/Qwen3-32B", "deepseek-ai/DeepSeek-V3"],
    docsUrl: "https://siliconflow.cn/"
  },
  {
    id: "volcengine",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Volcengine Ark (Doubao)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    recommendedModels: ["doubao-seed-1-6", "glm-4.6", "deepseek-v4-pro", "kimi-k2.5"],
    docsUrl: "https://www.volcengine.com/docs/82379/1928262"
  },
  {
    id: "vercel-ai-gateway",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    recommendedModels: ["openai/gpt-5.2", "anthropic/claude-sonnet-4.5"],
    docsUrl: "https://vercel.com/docs/ai-gateway"
  },
  {
    id: "xai",
    kind: "openai-compatible",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "openai-compatible",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    recommendedModels: ["grok-4.3", "grok-4"],
    docsUrl: "https://docs.x.ai/"
  },
  {
    id: "xiaomi-mimo",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/anthropic",
    recommendedModels: ["mimo-v2.5-pro"],
    docsUrl: "https://platform.xiaomimimo.com/#/console/api-keys"
  },
  {
    id: "xiaomi-mimo-token-plan",
    kind: "anthropic",
    authMode: "api-key",
    catalogGroup: "api-key",
    modelDiscovery: "anthropic-candidate-validation",
    label: "Xiaomi MiMo Token Plan",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    recommendedModels: ["mimo-v2.5-pro"],
    docsUrl: "https://platform.xiaomimimo.com/#/console/plan-manage"
  },
  {
    id: "ollama",
    kind: "ollama",
    authMode: "local",
    catalogGroup: "local",
    modelDiscovery: "ollama-tags",
    label: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    recommendedModels: ["qwen2.5-coder:14b", "llama3.1:8b"],
    docsUrl: "https://ollama.com/download"
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
  return {
    id: definition.id,
    kind: definition.kind,
    authMode: definition.authMode,
    catalogGroup: definition.catalogGroup,
    modelDiscovery: definition.modelDiscovery,
    label: definition.label,
    enabled: false,
    apiKey: "",
    hasStoredSecret: definition.authMode === "local" || definition.authMode === "environment",
    baseUrl: definition.baseUrl,
    baseUrlEditable: definition.baseUrlEditable,
    models: definition.modelDiscovery === "static" && definition.authMode === "environment" ? toModels(definition.recommendedModels) : toModels([]),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    status: "unconfigured",
    accountLoginConfigured: definition.accountLoginConfigured,
    unavailableReason: definition.unavailableReason,
    isConfigured: false
  };
};
const createBuiltinProviderEntries = () => BUILTIN_LLM_PROVIDER_DEFINITIONS.map((entry) => createBuiltinProviderEntry(entry.id));
const LEFT_SIDEBAR_DEFAULT_WIDTH = 256;
const LEFT_SIDEBAR_MIN_WIDTH = 220;
const LEFT_SIDEBAR_MAX_WIDTH = 420;
const LEFT_SIDEBAR_COLLAPSED_WIDTH = 0;
const RIGHT_PANEL_DEFAULT_WIDTH = 312;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 520;
const RIGHT_PANEL_COLLAPSED_WIDTH = 0;
const TERMINAL_DEFAULT_HEIGHT = 328;
const TERMINAL_MIN_HEIGHT = 180;
const TERMINAL_MAX_HEIGHT = 720;
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
  createProviderOAuthSecretRef(providerId) {
    return `provider-${sanitizeToken(providerId)}-oauth`;
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
      if (entry.encoding === "safeStorage") {
        if (!electron.safeStorage.isEncryptionAvailable()) {
          console.warn("[SecretStorageService] safeStorage is unavailable for secret:", secretRef);
          return "";
        }
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
    const encryptionAvailable = process.env.RDC_AGENT_TEST_MODE !== "1" && electron.safeStorage.isEncryptionAvailable();
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
const KNOWN_AGENT_IDS = new Set(Object.keys(DEFAULT_MODEL_ROUTING));
const RETIRED_BUILTIN_MCP_SERVER_IDS = /* @__PURE__ */ new Set(["builtin.rdc-toolbridge"]);
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
  skillsPath: "",
  mcpPath: "",
  patternsPath: "",
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
  },
  terminal: {
    height: TERMINAL_DEFAULT_HEIGHT
  }
};
const DEFAULT_PROFILE = {
  nickname: "RDC Operator",
  avatarPath: ""
};
const DEFAULT_CONFIGURATION = {
  activeModeProfileId: "debugger.default",
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  modePatternBindings: {
    debugger: "plan-generate-verify",
    analyzer: "free-agent",
    optimizer: "free-agent"
  }
};
function nowIso() {
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
function sanitizeRuntimeIds(values) {
  return dedupeStrings(
    Array.isArray(values) ? values.filter((value) => typeof value === "string").map((value) => value.trim()) : []
  ).filter((value) => !RETIRED_BUILTIN_MCP_SERVER_IDS.has(value));
}
function sanitizePatternBindings(value) {
  const candidate = value && typeof value === "object" ? value : {};
  const bindings = {};
  for (const [mode, patternId] of Object.entries(candidate)) {
    if (typeof patternId === "string" && patternId.trim()) {
      bindings[mode] = patternId.trim();
    }
  }
  return {
    ...DEFAULT_CONFIGURATION.modePatternBindings ?? {},
    ...bindings
  };
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
function resolveAccountRuntimeCredential(providerId, workspaceRoot) {
  const raw = secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(providerId), workspaceRoot);
  if (!raw) {
    return { apiKey: "" };
  }
  try {
    const bundle = JSON.parse(raw);
    if (providerId === "github-copilot") {
      return {
        apiKey: bundle.copilotToken ?? "",
        baseUrl: bundle.copilotApiBaseUrl ?? "https://api.githubcopilot.com"
      };
    }
    if (providerId === "chatgpt-account") {
      return {
        apiKey: bundle.accessToken ?? bundle.apiKey ?? "",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        accountId: bundle.accountId
      };
    }
    return {
      apiKey: bundle.accessToken ?? "",
      baseUrl: "https://api.anthropic.com/v1"
    };
  } catch {
    return { apiKey: "" };
  }
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
function sanitizeTerminal(input, fallback = DEFAULT_LAYOUT.terminal) {
  const candidate = input ?? {};
  return {
    height: clamp(
      typeof candidate.height === "number" ? candidate.height : fallback.height,
      TERMINAL_MIN_HEIGHT,
      TERMINAL_MAX_HEIGHT
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
      enabled: candidate.enabled !== false,
      contextWindowTokens: typeof candidate.contextWindowTokens === "number" && Number.isFinite(candidate.contextWindowTokens) ? Math.max(0, Math.round(candidate.contextWindowTokens)) : null
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
    enabledSkillIds: DEFAULT_CONFIGURATION.enabledSkillIds ?? [],
    enabledMcpServerIds: DEFAULT_CONFIGURATION.enabledMcpServerIds ?? [],
    modePatternBindings: DEFAULT_CONFIGURATION.modePatternBindings ?? {},
    availablePatterns: [],
    availableSkills: [],
    availableMcpServers: [],
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
    providerId: typeof route.providerId === "string" ? normalizeRetiredProviderId(route.providerId.trim()) : "",
    modelId: typeof route.modelId === "string" ? route.modelId.trim() : ""
  };
}
function pickProviderStatus(provider, fallback, canUseProvider, models) {
  if (provider.status === "failed") {
    return "failed";
  }
  if ((provider.status === "verified" || provider.isConfigured === true) && canUseProvider && models.length > 0) {
    return "verified";
  }
  return "unconfigured";
}
function isFixtureProvider(provider) {
  const id = typeof provider.id === "string" ? provider.id.trim() : "";
  const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim().toLowerCase() : "";
  return /^provider-\d+$/i.test(id) || id === "acme" || id === "vendorx" || baseUrl.includes("example.com") || baseUrl.includes("acme.local") || baseUrl.includes("vendorx.ai");
}
const RETIRED_PROVIDER_ID_IMPORTS = {
  gemini: "vertex",
  kimi: "kimi-code",
  "kimi-coding-plan": "kimi-code",
  minimax: "minimax-global",
  zai: "glm-global"
};
function normalizeRetiredProviderId(providerId) {
  return RETIRED_PROVIDER_ID_IMPORTS[providerId] ?? providerId;
}
function sanitizeUserProvider(provider, workspaceRoot = appPathService.getWorkspaceRoot()) {
  const incomingId = typeof provider.id === "string" ? provider.id.trim() : "";
  const rawId = normalizeRetiredProviderId(incomingId);
  if (!rawId || !isBuiltinProviderId(rawId)) {
    return null;
  }
  const builtinFallback = createBuiltinProviderEntry(rawId);
  const definition = getBuiltinProviderDefinition(rawId);
  const incomingSecretRef = typeof provider.secretRef === "string" && provider.secretRef.trim() ? provider.secretRef.trim() : void 0;
  const secretRef = incomingId && incomingId !== rawId ? secretStorageService.createProviderSecretRef(rawId) : incomingSecretRef || secretStorageService.createProviderSecretRef(rawId);
  const kind = builtinFallback.kind;
  const models = sanitizeModels(provider.models ?? []);
  const oauthSecretRef = secretStorageService.createProviderOAuthSecretRef(rawId);
  const resolvedSecret = builtinFallback.authMode === "api-key" ? getResolvedProviderSecret(rawId, secretRef, workspaceRoot) : builtinFallback.authMode === "account" ? secretStorageService.getSecret(oauthSecretRef, workspaceRoot) : "";
  const hasStoredSecret = builtinFallback.authMode === "local" || builtinFallback.authMode === "environment" || Boolean(resolvedSecret);
  const canUseProvider = builtinFallback.authMode === "local" || builtinFallback.authMode === "environment" ? true : builtinFallback.authMode === "api-key" ? Boolean(resolvedSecret) : Boolean(resolvedSecret);
  const status = pickProviderStatus(provider, builtinFallback, canUseProvider, models);
  const enabled = status === "verified" && models.length > 0;
  const label = builtinFallback.label;
  const recommendedModels = builtinFallback.recommendedModels;
  const docsUrl = builtinFallback.docsUrl;
  return {
    id: rawId,
    kind,
    authMode: builtinFallback.authMode,
    catalogGroup: builtinFallback.catalogGroup,
    modelDiscovery: builtinFallback.modelDiscovery,
    label,
    enabled,
    apiKey: "",
    secretRef,
    hasStoredSecret,
    baseUrl: definition?.baseUrlEditable ? typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : definition.baseUrl : definition?.baseUrl,
    baseUrlEditable: definition?.baseUrlEditable,
    models,
    recommendedModels,
    docsUrl,
    status,
    lastTestedAt: typeof provider.lastTestedAt === "string" ? provider.lastTestedAt : void 0,
    lastModelRefreshAt: typeof provider.lastModelRefreshAt === "string" ? provider.lastModelRefreshAt : void 0,
    lastError: status === "failed" && typeof provider.lastError === "string" ? provider.lastError : void 0,
    accountLoginConfigured: definition?.accountLoginConfigured,
    accountLabel: typeof provider.accountLabel === "string" ? provider.accountLabel : void 0,
    planLabel: typeof provider.planLabel === "string" ? provider.planLabel : void 0,
    oauthExpiresAt: typeof provider.oauthExpiresAt === "string" ? provider.oauthExpiresAt : void 0,
    oauthRefreshAvailable: typeof provider.oauthRefreshAvailable === "boolean" ? provider.oauthRefreshAvailable : void 0,
    unavailableReason: definition?.unavailableReason,
    isConfigured: status === "verified" && models.length > 0 && enabled
  };
}
function normalizeUserProviders(providers, workspaceRoot) {
  const persistedProviders = /* @__PURE__ */ new Map();
  for (const entry of Array.isArray(providers) ? providers : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const provider = sanitizeUserProvider(entry, workspaceRoot);
    if (!provider || persistedProviders.has(provider.id)) {
      continue;
    }
    persistedProviders.set(provider.id, provider);
  }
  return createBuiltinProviderEntries().map((catalogProvider) => sanitizeUserProvider(persistedProviders.get(catalogProvider.id) ?? catalogProvider, workspaceRoot)).filter((provider) => provider !== null);
}
function hydrateProviderSecrets(providers, workspaceRoot) {
  return providers.map((provider) => {
    const resolvedSecret = provider.authMode === "api-key" ? getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot) : provider.authMode === "account" ? secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(provider.id), workspaceRoot) : "";
    const hasStoredSecret = provider.authMode === "local" || provider.authMode === "environment" || Boolean(resolvedSecret);
    const canUseProvider = provider.authMode === "local" || provider.authMode === "environment" ? true : provider.authMode === "api-key" ? Boolean(resolvedSecret) : Boolean(resolvedSecret);
    const status = provider.status === "unavailable" ? "unavailable" : provider.status === "verified" && canUseProvider && provider.models.length > 0 ? "verified" : provider.status === "failed" ? "failed" : "unconfigured";
    const isConfigured = status === "verified" && provider.models.length > 0;
    return {
      ...provider,
      // The renderer only needs to know whether a secret exists.
      // Keep plaintext secrets out of settings:get payloads.
      apiKey: "",
      hasStoredSecret,
      enabled: isConfigured,
      status,
      isConfigured
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
      provider && provider.isConfigured && provider.models.some((model) => model.id === incoming.modelId && model.enabled !== false)
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
    const nextProviders = [];
    for (const entry of rawProviders) {
      if (isFixtureProvider(entry)) {
        fixes.push(`Removed fixture provider ${entry.id}`);
        secretStorageService.deleteSecret(entry.secretRef, workspaceRoot);
        continue;
      }
      const incomingId = typeof entry.id === "string" ? entry.id.trim() : "";
      const rawId = normalizeRetiredProviderId(incomingId);
      if (!rawId) {
        fixes.push("Removed provider with empty id");
        continue;
      }
      if (incomingId && incomingId !== rawId) {
        fixes.push(`Renamed retired provider id ${incomingId} to ${rawId}`);
      }
      const canonicalSecretRef = secretStorageService.createProviderSecretRef(rawId);
      const incomingSecretRef = typeof entry.secretRef === "string" && entry.secretRef.trim() ? entry.secretRef.trim() : void 0;
      const secretRef = incomingId && incomingId !== rawId ? canonicalSecretRef : incomingSecretRef || canonicalSecretRef;
      if (incomingSecretRef && incomingSecretRef !== secretRef) {
        const incomingSecret = secretStorageService.getSecret(incomingSecretRef, workspaceRoot);
        if (incomingSecret.trim()) {
          secretStorageService.setSecret(secretRef, incomingSecret, workspaceRoot);
          secretStorageService.deleteSecret(incomingSecretRef, workspaceRoot);
          fixes.push(`Moved retired provider secret ${incomingId} to ${rawId}`);
        }
      }
      if (entry.apiKey?.trim()) {
        secretStorageService.setSecret(secretRef, entry.apiKey.trim(), workspaceRoot);
        fixes.push(`Migrated plaintext secret for ${rawId}`);
      }
      const sanitized = sanitizeUserProvider({ ...entry, secretRef }, workspaceRoot);
      if (!sanitized) {
        fixes.push(`Removed non-catalog provider ${rawId}`);
        continue;
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
          secretRef,
          baseUrl: legacyOpenRouter.baseUrl || createBuiltinProviderEntry("openrouter").baseUrl
        }, workspaceRoot);
        if (sanitized?.isConfigured && !nextProviders.some((provider) => provider.id === "openrouter")) {
          nextProviders.push(sanitized);
          fixes.push("Imported legacy OpenRouter provider");
        }
      }
    }
    const catalogProviders = normalizeUserProviders(nextProviders, workspaceRoot);
    const nextRoutes = normalizeUserRoutes(rawRoutes, catalogProviders);
    const incomingRoutes = Array.isArray(rawRoutes) ? rawRoutes.map((entry) => {
      if (entry && typeof entry === "object") {
        const providerId = entry.providerId;
        const incomingProviderId = typeof providerId === "string" ? providerId.trim() : "";
        const normalizedProviderId = normalizeRetiredProviderId(incomingProviderId);
        if (incomingProviderId && incomingProviderId !== normalizedProviderId) {
          const agentId = entry.agentId;
          fixes.push(`Renamed retired route provider id ${incomingProviderId} to ${normalizedProviderId}${typeof agentId === "string" ? ` for ${agentId}` : ""}`);
        }
      }
      return sanitizeRoute(entry);
    }).filter((route) => route !== null) : [];
    for (const route of incomingRoutes) {
      const normalized = nextRoutes.find((entry) => entry.agentId === route.agentId);
      if (!normalized || normalized.providerId !== route.providerId || normalized.modelId !== route.modelId) {
        if (route.providerId || route.modelId) {
          fixes.push(`Cleared invalid route for ${route.agentId}`);
        }
      }
    }
    if (!catalogProviders.some((provider) => provider.isConfigured)) {
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
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
        terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal)
      },
      profile: {
        nickname: typeof candidate.profile?.nickname === "string" && candidate.profile.nickname.trim() ? candidate.profile.nickname.trim() : DEFAULT_PROFILE.nickname,
        avatarPath: typeof candidate.profile?.avatarPath === "string" ? candidate.profile.avatarPath : DEFAULT_PROFILE.avatarPath
      },
      workspace: {
        rootPath: candidate.workspace?.rootPath?.trim() || workspaceRoot
      },
      llm: {
        providers: catalogProviders.map((provider) => ({ ...provider, apiKey: "" })),
        agentRoutes: nextRoutes
      },
      configuration: {
        activeModeProfileId: candidate.configuration?.activeModeProfileId?.trim() || DEFAULT_CONFIGURATION.activeModeProfileId,
        enabledSkillIds: sanitizeRuntimeIds(candidate.configuration?.enabledSkillIds),
        enabledMcpServerIds: sanitizeRuntimeIds(candidate.configuration?.enabledMcpServerIds),
        modePatternBindings: sanitizePatternBindings(candidate.configuration?.modePatternBindings),
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
        rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout?.rightPanel ?? DEFAULT_LAYOUT.rightPanel),
        terminal: sanitizeTerminal(candidate.layout?.terminal, fallback.layout?.terminal ?? DEFAULT_LAYOUT.terminal)
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
        enabledSkillIds: sanitizeRuntimeIds(candidate.configuration?.enabledSkillIds),
        enabledMcpServerIds: sanitizeRuntimeIds(candidate.configuration?.enabledMcpServerIds),
        modePatternBindings: sanitizePatternBindings(candidate.configuration?.modePatternBindings),
        lastMigrationReportPath: candidate.configuration?.lastMigrationReportPath
      }
    };
  }
  writeMigrationReport(paths, fixes, warnings) {
    const reportPath = path.join(paths.migrationReportsPath, `settings-rebuild-${Date.now()}.json`);
    fs.mkdirSync(paths.migrationReportsPath, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: nowIso(),
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
      enabledSkillIds: normalized.configuration?.enabledSkillIds ?? [],
      enabledMcpServerIds: normalized.configuration?.enabledMcpServerIds ?? [],
      modePatternBindings: normalized.configuration?.modePatternBindings ?? DEFAULT_CONFIGURATION.modePatternBindings ?? {},
      availablePatterns: [],
      availableSkills: [],
      availableMcpServers: [],
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
    if (!provider || provider.authMode !== "api-key") {
      return "";
    }
    return getResolvedProviderSecret(provider.id, provider.secretRef, workspaceRoot);
  }
  getProviderOAuthSecret(providerId, workspaceRoot = appPathService.getWorkspaceRoot()) {
    this.ensureInitialized();
    return secretStorageService.getSecret(secretStorageService.createProviderOAuthSecretRef(providerId), workspaceRoot);
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
    const providerDrafts = (patch.llm?.providers ?? currentPersisted.llm?.providers ?? []).map((provider) => {
      const secretRef = provider.secretRef || secretStorageService.createProviderSecretRef(provider.id);
      const apiKey = provider.apiKey?.trim() ?? "";
      if (provider.authMode === "api-key" && apiKey) {
        secretStorageService.setSecret(secretRef, apiKey, nextPaths.workspaceRoot);
      } else if (provider.authMode === "api-key" && !provider.hasStoredSecret) {
        secretStorageService.deleteSecret(secretRef, nextPaths.workspaceRoot);
      }
      return sanitizeUserProvider({
        ...provider,
        secretRef
      }, nextPaths.workspaceRoot);
    }).filter((provider) => provider !== null);
    const nextProviders = normalizeUserProviders(providerDrafts, nextPaths.workspaceRoot);
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
        ),
        terminal: sanitizeTerminal(
          {
            ...currentPersisted.layout?.terminal ?? DEFAULT_LAYOUT.terminal,
            ...patch.layout?.terminal ?? {}
          },
          DEFAULT_LAYOUT.terminal
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
        enabledSkillIds: patch.configuration?.enabledSkillIds ? sanitizeRuntimeIds(patch.configuration.enabledSkillIds) : sanitizeRuntimeIds(currentPersisted.configuration?.enabledSkillIds),
        enabledMcpServerIds: patch.configuration?.enabledMcpServerIds ? sanitizeRuntimeIds(patch.configuration.enabledMcpServerIds) : sanitizeRuntimeIds(currentPersisted.configuration?.enabledMcpServerIds),
        modePatternBindings: patch.configuration?.modePatternBindings ? sanitizePatternBindings(patch.configuration.modePatternBindings) : sanitizePatternBindings(currentPersisted.configuration?.modePatternBindings),
        lastMigrationReportPath: currentPersisted.configuration?.lastMigrationReportPath
      }
    };
    this.writeSettings(nextPersisted, nextPaths.workspaceRoot);
    return this.getAll({
      ...nextPaths,
      ...runtimePaths ?? {}
    });
  }
  saveProviderConnection(providerId, apiKey, models, baseUrl = "") {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error("该 Provider 暂未返回可用模型");
    }
    const timestamp = nowIso();
    const nextProvider = {
      ...provider,
      apiKey: apiKey.trim(),
      enabled: true,
      hasStoredSecret: provider.authMode === "api-key" ? Boolean(apiKey.trim() || provider.hasStoredSecret) : provider.authMode === "local" || provider.authMode === "environment" || provider.hasStoredSecret,
      baseUrl: provider.baseUrlEditable ? baseUrl.trim() || provider.baseUrl : provider.baseUrl,
      models: discoveredModels.map((model) => ({ ...model, enabled: true })),
      status: "verified",
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: void 0,
      isConfigured: true
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes
      }
    });
  }
  saveProviderAccountConnection(providerId, secretPayload, models, accountSummary = {}) {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id) || provider.authMode !== "account") {
      throw new Error(`Unknown account provider: ${providerId}`);
    }
    const discoveredModels = sanitizeModels(models);
    if (discoveredModels.length === 0) {
      throw new Error("Provider returned no usable models");
    }
    secretStorageService.setSecret(
      secretStorageService.createProviderOAuthSecretRef(provider.id),
      secretPayload,
      current.workspace.rootPath
    );
    const timestamp = nowIso();
    const nextProvider = {
      ...provider,
      enabled: true,
      hasStoredSecret: true,
      models: discoveredModels.map((model) => ({ ...model, enabled: true })),
      status: "verified",
      lastTestedAt: timestamp,
      lastModelRefreshAt: timestamp,
      lastError: void 0,
      accountLabel: accountSummary.accountLabel,
      planLabel: accountSummary.planLabel,
      oauthExpiresAt: accountSummary.oauthExpiresAt,
      oauthRefreshAvailable: accountSummary.oauthRefreshAvailable,
      isConfigured: true
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes
      }
    });
  }
  disconnectProvider(providerId) {
    const current = this.getAll();
    const provider = current.llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    if (provider.authMode === "api-key") {
      secretStorageService.deleteSecret(provider.secretRef, current.workspace.rootPath);
    } else if (provider.authMode === "account") {
      secretStorageService.deleteSecret(secretStorageService.createProviderOAuthSecretRef(provider.id), current.workspace.rootPath);
    }
    const fallback = createBuiltinProviderEntry(provider.id);
    const nextProvider = {
      ...provider,
      apiKey: "",
      hasStoredSecret: fallback.hasStoredSecret,
      models: [],
      enabled: false,
      status: fallback.status,
      lastError: void 0,
      accountLabel: void 0,
      planLabel: void 0,
      oauthExpiresAt: void 0,
      oauthRefreshAvailable: void 0,
      isConfigured: false
    };
    return this.setAll({
      llm: {
        providers: current.llm.providers.map((entry) => entry.id === providerId ? nextProvider : entry),
        agentRoutes: current.llm.agentRoutes
      }
    });
  }
  getLlmConfig() {
    const settings = this.getAll();
    const providers = settings.llm.providers.filter((provider) => provider.enabled && provider.isConfigured && provider.status === "verified").map((provider) => {
      const accountCredential = provider.authMode === "account" ? resolveAccountRuntimeCredential(provider.id, settings.workspace.rootPath) : { apiKey: "", baseUrl: void 0 };
      return {
        id: provider.id,
        kind: provider.kind,
        label: provider.label,
        enabled: provider.enabled,
        apiKey: provider.authMode === "api-key" ? getResolvedProviderSecret(provider.id, provider.secretRef, settings.workspace.rootPath) : provider.authMode === "account" ? accountCredential.apiKey : "",
        baseUrl: accountCredential.baseUrl ?? provider.baseUrl,
        accountId: accountCredential.accountId,
        authMode: provider.authMode,
        models: provider.models.filter((model) => model.enabled).map((model) => model.id),
        docsUrl: provider.docsUrl
      };
    }).filter((provider) => provider.models.length > 0);
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
const REQUEST_TIMEOUT_MS$1 = 2e4;
const CHATGPT_CALLBACK_PORT = 1455;
const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const pendingFlows = /* @__PURE__ */ new Map();
const isAccountProviderId = (providerId) => providerId === "claude-account" || providerId === "chatgpt-account" || providerId === "github-copilot";
const isTestMode$1 = () => process.env.RDC_AGENT_TEST_MODE === "1";
const base64Url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const createPkce = () => {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
};
const appendParams = (baseUrl, params) => {
  const url2 = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url2.searchParams.set(key, value);
  }
  return url2.toString();
};
const normalizeAccountModels = (values) => {
  const models = /* @__PURE__ */ new Map();
  for (const value of values) {
    const record = value && typeof value === "object" ? value : null;
    const id = typeof value === "string" ? value.trim() : typeof record?.id === "string" ? record.id.trim() : typeof record?.name === "string" ? record.name.trim() : "";
    if (!id || !isAgentRoutableAccountModel(id) || models.has(id)) {
      continue;
    }
    models.set(id, {
      id,
      label: typeof record?.display_name === "string" && record.display_name.trim() ? record.display_name.trim() : id,
      enabled: true
    });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
};
const readString = (value) => typeof value === "string" && value.trim() ? value.trim() : void 0;
const parseJwtPayload = (token) => {
  const payload = token?.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
const extractChatGptAccountId = (idToken) => {
  const claims = parseJwtPayload(idToken);
  if (!claims) {
    return void 0;
  }
  const authClaim = claims["https://api.openai.com/auth"];
  const authRecord = authClaim && typeof authClaim === "object" && !Array.isArray(authClaim) ? authClaim : {};
  const organizations = Array.isArray(claims.organizations) ? claims.organizations : [];
  const firstOrganization = organizations[0] && typeof organizations[0] === "object" ? organizations[0] : {};
  return readString(authRecord.chatgpt_account_id) ?? readString(authRecord.account_id) ?? readString(claims["https://api.openai.com/auth.chatgpt_account_id"]) ?? readString(claims.chatgpt_account_id) ?? readString(claims.account_id) ?? readString(firstOrganization.id);
};
const createAccountCatalogModels = (providerId) => {
  const definition = getBuiltinProviderDefinition(providerId);
  const seen = /* @__PURE__ */ new Set();
  return (definition?.recommendedModels ?? []).map((modelId) => modelId.trim()).filter((modelId) => {
    if (!modelId || seen.has(modelId) || !isAgentRoutableAccountModel(modelId)) {
      return false;
    }
    seen.add(modelId);
    return true;
  }).map((modelId) => ({
    id: modelId,
    label: modelId,
    enabled: true
  }));
};
const mergeAccountModels = (...groups) => {
  const models = /* @__PURE__ */ new Map();
  for (const group of groups) {
    for (const model of group) {
      if (!models.has(model.id) && isAgentRoutableAccountModel(model.id)) {
        models.set(model.id, model);
      }
    }
  }
  return Array.from(models.values());
};
const isAgentRoutableAccountModel = (modelId) => {
  const normalized = modelId.toLowerCase();
  return !(normalized.includes("embedding") || normalized.includes("moderation") || normalized.includes("rerank") || normalized.includes("whisper") || normalized.includes("tts") || normalized.includes("dall-e") || normalized.includes("image") || normalized.includes("audio") || normalized.includes("realtime") || normalized.includes("transcribe"));
};
const parseProviderError$1 = (error) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Connection test timed out.";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Provider connection failed.";
};
const isExpiringSoon = (expiresAt) => {
  if (!expiresAt) {
    return false;
  }
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 6e4;
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const canRefreshBundle = (bundle) => Boolean(bundle.refreshToken || bundle.providerId === "github-copilot" && bundle.accessToken);
const fetchJson = async (url2, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS$1);
  try {
    const response = await fetch(url2, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = payload && typeof payload === "object" && typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
};
const parseModels = (payload) => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = payload.data ?? payload.models;
  return Array.isArray(data) ? normalizeAccountModels(data) : [];
};
const parseCopilotModels = (payload) => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = payload.data ?? payload.models;
  if (!Array.isArray(data)) {
    return [];
  }
  return normalizeAccountModels(data.filter((value) => {
    const record = value && typeof value === "object" ? value : null;
    const policy = record?.policy && typeof record.policy === "object" && !Array.isArray(record.policy) ? record.policy : null;
    const state2 = typeof policy?.state === "string" ? policy.state.toLowerCase() : "";
    return !state2 || state2 === "enabled";
  }));
};
class ProviderAccountAuthService {
  async startLogin(providerId) {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, "Provider does not support account login.");
    }
    if (providerId === "claude-account") {
      return this.startClaudeLogin();
    }
    if (providerId === "chatgpt-account") {
      return this.startChatGptLogin();
    }
    return this.startGitHubCopilotLogin();
  }
  async finishLogin(request) {
    if (!isAccountProviderId(request.providerId)) {
      return this.status(request.providerId, "Provider does not support account login.");
    }
    const flow = this.findFlow(request.providerId, request.flowId);
    if (!flow) {
      return this.status(request.providerId, "Login flow expired or was not started.", "failed");
    }
    try {
      if (request.providerId === "claude-account") {
        const bundle2 = await this.exchangeClaudeCode(flow, request.code?.trim() ?? "");
        return await this.persistAccount(request.providerId, bundle2);
      }
      if (request.providerId === "chatgpt-account") {
        const bundle2 = await this.exchangeChatGptCode(flow, request.code?.trim() ?? "");
        return await this.persistAccount(request.providerId, bundle2);
      }
      const bundle = await this.pollGitHubDevice(flow);
      return await this.persistAccount(request.providerId, bundle);
    } catch (error) {
      flow.error = parseProviderError$1(error);
      return this.status(request.providerId, flow.error, "failed");
    }
  }
  async test(providerId) {
    if (!isAccountProviderId(providerId)) {
      return this.status(providerId, "Provider does not support account login.");
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      return this.status(providerId, "Account is not connected.");
    }
    try {
      const activeBundle = await this.refreshBundleIfNeeded(bundle);
      const models = await this.discoverModels(activeBundle);
      if (models.length === 0) {
        throw new Error("Account provider returned no usable models.");
      }
      settingsService.saveProviderAccountConnection(
        providerId,
        JSON.stringify(activeBundle),
        models,
        {
          accountLabel: activeBundle.accountLabel,
          planLabel: activeBundle.planLabel,
          oauthExpiresAt: activeBundle.expiresAt,
          oauthRefreshAvailable: canRefreshBundle(activeBundle)
        }
      );
      return this.status(providerId);
    } catch (error) {
      return this.status(providerId, parseProviderError$1(error), "failed");
    }
  }
  async ensureRuntimeCredentials(providerId) {
    if (!isAccountProviderId(providerId)) {
      return;
    }
    const bundle = this.readBundle(providerId);
    if (!bundle) {
      throw new Error("Account is not connected.");
    }
    if (providerId === "github-copilot" && !bundle.accessToken) {
      throw new Error("GitHub Copilot account access token is missing. Sign in again.");
    }
    const activeBundle = await this.refreshBundleIfNeeded(bundle);
    if (JSON.stringify(activeBundle) === JSON.stringify(bundle)) {
      return;
    }
    const models = await this.discoverModels(activeBundle);
    settingsService.saveProviderAccountConnection(
      providerId,
      JSON.stringify(activeBundle),
      models,
      {
        accountLabel: activeBundle.accountLabel,
        planLabel: activeBundle.planLabel,
        oauthExpiresAt: activeBundle.expiresAt,
        oauthRefreshAvailable: canRefreshBundle(activeBundle)
      }
    );
  }
  status(providerId, message, forcedState) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    const isAccount = isAccountProviderId(providerId);
    const flow = isAccount ? this.findFlow(providerId) : null;
    const connected = Boolean(provider?.isConfigured && provider.status === "verified");
    const state2 = forcedState ?? (flow?.error ? "failed" : flow ? "pending" : connected ? "connected" : isAccount ? "signed-out" : "unavailable");
    const pendingMessage = providerId === "github-copilot" ? "Waiting for GitHub authorization." : "Waiting for authorization.";
    return {
      providerId,
      state: state2,
      available: isAccount,
      connected,
      message: message ?? flow?.error ?? (connected ? "Connected" : flow ? pendingMessage : "Not connected"),
      error: forcedState === "failed" ? message : flow?.error,
      accountLabel: provider?.accountLabel,
      planLabel: provider?.planLabel,
      expiresAt: provider?.oauthExpiresAt,
      authUrl: flow?.authUrl,
      verificationUri: flow?.verificationUri,
      userCode: flow?.userCode,
      requiresCodeInput: Boolean(flow?.providerId === "claude-account"),
      models: provider?.models ?? []
    };
  }
  logout(providerId) {
    if (isAccountProviderId(providerId)) {
      this.clearFlows(providerId);
      settingsService.disconnectProvider(providerId);
    }
    return this.status(providerId);
  }
  startClaudeLogin() {
    const { verifier, challenge } = createPkce();
    const state2 = crypto.randomUUID();
    const flow = {
      providerId: "claude-account",
      flowId: crypto.randomUUID(),
      state: state2,
      codeVerifier: verifier,
      authUrl: appendParams("https://claude.ai/oauth/authorize", {
        code: "true",
        client_id: CLAUDE_CLIENT_ID,
        response_type: "code",
        redirect_uri: "https://console.anthropic.com/oauth/code/callback",
        scope: "org:create_api_key user:profile user:inference",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: state2
      }),
      expiresAt: Date.now() + 10 * 60 * 1e3
    };
    this.setFlow(flow);
    void this.openExternal(flow.authUrl);
    return this.status(flow.providerId);
  }
  async startChatGptLogin() {
    const { verifier, challenge } = createPkce();
    const state2 = crypto.randomUUID();
    const flow = {
      providerId: "chatgpt-account",
      flowId: crypto.randomUUID(),
      state: state2,
      codeVerifier: verifier,
      authUrl: appendParams("https://auth.openai.com/oauth/authorize", {
        client_id: CHATGPT_CLIENT_ID,
        response_type: "code",
        redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
        scope: "openid profile email offline_access",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: state2,
        codex_cli_simplified_flow: "true",
        id_token_add_organizations: "true"
      }),
      expiresAt: Date.now() + 10 * 60 * 1e3
    };
    this.setFlow(flow);
    await this.startChatGptCallbackServer(flow);
    void this.openExternal(flow.authUrl);
    return this.status(flow.providerId);
  }
  async startGitHubCopilotLogin() {
    const payload = await fetchJson("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: GITHUB_COPILOT_CLIENT_ID,
        scope: "read:user"
      })
    });
    const flow = {
      providerId: "github-copilot",
      flowId: crypto.randomUUID(),
      state: crypto.randomUUID(),
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      intervalSeconds: payload.interval ?? 5,
      expiresAt: Date.now() + (payload.expires_in ?? 900) * 1e3
    };
    this.setFlow(flow);
    if (flow.verificationUri) {
      void this.openExternal(flow.verificationUri);
    }
    void this.pollGitHubDevice(flow).then((bundle) => this.persistAccount("github-copilot", bundle)).catch((error) => {
      flow.error = parseProviderError$1(error);
    });
    return this.status(flow.providerId);
  }
  async exchangeClaudeCode(flow, code) {
    if (!code || !flow.codeVerifier) {
      throw new Error("Authorization code is required.");
    }
    const payload = await fetchJson("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "RDC-Agent"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: CLAUDE_CLIENT_ID,
        code,
        redirect_uri: "https://console.anthropic.com/oauth/code/callback",
        code_verifier: flow.codeVerifier,
        state: flow.state
      })
    });
    if (!payload.access_token) {
      throw new Error("Claude OAuth did not return an access token.");
    }
    return {
      providerId: "claude-account",
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1e3).toISOString(),
      accountLabel: "Claude Account",
      planLabel: payload.scope
    };
  }
  async exchangeChatGptCode(flow, code) {
    if (!code || !flow.codeVerifier) {
      throw new Error("Authorization code is required.");
    }
    const tokenPayload = await fetchJson("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CHATGPT_CLIENT_ID,
        code,
        redirect_uri: `http://localhost:${CHATGPT_CALLBACK_PORT}/auth/callback`,
        code_verifier: flow.codeVerifier
      }).toString()
    });
    if (!tokenPayload.access_token) {
      throw new Error("OpenAI OAuth did not return an access token.");
    }
    return {
      providerId: "chatgpt-account",
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token,
      apiKey: tokenPayload.access_token,
      idToken: tokenPayload.id_token,
      accountId: extractChatGptAccountId(tokenPayload.id_token),
      expiresAt: new Date(Date.now() + (tokenPayload.expires_in ?? 3600) * 1e3).toISOString(),
      accountLabel: "ChatGPT Account"
    };
  }
  async pollGitHubDevice(flow) {
    if (!flow.deviceCode) {
      throw new Error("GitHub device code is missing.");
    }
    let intervalSeconds = flow.intervalSeconds ?? 5;
    let delayBeforePoll = !isTestMode$1();
    for (; ; ) {
      if (Date.now() > flow.expiresAt) {
        throw new Error("GitHub authorization code expired.");
      }
      if (delayBeforePoll) {
        await wait(intervalSeconds * 1e3);
      }
      delayBeforePoll = true;
      const payload = await fetchJson("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: GITHUB_COPILOT_CLIENT_ID,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code"
        })
      });
      if (payload.error === "authorization_pending") {
        delete flow.error;
        continue;
      }
      if (payload.error === "slow_down") {
        delete flow.error;
        intervalSeconds += 5;
        continue;
      }
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (!payload.access_token) {
        throw new Error("GitHub OAuth did not return an access token.");
      }
      const copilot = await fetchJson("https://api.github.com/copilot_internal/v2/token", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `token ${payload.access_token}`,
          ...COPILOT_EDITOR_HEADERS
        }
      });
      if (!copilot.token) {
        throw new Error("GitHub Copilot did not return an API token.");
      }
      return {
        providerId: "github-copilot",
        accessToken: payload.access_token,
        copilotToken: copilot.token,
        copilotApiBaseUrl: copilot.endpoints?.api ?? "https://api.githubcopilot.com",
        expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1e3).toISOString() : void 0,
        accountLabel: "GitHub Copilot"
      };
    }
  }
  async persistAccount(providerId, bundle) {
    const models = await this.discoverModels(bundle);
    if (models.length === 0) {
      throw new Error("Account provider returned no usable models.");
    }
    settingsService.saveProviderAccountConnection(
      providerId,
      JSON.stringify(bundle),
      models,
      {
        accountLabel: bundle.accountLabel,
        planLabel: bundle.planLabel,
        oauthExpiresAt: bundle.expiresAt,
        oauthRefreshAvailable: canRefreshBundle(bundle)
      }
    );
    this.clearFlows(providerId);
    return this.status(providerId);
  }
  async refreshBundleIfNeeded(bundle) {
    if (bundle.providerId !== "github-copilot" && !isExpiringSoon(bundle.expiresAt)) {
      return bundle;
    }
    if (bundle.providerId === "github-copilot") {
      if (!bundle.accessToken) {
        return bundle;
      }
      const copilot = await fetchJson("https://api.github.com/copilot_internal/v2/token", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `token ${bundle.accessToken}`,
          ...COPILOT_EDITOR_HEADERS
        }
      });
      if (!copilot.token) {
        throw new Error("GitHub Copilot did not return an API token.");
      }
      return {
        ...bundle,
        copilotToken: copilot.token,
        copilotApiBaseUrl: copilot.endpoints?.api ?? bundle.copilotApiBaseUrl ?? "https://api.githubcopilot.com",
        expiresAt: copilot.expires_at ? new Date(copilot.expires_at * 1e3).toISOString() : bundle.expiresAt
      };
    }
    if (!bundle.refreshToken) {
      return bundle;
    }
    if (bundle.providerId === "claude-account") {
      const payload2 = await fetchJson("https://platform.claude.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "RDC-Agent"
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLAUDE_CLIENT_ID,
          refresh_token: bundle.refreshToken
        })
      });
      if (!payload2.access_token) {
        throw new Error("Claude OAuth refresh did not return an access token.");
      }
      return {
        ...bundle,
        accessToken: payload2.access_token,
        refreshToken: payload2.refresh_token ?? bundle.refreshToken,
        expiresAt: new Date(Date.now() + (payload2.expires_in ?? 3600) * 1e3).toISOString(),
        planLabel: payload2.scope ?? bundle.planLabel
      };
    }
    const payload = await fetchJson("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CHATGPT_CLIENT_ID,
        refresh_token: bundle.refreshToken
      }).toString()
    });
    if (!payload.access_token) {
      throw new Error("OpenAI OAuth refresh did not return an access token.");
    }
    return {
      ...bundle,
      accessToken: payload.access_token,
      apiKey: payload.access_token,
      idToken: payload.id_token ?? bundle.idToken,
      accountId: extractChatGptAccountId(payload.id_token) ?? bundle.accountId,
      refreshToken: payload.refresh_token ?? bundle.refreshToken,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1e3).toISOString()
    };
  }
  async discoverModels(bundle) {
    if (bundle.providerId === "chatgpt-account" || bundle.providerId === "claude-account") {
      return createAccountCatalogModels(bundle.providerId);
    }
    if (bundle.providerId === "github-copilot") {
      const catalogModels = createAccountCatalogModels(bundle.providerId);
      const baseUrl = (bundle.copilotApiBaseUrl ?? "https://api.githubcopilot.com").replace(/\/+$/, "");
      try {
        const payload2 = await fetchJson(`${baseUrl}/models`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${bundle.copilotToken}`,
            "Content-Type": "application/json",
            ...COPILOT_WIRE_HEADERS
          }
        });
        return mergeAccountModels(catalogModels, parseCopilotModels(payload2));
      } catch {
        return catalogModels;
      }
    }
    const payload = await fetchJson("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bundle.apiKey ?? bundle.accessToken}`
      }
    });
    return parseModels(payload);
  }
  readBundle(providerId) {
    const raw = settingsService.getProviderOAuthSecret(providerId);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed.providerId === providerId ? parsed : null;
    } catch {
      return null;
    }
  }
  findFlow(providerId, flowId) {
    for (const flow of pendingFlows.values()) {
      if (flow.providerId === providerId && (!flowId || flow.flowId === flowId) && Date.now() <= flow.expiresAt) {
        return flow;
      }
    }
    return null;
  }
  setFlow(flow) {
    this.clearFlows(flow.providerId);
    pendingFlows.set(flow.flowId, flow);
  }
  clearFlows(providerId) {
    for (const [flowId, flow] of pendingFlows.entries()) {
      if (flow.providerId === providerId) {
        this.closeFlowServer(flow);
        pendingFlows.delete(flowId);
      }
    }
  }
  closeFlowServer(flow) {
    const server = flow.server;
    if (!server) {
      return;
    }
    delete flow.server;
    if (server.listening) {
      server.close();
    }
  }
  startChatGptCallbackServer(flow) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = http.createServer((request, response) => {
        const url2 = new URL(request.url ?? "/", `http://localhost:${CHATGPT_CALLBACK_PORT}`);
        if (url2.pathname !== "/auth/callback" || url2.searchParams.get("state") !== flow.state) {
          response.writeHead(400, { "Content-Type": "text/plain" });
          response.end("Invalid OAuth callback.");
          return;
        }
        const code = url2.searchParams.get("code") ?? "";
        void this.finishLogin({ providerId: flow.providerId, flowId: flow.flowId, code }).then(() => {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end("<html><body>RDC Agent sign-in complete. You can return to the app.</body></html>");
        }).catch((error) => {
          response.writeHead(500, { "Content-Type": "text/plain" });
          response.end(parseProviderError$1(error));
        }).finally(() => {
          this.closeFlowServer(flow);
        });
      });
      flow.server = server;
      server.on("error", (error) => {
        flow.error = parseProviderError$1(error);
        this.closeFlowServer(flow);
        pendingFlows.delete(flow.flowId);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      server.listen(CHATGPT_CALLBACK_PORT, "127.0.0.1", () => {
        settled = true;
        resolve();
      });
    });
  }
  async openExternal(url2) {
    if (!url2 || isTestMode$1()) {
      return;
    }
    await electron.shell.openExternal(url2);
  }
}
const providerAccountAuthService = new ProviderAccountAuthService();
class ToolBridgeAgentToolPort {
  async listTools(_agentId) {
    const catalog = await toolBridge.loadCatalog();
    return catalog.tools ?? [];
  }
  execute(request) {
    return toolBridge.call({
      toolName: request.toolName,
      args: request.args,
      runId: request.runId,
      turnId: request.turnId,
      contextId: request.contextId,
      runtimeOwner: request.runtimeOwner,
      ownerLeaseId: request.ownerLeaseId,
      abortSignal: request.signal
    });
  }
}
const toolBridgeAgentToolPort = new ToolBridgeAgentToolPort();
const MAX_TRACE_STRING_LENGTH = 512;
const MAX_TRACE_ARRAY_LENGTH = 20;
const MAX_TOOL_RESULT_LENGTH = 8e3;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|authorization|secret|token|credential|password)/i;
const SECRET_VALUE_PATTERN = /\b(?:sk|ak|pk|rk|ds|or)-[a-z0-9._-]{8,}\b/gi;
function createLocalTraceId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function redactTraceText(text) {
  const redacted = text.replace(SECRET_VALUE_PATTERN, "[REDACTED_SECRET]");
  return redacted.length > MAX_TRACE_STRING_LENGTH ? `${redacted.slice(0, MAX_TRACE_STRING_LENGTH)}...[truncated]` : redacted;
}
function sanitizeTraceValue(value, depth = 0) {
  if (value === null || value === void 0) {
    return value;
  }
  if (typeof value === "string") {
    return redactTraceText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 4) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    const entries = value.slice(0, MAX_TRACE_ARRAY_LENGTH).map((entry) => sanitizeTraceValue(entry, depth + 1));
    return value.length > MAX_TRACE_ARRAY_LENGTH ? [...entries, { truncatedItems: value.length - MAX_TRACE_ARRAY_LENGTH }] : entries;
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED_SECRET]" : sanitizeTraceValue(entry, depth + 1);
    }
    return output;
  }
  return String(value);
}
function parameterSchema(parameter) {
  if (parameter.enum?.length) {
    return {
      type: "string",
      enum: parameter.enum,
      description: parameter.description
    };
  }
  if (parameter.type === "array") {
    return {
      type: "array",
      items: {},
      description: parameter.description
    };
  }
  if (parameter.type === "object") {
    return {
      type: "object",
      additionalProperties: true,
      description: parameter.description
    };
  }
  return {
    type: parameter.type,
    description: parameter.description
  };
}
function buildToolJsonSchema(tool) {
  const properties = {};
  const required = [];
  for (const parameter of tool.parameters ?? []) {
    properties[parameter.name] = parameterSchema(parameter);
    if (parameter.required) {
      required.push(parameter.name);
    }
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
function toolMatchesPolicy(toolName, allowlist) {
  if (!allowlist || allowlist.length === 0) {
    return false;
  }
  for (const pattern of allowlist) {
    if (pattern === "*" || pattern === toolName) {
      return true;
    }
    if (pattern.endsWith(".*") && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}
function sanitizeSdkToolName(toolName) {
  const sanitized = toolName.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(sanitized) ? sanitized : `rdc_${sanitized}`;
}
function prepareAgentTools(tools, allowlist) {
  const used = /* @__PURE__ */ new Set();
  const prepared = [];
  for (const definition of tools) {
    if (!toolMatchesPolicy(definition.name, allowlist)) {
      continue;
    }
    const baseName = sanitizeSdkToolName(definition.name);
    let sdkName = baseName;
    let index = 2;
    while (used.has(sdkName)) {
      sdkName = `${baseName}_${index}`;
      index += 1;
    }
    used.add(sdkName);
    prepared.push({
      originalName: definition.name,
      sdkName,
      definition,
      parameters: buildToolJsonSchema(definition)
    });
  }
  return prepared;
}
function summarizePreparedTools(tools) {
  return tools.map((tool) => ({
    sdkName: tool.sdkName,
    toolName: tool.originalName,
    namespace: tool.definition.namespace,
    group: tool.definition.group
  }));
}
function summarizeSdkMessages(messages) {
  return messages.slice(-MAX_TRACE_ARRAY_LENGTH).map((message) => ({
    type: typeof message.type === "string" ? message.type : "unknown",
    subtype: typeof message.subtype === "string" ? message.subtype : void 0,
    sessionId: typeof message.session_id === "string" ? redactTraceText(message.session_id) : void 0,
    resultLength: typeof message.result === "string" ? message.result.length : void 0,
    isError: typeof message.is_error === "boolean" ? message.is_error : void 0,
    hasMessage: Boolean(message.message)
  }));
}
function summarizeToolResult(result) {
  return {
    ok: result.ok,
    error: result.error ? {
      code: result.error.code,
      category: result.error.category,
      message: redactTraceText(result.error.message)
    } : void 0,
    dataKeys: result.data ? Object.keys(result.data).slice(0, MAX_TRACE_ARRAY_LENGTH) : [],
    artifactCount: result.artifacts?.length ?? 0,
    duration_ms: result.duration_ms,
    trace_id: result.trace_id
  };
}
function createToolPolicyDeniedResult(toolName, reason) {
  return {
    ok: false,
    error: {
      code: "TOOL_DENIED_BY_RDC_POLICY",
      category: "policy",
      message: reason,
      details: {
        toolName
      }
    },
    artifacts: [],
    duration_ms: 0,
    trace_id: createLocalTraceId("agent-tool-denied")
  };
}
function buildAgentRunTrace(options) {
  const allowlist = options.request.toolAllowlist ?? [];
  return {
    adapter: options.adapter,
    providerId: options.request.providerId,
    providerKind: options.providerKind ?? null,
    modelId: options.request.modelId,
    agentId: options.request.agentId,
    stage: options.request.stage ?? null,
    runId: options.request.runId ?? null,
    sessionId: options.request.sessionId ?? null,
    turnId: options.request.turnId ?? null,
    tools: summarizePreparedTools(options.preparedTools),
    policy: sanitizeTraceValue({
      executionLayer: "ToolBridge",
      failClosed: true,
      allowlist,
      allowedToolCount: options.preparedTools.length,
      sandbox: {
        enabled: false,
        reason: "runtime_ownership_lease_not_configured"
      },
      ...options.policy
    }),
    guardrails: sanitizeTraceValue(options.guardrails ?? []),
    handoffs: sanitizeTraceValue(options.handoffs ?? []),
    sdkTrace: sanitizeTraceValue(options.sdkTrace ?? {})
  };
}
function formatToolResult(result) {
  const payload = sanitizeTraceValue({
    ok: result.ok,
    data: result.data,
    error: result.error,
    artifacts: result.artifacts,
    duration_ms: result.duration_ms,
    trace_id: result.trace_id
  });
  const formatted = JSON.stringify(payload);
  if (formatted.length <= MAX_TOOL_RESULT_LENGTH) {
    return formatted;
  }
  return JSON.stringify({
    ...summarizeToolResult(result),
    truncated: true
  });
}
const CLAUDE_DENIED_BUILTIN_TOOLS = ["Bash", "Edit", "Write", "Read", "WebSearch"];
const CLAUDE_PERMISSION_MODE = "dontAsk";
function zodParameter(parameter) {
  let schema;
  if (parameter.enum?.length) {
    schema = zod.z.enum(parameter.enum);
  } else if (parameter.type === "number") {
    schema = zod.z.number();
  } else if (parameter.type === "boolean") {
    schema = zod.z.boolean();
  } else if (parameter.type === "array") {
    schema = zod.z.array(zod.z.unknown());
  } else if (parameter.type === "object") {
    schema = zod.z.record(zod.z.string(), zod.z.unknown());
  } else {
    schema = zod.z.string();
  }
  if (parameter.description) {
    schema = schema.describe(parameter.description);
  }
  return parameter.required ? schema : schema.optional();
}
function zodRawShape(tool) {
  const shape = {};
  for (const parameter of tool.parameters ?? []) {
    shape[parameter.name] = zodParameter(parameter);
  }
  return shape;
}
class ClaudeAgentSdkAdapter {
  id = "claude-agent-sdk";
  canRun(request) {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    return provider?.authMode !== "account" && (provider?.id === "anthropic" || provider?.kind === "anthropic" || provider?.kind === "openrouter" || provider?.kind === "bedrock" || provider?.kind === "vertex");
  }
  async run(request, tools) {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    if (!provider) {
      throw new Error(`Claude provider not found: ${request.providerId}`);
    }
    const apiKey = provider.authMode === "api-key" ? settingsService.getProviderSecret(provider.id, settings.workspace.rootPath) : "";
    if (provider.authMode === "api-key" && !apiKey) {
      throw new Error(`Claude provider secret is missing: ${provider.id}`);
    }
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const abortController = new AbortController();
    request.signal?.addEventListener("abort", () => abortController.abort(), { once: true });
    const messages = [];
    const toolResults = [];
    let text = "";
    const env = {
      ...process.env,
      ...apiKey ? { ANTHROPIC_API_KEY: apiKey } : {},
      ...provider.baseUrl ? { ANTHROPIC_BASE_URL: provider.baseUrl } : {},
      ...provider.kind === "bedrock" ? {
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: process.env.AWS_REGION || "us-east-1"
      } : {},
      ...provider.kind === "vertex" ? {
        CLAUDE_CODE_USE_VERTEX: "1",
        CLOUD_ML_REGION: process.env.CLOUD_ML_REGION || "us-east5"
      } : {},
      CLAUDE_AGENT_SDK_CLIENT_APP: "rdc-agent/1.0.0"
    };
    const preparedTools = prepareAgentTools(await tools.listTools(request.agentId), request.toolAllowlist);
    const allowedMcpToolNames = /* @__PURE__ */ new Set();
    const sdkTools = preparedTools.map((tool) => {
      allowedMcpToolNames.add(`mcp__rdc__${tool.sdkName}`);
      return sdk.tool(
        tool.sdkName,
        `${tool.definition.description}

RDC tool: ${tool.originalName}`,
        zodRawShape(tool.definition),
        async (args) => {
          if (!toolMatchesPolicy(tool.originalName, request.toolAllowlist)) {
            const result2 = createToolPolicyDeniedResult(
              tool.originalName,
              `Tool ${tool.originalName} is not allowed by RDC DebuggerRuntime policy.`
            );
            toolResults.push({
              toolName: tool.originalName,
              result: result2
            });
            return {
              content: [{
                type: "text",
                text: formatToolResult(result2)
              }],
              is_error: true
            };
          }
          const result = await tools.execute({
            toolName: tool.originalName,
            args,
            runId: request.runId,
            turnId: request.turnId,
            contextId: request.sessionId,
            runtimeOwner: request.agentId,
            signal: request.signal
          });
          toolResults.push({
            toolName: tool.originalName,
            result
          });
          return {
            content: [{
              type: "text",
              text: formatToolResult(result)
            }],
            is_error: !result.ok
          };
        },
        {
          annotations: {
            readOnlyHint: true
          }
        }
      );
    });
    const rdcMcpServer = sdk.createSdkMcpServer({
      name: "rdc",
      version: "1.0.0",
      instructions: "RDC ToolBridge proxy. All tool calls are executed by the deterministic DebuggerRuntime tool layer.",
      tools: sdkTools,
      alwaysLoad: sdkTools.length > 0
    });
    for await (const message of sdk.query({
      prompt: request.prompt,
      abortController,
      options: {
        model: request.modelId,
        systemPrompt: request.systemPrompt,
        maxTurns: 4,
        tools: [],
        mcpServers: sdkTools.length > 0 ? { rdc: rdcMcpServer } : {},
        allowedTools: Array.from(allowedMcpToolNames),
        canUseTool: async (toolName, _input, options) => allowedMcpToolNames.has(toolName) ? { behavior: "allow", toolUseID: options.toolUseID } : {
          behavior: "deny",
          message: `Tool ${toolName} is not allowed by RDC DebuggerRuntime policy.`,
          toolUseID: options.toolUseID
        },
        disallowedTools: [...CLAUDE_DENIED_BUILTIN_TOOLS],
        permissionMode: CLAUDE_PERMISSION_MODE,
        env
      }
    })) {
      messages.push(message);
      if (message.type === "assistant" && message.message && typeof message.message === "object") {
        const content = message.message.content;
        if (Array.isArray(content)) {
          const chunk = content.map((entry) => entry && typeof entry === "object" && typeof entry.text === "string" ? entry.text : "").join("");
          if (chunk) {
            text += chunk;
            request.onChunk?.(chunk);
          }
        }
      }
      if (message.type === "result" && typeof message.result === "string") {
        text = message.result;
      }
    }
    return {
      agentId: request.agentId,
      providerId: request.providerId,
      modelId: request.modelId,
      text,
      toolResults,
      trace: buildAgentRunTrace({
        adapter: this.id,
        request,
        providerKind: provider.kind,
        preparedTools,
        policy: {
          permissionMode: CLAUDE_PERMISSION_MODE,
          allowedTools: Array.from(allowedMcpToolNames),
          disallowedTools: [...CLAUDE_DENIED_BUILTIN_TOOLS],
          builtInTools: "disabled",
          mcpServers: sdkTools.length > 0 ? ["rdc"] : []
        },
        guardrails: [
          {
            name: "claude-builtins-denied",
            scope: "sdk-tools",
            status: "enforced",
            deniedTools: [...CLAUDE_DENIED_BUILTIN_TOOLS]
          },
          {
            name: "claude-mcp-only",
            scope: "tool-surface",
            status: "enforced",
            allowedTools: Array.from(allowedMcpToolNames)
          },
          {
            name: "claude-permission-mode",
            scope: "permissions",
            status: "enforced",
            mode: CLAUDE_PERMISSION_MODE
          }
        ],
        sdkTrace: {
          messageSummary: summarizeSdkMessages(messages),
          messageCount: messages.length
        }
      })
    };
  }
}
class LlmAdapterAgentSdkAdapter {
  id = "rdc-llm-adapter";
  canRun(_request) {
    return true;
  }
  async run(request, _tools) {
    const messages = [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.prompt }
    ];
    let streamedContent = "";
    const response = await llmAdapter.streamChat(
      {
        messages,
        model: request.modelId,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        signal: request.signal
      },
      (event) => {
        request.onStreamEvent?.(event);
        if (event.type === "text-delta") {
          streamedContent += event.text;
          request.onChunk?.(event.text);
        }
      },
      request.providerId
    );
    const fallbackContent = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    return {
      agentId: request.agentId,
      providerId: request.providerId,
      modelId: request.modelId,
      text: streamedContent || fallbackContent,
      toolResults: [],
      usage: response.usage,
      trace: {
        adapter: this.id,
        responseId: response.id
      }
    };
  }
}
function readFinalOutput(result) {
  if (result && typeof result === "object") {
    const record = result;
    for (const key of ["finalOutput", "output", "text"]) {
      const value = record[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return typeof result === "string" ? result : JSON.stringify(result);
}
class OpenAiAgentSdkAdapter {
  id = "openai-agents-sdk";
  canRun(request) {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    return provider?.authMode !== "account" && (provider?.id === "openai" || provider?.kind === "openai-compatible");
  }
  async run(request, tools) {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    if (!provider) {
      throw new Error(`OpenAI provider not found: ${request.providerId}`);
    }
    const apiKey = settingsService.getProviderSecret(provider.id, settings.workspace.rootPath);
    if (!apiKey) {
      throw new Error(`OpenAI provider secret is missing: ${provider.id}`);
    }
    const sdk = await import("@openai/agents");
    sdk.setDefaultOpenAIKey?.(apiKey);
    const tracingDisabled = provider.id !== "openai";
    const traceId = `rdc-agent-${request.runId || request.turnId || Date.now().toString(36)}`;
    const workflowName = "RDC Agent SDK Runner";
    if (provider.baseUrl || provider.id !== "openai") {
      const { default: OpenAI } = await import("openai");
      sdk.setDefaultOpenAIClient?.(new OpenAI({
        apiKey,
        baseURL: provider.baseUrl
      }));
      sdk.setOpenAIAPI?.(provider.id === "openai" ? "responses" : "chat_completions");
    }
    const toolResults = [];
    const preparedTools = prepareAgentTools(await tools.listTools(request.agentId), request.toolAllowlist);
    const openAiTools = preparedTools.map((tool) => sdk.tool({
      name: tool.sdkName,
      description: `${tool.definition.description}

RDC tool: ${tool.originalName}`,
      parameters: tool.parameters,
      strict: false,
      needsApproval: false,
      execute: async (input) => {
        const args = input && typeof input === "object" ? input : {};
        if (!toolMatchesPolicy(tool.originalName, request.toolAllowlist)) {
          const result3 = createToolPolicyDeniedResult(
            tool.originalName,
            `Tool ${tool.originalName} is not allowed by RDC DebuggerRuntime policy.`
          );
          toolResults.push({
            toolName: tool.originalName,
            result: result3
          });
          return formatToolResult(result3);
        }
        const result2 = await tools.execute({
          toolName: tool.originalName,
          args,
          runId: request.runId,
          turnId: request.turnId,
          contextId: request.sessionId,
          runtimeOwner: request.agentId,
          signal: request.signal
        });
        toolResults.push({
          toolName: tool.originalName,
          result: result2
        });
        return formatToolResult(result2);
      }
    }));
    const agent = new sdk.Agent({
      name: request.agentId,
      instructions: request.systemPrompt,
      model: request.modelId,
      modelSettings: {
        temperature: request.temperature,
        maxTokens: request.maxTokens
      },
      tools: openAiTools
    });
    const runner = new sdk.Runner({
      tracingDisabled,
      traceIncludeSensitiveData: false,
      workflowName,
      traceId,
      groupId: request.sessionId || request.runId || void 0,
      traceMetadata: {
        adapter: this.id,
        agentId: request.agentId,
        providerId: request.providerId,
        modelId: request.modelId,
        stage: request.stage || "stage"
      }
    });
    const result = await runner.run(agent, request.prompt, {
      signal: request.signal
    });
    const text = readFinalOutput(result);
    request.onChunk?.(text);
    return {
      agentId: request.agentId,
      providerId: request.providerId,
      modelId: request.modelId,
      text,
      toolResults,
      trace: buildAgentRunTrace({
        adapter: this.id,
        request,
        providerKind: provider.kind,
        preparedTools,
        policy: {
          tracingDisabled,
          traceIncludeSensitiveData: false
        },
        guardrails: [
          {
            name: "rdc-tool-allowlist",
            scope: "tool-input",
            status: "enforced"
          },
          {
            name: "rdc-tool-result-summary",
            scope: "tool-output",
            status: "enforced"
          },
          {
            name: "external-openai-tracing",
            scope: "sdk-tracing",
            status: tracingDisabled ? "disabled" : "available",
            reason: tracingDisabled ? "non_openai_provider" : "official_openai_provider"
          }
        ],
        sdkTrace: {
          workflowName,
          traceId,
          externalExport: !tracingDisabled,
          resultKeys: result && typeof result === "object" ? Object.keys(result) : []
        }
      })
    };
  }
}
class AgentRunnerRegistry {
  adapters = [
    new LlmAdapterAgentSdkAdapter(),
    new OpenAiAgentSdkAdapter(),
    new ClaudeAgentSdkAdapter()
  ];
  async run(request) {
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === request.providerId);
    if (!provider || !provider.enabled || !provider.isConfigured) {
      throw new Error(`Agent provider is not configured: ${request.providerId}`);
    }
    const adapter = this.adapters.find((entry) => entry.canRun(request));
    if (!adapter) {
      throw new Error(`No AgentRunner adapter for provider: ${request.providerId}`);
    }
    runtimeLogService.log({
      scope: request.sessionId ? "session" : "app",
      namespace: "agent",
      severity: "info",
      title: "Agent runner selected",
      summary: `${request.agentId} 使用 ${adapter.id} 执行 ${request.stage || "stage"}。`,
      sessionId: request.sessionId,
      runId: request.runId,
      raw: {
        agentId: request.agentId,
        providerId: request.providerId,
        modelId: request.modelId,
        adapter: adapter.id
      }
    });
    return adapter.run(request, toolBridgeAgentToolPort);
  }
}
const agentRunnerRegistry = new AgentRunnerRegistry();
class WorkflowProjectionPublisher {
  publish(channel, ...args) {
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, ...args);
      }
    }
  }
  publishWorkflowState(state2) {
    this.publish("workflow:stateChanged", state2);
    this.publish("workflow:stageChanged", {
      stage: state2.currentStage,
      blockers: state2.blockers
    });
  }
  publishRunStatus(payload) {
    this.publish("workflow:runStatusChanged", payload);
  }
  publishRunUsage(usage) {
    this.publish("workflow:runUsageChanged", usage);
  }
  publishWorkstreamChanged(sessionId, presentation) {
    this.publish("workflow:workstreamChanged", {
      sessionId,
      presentation
    });
  }
  publishEvidenceEvent(event) {
    this.publish("evidence:eventAdded", event);
  }
  publishConversationEvent(event) {
    this.publish("conversation:event", event);
  }
  publishAgentStatus(state2) {
    this.publish("agent:statusChanged", state2);
  }
  publishAgentMessage(message) {
    this.publish("agent:message", message);
  }
}
const workflowProjectionPublisher = new WorkflowProjectionPublisher();
const SPECIALIST_TOOL_BINDINGS = {
  ask_agent: [],
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
  skeptic_agent: [],
  curator_agent: [],
  "rdc-debugger": []
};
const SHADER_EDIT_TOOLS = ["rd.shader.edit_and_replace", "rd.macro.shader_hotfix_validate"];
function resolveAgentToolAllowlist(agentId, stage) {
  const settings = settingsService.getAll();
  const runtimeProfile = executionProfileService.resolveAgentRuntimeProfile(settings, stage || "investigate", agentId);
  if (runtimeProfile.toolAllowlist?.length) {
    return runtimeProfile.toolAllowlist;
  }
  return SPECIALIST_TOOL_BINDINGS[agentId] ?? [];
}
function isToolAllowedForAgent(toolName, agentId, stage) {
  if (SHADER_EDIT_TOOLS.includes(toolName)) {
    return false;
  }
  const allowlist = resolveAgentToolAllowlist(agentId, stage);
  for (const pattern of allowlist) {
    if (pattern === "*" || pattern === toolName) {
      return true;
    }
    if (pattern.endsWith(".*") && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}
class AgentOrchestrator {
  agentStates = /* @__PURE__ */ new Map();
  agentConfigs = /* @__PURE__ */ new Map();
  constructor() {
    this.initializeAgents();
  }
  /**
   * 设置主窗口引用
   */
  setMainWindow(_window) {
  }
  /**
   * 初始化所有Agent
   */
  initializeAgents() {
    for (const role of AGENT_ROLES) {
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
    if (role === "ask_agent" || role === "rdc-debugger") return "orchestrator";
    if (INVESTIGATOR_AGENTS.includes(role)) return "investigator";
    if (VERIFIER_AGENTS.includes(role)) return "verifier";
    if (REPORTER_AGENTS.includes(role)) return "reporter";
    return "investigator";
  }
  /**
   * 获取Agent写入范围
   */
  getAgentWriteScopes(role) {
    if (role === "ask_agent") return [];
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
  async refreshAccountRuntimeCredentials(providerId) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (provider?.authMode !== "account") {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(providerId);
    const llmConfig = settingsService.getLlmConfig();
    llmAdapter.configure(llmConfig);
    this.applyLlmConfig(llmConfig);
  }
  async finalizeRecordedAssistantMessage(agentId, streamedContent, fallbackContent, context2) {
    const finalContent = streamedContent || fallbackContent;
    await this.recordMessage(agentId, "assistant", finalContent, context2);
    return finalContent;
  }
  /**
   * 发送消息给Agent
   */
  async sendMessage(agentId, content, context2, options) {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    this.updateAgentStatus(agentId, "thinking");
    try {
      let runtimeProfile = this.resolveRuntimeProfile(agentId, context2?.stageId);
      await this.refreshAccountRuntimeCredentials(runtimeProfile.providerId);
      runtimeProfile = this.resolveRuntimeProfile(agentId, context2?.stageId);
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
      await this.recordMessage(agentId, "user", content, context2);
      const response = await agentRunnerRegistry.run({
        agentId,
        prompt: content,
        systemPrompt: messages[0]?.content ?? "",
        modelId: config.modelName,
        providerId: config.modelProvider,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        toolAllowlist: resolveAgentToolAllowlist(agentId, context2?.stageId),
        stage: context2?.stageId,
        caseId: context2?.caseId,
        runId: context2?.runId,
        sessionId: context2?.sessionId,
        turnId: context2?.turnId,
        signal: options?.signal,
        onChunk: options?.onChunk,
        onStreamEvent: options?.onStreamEvent
      });
      const finalContent = await this.finalizeRecordedAssistantMessage(
        agentId,
        response.text,
        response.text,
        context2
      );
      this.updateAgentStatus(agentId, "complete");
      return finalContent;
    } catch (error) {
      this.updateAgentStatus(agentId, "error");
      throw error;
    }
  }
  async sendCoworkMessage(agentId, content, options) {
    const fallbackConfig = this.agentConfigs.get(agentId);
    if (!fallbackConfig) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    this.updateAgentStatus(agentId, "thinking");
    try {
      let settings = settingsService.getAll();
      let routeMap = new Map(settings.llm.agentRoutes.map((route2) => [route2.agentId, route2]));
      const routeAgentId = options?.routeAgentId ?? agentId;
      let route = routeMap.get(routeAgentId);
      if (route?.providerId) {
        await this.refreshAccountRuntimeCredentials(route.providerId);
        settings = settingsService.getAll();
        routeMap = new Map(settings.llm.agentRoutes.map((entry) => [entry.agentId, entry]));
        route = routeMap.get(routeAgentId);
      }
      const config = {
        ...fallbackConfig,
        modelProvider: route?.providerId || fallbackConfig.modelProvider,
        modelName: route?.modelId || fallbackConfig.modelName,
        systemPrompt: options?.systemPrompt || fallbackConfig.systemPrompt,
        temperature: options?.temperature ?? fallbackConfig.temperature,
        maxTokens: options?.maxTokens ?? fallbackConfig.maxTokens
      };
      if (process.env.RDC_AGENT_TEST_MODE === "1") {
        let userMessage = content;
        try {
          const parsed = JSON.parse(content);
          userMessage = parsed.effective_user_message || parsed.user_message || content;
        } catch {
          userMessage = content;
        }
        if (userMessage.includes("__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__")) {
          throw new Error("E2E forced cowork LLM request failure");
        }
        const lower = userMessage.toLowerCase();
        let stub = agentId === "ask_agent" ? "我在。你可以先描述问题、目标或需要打开的 .rdc capture；我会先帮你澄清，不会直接启动执行。" : "我在。你可以先告诉我你遇到了什么现象，或者直接说你希望我现在正式开始调试。";
        if (/ue4|unreal/i.test(userMessage)) {
          stub = "UE4 是 Unreal Engine 4。它是 Epic Games 的一代游戏引擎，常见于延迟渲染、材质系统、后处理链和 Shader 调试场景。";
        } else if (/你好|您好|hello|hi/i.test(userMessage)) {
          if (agentId === "ask_agent") {
            stub = "你好，我可以先帮你澄清问题、解释能力范围，或引导你在应用内 Open 一个 .rdc capture；不会直接启动 RenderDoc 执行。";
          } else {
            stub = "你好。当前是 Debugger 模式；如果你要开始正式调试，请描述目标、异常和关键事件，我会先生成执行前计划。";
          }
        } else if (/开始|启动|执行|正式分析|开始调试|debug|analy[sz]e|调试/.test(lower)) {
          stub = "收到，我会先帮你整理正式调试前的关键信息，然后在条件满足时进入严格执行流程。";
        }
        this.updateAgentStatus(agentId, "complete");
        const finalStub = `${stub}
<control>{"intent":"${/开始|启动|执行|正式分析|开始调试|debug|analy[sz]e|调试/.test(lower) ? "execute" : "talk"}","safe_to_start":${/开始|启动|执行|正式分析|开始调试|debug|analy[sz]e|调试/.test(lower) ? "true" : "false"}}</control>`;
        if (options?.onChunk) {
          const midpoint = Math.max(1, Math.ceil(finalStub.length / 2));
          options.onChunk(finalStub.slice(0, midpoint));
          await Promise.resolve();
          options.onChunk(finalStub.slice(midpoint));
        }
        return finalStub;
      }
      const response = await agentRunnerRegistry.run({
        agentId,
        prompt: content,
        systemPrompt: config.systemPrompt || `You are the ${AGENT_DISPLAY_NAMES[agentId]}. ${AGENT_DESCRIPTIONS[agentId]}`,
        modelId: config.modelName,
        providerId: config.modelProvider,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        toolAllowlist: [],
        stage: "cowork",
        sessionId: options?.sessionId,
        turnId: options?.turnId,
        signal: options?.signal,
        onChunk: options?.onChunk,
        onStreamEvent: options?.onStreamEvent
      });
      const finalContent = response.text;
      runtimeLogService.log({
        scope: options?.sessionId ? "session" : "app",
        namespace: "agent",
        severity: "info",
        title: `${AGENT_DISPLAY_NAMES[agentId] || agentId} cowork turn`,
        summary: finalContent.slice(0, 160) || "空消息",
        sessionId: options?.sessionId,
        raw: {
          agentId,
          providerId: response.providerId,
          modelId: response.modelId,
          adapter: response.trace?.adapter
        }
      });
      this.updateAgentStatus(agentId, "complete");
      return finalContent;
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
    return resolveAgentToolAllowlist(agentId);
  }
  /**
   * 检查工具是否允许被指定角色使用（Task 4b）
   * shader 编辑工具默认只读，不在任何 specialist 的工具清单中
   */
  isToolAllowedForRole(toolName, agentId) {
    return isToolAllowedForAgent(toolName, agentId);
  }
  /**
   * 更新Agent状态
   */
  updateAgentStatus(agentId, status) {
    const state2 = this.agentStates.get(agentId);
    if (state2) {
      state2.status = status;
      state2.lastActivity = nowIso$1();
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
      this.notifyAgentStateChanged(state2);
    }
  }
  /**
   * 记录消息
   */
  async recordMessage(agentId, role, content, context2) {
    if (!context2?.sessionId) return;
    const message = {
      id: generateEventId("msg"),
      agentId,
      role,
      content,
      timestamp: nowMs()
    };
    if (context2.runId) {
      await storageAdapter.appendActionEvent(context2.sessionId, storageAdapter.createActionEvent({
        runId: context2.runId,
        sessionId: context2.sessionId,
        agentId,
        eventType: role === "user" ? "user_message" : role === "assistant" ? "agent_summary" : "system",
        status: role === "system" ? "warning" : "ok",
        turnId: context2.turnId,
        payload: {
          role,
          content,
          message_id: message.id
        }
      }));
    }
    this.notifyMessage(message, context2?.sessionId);
  }
  /**
   * 通知Agent状态变化
   */
  notifyAgentStateChanged(state2) {
    workflowProjectionPublisher.publishAgentStatus(state2);
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
    workflowProjectionPublisher.publishAgentMessage(message);
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
  BLOCKED_LLM_ROUTE_MISSING: {
    code: "BLOCKED_LLM_ROUTE_MISSING",
    category: "gate",
    severity: "critical",
    description: "Agent route is missing a provider/model binding",
    resolution: "Bind the required agent to a provider/model in Settings -> Agent Routing"
  },
  BLOCKED_LLM_PROVIDER_MISSING: {
    code: "BLOCKED_LLM_PROVIDER_MISSING",
    category: "gate",
    severity: "critical",
    description: "Configured LLM provider cannot be resolved or is disabled",
    resolution: "Enable a valid provider for the bound agent route"
  },
  BLOCKED_LLM_SECRET_MISSING: {
    code: "BLOCKED_LLM_SECRET_MISSING",
    category: "gate",
    severity: "critical",
    description: "Configured LLM provider is missing a valid secret",
    resolution: "Save a valid provider secret in Settings -> Models"
  },
  BLOCKED_LLM_MODEL_MISSING: {
    code: "BLOCKED_LLM_MODEL_MISSING",
    category: "gate",
    severity: "critical",
    description: "Configured LLM model cannot be resolved for the provider route",
    resolution: "Enable the bound model for the provider in Settings -> Models"
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
  BLOCKED_LLM_PROVIDER_UNAVAILABLE: {
    code: "BLOCKED_LLM_PROVIDER_UNAVAILABLE",
    category: "runtime",
    severity: "critical",
    description: "Configured LLM provider is unavailable at runtime",
    resolution: "Check provider base URL, connectivity, and account availability"
  },
  BLOCKED_LLM_REQUEST_FAILED: {
    code: "BLOCKED_LLM_REQUEST_FAILED",
    category: "runtime",
    severity: "critical",
    description: "Runtime LLM request failed",
    resolution: "Inspect the recorded provider/model/request failure and fix the provider configuration before retrying"
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
const TASK_FILE_PATTERN$1 = /([A-Za-z]:[\\/][^\r\n"]+?\.txt)/g;
const CAPTURE_FILE_PATTERN = /([A-Za-z0-9_.-]+\.rdc)/gi;
const EVENT_ID_PATTERN = /event\s*id\s*(?:是|:)?\s*(\d+)/i;
function firstMatch(pattern, value) {
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match?.[1];
}
function parseTaskFilePath(goal) {
  const match = goal.match(TASK_FILE_PATTERN$1);
  return match?.[0] ? path.resolve(match[0]) : void 0;
}
function parseCaptureFileName(text) {
  const match = text.match(CAPTURE_FILE_PATTERN);
  return match?.[0];
}
function parseEventId(text) {
  const raw = firstMatch(EVENT_ID_PATTERN, text);
  if (!raw) {
    return void 0;
  }
  const eventId = Number(raw);
  return Number.isFinite(eventId) ? eventId : void 0;
}
function inferBackend(goal, requestMode) {
  if (requestMode !== "debugger") {
    return "local";
  }
  return /\bremote\b|远端|安卓|android/i.test(goal) ? "remote" : "local";
}
function createCaptureDescriptor(input, backend) {
  return {
    id: input.inputId,
    filePath: input.filePath,
    role: "primary",
    backendHint: backend,
    status: "pending"
  };
}
function chooseFallbackReplayDevice(preferred) {
  if (preferred) {
    return preferred;
  }
  const devices = replayDeviceService.listDevices();
  const local = devices.find((device) => device.type === "local");
  return local || {
    id: "local",
    label: "Local",
    type: "local",
    status: "online",
    transport: "local",
    detailText: "Local replay ready"
  };
}
class IntakeContextResolver {
  resolve(request) {
    const project = storageAdapter.getProjectById(request.projectId);
    if (!project) {
      throw new Error(`Project not found: ${request.projectId}`);
    }
    const session = request.sessionId ? storageAdapter.readSession(request.sessionId) : null;
    const taskFilePath = parseTaskFilePath(request.goal);
    const taskFileContent = taskFilePath && fs.existsSync(taskFilePath) ? fs.readFileSync(taskFilePath, "utf-8") : void 0;
    const goalText = [request.goal, taskFileContent].filter(Boolean).join("\n\n").trim();
    const explicitCaptureFileName = parseCaptureFileName(goalText);
    const explicitEventId = parseEventId(goalText);
    const backend = inferBackend(goalText, request.mode);
    const projectInputs = storageAdapter.listProjectInputs(project.projectId);
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const currentSettings = settingsService.getAll();
    const debuggerRoute = currentSettings.llm.agentRoutes.find((route) => route.agentId === "rdc-debugger");
    const requestCaptures = request.captures ?? [];
    let captures = requestCaptures.length > 0 ? requestCaptures.map((capture) => ({ ...capture })) : projectInputs.map((input) => createCaptureDescriptor(input, backend));
    if (explicitCaptureFileName) {
      const exactFromRequest = captures.find((capture) => path.basename(capture.filePath) === explicitCaptureFileName);
      if (!exactFromRequest) {
        const matchedInput = projectInputs.find((input) => input.fileName === explicitCaptureFileName);
        if (matchedInput) {
          captures = [createCaptureDescriptor(matchedInput, backend)];
        }
      } else {
        captures = captures.map((capture) => ({
          ...capture,
          role: path.basename(capture.filePath) === explicitCaptureFileName ? "primary" : capture.role,
          backendHint: backend
        }));
      }
    }
    const primaryCapture = captures.find((capture) => {
      if (request.primaryCaptureId) {
        return capture.id === request.primaryCaptureId;
      }
      if (explicitCaptureFileName) {
        return path.basename(capture.filePath) === explicitCaptureFileName;
      }
      if (openedCapture) {
        return capture.filePath === openedCapture.filePath;
      }
      return captures.length === 1;
    }) || null;
    const replayDevice = chooseFallbackReplayDevice(request.replayDevice);
    const taskSources = taskFilePath ? [taskFilePath] : [];
    return {
      intakeContext: {
        taskFilePath,
        taskFileContent,
        effectiveGoal: goalText || request.goal,
        discoveredProjectRoot: project.rootPath,
        openedCaptureId: openedCapture?.captureId ?? null,
        openedCapturePath: openedCapture?.filePath ?? null,
        availableCaptureIds: captures.map((capture) => capture.id),
        providerId: debuggerRoute?.providerId || void 0,
        modelId: debuggerRoute?.modelId,
        replayDeviceId: replayDevice.id,
        replayDeviceLabel: replayDevice.label
      },
      project,
      session,
      goalText: goalText || request.goal,
      taskFilePath,
      taskFileContent,
      explicitCaptureFileName,
      explicitEventId,
      captures: captures.map((capture) => ({
        ...capture,
        backendHint: capture.backendHint || backend
      })),
      primaryCaptureId: primaryCapture?.id,
      replayDevice,
      backend,
      taskSources,
      projectInputs
    };
  }
}
const intakeContextResolver = new IntakeContextResolver();
function makeBlocker$1(code, reason, refs = []) {
  return {
    code,
    reason,
    refs,
    detectedAt: nowIso$1()
  };
}
function makeCaptureQuestion(captures) {
  const options = captures.slice(0, 4).map((capture) => ({
    id: capture.id,
    label: path.basename(capture.filePath),
    description: capture.filePath
  }));
  while (options.length < 4) {
    options.push({
      id: `option-${options.length + 1}`,
      label: `选项 ${options.length + 1}`,
      description: "使用自由输入指定更准确的 capture。"
    });
  }
  return {
    id: "target_capture",
    prompt: "当前有多个可用 capture，选择本次 Debugger 主链要分析的目标。",
    recommendedOptionId: options[0]?.id,
    options: [
      options[0],
      options[1],
      options[2],
      options[3]
    ],
    freeformPlaceholder: "输入更准确的 .rdc 文件名"
  };
}
function buildVerificationContract(goalText, eventId) {
  const lower = goalText.toLowerCase();
  return {
    requiresFixValidation: /验证|verify|fix/.test(goalText),
    requiresScreenshotEvidence: /framebuffer|screenshot|截图|多模态/.test(lower + goalText),
    requiresShaderInspection: /shader|ibl|漏光|light|亮点/.test(lower + goalText),
    requiresPixelEvidence: /pixel|像素|亮点|白点/.test(lower + goalText),
    requiresBaselineComparison: /baseline|compare|对比|比较/.test(lower + goalText),
    targetEventIds: eventId ? [eventId] : [],
    successCriteria: [
      "结论必须有真实 rd.* 工具证据支撑。",
      "必须给出 verification 结果，并说明 fix 是否成立。",
      "最终发布 report.md、report.json 和 visual_report.html。"
    ]
  };
}
function recommendSpecialists(goalText, captures, backend) {
  const specialists = ["triage_agent", "pass_graph_pipeline_agent", "pixel_forensics_agent", "shader_ir_agent"];
  if (captures.length > 1 || /baseline|compare|对比|比较/.test(goalText)) {
    specialists.splice(1, 0, "capture_repro_agent");
  }
  if (backend === "remote") {
    specialists.push("driver_device_agent");
  }
  return Array.from(new Set(specialists));
}
function buildDebugPlanPresentation(debugPlan) {
  const sections = [
    {
      id: "goal",
      title: "目标",
      body: [debugPlan.userGoal]
    },
    {
      id: "scope",
      title: "范围",
      body: [
        debugPlan.targetCapture ? `Capture: ${debugPlan.targetCapture.fileName}` : "Capture: 等待确认",
        debugPlan.targetFrameOrEvent?.eventLabel ? `入口: ${debugPlan.targetFrameOrEvent.eventLabel}` : debugPlan.scope,
        debugPlan.scope
      ].filter(Boolean)
    },
    {
      id: "deliverables",
      title: "交付物",
      body: debugPlan.expectedDeliverables
    },
    {
      id: "test-plan",
      title: "Test Plan",
      body: debugPlan.verificationContract.successCriteria
    },
    {
      id: "assumptions",
      title: "Assumptions",
      body: [
        ...debugPlan.referenceContract.acceptanceNotes,
        ...debugPlan.notes
      ]
    }
  ];
  if (debugPlan.missingInfo.length > 0) {
    sections.push({
      id: "missing-info",
      title: "Missing Info",
      body: debugPlan.missingInfo
    });
  }
  if (debugPlan.blockers.length > 0) {
    sections.push({
      id: "blockers",
      title: "Blockers",
      body: debugPlan.blockers.map((blocker) => blocker.reason)
    });
  }
  return {
    title: "执行前调试计划",
    sections: sections.filter((section) => section.body.length > 0)
  };
}
class PlanBuilder {
  build(resolved) {
    const blockers = [];
    const questions = [];
    const targetCapture = resolved.primaryCaptureId ? resolved.captures.find((capture) => capture.id === resolved.primaryCaptureId) ?? null : resolved.captures.length === 1 ? resolved.captures[0] : null;
    const explicitEventId = resolved.explicitEventId;
    if (resolved.captures.length === 0) {
      blockers.push(makeBlocker$1(
        BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code,
        "当前 project 中没有可用于 Debugger 的 capture。"
      ));
    }
    if (!targetCapture && resolved.captures.length > 1) {
      questions.push(makeCaptureQuestion(resolved.captures));
    }
    const verificationContract = buildVerificationContract(resolved.goalText, explicitEventId);
    const missingInfo = [];
    if (!targetCapture) {
      missingInfo.push("target_capture");
    }
    const targetFrameOrEvent = explicitEventId ? {
      scope: "event",
      eventId: explicitEventId,
      eventLabel: `Event ${explicitEventId}`
    } : {
      scope: "frame",
      frameIndex: 0,
      eventLabel: "Frame 0 default scope"
    };
    let planReadiness = "discovering";
    if (blockers.length > 0) {
      planReadiness = "blocked";
    } else if (questions.length > 0) {
      planReadiness = "needs_user_input";
    } else {
      planReadiness = "strict_ready";
    }
    const debugPlanBase = {
      planId: `plan-${Date.now()}`,
      planReadiness,
      strictReady: planReadiness === "strict_ready",
      userGoal: resolved.goalText,
      targetCapture: targetCapture ? {
        captureId: targetCapture.id,
        fileName: path.basename(targetCapture.filePath),
        filePath: targetCapture.filePath
      } : null,
      targetFrameOrEvent,
      scope: explicitEventId ? "Anchor on the explicit event first, then expand to nearby pipeline and framebuffer evidence." : "Start from the frame and narrow down to the first bad event.",
      referenceContract: {
        taskSources: resolved.taskSources,
        referenceCaptures: resolved.captures.slice(1).map((capture) => capture.filePath),
        acceptanceNotes: [
          "只在 debug_plan.strict_ready 且用户批准后进入执行。",
          "报告需要覆盖 root cause、verification 和 deliverables。"
        ]
      },
      verificationContract,
      expectedDeliverables: [
        "report.md",
        "report.json",
        "visual_report.html"
      ],
      blockers,
      missingInfo,
      recommendedSpecialists: recommendSpecialists(resolved.goalText, resolved.captures, resolved.backend),
      notes: [
        resolved.taskFilePath ? `Task source: ${resolved.taskFilePath}` : "Task source: inline prompt",
        resolved.intakeContext.openedCapturePath ? `Opened capture: ${resolved.intakeContext.openedCapturePath}` : "No opened capture reused",
        resolved.intakeContext.providerId && resolved.intakeContext.modelId ? `LLM route: ${resolved.intakeContext.providerId}/${resolved.intakeContext.modelId}` : "LLM route missing; execution must stay blocked until an explicit provider/model route is configured."
      ],
      createdAt: nowIso$1(),
      updatedAt: nowIso$1()
    };
    const debugPlan = {
      ...debugPlanBase,
      presentation: buildDebugPlanPresentation(debugPlanBase)
    };
    const pendingQuestions = questions.length > 0 ? {
      promptId: `ask-${Date.now()}`,
      title: "补齐执行关键缺口",
      summary: "以下信息会直接影响执行路径，请先确认。",
      questions,
      createdAt: nowIso$1()
    } : null;
    return {
      debugPlan,
      pendingQuestions,
      blockers
    };
  }
}
const planBuilder = new PlanBuilder();
class RunExecutionService {
  activeRuns = /* @__PURE__ */ new Map();
  startRun(context2, executor) {
    const existing = this.activeRuns.get(context2.runId);
    if (existing) {
      return existing;
    }
    const abortController = new AbortController();
    const controller = {
      ...context2,
      startedAt: Date.now(),
      abortController
    };
    controller.promise = executor(abortController.signal).finally(() => {
      const active = this.activeRuns.get(context2.runId);
      if (active?.abortController === abortController) {
        this.activeRuns.delete(context2.runId);
      }
    });
    this.activeRuns.set(context2.runId, controller);
    return controller;
  }
  listActiveRuns() {
    return Array.from(this.activeRuns.values()).map((run) => ({
      runId: run.runId,
      sessionId: run.sessionId,
      projectId: run.projectId,
      startedAt: run.startedAt,
      stage: run.stage
    }));
  }
  getAbortSignal(runId) {
    return this.activeRuns.get(runId)?.abortController.signal ?? null;
  }
  updateStage(runId, stage) {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return;
    }
    active.stage = stage;
  }
  isAbortRequested(runId) {
    return this.activeRuns.get(runId)?.abortController.signal.aborted ?? false;
  }
  stopRun(runId) {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return false;
    }
    active.abortController.abort();
    return true;
  }
  async stopAll() {
    const runIds = Array.from(this.activeRuns.keys());
    runIds.forEach((runId) => this.stopRun(runId));
    await Promise.allSettled(
      runIds.map((runId) => this.activeRuns.get(runId)?.promise)
    );
  }
}
const runExecutionService = new RunExecutionService();
class DebuggerLlmBlockerError extends Error {
  blocker;
  constructor(blocker) {
    super(blocker.reason);
    this.name = "DebuggerLlmBlockerError";
    this.blocker = blocker;
  }
}
function makeBlocker(code, reason, refs = []) {
  return {
    code,
    reason,
    refs,
    detectedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function extractTextContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  return content.map((block) => {
    if (block.type === "text") {
      return block.text || "";
    }
    if (block.type === "tool_result") {
      return block.content || "";
    }
    return "";
  }).join("\n").trim();
}
function extractBalancedJsonFragment(text, opening) {
  const start = text.indexOf(opening);
  if (start < 0) {
    return null;
  }
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) {
      depth += 1;
      continue;
    }
    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}
function extractJsonCandidate(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("LLM response was empty");
  }
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
  }
  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const candidate = fencedMatch[1].trim();
    JSON.parse(candidate);
    return candidate;
  }
  const balancedObject = extractBalancedJsonFragment(trimmed, "{");
  if (balancedObject) {
    JSON.parse(balancedObject);
    return balancedObject;
  }
  const balancedArray = extractBalancedJsonFragment(trimmed, "[");
  if (balancedArray) {
    JSON.parse(balancedArray);
    return balancedArray;
  }
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    const candidate = trimmed.slice(objectStart, objectEnd + 1);
    JSON.parse(candidate);
    return candidate;
  }
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const candidate = trimmed.slice(arrayStart, arrayEnd + 1);
    JSON.parse(candidate);
    return candidate;
  }
  throw new Error("LLM response did not contain valid JSON");
}
function shouldRetryStructuredLlmError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /LLM response was empty|did not contain valid JSON|Unexpected non-whitespace character after JSON|OpenRouter API error: 5\d\d|timed out|timeout/i.test(message);
}
function shouldUseNativeJsonObject(route) {
  const providerKind = route.provider.kind;
  const modelId = route.modelId.toLowerCase();
  if (providerKind === "anthropic") {
    return false;
  }
  if (/moonshot|kimi/.test(modelId)) {
    return false;
  }
  return true;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
class DebuggerLlmService {
  runSummaries = /* @__PURE__ */ new Map();
  resetRunSummary(runId) {
    this.runSummaries.delete(runId);
    this.broadcastRunUsage(runId);
  }
  getRunSummary(runId) {
    const summary = this.runSummaries.get(runId);
    if (!summary) {
      return null;
    }
    return {
      ...summary,
      routesUsed: summary.routesUsed.map((entry) => ({ ...entry }))
    };
  }
  getRunContextUsage(runId) {
    const summary = this.runSummaries.get(runId);
    if (!summary) {
      return null;
    }
    const settings = settingsService.getAll();
    const provider = settings.llm.providers.find((entry) => entry.id === summary.providerId);
    const model = provider?.models.find((entry) => entry.id === summary.modelId) ?? null;
    const contextWindowTokens = typeof model?.contextWindowTokens === "number" && model.contextWindowTokens > 0 ? model.contextWindowTokens : null;
    const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;
    return {
      runId,
      providerId: summary.providerId,
      modelId: summary.modelId,
      inputTokens: summary.totalInputTokens,
      outputTokens: summary.totalOutputTokens,
      totalTokens,
      contextWindowTokens,
      usagePercent: contextWindowTokens ? Math.min(100, Math.max(0, Math.round(totalTokens / contextWindowTokens * 100))) : 0,
      hasConfiguredContextWindow: Boolean(contextWindowTokens)
    };
  }
  async refreshAccountRuntimeCredentials(route) {
    if (route.provider.authMode !== "account") {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(route.providerId);
  }
  getRouteBlockers(agentIds, stage, settings = settingsService.getAll()) {
    const blockers = [];
    const seen = /* @__PURE__ */ new Set();
    for (const agentId of agentIds) {
      try {
        this.resolveRoute(agentId, stage, settings);
      } catch (error) {
        if (!(error instanceof DebuggerLlmBlockerError)) {
          throw error;
        }
        const key = `${error.blocker.code}:${agentId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        blockers.push(error.blocker);
      }
    }
    return blockers;
  }
  resolveRoute(agentId, stage, settings = settingsService.getAll()) {
    const requestedRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
    const resolution = resolveCompatibleAgentRoute(settings.llm.agentRoutes, settings.llm.providers, agentId);
    const route = resolution.route;
    if (!route?.providerId || !route.modelId) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_ROUTE_MISSING.code,
        `${agentId} is not bound to a provider/model route.`,
        [`agent:${agentId}`]
      ));
    }
    const provider = resolution.provider ?? settings.llm.providers.find((entry) => entry.id === route.providerId);
    if (!provider || !provider.enabled) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_PROVIDER_MISSING.code,
        `${agentId} route points to an unavailable provider: ${route.providerId}.`,
        [`agent:${agentId}`, `provider:${route.providerId}`]
      ));
    }
    const model = provider.models.find((entry) => entry.enabled && entry.id === route.modelId);
    if (!model) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_MODEL_MISSING.code,
        `${agentId} route points to a disabled or missing model: ${route.modelId}.`,
        [`agent:${agentId}`, `provider:${provider.id}`, `model:${route.modelId}`]
      ));
    }
    const secret = provider.authMode === "local" ? "local-provider" : provider.authMode === "environment" ? "environment-provider" : provider.authMode === "account" ? settingsService.getProviderOAuthSecret(provider.id, settings.workspace.rootPath) : settingsService.getProviderSecret(provider.id, settings.workspace.rootPath);
    if (!secret.trim()) {
      throw new DebuggerLlmBlockerError(makeBlocker(
        BLOCKER_CODES.BLOCKED_LLM_SECRET_MISSING.code,
        `${agentId} route provider is missing a usable secret: ${provider.id}.`,
        [`agent:${agentId}`, `provider:${provider.id}`]
      ));
    }
    return {
      agentId,
      stage,
      provider,
      providerId: provider.id,
      modelId: route.modelId,
      requestedModelId: resolution.requestedModelId ?? requestedRoute?.modelId,
      remapReason: resolution.remapReason
    };
  }
  async call(context2, request) {
    const settings = settingsService.getAll();
    const route = this.resolveRoute(context2.agentId, context2.stage, settings);
    if (process.env.RDC_AGENT_TEST_MODE === "1") {
      const response = {
        id: `test-llm-${Date.now()}`,
        model: route.modelId,
        content: "",
        usage: {
          inputTokens: 0,
          outputTokens: 0
        },
        stopReason: "end_turn"
      };
      const text = "";
      await this.recordCall(context2, route, response, "ok", "test-mode llm stub");
      return {
        route,
        response,
        text
      };
    }
    await this.refreshAccountRuntimeCredentials(route);
    llmAdapter.configure(settingsService.getLlmConfig());
    try {
      const response = await llmAdapter.chat({
        ...request,
        model: route.modelId
      }, route.providerId);
      const text = extractTextContent(response.content);
      await this.recordCall(context2, route, response, "ok", text || `${route.providerId}/${route.modelId}`);
      return {
        route,
        response,
        text
      };
    } catch (error) {
      await this.recordFailure(context2, route, error instanceof Error ? error.message : String(error));
      throw this.toRuntimeError(route, error);
    }
  }
  async callStructured(input) {
    if (process.env.RDC_AGENT_TEST_MODE === "1" && input.testValue !== void 0) {
      const settings2 = settingsService.getAll();
      const route2 = this.resolveRoute(input.agentId, input.stage, settings2);
      const response = {
        id: `test-llm-${Date.now()}`,
        model: route2.modelId,
        content: JSON.stringify(input.testValue),
        usage: {
          inputTokens: 0,
          outputTokens: 0
        },
        stopReason: "end_turn"
      };
      const text = JSON.stringify(input.testValue);
      const summary = input.auditSummary ? input.auditSummary(input.testValue, text) : text;
      await this.recordCall(input, route2, response, "ok", summary);
      return {
        data: input.testValue,
        call: {
          route: route2,
          response,
          text
        }
      };
    }
    const settings = settingsService.getAll();
    const route = this.resolveRoute(input.agentId, input.stage, settings);
    await this.refreshAccountRuntimeCredentials(route);
    llmAdapter.configure(settingsService.getLlmConfig());
    const useNativeJsonObject = shouldUseNativeJsonObject(route);
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await llmAdapter.chat({
          messages: input.messages,
          model: route.modelId,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          responseFormat: useNativeJsonObject ? "json_object" : void 0
        }, route.providerId);
        const text = extractTextContent(response.content);
        const data = input.parse(text);
        const summary = input.auditSummary ? input.auditSummary(data, text) : text || `${route.providerId}/${route.modelId}`;
        await this.recordCall(input, route, response, "ok", summary);
        return {
          data,
          call: {
            route,
            response,
            text
          }
        };
      } catch (error) {
        lastError = error;
        if (attempt < 3 && shouldRetryStructuredLlmError(error)) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        await this.recordFailure(
          input,
          route,
          error instanceof Error ? error.message : String(error)
        );
        throw this.toRuntimeError(route, error);
      }
    }
    await this.recordFailure(
      input,
      route,
      lastError instanceof Error ? lastError.message : String(lastError)
    );
    throw this.toRuntimeError(route, lastError);
  }
  parseJson(text) {
    return JSON.parse(extractJsonCandidate(text));
  }
  toRuntimeError(route, error) {
    const message = error instanceof Error ? error.message : String(error);
    const providerUnavailable = /provider not found|provider disabled|provider not configured|no llm provider configured/i.test(message);
    const code = providerUnavailable ? BLOCKER_CODES.BLOCKED_LLM_PROVIDER_UNAVAILABLE.code : BLOCKER_CODES.BLOCKED_LLM_REQUEST_FAILED.code;
    return new DebuggerLlmBlockerError(makeBlocker(
      code,
      `${route.agentId} failed to call ${route.providerId}/${route.modelId}: ${message}`,
      [`agent:${route.agentId}`, `provider:${route.providerId}`, `model:${route.modelId}`]
    ));
  }
  async recordCall(context2, route, response, status, summary) {
    this.updateRunSummary(context2, route, response, status);
    runtimeLogService.log({
      scope: context2.sessionId ? "session" : "app",
      namespace: "llm",
      severity: status === "ok" ? "success" : "error",
      title: `${route.agentId} -> ${route.providerId}/${route.modelId}`,
      summary,
      detail: response.id ? `request=${response.id}` : void 0,
      sessionId: context2.sessionId ?? null,
      runId: context2.runId ?? null,
      raw: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        requestId: response.id,
        usage: response.usage
      }
    });
    if (!context2.sessionId || !context2.runId) {
      return;
    }
    const event = storageAdapter.createActionEvent({
      runId: context2.runId,
      sessionId: context2.sessionId,
      agentId: route.agentId,
      eventType: "llm_call",
      status,
      payload: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        requestId: response.id,
        usage: response.usage,
        summary
      }
    });
    await this.appendBroadcastEvent(context2.sessionId, event);
  }
  async recordFailure(context2, route, errorMessage) {
    this.updateRunSummary(context2, route, null, "error");
    runtimeLogService.log({
      scope: context2.sessionId ? "session" : "app",
      namespace: "llm",
      severity: "error",
      title: `${route.agentId} -> ${route.providerId}/${route.modelId}`,
      summary: errorMessage,
      sessionId: context2.sessionId ?? null,
      runId: context2.runId ?? null,
      raw: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason
      }
    });
    if (!context2.sessionId || !context2.runId) {
      return;
    }
    const event = storageAdapter.createActionEvent({
      runId: context2.runId,
      sessionId: context2.sessionId,
      agentId: route.agentId,
      eventType: "llm_call",
      status: "error",
      payload: {
        agentId: route.agentId,
        stage: route.stage,
        providerId: route.providerId,
        modelId: route.modelId,
        requestedModelId: route.requestedModelId,
        remapReason: route.remapReason,
        summary: errorMessage
      }
    });
    await this.appendBroadcastEvent(context2.sessionId, event);
  }
  updateRunSummary(context2, route, response, status) {
    if (!context2.runId) {
      return;
    }
    const existing = this.runSummaries.get(context2.runId) ?? {
      providerId: route.providerId,
      modelId: route.modelId,
      successfulCallCount: 0,
      failedCallCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      firstRequestId: void 0,
      routesUsed: []
    };
    existing.providerId = existing.providerId || route.providerId;
    existing.modelId = existing.modelId || route.modelId;
    if (status === "ok") {
      existing.successfulCallCount += 1;
      if (!existing.firstRequestId && response?.id) {
        existing.firstRequestId = response.id;
      }
      existing.totalInputTokens += response?.usage.inputTokens ?? 0;
      existing.totalOutputTokens += response?.usage.outputTokens ?? 0;
    } else {
      existing.failedCallCount += 1;
    }
    existing.routesUsed.push({
      agentId: route.agentId,
      stage: route.stage,
      providerId: route.providerId,
      modelId: route.modelId,
      requestId: response?.id,
      status
    });
    this.runSummaries.set(context2.runId, existing);
    this.broadcastRunUsage(context2.runId);
  }
  broadcastRunUsage(runId) {
    const usage = this.getRunContextUsage(runId);
    if (!usage) {
      return;
    }
    workflowProjectionPublisher.publishRunUsage(usage);
  }
  async appendBroadcastEvent(sessionId, event) {
    await storageAdapter.appendActionEvent(sessionId, event);
    workflowProjectionPublisher.publishEvidenceEvent(event);
  }
}
const debuggerLlmService = new DebuggerLlmService();
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
      blockers.push(...debuggerLlmService.getRouteBlockers(["rdc-debugger"], "plan"));
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
        const events2 = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events2.filter((e) => e.event_type === "dispatch");
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
        const events2 = await storageAdapter.readActionChain(sessionId);
        const dispatchEvents = events2.filter((e) => e.event_type === "dispatch");
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
    const events2 = await storageAdapter.readActionChain(sessionId);
    const stageEvents = events2.filter((e) => e.event_type === "workflow_stage_transition");
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
      turn_id: input.turnId,
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
        data: result.ok ? result.data : void 0,
        artifacts: result.ok ? result.artifacts : void 0,
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
function toStringArray$1(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}
function toNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function summarizePayloadData(value) {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value;
  const summary = {};
  for (const [key, entry] of Object.entries(record).slice(0, 8)) {
    if (Array.isArray(entry)) {
      summary[key] = `array(${entry.length})`;
      continue;
    }
    if (entry && typeof entry === "object") {
      summary[key] = `object(${Object.keys(entry).length})`;
      continue;
    }
    summary[key] = entry;
  }
  return summary;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function formatPixel(value) {
  const pixel = asRecord(value);
  const x = pixel.x;
  const y = pixel.y;
  const rgba = [pixel.r, pixel.g, pixel.b, pixel.a].map((entry) => typeof entry === "number" ? entry : null);
  if (rgba.some((entry) => entry === null)) {
    return null;
  }
  return `Pixel(${x ?? "?"},${y ?? "?"}) RGBA=${rgba.join(",")}`;
}
function describePayloadEvidence(toolName, data) {
  const record = asRecord(data);
  if (toolName === "rd.export.screenshot") {
    const nameInfo = asRecord(record.name_info);
    return [
      `Screenshot ${record.width ?? "?"}x${record.height ?? "?"}`,
      `event=${record.resolved_event_id ?? record.requested_event_id ?? "?"}`,
      `target=${record.texture_id ?? nameInfo.resource_id ?? "unknown"}`,
      `format=${record.texture_format ?? "unknown"}`,
      record.fallback_reason ? `fallback=${record.fallback_reason}` : "",
      Array.isArray(record.summary_degraded_reasons) ? `degraded=${record.summary_degraded_reasons.join(",")}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.macro.explain_pixel") {
    const history = Array.isArray(record.history) ? record.history : [];
    return `${record.explanation ?? "Pixel explanation available"} History events=${history.map((entry) => asRecord(entry).event_id).filter(Boolean).join(",") || history.length}`;
  }
  if (toolName === "rd.texture.get_pixel_value") {
    const pixel = formatPixel(record.pixel);
    return [
      pixel ?? "Pixel value readback available",
      `texture=${record.texture_id ?? "unknown"}`,
      `event=${record.resolved_event_id ?? "?"}`,
      Array.isArray(record.summary_degraded_reasons) ? `degraded=${record.summary_degraded_reasons.join(",")}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.texture.get_pixel_history") {
    const history = Array.isArray(record.history) ? record.history : [];
    return `Pixel history on ${record.texture_id ?? "unknown"} has ${history.length} modifications: ${history.map((entry) => asRecord(entry).event_id).filter(Boolean).join(",") || "none"}.`;
  }
  if (toolName === "rd.pipeline.get_state_summary") {
    const summary = asRecord(record.summary);
    const shaders = Array.isArray(summary.shaders) ? summary.shaders.map((entry) => {
      const shader = asRecord(entry);
      return `${shader.stage}:${shader.resource_id}`;
    }).join(", ") : "";
    const target = asRecord(summary.selected_visual_target);
    return [
      `Pipeline api=${summary.api ?? "unknown"}`,
      shaders ? `shaders=${shaders}` : "",
      `bindings=${summary.binding_count ?? "?"}`,
      target.texture_id ? `visual_target=${target.texture_id}` : "",
      target.fallback_reason ? `fallback=${target.fallback_reason}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.pipeline.get_output_targets") {
    const framebuffer = asRecord(record.framebuffer);
    const target = asRecord(framebuffer.selected_visual_target);
    return [
      `Framebuffer render_targets=${Array.isArray(framebuffer.render_targets) ? framebuffer.render_targets.length : "?"}`,
      target.texture_id ? `visual_target=${target.texture_id}` : "",
      target.texture_format ? `format=${target.texture_format}` : "",
      target.fallback_reason ? `fallback=${target.fallback_reason}` : ""
    ].filter(Boolean).join("; ");
  }
  if (toolName === "rd.pipeline.get_resource_bindings") {
    const bindings = Array.isArray(record.bindings) ? record.bindings : [];
    const first = bindings.slice(0, 5).map((entry) => {
      const binding = asRecord(entry);
      return `${binding.type}@${binding.set_or_space}:${binding.binding}=${binding.resource_id}`;
    });
    return `Resource bindings ${bindings.length}: ${first.join(", ")}`;
  }
  if (toolName.startsWith("rd.pipeline.get_shader")) {
    const shader = asRecord(record.shader);
    return `Shader ${shader.stage ?? "unknown"} ${shader.shader_id ?? "unknown"} entry=${shader.entry ?? "unknown"}`;
  }
  return null;
}
function findStringFieldDeep(value, keys, seen = /* @__PURE__ */ new Set()) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findStringFieldDeep(item, keys, seen);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  const record = value;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) {
      return record[key];
    }
  }
  for (const nestedValue of Object.values(record)) {
    const nested = findStringFieldDeep(nestedValue, keys, seen);
    if (nested) {
      return nested;
    }
  }
  return null;
}
function getActiveEventId(debugPlan) {
  return debugPlan.targetFrameOrEvent?.eventId;
}
function getFrameIndex(debugPlan) {
  return debugPlan.targetFrameOrEvent?.frameIndex;
}
function pngDimensions(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}
async function fileToImageBlock(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = await fs.promises.readFile(filePath);
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: data.toString("base64")
    }
  };
}
class SpecialistRecipeRunner {
  async prepareSurface(context2) {
    const existingSnapshot = rdxSessionService.snapshotContext();
    const existingCapture = rdxSessionService.getCaptureDescriptors().find((capture) => capture.id === context2.debugPlan.targetCapture?.captureId || capture.filePath === context2.targetCapturePath);
    const existingReplaySessionId = existingCapture?.sessionId || existingCapture?.replaySessionId || existingSnapshot.sessionId || await this.resolveReplaySessionId(context2);
    if (existingReplaySessionId) {
      const frameIndex2 = getFrameIndex(context2.debugPlan);
      if (typeof frameIndex2 === "number") {
        await this.callTool(
          "rd.replay.set_frame",
          {
            session_id: existingReplaySessionId,
            frame_index: frameIndex2
          },
          "triage_agent",
          context2
        );
      }
      const eventId2 = getActiveEventId(context2.debugPlan);
      if (typeof eventId2 === "number") {
        await this.callTool(
          "rd.event.set_active",
          {
            session_id: existingReplaySessionId,
            event_id: eventId2
          },
          "triage_agent",
          context2
        );
      }
      await this.openHumanPreviewSafe(existingReplaySessionId);
      return {
        captureFileId: existingCapture?.captureFileId || existingCapture?.id || context2.debugPlan.targetCapture?.captureId || "target_capture",
        replaySessionId: existingReplaySessionId
      };
    }
    const openCapture = await this.callTool(
      "rd.capture.open_file",
      {
        file_path: context2.targetCapturePath
      },
      "triage_agent",
      context2
    );
    const captureFileId = typeof openCapture.data?.capture_file_id === "string" ? openCapture.data.capture_file_id : context2.debugPlan.targetCapture?.captureId;
    if (!openCapture.ok || !captureFileId) {
      throw new Error(openCapture.error?.message || `Failed to open target capture. capture_id=${String(captureFileId || "")} data_keys=${Object.keys(openCapture.data || {}).join(",") || "none"}`);
    }
    const openReplay = await this.callTool(
      "rd.capture.open_replay",
      {
        capture_file_id: captureFileId
      },
      "triage_agent",
      context2
    );
    const replaySessionId = typeof openReplay.data?.session_id === "string" ? openReplay.data.session_id : typeof openReplay.data?.replay_session_id === "string" ? openReplay.data.replay_session_id : await this.resolveReplaySessionId(context2);
    if (!openReplay.ok || !replaySessionId) {
      throw new Error(openReplay.error?.message || `Failed to open replay session. data_keys=${Object.keys(openReplay.data || {}).join(",") || "none"}`);
    }
    const frameIndex = getFrameIndex(context2.debugPlan);
    if (typeof frameIndex === "number") {
      await this.callTool(
        "rd.replay.set_frame",
        {
          session_id: replaySessionId,
          frame_index: frameIndex
        },
        "triage_agent",
        context2
      );
    }
    const eventId = getActiveEventId(context2.debugPlan);
    if (typeof eventId === "number") {
      await this.callTool(
        "rd.event.set_active",
        {
          session_id: replaySessionId,
          event_id: eventId
        },
        "triage_agent",
        context2
      );
    }
    await this.openHumanPreviewSafe(replaySessionId);
    return {
      captureFileId: String(captureFileId),
      replaySessionId: String(replaySessionId)
    };
  }
  async run(agentId, context2, surface) {
    if (agentId === "triage_agent") {
      return this.runTriage(context2, surface);
    }
    if (agentId === "capture_repro_agent") {
      return this.runCaptureRepro(context2, surface);
    }
    if (agentId === "pass_graph_pipeline_agent") {
      return this.runPassGraph(context2, surface);
    }
    if (agentId === "pixel_forensics_agent") {
      return this.runPixelForensics(context2, surface);
    }
    if (agentId === "shader_ir_agent") {
      return this.runShaderIr(context2, surface);
    }
    if (agentId === "driver_device_agent") {
      return this.runDriverDevice(context2);
    }
    throw new Error(`Unsupported specialist recipe: ${agentId}`);
  }
  async openHumanPreviewSafe(sessionId) {
    await rdxSessionService.openHumanPreviewWindow({ sessionId }).catch(() => void 0);
  }
  async runTriage(context2, surface) {
    const eventId = getActiveEventId(context2.debugPlan);
    const payloads = [];
    const info = await this.callTool("rd.capture.get_info", {
      capture_file_id: surface.captureFileId
    }, "triage_agent", context2);
    payloads.push(this.toPayload("rd.capture.get_info", info));
    const frame = await this.callTool("rd.replay.get_frame_info", {
      session_id: surface.replaySessionId
    }, "triage_agent", context2);
    payloads.push(this.toPayload("rd.replay.get_frame_info", frame));
    if (typeof eventId === "number") {
      const action = await this.callTool("rd.event.get_action_details", {
        session_id: surface.replaySessionId,
        event_id: eventId
      }, "triage_agent", context2);
      payloads.push(this.toPayload("rd.event.get_action_details", action));
      const parentChain = await this.callTool("rd.event.get_parent_chain", {
        session_id: surface.replaySessionId,
        event_id: eventId
      }, "triage_agent", context2);
      payloads.push(this.toPayload("rd.event.get_parent_chain", parentChain));
      const markerStack = await this.callTool("rd.event.get_marker_stack", {
        session_id: surface.replaySessionId,
        event_id: eventId
      }, "triage_agent", context2);
      payloads.push(this.toPayload("rd.event.get_marker_stack", markerStack));
    }
    const summary = await this.callTool("rd.macro.summarize_frame", {
      session_id: surface.replaySessionId
    }, "triage_agent", context2);
    payloads.push(this.toPayload("rd.macro.summarize_frame", summary));
    return this.finishRecipe("triage_agent", context2, payloads, [
      "Capture metadata",
      "Frame summary",
      eventId ? `Event ${eventId}` : "Frame-level scope"
    ]);
  }
  async runCaptureRepro(context2, surface) {
    const payloads = [];
    const listFrames = await this.callTool("rd.capture.list_frames", {
      capture_file_id: surface.captureFileId
    }, "capture_repro_agent", context2);
    payloads.push(this.toPayload("rd.capture.list_frames", listFrames));
    const screenshotPath = path.join(context2.outputRoot, "screenshots", "capture_repro.png");
    const screenshot = await this.callTool("rd.export.screenshot", {
      session_id: surface.replaySessionId,
      output_path: screenshotPath,
      file_format: "png",
      include_alpha: true
    }, "capture_repro_agent", context2);
    payloads.push(this.toPayload("rd.export.screenshot", screenshot));
    return this.finishRecipe("capture_repro_agent", context2, payloads, [
      "Frame list",
      "Reference screenshot"
    ]);
  }
  async runPassGraph(context2, surface) {
    const eventId = getActiveEventId(context2.debugPlan);
    const payloads = [];
    const stageState = await this.callTool("rd.pipeline.get_state_summary", {
      session_id: surface.replaySessionId,
      event_id: eventId,
      include_bindings: true,
      include_shaders: true
    }, "pass_graph_pipeline_agent", context2);
    payloads.push(this.toPayload("rd.pipeline.get_state_summary", stageState));
    const outputTargets = await this.callTool("rd.pipeline.get_output_targets", {
      session_id: surface.replaySessionId,
      event_id: eventId
    }, "pass_graph_pipeline_agent", context2);
    payloads.push(this.toPayload("rd.pipeline.get_output_targets", outputTargets));
    const bindings = await this.callTool("rd.pipeline.get_resource_bindings", {
      session_id: surface.replaySessionId,
      stage: "ps"
    }, "pass_graph_pipeline_agent", context2);
    payloads.push(this.toPayload("rd.pipeline.get_resource_bindings", bindings));
    if (typeof eventId === "number" && eventId > 1) {
      const diff = await this.callTool("rd.event.diff_pipeline_state", {
        session_id: surface.replaySessionId,
        event_a: Math.max(1, eventId - 1),
        event_b: eventId,
        scope: "full",
        include_unchanged: false
      }, "pass_graph_pipeline_agent", context2);
      payloads.push(this.toPayload("rd.event.diff_pipeline_state", diff));
    }
    return this.finishRecipe("pass_graph_pipeline_agent", context2, payloads, [
      "Pipeline summary",
      "Output targets",
      "Binding diff"
    ]);
  }
  async runPixelForensics(context2, surface) {
    const payloads = [];
    const screenshotPath = path.join(context2.outputRoot, "screenshots", "pixel_forensics.png");
    const screenshot = await this.callTool("rd.export.screenshot", {
      session_id: surface.replaySessionId,
      output_path: screenshotPath,
      file_format: "png",
      include_alpha: true
    }, "pixel_forensics_agent", context2);
    payloads.push(this.toPayload("rd.export.screenshot", screenshot));
    const point = await this.locatePixelFocus(screenshotPath, context2);
    const resolvedTextureId = typeof screenshot.data?.texture_id === "string" ? screenshot.data.texture_id : void 0;
    const explain = await this.callTool("rd.macro.explain_pixel", {
      session_id: surface.replaySessionId,
      x: point.x,
      y: point.y,
      target: resolvedTextureId ?? "auto",
      verbosity: "medium"
    }, "pixel_forensics_agent", context2);
    payloads.push(this.toPayload("rd.macro.explain_pixel", explain));
    if (resolvedTextureId) {
      const pixelValue = await this.callTool("rd.texture.get_pixel_value", {
        session_id: surface.replaySessionId,
        texture_id: resolvedTextureId,
        x: point.x,
        y: point.y,
        mip: 0,
        slice: 0,
        sample: 0,
        as_type: "float"
      }, "pixel_forensics_agent", context2);
      payloads.push(this.toPayload("rd.texture.get_pixel_value", pixelValue));
      const pixelHistory = await this.callTool("rd.texture.get_pixel_history", {
        session_id: surface.replaySessionId,
        texture_id: resolvedTextureId,
        x: point.x,
        y: point.y,
        mip: 0,
        slice: 0,
        sample: 0,
        include_shaders: true
      }, "pixel_forensics_agent", context2);
      payloads.push(this.toPayload("rd.texture.get_pixel_history", pixelHistory));
    }
    return this.finishRecipe("pixel_forensics_agent", context2, payloads, [
      `Pixel focus ${point.x},${point.y}`,
      "Framebuffer screenshot",
      "Pixel explanation"
    ], [screenshotPath]);
  }
  async runShaderIr(context2, surface) {
    const eventId = getActiveEventId(context2.debugPlan);
    const payloads = [];
    let shaderId;
    let shaderStage = "ps";
    for (const stage of ["ps", "cs", "vs"]) {
      const shader = await this.callTool("rd.pipeline.get_shader", {
        session_id: surface.replaySessionId,
        event_id: eventId,
        stage
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload(`rd.pipeline.get_shader:${stage}`, shader));
      const candidateShaderId = typeof shader.data?.shader_id === "string" ? shader.data.shader_id : typeof shader.data?.resource_id === "string" ? shader.data.resource_id : void 0;
      if (candidateShaderId) {
        shaderId = candidateShaderId;
        shaderStage = stage;
        break;
      }
    }
    if (shaderId) {
      const source = await this.callTool("rd.shader.get_source", {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        prefer_original: true
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload("rd.shader.get_source", source));
      const disassembly = await this.callTool("rd.shader.get_disassembly", {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        stage: shaderStage,
        event_id: eventId
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload("rd.shader.get_disassembly", disassembly));
      const reflection = await this.callTool("rd.shader.get_reflection", {
        session_id: surface.replaySessionId,
        shader_id: shaderId,
        stage: shaderStage,
        event_id: eventId,
        include_bindings: true,
        include_constant_blocks: true
      }, "shader_ir_agent", context2);
      payloads.push(this.toPayload("rd.shader.get_reflection", reflection));
    }
    return this.finishRecipe("shader_ir_agent", context2, payloads, [
      shaderId ? `Shader ${shaderId}` : "Shader lookup attempted",
      `Stage ${shaderStage}`
    ]);
  }
  async runDriverDevice(context2) {
    const payloads = [];
    const contextSnapshot = await this.callTool("rd.session.get_context", {
      context_id: context2.contextId
    }, "driver_device_agent", context2);
    payloads.push(this.toPayload("rd.session.get_context", contextSnapshot));
    const ping = await this.callTool("rd.remote.ping", {
      remote_id: "current"
    }, "driver_device_agent", context2);
    payloads.push(this.toPayload("rd.remote.ping", ping));
    return this.finishRecipe("driver_device_agent", context2, payloads, [
      "Runtime context",
      "Remote status probe"
    ]);
  }
  async callTool(toolName, args, agentId, context2) {
    const result = await harnessController.wrapToolExecution({
      toolName,
      args,
      agentId,
      sessionId: context2.sessionId,
      runId: context2.runId,
      turnId: context2.turnId,
      execute: () => toolBridge.call({
        toolName,
        args: {
          ...args,
          context_id: context2.contextId,
          runtime_owner: context2.runtimeOwner,
          owner_lease_id: context2.ownerLeaseId
        },
        contextId: context2.contextId,
        turnId: context2.turnId,
        runtimeOwner: context2.runtimeOwner,
        ownerLeaseId: context2.ownerLeaseId,
        runId: context2.runId,
        abortSignal: context2.signal
      })
    });
    return {
      ok: result.ok,
      data: result.data,
      error: result.error,
      artifacts: [],
      duration_ms: 0
    };
  }
  async resolveReplaySessionId(context2) {
    for (const toolName of ["rd.session.get_context", "rd.session.list_sessions", "rd.core.get_capabilities"]) {
      const result = await this.callTool(toolName, {}, "triage_agent", context2);
      if (!result.ok) {
        continue;
      }
      const replaySessionId = findStringFieldDeep(result.data, [
        "current_session_id",
        "selected_session_id",
        "session_id",
        "replay_session_id"
      ]);
      if (replaySessionId) {
        return replaySessionId;
      }
    }
    return null;
  }
  toPayload(toolName, result) {
    return {
      toolName,
      ok: result.ok,
      data: result.data,
      error: result.error?.message
    };
  }
  async locatePixelFocus(screenshotPath, context2) {
    const dims = pngDimensions(screenshotPath);
    if (!dims) {
      return { x: 0, y: 0 };
    }
    const fallbackPoint = {
      x: Math.max(0, Math.min(dims.width - 1, Math.round(dims.width * 0.5))),
      y: Math.max(0, Math.min(dims.height - 1, Math.round(dims.height * 0.5)))
    };
    const imageBlock = await fileToImageBlock(screenshotPath);
    if (!imageBlock) {
      return fallbackPoint;
    }
    try {
      const { data } = await debuggerLlmService.callStructured({
        agentId: "pixel_forensics_agent",
        stage: "dispatch",
        sessionId: context2.sessionId,
        runId: context2.runId,
        messages: [
          {
            role: "system",
            content: "You are a graphics debugging assistant. Return JSON only with keys normalized_x, normalized_y, reason. Coordinates must be floats between 0 and 1 for the suspicious bright white highlight most relevant to the debugging task."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Task: ${context2.debugPlan.userGoal}
Find the suspicious bright white highlight that should be investigated first.`
              },
              imageBlock
            ]
          }
        ],
        maxTokens: 300,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: {
          normalized_x: 0.5,
          normalized_y: 0.5,
          reason: "test-mode center point"
        },
        auditSummary: (payload) => payload.reason
      });
      return {
        x: Math.max(0, Math.min(dims.width - 1, Math.round(clamp01(toNumber(data.normalized_x, 0.5)) * dims.width))),
        y: Math.max(0, Math.min(dims.height - 1, Math.round(clamp01(toNumber(data.normalized_y, 0.5)) * dims.height)))
      };
    } catch {
      return fallbackPoint;
    }
  }
  async finishRecipe(agentId, context2, payloads, evidence, extraArtifacts = []) {
    const agentRoot = path.join(context2.outputRoot, "notes");
    fs.mkdirSync(agentRoot, { recursive: true });
    const artifactPath = path.join(agentRoot, `${agentId}.json`);
    fs.writeFileSync(artifactPath, JSON.stringify(payloads, null, 2), "utf-8");
    const successfulTools = payloads.filter((payload) => payload.ok);
    const failedTools = payloads.filter((payload) => !payload.ok);
    const condensedPayloads = payloads.map((payload) => ({
      toolName: payload.toolName,
      ok: payload.ok,
      data: summarizePayloadData(payload.data),
      error: payload.error
    }));
    const deterministicSummary = {
      summary: [
        `${agentId} collected ${successfulTools.length} successful tool results.`,
        ...successfulTools.map((payload) => describePayloadEvidence(payload.toolName, payload.data) ?? payload.toolName).slice(0, 4).map((line) => `- ${line}`),
        ...failedTools.length > 0 ? [`Failed tools: ${failedTools.map((payload) => payload.toolName).join(", ")}`] : []
      ].join("\n"),
      evidence: [
        ...evidence,
        ...successfulTools.map((payload) => describePayloadEvidence(payload.toolName, payload.data)).filter((line) => Boolean(line))
      ],
      next_step: this.getNextStep(agentId),
      confidence: successfulTools.length > 0 ? 0.72 : 0.35
    };
    let llmSummary;
    try {
      const structuredResult = await debuggerLlmService.callStructured({
        agentId,
        stage: "dispatch",
        sessionId: context2.sessionId,
        runId: context2.runId,
        messages: [
          {
            role: "system",
            content: "You are a RenderDoc debugging specialist. Return compact JSON only with keys summary, evidence, next_step, confidence. Keep summary to at most two sentences, evidence to at most three short strings, and confidence between 0 and 1. Do not include markdown fences or extra commentary."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  `Agent: ${agentId}`,
                  `Goal: ${context2.debugPlan.userGoal}`,
                  `Evidence anchors: ${evidence.join(" | ") || "N/A"}`,
                  `Successful tools: ${successfulTools.map((payload) => payload.toolName).join(", ") || "none"}`,
                  `Failed tools: ${failedTools.map((payload) => `${payload.toolName}: ${payload.error || "failed"}`).join(" | ") || "none"}`,
                  `Condensed tool payloads JSON: ${JSON.stringify(condensedPayloads)}`
                ].join("\n")
              }
            ]
          }
        ],
        maxTokens: 220,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministicSummary,
        auditSummary: (payload) => payload.summary
      });
      llmSummary = structuredResult.data;
    } catch {
      try {
        const fallbackResult = await debuggerLlmService.call({
          agentId,
          stage: "dispatch",
          sessionId: context2.sessionId,
          runId: context2.runId
        }, {
          messages: [
            {
              role: "system",
              content: "You are a RenderDoc debugging specialist. Reply with one or two concise sentences only. Summarize the most important finding from the provided tool evidence and what should be checked next."
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: [
                    `Agent: ${agentId}`,
                    `Goal: ${context2.debugPlan.userGoal}`,
                    `Evidence anchors: ${evidence.join(" | ") || "N/A"}`,
                    `Successful tools: ${successfulTools.map((payload) => payload.toolName).join(", ") || "none"}`,
                    `Failed tools: ${failedTools.map((payload) => `${payload.toolName}: ${payload.error || "failed"}`).join(" | ") || "none"}`
                  ].join("\n")
                }
              ]
            }
          ],
          maxTokens: 160,
          temperature: 0.1
        });
        const fallbackSummary = fallbackResult.text.trim();
        llmSummary = fallbackSummary ? {
          summary: fallbackSummary,
          evidence,
          next_step: this.getNextStep(agentId),
          confidence: deterministicSummary.confidence
        } : deterministicSummary;
      } catch {
        llmSummary = deterministicSummary;
      }
    }
    const reasoningSummary = {
      summaryId: `${agentId}-${Date.now()}`,
      stage: "dispatch",
      agentId,
      summary: llmSummary.summary,
      evidence: toStringArray$1(llmSummary.evidence).length > 0 ? toStringArray$1(llmSummary.evidence) : evidence,
      nextStep: llmSummary.next_step || this.getNextStep(agentId),
      confidence: toNumber(llmSummary.confidence, deterministicSummary.confidence),
      createdAt: nowIso$1()
    };
    return {
      agentId,
      brief: reasoningSummary.summary,
      reasoningSummary,
      artifacts: [artifactPath, ...extraArtifacts],
      evidenceRefs: reasoningSummary.evidence,
      payloads
    };
  }
  getNextStep(agentId) {
    if (agentId === "triage_agent") {
      return "Use triage evidence to decide which pipeline, pixel, and shader investigations should continue.";
    }
    if (agentId === "pixel_forensics_agent") {
      return "Correlate the suspicious pixel evidence with pipeline and shader state.";
    }
    if (agentId === "shader_ir_agent") {
      return "Validate whether shader logic matches the visual artifact and proposed fix.";
    }
    return "Feed this specialist evidence into the orchestrator investigation summary.";
  }
}
const specialistRecipeRunner = new SpecialistRecipeRunner();
const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
class ReportBundleService {
  publish(input) {
    const reportsDir = path.join(
      input.projectRoot,
      "sessions",
      input.sessionId,
      "runs",
      input.runId,
      "reports"
    );
    fs.mkdirSync(reportsDir, { recursive: true });
    const markdownPath = path.join(reportsDir, "report.md");
    const jsonPath = path.join(reportsDir, "report.json");
    const htmlPath = path.join(reportsDir, "visual_report.html");
    const payload = {
      sessionId: input.sessionId,
      runId: input.runId,
      goal: input.goal,
      eventCount: input.eventCount ?? 0,
      artifactPaths: input.artifactPaths ?? [],
      evidenceSummary: input.evidenceSummary ?? input.report.evidenceSummary,
      verificationSummary: input.verificationSummary ?? [],
      llmExecution: input.llmExecution ?? null,
      report: input.report
    };
    fs.writeFileSync(markdownPath, this.buildMarkdown(payload), "utf8");
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    fs.writeFileSync(htmlPath, this.buildHtml(payload), "utf8");
    return {
      reportsDir,
      markdownPath,
      jsonPath,
      htmlPath
    };
  }
  buildMarkdown(payload) {
    const lines = [
      `# ${payload.report.title}`,
      "",
      "## Task Goal",
      payload.goal || "N/A",
      "",
      "## Summary",
      payload.report.summary || "N/A",
      "",
      "## Root Cause",
      payload.report.rootCause || "N/A",
      "",
      "## Fix Verification",
      payload.report.fixDescription || "N/A",
      "",
      "## Evidence Summary",
      ...payload.evidenceSummary.length > 0 ? payload.evidenceSummary.map((item) => `- ${item}`) : ["- N/A"],
      "",
      "## Verification Notes",
      ...payload.verificationSummary.length > 0 ? payload.verificationSummary.map((item) => `- ${item}`) : ["- N/A"],
      "",
      "## LLM Execution",
      ...payload.llmExecution ? [
        `- Provider ID: ${payload.llmExecution.providerId}`,
        `- Model ID: ${payload.llmExecution.modelId}`,
        `- Successful Calls: ${payload.llmExecution.successfulCallCount}`,
        `- Failed Calls: ${payload.llmExecution.failedCallCount}`,
        `- First Request ID: ${payload.llmExecution.firstRequestId || "N/A"}`,
        `- Token Usage: input=${payload.llmExecution.totalInputTokens}, output=${payload.llmExecution.totalOutputTokens}`
      ] : ["- N/A"],
      "",
      "## Recommendations",
      ...payload.report.recommendations.length > 0 ? payload.report.recommendations.map((item) => `- ${item}`) : ["- N/A"],
      "",
      "## Run Metadata",
      `- Session ID: ${payload.sessionId}`,
      `- Run ID: ${payload.runId}`,
      `- Event Count: ${payload.eventCount}`,
      `- Confidence: ${payload.report.confidence}`,
      "",
      "## Related Artifacts",
      ...payload.artifactPaths.length > 0 ? payload.artifactPaths.map((item) => `- ${item}`) : ["- N/A"],
      ""
    ];
    return lines.join("\n");
  }
  buildHtml(payload) {
    const evidenceItems = (payload.evidenceSummary.length > 0 ? payload.evidenceSummary : ["N/A"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const verificationItems = (payload.verificationSummary.length > 0 ? payload.verificationSummary : ["N/A"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const recommendationItems = (payload.report.recommendations.length > 0 ? payload.report.recommendations : ["N/A"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const artifactItems = (payload.artifactPaths.length > 0 ? payload.artifactPaths : ["N/A"]).map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("");
    const llmItems = payload.llmExecution ? [
      `<li>Provider ID: <code>${escapeHtml(payload.llmExecution.providerId)}</code></li>`,
      `<li>Model ID: <code>${escapeHtml(payload.llmExecution.modelId)}</code></li>`,
      `<li>Successful Calls: ${payload.llmExecution.successfulCallCount}</li>`,
      `<li>Failed Calls: ${payload.llmExecution.failedCallCount}</li>`,
      `<li>First Request ID: <code>${escapeHtml(payload.llmExecution.firstRequestId || "N/A")}</code></li>`,
      `<li>Token Usage: input=${payload.llmExecution.totalInputTokens}, output=${payload.llmExecution.totalOutputTokens}</li>`
    ].join("") : "<li>N/A</li>";
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
      <p>${escapeHtml(payload.report.summary || "N/A")}</p>
      <div class="meta">
        <div class="meta-item"><div class="label">Session</div><div class="value">${escapeHtml(payload.sessionId)}</div></div>
        <div class="meta-item"><div class="label">Run</div><div class="value">${escapeHtml(payload.runId)}</div></div>
        <div class="meta-item"><div class="label">Events</div><div class="value">${payload.eventCount}</div></div>
        <div class="meta-item"><div class="label">Confidence</div><div class="value confidence">${escapeHtml(String(payload.report.confidence))}</div></div>
      </div>
    </section>
    <section class="section">
      <div class="eyebrow">Task Goal</div>
      <p>${escapeHtml(payload.goal || "N/A")}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Root Cause</div>
      <p>${escapeHtml(payload.report.rootCause || "N/A")}</p>
    </section>
    <section class="section">
      <div class="eyebrow">Fix Verification</div>
      <p>${escapeHtml(payload.report.fixDescription || "N/A")}</p>
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
const reportBundleService = new ReportBundleService();
class RunScopedStore {
  getRunRoot(sessionId, runId) {
    return storageAdapter.getRunPath(sessionId, runId);
  }
  readJson(sessionId, runId, relativePath, fallback) {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    if (!fs__namespace.existsSync(filePath)) {
      return fallback;
    }
    try {
      return JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
    } catch (error) {
      console.error(`[RunScopedStore] Failed to read ${filePath}`, error);
      return fallback;
    }
  }
  writeJson(sessionId, runId, relativePath, data) {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    fs__namespace.mkdirSync(path__namespace.dirname(filePath), { recursive: true });
    fs__namespace.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }
  readJsonl(sessionId, runId, relativePath) {
    return readJsonl(this.resolveRunPath(sessionId, runId, relativePath));
  }
  writeJsonl(sessionId, runId, relativePath, items) {
    const filePath = this.resolveRunPath(sessionId, runId, relativePath);
    writeJsonl(filePath, items);
    return filePath;
  }
  appendJsonl(sessionId, runId, relativePath, item) {
    const items = this.readJsonl(sessionId, runId, relativePath);
    items.push(item);
    return this.writeJsonl(sessionId, runId, relativePath, items);
  }
  resolveRunPath(sessionId, runId, relativePath) {
    const runRoot = this.getRunRoot(sessionId, runId);
    const targetPath = path__namespace.resolve(runRoot, relativePath);
    if (!this.isPathInside(runRoot, targetPath)) {
      throw new Error(`Run-scoped write escaped run directory: ${relativePath}`);
    }
    return targetPath;
  }
  isPathInside(rootPath, targetPath) {
    const relative = path__namespace.relative(path__namespace.resolve(rootPath), path__namespace.resolve(targetPath));
    return relative === "" || !relative.startsWith("..") && !path__namespace.isAbsolute(relative);
  }
}
const runScopedStore = new RunScopedStore();
const STORE_PATH = "artifact_store.json";
class ArtifactStore {
  read(sessionId, runId) {
    return runScopedStore.readJson(
      sessionId,
      runId,
      STORE_PATH,
      {
        schemaVersion: "1",
        runId,
        sessionId,
        artifacts: [],
        updatedAt: nowIso$1()
      }
    );
  }
  list(sessionId, runId) {
    return this.read(sessionId, runId).artifacts;
  }
  get(sessionId, runId, artifactId) {
    return this.list(sessionId, runId).find((artifact) => artifact.artifactId === artifactId) ?? null;
  }
  register(sessionId, runId, record) {
    this.assertRunBinding(sessionId, runId, record);
    const scopedPath = this.resolveArtifactPath(sessionId, runId, record.filePath);
    const stat = fs__namespace.existsSync(scopedPath) ? fs__namespace.statSync(scopedPath) : null;
    const now = nowIso$1();
    const nextRecord = {
      ...record,
      filePath: scopedPath,
      sizeBytes: stat?.size ?? record.sizeBytes,
      createdAt: record.createdAt || now,
      updatedAt: now
    };
    const snapshot = this.read(sessionId, runId);
    const existingIndex = snapshot.artifacts.findIndex((artifact) => artifact.artifactId === record.artifactId);
    const artifacts = [...snapshot.artifacts];
    if (existingIndex >= 0) {
      artifacts[existingIndex] = {
        ...artifacts[existingIndex],
        ...nextRecord,
        createdAt: artifacts[existingIndex].createdAt
      };
    } else {
      artifacts.push(nextRecord);
    }
    this.write({
      ...snapshot,
      artifacts,
      updatedAt: now
    });
    return existingIndex >= 0 ? artifacts[existingIndex] : nextRecord;
  }
  write(snapshot) {
    runScopedStore.writeJson(snapshot.sessionId, snapshot.runId, STORE_PATH, snapshot);
  }
  resolveArtifactPath(sessionId, runId, filePath) {
    const runRoot = runScopedStore.getRunRoot(sessionId, runId);
    const resolvedPath = path__namespace.isAbsolute(filePath) ? path__namespace.resolve(filePath) : path__namespace.resolve(runRoot, "artifacts", filePath);
    if (!runScopedStore.isPathInside(runRoot, resolvedPath)) {
      throw new Error(`Artifact path escaped run directory: ${filePath}`);
    }
    return resolvedPath;
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const artifactStore = new ArtifactStore();
const EVIDENCE_PATH = "evidence-ledger.jsonl";
const VERIFICATION_PATH = "verification_results.jsonl";
class EvidenceLedger {
  appendEvidence(sessionId, runId, record) {
    this.assertRunBinding(sessionId, runId, record);
    const nextRecord = {
      ...record,
      createdAt: record.createdAt || nowIso$1()
    };
    runScopedStore.appendJsonl(sessionId, runId, EVIDENCE_PATH, nextRecord);
    return nextRecord;
  }
  listEvidence(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, EVIDENCE_PATH);
  }
  findEvidence(sessionId, runId, evidenceId) {
    return this.listEvidence(sessionId, runId).find((record) => record.evidenceId === evidenceId) ?? null;
  }
  appendVerificationResult(sessionId, runId, result) {
    this.assertRunBinding(sessionId, runId, result);
    const nextResult = {
      ...result,
      createdAt: result.createdAt || nowIso$1()
    };
    runScopedStore.appendJsonl(sessionId, runId, VERIFICATION_PATH, nextResult);
    return nextResult;
  }
  listVerificationResults(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, VERIFICATION_PATH);
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const evidenceLedger = new EvidenceLedger();
const BOARD_PATH = "task-board.json";
class TaskBoard {
  read(sessionId, runId) {
    return runScopedStore.readJson(
      sessionId,
      runId,
      BOARD_PATH,
      {
        schemaVersion: "1",
        runId,
        sessionId,
        tasks: [],
        mutations: [],
        updatedAt: nowIso$1()
      }
    );
  }
  listTasks(sessionId, runId) {
    return this.read(sessionId, runId).tasks;
  }
  getTask(sessionId, runId, taskId) {
    return this.read(sessionId, runId).tasks.find((task) => task.taskId === taskId) ?? null;
  }
  upsertTask(sessionId, runId, task) {
    this.assertRunBinding(sessionId, runId, task);
    const snapshot = this.read(sessionId, runId);
    const existingIndex = snapshot.tasks.findIndex((item) => item.taskId === task.taskId);
    const nextTask = {
      ...task,
      updatedAt: nowIso$1()
    };
    const tasks = [...snapshot.tasks];
    if (existingIndex >= 0) {
      tasks[existingIndex] = {
        ...tasks[existingIndex],
        ...nextTask,
        createdAt: tasks[existingIndex].createdAt
      };
    } else {
      tasks.push(nextTask);
    }
    this.write({
      ...snapshot,
      tasks,
      updatedAt: nowIso$1()
    });
    return existingIndex >= 0 ? tasks[existingIndex] : nextTask;
  }
  mutateTask(sessionId, runId, mutation) {
    this.assertRunBinding(sessionId, runId, mutation);
    const snapshot = this.read(sessionId, runId);
    const task = snapshot.tasks.find((item) => item.taskId === mutation.taskId);
    if (!task) {
      throw new Error(`Harness task not found: ${mutation.taskId}`);
    }
    const updatedTask = {
      ...task,
      ...mutation.patch,
      taskId: task.taskId,
      runId,
      sessionId,
      createdAt: task.createdAt,
      updatedAt: nowIso$1(),
      completedAt: mutation.patch.status === "completed" ? nowIso$1() : mutation.patch.completedAt
    };
    this.write({
      ...snapshot,
      tasks: snapshot.tasks.map((item) => item.taskId === task.taskId ? updatedTask : item),
      mutations: [
        ...snapshot.mutations,
        {
          ...mutation,
          mutationId: mutation.mutationId || generateEventId("task-mutation"),
          reason: mutation.reason,
          createdAt: mutation.createdAt || nowIso$1()
        }
      ],
      updatedAt: nowIso$1()
    });
    return updatedTask;
  }
  write(snapshot) {
    runScopedStore.writeJson(snapshot.sessionId, snapshot.runId, BOARD_PATH, snapshot);
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const taskBoard = new TaskBoard();
const PLAN_PATH = "plan_contract.json";
const CONTEXT_PACKETS_PATH = "context_packets.jsonl";
const RESULT_CARDS_PATH = "agent_result_cards.jsonl";
const CAPSULE_PATH = "run_capsule.json";
class ContextService {
  readPlanContract(sessionId, runId) {
    return runScopedStore.readJson(sessionId, runId, PLAN_PATH, null);
  }
  writePlanContract(sessionId, runId, contract) {
    this.assertRunBinding(sessionId, runId, contract);
    const nextContract = {
      ...contract,
      updatedAt: nowIso$1()
    };
    runScopedStore.writeJson(sessionId, runId, PLAN_PATH, nextContract);
    return nextContract;
  }
  appendContextPacket(sessionId, runId, packet) {
    this.assertRunBinding(sessionId, runId, packet);
    const nextPacket = {
      ...packet,
      packetId: packet.packetId || generateEventId("context-packet"),
      createdAt: packet.createdAt || nowIso$1()
    };
    runScopedStore.appendJsonl(sessionId, runId, CONTEXT_PACKETS_PATH, nextPacket);
    return nextPacket;
  }
  listContextPackets(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, CONTEXT_PACKETS_PATH);
  }
  appendAgentResultCard(sessionId, runId, card) {
    this.assertRunBinding(sessionId, runId, card);
    const now = nowIso$1();
    const nextCard = {
      ...card,
      cardId: card.cardId || generateEventId("agent-result-card"),
      createdAt: card.createdAt || now,
      updatedAt: now
    };
    runScopedStore.appendJsonl(sessionId, runId, RESULT_CARDS_PATH, nextCard);
    return nextCard;
  }
  listAgentResultCards(sessionId, runId) {
    return runScopedStore.readJsonl(sessionId, runId, RESULT_CARDS_PATH);
  }
  buildRunCapsule(sessionId, runId) {
    const now = nowIso$1();
    return {
      schemaVersion: "1",
      capsuleId: generateEventId("run-capsule"),
      runId,
      sessionId,
      planContract: this.readPlanContract(sessionId, runId) ?? void 0,
      contextPackets: this.listContextPackets(sessionId, runId),
      tasks: taskBoard.listTasks(sessionId, runId),
      evidence: evidenceLedger.listEvidence(sessionId, runId),
      artifacts: artifactStore.list(sessionId, runId),
      verificationResults: evidenceLedger.listVerificationResults(sessionId, runId),
      agentResultCards: this.listAgentResultCards(sessionId, runId),
      createdAt: now,
      updatedAt: now
    };
  }
  writeRunCapsule(sessionId, runId) {
    const capsule = this.buildRunCapsule(sessionId, runId);
    runScopedStore.writeJson(sessionId, runId, CAPSULE_PATH, capsule);
    return capsule;
  }
  assertRunBinding(sessionId, runId, value) {
    if (value.sessionId !== sessionId || value.runId !== runId) {
      throw new Error(`Run binding mismatch for ${value.sessionId}/${value.runId}`);
    }
  }
}
const contextService = new ContextService();
const STORE_FILE = "agent-workstream-state.json";
const defaultState = (sessionId) => ({
  schemaVersion: "1",
  sessionId,
  activeBranchId: "branch-main",
  userRequests: [],
  branches: [],
  plans: [],
  updatedAt: nowIso$1()
});
class WorkstreamStateStore {
  read(sessionId) {
    const filePath = this.resolvePath(sessionId);
    if (!fs__namespace.existsSync(filePath)) {
      return defaultState(sessionId);
    }
    try {
      const parsed = JSON.parse(fs__namespace.readFileSync(filePath, "utf-8"));
      return {
        ...defaultState(sessionId),
        ...parsed,
        sessionId,
        userRequests: parsed.userRequests ?? [],
        branches: parsed.branches ?? [],
        plans: parsed.plans ?? []
      };
    } catch (error) {
      console.error(`[WorkstreamStateStore] Failed to read ${filePath}`, error);
      return defaultState(sessionId);
    }
  }
  write(state2) {
    const filePath = this.resolvePath(state2.sessionId);
    const nextState = {
      ...state2,
      updatedAt: nowIso$1()
    };
    fs__namespace.mkdirSync(path__namespace.dirname(filePath), { recursive: true });
    fs__namespace.writeFileSync(filePath, JSON.stringify(nextState, null, 2), "utf-8");
    return nextState;
  }
  ensureRunRequest(input) {
    const state2 = this.read(input.sessionId);
    if (state2.userRequests.some((request2) => request2.revisions.some((revision2) => revision2.resultingWorkstreamIds.includes(input.workstreamId)))) {
      return state2;
    }
    const requestId = `request-${input.runId}`;
    const revisionId = `revision-${input.runId}`;
    const branchId = state2.activeBranchId || "branch-main";
    const createdAt = nowIso$1();
    const revision = {
      id: revisionId,
      requestId,
      branchId,
      prompt: input.prompt,
      createdAt,
      resultingWorkstreamIds: [input.workstreamId]
    };
    const request = {
      id: requestId,
      sessionId: input.sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [revision]
    };
    const branch = {
      id: branchId,
      revisionId,
      status: "active",
      workstreamIds: [input.workstreamId]
    };
    const group = {
      id: `branch-group-${requestId}`,
      rootRequestId: requestId,
      activeBranchId: branchId,
      branches: [branch]
    };
    return this.write({
      ...state2,
      activeBranchId: branchId,
      userRequests: [...state2.userRequests, request],
      branches: [...state2.branches, group],
      plans: input.planId ? this.upsertPlan(state2.plans, {
        planId: input.planId,
        runId: input.runId,
        workstreamId: input.workstreamId,
        status: "awaiting_approval",
        createdAt,
        updatedAt: createdAt
      }) : state2.plans,
      latestDisplayedPlanId: input.planId ?? state2.latestDisplayedPlanId
    });
  }
  markPlan(sessionId, planId, status) {
    const state2 = this.read(sessionId);
    const now = nowIso$1();
    return this.write({
      ...state2,
      latestDisplayedPlanId: status === "awaiting_approval" ? planId : state2.latestDisplayedPlanId,
      latestAcceptedPlanId: status === "accepted" ? planId : state2.latestAcceptedPlanId,
      plans: state2.plans.map((plan) => plan.planId === planId ? { ...plan, status, updatedAt: now } : plan)
    });
  }
  registerPlan(input) {
    const state2 = this.read(input.sessionId);
    const now = nowIso$1();
    return this.write({
      ...state2,
      latestDisplayedPlanId: input.status === "awaiting_approval" ? input.planId : state2.latestDisplayedPlanId,
      latestAcceptedPlanId: input.status === "accepted" ? input.planId : state2.latestAcceptedPlanId,
      plans: this.upsertPlan(state2.plans, {
        planId: input.planId,
        runId: input.runId,
        workstreamId: input.workstreamId,
        status: input.status,
        createdAt: now,
        updatedAt: now
      })
    });
  }
  createRevision(input) {
    const state2 = this.read(input.sessionId);
    const branchGroup = state2.branches[0];
    const rootRequest = state2.userRequests[0];
    const createdAt = nowIso$1();
    const branchId = generateEventId("branch");
    const revisionId = generateEventId("revision");
    const requestId = rootRequest?.id ?? `request-${input.runId}`;
    const parentRevisionId = rootRequest?.activeRevisionId;
    const revision = {
      id: revisionId,
      requestId,
      branchId,
      parentRevisionId,
      prompt: input.revisionText,
      createdAt,
      resultingWorkstreamIds: [input.revisionWorkstreamId]
    };
    const nextRequest = rootRequest ? {
      ...rootRequest,
      activeRevisionId: revisionId,
      revisions: [...rootRequest.revisions, revision]
    } : {
      id: requestId,
      sessionId: input.sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [revision]
    };
    const nextBranch = {
      id: branchId,
      parentBranchId: state2.activeBranchId,
      revisionId,
      status: "active",
      workstreamIds: [input.revisionWorkstreamId]
    };
    const nextBranchGroup = branchGroup ? {
      ...branchGroup,
      activeBranchId: branchId,
      branches: branchGroup.branches.map((branch) => branch.id === state2.activeBranchId ? { ...branch, status: "inactive" } : branch).concat(nextBranch)
    } : {
      id: `branch-group-${requestId}`,
      rootRequestId: requestId,
      activeBranchId: branchId,
      branches: [nextBranch]
    };
    return this.write({
      ...state2,
      activeBranchId: branchId,
      latestDisplayedPlanId: void 0,
      userRequests: rootRequest ? state2.userRequests.map((request) => request.id === rootRequest.id ? nextRequest : request) : [...state2.userRequests, nextRequest],
      branches: branchGroup ? state2.branches.map((group) => group.id === branchGroup.id ? nextBranchGroup : group) : [...state2.branches, nextBranchGroup],
      plans: state2.plans.map((plan) => plan.planId === input.previousPlanId ? { ...plan, status: "needs_revision", updatedAt: createdAt } : plan)
    });
  }
  switchBranch(sessionId, branchId) {
    const state2 = this.read(sessionId);
    const hasBranch = state2.branches.some((group) => group.branches.some((branch) => branch.id === branchId));
    if (!hasBranch) {
      return state2;
    }
    return this.write({
      ...state2,
      activeBranchId: branchId,
      branches: state2.branches.map((group) => ({
        ...group,
        activeBranchId: group.branches.some((branch) => branch.id === branchId) ? branchId : group.activeBranchId,
        branches: group.branches.map((branch) => ({
          ...branch,
          status: branch.id === branchId ? "active" : branch.status === "active" ? "inactive" : branch.status
        }))
      }))
    });
  }
  upsertPlan(plans, plan) {
    const index = plans.findIndex((entry) => entry.planId === plan.planId);
    if (index < 0) {
      return [...plans, plan];
    }
    const next = [...plans];
    next[index] = {
      ...next[index],
      ...plan,
      createdAt: next[index].createdAt
    };
    return next;
  }
  resolvePath(sessionId) {
    const session = storageAdapter.readSession(sessionId);
    if (!session) {
      throw new Error(`Session not found for workstream state: ${sessionId}`);
    }
    const targetPath = path__namespace.resolve(session.sessionPath, STORE_FILE);
    if (!runScopedStore.isPathInside(session.sessionPath, targetPath)) {
      throw new Error(`Workstream state escaped session directory: ${targetPath}`);
    }
    return targetPath;
  }
}
const workstreamStateStore = new WorkstreamStateStore();
const toIso = (value, fallback = nowIso$1()) => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return fallback;
};
const firstLine = (value, fallback) => {
  const text = typeof value === "string" ? value : value === void 0 || value === null ? "" : JSON.stringify(value);
  return text.trim().split(/\r?\n/)[0]?.trim() || fallback;
};
const cleanText = (value) => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === void 0 || value === null) {
    return "";
  }
  return JSON.stringify(value, null, 2);
};
const workstreamTypeFromRun = (run) => run?.mode ?? "ask";
const statusFromRun = (run, planStatus) => {
  if (run.status === "awaiting_approval") {
    return "awaiting_approval";
  }
  if (run.status === "failed" || run.status === "interrupted") {
    return "failed";
  }
  if (run.status === "cancelled") {
    return "cancelled";
  }
  if (run.status === "completed") {
    return "completed";
  }
  return "running";
};
const toolStatusFromEvent = (event) => {
  if (event.status === "error" || event.status === "fail" || event.status === "timeout") {
    return "failed";
  }
  if (event.status === "sent" || event.status === "entered") {
    return "running";
  }
  if (event.status === "blocked") {
    return "skipped";
  }
  return "done";
};
const progressStatusFromTask = (task) => {
  if (task.status === "in_progress") return "running";
  if (task.status === "completed") return "completed";
  if (task.status === "blocked" || task.status === "rejected") return "blocked";
  if (task.status === "cancelled") return "cancelled";
  return "pending";
};
const isPendingConversationStatus = (status) => status === "draft" || status === "streaming";
const artifactTypeFromRecord = (record) => {
  if (record.kind === "report") return "report";
  if (record.kind === "screenshot") return "visual_report";
  if (record.kind === "trace" || record.kind === "data") return "evidence_bundle";
  return "other";
};
const mapPlanStatus = (approvalState, run) => {
  if (run.status === "failed" || run.status === "interrupted") return "failed";
  if (run.status === "completed") return "executed";
  if (approvalState === "approved") return "accepted";
  if (approvalState === "pending_user" || run.status === "awaiting_approval") return "awaiting_approval";
  if (approvalState === "rejected") return "needs_revision";
  return "draft";
};
const planSections = (debugPlan) => {
  const sections = debugPlan.presentation?.sections ?? [];
  if (sections.length > 0) {
    return sections.map((section) => ({
      id: section.id || section.title,
      title: section.title,
      body: section.body.join("\n"),
      severity: "normal"
    }));
  }
  return [
    { id: "goal", title: "目标", body: debugPlan.userGoal },
    { id: "scope", title: "执行路线", body: debugPlan.scope || "按 Debugger harness 推进 capture 分析。" },
    { id: "acceptance", title: "验收标准", body: debugPlan.verificationContract.successCriteria.join("\n") },
    { id: "risks", title: "风险 / 阻断", body: debugPlan.blockers.map((blocker) => blocker.reason).join("\n") || "暂无阻断。" },
    { id: "deliverables", title: "预计产物", body: debugPlan.expectedDeliverables.join("\n") || "调试报告。" }
  ];
};
const resultFromPlan = (workstreamId, debugPlan, status) => ({
  id: `${workstreamId}-plan-result`,
  workstreamId,
  kind: "plan",
  status,
  title: debugPlan.presentation?.title || "Debugger Plan",
  sections: planSections(debugPlan),
  artifactIds: [`artifact-${debugPlan.planId}`],
  createdAt: debugPlan.createdAt
});
const resultFromRun = (workstreamId, run, events2, artifacts) => {
  if (run.status === "completed") {
    const reportEvent = events2.find((event) => event.event_type === "report_published");
    return {
      id: `${workstreamId}-report-result`,
      workstreamId,
      kind: "report",
      status: "completed",
      title: "Execution Report",
      sections: [
        {
          id: "summary",
          title: "结论",
          body: "调试执行已完成，报告和证据产物已写入 session 输出。"
        },
        {
          id: "evidence",
          title: "关键证据",
          body: events2.filter((event) => ["agent_summary", "verification"].includes(event.event_type)).map((event) => firstLine(event.payload.summary ?? event.payload.verdict, event.event_type)).slice(0, 6).join("\n") || "详见 report.md 和 raw trace。"
        },
        {
          id: "artifacts",
          title: "产物入口",
          body: artifacts.map((artifact) => artifact.displayName).join("\n") || firstLine(reportEvent?.payload, "report.md")
        }
      ],
      artifactIds: artifacts.map((artifact) => artifact.id),
      createdAt: toIso(reportEvent?.ts_ms, toIso(run.finishedAt, nowIso$1()))
    };
  }
  if (run.status === "failed" || run.status === "interrupted") {
    return {
      id: `${workstreamId}-failure-result`,
      workstreamId,
      kind: "failure",
      status: "failed",
      title: "Failure Report",
      sections: [
        { id: "conclusion", title: "失败结论", body: run.stopReason || "任务未能完成。", severity: "error" },
        {
          id: "completed",
          title: "已完成内容",
          body: events2.filter((event) => event.status === "ok").map((event) => event.event_type).slice(0, 8).join("\n") || "无可确认完成项。"
        },
        { id: "recovery", title: "可恢复路径", body: "保留当前 raw trace、context 和已产生产物；修复阻断后可重新发起任务。" }
      ],
      artifactIds: [],
      createdAt: toIso(run.finishedAt ?? run.stoppedAt, nowIso$1())
    };
  }
  if (run.status === "cancelled") {
    return {
      id: `${workstreamId}-cancelled-result`,
      workstreamId,
      kind: "cancelled",
      status: "cancelled",
      title: "Cancelled Result",
      sections: [
        { id: "time", title: "中断时间", body: toIso(run.stoppedAt, nowIso$1()) },
        { id: "completed", title: "已完成内容", body: events2.map((event) => event.event_type).slice(0, 8).join("\n") || "尚未产生可确认执行内容。" },
        { id: "next", title: "可继续路径", body: "历史过程保留，可基于同一 capture 重新发起 Debugger 任务。" }
      ],
      artifactIds: [],
      createdAt: toIso(run.stoppedAt, nowIso$1())
    };
  }
  return void 0;
};
const askResultFromTurn = (workstreamId, turn) => {
  const assistant = turn.assistantMessages.slice(-1)[0];
  if (!assistant || isPendingConversationStatus(assistant.status)) {
    return void 0;
  }
  const createdAt = toIso(assistant.updatedAt ?? assistant.createdAt, toIso(turn.completedAt));
  const diagnostic = assistant.diagnostic;
  if (assistant.status === "error") {
    const sections = [
      {
        id: "error",
        title: "失败原因",
        body: assistant.content || diagnostic?.userMessage || "回复生成失败。",
        severity: "error"
      }
    ];
    if (diagnostic) {
      sections.push({
        id: "diagnostic",
        title: "诊断",
        body: [
          diagnostic.code,
          diagnostic.providerId && diagnostic.modelId ? `${diagnostic.providerId}/${diagnostic.modelId}` : diagnostic.providerId,
          diagnostic.technicalMessage
        ].filter(Boolean).join("\n"),
        severity: diagnostic.severity === "error" ? "error" : "warning"
      });
    }
    return {
      id: `${workstreamId}-failure-result`,
      workstreamId,
      kind: "failure",
      status: "failed",
      title: "Ask Failed",
      sections,
      artifactIds: [],
      createdAt
    };
  }
  if (assistant.status === "stopped") {
    return {
      id: `${workstreamId}-cancelled-result`,
      workstreamId,
      kind: "cancelled",
      status: "cancelled",
      title: "Ask Cancelled",
      sections: [{ id: "cancelled", title: "已停止", body: assistant.content || "当前请求已停止。" }],
      artifactIds: [],
      createdAt
    };
  }
  const answer = turn.assistantMessages.map((message) => message.content.trim()).filter(Boolean).join("\n\n");
  return {
    id: `${workstreamId}-answer-result`,
    workstreamId,
    kind: "answer",
    status: "completed",
    title: "Ask Answer",
    sections: [{ id: "answer", title: "回答", body: answer || "暂无回复内容。" }],
    artifactIds: [],
    createdAt
  };
};
class AgentWorkstreamProjector {
  async getSession(sessionId) {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      const runs = storageAdapter.listRuns(sessionId).slice().sort((left, right) => left.startedAt - right.startedAt);
      const conversations = storageAdapter.readConversationHistory(sessionId);
      const events2 = await storageAdapter.readActionChain(sessionId);
      let state2 = workstreamStateStore.read(sessionId);
      for (const run of runs) {
        const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
        if (snapshot?.debug_plan) {
          state2 = workstreamStateStore.ensureRunRequest({
            sessionId,
            runId: run.runId,
            prompt: run.goal,
            planId: snapshot.debug_plan.planId,
            workstreamId: this.planWorkstreamId(run.runId)
          });
          const desiredStatus = mapPlanStatus(snapshot.approval_state, run);
          const currentStatus = state2.plans.find((plan) => plan.planId === snapshot.debug_plan?.planId)?.status;
          if (snapshot.debug_plan.planId && currentStatus && currentStatus !== desiredStatus && currentStatus !== "needs_revision" && currentStatus !== "superseded") {
            state2 = workstreamStateStore.markPlan(sessionId, snapshot.debug_plan.planId, desiredStatus);
          }
        }
      }
      const model = this.buildSessionModel(sessionId, runs, conversations, events2, state2);
      const presentation = this.buildPresentation(model);
      return { success: true, session: model, presentation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  buildConversationPresentation(sessionId, conversations) {
    const model = this.buildSessionModel(sessionId, [], conversations, [], {
      schemaVersion: "1",
      sessionId,
      activeBranchId: "branch-main",
      userRequests: [],
      branches: [],
      plans: [],
      updatedAt: nowIso$1()
    });
    return this.buildPresentation(model);
  }
  buildSessionModel(sessionId, runs, conversations, events2, state2) {
    const rawAuditRefs = events2.map((event) => ({
      id: `raw-${event.event_id}`,
      label: event.event_type,
      eventId: event.event_id,
      runId: event.run_id,
      sessionId: event.session_id,
      ref: `action_chain:${event.event_id}`
    }));
    const workstreams = [];
    const progress = [];
    const artifacts = [];
    const context2 = [];
    const userRequests = [...state2.userRequests];
    for (const run of runs) {
      const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
      const runEvents = events2.filter((event) => event.run_id === run.runId).sort((left, right) => left.ts_ms - right.ts_ms);
      const planStatus = state2.plans.find((plan) => plan.planId === snapshot?.debug_plan?.planId)?.status ?? mapPlanStatus(snapshot?.approval_state, run);
      const branchId = this.branchIdForWorkstream(state2.branches, this.planWorkstreamId(run.runId), state2.activeBranchId);
      const planWorkstream = this.buildPlanWorkstream(run, snapshot?.debug_plan ?? null, planStatus, branchId, runEvents, conversations);
      workstreams.push(planWorkstream);
      const runArtifacts = this.mapArtifacts(sessionId, run.runId, branchId, this.executionWorkstreamId(run.runId), runEvents);
      artifacts.push(...runArtifacts);
      progress.push(...this.mapProgress(sessionId, run.runId, branchId, this.executionWorkstreamId(run.runId)));
      context2.push(...this.mapContext(sessionId, run.runId, branchId, this.executionWorkstreamId(run.runId), run));
      if (this.shouldShowExecutionWorkstream(run, snapshot?.approval_state, runEvents)) {
        workstreams.push(this.buildExecutionWorkstream(run, branchId, runEvents, runArtifacts));
      }
    }
    for (const turn of this.groupAskTurns(conversations)) {
      if (turn.messages.some((message) => message.runId)) {
        continue;
      }
      const branchId = state2.activeBranchId || "branch-main";
      const id = `ws-ask-${turn.turnId}`;
      workstreams.push(this.buildAskWorkstream(sessionId, branchId, id, turn));
      userRequests.push(this.userRequestFromAskTurn(sessionId, branchId, id, turn));
    }
    const updatedAt = nowIso$1();
    return {
      sessionId,
      activeBranchId: state2.activeBranchId || "branch-main",
      latestDisplayedPlanId: state2.latestDisplayedPlanId,
      latestAcceptedPlanId: state2.latestAcceptedPlanId,
      userRequests,
      workstreams: workstreams.sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt)),
      progress,
      artifacts,
      context: context2,
      branches: state2.branches,
      rawAuditRefs,
      updatedAt
    };
  }
  buildPresentation(session) {
    const activeWorkstreams = session.workstreams.filter((workstream) => workstream.branchId === session.activeBranchId);
    const allWorkstreams = [...session.workstreams].sort((left, right) => {
      const leftTime = Date.parse(left.startedAt) || 0;
      const rightTime = Date.parse(right.startedAt) || 0;
      return leftTime - rightTime;
    });
    const items = [];
    for (const workstream of allWorkstreams) {
      const isActive = workstream.branchId === session.activeBranchId;
      const prompt = this.promptForWorkstream(session, workstream);
      if (prompt) {
        const branchNav = this.buildPromptBranchNavigator(session, prompt.requestId, prompt.branchId);
        items.push({ ...prompt, branchNavigator: branchNav });
      }
      items.push(this.toTaskViewModel(session, workstream, !isActive));
      const userEvents = workstream.processEvents.flatMap((event) => {
        if (event.kind === "user.confirmed") {
          return [{
            kind: "user_confirmation",
            id: event.id,
            workstreamId: event.workstreamId,
            planId: event.planId,
            label: event.label,
            createdAt: event.createdAt
          }];
        }
        if (event.kind === "user.revision_requested") {
          return [{
            kind: "user_revision",
            id: event.id,
            workstreamId: event.workstreamId,
            planId: event.planId,
            prompt: event.prompt,
            createdAt: event.createdAt
          }];
        }
        return [];
      });
      items.push(...userEvents);
    }
    const rightPanel = this.buildRightPanel(session, activeWorkstreams);
    const latestPlan = activeWorkstreams.filter((workstream) => workstream.planStatus === "awaiting_approval").slice(-1)[0] ?? null;
    const latestPlanResult = latestPlan?.result;
    return {
      sessionId: session.sessionId,
      activeBranchId: session.activeBranchId,
      mode: activeWorkstreams.find((workstream) => workstream.type !== "ask")?.type ?? "ask",
      items,
      rightPanel,
      approval: latestPlan && latestPlanResult ? {
        planId: latestPlan.planId ?? latestPlanResult.id,
        workstreamId: latestPlan.id,
        runId: latestPlan.id.replace(/^ws-/, "").replace(/-plan$/, ""),
        status: "awaiting_approval",
        title: latestPlanResult.title,
        summary: latestPlanResult.sections.slice(0, 2).map((section) => `${section.title}: ${section.body}`).join("\n"),
        canApprove: true,
        canRequestRevision: true
      } : null,
      branchNavigator: null,
      rawAuditRefs: session.rawAuditRefs,
      updatedAt: session.updatedAt
    };
  }
  buildPlanWorkstream(run, debugPlan, planStatus, branchId, runEvents, conversations) {
    const id = this.planWorkstreamId(run.runId);
    const confirmationEvents = runEvents.filter((event) => ["user_confirmation", "user_revision_requested"].includes(event.event_type)).map((event) => event.event_type === "user_confirmation" ? {
      kind: "user.confirmed",
      id: event.event_id,
      workstreamId: id,
      planId: String(event.payload.planId || debugPlan?.planId || ""),
      createdAt: toIso(event.ts_ms),
      label: String(event.payload.label || "同意执行")
    } : {
      kind: "user.revision_requested",
      id: event.event_id,
      workstreamId: id,
      planId: String(event.payload.planId || debugPlan?.planId || ""),
      createdAt: toIso(event.ts_ms),
      prompt: String(event.payload.prompt || "")
    });
    const planEvents = runEvents.filter((event) => event.event_type === "tool_execution" || event.event_type === "blocker" || event.event_type === "workflow_stage_transition");
    return {
      id,
      sessionId: run.sessionId,
      branchId,
      type: workstreamTypeFromRun(run),
      status: planStatus === "awaiting_approval" ? "awaiting_approval" : planStatus === "failed" ? "failed" : "completed",
      density: planStatus === "awaiting_approval" ? "expanded" : "compact",
      resultKind: "plan",
      startedAt: toIso(run.startedAt),
      completedAt: planStatus === "awaiting_approval" ? void 0 : toIso(run.startedAt + 1),
      processEvents: [
        ...this.agentTextFromConversation(id, run.runId, conversations),
        ...this.processEventsFromActionEvents(id, planEvents),
        ...confirmationEvents
      ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
      result: debugPlan ? resultFromPlan(id, debugPlan, planStatus) : void 0,
      planId: debugPlan?.planId,
      planStatus
    };
  }
  buildExecutionWorkstream(run, branchId, runEvents, artifacts) {
    const id = this.executionWorkstreamId(run.runId);
    const executionEvents = runEvents.filter((event) => ![
      "user_message",
      "user_confirmation",
      "user_revision_requested"
    ].includes(event.event_type));
    const status = statusFromRun(run);
    const result = resultFromRun(id, run, executionEvents, artifacts);
    return {
      id,
      sessionId: run.sessionId,
      branchId,
      type: workstreamTypeFromRun(run),
      status,
      density: status === "completed" ? "compact" : "expanded",
      resultKind: result?.kind,
      sourceRequestRevisionId: this.revisionIdForBranch(branchId),
      startedAt: toIso(run.startedAt + 2),
      completedAt: run.finishedAt ? toIso(run.finishedAt) : void 0,
      processEvents: this.processEventsFromActionEvents(id, executionEvents),
      result
    };
  }
  buildAskWorkstream(sessionId, branchId, workstreamId, turn) {
    const assistant = turn.assistantMessages.slice(-1)[0];
    const pending = !assistant || isPendingConversationStatus(assistant.status);
    const failed = assistant?.status === "error";
    const cancelled = assistant?.status === "stopped";
    const status = failed ? "failed" : cancelled ? "cancelled" : pending ? "running" : "completed";
    const result = askResultFromTurn(workstreamId, turn);
    const pendingEvent = pending ? [{
      kind: "agent.text",
      id: `agent-text-${assistant?.id ?? `${turn.turnId}-pending`}`,
      workstreamId,
      createdAt: toIso(assistant?.createdAt ?? turn.createdAt),
      text: assistant?.content.trim() || "正在生成回复。"
    }] : [];
    return {
      id: workstreamId,
      sessionId,
      branchId,
      type: "ask",
      status,
      density: status === "running" ? "expanded" : "compact",
      resultKind: result?.kind,
      startedAt: toIso(turn.createdAt),
      completedAt: status === "running" ? void 0 : toIso(turn.completedAt),
      processEvents: pendingEvent,
      result
    };
  }
  userRequestFromAskTurn(sessionId, branchId, workstreamId, turn) {
    const requestId = `request-ask-${turn.turnId}`;
    const revisionId = `revision-ask-${turn.turnId}`;
    const prompt = turn.userMessage?.content.trim() || turn.messages.find((message) => message.role === "user")?.content.trim() || "Ask";
    return {
      id: requestId,
      sessionId,
      rootRevisionId: revisionId,
      activeRevisionId: revisionId,
      revisions: [
        {
          id: revisionId,
          requestId,
          branchId,
          prompt,
          createdAt: toIso(turn.userMessage?.createdAt ?? turn.createdAt),
          resultingWorkstreamIds: [workstreamId]
        }
      ]
    };
  }
  processEventsFromActionEvents(workstreamId, events2) {
    const processEvents = [];
    for (const event of events2) {
      if (event.event_type === "tool_execution") {
        const title = String(event.payload.tool_name || event.payload.toolName || "Tool");
        processEvents.push({
          kind: "tool",
          id: event.event_id,
          workstreamId,
          taskId: typeof event.payload.taskId === "string" ? event.payload.taskId : void 0,
          createdAt: toIso(event.ts_ms),
          completedAt: event.status === "sent" || event.status === "entered" ? void 0 : toIso(event.ts_ms + event.duration_ms),
          status: toolStatusFromEvent(event),
          title,
          summary: firstLine(event.payload.summary ?? event.payload.result ?? event.payload.error ?? event.payload.data, title),
          target: cleanText(event.payload.target ?? event.payload.eventId ?? event.payload.prompt_id),
          durationMs: event.duration_ms,
          inputRef: `input:${event.event_id}`,
          outputRef: `output:${event.event_id}`,
          artifactIds: Array.isArray(event.payload.artifacts) ? event.payload.artifacts.map(String) : [],
          rawTraceRef: `raw-${event.event_id}`,
          errorSummary: event.status === "error" || event.status === "fail" ? firstLine(event.payload.error ?? event.payload.message, "工具失败") : void 0
        });
        continue;
      }
      if (event.event_type === "dispatch") {
        const label = String(event.payload.targetAgent || event.agent_id || "Sub Agent");
        processEvents.push({
          kind: "subagent",
          id: event.event_id,
          workstreamId,
          createdAt: toIso(event.ts_ms),
          completedAt: event.status === "sent" ? void 0 : toIso(event.ts_ms + event.duration_ms),
          status: toolStatusFromEvent(event),
          label,
          summary: firstLine(event.payload.objective, "子 agent 已接收任务。"),
          rawTraceRef: `raw-${event.event_id}`
        });
        continue;
      }
      if (event.event_type === "agent_summary") {
        processEvents.push({
          kind: "agent.text",
          id: event.event_id,
          workstreamId,
          createdAt: toIso(event.ts_ms),
          text: String(event.payload.summary || event.payload.content || "")
        });
        continue;
      }
      if (event.event_type === "blocker" || event.event_type === "verification" || event.event_type === "report_published") {
        processEvents.push({
          kind: "agent.text",
          id: event.event_id,
          workstreamId,
          createdAt: toIso(event.ts_ms),
          text: firstLine(event.payload.summary ?? event.payload.reason ?? event.payload.verdict ?? event.payload, event.event_type)
        });
      }
    }
    return processEvents.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }
  agentTextFromConversation(workstreamId, runId, conversations) {
    return conversations.filter((message) => message.runId === runId && message.role === "assistant" && message.content.trim()).map((message) => ({
      kind: "agent.text",
      id: `agent-text-${message.id}`,
      workstreamId,
      createdAt: toIso(message.createdAt),
      text: message.content
    }));
  }
  mapProgress(sessionId, runId, branchId, workstreamId) {
    return taskBoard.listTasks(sessionId, runId).map((task, index) => ({
      id: task.taskId,
      sessionId,
      workstreamId,
      branchId,
      title: task.title,
      status: progressStatusFromTask(task),
      order: index,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      source: task.source === "plan" ? "plan" : "runtime",
      linkedEventIds: task.evidenceRefs,
      blockerSummary: task.blockerRefs.join(", ") || void 0
    }));
  }
  mapArtifacts(sessionId, runId, branchId, workstreamId, runEvents) {
    const registered = artifactStore.list(sessionId, runId).map((record) => ({
      id: record.artifactId,
      sessionId,
      workstreamId,
      branchId,
      sourceEventId: record.evidenceIds[0],
      type: artifactTypeFromRecord(record),
      status: "ready",
      displayName: record.title,
      taskTitle: record.taskId,
      path: record.filePath,
      rawRef: `artifact:${record.artifactId}`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }));
    const reportEvents = runEvents.filter((event) => event.event_type === "report_published");
    const reports = reportEvents.flatMap((event) => {
      const records = [];
      for (const key of ["markdownPath", "htmlPath", "jsonPath"]) {
        const value = event.payload[key];
        if (typeof value !== "string" || !value.trim()) {
          continue;
        }
        records.push({
          id: `${event.event_id}-${key}`,
          sessionId,
          workstreamId,
          branchId,
          sourceEventId: event.event_id,
          type: key === "htmlPath" ? "visual_report" : "report",
          status: "ready",
          displayName: value.split(/[\\/]/).filter(Boolean).pop() || value,
          taskTitle: "Execution Report",
          path: value,
          rawRef: `raw-${event.event_id}`,
          createdAt: toIso(event.ts_ms),
          updatedAt: toIso(event.ts_ms)
        });
      }
      return records;
    });
    return [...registered, ...reports];
  }
  mapContext(sessionId, runId, branchId, workstreamId, run) {
    const packets = contextService.listContextPackets(sessionId, runId);
    const captureContext = run.captures.map((capture) => ({
      id: `context-capture-${capture.id}`,
      sessionId,
      workstreamId,
      branchId,
      kind: "capture",
      label: capture.filePath.split(/[\\/]/).filter(Boolean).pop() || capture.filePath,
      summary: capture.filePath,
      importance: "decisive",
      firstObservedAt: toIso(run.startedAt),
      lastObservedAt: toIso(run.finishedAt ?? run.startedAt),
      detailsRef: capture.filePath
    }));
    const packetContext = packets.map((packet) => ({
      id: `context-${packet.packetId}`,
      sessionId,
      workstreamId,
      branchId,
      kind: packet.kind === "capture" ? "capture" : packet.kind === "tool_result" ? "source" : "file",
      label: packet.title,
      summary: packet.summary,
      importance: packet.evidenceIds.length > 0 ? "cited" : packet.kind === "plan" ? "important" : "normal",
      firstObservedAt: packet.createdAt,
      lastObservedAt: packet.createdAt,
      sourceEventIds: packet.evidenceIds,
      artifactIds: packet.artifactIds,
      detailsRef: packet.refs[0]
    }));
    const capabilityContext = contextService.readPlanContract(sessionId, runId)?.capabilityProfiles.map((profile) => ({
      id: `context-capability-${profile.profileId}`,
      sessionId,
      workstreamId,
      branchId,
      kind: "capability",
      label: profile.owner,
      summary: profile.toolNames.slice(0, 4).join(", "),
      importance: "important",
      firstObservedAt: profile.createdAt,
      lastObservedAt: profile.updatedAt,
      detailsRef: profile.profileId
    })) ?? [];
    return [...captureContext, ...packetContext, ...capabilityContext];
  }
  toTaskViewModel(session, workstream, forceCompact = false) {
    const result = workstream.result ? {
      ...workstream.result,
      artifacts: session.artifacts.filter((artifact) => workstream.result?.artifactIds.includes(artifact.id))
    } : void 0;
    const density = forceCompact ? "compact" : workstream.density;
    let thinkingDurationMs;
    const firstThinking = workstream.processEvents.find((e) => e.kind === "agent.text");
    if (firstThinking && workstream.completedAt) {
      const start = Date.parse(firstThinking.createdAt);
      const end = Date.parse(workstream.completedAt);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        thinkingDurationMs = end - start;
      }
    }
    return {
      kind: "task_workstream",
      id: workstream.id,
      type: workstream.type,
      status: workstream.status,
      density,
      title: this.titleForWorkstream(workstream),
      startedAt: workstream.startedAt,
      completedAt: workstream.completedAt,
      process: {
        collapsed: workstream.status === "completed" || density === "compact",
        items: this.toProcessItems(workstream.processEvents),
        thinkingDurationMs
      },
      result,
      planId: workstream.planId,
      planStatus: workstream.planStatus
    };
  }
  toProcessItems(events2) {
    const items = [];
    let textBuffer = [];
    const flushText = () => {
      if (textBuffer.length === 0) {
        return;
      }
      const first = textBuffer[0];
      items.push({
        kind: "agent_thinking",
        id: `thinking-${first.id}`,
        createdAt: first.createdAt,
        text: textBuffer.map((event) => event.text).filter(Boolean).join("\n\n")
      });
      textBuffer = [];
    };
    for (const event of events2) {
      if (event.kind === "agent.text") {
        textBuffer.push(event);
        continue;
      }
      flushText();
      if (event.kind === "tool") {
        items.push({
          kind: "tool_row",
          id: event.id,
          createdAt: event.createdAt,
          completedAt: event.completedAt,
          status: event.status,
          title: event.title,
          summary: event.summary,
          target: event.target,
          durationMs: event.durationMs,
          taskId: event.taskId,
          artifactIds: event.artifactIds ?? [],
          rawTraceRef: event.rawTraceRef,
          inputRef: event.inputRef,
          outputRef: event.outputRef,
          errorSummary: event.errorSummary
        });
        continue;
      }
      if (event.kind === "subagent") {
        items.push({
          kind: "subagent_row",
          id: event.id,
          createdAt: event.createdAt,
          completedAt: event.completedAt,
          status: event.status,
          label: event.label,
          summary: event.summary,
          resultSummary: event.resultSummary,
          taskId: event.taskId,
          nestedWorkstream: event.nestedWorkstream,
          rawTraceRef: event.rawTraceRef
        });
      }
    }
    flushText();
    return items;
  }
  buildRightPanel(session, activeWorkstreams) {
    const activeWorkstreamIds = new Set(activeWorkstreams.map((workstream) => workstream.id));
    const progress = {
      current: session.progress.filter((task) => activeWorkstreamIds.has(task.workstreamId) && ["running", "blocked", "pending", "reopened"].includes(task.status)).sort((left, right) => left.order - right.order),
      history: session.progress.filter((task) => activeWorkstreamIds.has(task.workstreamId) && ["completed", "cancelled"].includes(task.status)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
    const artifacts = {
      current: session.artifacts.filter((artifact) => activeWorkstreamIds.has(artifact.workstreamId)).slice(-6),
      previous: session.artifacts.filter((artifact) => !activeWorkstreamIds.has(artifact.workstreamId))
    };
    const contextGroups = ["capture", "file", "source", "capability"].map((kind) => {
      const all = session.context.filter((record) => record.kind === kind);
      return {
        kind,
        important: all.filter((record) => record.importance !== "normal"),
        all
      };
    });
    return {
      progress,
      artifacts,
      context: { groups: contextGroups }
    };
  }
  promptForWorkstream(session, workstream) {
    for (const request of session.userRequests) {
      const revision = request.revisions.find((entry) => entry.resultingWorkstreamIds.includes(workstream.id));
      if (!revision) {
        continue;
      }
      const group = session.branches.find((entry) => entry.rootRequestId === request.id);
      const branchIndex = Math.max(group?.branches.findIndex((branch) => branch.id === revision.branchId) ?? 0, 0);
      const branchCount = group?.branches.length ?? 1;
      return {
        kind: "user_prompt",
        id: `prompt-${revision.id}`,
        branchId: revision.branchId,
        requestId: request.id,
        revisionId: revision.id,
        prompt: revision.prompt,
        createdAt: revision.createdAt,
        branchIndex,
        branchCount,
        canCopy: true,
        canEdit: true
      };
    }
    return void 0;
  }
  buildPromptBranchNavigator(session, requestId, currentBranchId) {
    const group = session.branches.find((entry) => entry.rootRequestId === requestId);
    if (!group || group.branches.length <= 1) {
      return null;
    }
    return {
      activeBranchId: session.activeBranchId,
      branchIndex: Math.max(group.branches.findIndex((branch) => branch.id === currentBranchId), 0),
      branchCount: group.branches.length,
      branches: group.branches
    };
  }
  titleForWorkstream(_workstream) {
    return "";
  }
  shouldShowExecutionWorkstream(run, approvalState, events2) {
    return approvalState === "approved" || ["running", "stopping", "completed", "failed", "cancelled", "interrupted"].includes(run.status) || events2.some((event) => ["dispatch", "agent_summary", "verification", "report_published"].includes(event.event_type));
  }
  groupAskTurns(messages) {
    const groups = /* @__PURE__ */ new Map();
    for (const message of messages) {
      const turnId = message.turnId || message.id;
      const group = groups.get(turnId) ?? {
        turnId,
        createdAt: message.createdAt,
        completedAt: message.updatedAt ?? message.createdAt,
        messages: [],
        assistantMessages: []
      };
      group.createdAt = Math.min(group.createdAt, message.createdAt);
      group.completedAt = Math.max(group.completedAt, message.updatedAt ?? message.createdAt);
      group.messages.push(message);
      if (message.role === "user" && (!group.userMessage || message.createdAt < group.userMessage.createdAt)) {
        group.userMessage = message;
      }
      if (message.role === "assistant") {
        group.assistantMessages.push(message);
      }
      groups.set(turnId, group);
    }
    return Array.from(groups.values()).map((group) => ({
      ...group,
      messages: group.messages.slice().sort((left, right) => left.createdAt - right.createdAt),
      assistantMessages: group.assistantMessages.slice().sort((left, right) => left.createdAt - right.createdAt)
    })).sort((left, right) => left.createdAt - right.createdAt);
  }
  branchIdForWorkstream(groups, workstreamId, fallback) {
    for (const group of groups) {
      const branch = group.branches.find((entry) => entry.workstreamIds.includes(workstreamId));
      if (branch) {
        return branch.id;
      }
    }
    return fallback || "branch-main";
  }
  revisionIdForBranch(branchId) {
    return branchId.startsWith("branch-") ? branchId.replace(/^branch-/, "revision-") : void 0;
  }
  planWorkstreamId(runId) {
    return `ws-${runId}-plan`;
  }
  executionWorkstreamId(runId) {
    return `ws-${runId}-execution`;
  }
}
const agentWorkstreamProjector = new AgentWorkstreamProjector();
const KNOWN_AGENT_ROLES = /* @__PURE__ */ new Set([
  "rdc-debugger",
  "triage_agent",
  "capture_repro_agent",
  "pass_graph_pipeline_agent",
  "pixel_forensics_agent",
  "shader_ir_agent",
  "driver_device_agent",
  "skeptic_agent",
  "curator_agent"
]);
function latestStageHistory(events2) {
  return events2.filter((event) => event.event_type === "workflow_stage_transition").map((event) => normalizeWorkflowStage(String(event.payload.toStage || "preflight")));
}
function dedupeBlockers(blockers) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const blocker of blockers) {
    const key = `${blocker.code}:${blocker.reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(blocker);
  }
  return result;
}
function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}
function toConfidence(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function toRecommendedSpecialists(value, fallback) {
  const parsed = toStringArray(value).filter((entry) => KNOWN_AGENT_ROLES.has(entry));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}
const ASK_USER_TOOL_NAME = "ui.ask_user_question";
const buildAskUserQuestionTraceQuestions = (prompt) => prompt.questions.map((question) => ({
  questionId: question.id,
  prompt: question.prompt,
  recommendedOptionId: question.recommendedOptionId,
  options: question.options.map((option) => ({
    optionId: option.id,
    label: option.label,
    description: option.description
  })),
  freeformPlaceholder: question.freeformPlaceholder
}));
const buildAskUserAnswerSummary = (prompt, answers) => {
  if (!prompt) {
    return `已回答 ${answers.length} 个问题。`;
  }
  const lines = answers.map((answer) => {
    const question = prompt.questions.find((entry) => entry.id === answer.questionId);
    const option = question?.options.find((entry) => entry.id === answer.selectedOptionId);
    const value = answer.freeformText?.trim() || option?.label || answer.selectedOptionId || "未选择";
    return question ? `${question.prompt} -> ${value}` : `${answer.questionId} -> ${value}`;
  });
  return lines.length > 0 ? `已回答 ${lines.length} 个问题：
${lines.join("\n")}` : "用户未提供回答。";
};
class DebugWorkflowService {
  async startPlan(request) {
    try {
      const resolved = intakeContextResolver.resolve(request);
      const caseId = request.sessionId || await storageAdapter.createCase({
        caseId: request.sessionId,
        projectId: request.projectId,
        userGoal: resolved.goalText,
        symptomSummary: resolved.goalText
      });
      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        turnId: request.turnId,
        capturePaths: resolved.captures.map((capture) => capture.filePath),
        mode: request.mode,
        goal: resolved.goalText,
        captures: resolved.captures,
        backend: resolved.backend,
        status: "planning"
      });
      debuggerLlmService.resetRunSummary(runId);
      const basePlan = planBuilder.build(resolved);
      let debugPlan = basePlan.debugPlan;
      let pendingQuestions = basePlan.pendingQuestions;
      const blockers = [...basePlan.blockers];
      if (blockers.length === 0) {
        blockers.push(...debuggerLlmService.getRouteBlockers(
          this.getRequiredRouteAgents(debugPlan, resolved.backend),
          "plan"
        ));
      }
      if (blockers.length === 0) {
        try {
          debugPlan = await this.generatePlanWithLlm({
            sessionId,
            runId,
            resolvedGoal: resolved.goalText,
            basePlan: debugPlan
          });
          blockers.push(...debuggerLlmService.getRouteBlockers(
            this.getRequiredRouteAgents(debugPlan, resolved.backend),
            "plan"
          ));
        } catch (error) {
          blockers.push(this.normalizeLlmBlocker(error, BLOCKER_CODES.BLOCKED_LLM_REQUEST_FAILED.code));
        }
      }
      debugPlan = {
        ...debugPlan,
        blockers: dedupeBlockers([...debugPlan.blockers, ...blockers]),
        strictReady: Boolean(debugPlan.targetCapture) && dedupeBlockers([...debugPlan.blockers, ...blockers]).length === 0 && !pendingQuestions,
        planReadiness: blockers.length > 0 ? "blocked" : pendingQuestions ? "needs_user_input" : "strict_ready",
        updatedAt: nowIso$1()
      };
      const approvalState = debugPlan.strictReady ? "pending_user" : "not_requested";
      storageAdapter.writePlanSnapshot(sessionId, runId, {
        debug_plan: debugPlan,
        pending_questions: pendingQuestions,
        approval_state: approvalState,
        intake_context: resolved.intakeContext
      });
      this.seedHarnessPlan({
        sessionId,
        runId,
        mode: request.mode,
        captures: resolved.captures,
        debugPlan,
        pendingQuestions
      });
      await storageAdapter.updateRun(sessionId, runId, {
        status: blockers.length > 0 ? "failed" : pendingQuestions ? "awaiting_input" : "awaiting_approval",
        lastStage: blockers.length > 0 ? "plan" : pendingQuestions ? "awaiting_user_input" : "plan",
        runtime: {
          workflow_stage: blockers.length > 0 ? "plan" : pendingQuestions ? "awaiting_user_input" : "plan"
        }
      });
      await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId,
        agentId: "rdc-debugger",
        eventType: "user_message",
        status: "ok",
        payload: {
          role: "user",
          content: resolved.goalText,
          source: resolved.taskFilePath ? "task_file" : "prompt"
        }
      }));
      for (const [fromStage, toStage] of [
        ["preflight", "entry_gate"],
        ["entry_gate", "intake_gate"],
        ["intake_gate", "plan"]
      ]) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "workflow_stage_transition",
          status: "ok",
          payload: {
            fromStage,
            toStage
          }
        }));
      }
      if (pendingQuestions) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "tool_execution",
          status: "sent",
          payload: {
            tool_name: ASK_USER_TOOL_NAME,
            phase: "request",
            prompt_id: pendingQuestions.promptId,
            title: pendingQuestions.title,
            summary: pendingQuestions.summary,
            question_count: pendingQuestions.questions.length,
            questions: buildAskUserQuestionTraceQuestions(pendingQuestions)
          }
        }));
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "blocker",
          status: "blocked",
          payload: {
            code: "ASK_USER_REQUIRED",
            reason: "Plan requires structured user answers before execution can start.",
            prompt_id: pendingQuestions.promptId
          }
        }));
      }
      for (const blocker of blockers) {
        await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId,
          agentId: "rdc-debugger",
          eventType: "blocker",
          status: "blocked",
          payload: {
            code: blocker.code,
            reason: blocker.reason,
            refs: blocker.refs
          }
        }));
      }
      this.emitWorkflowState(await this.getWorkflowState(sessionId, runId));
      return {
        success: true,
        runId,
        sessionId,
        caseId,
        currentStage: blockers.length > 0 ? "plan" : pendingQuestions ? "awaiting_user_input" : "plan",
        status: blockers.length > 0 ? "failed" : pendingQuestions ? "awaiting_input" : "awaiting_approval",
        planStatus: debugPlan.planReadiness,
        pendingQuestions,
        debugPlanSummary: debugPlan
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  async getPlan(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: snapshot?.debug_plan ?? null,
      pendingQuestions: snapshot?.pending_questions ?? null,
      approvalState: snapshot?.approval_state ?? "not_requested"
    };
  }
  async submitQuestions(runId, answers) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: "No plan snapshot available." };
    }
    const pendingQuestionsBeforeSubmit = snapshot.pending_questions;
    const nextPlan = {
      ...snapshot.debug_plan,
      updatedAt: nowIso$1(),
      blockers: snapshot.debug_plan.blockers.filter((blocker) => blocker.code !== "ASK_USER_REQUIRED")
    };
    for (const answer of answers) {
      if (answer.questionId !== "target_capture") {
        continue;
      }
      const projectInputs = storageAdapter.listProjectInputs(location.session.projectId);
      const matchedInput = projectInputs.find((input) => input.inputId === answer.selectedOptionId || input.fileName === answer.freeformText?.trim());
      if (matchedInput) {
        nextPlan.targetCapture = {
          captureId: matchedInput.inputId,
          fileName: matchedInput.fileName,
          filePath: matchedInput.filePath
        };
        nextPlan.missingInfo = nextPlan.missingInfo.filter((item) => item !== "target_capture");
      }
    }
    nextPlan.blockers = dedupeBlockers([
      ...nextPlan.blockers,
      ...debuggerLlmService.getRouteBlockers(
        this.getRequiredRouteAgents(nextPlan, location.run.backend),
        "plan"
      )
    ]);
    nextPlan.strictReady = Boolean(nextPlan.targetCapture) && nextPlan.blockers.length === 0;
    nextPlan.planReadiness = nextPlan.blockers.length > 0 ? "blocked" : nextPlan.strictReady ? "strict_ready" : "needs_user_input";
    nextPlan.presentation = buildDebugPlanPresentation(nextPlan);
    const previousBlockerKeys = new Set(snapshot.debug_plan.blockers.map((blocker) => `${blocker.code}:${blocker.reason}`));
    const newBlockers = nextPlan.blockers.filter((blocker) => !previousBlockerKeys.has(`${blocker.code}:${blocker.reason}`));
    const nextStatus = nextPlan.blockers.length > 0 ? "failed" : nextPlan.strictReady ? "awaiting_approval" : "awaiting_input";
    const nextStage = nextPlan.blockers.length > 0 || nextPlan.strictReady ? "plan" : "awaiting_user_input";
    storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
      ...snapshot,
      debug_plan: nextPlan,
      pending_questions: nextPlan.strictReady || nextPlan.blockers.length > 0 ? null : snapshot.pending_questions,
      approval_state: nextPlan.blockers.length > 0 ? "not_requested" : nextPlan.strictReady ? "pending_user" : snapshot.approval_state
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: nextStatus,
      lastStage: nextStage,
      runtime: {
        workflow_stage: nextStage
      }
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "user_message",
      status: "ok",
      payload: {
        role: "user",
        content: JSON.stringify(answers),
        source: "ask_user_answers"
      }
    }));
    if (pendingQuestionsBeforeSubmit) {
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "tool_execution",
        status: "completed",
        payload: {
          tool_name: ASK_USER_TOOL_NAME,
          phase: "answer",
          prompt_id: pendingQuestionsBeforeSubmit.promptId,
          title: pendingQuestionsBeforeSubmit.title,
          summary: pendingQuestionsBeforeSubmit.summary,
          question_count: pendingQuestionsBeforeSubmit.questions.length,
          questions: buildAskUserQuestionTraceQuestions(pendingQuestionsBeforeSubmit),
          answers,
          answerSummary: buildAskUserAnswerSummary(pendingQuestionsBeforeSubmit, answers)
        }
      }));
    }
    for (const blocker of newBlockers) {
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "blocker",
        status: "blocked",
        payload: {
          code: blocker.code,
          reason: blocker.reason,
          refs: blocker.refs
        }
      }));
    }
    this.emitRunStatus(location.session.sessionId, runId, nextStatus, nextStage);
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      runId,
      nextPlan.strictReady ? "收到，执行前置条件已经补齐。你现在可以批准这份计划，我再进入正式调试。" : nextPlan.blockers.length > 0 ? nextPlan.blockers[0]?.reason || "当前还不能进入正式调试。" : "收到，我已经更新了计划输入，不过还需要你继续补全剩余信息。"
    );
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: nextPlan,
      pendingQuestions: nextPlan.strictReady || nextPlan.blockers.length > 0 ? null : snapshot.pending_questions,
      approvalState: nextPlan.blockers.length > 0 ? "not_requested" : nextPlan.strictReady ? "pending_user" : snapshot.approval_state
    };
  }
  async approvePlan(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: "No plan snapshot available." };
    }
    if (!snapshot.debug_plan.strictReady) {
      return { success: false, error: "Plan is not strict ready." };
    }
    const routeBlockers = debuggerLlmService.getRouteBlockers(
      this.getRequiredRouteAgents(snapshot.debug_plan, location.run.backend),
      "dispatch"
    );
    if (routeBlockers.length > 0) {
      const blockedPlan = {
        ...snapshot.debug_plan,
        blockers: dedupeBlockers([...snapshot.debug_plan.blockers, ...routeBlockers]),
        strictReady: false,
        planReadiness: "blocked",
        updatedAt: nowIso$1()
      };
      storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
        ...snapshot,
        debug_plan: blockedPlan,
        approval_state: "not_requested"
      });
      for (const blocker of routeBlockers) {
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId,
          sessionId: location.session.sessionId,
          agentId: "rdc-debugger",
          eventType: "blocker",
          status: "blocked",
          payload: {
            code: blocker.code,
            reason: blocker.reason,
            refs: blocker.refs
          }
        }));
      }
      await storageAdapter.updateRun(location.session.sessionId, runId, {
        status: "failed",
        lastStage: "plan",
        runtime: {
          workflow_stage: "plan"
        }
      });
      this.emitRunStatus(location.session.sessionId, runId, "failed", "plan");
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
      return {
        success: false,
        error: routeBlockers.map((blocker) => blocker.reason).join(" | "),
        debugPlan: blockedPlan,
        approvalState: "not_requested"
      };
    }
    storageAdapter.writePlanSnapshot(location.session.sessionId, runId, {
      ...snapshot,
      approval_state: "approved",
      pending_questions: null
    });
    workstreamStateStore.markPlan(location.session.sessionId, snapshot.debug_plan.planId, "accepted");
    this.applyTaskMutation(location.session.sessionId, runId, "plan", "completed", "User approved the Debugger plan.");
    this.applyTaskMutation(location.session.sessionId, runId, "speclist", "in_progress", "Task breakdown started after plan approval.");
    contextService.writeRunCapsule(location.session.sessionId, runId);
    await this.appendUserConversationMessage(
      location.session.sessionId,
      runId,
      "同意执行"
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "user",
      eventType: "user_confirmation",
      status: "ok",
      payload: {
        planId: snapshot.debug_plan.planId,
        label: "同意执行"
      }
    }));
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "workflow_stage_transition",
      status: "ok",
      payload: {
        fromStage: "plan",
        toStage: "dispatch"
      }
    }));
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: "running",
      lastStage: "dispatch",
      runtime: {
        workflow_stage: "dispatch"
      }
    });
    this.emitRunStatus(location.session.sessionId, runId, "running", "dispatch");
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      runId,
      "计划已批准，我现在开始正式调试，并按证据链推进后续分析。"
    );
    runExecutionService.startRun({
      runId,
      sessionId: location.session.sessionId,
      projectId: location.run.projectId
    }, (signal) => this.executeApprovedRun(location, snapshot.debug_plan, signal));
    return {
      success: true,
      runId,
      sessionId: location.session.sessionId,
      debugPlan: snapshot.debug_plan,
      pendingQuestions: null,
      approvalState: "approved"
    };
  }
  async getWorkstreamSession(sessionId) {
    return agentWorkstreamProjector.getSession(sessionId);
  }
  async requestPlanRevision(runId, revisionText) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const trimmedRevision = revisionText.trim();
    if (!trimmedRevision) {
      return { success: false, error: "Revision text is required." };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan) {
      return { success: false, error: "No plan snapshot available." };
    }
    const previousPlanId = snapshot.debug_plan.planId;
    const { runId: nextRunId, sessionId } = await storageAdapter.createRun({
      caseId: location.session.sessionId,
      turnId: location.run.turnId,
      capturePaths: location.run.captures.map((capture) => capture.filePath),
      mode: location.run.mode,
      goal: `${location.run.goal}

修改建议：${trimmedRevision}`,
      captures: location.run.captures,
      backend: location.run.backend,
      status: "awaiting_approval"
    });
    const nextPlan = {
      ...snapshot.debug_plan,
      planId: generateEventId("plan"),
      userGoal: `${snapshot.debug_plan.userGoal}

修改建议：${trimmedRevision}`,
      notes: [...snapshot.debug_plan.notes, `用户修改建议：${trimmedRevision}`],
      presentation: buildDebugPlanPresentation({
        ...snapshot.debug_plan,
        userGoal: `${snapshot.debug_plan.userGoal}

修改建议：${trimmedRevision}`,
        notes: [...snapshot.debug_plan.notes, `用户修改建议：${trimmedRevision}`]
      }),
      createdAt: nowIso$1(),
      updatedAt: nowIso$1()
    };
    workstreamStateStore.createRevision({
      sessionId,
      runId: nextRunId,
      previousPlanId,
      revisionText: trimmedRevision,
      revisionWorkstreamId: `ws-${nextRunId}-plan`
    });
    storageAdapter.writePlanSnapshot(sessionId, nextRunId, {
      ...snapshot,
      debug_plan: nextPlan,
      pending_questions: null,
      approval_state: "pending_user"
    });
    this.seedHarnessPlan({
      sessionId,
      runId: nextRunId,
      mode: location.run.mode,
      captures: location.run.captures,
      debugPlan: nextPlan,
      pendingQuestions: null
    });
    workstreamStateStore.registerPlan({
      sessionId,
      runId: nextRunId,
      planId: nextPlan.planId,
      workstreamId: `ws-${nextRunId}-plan`,
      status: "awaiting_approval"
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: "interrupted",
      stopReason: "Plan revision requested",
      stoppedAt: Date.now(),
      finishedAt: Date.now()
    });
    await storageAdapter.updateRun(sessionId, nextRunId, {
      status: "awaiting_approval",
      lastStage: "plan",
      runtime: {
        workflow_stage: "plan"
      }
    });
    await this.appendUserConversationMessage(
      location.session.sessionId,
      runId,
      `修改建议：${trimmedRevision}`
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "user",
      eventType: "user_revision_requested",
      status: "ok",
      payload: {
        planId: previousPlanId,
        prompt: trimmedRevision,
        nextRunId,
        nextPlanId: nextPlan.planId
      }
    }));
    await this.appendActionEvent(sessionId, storageAdapter.createActionEvent({
      runId: nextRunId,
      sessionId,
      agentId: "rdc-debugger",
      eventType: "user_message",
      status: "ok",
      payload: {
        role: "user",
        content: trimmedRevision,
        source: "plan_revision",
        previousPlanId
      }
    }));
    await this.appendAssistantConversationMessage(
      sessionId,
      nextRunId,
      "我已根据修改建议生成新的计划，请重新确认后再进入正式执行。"
    );
    this.emitRunStatus(location.session.sessionId, runId, "interrupted", location.run.lastStage, "Plan revision requested");
    this.emitRunStatus(sessionId, nextRunId, "awaiting_approval", "plan");
    this.emitWorkflowState(await this.getWorkflowState(sessionId, nextRunId));
    const workstream = await this.getWorkstreamSession(sessionId);
    return {
      ...workstream,
      runId: nextRunId,
      planId: nextPlan.planId,
      branchId: workstream.session?.activeBranchId
    };
  }
  async switchWorkstreamBranch(sessionId, branchId) {
    workstreamStateStore.switchBranch(sessionId, branchId);
    const workstream = await this.getWorkstreamSession(sessionId);
    return {
      ...workstream,
      activeBranchId: workstream.session?.activeBranchId
    };
  }
  async exportWorkstreamSession(sessionId, options = {}) {
    try {
      const session = storageAdapter.readSession(sessionId);
      if (!session) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      const workstream = await this.getWorkstreamSession(sessionId);
      if (!workstream.success) {
        return { success: false, error: workstream.error };
      }
      const exportDir = path.join(session.sessionPath, "exports");
      fs__namespace.mkdirSync(exportDir, { recursive: true });
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const summaryPath = path.join(exportDir, `agent-workstream-summary-${stamp}.json`);
      fs__namespace.writeFileSync(summaryPath, JSON.stringify({
        schemaVersion: "1",
        exportedAt: nowIso$1(),
        includeAllBranches: options.includeAllBranches ?? true,
        session: workstream.session,
        presentation: workstream.presentation
      }, null, 2), "utf-8");
      let rawTracePath;
      if (options.includeRawTrace !== false) {
        rawTracePath = path.join(exportDir, `agent-workstream-raw-trace-${stamp}.jsonl`);
        const events2 = await storageAdapter.readActionChain(sessionId);
        fs__namespace.writeFileSync(rawTracePath, `${events2.map((event) => JSON.stringify(event)).join("\n")}
`, "utf-8");
      }
      return {
        success: true,
        sessionId,
        summaryPath,
        rawTracePath,
        bundlePath: summaryPath
      };
    } catch (error) {
      return { success: false, sessionId, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async restartRun(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const snapshot = storageAdapter.readPlanSnapshot(location.session.sessionId, runId);
    if (!snapshot?.debug_plan?.strictReady) {
      return { success: false, error: "Cannot restart without a strict-ready plan." };
    }
    const { runId: nextRunId, sessionId } = await storageAdapter.createRun({
      caseId: location.session.sessionId,
      capturePaths: location.run.captures.map((capture) => capture.filePath),
      mode: location.run.mode,
      goal: location.run.goal,
      captures: location.run.captures,
      backend: location.run.backend,
      status: "awaiting_approval"
    });
    storageAdapter.writePlanSnapshot(sessionId, nextRunId, {
      ...snapshot,
      approval_state: "pending_user",
      pending_questions: null,
      debug_plan: {
        ...snapshot.debug_plan,
        updatedAt: nowIso$1()
      }
    });
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: "interrupted",
      stopReason: "Restarted from stale run",
      stoppedAt: Date.now(),
      finishedAt: Date.now()
    });
    this.emitWorkflowState(await this.getWorkflowState(sessionId, nextRunId));
    await this.appendAssistantConversationMessage(
      sessionId,
      nextRunId,
      "我已经为你重建了一次可继续的调试运行。确认计划后，我会从新的 run 继续推进。"
    );
    return {
      success: true,
      runId: nextRunId,
      sessionId,
      debugPlan: snapshot.debug_plan,
      pendingQuestions: null,
      approvalState: "pending_user"
    };
  }
  async stopRun(runId) {
    const location = this.findRun(runId);
    if (!location) {
      return { success: false, error: `Run not found: ${runId}` };
    }
    const active = runExecutionService.stopRun(runId);
    toolBridge.abortRun(runId);
    await rdxSessionService.closeOrReplaceOpenedCapture();
    await storageAdapter.updateRun(location.session.sessionId, runId, {
      status: active && process.env.RDC_AGENT_TEST_MODE !== "1" ? "stopping" : "cancelled",
      stopReason: "Stopped by user",
      stoppedAt: Date.now(),
      finishedAt: active && process.env.RDC_AGENT_TEST_MODE !== "1" ? void 0 : Date.now()
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "blocker",
      status: "warning",
      payload: {
        code: "RUN_STOPPED",
        reason: "Run stopped by user request."
      }
    }));
    this.emitRunStatus(
      location.session.sessionId,
      runId,
      active && process.env.RDC_AGENT_TEST_MODE !== "1" ? "stopping" : "cancelled",
      location.run.lastStage,
      "Stopped by user"
    );
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, runId));
    return { success: true };
  }
  async getWorkflowState(sessionId, runId) {
    const run = runId ? storageAdapter.listRuns(sessionId).find((entry) => entry.runId === runId) || null : storageAdapter.getLatestRun(sessionId);
    if (!run) {
      return {
        caseId: sessionId,
        runId: "",
        sessionId,
        currentStage: "preflight",
        previousStages: [],
        entryMode: "cli",
        backend: "local",
        orchestrationMode: "multi_agent",
        coordinationMode: "staged_handoff",
        blockers: [],
        lastUpdated: nowIso$1()
      };
    }
    const events2 = await storageAdapter.readActionChain(sessionId);
    const runEvents = events2.filter((event) => event.run_id === run.runId);
    const snapshot = storageAdapter.readPlanSnapshot(sessionId, run.runId);
    const blockers = runEvents.filter((event) => event.event_type === "blocker").map((event) => ({
      code: String(event.payload.code || "BLOCKER"),
      reason: String(event.payload.reason || event.payload.message || "Blocker"),
      refs: Array.isArray(event.payload.refs) ? event.payload.refs.map(String) : [],
      detectedAt: new Date(event.ts_ms).toISOString()
    }));
    const reasoningSummaries = runEvents.filter((event) => event.event_type === "agent_summary").map((event) => ({
      summaryId: event.event_id,
      stage: normalizeWorkflowStage(String(event.payload.stage || run.lastStage)),
      agentId: String(event.agent_id),
      summary: String(event.payload.summary || event.payload.content || ""),
      evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
      nextStep: String(event.payload.next_step || event.payload.nextStep || ""),
      confidence: typeof event.payload.confidence === "number" ? event.payload.confidence : 0.5,
      createdAt: new Date(event.ts_ms).toISOString()
    }));
    return {
      caseId: run.caseId,
      runId: run.runId,
      sessionId,
      currentStage: normalizeWorkflowStage(run.lastStage),
      previousStages: latestStageHistory(runEvents),
      entryMode: "cli",
      backend: run.backend,
      orchestrationMode: "multi_agent",
      coordinationMode: "staged_handoff",
      blockers,
      planReadiness: snapshot?.debug_plan?.strictReady ? "ready_for_approval" : snapshot?.debug_plan?.planReadiness,
      approvalState: snapshot?.approval_state,
      debugPlan: snapshot?.debug_plan ?? null,
      harnessTasks: taskBoard.listTasks(sessionId, run.runId),
      pendingQuestions: snapshot?.pending_questions ?? null,
      reasoningSummaries,
      recoveryState: run.status === "interrupted" ? {
        recoveredAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : void 0,
        recoveryReason: run.stopReason
      } : null,
      lastUpdated: nowIso$1()
    };
  }
  async recoverInterruptedRuns() {
    const projects = storageAdapter.listProjects();
    for (const project of projects) {
      const sessions = storageAdapter.listSessions(project.projectId);
      for (const session of sessions) {
        const runs = storageAdapter.listRuns(session.sessionId);
        for (const run of runs) {
          if (!["running", "queued", "planning", "stopping"].includes(run.status)) {
            continue;
          }
          if (runExecutionService.listActiveRuns().some((active) => active.runId === run.runId)) {
            continue;
          }
          await storageAdapter.updateRun(session.sessionId, run.runId, {
            status: "interrupted",
            stopReason: "Recovered after app restart",
            stoppedAt: Date.now(),
            finishedAt: Date.now()
          });
          await this.appendActionEvent(session.sessionId, storageAdapter.createActionEvent({
            runId: run.runId,
            sessionId: session.sessionId,
            agentId: "rdc-debugger",
            eventType: "blocker",
            status: "warning",
            payload: {
              code: "STALE_RUN_RECOVERED",
              reason: "Run was marked interrupted during app startup recovery."
            }
          }));
        }
      }
    }
  }
  seedHarnessPlan(input) {
    const now = nowIso$1();
    const tasks = this.createHarnessTasks(input.sessionId, input.runId, input.debugPlan, now);
    for (const task of tasks) {
      taskBoard.upsertTask(input.sessionId, input.runId, task);
    }
    const planContract = {
      schemaVersion: "1",
      planId: input.debugPlan.planId,
      runId: input.runId,
      sessionId: input.sessionId,
      mode: input.mode,
      goal: input.debugPlan.userGoal,
      status: input.pendingQuestions ? "blocked" : input.debugPlan.strictReady ? "ready" : input.debugPlan.blockers.length > 0 ? "blocked" : "pending",
      captures: input.captures ?? [],
      tasks,
      verificationContract: {
        contractId: `${input.debugPlan.planId}-verification`,
        runId: input.runId,
        sessionId: input.sessionId,
        requiredMethods: this.getRequiredVerificationMethods(input.debugPlan),
        targetRefs: [
          input.debugPlan.targetCapture?.captureId,
          input.debugPlan.targetCapture?.filePath,
          input.debugPlan.targetFrameOrEvent?.eventLabel
        ].filter((entry) => Boolean(entry)),
        successCriteria: input.debugPlan.verificationContract.successCriteria,
        evidenceRequirements: [
          input.debugPlan.verificationContract.requiresScreenshotEvidence ? "screenshot" : "",
          input.debugPlan.verificationContract.requiresShaderInspection ? "shader" : "",
          input.debugPlan.verificationContract.requiresPixelEvidence ? "pixel" : "",
          input.debugPlan.verificationContract.requiresBaselineComparison ? "baseline" : ""
        ].filter(Boolean),
        blockerCodes: input.debugPlan.blockers.map((blocker) => blocker.code),
        createdAt: now,
        updatedAt: now
      },
      questionRequests: input.pendingQuestions ? input.pendingQuestions.questions.map((question) => ({
        questionId: question.id,
        runId: input.runId,
        sessionId: input.sessionId,
        prompt: question.prompt,
        reason: input.pendingQuestions.summary,
        options: question.options.map((option) => ({
          optionId: option.id,
          label: option.label,
          description: option.description
        })),
        allowFreeform: Boolean(question.freeformPlaceholder),
        requestedBy: "harness",
        createdAt: input.pendingQuestions.createdAt
      })) : [],
      questionAnswers: [],
      revisions: [],
      capabilityProfiles: [],
      createdAt: now,
      updatedAt: now
    };
    contextService.writePlanContract(input.sessionId, input.runId, planContract);
    contextService.appendContextPacket(input.sessionId, input.runId, {
      packetId: generateEventId("context-packet"),
      runId: input.runId,
      sessionId: input.sessionId,
      kind: "plan",
      source: "harness",
      title: "Debugger plan contract",
      summary: input.debugPlan.scope,
      content: JSON.stringify({
        goal: input.debugPlan.userGoal,
        targetCapture: input.debugPlan.targetCapture,
        targetFrameOrEvent: input.debugPlan.targetFrameOrEvent,
        deliverables: input.debugPlan.expectedDeliverables
      }),
      refs: planContract.verificationContract.targetRefs,
      taskIds: tasks.map((task) => task.taskId),
      evidenceIds: [],
      artifactIds: [],
      createdAt: now
    });
    contextService.writeRunCapsule(input.sessionId, input.runId);
    return planContract;
  }
  createHarnessTasks(sessionId, runId, debugPlan, createdAt) {
    const base = {
      runId,
      sessionId,
      priority: "normal",
      dependsOn: [],
      evidenceRefs: [],
      artifactRefs: [],
      blockerRefs: [],
      source: "plan",
      userApproval: "not_required",
      createdAt,
      updatedAt: createdAt
    };
    return [
      {
        ...base,
        taskId: "plan",
        title: "Plan",
        intent: "context",
        objective: debugPlan.scope,
        status: debugPlan.blockers.length > 0 ? "blocked" : "pending",
        owner: "rdc-debugger",
        stage: "plan",
        acceptanceCriteria: ["Target capture, scope, specialists, deliverables, and verification criteria are explicit."]
      },
      {
        ...base,
        taskId: "speclist",
        title: "Task breakdown",
        intent: "hypothesis",
        objective: "Seed the Debugger task board from the approved plan.",
        status: "pending",
        owner: "rdc-debugger",
        stage: "speclist",
        dependsOn: ["plan"],
        acceptanceCriteria: debugPlan.expectedDeliverables
      },
      {
        ...base,
        taskId: "dispatch",
        title: "Specialist dispatch",
        intent: "investigation",
        objective: `Dispatch ${debugPlan.recommendedSpecialists.length || 1} Debugger investigation lane(s).`,
        status: "pending",
        owner: "rdc-debugger",
        stage: "dispatch",
        dependsOn: ["speclist"],
        acceptanceCriteria: ["Every selected specialist returns an AgentResultCard with evidence references."]
      },
      {
        ...base,
        taskId: "investigate",
        title: "Evidence investigation",
        intent: "investigation",
        objective: debugPlan.targetFrameOrEvent?.eventLabel ?? debugPlan.scope,
        status: "pending",
        owner: "rdc-debugger",
        stage: "investigate",
        dependsOn: ["dispatch"],
        acceptanceCriteria: ["Investigation summary is grounded in EvidenceLedger records."]
      },
      {
        ...base,
        taskId: "fix_verify",
        title: "Verification",
        intent: "verification",
        objective: "Validate the leading finding against the verification contract.",
        status: "pending",
        owner: "skeptic_agent",
        stage: "fix_verify",
        dependsOn: ["investigate"],
        acceptanceCriteria: debugPlan.verificationContract.successCriteria
      },
      {
        ...base,
        taskId: "curate",
        title: "Curation",
        intent: "report",
        objective: "Publish a report bundle grounded in accepted evidence.",
        status: "pending",
        owner: "curator_agent",
        stage: "curate",
        dependsOn: ["fix_verify"],
        acceptanceCriteria: debugPlan.expectedDeliverables
      }
    ];
  }
  getRequiredVerificationMethods(debugPlan) {
    const methods = /* @__PURE__ */ new Set(["tool", "llm_review"]);
    if (debugPlan.verificationContract.requiresScreenshotEvidence) methods.add("screenshot");
    if (debugPlan.verificationContract.requiresPixelEvidence) methods.add("pixel");
    if (debugPlan.verificationContract.requiresShaderInspection) methods.add("shader");
    if (debugPlan.verificationContract.requiresBaselineComparison) methods.add("baseline");
    return Array.from(methods);
  }
  applyTaskMutation(sessionId, runId, taskId, status, reason, refs = {}) {
    const existing = taskBoard.getTask(sessionId, runId, taskId);
    if (!existing) {
      return;
    }
    taskBoard.mutateTask(sessionId, runId, {
      mutationId: generateEventId("task-mutation"),
      taskId,
      runId,
      sessionId,
      type: status === "completed" ? "update_status" : "update_status",
      actor: "harness",
      patch: {
        status,
        evidenceRefs: refs.evidenceRefs ?? existing.evidenceRefs,
        artifactRefs: refs.artifactRefs ?? existing.artifactRefs,
        blockerRefs: refs.blockerRefs ?? existing.blockerRefs,
        completedAt: status === "completed" ? nowIso$1() : existing.completedAt
      },
      reason,
      requiresUserApproval: false,
      createdAt: nowIso$1()
    });
  }
  persistAgentResult(sessionId, runId, result) {
    const artifactIds = result.artifacts.map((artifactPath) => {
      const artifactId = generateEventId("artifact");
      const record = {
        artifactId,
        runId,
        sessionId,
        kind: artifactPath.toLowerCase().endsWith(".png") ? "screenshot" : "data",
        title: `${result.agentId} artifact`,
        filePath: artifactPath,
        mimeType: artifactPath.toLowerCase().endsWith(".png") ? "image/png" : "application/json",
        sizeBytes: 0,
        taskId: "dispatch",
        evidenceIds: [],
        metadata: {
          agentId: result.agentId
        },
        createdAt: nowIso$1(),
        updatedAt: nowIso$1()
      };
      artifactStore.register(sessionId, runId, record);
      return artifactId;
    });
    const evidenceId = generateEventId("evidence");
    const evidenceRecord = {
      evidenceId,
      runId,
      sessionId,
      kind: "analysis",
      title: `${result.agentId} finding`,
      summary: result.reasoningSummary.summary,
      refs: result.reasoningSummary.evidence,
      taskId: "dispatch",
      agentId: result.agentId,
      artifactIds,
      strength: result.reasoningSummary.confidence >= 0.75 ? "strong" : "supporting",
      metadata: {
        nextStep: result.reasoningSummary.nextStep,
        confidence: result.reasoningSummary.confidence
      },
      createdAt: nowIso$1()
    };
    evidenceLedger.appendEvidence(sessionId, runId, evidenceRecord);
    const card = {
      cardId: generateEventId("agent-card"),
      runId,
      sessionId,
      agentId: result.agentId,
      taskId: "dispatch",
      status: "completed",
      summary: result.reasoningSummary.summary,
      evidenceIds: [evidenceId],
      artifactIds,
      verificationResultIds: [],
      nextActions: [result.reasoningSummary.nextStep].filter(Boolean),
      createdAt: nowIso$1(),
      updatedAt: nowIso$1()
    };
    const storedCard = contextService.appendAgentResultCard(sessionId, runId, card);
    contextService.writeRunCapsule(sessionId, runId);
    return storedCard;
  }
  persistVerificationResult(sessionId, runId, debugPlan, verification, skeptic, evidenceIds) {
    const rejected = skeptic.payload.verdict === "rejected";
    const verificationResult = {
      resultId: generateEventId("verification"),
      contractId: `${debugPlan.planId}-verification`,
      runId,
      sessionId,
      status: rejected ? "failed" : verification.status === "ok" ? "passed" : "inconclusive",
      proposedRoute: rejected ? "generator" : "curator",
      method: "llm_review",
      summary: String(skeptic.payload.summary || verification.payload.summary || ""),
      failedCriteria: rejected ? debugPlan.verificationContract.successCriteria : [],
      evidenceGaps: rejected ? ["Verifier rejected the available evidence chain."] : [],
      rejectedClaims: rejected ? [String(verification.payload.summary || "Rejected verification claim")] : [],
      taskMutations: rejected ? [{
        mutationId: generateEventId("task-mutation"),
        taskId: "fix_verify",
        runId,
        sessionId,
        type: "update_status",
        actor: "skeptic_agent",
        patch: {
          status: "blocked",
          blockerRefs: ["SKEPTIC_REJECTED"]
        },
        reason: String(skeptic.payload.summary || "Skeptic rejected the evidence chain."),
        requiresUserApproval: false,
        createdAt: nowIso$1()
      }] : [],
      evidenceIds,
      artifactIds: [],
      blockers: rejected ? ["SKEPTIC_REJECTED"] : [],
      confidence: rejected ? 0.35 : verification.status === "ok" ? 0.82 : 0.64,
      loopCount: 0,
      createdAt: nowIso$1()
    };
    evidenceLedger.appendVerificationResult(sessionId, runId, verificationResult);
    contextService.writeRunCapsule(sessionId, runId);
    return verificationResult;
  }
  async executeApprovedRun(location, debugPlan, signal) {
    const project = storageAdapter.getProjectById(location.run.projectId);
    if (!project || !debugPlan.targetCapture) {
      throw new Error("Project or target capture is missing.");
    }
    if (process.env.RDC_AGENT_TEST_MODE === "1") {
      await this.executeMockRun(location, debugPlan, signal, project.rootPath);
      return;
    }
    const resolved = intakeContextResolver.resolve({
      projectId: location.run.projectId,
      sessionId: location.session.sessionId,
      mode: location.run.mode,
      goal: location.run.goal,
      captures: location.run.captures
    });
    const captures = location.run.captures.length > 0 ? location.run.captures : [{
      id: debugPlan.targetCapture.captureId,
      filePath: debugPlan.targetCapture.filePath,
      role: "primary",
      backendHint: location.run.backend,
      status: "pending"
    }];
    try {
      const routeBlockers = debuggerLlmService.getRouteBlockers(
        this.getRequiredRouteAgents(debugPlan, location.run.backend),
        "dispatch"
      );
      if (routeBlockers.length > 0) {
        throw { blocker: routeBlockers[0] };
      }
      await rdxSessionService.bootstrap({
        projectId: location.run.projectId,
        sessionId: location.session.sessionId,
        mode: location.run.mode,
        goal: location.run.goal,
        captures,
        primaryCaptureId: debugPlan.targetCapture.captureId,
        replayDevice: resolved.replayDevice
      });
      const runtimeContext = {
        runId: location.run.runId,
        turnId: location.run.turnId,
        sessionId: location.session.sessionId,
        caseId: location.run.caseId,
        contextId: rdxSessionService.getContextId() || "",
        runtimeOwner: rdxSessionService.getRuntimeOwner() || "",
        ownerLeaseId: rdxSessionService.getOwnerLeaseId() || "",
        debugPlan,
        targetCapturePath: debugPlan.targetCapture.filePath,
        outputRoot: storageAdapter.getRunPath(location.session.sessionId, location.run.runId),
        signal
      };
      if (!runtimeContext.contextId || !runtimeContext.runtimeOwner || !runtimeContext.ownerLeaseId) {
        throw new Error("Runtime context is incomplete after bootstrap.");
      }
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        captures: rdxSessionService.getCaptureDescriptors(),
        runtime: {
          context_id: runtimeContext.contextId,
          runtime_owner: runtimeContext.runtimeOwner,
          workflow_stage: "dispatch"
        }
      });
      const surface = await specialistRecipeRunner.prepareSurface(runtimeContext);
      this.applyTaskMutation(location.session.sessionId, location.run.runId, "speclist", "completed", "Task board seeded for the approved plan.");
      this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "in_progress", "Specialist dispatch started.");
      contextService.appendContextPacket(location.session.sessionId, location.run.runId, {
        packetId: generateEventId("context-packet"),
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        kind: "handoff",
        source: "harness",
        title: "Specialist dispatch context",
        summary: debugPlan.scope,
        content: JSON.stringify({
          targetCapture: debugPlan.targetCapture,
          targetFrameOrEvent: debugPlan.targetFrameOrEvent,
          specialists: debugPlan.recommendedSpecialists
        }),
        refs: [debugPlan.targetCapture.filePath],
        taskIds: ["dispatch"],
        evidenceIds: [],
        artifactIds: [],
        createdAt: nowIso$1()
      });
      const specialistResults = [];
      for (const specialist of debugPlan.recommendedSpecialists) {
        if (signal.aborted) {
          throw new Error(`Run aborted: ${location.run.runId}`);
        }
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId: location.run.runId,
          sessionId: location.session.sessionId,
          agentId: "rdc-debugger",
          eventType: "dispatch",
          status: "sent",
          payload: {
            targetAgent: specialist,
            objective: `Investigate ${debugPlan.scope}`
          }
        }));
        const result = await specialistRecipeRunner.run(specialist, runtimeContext, surface);
        specialistResults.push(result);
        this.persistAgentResult(location.session.sessionId, location.run.runId, result);
        await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
          runId: location.run.runId,
          sessionId: location.session.sessionId,
          agentId: specialist,
          eventType: "agent_summary",
          status: "ok",
          payload: {
            stage: "dispatch",
            summary: result.reasoningSummary.summary,
            evidence: result.reasoningSummary.evidence,
            next_step: result.reasoningSummary.nextStep,
            confidence: result.reasoningSummary.confidence,
            artifacts: result.artifacts
          }
        }));
      }
      this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "completed", "Specialist dispatch completed.");
      await this.persistInvestigationAndReport(location, debugPlan, runtimeContext, surface.replaySessionId, specialistResults);
    } catch (error) {
      const aborted = signal.aborted;
      const blocker = aborted ? {
        code: "RUN_STOPPED",
        reason: "Run stopped by user.",
        refs: [],
        detectedAt: nowIso$1()
      } : this.normalizeLlmBlocker(error, "RUN_FAILED");
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        status: aborted ? "cancelled" : "failed",
        stopReason: aborted ? "Stopped by user" : blocker.reason,
        stoppedAt: Date.now(),
        finishedAt: Date.now()
      });
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "blocker",
        status: aborted ? "warning" : "error",
        payload: {
          code: blocker.code,
          reason: blocker.reason,
          refs: blocker.refs
        }
      }));
      await this.appendAssistantConversationMessage(
        location.session.sessionId,
        location.run.runId,
        aborted ? "本轮调试已停止。" : `执行失败：${blocker.reason}`,
        aborted ? "stopped" : "error"
      );
      this.emitRunStatus(
        location.session.sessionId,
        location.run.runId,
        aborted ? "cancelled" : "failed",
        location.run.lastStage,
        blocker.reason
      );
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
    } finally {
      await rdxSessionService.closeOrReplaceOpenedCapture();
    }
  }
  async executeMockRun(location, debugPlan, signal, projectRoot) {
    const slowRun = /stop-test|slow-run/i.test(debugPlan.userGoal);
    const specialistAgents = debugPlan.recommendedSpecialists.length > 0 ? debugPlan.recommendedSpecialists : ["triage_agent", "pixel_forensics_agent", "shader_ir_agent"];
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "speclist", "completed", "Mock task board seeded.");
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "in_progress", "Mock specialist dispatch started.");
    for (const specialist of specialistAgents) {
      if (signal.aborted) {
        throw new Error(`Run aborted: ${location.run.runId}`);
      }
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: "rdc-debugger",
        eventType: "dispatch",
        status: "sent",
        payload: {
          targetAgent: specialist,
          objective: `Mock investigate ${debugPlan.scope}`
        }
      }));
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist,
        eventType: "tool_execution",
        status: "ok",
        payload: {
          tool_name: `mock.${specialist}.tool`,
          result: "success"
        }
      }));
      await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist,
        eventType: "agent_summary",
        status: "ok",
        payload: {
          stage: "dispatch",
          summary: `${specialist} completed deterministic mock analysis.`,
          evidence: [`mock:${specialist}`],
          next_step: "Continue through the debugger main chain.",
          confidence: 0.7
        }
      }));
      const evidenceId = generateEventId("evidence");
      evidenceLedger.appendEvidence(location.session.sessionId, location.run.runId, {
        evidenceId,
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        kind: "analysis",
        title: `${specialist} mock finding`,
        summary: `${specialist} completed deterministic mock analysis.`,
        refs: [`mock:${specialist}`],
        taskId: "dispatch",
        agentId: specialist,
        artifactIds: [],
        strength: "supporting",
        metadata: {
          confidence: 0.7
        },
        createdAt: nowIso$1()
      });
      contextService.appendAgentResultCard(location.session.sessionId, location.run.runId, {
        cardId: generateEventId("agent-card"),
        runId: location.run.runId,
        sessionId: location.session.sessionId,
        agentId: specialist,
        taskId: "dispatch",
        status: "completed",
        summary: `${specialist} completed deterministic mock analysis.`,
        evidenceIds: [evidenceId],
        artifactIds: [],
        verificationResultIds: [],
        nextActions: ["Continue through the debugger main chain."],
        createdAt: nowIso$1(),
        updatedAt: nowIso$1()
      });
    }
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "dispatch", "completed", "Mock specialist dispatch completed.");
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "investigate", "completed", "Mock investigation completed.");
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "fix_verify", "completed", "Mock verification completed.");
    if (slowRun) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, 1800);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error(`Run aborted: ${location.run.runId}`));
        }, { once: true });
      });
    }
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "verification",
      status: "ok",
      payload: {
        verification_kind: "fix_verify",
        verdict: "passed",
        summary: "Deterministic mock verification passed."
      }
    }));
    const report = {
      title: `Mock Debugger Report - ${debugPlan.targetCapture?.fileName || "capture"}`,
      summary: "Deterministic mock execution completed through the debugger main chain.",
      rootCause: "Mock root cause for deterministic E2E coverage.",
      fixDescription: "Mock fix validated for deterministic E2E coverage.",
      evidenceSummary: specialistAgents.map((agent) => `mock:${agent}`),
      recommendations: ["Use live mode for full RenderDoc-backed execution."],
      confidence: 0.75,
      generatedAt: nowIso$1(),
      curatorAgentId: "curator_agent"
    };
    const bundle = reportBundleService.publish({
      projectRoot,
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      goal: debugPlan.userGoal,
      report,
      evidenceSummary: report.evidenceSummary,
      verificationSummary: ["Deterministic mock verification passed."],
      eventCount: (await storageAdapter.readActionChain(location.session.sessionId)).filter((event) => event.run_id === location.run.runId).length,
      artifactPaths: [],
      llmExecution: debuggerLlmService.getRunSummary(location.run.runId)
    });
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      status: "completed",
      finishedAt: Date.now(),
      lastStage: "finalize",
      reportPaths: bundle,
      runtime: {
        workflow_stage: "finalize"
      }
    });
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "curate", "completed", "Mock report bundle published.");
    contextService.writeRunCapsule(location.session.sessionId, location.run.runId);
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "curator_agent",
      eventType: "report_published",
      status: "ok",
      payload: {
        markdownPath: bundle.markdownPath,
        jsonPath: bundle.jsonPath,
        htmlPath: bundle.htmlPath
      }
    }));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      location.run.runId,
      `调试报告已生成：${bundle.htmlPath || bundle.markdownPath || "reports ready"}`
    );
    this.emitRunStatus(location.session.sessionId, location.run.runId, "completed", "finalize");
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
  }
  async persistInvestigationAndReport(location, debugPlan, runtimeContext, replaySessionId, specialistResults) {
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "investigate", "in_progress", "Investigation synthesis started.");
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      lastStage: "investigate",
      runtime: {
        workflow_stage: "investigate"
      }
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "workflow_stage_transition",
      status: "ok",
      payload: {
        fromStage: "dispatch",
        toStage: "investigate"
      }
    }));
    const investigationSummary = await this.buildInvestigationSummary(location, debugPlan, specialistResults);
    const investigationEvidenceId = generateEventId("evidence");
    evidenceLedger.appendEvidence(location.session.sessionId, location.run.runId, {
      evidenceId: investigationEvidenceId,
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      kind: "analysis",
      title: "Debugger investigation summary",
      summary: investigationSummary.summary,
      refs: investigationSummary.evidence,
      taskId: "investigate",
      agentId: "rdc-debugger",
      artifactIds: [],
      strength: investigationSummary.confidence >= 0.75 ? "strong" : "supporting",
      metadata: {
        nextStep: investigationSummary.nextStep,
        confidence: investigationSummary.confidence
      },
      createdAt: nowIso$1()
    });
    this.applyTaskMutation(
      location.session.sessionId,
      location.run.runId,
      "investigate",
      "completed",
      "Investigation summary recorded in EvidenceLedger.",
      { evidenceRefs: [investigationEvidenceId] }
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "agent_summary",
      status: "ok",
      payload: {
        stage: "investigate",
        summary: investigationSummary.summary,
        evidence: investigationSummary.evidence,
        next_step: investigationSummary.nextStep,
        confidence: investigationSummary.confidence
      }
    }));
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "fix_verify", "in_progress", "Verification started.");
    const verification = await this.executeVerification(runtimeContext, replaySessionId, investigationSummary);
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      lastStage: "fix_verify",
      runtime: {
        workflow_stage: "fix_verify"
      }
    });
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "rdc-debugger",
      eventType: "verification",
      status: verification.status,
      payload: verification.payload
    }));
    const skeptic = await this.executeSkepticReview(location, debugPlan, investigationSummary, verification);
    const verificationResult = this.persistVerificationResult(
      location.session.sessionId,
      location.run.runId,
      debugPlan,
      verification,
      skeptic,
      [investigationEvidenceId]
    );
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "skeptic_agent",
      eventType: "verification",
      status: skeptic.status,
      payload: skeptic.payload
    }));
    if (skeptic.payload.verdict === "rejected") {
      this.applyTaskMutation(
        location.session.sessionId,
        location.run.runId,
        "fix_verify",
        "blocked",
        String(skeptic.payload.summary || "Skeptic rejected the evidence chain."),
        { evidenceRefs: verificationResult.evidenceIds }
      );
      await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
        status: "failed",
        stopReason: String(skeptic.payload.summary || "Skeptic rejected the evidence chain."),
        stoppedAt: Date.now(),
        finishedAt: Date.now(),
        lastStage: "fix_verify",
        runtime: {
          workflow_stage: "fix_verify"
        }
      });
      this.emitRunStatus(
        location.session.sessionId,
        location.run.runId,
        "failed",
        "fix_verify",
        String(skeptic.payload.summary || "Skeptic rejected the evidence chain.")
      );
      this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
      return;
    }
    this.applyTaskMutation(
      location.session.sessionId,
      location.run.runId,
      "fix_verify",
      "completed",
      "Verifier accepted the evidence chain.",
      { evidenceRefs: verificationResult.evidenceIds }
    );
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "curate", "in_progress", "Curator report generation started.");
    const project = storageAdapter.getProjectById(location.run.projectId);
    if (!project) {
      throw new Error(`Project not found: ${location.run.projectId}`);
    }
    const report = await this.buildReport(location, debugPlan, investigationSummary, verification, skeptic);
    const llmExecution = debuggerLlmService.getRunSummary(location.run.runId);
    const bundle = reportBundleService.publish({
      projectRoot: project.rootPath,
      sessionId: location.session.sessionId,
      runId: location.run.runId,
      goal: debugPlan.userGoal,
      report,
      evidenceSummary: investigationSummary.evidence,
      verificationSummary: [
        String(verification.payload.summary),
        String(skeptic.payload.summary)
      ],
      eventCount: (await storageAdapter.readActionChain(location.session.sessionId)).filter((event) => event.run_id === location.run.runId).length,
      artifactPaths: specialistResults.flatMap((result) => result.artifacts),
      llmExecution
    });
    await storageAdapter.updateRun(location.session.sessionId, location.run.runId, {
      status: "completed",
      finishedAt: Date.now(),
      lastStage: "finalize",
      reportPaths: bundle,
      runtime: {
        workflow_stage: "finalize"
      }
    });
    this.applyTaskMutation(location.session.sessionId, location.run.runId, "curate", "completed", "Report bundle published.");
    contextService.writeRunCapsule(location.session.sessionId, location.run.runId);
    await this.appendActionEvent(location.session.sessionId, storageAdapter.createActionEvent({
      runId: location.run.runId,
      sessionId: location.session.sessionId,
      agentId: "curator_agent",
      eventType: "report_published",
      status: "ok",
      payload: {
        markdownPath: bundle.markdownPath,
        jsonPath: bundle.jsonPath,
        htmlPath: bundle.htmlPath
      }
    }));
    await this.appendAssistantConversationMessage(
      location.session.sessionId,
      location.run.runId,
      `调试报告已生成：${bundle.htmlPath || bundle.markdownPath || "reports ready"}`
    );
    this.emitRunStatus(location.session.sessionId, location.run.runId, "completed", "finalize");
    this.emitWorkflowState(await this.getWorkflowState(location.session.sessionId, location.run.runId));
  }
  async buildInvestigationSummary(location, debugPlan, specialistResults) {
    const evidence = specialistResults.flatMap((result) => result.reasoningSummary.evidence);
    const evidenceHighlights = evidence.slice(0, 8);
    const specialistBriefs = specialistResults.map((result) => result.reasoningSummary.summary).filter(Boolean).slice(0, 4);
    const selectedPixel = evidence.find((entry) => /RGBA=/.test(entry));
    const visualTarget = evidence.find((entry) => /visual_target=|target=ResourceId/.test(entry));
    const degradedBinding = evidence.find((entry) => /fallback=|degraded=/.test(entry));
    const deterministic = {
      summary: [
        `Investigation synthesized ${specialistResults.length} specialist briefs around ${debugPlan.targetCapture?.fileName || "the target capture"} and ${debugPlan.targetFrameOrEvent?.eventLabel || "the active frame"}.`,
        selectedPixel ? `Selected pixel evidence: ${selectedPixel}` : "",
        visualTarget ? `Visual target evidence: ${visualTarget}` : ""
      ].filter(Boolean).join(" "),
      evidence,
      next_step: degradedBinding ? "Re-run with a precise bright-pixel coordinate or a valid swapchain target to turn the degraded visual evidence into a direct fix validation." : "Validate the leading root-cause hypothesis against verification contract and skeptic review.",
      confidence: specialistResults.length > 1 ? 0.74 : 0.58,
      root_cause: [
        `The strongest current evidence localizes the issue to ${debugPlan.targetFrameOrEvent?.eventLabel || "the active frame"} on ${debugPlan.targetCapture?.fileName || "the target capture"}.`,
        selectedPixel ? `The sampled focus pixel did not itself prove an overbright shader output: ${selectedPixel}.` : "",
        degradedBinding ? `The capture evidence is degraded by ${degradedBinding}, so the report should treat the IBL/leak hypothesis as unconfirmed until the exact bright coordinate or swapchain target is available.` : ""
      ].filter(Boolean).join(" "),
      recommendations: [
        ...specialistBriefs,
        ...evidenceHighlights,
        "Preserve the generated screenshots and specialist notes for regression tracking."
      ]
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "rdc-debugger",
        stage: "investigate",
        sessionId: location.session.sessionId,
        runId: location.run.runId,
        messages: [
          {
            role: "system",
            content: "You are the RDC Debugger orchestrator. Return JSON only with keys summary, evidence, next_step, confidence, root_cause, recommendations. Ground every field in the provided specialist evidence."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: debugPlan.userGoal,
              targetCapture: debugPlan.targetCapture,
              targetFrameOrEvent: debugPlan.targetFrameOrEvent,
              specialistResults: specialistResults.map((result2) => result2.reasoningSummary)
            })
          }
        ],
        maxTokens: 700,
        temperature: 0.2,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.summary
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      summaryId: `rdc-debugger-${Date.now()}`,
      stage: "investigate",
      agentId: "rdc-debugger",
      summary: data.summary,
      evidence: toStringArray(data.evidence).length > 0 ? toStringArray(data.evidence) : evidence,
      nextStep: data.next_step,
      confidence: toConfidence(data.confidence, deterministic.confidence),
      createdAt: nowIso$1()
    };
  }
  async executeVerification(runtimeContext, replaySessionId, investigationSummary) {
    const verificationScreenshot = path.join(runtimeContext.outputRoot, "screenshots", "verification.png");
    await harnessController.wrapToolExecution({
      toolName: "rd.export.screenshot",
      args: {
        session_id: replaySessionId,
        output_path: verificationScreenshot,
        file_format: "png",
        include_alpha: true
      },
      agentId: "rdc-debugger",
      sessionId: runtimeContext.sessionId,
      runId: runtimeContext.runId,
      turnId: runtimeContext.turnId,
      execute: () => toolBridge.call({
        toolName: "rd.export.screenshot",
        args: {
          session_id: replaySessionId,
          output_path: verificationScreenshot,
          file_format: "png",
          include_alpha: true,
          context_id: runtimeContext.contextId,
          runtime_owner: runtimeContext.runtimeOwner,
          owner_lease_id: runtimeContext.ownerLeaseId
        },
        contextId: runtimeContext.contextId,
        turnId: runtimeContext.turnId,
        runtimeOwner: runtimeContext.runtimeOwner,
        ownerLeaseId: runtimeContext.ownerLeaseId,
        runId: runtimeContext.runId,
        abortSignal: runtimeContext.signal
      })
    });
    return {
      status: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? "warning" : "ok",
      payload: {
        verification_kind: "fix_verify",
        verdict: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? "evidence_consistent_warning" : "passed",
        summary: runtimeContext.debugPlan.verificationContract.requiresFixValidation ? "Verification completed with real framebuffer evidence, but shader hotfix replay remained best-effort only." : "Verification completed with real framebuffer evidence.",
        screenshot_path: verificationScreenshot,
        evidence: investigationSummary.evidence
      }
    };
  }
  async executeSkepticReview(location, debugPlan, investigationSummary, verification) {
    const deterministic = {
      verdict: verification.status === "ok" ? "approved" : "approved_with_warning",
      summary: verification.status === "ok" ? "Skeptic accepted the evidence chain." : "Skeptic accepted the evidence chain but flagged verification as best-effort."
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "skeptic_agent",
        stage: "skeptic",
        sessionId: location.session.sessionId,
        runId: location.run.runId,
        messages: [
          {
            role: "system",
            content: "You are the skeptic agent. Return JSON only with keys verdict and summary. Verdict must be one of approved, approved_with_warning, rejected. Reject only when the evidence chain is not strong enough to support publication."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: debugPlan.userGoal,
              investigationSummary,
              verification
            })
          }
        ],
        maxTokens: 400,
        temperature: 0.1,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.summary
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      status: data.verdict === "approved" ? "ok" : "warning",
      payload: {
        verification_kind: "skeptic_review",
        verdict: data.verdict,
        summary: data.summary
      }
    };
  }
  async buildReport(location, debugPlan, investigationSummary, verification, skeptic) {
    const deterministic = {
      title: `Debugger Report - ${debugPlan.targetCapture?.fileName || "capture"}`,
      summary: investigationSummary.summary,
      root_cause: investigationSummary.summary,
      fix_description: String(verification.payload.summary),
      evidence_summary: investigationSummary.evidence,
      recommendations: [
        "Review the highlighted pipeline/shader evidence before landing a permanent fix.",
        "Keep the generated screenshot and specialist notes together with the report for regression tracking."
      ],
      confidence: investigationSummary.confidence
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "curator_agent",
        stage: "curate",
        sessionId: location.session.sessionId,
        runId: location.run.runId,
        messages: [
          {
            role: "system",
            content: "You are the curator agent. Return JSON only with keys title, summary, root_cause, fix_description, evidence_summary, recommendations, confidence. Summaries must stay grounded in the verified evidence chain and skeptic outcome."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: debugPlan.userGoal,
              investigationSummary,
              verification,
              skeptic
            })
          }
        ],
        maxTokens: 900,
        temperature: 0.2,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.summary
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      title: data.title,
      summary: data.summary,
      rootCause: data.root_cause,
      fixDescription: data.fix_description,
      evidenceSummary: toStringArray(data.evidence_summary),
      recommendations: toStringArray(data.recommendations),
      confidence: toConfidence(data.confidence, deterministic.confidence),
      generatedAt: nowIso$1(),
      curatorAgentId: "curator_agent"
    };
  }
  getRequiredRouteAgents(debugPlan, backend) {
    const required = /* @__PURE__ */ new Set([
      "rdc-debugger",
      "skeptic_agent",
      "curator_agent",
      ...debugPlan.recommendedSpecialists
    ]);
    if (backend === "remote") {
      required.add("driver_device_agent");
    }
    return Array.from(required);
  }
  normalizePlanPresentation(value, fallback) {
    if (!value || typeof value.title !== "string" || !Array.isArray(value.sections)) {
      return fallback;
    }
    const sections = value.sections.map((section, index) => ({
      id: String(section.id || section.title || `section-${index + 1}`),
      title: String(section.title || "").trim(),
      body: toStringArray(section.body)
    })).filter((section) => section.title && section.body.length > 0);
    if (!value.title.trim() || sections.length === 0) {
      return fallback;
    }
    return {
      title: value.title.trim(),
      sections
    };
  }
  async generatePlanWithLlm(input) {
    const deterministic = {
      scope: input.basePlan.scope,
      notes: input.basePlan.notes,
      recommended_specialists: input.basePlan.recommendedSpecialists,
      verification_focus: input.basePlan.verificationContract.successCriteria,
      presentation: input.basePlan.presentation ?? buildDebugPlanPresentation(input.basePlan)
    };
    let data = deterministic;
    try {
      const result = await debuggerLlmService.callStructured({
        agentId: "rdc-debugger",
        stage: "plan",
        sessionId: input.sessionId,
        runId: input.runId,
        messages: [
          {
            role: "system",
            content: "You are the RDC Debugger planner. Return JSON only with keys scope, notes, recommended_specialists, verification_focus, presentation. presentation must contain title and sections; each section has id, title, body string array. Keep the plan grounded in the provided intake facts and do not invent unsupported captures or event ids."
          },
          {
            role: "user",
            content: JSON.stringify({
              goal: input.resolvedGoal,
              basePlan: input.basePlan
            })
          }
        ],
        maxTokens: 700,
        temperature: 0.2,
        parse: (text) => debuggerLlmService.parseJson(text),
        testValue: deterministic,
        auditSummary: (payload) => payload.scope
      });
      data = result.data;
    } catch {
      data = deterministic;
    }
    return {
      ...input.basePlan,
      scope: data.scope || input.basePlan.scope,
      notes: Array.from(/* @__PURE__ */ new Set([
        ...input.basePlan.notes,
        ...toStringArray(data.notes),
        ...toStringArray(data.verification_focus).map((item) => `Verification focus: ${item}`)
      ])),
      recommendedSpecialists: toRecommendedSpecialists(data.recommended_specialists, input.basePlan.recommendedSpecialists),
      presentation: this.normalizePlanPresentation(data.presentation, input.basePlan.presentation ?? buildDebugPlanPresentation(input.basePlan)),
      updatedAt: nowIso$1()
    };
  }
  normalizeLlmBlocker(error, fallbackCode) {
    if (error && typeof error === "object" && "blocker" in error) {
      const blocker = error.blocker;
      if (blocker) {
        return blocker;
      }
    }
    return {
      code: fallbackCode,
      reason: error instanceof Error ? error.message : String(error),
      refs: [],
      detectedAt: nowIso$1()
    };
  }
  async appendActionEvent(sessionId, event) {
    if (!event.turn_id && event.run_id) {
      const location = this.findRun(event.run_id);
      if (location?.run.turnId) {
        event.turn_id = location.run.turnId;
      }
    }
    await storageAdapter.appendActionEvent(sessionId, event);
    workflowProjectionPublisher.publishEvidenceEvent(event);
    this.publishWorkstream(sessionId);
  }
  async appendUserConversationMessage(sessionId, runId, content) {
    const runLocation = this.findRun(runId || "");
    const message = {
      id: generateEventId("msgu"),
      turnId: runLocation?.run.turnId || generateEventId("turn"),
      sessionId,
      projectId: runLocation?.session.projectId ?? null,
      runId,
      modeContext: runLocation?.run.mode ?? "debugger",
      role: "user",
      content,
      status: "complete",
      attachments: [],
      updatedAt: nowMs(),
      reasoningTrace: null,
      createdAt: nowMs()
    };
    storageAdapter.appendConversationMessage(sessionId, message);
    this.emitConversationEvent({
      type: "message_completed",
      sessionId,
      turnId: message.turnId,
      message
    });
    this.publishWorkstream(sessionId);
  }
  async appendAssistantConversationMessage(sessionId, runId, content, status = "complete") {
    const runLocation = this.findRun(runId || "");
    const message = {
      id: generateEventId("msga"),
      turnId: runLocation?.run.turnId || generateEventId("turn"),
      sessionId,
      projectId: runLocation?.session.projectId ?? null,
      runId,
      modeContext: runLocation?.run.mode ?? "debugger",
      role: "assistant",
      agentId: "rdc-debugger",
      content,
      status,
      updatedAt: nowMs(),
      reasoningTrace: null,
      createdAt: nowMs()
    };
    storageAdapter.appendConversationMessage(sessionId, message);
    this.emitConversationEvent({
      type: status === "error" ? "message_errored" : "message_completed",
      sessionId,
      turnId: message.turnId,
      message
    });
  }
  findRun(runId) {
    const projects = storageAdapter.listProjects();
    for (const project of projects) {
      const sessions = storageAdapter.listSessions(project.projectId);
      for (const session of sessions) {
        const run = storageAdapter.listRuns(session.sessionId).find((entry) => entry.runId === runId);
        if (run) {
          return { session, run };
        }
      }
    }
    return null;
  }
  emitWorkflowState(state2) {
    workflowProjectionPublisher.publishWorkflowState(state2);
    this.publishWorkstream(state2.sessionId);
  }
  emitRunStatus(sessionId, runId, status, lastStage, stopReason) {
    workflowProjectionPublisher.publishRunStatus({
      sessionId,
      runId,
      status,
      lastStage,
      stopReason
    });
  }
  emitConversationEvent(event) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }
  publishWorkstream(sessionId) {
    void agentWorkstreamProjector.getSession(sessionId).then((result) => {
      if (result.success && result.presentation) {
        workflowProjectionPublisher.publishWorkstreamChanged(sessionId, result.presentation);
      }
    }).catch((error) => {
      console.error("[WorkflowProjectionPublisher] Failed to publish workstream:", error);
    });
  }
}
const debugWorkflowService = new DebugWorkflowService();
class DebuggerRuntime {
  recoverInterruptedRuns() {
    return debugWorkflowService.recoverInterruptedRuns();
  }
  startPlan(request) {
    return debugWorkflowService.startPlan(request);
  }
  requestStartFromConversation(request) {
    const { source: _source, message: _message, ...startRequest } = request;
    return this.startPlan(startRequest);
  }
  getPlan(runId) {
    return debugWorkflowService.getPlan(runId);
  }
  submitQuestions(runId, answers) {
    return debugWorkflowService.submitQuestions(runId, answers);
  }
  approvePlan(runId) {
    return debugWorkflowService.approvePlan(runId);
  }
  getWorkstreamSession(sessionId) {
    return debugWorkflowService.getWorkstreamSession(sessionId);
  }
  requestPlanRevision(runId, revisionText) {
    return debugWorkflowService.requestPlanRevision(runId, revisionText);
  }
  switchWorkstreamBranch(sessionId, branchId) {
    return debugWorkflowService.switchWorkstreamBranch(sessionId, branchId);
  }
  exportWorkstreamSession(sessionId, options) {
    return debugWorkflowService.exportWorkstreamSession(sessionId, options);
  }
  restartRun(runId) {
    return debugWorkflowService.restartRun(runId);
  }
  stopRun(runId) {
    return debugWorkflowService.stopRun(runId);
  }
  getWorkflowState(sessionId, runId) {
    return debugWorkflowService.getWorkflowState(sessionId, runId);
  }
  resolveAgentToolAllowlist(agentId, stage) {
    return resolveAgentToolAllowlist(agentId, stage);
  }
  isToolAllowedForAgent(toolName, agentId, stage) {
    return isToolAllowedForAgent(toolName, agentId, stage);
  }
}
const debuggerRuntime = new DebuggerRuntime();
function registerAgentHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("agent:sendMessage", async (_event, agentId, content) => {
    try {
      let runContext;
      if (state2.currentSessionId) {
        const currentRun = state2.currentRunId ? storageAdapter.listRuns(state2.currentSessionId).find((run) => run.runId === state2.currentRunId) : storageAdapter.getLatestRun(state2.currentSessionId);
        if (currentRun) {
          runContext = {
            caseId: currentRun.caseId,
            runId: currentRun.runId,
            sessionId: currentRun.sessionId
          };
        }
      }
      const response = await agentOrchestrator.sendMessage(agentId, content, runContext, {
        signal: (runContext?.runId ? runExecutionService.getAbortSignal(runContext.runId) : null) ?? void 0
      });
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
}
function registerCaptureDeviceHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("context:get", async () => {
    return rdxSessionService.snapshotContext();
  });
  electron.ipcMain.handle("context:openHumanPreview", async (_event, request) => {
    try {
      const contextSnapshot = await rdxSessionService.openHumanPreviewWindow(request);
      context2.broadcastToRenderer("context:changed", contextSnapshot);
      const preview = contextSnapshot.humanPreview;
      return {
        success: preview?.status === "open" || preview?.status === "opening",
        contextSnapshot,
        error: preview?.lastError
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("context:closeHumanPreview", async () => {
    try {
      const contextSnapshot = await rdxSessionService.closeHumanPreviewWindow();
      context2.broadcastToRenderer("context:changed", contextSnapshot);
      return {
        success: contextSnapshot.humanPreview?.status === "closed",
        contextSnapshot,
        error: contextSnapshot.humanPreview?.lastError
      };
    } catch (error) {
      const contextSnapshot = rdxSessionService.snapshotContext();
      return {
        success: false,
        contextSnapshot,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("capture:list", async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });
  electron.ipcMain.handle(
    "capture:openProjectInput",
    async (_event, request) => {
      try {
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "info",
          title: "Open project input",
          summary: `开始打开 ${request.inputId}。`,
          detail: request.filePath,
          sessionId: state2.currentSessionId,
          projectId: request.projectId,
          runId: state2.currentRunId,
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
        context2.broadcastToRenderer("capture:openedStateChanged", openedCapture);
        context2.broadcastToRenderer("context:changed", contextSnapshot);
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "success",
          title: "Project input opened",
          summary: `${input.fileName} 已打开。`,
          detail: openedCapture.preview?.source === "framebuffer_screenshot" ? "预览来源：framebuffer" : openedCapture.preview?.source === "capture_thumbnail" ? "预览来源：thumbnail" : openedCapture.previewError?.code ? `当前无可用预览：${openedCapture.previewError.code}` : "当前无可用预览",
          sessionId: state2.currentSessionId,
          projectId: request.projectId,
          runId: state2.currentRunId,
          raw: {
            openedCapture,
            contextSnapshot
          }
        });
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
        runtimeLogService.log({
          scope: state2.currentSessionId ? "session" : "app",
          namespace: "capture",
          severity: "error",
          title: "Project input open failed",
          summary: err instanceof Error ? err.message : String(err),
          sessionId: state2.currentSessionId,
          projectId: request.projectId,
          runId: state2.currentRunId,
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
    context2.broadcastToRenderer("capture:openedStateChanged", null);
    context2.broadcastToRenderer("context:changed", rdxSessionService.snapshotContext());
    runtimeLogService.log({
      scope: state2.currentSessionId ? "session" : "app",
      namespace: "capture",
      severity: "info",
      title: "Opened capture cleared",
      summary: "当前打开的 capture 已清理。",
      sessionId: state2.currentSessionId,
      projectId: state2.currentProjectId,
      runId: state2.currentRunId
    });
    return { success: true };
  });
  electron.ipcMain.handle("capture:select", async (_event, captureId) => {
    try {
      await rdxSessionService.switchActiveCapture(captureId);
      context2.broadcastToRenderer("capture:statusChanged", { captureId, status: "selected" });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
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
}
class SkillRegistry {
  skills = /* @__PURE__ */ new Map();
  /** 注册 skill */
  register(definition, execute) {
    if (this.skills.has(definition.name)) {
      console.warn(`[SkillRegistry] Overwriting existing skill: ${definition.name}`);
    }
    this.skills.set(definition.name, { definition, execute });
  }
  /** 注销 skill */
  unregister(name) {
    return this.skills.delete(name);
  }
  /** 获取 skill */
  get(name) {
    return this.skills.get(name);
  }
  /** 列出所有 skill 定义 */
  list() {
    return Array.from(this.skills.values()).map((s) => s.definition);
  }
  /** 按标签过滤 */
  listByTag(tag) {
    return this.list().filter((s) => s.tags.includes(tag));
  }
  /** 按来源过滤 */
  listBySource(source) {
    return this.list().filter((s) => s.source === source);
  }
  /** 检查 skill 是否存在 */
  has(name) {
    return this.skills.has(name);
  }
  /** 获取注册数量 */
  get size() {
    return this.skills.size;
  }
  /** 清空所有注册 */
  clear() {
    this.skills.clear();
  }
}
const skillRegistry = new SkillRegistry();
class MCPConnection extends events.EventEmitter {
  config;
  status = "disconnected";
  childProcess;
  requestId = 0;
  pendingRequests = /* @__PURE__ */ new Map();
  tools = [];
  connectedAt;
  error;
  buffer = "";
  eventSource;
  sseEndpoint;
  constructor(config) {
    super();
    this.config = config;
  }
  get serverId() {
    return this.config.id;
  }
  get serverName() {
    return this.config.name;
  }
  get connectionInfo() {
    return {
      serverId: this.config.id,
      serverName: this.config.name,
      status: this.status,
      tools: this.tools,
      connectedAt: this.connectedAt,
      error: this.error
    };
  }
  /**
   * 建立连接
   */
  async connect() {
    if (this.status === "connected" || this.status === "connecting") {
      return this.connectionInfo;
    }
    this.status = "connecting";
    this.error = void 0;
    try {
      if (this.config.transport === "stdio") {
        await this.connectStdio();
      } else if (this.config.transport === "sse" || this.config.transport === "streamable-http") {
        await this.connectSSE();
      } else {
        throw new Error(`不支持的传输类型: ${this.config.transport}`);
      }
      await this.initialize();
      await this.fetchTools();
      this.status = "connected";
      this.connectedAt = (/* @__PURE__ */ new Date()).toISOString();
      return this.connectionInfo;
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      this.cleanup();
      throw err;
    }
  }
  /**
   * stdio 传输连接
   */
  async connectStdio() {
    const { command, args = [], env = {} } = this.config;
    if (!command) {
      throw new Error("stdio 传输模式需要指定 command");
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("连接超时"));
      }, 3e4);
      try {
        this.childProcess = child_process.spawn(command, args, {
          env: { ...process.env, ...env },
          stdio: ["pipe", "pipe", "pipe"]
        });
        if (!this.childProcess.stdin || !this.childProcess.stdout) {
          clearTimeout(timeout);
          reject(new Error("无法创建子进程管道"));
          return;
        }
        this.childProcess.stdout.on("data", (data) => {
          this.handleStdioData(data.toString());
        });
        this.childProcess.stderr?.on("data", (data) => {
          console.error(`[MCP ${this.config.name}] stderr:`, data.toString());
        });
        this.childProcess.on("exit", (code) => {
          if (code !== 0 && code !== null) {
            this.handleDisconnect(new Error(`进程退出，代码: ${code}`));
          }
        });
        this.childProcess.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        setTimeout(() => {
          clearTimeout(timeout);
          resolve();
        }, 500);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }
  /**
   * SSE 传输连接
   */
  async connectSSE() {
    const { url: url2 } = this.config;
    if (!url2) {
      throw new Error("SSE 传输模式需要指定 url");
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("SSE 连接超时"));
      }, 3e4);
      try {
        fetch(`${url2}/sse`).then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP 错误: ${response.status}`);
          }
          return response.text();
        }).then((endpoint) => {
          this.sseEndpoint = endpoint.trim();
          this.eventSource = new EventSource(`${url2}${this.sseEndpoint}`);
          this.eventSource.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          this.eventSource.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              this.handleMessage(message);
            } catch (err) {
              console.error("[MCP SSE] 解析消息失败:", err);
            }
          };
          this.eventSource.onerror = () => {
            this.handleDisconnect(new Error("SSE 连接错误"));
          };
        }).catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }
  /**
   * 处理 stdio 数据
   */
  handleStdioData(data) {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const message = JSON.parse(trimmed);
        this.handleMessage(message);
      } catch (err) {
        console.error("[MCP stdio] 解析消息失败:", trimmed);
      }
    }
  }
  /**
   * 处理 JSON-RPC 消息
   */
  handleMessage(message) {
    if ("id" in message && message.id !== void 0) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if ("error" in message && message.error) {
          pending.reject(new Error(message.error.message));
        } else if ("result" in message) {
          pending.resolve(message.result);
        }
      }
    }
    if (!("id" in message)) {
      this.emit("notification", message);
    }
  }
  /**
   * MCP 初始化握手
   */
  async initialize() {
    const params = {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "RDC-Agent",
        version: "1.0.0"
      }
    };
    await this.sendRequest("initialize", params);
    await this.sendNotification("initialized", {});
  }
  /**
   * 获取工具列表
   */
  async fetchTools() {
    const result = await this.sendRequest("tools/list", {});
    if (result && Array.isArray(result.tools)) {
      this.tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverId: this.config.id,
        serverName: this.config.name
      }));
    }
  }
  /**
   * 发送 JSON-RPC 请求
   */
  async sendRequest(method, params) {
    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${method}`));
      }, 6e4);
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
      this.sendMessage(request).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }
  /**
   * 发送 JSON-RPC 通知
   */
  async sendNotification(method, params) {
    const notification = {
      jsonrpc: "2.0",
      method,
      params
    };
    await this.sendMessage(notification);
  }
  /**
   * 发送消息
   */
  async sendMessage(message) {
    const data = JSON.stringify(message);
    if (this.config.transport === "stdio") {
      if (!this.childProcess?.stdin) {
        throw new Error("stdio 连接未建立");
      }
      this.childProcess.stdin.write(data + "\n");
    } else if (this.config.transport === "sse" || this.config.transport === "streamable-http") {
      if (!this.config.url) {
        throw new Error("SSE URL 未配置");
      }
      const response = await fetch(`${this.config.url}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: data
      });
      if (!response.ok) {
        throw new Error(`HTTP 错误: ${response.status}`);
      }
    }
  }
  /**
   * 列出工具
   */
  async listTools() {
    if (this.status !== "connected") {
      throw new Error("未连接到 MCP Server");
    }
    return [...this.tools];
  }
  /**
   * 调用工具
   */
  async callTool(toolName, args) {
    if (this.status !== "connected") {
      throw new Error("未连接到 MCP Server");
    }
    const result = await this.sendRequest("tools/call", {
      name: toolName,
      arguments: args
    });
    return result;
  }
  /**
   * 断开连接
   */
  async disconnect() {
    this.cleanup();
    this.status = "disconnected";
    this.connectedAt = void 0;
    this.error = void 0;
    this.tools = [];
  }
  /**
   * 清理资源
   */
  cleanup() {
    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = void 0;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = void 0;
    }
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("连接已断开"));
    }
    this.pendingRequests.clear();
    this.buffer = "";
  }
  /**
   * 处理断开连接
   */
  handleDisconnect(error) {
    if (this.status === "connected" || this.status === "connecting") {
      this.status = "error";
      this.error = error.message;
      this.cleanup();
      this.emit("disconnect", error);
    }
  }
}
class MCPClient {
  connections = /* @__PURE__ */ new Map();
  /**
   * 连接到 MCP Server
   */
  async connect(config) {
    const existing = this.connections.get(config.id);
    if (existing) {
      await existing.disconnect();
    }
    const connection = new MCPConnection(config);
    this.connections.set(config.id, connection);
    connection.on("disconnect", () => {
      this.connections.delete(config.id);
    });
    return await connection.connect();
  }
  /**
   * 断开指定 Server 连接
   */
  async disconnect(serverId) {
    const connection = this.connections.get(serverId);
    if (connection) {
      await connection.disconnect();
      this.connections.delete(serverId);
    }
  }
  /**
   * 断开所有连接
   */
  async disconnectAll() {
    const disconnectPromises = Array.from(this.connections.values()).map(
      (conn) => conn.disconnect()
    );
    await Promise.all(disconnectPromises);
    this.connections.clear();
  }
  /**
   * 列出指定 Server 的工具
   */
  async listTools(serverId) {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`未找到 MCP Server: ${serverId}`);
    }
    return await connection.listTools();
  }
  /**
   * 调用指定 Server 的工具
   */
  async callTool(serverId, toolName, args) {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error(`未找到 MCP Server: ${serverId}`);
    }
    return await connection.callTool(toolName, args);
  }
  /**
   * 获取连接信息
   */
  getConnectionInfo(serverId) {
    const connection = this.connections.get(serverId);
    return connection?.connectionInfo;
  }
  /**
   * 获取所有连接信息
   */
  getAllConnections() {
    return Array.from(this.connections.values()).map((conn) => conn.connectionInfo);
  }
}
const mcpClient = new MCPClient();
const ASK_READONLY_TOOL_ALLOWLIST = [
  "primitive.read",
  "primitive.glob",
  "primitive.grep",
  "primitive.webFetch",
  "primitive.webSearch",
  "primitive.askUser",
  "primitive.task.list",
  "task.readonly"
];
const ASK_DENIED_TOOL_PATTERNS = [
  "primitive.bash",
  "primitive.write",
  "primitive.edit",
  "primitive.remove",
  "bash.exec",
  "fs.write",
  "fs.edit",
  "fs.remove"
];
function toolMatchesRuntimePolicy(toolName, allowlist = []) {
  for (const pattern of allowlist) {
    if (pattern === "*" || pattern === toolName) {
      return true;
    }
    if (pattern.endsWith(".*") && toolName.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  return false;
}
function resolveRuntimeToolAllowlist(agentId, allowlist = []) {
  if (agentId === "ask_agent") {
    return ASK_READONLY_TOOL_ALLOWLIST;
  }
  return Array.from(new Set(allowlist.filter(Boolean)));
}
function isRuntimeToolAllowed(toolName, agentId, allowlist = []) {
  if (agentId === "ask_agent" && ASK_DENIED_TOOL_PATTERNS.some((pattern) => toolName === pattern || toolName.startsWith(`${pattern}.`))) {
    return false;
  }
  return toolMatchesRuntimePolicy(toolName, resolveRuntimeToolAllowlist(agentId, allowlist));
}
const primitiveTool = (name, description, properties = {}, required = [], readOnly = true) => ({
  name,
  modelName: toModelToolName(name),
  description,
  inputSchema: {
    type: "object",
    properties,
    required
  },
  group: "primitive",
  layer: "primitive",
  readOnly
});
function toModelToolName(toolName) {
  return toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
}
class ToolRegistry {
  async listTools() {
    const primitiveTools = [
      primitiveTool("primitive.read", "Read a UTF-8 text file from the active workspace.", {
        path: { type: "string", description: "Workspace-relative or absolute path." }
      }, ["path"]),
      primitiveTool("primitive.glob", "List files under the active workspace using a simple glob-like suffix pattern.", {
        pattern: { type: "string", description: "Pattern such as **/*.ts or *.json." }
      }, ["pattern"]),
      primitiveTool("primitive.grep", "Search text files under the active workspace for a literal pattern.", {
        pattern: { type: "string", description: "Literal text to search for." }
      }, ["pattern"]),
      primitiveTool("primitive.webFetch", "Fetch a URL as text through the provider runtime.", {
        url: { type: "string", description: "HTTP or HTTPS URL." }
      }, ["url"]),
      primitiveTool("primitive.webSearch", "Search the web when a search provider is configured.", {
        query: { type: "string", description: "Search query." }
      }, ["query"]),
      primitiveTool("primitive.askUser", "Request clarification from the user through the UI approval channel.", {
        question: { type: "string", description: "Question to ask the user." }
      }, ["question"]),
      primitiveTool("primitive.task.list", "List readonly runtime task descriptors.", {}, []),
      primitiveTool("primitive.bash", "Run a shell command. Disabled for Ask.", {
        command: { type: "string", description: "Command to execute." }
      }, ["command"], false),
      primitiveTool("primitive.write", "Write a file. Disabled for Ask.", {
        path: { type: "string", description: "Target path." },
        content: { type: "string", description: "File content." }
      }, ["path", "content"], false),
      primitiveTool("primitive.edit", "Edit a file. Disabled for Ask.", {}, [], false),
      primitiveTool("primitive.remove", "Remove a file. Disabled for Ask.", {
        path: { type: "string", description: "Target path." }
      }, ["path"], false)
    ];
    const catalog = await toolBridge.loadCatalog();
    const rdcTools = (catalog.tools ?? []).map((tool) => ({
      name: tool.name,
      modelName: toModelToolName(tool.name),
      description: tool.description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries((tool.parameters ?? []).map((parameter) => [
          parameter.name,
          {
            type: parameter.type,
            description: parameter.description,
            enum: parameter.enum
          }
        ])),
        required: (tool.parameters ?? []).filter((parameter) => parameter.required).map((parameter) => parameter.name)
      },
      group: tool.group,
      layer: "rdc",
      readOnly: !tool.name.includes("edit") && !tool.name.includes("write") && !tool.name.includes("remove")
    }));
    const skillTools = skillRegistry.list().map((skill) => ({
      name: `skill.${skill.name}`,
      modelName: toModelToolName(`skill.${skill.name}`),
      description: skill.description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(skill.parameters.map((parameter) => [
          parameter.name,
          {
            type: parameter.type,
            description: parameter.description
          }
        ])),
        required: skill.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name)
      },
      group: "skill",
      layer: "skill",
      readOnly: true
    }));
    const mcpTools = mcpClient.getAllConnections().flatMap(
      (connection) => connection.tools.map((tool) => ({
        name: `mcp.${connection.serverId}.${tool.name}`,
        modelName: toModelToolName(`mcp.${connection.serverId}.${tool.name}`),
        description: tool.description,
        inputSchema: normalizeMcpInputSchema(tool.inputSchema),
        group: "mcp",
        layer: "mcp",
        readOnly: true
      }))
    );
    return [...primitiveTools, ...rdcTools, ...skillTools, ...mcpTools];
  }
  async listAllowedLlmTools(agentId, allowlist) {
    const runtimeTools = (await this.listTools()).filter((tool) => isRuntimeToolAllowed(tool.name, agentId, allowlist));
    const nameMap = /* @__PURE__ */ new Map();
    const tools = runtimeTools.map((tool) => {
      nameMap.set(tool.modelName, tool.name);
      return {
        name: tool.modelName,
        description: `${tool.description}

Runtime tool: ${tool.name}`,
        input_schema: tool.inputSchema
      };
    });
    return { tools, nameMap };
  }
  async execute(request) {
    const start = nowMs();
    if (!isRuntimeToolAllowed(request.originalToolName, request.agentId, request.allowlist)) {
      return {
        ok: false,
        data: {},
        artifacts: [],
        error: {
          code: "AGENT_RUNTIME_TOOL_DENIED",
          message: `Tool ${request.originalToolName} is not allowed for ${request.agentId}.`,
          category: "policy"
        },
        duration_ms: nowMs() - start,
        trace_id: generateEventId("tool")
      };
    }
    if (request.originalToolName.startsWith("rd.")) {
      return toolBridge.call({
        toolName: request.originalToolName,
        args: request.toolCall.arguments,
        turnId: request.turnId,
        contextId: request.sessionId ?? void 0,
        runId: request.runId,
        runtimeOwner: request.agentId,
        abortSignal: request.signal
      });
    }
    if (request.originalToolName.startsWith("skill.")) {
      return this.executeSkill(request, start);
    }
    if (request.originalToolName.startsWith("mcp.")) {
      return this.executeMcpTool(request, start);
    }
    return this.executePrimitiveTool(request, start);
  }
  async executePrimitiveTool(request, start) {
    const workspaceRoot = appPathService.getWorkspaceRoot();
    const args = request.toolCall.arguments;
    try {
      if (request.originalToolName === "primitive.read") {
        const target = resolveWorkspacePath(workspaceRoot, String(args.path ?? ""));
        return okResult({ path: target, content: fs.readFileSync(target, "utf8") }, start);
      }
      if (request.originalToolName === "primitive.glob") {
        const pattern = String(args.pattern ?? "");
        return okResult({ files: listWorkspaceFiles(workspaceRoot, pattern).slice(0, 200) }, start);
      }
      if (request.originalToolName === "primitive.grep") {
        const pattern = String(args.pattern ?? "");
        return okResult({ matches: grepWorkspace(workspaceRoot, pattern).slice(0, 200) }, start);
      }
      if (request.originalToolName === "primitive.webFetch") {
        const url2 = String(args.url ?? "");
        const response = await fetch(url2, { signal: request.signal });
        return okResult({ url: url2, status: response.status, text: (await response.text()).slice(0, 2e4) }, start);
      }
      if (request.originalToolName === "primitive.webSearch") {
        return errorResult("WEB_SEARCH_PROVIDER_MISSING", "No web search provider is configured for the local AgentRuntime.", "configuration", start);
      }
      if (request.originalToolName === "primitive.askUser") {
        return errorResult("ASK_USER_REQUIRES_APPROVAL_EVENT", "Ask-user requests are represented as approval.requested events in this runtime build.", "approval", start);
      }
      if (request.originalToolName === "primitive.task.list") {
        return okResult({ tasks: [] }, start);
      }
      return errorResult("PRIMITIVE_TOOL_NOT_IMPLEMENTED", `Primitive tool is not implemented: ${request.originalToolName}`, "implementation", start);
    } catch (error) {
      return errorResult("PRIMITIVE_TOOL_FAILED", error instanceof Error ? error.message : String(error), "execution", start);
    }
  }
  async executeSkill(request, start) {
    const skillName = request.originalToolName.replace(/^skill\./, "");
    const skill = skillRegistry.get(skillName);
    if (!skill) {
      return errorResult("SKILL_NOT_FOUND", `Skill not found: ${skillName}`, "configuration", start);
    }
    const result = await skill.execute(request.toolCall.arguments, {
      caseId: request.runId ?? "",
      runId: request.runId ?? "",
      sessionId: request.sessionId ?? "",
      agentId: request.agentId,
      workspacePath: appPathService.getWorkspaceRoot()
    });
    return result.success ? okResult({ output: result.output, artifacts: result.artifacts ?? [] }, start) : errorResult("SKILL_FAILED", result.error ?? result.output, "execution", start);
  }
  async executeMcpTool(request, start) {
    const [, serverId, ...toolNameParts] = request.originalToolName.split(".");
    const toolName = toolNameParts.join(".");
    if (!serverId || !toolName) {
      return errorResult("MCP_TOOL_NAME_INVALID", `Invalid MCP tool name: ${request.originalToolName}`, "configuration", start);
    }
    try {
      const result = await mcpClient.callTool(serverId, toolName, request.toolCall.arguments);
      return okResult({ content: result.content, isError: result.isError ?? false }, start);
    } catch (error) {
      return errorResult("MCP_TOOL_FAILED", error instanceof Error ? error.message : String(error), "execution", start);
    }
  }
}
function normalizeMcpInputSchema(inputSchema) {
  if (inputSchema.type === "object" && inputSchema.properties && typeof inputSchema.properties === "object") {
    return inputSchema;
  }
  return {
    type: "object",
    properties: {}
  };
}
function okResult(data, start) {
  return {
    ok: true,
    data,
    artifacts: [],
    duration_ms: nowMs() - start,
    trace_id: generateEventId("tool")
  };
}
function errorResult(code, message, category, start) {
  return {
    ok: false,
    data: {},
    artifacts: [],
    error: {
      code,
      message,
      category
    },
    duration_ms: nowMs() - start,
    trace_id: generateEventId("tool")
  };
}
function resolveWorkspacePath(workspaceRoot, inputPath) {
  const target = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(workspaceRoot, inputPath);
  const root = path.resolve(workspaceRoot);
  const rootCompare = process.platform === "win32" ? root.toLowerCase() : root;
  const targetCompare = process.platform === "win32" ? target.toLowerCase() : target;
  if (!targetCompare.startsWith(rootCompare)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }
  return target;
}
function listWorkspaceFiles(workspaceRoot, pattern) {
  const suffix = pattern.replace(/^\*\*\//, "").replace(/^\*/, "");
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(workspaceRoot, fullPath);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "out", "release"].includes(entry.name)) {
          walk(fullPath);
        }
        continue;
      }
      if (!suffix || relativePath.endsWith(suffix) || entry.name.includes(pattern.replace(/\*/g, ""))) {
        results.push(relativePath);
      }
    }
  };
  walk(workspaceRoot);
  return results;
}
function grepWorkspace(workspaceRoot, pattern) {
  if (!pattern) {
    return [];
  }
  const matches = [];
  for (const relativePath of listWorkspaceFiles(workspaceRoot, "*")) {
    const fullPath = path.join(workspaceRoot, relativePath);
    if (!/\.(ts|tsx|js|jsx|json|md|txt|css|html)$/i.test(relativePath)) {
      continue;
    }
    const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
    lines.forEach((lineText, index) => {
      if (lineText.includes(pattern)) {
        matches.push({ path: relativePath, line: index + 1, text: lineText.slice(0, 500) });
      }
    });
  }
  return matches;
}
const toolRegistry = new ToolRegistry();
class AgentRuntime {
  async runTurn(request) {
    const events2 = [];
    const toolResults = [];
    const runId = request.runId || generateEventId("agent-run");
    const allowlist = resolveRuntimeToolAllowlist(request.agentId, request.toolAllowlist);
    let streamedText = "";
    let finalResponse;
    const emit = (type, payload) => {
      const event = {
        id: generateEventId("agent-event"),
        type,
        timestamp: nowMs(),
        runId,
        turnId: request.turnId,
        sessionId: request.sessionId ?? null,
        agentId: request.agentId,
        stage: request.stage,
        phase: request.phase,
        payload
      };
      events2.push(event);
      request.onEvent?.(event);
      this.persistEvent(event);
      return event;
    };
    emit("run.started", {
      mode: request.mode,
      patternId: request.patternId,
      providerId: request.providerId,
      modelId: request.modelId,
      toolAllowlist: allowlist
    });
    const testStub = this.createTestModeStub(request);
    if (testStub) {
      for (const chunk of splitForStreaming(testStub)) {
        streamedText += chunk;
        emit("assistant.delta", { text: chunk });
        await Promise.resolve();
      }
      emit("assistant.completed", { text: streamedText });
      emit("run.completed", { status: "complete", text: streamedText });
      return { text: streamedText, toolResults, events: events2 };
    }
    try {
      if (!request.providerId || !request.modelId) {
        const message = "No provider/model route is configured for this agent.";
        emit("diagnostic", {
          code: "AGENT_RUNTIME_ROUTE_MISSING",
          severity: "error",
          message
        });
        emit("run.failed", { status: "failed", error: message });
        throw new Error(message);
      }
      await this.refreshAccountRuntimeCredentials(request.providerId);
      const { tools, nameMap } = await toolRegistry.listAllowedLlmTools(request.agentId, allowlist);
      const messages = [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.prompt }
      ];
      finalResponse = await llmAdapter.streamChat(
        {
          messages,
          model: request.modelId,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          tools,
          signal: request.signal
        },
        (event) => {
          if (event.type === "text-delta") {
            streamedText += event.text;
            emit("assistant.delta", { text: event.text });
          }
          if (event.type === "tool-call-delta") {
            const toolCall = {
              id: event.toolCall.id,
              name: nameMap.get(event.toolCall.name ?? "") ?? event.toolCall.name ?? "",
              arguments: event.toolCall.argumentsText ? { raw: event.toolCall.argumentsText } : {}
            };
            emit("tool.requested", { toolCall, streamEvent: event });
          }
        },
        request.providerId
      );
      if (!streamedText && typeof finalResponse.content === "string") {
        streamedText = finalResponse.content;
      }
      if (finalResponse.toolCalls?.length) {
        const toolSummary = await this.executeToolCalls({
          request,
          allowlist,
          nameMap,
          toolCalls: finalResponse.toolCalls,
          emit
        });
        toolResults.push(...toolSummary.toolResults);
        if (toolSummary.summaryPrompt) {
          const followUpText = await this.summarizeToolResults(request, messages, streamedText, toolSummary.summaryPrompt, emit);
          streamedText = [streamedText, followUpText].filter(Boolean).join("\n");
        }
      }
      emit("assistant.completed", {
        text: streamedText,
        usage: finalResponse.usage
      });
      emit("run.completed", {
        status: "complete",
        text: streamedText,
        usage: finalResponse.usage
      });
      return {
        text: streamedText,
        response: finalResponse,
        toolResults,
        events: events2
      };
    } catch (error) {
      if (request.signal?.aborted) {
        emit("run.cancelled", { status: "cancelled", error: "Request was cancelled." });
        return { text: streamedText, response: finalResponse, toolResults, events: events2 };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (!events2.some((event) => event.type === "run.failed")) {
        emit("diagnostic", {
          code: "AGENT_RUNTIME_REQUEST_FAILED",
          severity: "error",
          message: "Agent runtime request failed.",
          technicalMessage: message
        });
        emit("run.failed", { status: "failed", error: message });
      }
      throw error;
    }
  }
  async executeToolCalls(input) {
    const toolResults = [];
    const summaries = [];
    for (const toolCall of input.toolCalls) {
      const originalToolName = input.nameMap.get(toolCall.name) ?? toolCall.name;
      input.emit("tool.started", {
        toolCallId: toolCall.id,
        toolName: originalToolName,
        args: toolCall.arguments
      });
      const result = await toolRegistry.execute({
        agentId: input.request.agentId,
        toolCall,
        originalToolName,
        allowlist: input.allowlist,
        sessionId: input.request.sessionId,
        turnId: input.request.turnId,
        runId: input.request.runId,
        signal: input.request.signal
      });
      toolResults.push({ toolName: originalToolName, result });
      input.emit("tool.completed", {
        toolCallId: toolCall.id,
        toolName: originalToolName,
        result
      });
      summaries.push(`${originalToolName}: ${JSON.stringify(result).slice(0, 4e3)}`);
    }
    return {
      toolResults,
      summaryPrompt: summaries.join("\n")
    };
  }
  async summarizeToolResults(request, messages, previousText, summaryPrompt, emit) {
    let text = "";
    const response = await llmAdapter.streamChat(
      {
        messages: [
          ...messages,
          {
            role: "assistant",
            content: previousText || "I requested tool results."
          },
          {
            role: "user",
            content: `Tool results:
${summaryPrompt}

Use these results to continue. Do not expose raw chain-of-thought.`
          }
        ],
        model: request.modelId,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        signal: request.signal
      },
      (event) => {
        if (event.type === "text-delta") {
          text += event.text;
          emit("assistant.delta", { text: event.text });
        }
      },
      request.providerId
    );
    if (!text && typeof response.content === "string") {
      text = response.content;
    }
    return text;
  }
  async refreshAccountRuntimeCredentials(providerId) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (provider?.authMode !== "account") {
      return;
    }
    await providerAccountAuthService.ensureRuntimeCredentials(providerId);
    llmAdapter.configure(settingsService.getLlmConfig());
  }
  persistEvent(event) {
    try {
      const paths = appPathService.getWorkspacePaths();
      const eventDir = path.join(paths.logsPath, "agent-events");
      fs.mkdirSync(eventDir, { recursive: true });
      const filePath = path.join(eventDir, `${event.runId ?? "run"}.jsonl`);
      fs.appendFileSync(filePath, `${JSON.stringify(event)}
`, "utf8");
    } catch (error) {
      console.warn("[AgentRuntime] Failed to persist event:", error);
    }
  }
  createTestModeStub(request) {
    if (process.env.RDC_AGENT_TEST_MODE !== "1") {
      return null;
    }
    let userMessage = request.prompt;
    try {
      const parsed = JSON.parse(request.prompt);
      userMessage = parsed.effective_user_message || parsed.user_message || request.prompt;
    } catch {
      userMessage = request.prompt;
    }
    if (userMessage.includes("__RDC_AGENT_E2E_FORCE_COWORK_LLM_FAILURE__")) {
      throw new Error("E2E forced cowork LLM request failure");
    }
    const lower = userMessage.toLowerCase();
    let stub = request.agentId === "ask_agent" ? "Ask is ready. Describe the issue, goal, or .rdc capture you want to inspect; I will clarify without starting execution." : "Debugger is ready. Describe the symptom and capture context; I will prepare a plan before execution.";
    if (/ue4|unreal/i.test(userMessage)) {
      stub = "UE4 is Unreal Engine 4, commonly involved in graphics debugging around materials, post-processing, shaders, and render passes.";
    } else if (/hello|hi/i.test(userMessage)) {
      stub = request.agentId === "ask_agent" ? "Hello. I can clarify the issue, explain capability boundaries, or guide you to open a .rdc capture without starting RenderDoc execution." : "Hello. In Debugger mode I will generate an execution plan first, then wait for approval before running the strict workflow.";
    } else if (/start|execute|debug|analy[sz]e/.test(lower)) {
      stub = "Received. I will prepare the formal debugging plan first, then move into the strict execution flow only when conditions are met.";
    }
    const intent = /start|execute|debug|analy[sz]e/.test(lower) ? "execute" : "talk";
    return `${stub}
<control>{"intent":"${intent}","safe_to_start":${intent === "execute" ? "true" : "false"}}</control>`;
  }
}
function splitForStreaming(text) {
  const midpoint = Math.max(1, Math.ceil(text.length / 2));
  return [text.slice(0, midpoint), text.slice(midpoint)].filter(Boolean);
}
const agentRuntime = new AgentRuntime();
const EXECUTE_PATTERN = /开始|启动|执行|正式分析|正式调试|本地调试|local\s*模式调试|模式调试|直接分析|现在分析|run\b|start\b|debug\b|analy[sz]e\b|帮我调试|请.*调试|开始调试|开始分析/i;
const TASK_FILE_PATTERN = /([A-Za-z]:[\\/][^\r\n"]+\.(txt|md))/i;
const CONTROL_OPEN_TAG = "<control>";
const ACTIVE_RUN_STATUSES = [
  "planning",
  "awaiting_input",
  "awaiting_approval",
  "queued",
  "running",
  "stopping"
];
function isActiveRun(run) {
  return Boolean(run && ACTIVE_RUN_STATUSES.includes(run.status));
}
function trimPathLabel(value) {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || value;
}
function createReasoningStep(id, title, stage) {
  return {
    id,
    title,
    stage,
    status: "pending",
    toolCalls: [],
    startedAt: nowMs()
  };
}
function createDraftReasoningTrace(summary, steps) {
  return {
    status: "running",
    summary,
    steps,
    updatedAt: nowMs()
  };
}
function cloneTrace(trace) {
  return trace ? {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      toolCalls: step.toolCalls.map((toolCall) => ({ ...toolCall }))
    }))
  } : {
    status: "idle",
    steps: [],
    updatedAt: nowMs()
  };
}
function upsertTraceStep(trace, stepId, patch) {
  const nextTrace = cloneTrace(trace);
  const stepIndex = nextTrace.steps.findIndex((step) => step.id === stepId);
  if (stepIndex >= 0) {
    nextTrace.steps[stepIndex] = {
      ...nextTrace.steps[stepIndex],
      ...patch,
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : nextTrace.steps[stepIndex].toolCalls.map((toolCall) => ({ ...toolCall }))
    };
  } else {
    nextTrace.steps.push({
      ...createReasoningStep(stepId, patch.title || stepId, patch.stage),
      ...patch,
      toolCalls: patch.toolCalls ? patch.toolCalls.map((toolCall) => ({ ...toolCall })) : []
    });
  }
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function finalizeTrace(trace, status, summary) {
  const nextTrace = cloneTrace(trace);
  nextTrace.status = status;
  nextTrace.summary = summary ?? nextTrace.summary;
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function upsertRuntimeToolCall(trace, patch) {
  const nextTrace = cloneTrace(trace);
  const stepId = "runtime-tools";
  let step = nextTrace.steps.find((entry) => entry.id === stepId);
  if (!step) {
    step = createReasoningStep(stepId, "Runtime tool trace", "cowork");
    step.status = "running";
    nextTrace.steps.push(step);
  }
  const toolIndex = step.toolCalls.findIndex((toolCall) => toolCall.id === patch.id);
  if (toolIndex >= 0) {
    step.toolCalls[toolIndex] = {
      ...step.toolCalls[toolIndex],
      ...patch
    };
  } else {
    step.toolCalls.push({
      id: patch.id,
      toolName: patch.toolName,
      status: patch.status ?? "pending",
      argsPreview: patch.argsPreview,
      resultPreview: patch.resultPreview,
      error: patch.error,
      startedAt: patch.startedAt ?? nowMs(),
      completedAt: patch.completedAt
    });
  }
  if (step.toolCalls.length > 0 && step.toolCalls.every((toolCall) => toolCall.status === "complete" || toolCall.status === "error")) {
    step.status = step.toolCalls.some((toolCall) => toolCall.status === "error") ? "error" : "complete";
    step.completedAt = nowMs();
  }
  nextTrace.status = "running";
  nextTrace.updatedAt = nowMs();
  return nextTrace;
}
function makeConversationMessage(role, content, options) {
  const createdAt = nowMs();
  return {
    id: generateEventId(role === "user" ? "msgu" : role === "assistant" ? "msga" : "msgs"),
    turnId: options.turnId,
    sessionId: options.sessionId ?? null,
    projectId: options.projectId ?? null,
    runId: options.runId ?? null,
    modeContext: options.modeContext,
    role,
    agentId: options.agentId,
    content,
    status: options.status ?? (role === "assistant" ? "draft" : "complete"),
    updatedAt: createdAt,
    reasoningTrace: options.reasoningTrace ?? null,
    diagnostic: options.diagnostic ?? null,
    attachments: options.attachments,
    createdAt
  };
}
function composeMessageForAgent(entry) {
  const attachmentLines = (entry.attachments ?? []).map((attachment) => `- ${attachment.fileName}`);
  if (attachmentLines.length === 0) {
    return entry.content;
  }
  const suffix = `

Attached files:
${attachmentLines.join("\n")}`;
  return entry.content ? `${entry.content}${suffix}` : `Attached files:
${attachmentLines.join("\n")}`;
}
function stripControlBlock(text) {
  return text.replace(/<control>\s*[\s\S]*?<\/control>/i, "").trim();
}
function parseControlBlock(text) {
  const match = text.match(/<control>\s*([\s\S]*?)\s*<\/control>/i);
  if (!match?.[1]) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]);
    const intent = parsed.intent;
    if (intent !== "talk" && intent !== "intake" && intent !== "execute") {
      return null;
    }
    return {
      intent,
      safe_to_start: parsed.safe_to_start === true,
      needs_project: parsed.needs_project === true,
      needs_capture: parsed.needs_capture === true,
      needs_target_capture: parsed.needs_target_capture === true,
      needs_route: parsed.needs_route === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : void 0
    };
  } catch {
    return null;
  }
}
function resolveTaskFileContext(message) {
  const match = message.match(TASK_FILE_PATTERN);
  const taskFilePath = match?.[1] ? path.resolve(match[1]) : null;
  if (!taskFilePath || !fs.existsSync(taskFilePath) || !fs.statSync(taskFilePath).isFile()) {
    return {
      taskFilePath: null,
      taskFileContent: null,
      effectiveMessage: message
    };
  }
  const taskFileContent = fs.readFileSync(taskFilePath, "utf-8").trim();
  return {
    taskFilePath,
    taskFileContent,
    effectiveMessage: [message, taskFileContent].filter(Boolean).join("\n\n")
  };
}
function buildCoworkPrompt(context2, history, mode, message, attachments) {
  const resolvedTaskFile = resolveTaskFileContext(message);
  const recentHistory = history.slice(-6).map((entry) => ({
    role: entry.role,
    content: entry.content
  }));
  return JSON.stringify({
    requested_mode: mode,
    requested_mode_label: mode === "ask" ? "Ask" : mode === "debugger" ? "Debugger" : mode === "analyzer" ? "Analyzer" : "Optimizer",
    user_message: message,
    effective_user_message: resolvedTaskFile.effectiveMessage,
    task_file_path: resolvedTaskFile.taskFilePath,
    task_file_content: resolvedTaskFile.taskFileContent,
    current_project_id: context2.projectId,
    current_session_id: context2.session?.sessionId ?? null,
    active_run_id: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
    opened_capture: context2.openedCapturePath,
    project_inputs: context2.projectInputs.slice(0, 8).map((entry) => entry.fileName),
    incoming_attachments: attachments.map((entry) => ({
      file_name: entry.fileName,
      kind: entry.kind,
      mime_type: entry.mimeType
    })),
    recent_history: recentHistory
  }, null, 2);
}
function buildAskSystemPrompt() {
  return [
    "你是 RDC-Agent 的 Ask 助手，负责非执行对话。",
    "要求：",
    "1. 正常回答用户问题，语气简洁，不使用审批流、工单流或调试执行口吻。",
    "2. 不要自称 RDC Debugger，不要暗示已经开始 RenderDoc 调试，也不要假装分析过 capture。",
    "3. 可以解释能力边界、澄清目标、帮助用户判断是否需要 Open .rdc capture。",
    "4. 如果用户要求正式调试或执行分析，只提示需要在应用内 Open capture 并切换到 Debugger；Ask 模式不能创建 run。",
    "5. 不要声称可以调用 shell、rdx-tool、ToolBridge 或任何 RenderDoc 执行工具。",
    "6. 不需要输出隐藏控制块，除非明确需要表达 intake；即使输出 control，也必须 safe_to_start=false。"
  ].join("\n");
}
function buildDebuggerCoworkSystemPrompt() {
  return [
    "你是 RDC Debugger，一个面向 RenderDoc 调试场景的 Cowork Agent。",
    "要求：",
    "1. 始终先用自然中文正常回复用户，不要像审批流或工单流。",
    "2. 如果用户问通用知识、产品能力、技术概念，直接回答，不要强行转成调试执行，也不要在普通寒暄中自我介绍成 RDC Debugger。",
    "3. 没有正式进入调试 run 前，不要假装自己已经分析过 capture。",
    "4. Ask 是非执行入口；只有 requested_mode 是 Debugger、用户明确表达“现在开始正式调试/执行分析”，且应用内已有 opened_capture 时，才把 intent 标成 execute。",
    "5. 回复正文结束后，必须额外附加一个 <control>{...}</control> 块，control JSON 只允许包含 intent, safe_to_start, needs_project, needs_capture, needs_target_capture, needs_route, reason。",
    "6. 如果你不确定，就把 intent 设为 talk 或 intake，safe_to_start 设为 false。",
    "7. 控制块不要在正文里解释给用户。",
    "8. requested_mode 表示当前 UI 模式，Ask 只做澄清与引导，Debugger 偏重定位与排障，Analyzer 偏重拆解与证据整理，Optimizer 偏重瓶颈判断与优化建议；回答结构要随 mode 调整。"
  ].join("\n");
}
function redactTechnicalMessage(error) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/(Bearer\s+)[^\s"'`,;)}]+/gi, "$1[redacted]").replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["'\s:=]+)[^"',;\s)}]+/gi, "$1[redacted]").slice(0, 1200);
}
function createConversationDiagnostic(input) {
  return {
    code: input.code,
    severity: input.severity,
    userMessage: input.userMessage,
    agentId: input.agentId,
    providerId: input.providerId,
    modelId: input.modelId,
    adapterId: input.adapterId,
    technicalMessage: input.technicalMessage
  };
}
function getConversationAgentLabel(agentId) {
  return agentId === "ask_agent" ? "Ask" : "rdc-debugger";
}
function resolveAgentRoutePreflight(agentId, fallbackAgentId) {
  const settings = settingsService.getAll();
  const primaryRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId);
  const fallbackRoute = fallbackAgentId ? settings.llm.agentRoutes.find((entry) => entry.agentId === fallbackAgentId) : void 0;
  const route = primaryRoute?.providerId && primaryRoute.modelId ? primaryRoute : fallbackRoute;
  const routeAgentId = route?.agentId ?? agentId;
  const label = getConversationAgentLabel(agentId);
  if (!route?.providerId || !route.modelId) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_ROUTE_MISSING",
        severity: "warning",
        userMessage: `当前 ${label} 链路还没绑定可用模型。请在 Settings 中为 \`${agentId}\` 选择 provider 和 model route。`
      })
    };
  }
  const provider = settings.llm.providers.find((entry) => entry.id === route.providerId);
  if (!provider || !provider.enabled || !provider.isConfigured) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_PROVIDER_UNAVAILABLE",
        severity: "error",
        userMessage: `当前 ${label} 链路的 provider 不可用：${route.providerId}。请检查该服务商的连接状态、账号或密钥后重试。`,
        providerId: route.providerId,
        modelId: route.modelId,
        technicalMessage: provider?.lastError ?? provider?.unavailableReason
      })
    };
  }
  const model = provider.models.find((entry) => entry.id === route.modelId);
  if (!model?.enabled) {
    return {
      ok: false,
      diagnostic: createConversationDiagnostic({
        agentId,
        code: "CONVERSATION_LLM_ROUTE_MISSING",
        severity: "warning",
        userMessage: `当前 ${label} 链路的模型不可用：${route.providerId}/${route.modelId}。请在 Settings 中刷新模型列表或重新选择 route。`,
        providerId: route.providerId,
        modelId: route.modelId
      })
    };
  }
  return {
    ok: true,
    agentId,
    routeAgentId,
    providerId: route.providerId,
    modelId: route.modelId
  };
}
function resolveDebuggerRoutePreflight() {
  return resolveAgentRoutePreflight("rdc-debugger");
}
function hasUsableDebuggerRoute() {
  return resolveDebuggerRoutePreflight().ok;
}
function recordCoworkLlmDiagnostic(context2, diagnostic) {
  runtimeLogService.log({
    scope: context2.session?.sessionId ? "session" : "app",
    namespace: "llm",
    severity: diagnostic.severity === "error" ? "error" : "warning",
    title: `${diagnostic.agentId ?? "rdc-debugger"} -> ${diagnostic.providerId ?? "route missing"}${diagnostic.modelId ? `/${diagnostic.modelId}` : ""}`,
    summary: diagnostic.userMessage,
    detail: diagnostic.technicalMessage,
    sessionId: context2.session?.sessionId ?? null,
    projectId: context2.projectId,
    runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
    raw: {
      code: diagnostic.code,
      agentId: diagnostic.agentId,
      providerId: diagnostic.providerId,
      modelId: diagnostic.modelId,
      adapterId: diagnostic.adapterId
    }
  });
}
function createRequestFailedDiagnostic(route, error) {
  const label = getConversationAgentLabel(route.agentId);
  return createConversationDiagnostic({
    agentId: route.agentId,
    code: "CONVERSATION_LLM_REQUEST_FAILED",
    severity: "error",
    userMessage: `模型请求失败：${label} 当前使用 ${route.providerId}/${route.modelId}，但服务商请求没有成功。请检查该账号、模型权限、额度或网络状态后重试。`,
    providerId: route.providerId,
    modelId: route.modelId,
    technicalMessage: redactTechnicalMessage(error)
  });
}
function extractRequestedCaptureName(message) {
  const match = message.match(/([^\s"'“”‘’]+\.rdc)/i);
  return match?.[1] ? trimPathLabel(match[1].replace(/[，。；,;]+$/, "")) : null;
}
function shouldStartDebuggerFromMessage(message) {
  if (!EXECUTE_PATTERN.test(message)) {
    return false;
  }
  return /\.rdc\b/i.test(message) || /event\s*id|事件\s*id|Event\s*\d+/i.test(message) || /帮我调试|请调试|开始调试|正式分析|直接过去看|定位根因|完整\s*report/i.test(message);
}
function captureDescriptorFromOpenedCapture(openedCapture) {
  const normalizedPath = path.resolve(openedCapture.filePath);
  return {
    id: openedCapture.captureId || openedCapture.inputId,
    filePath: normalizedPath,
    captureFileId: openedCapture.captureFileId,
    role: "primary",
    backendHint: openedCapture.backend,
    status: openedCapture.status,
    sessionId: openedCapture.sessionId,
    replaySessionId: openedCapture.replaySessionId,
    contextId: openedCapture.contextId
  };
}
function resolveOpenedCaptureDescriptor(context2) {
  return context2.openedCapture?.status === "open" ? captureDescriptorFromOpenedCapture(context2.openedCapture) : null;
}
function resolveCaptureGuards(message, context2) {
  if (resolveOpenedCaptureDescriptor(context2)) {
    return { ready: true };
  }
  const requestedCaptureName = extractRequestedCaptureName(message);
  if (requestedCaptureName) {
    return {
      ready: false,
      needsCapture: true,
      reason: `我看到你提到了 ${requestedCaptureName}，但正式 Debugger 只能使用应用内已经 Open 的 .rdc Capture。请先在 Capture Library 打开该 capture，再进入执行模式。`
    };
  }
  return {
    ready: false,
    needsCapture: true,
    reason: "我可以先帮你梳理问题，但正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。仅在 prompt 中写路径不会创建 runtime context。"
  };
}
function buildWorkflowUpgradeReply(result) {
  if (!result.success) {
    return result.error ? `我刚才尝试进入正式调试，但没有成功：${result.error}` : "我刚才尝试进入正式调试，但没有成功。";
  }
  if (result.debugPlanSummary?.blockers?.length) {
    const blocker = result.debugPlanSummary.blockers[0];
    if (blocker?.code === "BLOCKED_LLM_ROUTE_MISSING" || blocker?.code === "BLOCKED_LLM_PROVIDER_MISSING" || blocker?.code === "BLOCKED_LLM_SECRET_MISSING" || blocker?.code === "BLOCKED_LLM_MODEL_MISSING" || blocker?.code === "BLOCKED_LLM_PROVIDER_UNAVAILABLE") {
      return "当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。";
    }
    if (blocker?.code === "BLOCKED_MISSING_CAPTURE") {
      return "我可以先帮你梳理问题，但正式分析需要一个 .rdc capture。你可以先描述现象，或者直接打开一个 capture。";
    }
    return blocker?.reason || "当前还不能进入正式调试。";
  }
  if (result.pendingQuestions?.questions.some((question) => question.id === "target_capture")) {
    return "我已经开始整理正式执行计划了，不过当前还需要你明确这次要分析的 capture。";
  }
  if (result.status === "awaiting_approval") {
    return "我已经整理好正式执行计划了。你先确认下方计划卡片，批准后我再进入严格调试流程。";
  }
  return "正式调试入口已准备完成，后续状态会在计划卡和运行记录中更新。";
}
function computeVisibleAssistantText(raw) {
  const controlIndex = raw.indexOf(CONTROL_OPEN_TAG);
  if (controlIndex >= 0) {
    return raw.slice(0, controlIndex);
  }
  let partialMatchLength = 0;
  for (let index = CONTROL_OPEN_TAG.length - 1; index > 0; index -= 1) {
    if (raw.endsWith(CONTROL_OPEN_TAG.slice(0, index))) {
      partialMatchLength = index;
      break;
    }
  }
  return partialMatchLength > 0 ? raw.slice(0, raw.length - partialMatchLength) : raw;
}
class ConversationService {
  activeTurns = /* @__PURE__ */ new Map();
  async getHistory(sessionId) {
    return storageAdapter.readConversationHistory(sessionId);
  }
  async cancelActiveTurn(request = {}) {
    const candidates = Array.from(this.activeTurns.values()).filter((turn) => !request.turnId || turn.turnId === request.turnId).filter((turn) => !request.sessionId || turn.sessionId === request.sessionId).sort((left, right) => right.startedAt - left.startedAt);
    const target = candidates[0];
    if (!target) {
      return { success: false, error: "No active conversation turn." };
    }
    target.stop();
    return {
      success: true,
      cancelledTurnId: target.turnId
    };
  }
  registerActiveTurn(turn) {
    this.activeTurns.set(turn.turnId, turn);
  }
  clearActiveTurn(turnId, controller) {
    const active = this.activeTurns.get(turnId);
    if (active?.abortController === controller) {
      this.activeTurns.delete(turnId);
    }
  }
  async sendMessage(input) {
    const context2 = await this.resolveContext(input);
    if (isActiveRun(context2.currentRun)) {
      return this.startActiveDebugTurn(context2, input.mode, input.message.trim(), input.attachments ?? []);
    }
    return this.startCoworkTurn(context2, input.mode, input.message.trim(), input.attachments ?? []);
  }
  async resolveContext(input) {
    const projectId = input.projectId ?? input.fallbackProjectId ?? storageAdapter.getCurrentProjectId() ?? null;
    const persistedSessionId = await storageAdapter.getCurrentSessionId();
    const resolvedSessionId = input.sessionId ?? input.fallbackSessionId ?? persistedSessionId ?? null;
    const session = resolvedSessionId ? storageAdapter.readSession(resolvedSessionId) : null;
    const currentRun = resolvedSessionId ? storageAdapter.listRuns(resolvedSessionId).find((entry) => entry.runId === (input.currentRunId ?? input.fallbackRunId)) ?? storageAdapter.getLatestRun(resolvedSessionId) : null;
    const projectInputs = projectId ? storageAdapter.listProjectInputs(projectId) : [];
    const openedCapture = rdxSessionService.snapshotOpenedCapture();
    const activeOpenedCapture = openedCapture?.projectId === projectId && openedCapture.status === "open" ? openedCapture : null;
    const replayDevice = replayDeviceService.getDeviceById(input.replayDeviceId || "local") ?? replayDeviceService.getDeviceById("local");
    return {
      projectId,
      session,
      currentRun,
      projectInputs,
      openedCapture: activeOpenedCapture,
      openedCapturePath: activeOpenedCapture?.filePath ?? null,
      replayDevice
    };
  }
  async startActiveDebugTurn(context2, requestedMode, rawMessage, pendingAttachments) {
    const turnId = generateEventId("turn");
    const attachments = context2.session ? storageAdapter.importSessionAttachments(
      context2.session.sessionId,
      pendingAttachments.map((entry) => entry.sourcePath)
    ) : [];
    const userMessage = makeConversationMessage("user", rawMessage, {
      turnId,
      sessionId: context2.session?.sessionId ?? null,
      projectId: context2.projectId,
      runId: context2.currentRun?.runId ?? null,
      modeContext: requestedMode,
      attachments,
      status: "complete"
    });
    const assistantDraftMessage = makeConversationMessage("assistant", "", {
      turnId,
      sessionId: context2.session?.sessionId ?? null,
      projectId: context2.projectId,
      runId: context2.currentRun?.runId ?? null,
      modeContext: requestedMode,
      agentId: "rdc-debugger",
      status: "streaming",
      reasoningTrace: createDraftReasoningTrace("正在思考", [
        createReasoningStep("active-debug-reply", "生成调试回复", "investigate")
      ])
    });
    this.persistConversationSnapshot(context2.session?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(context2.session?.sessionId ?? null, assistantDraftMessage);
    this.publishWorkstream(context2.session?.sessionId ?? null);
    void this.completeActiveDebugTurn({
      context: context2,
      requestedMode,
      userMessage,
      assistantDraftMessage
    });
    return {
      session: context2.session,
      mode: "active_debug",
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: "none" },
      runUpdate: context2.currentRun,
      errorViewModel: null
    };
  }
  async completeActiveDebugTurn(input) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const workstreamSessionId = sessionId ?? this.ephemeralWorkstreamSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const commitAssistantMessage = (type, patch) => {
      if (abortController.signal.aborted && patch.status !== "stopped") {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs()
      };
      this.persistConversationSnapshot(sessionId, assistantMessage);
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? "",
        turnId: assistantMessage.turnId,
        message: assistantMessage
      });
      this.publishConversationWorkstream(workstreamSessionId, [input.userMessage, assistantMessage], sessionId);
    };
    const commitStoppedMessage = () => {
      commitAssistantMessage("message_completed", {
        status: "stopped",
        content: assistantMessage.content || "当前请求已停止。",
        reasoningTrace: finalizeTrace(
          upsertTraceStep(assistantMessage.reasoningTrace, "active-debug-reply", {
            status: "complete",
            summary: "用户已停止当前请求。",
            completedAt: nowMs()
          }),
          "stopped",
          "请求已停止"
        )
      });
    };
    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stop: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          commitStoppedMessage();
        }
      }
    });
    commitAssistantMessage("message_patched", {
      reasoningTrace: upsertTraceStep(
        assistantMessage.reasoningTrace,
        "active-debug-reply",
        {
          title: "生成调试回复",
          stage: "investigate",
          status: "running",
          summary: "Debugger 正在结合当前 run 上下文生成回复。",
          startedAt: nowMs()
        }
      )
    });
    try {
      const responseText = await agentOrchestrator.sendMessage(
        "rdc-debugger",
        composeMessageForAgent(input.userMessage),
        {
          caseId: input.context.session?.sessionId,
          runId: input.context.currentRun?.runId ?? void 0,
          sessionId: input.context.session?.sessionId ?? void 0,
          turnId: assistantMessage.turnId
        },
        {
          onChunk: (chunk) => {
            commitAssistantMessage("message_patched", {
              status: "streaming",
              content: `${assistantMessage.content}${chunk}`
            });
          },
          signal: abortController.signal
        }
      );
      commitAssistantMessage("message_completed", {
        status: "complete",
        content: responseText,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            "active-debug-reply",
            {
              status: "complete",
              summary: "调试回复已生成。",
              completedAt: nowMs()
            }
          ),
          "complete",
          "回复已完成"
        )
      });
    } catch (error) {
      const routePreflight = resolveDebuggerRoutePreflight();
      const diagnostic = routePreflight.ok ? createRequestFailedDiagnostic(routePreflight, error) : routePreflight.diagnostic;
      recordCoworkLlmDiagnostic(input.context, diagnostic);
      const message = diagnostic.userMessage;
      commitAssistantMessage("message_errored", {
        status: "error",
        content: assistantMessage.content || message,
        diagnostic,
        reasoningTrace: finalizeTrace(
          upsertTraceStep(
            assistantMessage.reasoningTrace,
            "active-debug-reply",
            {
              status: "error",
              summary: message,
              detail: diagnostic.technicalMessage,
              completedAt: nowMs()
            }
          ),
          "error",
          "回复生成失败"
        )
      });
    } finally {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
    }
  }
  async startCoworkTurn(context2, requestedMode, rawMessage, pendingAttachments) {
    let workingSession = context2.session;
    if (!workingSession && context2.projectId) {
      workingSession = storageAdapter.createSession(context2.projectId, rawMessage.slice(0, 80));
    }
    const turnId = generateEventId("turn");
    const importedAttachments = workingSession ? storageAdapter.importSessionAttachments(
      workingSession.sessionId,
      pendingAttachments.map((entry) => entry.sourcePath)
    ) : [];
    const userMessage = makeConversationMessage("user", rawMessage, {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context2.projectId,
      runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
      modeContext: requestedMode,
      attachments: importedAttachments,
      status: "complete"
    });
    const assistantDraftMessage = makeConversationMessage("assistant", "", {
      turnId,
      sessionId: workingSession?.sessionId ?? null,
      projectId: context2.projectId,
      runId: isActiveRun(context2.currentRun) ? context2.currentRun.runId : null,
      modeContext: requestedMode,
      agentId: requestedMode === "ask" ? "ask_agent" : "rdc-debugger",
      status: "streaming",
      reasoningTrace: requestedMode === "ask" ? null : createDraftReasoningTrace("正在思考", [
        createReasoningStep("cowork-route", "检查上下文与路由", "intake_gate"),
        createReasoningStep("cowork-reply", "生成协作回复", "plan")
      ])
    });
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, userMessage);
    this.persistConversationSnapshot(workingSession?.sessionId ?? null, assistantDraftMessage);
    const workstreamSessionId = workingSession?.sessionId ?? this.ephemeralWorkstreamSessionId(turnId);
    const workstreamPresentation = agentWorkstreamProjector.buildConversationPresentation(
      workstreamSessionId,
      [userMessage, assistantDraftMessage]
    );
    this.publishConversationWorkstream(workstreamSessionId, [userMessage, assistantDraftMessage], workingSession?.sessionId ?? null);
    void this.completeCoworkTurn({
      context: {
        ...context2,
        session: workingSession
      },
      requestedMode,
      rawMessage,
      importedAttachments,
      userMessage,
      assistantDraftMessage
    });
    return {
      session: workingSession,
      mode: "talk",
      userMessage,
      assistantDraftMessage,
      executionTransition: { action: "none" },
      runUpdate: null,
      workstreamPresentation,
      errorViewModel: null
    };
  }
  async completeCoworkTurn(input) {
    let assistantMessage = input.assistantDraftMessage;
    const sessionId = input.context.session?.sessionId ?? null;
    const workstreamSessionId = sessionId ?? this.ephemeralWorkstreamSessionId(input.assistantDraftMessage.turnId);
    const abortController = new AbortController();
    const conversationAgentId = input.requestedMode === "ask" ? "ask_agent" : "rdc-debugger";
    const showCoworkReasoning = input.requestedMode !== "ask";
    const commitAssistantMessage = (type, patch) => {
      if (abortController.signal.aborted && patch.status !== "stopped") {
        return;
      }
      assistantMessage = {
        ...assistantMessage,
        ...patch,
        updatedAt: nowMs()
      };
      this.persistConversationSnapshot(sessionId, assistantMessage);
      this.emitConversationEvent({
        type,
        sessionId: sessionId ?? "",
        turnId: assistantMessage.turnId,
        message: assistantMessage
      });
      this.publishConversationWorkstream(workstreamSessionId, [input.userMessage, assistantMessage], sessionId);
    };
    const commitStoppedMessage = () => {
      commitAssistantMessage("message_completed", {
        status: "stopped",
        content: assistantMessage.content || "当前请求已停止。",
        reasoningTrace: finalizeTrace(
          upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
            status: "complete",
            summary: "用户已停止当前请求。",
            completedAt: nowMs()
          }),
          "stopped",
          "请求已停止"
        )
      });
    };
    this.registerActiveTurn({
      turnId: assistantMessage.turnId,
      sessionId,
      startedAt: nowMs(),
      abortController,
      stop: () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          commitStoppedMessage();
        }
      }
    });
    let systemAppendix = "";
    const commitVisibleAssistantText = () => {
      commitAssistantMessage("message_patched", {
        status: "streaming",
        content: `${visibleResponse}${systemAppendix}`
      });
    };
    const appendSystemAppendix = (text) => {
      if (!text) {
        return;
      }
      systemAppendix += text;
      commitVisibleAssistantText();
    };
    const withCoworkReasoning = (reasoningTrace) => showCoworkReasoning ? { reasoningTrace } : {};
    if (showCoworkReasoning) {
      commitAssistantMessage("message_patched", {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-route", {
          status: "running",
          summary: "正在检查项目、capture 与调试路由。",
          startedAt: nowMs()
        })
      });
    }
    const history = input.context.session ? storageAdapter.readConversationHistory(input.context.session.sessionId).filter((entry) => entry.id !== assistantMessage.id) : [];
    let rawResponse = "";
    let visibleResponse = "";
    let errorViewModel = null;
    let llmDiagnostic = null;
    const taskFileContext = resolveTaskFileContext(input.rawMessage);
    const effectiveMessage = taskFileContext.effectiveMessage;
    const explicitFormalDebugRequest = shouldStartDebuggerFromMessage(effectiveMessage);
    const explicitDebuggerRequest = input.requestedMode === "debugger" && explicitFormalDebugRequest;
    const askModeFormalDebugRequest = input.requestedMode === "ask" && explicitFormalDebugRequest;
    const explicitDebuggerCaptureGuard = explicitDebuggerRequest ? resolveCaptureGuards(effectiveMessage, input.context) : null;
    const askModeCaptureGuard = askModeFormalDebugRequest ? resolveCaptureGuards(effectiveMessage, input.context) : null;
    const routePreflight = conversationAgentId === "ask_agent" ? resolveAgentRoutePreflight("ask_agent", "rdc-debugger") : resolveDebuggerRoutePreflight();
    if (askModeFormalDebugRequest) {
      rawResponse = [
        askModeCaptureGuard?.ready ? "当前 Ask 不会直接创建正式 run。Capture 已经 Open；如需执行，请切换到 Debugger 后发送，我会先生成执行前计划。" : askModeCaptureGuard?.reason || "正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。",
        '<control>{"intent":"intake","safe_to_start":false,"needs_capture":true}</control>'
      ].join("\n");
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: "complete",
          summary: "Ask 模式保留为非执行入口，已提示用户通过 Open 和 Debugger 模式进入计划。",
          completedAt: nowMs()
        }))
      });
    } else if (explicitDebuggerRequest && explicitDebuggerCaptureGuard && !explicitDebuggerCaptureGuard.ready) {
      rawResponse = [
        explicitDebuggerCaptureGuard.reason || "正式 Debugger 执行需要先在应用内 Open 一个 .rdc Capture。",
        '<control>{"intent":"intake","safe_to_start":false,"needs_capture":true}</control>'
      ].join("\n");
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: "complete",
          summary: "已拦截正式 Debugger 请求，等待应用内 Open capture。",
          completedAt: nowMs()
        }))
      });
    } else if (explicitDebuggerRequest && !routePreflight.ok && routePreflight.diagnostic.code !== "CONVERSATION_LLM_ROUTE_MISSING") {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    } else if (explicitDebuggerRequest) {
      if (!routePreflight.ok) {
        llmDiagnostic = routePreflight.diagnostic;
        recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      }
      rawResponse = [
        "已识别为 Debugger 执行请求。我会先生成执行前计划，等待你确认后再进入正式调试。",
        '<control>{"intent":"execute","safe_to_start":true}</control>'
      ].join("\n");
      visibleResponse = stripControlBlock(rawResponse);
      commitVisibleAssistantText();
      commitAssistantMessage("message_patched", {
        ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: "complete",
          summary: "已识别为正式 Debugger 任务，准备生成执行前计划。",
          completedAt: nowMs()
        }))
      });
    } else if (!routePreflight.ok) {
      llmDiagnostic = routePreflight.diagnostic;
      errorViewModel = {
        code: llmDiagnostic.code,
        message: llmDiagnostic.userMessage,
        technicalMessage: llmDiagnostic.technicalMessage
      };
      rawResponse = llmDiagnostic.userMessage;
      visibleResponse = llmDiagnostic.userMessage;
      recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
      commitVisibleAssistantText();
    } else {
      try {
        if (showCoworkReasoning) {
          commitAssistantMessage("message_patched", {
            reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
              status: "running",
              summary: `正在通过 ${routePreflight.providerId}/${routePreflight.modelId} 生成协作回复。`,
              startedAt: nowMs()
            })
          });
        }
        const response = await agentRuntime.runTurn({
          agentId: conversationAgentId,
          mode: input.requestedMode,
          prompt: buildCoworkPrompt(
            input.context,
            history,
            input.requestedMode,
            input.rawMessage,
            input.importedAttachments
          ),
          sessionId: input.context.session?.sessionId,
          turnId: assistantMessage.turnId,
          stage: "cowork",
          patternId: input.requestedMode === "debugger" ? "plan-generate-verify" : "free-agent",
          systemPrompt: conversationAgentId === "ask_agent" ? buildAskSystemPrompt() : buildDebuggerCoworkSystemPrompt(),
          providerId: routePreflight.providerId,
          modelId: routePreflight.modelId,
          maxTokens: 1200,
          temperature: 0.35,
          signal: abortController.signal,
          onEvent: (event) => {
            this.emitConversationEvent({
              type: "agent_event",
              sessionId: sessionId ?? "",
              turnId: assistantMessage.turnId,
              event
            });
            if (event.type === "assistant.delta") {
              const chunk = typeof event.payload.text === "string" ? event.payload.text : "";
              rawResponse += chunk;
              const nextVisible = computeVisibleAssistantText(rawResponse);
              if (nextVisible.length > visibleResponse.length) {
                visibleResponse = nextVisible;
                commitVisibleAssistantText();
              }
            }
            if (event.type === "tool.started") {
              commitAssistantMessage("message_patched", {
                reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                  id: String(event.payload.toolCallId),
                  toolName: String(event.payload.toolName),
                  status: "running",
                  argsPreview: JSON.stringify(event.payload.args ?? {}).slice(0, 600),
                  startedAt: nowMs()
                })
              });
            }
            if (event.type === "tool.completed") {
              const result = event.payload.result;
              commitAssistantMessage("message_patched", {
                reasoningTrace: upsertRuntimeToolCall(assistantMessage.reasoningTrace, {
                  id: String(event.payload.toolCallId),
                  toolName: String(event.payload.toolName),
                  status: result?.ok ? "complete" : "error",
                  resultPreview: JSON.stringify(event.payload.result ?? {}).slice(0, 800),
                  error: result?.ok ? void 0 : result?.error?.message,
                  completedAt: nowMs()
                })
              });
            }
          }
        });
        if (!rawResponse) {
          rawResponse = response.text;
        }
      } catch (error) {
        llmDiagnostic = createRequestFailedDiagnostic(routePreflight, error);
        errorViewModel = {
          code: llmDiagnostic.code,
          message: llmDiagnostic.userMessage,
          technicalMessage: llmDiagnostic.technicalMessage
        };
        rawResponse = llmDiagnostic.userMessage;
        visibleResponse = llmDiagnostic.userMessage;
        recordCoworkLlmDiagnostic(input.context, llmDiagnostic);
        commitVisibleAssistantText();
      }
    }
    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    const assistantContent = stripControlBlock(rawResponse);
    visibleResponse = assistantContent;
    const control = parseControlBlock(rawResponse);
    const isRouteMissingDiagnostic = llmDiagnostic?.code === "CONVERSATION_LLM_ROUTE_MISSING";
    let finalStatus = errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete";
    let traceStatus = errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete";
    commitAssistantMessage("message_patched", {
      content: `${visibleResponse}${systemAppendix}`,
      diagnostic: llmDiagnostic,
      ...withCoworkReasoning(upsertTraceStep(assistantMessage.reasoningTrace, "cowork-route", {
        status: "complete",
        summary: llmDiagnostic ? `模型链路诊断完成：${llmDiagnostic.providerId ? `${llmDiagnostic.providerId}${llmDiagnostic.modelId ? `/${llmDiagnostic.modelId}` : ""}` : "缺少 route"}。` : "上下文检查完成。",
        completedAt: nowMs()
      }))
    });
    if (abortController.signal.aborted) {
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    if (!input.context.projectId && EXECUTE_PATTERN.test(effectiveMessage)) {
      const boundaryReply = "我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。";
      commitAssistantMessage("message_completed", {
        status: "complete",
        content: boundaryReply,
        ...withCoworkReasoning(finalizeTrace(
          upsertTraceStep(
            upsertTraceStep(assistantMessage.reasoningTrace, "cowork-route", {
              status: "complete",
              summary: "当前还没有可用项目。",
              completedAt: nowMs()
            }),
            "cowork-upgrade",
            {
              title: "升级到正式调试",
              stage: "plan",
              status: "complete",
              summary: "已拦截正式调试请求，等待选择项目。",
              completedAt: nowMs()
            }
          ),
          "complete",
          "等待选择项目"
        ))
      });
      this.clearActiveTurn(assistantMessage.turnId, abortController);
      return;
    }
    const shouldUpgradeByControl = input.requestedMode === "debugger" && control?.intent === "execute" && control.safe_to_start;
    const shouldUpgradeByRequest = !errorViewModel && explicitDebuggerRequest && explicitDebuggerCaptureGuard?.ready === true;
    if (shouldUpgradeByControl || shouldUpgradeByRequest) {
      commitAssistantMessage("message_patched", {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-upgrade", {
          title: "升级到正式调试",
          stage: "plan",
          status: "running",
          summary: "正在准备正式调试计划。",
          startedAt: nowMs()
        })
      });
      if (!input.context.projectId) {
        appendSystemAppendix(`

我可以先帮你梳理问题，不过正式调试要先选一个项目。选好项目后，你可以继续描述现象，或者直接打开一个 .rdc capture。`);
      } else {
        const captureGuard = resolveCaptureGuards(effectiveMessage, input.context);
        if (!captureGuard.ready) {
          appendSystemAppendix(`

${captureGuard.reason || "当前还不能进入正式分析。"}`);
        } else if (!hasUsableDebuggerRoute()) {
          appendSystemAppendix("\n\n当前调试链路还没绑定可用模型，所以我不能开始正式执行；不过我可以先帮你确认问题范围和所需 capture。");
        } else {
          if (abortController.signal.aborted) {
            this.clearActiveTurn(assistantMessage.turnId, abortController);
            return;
          }
          const requestedCapture = resolveOpenedCaptureDescriptor(input.context);
          const workflowResult = await debuggerRuntime.requestStartFromConversation({
            source: "conversation",
            message: assistantMessage,
            projectId: input.context.projectId,
            sessionId: input.context.session?.sessionId,
            turnId: assistantMessage.turnId,
            mode: "debugger",
            goal: input.rawMessage,
            captures: requestedCapture ? [requestedCapture] : void 0,
            primaryCaptureId: requestedCapture?.id,
            replayDevice: input.context.replayDevice
          });
          if (abortController.signal.aborted) {
            this.clearActiveTurn(assistantMessage.turnId, abortController);
            return;
          }
          const upgradeReply = buildWorkflowUpgradeReply(workflowResult);
          appendSystemAppendix(`

${upgradeReply}`);
          if (workflowResult.runId) {
            commitAssistantMessage("message_patched", {
              runId: workflowResult.runId
            });
            this.emitConversationEvent({
              type: "run_linked",
              sessionId: input.context.session?.sessionId ?? "",
              turnId: assistantMessage.turnId,
              runId: workflowResult.runId
            });
          }
        }
      }
      commitAssistantMessage("message_patched", {
        reasoningTrace: upsertTraceStep(assistantMessage.reasoningTrace, "cowork-upgrade", {
          status: "complete",
          summary: "正式调试升级判断已完成。",
          completedAt: nowMs()
        })
      });
    }
    commitAssistantMessage(finalStatus === "error" ? "message_errored" : "message_completed", {
      status: finalStatus,
      content: `${assistantContent}${systemAppendix}`,
      diagnostic: llmDiagnostic,
      ...withCoworkReasoning(finalizeTrace(
        upsertTraceStep(assistantMessage.reasoningTrace, "cowork-reply", {
          status: errorViewModel && !isRouteMissingDiagnostic ? "error" : "complete",
          summary: llmDiagnostic ? llmDiagnostic.code === "CONVERSATION_LLM_REQUEST_FAILED" ? "模型请求失败，已记录诊断。" : "模型链路不可用，已给出配置诊断。" : explicitDebuggerRequest ? "正式 Debugger 任务入口判断已完成。" : "协作回复已完成。",
          detail: llmDiagnostic?.technicalMessage,
          completedAt: nowMs()
        }),
        traceStatus,
        llmDiagnostic ? finalStatus === "error" ? "回复失败" : "等待模型配置" : explicitDebuggerRequest ? "已完成执行入口判断" : "回复已完成"
      ))
    });
    this.clearActiveTurn(assistantMessage.turnId, abortController);
  }
  persistConversationSnapshot(sessionId, message) {
    if (sessionId) {
      storageAdapter.appendConversationMessage(sessionId, message);
    }
  }
  emitConversationEvent(event) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }
  publishWorkstream(sessionId) {
    if (!sessionId) {
      return;
    }
    void agentWorkstreamProjector.getSession(sessionId).then((result) => {
      if (result.success && result.presentation) {
        workflowProjectionPublisher.publishWorkstreamChanged(sessionId, result.presentation);
      }
    }).catch((error) => {
      console.error("[ConversationService] Failed to publish workstream:", error);
    });
  }
  publishConversationWorkstream(workstreamSessionId, messages, persistedSessionId) {
    if (persistedSessionId) {
      this.publishWorkstream(persistedSessionId);
      return;
    }
    const presentation = agentWorkstreamProjector.buildConversationPresentation(workstreamSessionId, messages);
    workflowProjectionPublisher.publishWorkstreamChanged(workstreamSessionId, presentation);
  }
  ephemeralWorkstreamSessionId(turnId) {
    return `conversation-${turnId}`;
  }
}
const conversationService = new ConversationService();
function registerConversationHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("conversation:sendMessage", async (_event, request) => {
    const result = await conversationService.sendMessage({
      ...request,
      fallbackProjectId: state2.currentProjectId,
      fallbackSessionId: state2.currentSessionId,
      fallbackRunId: state2.currentRunId
    });
    if (result.session?.projectId) {
      state2.currentProjectId = result.session.projectId;
    }
    if (result.session?.sessionId) {
      state2.currentSessionId = result.session.sessionId;
      await storageAdapter.setCurrentSessionId(result.session.sessionId);
    }
    if (result.runUpdate?.runId) {
      state2.currentRunId = result.runUpdate.runId;
    }
    return result;
  });
  electron.ipcMain.handle("conversation:getHistory", async (_event, sessionId) => {
    if (!sessionId) {
      return { messages: [] };
    }
    return {
      messages: await conversationService.getHistory(sessionId)
    };
  });
  electron.ipcMain.handle("conversation:cancelActiveTurn", async (_event, request) => {
    return conversationService.cancelActiveTurn(request);
  });
}
const STALE_RECOVERABLE_RUN_STATUSES = [
  "planning",
  "queued",
  "running",
  "stopping"
];
async function recoverStaleRunOnSelection(run) {
  if (!run || !STALE_RECOVERABLE_RUN_STATUSES.includes(run.status)) {
    return run;
  }
  const isActive = runExecutionService.listActiveRuns().some((activeRun) => activeRun.runId === run.runId);
  if (isActive) {
    return run;
  }
  await storageAdapter.updateRun(run.sessionId, run.runId, {
    status: "interrupted",
    stopReason: "Recovered after app restart",
    stoppedAt: Date.now(),
    finishedAt: Date.now()
  });
  return storageAdapter.getLatestRun(run.sessionId);
}
function registerProjectSessionHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("project:list", async () => {
    return { projects: storageAdapter.listProjects() };
  });
  electron.ipcMain.handle("project:add", async (_event, rootPath) => {
    try {
      const project = storageAdapter.createProject(rootPath);
      await context2.selectCurrentProject(project.projectId);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:select", async (_event, projectId) => {
    try {
      const selection = await context2.selectCurrentProject(projectId);
      if (!selection.project) {
        return { success: false, error: `Project not found: ${projectId}` };
      }
      return {
        success: true,
        project: selection.project,
        currentSession: selection.currentSession,
        currentRun: selection.currentRun
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:rename", async (_event, projectId, newName) => {
    try {
      const project = storageAdapter.renameProject(projectId, newName);
      return { success: true, project };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle("project:remove", async (_event, projectId) => {
    try {
      storageAdapter.removeProject(projectId);
      if (state2.currentProjectId === projectId) {
        state2.currentProjectId = null;
        state2.currentSessionId = null;
        state2.currentRunId = null;
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
    context2.broadcastToRenderer("project:inputsChanged", { projectId, inputs });
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
    context2.broadcastToRenderer("project:inputsChanged", { projectId, inputs });
    return { success: true, inputs };
  });
  electron.ipcMain.handle("project:inputs:importPaths", async (_event, projectId, filePaths) => {
    try {
      const inputs = storageAdapter.importProjectInputs(projectId, filePaths ?? []);
      context2.broadcastToRenderer("project:inputsChanged", { projectId, inputs });
      return { success: true, inputs };
    } catch (error) {
      return {
        success: false,
        inputs: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("session:list", async (_event, projectId) => {
    const resolvedProjectId = projectId || state2.currentProjectId;
    if (!resolvedProjectId) {
      return { sessions: [] };
    }
    return { sessions: storageAdapter.listSessions(resolvedProjectId) };
  });
  electron.ipcMain.handle("session:create", async (_event, projectId, title) => {
    try {
      const session = storageAdapter.createSession(projectId, title);
      state2.currentProjectId = session.projectId;
      state2.currentSessionId = session.sessionId;
      state2.currentRunId = null;
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
  electron.ipcMain.handle("session:remove", async (_event, id) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    const runs = storageAdapter.listRuns(id);
    const activeRun = runs.find((run) => ["queued", "running", "stopping"].includes(run.status));
    if (activeRun) {
      runExecutionService.stopRun(activeRun.runId);
      toolBridge.abortRun(activeRun.runId);
      await context2.setRunLifecycleState(id, activeRun.runId, {
        status: "cancelled",
        lastStage: activeRun.lastStage,
        stopReason: "Session removed",
        stoppedAt: Date.now(),
        finishedAt: Date.now()
      });
    }
    storageAdapter.removeSession(id);
    const remainingSessions = storageAdapter.listSessions(session.projectId);
    const nextSession = remainingSessions[0] || null;
    let nextRun = null;
    if (state2.currentSessionId === id) {
      state2.currentSessionId = nextSession?.sessionId || null;
      state2.currentRunId = nextSession?.lastRunId || null;
      state2.currentProjectId = session.projectId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
        nextRun = storageAdapter.getLatestRun(state2.currentSessionId);
      } else {
        await storageAdapter.setCurrentSessionId(null);
        storageAdapter.setCurrentProjectId(session.projectId);
      }
    }
    return { success: true, nextSession, nextRun };
  });
  electron.ipcMain.handle("session:select", async (_event, id) => {
    const session = storageAdapter.readSession(id);
    if (!session) {
      return { success: false, error: `Session not found: ${id}` };
    }
    state2.currentSessionId = id;
    state2.currentProjectId = session.projectId;
    const currentRun = await recoverStaleRunOnSelection(storageAdapter.getLatestRun(id));
    state2.currentRunId = currentRun?.runId || session.lastRunId || null;
    await storageAdapter.setCurrentSessionId(id);
    return {
      success: true,
      session,
      currentRun
    };
  });
  electron.ipcMain.handle("session:attachments:list", async (_event, sessionId) => {
    return {
      attachments: storageAdapter.listSessionAttachments(sessionId)
    };
  });
  electron.ipcMain.handle("session:outputs:list", async (_event, sessionId, runId) => {
    if (!sessionId) {
      return { outputs: [] };
    }
    return {
      outputs: await context2.buildSessionOutputs(sessionId, runId)
    };
  });
  electron.ipcMain.handle("session:attachments:import", async (_event, sessionId, filePaths) => {
    try {
      return {
        success: true,
        attachments: storageAdapter.importSessionAttachments(sessionId, filePaths ?? [])
      };
    } catch (error) {
      return {
        success: false,
        attachments: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("run:list", async (_event, sessionId) => {
    return { runs: storageAdapter.listRuns(sessionId) };
  });
}
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
function resolvePowerShellPath() {
  const systemRoot = process.env.SystemRoot?.trim() || process.env.windir?.trim() || "C:\\Windows";
  const candidates = [
    path__namespace.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    path__namespace.join(systemRoot, "Sysnative", "WindowsPowerShell", "v1.0", "powershell.exe")
  ];
  const resolved = candidates.find((candidate) => fs__namespace.existsSync(candidate));
  return resolved ?? "powershell.exe";
}
function isDirectory(targetPath) {
  try {
    return fs__namespace.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
function resolveTerminalCwd(requestedCwd) {
  const candidates = [
    requestedCwd?.trim(),
    storageAdapter.getWorkspacePath(),
    electron.app.getPath("userData"),
    process.cwd()
  ].filter((candidate) => Boolean(candidate));
  for (const candidate of candidates) {
    const resolved = path__namespace.resolve(candidate);
    if (isDirectory(resolved)) {
      return resolved;
    }
  }
  return process.cwd();
}
function buildTabTitle(cwd) {
  return `PowerShell: ${cwd}`;
}
class TerminalSessionService {
  tabs = /* @__PURE__ */ new Map();
  listTabs() {
    return Array.from(this.tabs.values()).map((entry) => entry.record).sort((left, right) => left.createdAt - right.createdAt);
  }
  createTab(options) {
    const cwd = resolveTerminalCwd(options?.cwd);
    const tabId = `term_${generateShortId()}`;
    const shellPath = resolvePowerShellPath();
    const child = child_process.spawn(shellPath, ["-NoLogo"], {
      cwd,
      stdio: "pipe",
      windowsHide: true,
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const record = {
      tabId,
      kind: "shell",
      title: buildTabTitle(cwd),
      cwd,
      status: "running",
      createdAt: nowMs(),
      sessionId: options?.sessionId ?? null,
      projectId: options?.projectId ?? null,
      runId: options?.runId ?? null
    };
    const tabState = {
      record,
      process: child,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS
    };
    child.stdout.on("data", (chunk) => {
      this.broadcastData({ tabId, data: chunk });
    });
    child.stderr.on("data", (chunk) => {
      this.broadcastData({ tabId, data: chunk });
    });
    child.on("error", (error) => {
      const current = this.tabs.get(tabId);
      if (!current) {
        return;
      }
      current.record = {
        ...current.record,
        status: "exited",
        exitCode: null
      };
      this.broadcastData({
        tabId,
        data: `\r
[terminal failed to start: ${error.message}]\r
`
      });
      this.broadcastExit({ tabId, exitCode: null });
      this.broadcastTabsChanged();
    });
    child.on("close", (exitCode) => {
      const current = this.tabs.get(tabId);
      if (!current) {
        return;
      }
      current.record = {
        ...current.record,
        status: "exited",
        exitCode
      };
      this.broadcastExit({ tabId, exitCode });
      this.broadcastTabsChanged();
    });
    this.tabs.set(tabId, tabState);
    this.broadcastTabsChanged();
    return record;
  }
  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return this.listTabs();
    }
    if (tab.record.status === "running") {
      tab.process.stdin.write("exit\r\n");
      tab.process.kill();
    }
    this.tabs.delete(tabId);
    this.broadcastTabsChanged();
    return this.listTabs();
  }
  activateTab(_tabId) {
    return this.listTabs();
  }
  write(tabId, data) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.record.status !== "running") {
      return;
    }
    tab.process.stdin.write(data);
  }
  resize(tabId, cols, rows) {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      return;
    }
    tab.cols = cols;
    tab.rows = rows;
  }
  disposeAll() {
    for (const tabId of Array.from(this.tabs.keys())) {
      this.closeTab(tabId);
    }
  }
  broadcastData(payload) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("terminal:data", payload);
      }
    }
  }
  broadcastExit(payload) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("terminal:exit", payload);
      }
    }
  }
  broadcastTabsChanged() {
    const tabs = this.listTabs();
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("terminal:tabsChanged", { tabs });
      }
    }
  }
}
const terminalSessionService = new TerminalSessionService();
function registerRuntimeTerminalHandlers() {
  electron.ipcMain.handle("runtimeLog:list", async (_event, request) => {
    return {
      entries: runtimeLogService.list(request.scope, request.sessionId)
    };
  });
  electron.ipcMain.handle("terminal:listTabs", async () => {
    return {
      tabs: terminalSessionService.listTabs()
    };
  });
  electron.ipcMain.handle("terminal:createTab", async (_event, request) => {
    try {
      const tab = terminalSessionService.createTab(request);
      return {
        success: true,
        tab,
        tabs: terminalSessionService.listTabs()
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("terminal:closeTab", async (_event, tabId) => {
    try {
      return {
        success: true,
        tabs: terminalSessionService.closeTab(tabId)
      };
    } catch (error) {
      return {
        success: false,
        tabs: terminalSessionService.listTabs(),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("terminal:activateTab", async (_event, tabId) => {
    return {
      success: true,
      tabs: terminalSessionService.activateTab(tabId)
    };
  });
  electron.ipcMain.handle("terminal:write", async (_event, tabId, data) => {
    try {
      terminalSessionService.write(tabId, data);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
  electron.ipcMain.handle("terminal:resize", async (_event, tabId, cols, rows) => {
    try {
      terminalSessionService.resize(tabId, cols, rows);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });
}
const REQUEST_TIMEOUT_MS = 2e4;
function normalizeDiscoveredModels(values, filterModelId = () => true) {
  const models = /* @__PURE__ */ new Map();
  for (const value of values) {
    const id = typeof value === "string" ? value.trim() : value && typeof value === "object" && typeof value.id === "string" ? value.id.trim() : value && typeof value === "object" && typeof value.name === "string" ? value.name.trim() : "";
    if (!id || isDeprecatedModel(id) || !filterModelId(id) || models.has(id)) {
      continue;
    }
    const label = value && typeof value === "object" && typeof value.display_name === "string" ? value.display_name.trim() || id : id;
    models.set(id, {
      id,
      label,
      enabled: true
    });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}
function parseProviderError(error) {
  if (error instanceof ProviderConnectionError) {
    return error.message;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "连接测试超时，请稍后重试";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "连接测试失败";
}
class ProviderConnectionError extends Error {
}
const isDeprecatedModel = (modelId) => {
  const normalized = modelId.toLowerCase();
  return normalized.includes("deprecated") || normalized.startsWith("gpt-3.5") || normalized.startsWith("claude-2") || normalized.startsWith("claude-instant");
};
const isAgentRoutableOpenAiModel = (modelId) => {
  const normalized = modelId.toLowerCase();
  return !(normalized.includes("embedding") || normalized.includes("moderation") || normalized.includes("rerank") || normalized.includes("whisper") || normalized.includes("tts") || normalized.includes("dall-e") || normalized.includes("image") || normalized.includes("audio") || normalized.includes("realtime") || normalized.includes("transcribe") || normalized.includes("computer-use"));
};
const requireModels = (models) => {
  if (models.length === 0) {
    throw new ProviderConnectionError("Provider 暂未返回可用于 Agent 路由的模型");
  }
  return models;
};
const toStaticModels = (modelIds) => requireModels(
  normalizeDiscoveredModels(modelIds)
);
const getJson = async (url2, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url2, {
      ...init,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ProviderConnectionError(formatHttpError(response.status));
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};
const formatHttpError = (status) => {
  if (status === 401 || status === 403) {
    return "API Key 无效或权限不足";
  }
  if (status === 404) {
    return "模型发现端点不可用";
  }
  if (status >= 500) {
    return "Provider 服务暂时不可用";
  }
  return `连接测试失败（HTTP ${status}）`;
};
const appendPath = (baseUrl, path2) => `${baseUrl.trim().replace(/\/+$/, "")}/${path2.replace(/^\/+/, "")}`;
const appendQueryParam = (url2, key, value) => {
  const separator = url2.includes("?") ? "&" : "?";
  return `${url2}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};
const parseModelsPayload = (strategy, payload) => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload;
  if (strategy === "ollama-tags") {
    return Array.isArray(record.models) ? normalizeDiscoveredModels(record.models) : [];
  }
  if (strategy === "google-ai-studio") {
    const googleModels = Array.isArray(record.models) ? record.models : [];
    return normalizeDiscoveredModels(
      googleModels.filter((value) => {
        const methods = value && typeof value === "object" ? value.supportedGenerationMethods : null;
        return !Array.isArray(methods) || methods.includes("generateContent");
      }).map((value) => {
        if (value && typeof value === "object" && typeof value.name === "string") {
          return {
            ...value,
            id: value.name.replace(/^models\//, "")
          };
        }
        return value;
      }),
      isAgentRoutableOpenAiModel
    );
  }
  return Array.isArray(record.data) ? normalizeDiscoveredModels(record.data, isAgentRoutableOpenAiModel) : [];
};
const createTinyAnthropicProbeBody = (modelId) => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: "user", content: "ping" }]
});
const createTinyOpenAiProbeBody = (modelId) => JSON.stringify({
  model: modelId,
  max_tokens: 1,
  messages: [{ role: "user", content: "ping" }]
});
class ProviderConnectionService {
  async testProviderDraft(request) {
    try {
      const provider = this.getProvider(request.providerId);
      const models = await this.discoverModels(
        provider,
        request.apiKey?.trim() ?? "",
        request.baseUrl?.trim() ?? ""
      );
      return {
        success: true,
        provider,
        models
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  async connectProvider(request) {
    try {
      const provider = this.getProvider(request.providerId);
      const apiKey = request.apiKey?.trim() ?? "";
      const baseUrl = request.baseUrl?.trim() ?? "";
      const models = await this.discoverModels(provider, apiKey, baseUrl);
      const nextSettings = settingsService.saveProviderConnection(provider.id, apiKey, models, baseUrl);
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      return {
        success: true,
        provider: nextProvider,
        models
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  async refreshProviderModels(providerId) {
    try {
      const provider = this.getProvider(providerId);
      if (provider.authMode === "account") {
        const status = await providerAccountAuthService.test(provider.id);
        if (!status.connected) {
          throw new ProviderConnectionError(status.error || status.message || "Account provider is not connected");
        }
        const nextProvider2 = settingsService.getAll().llm.providers.find((entry) => entry.id === provider.id);
        return {
          success: true,
          provider: nextProvider2,
          models: nextProvider2?.models ?? []
        };
      }
      const models = await this.discoverModels(provider, "", "");
      const nextSettings = settingsService.saveProviderConnection(provider.id, "", models, "");
      const nextProvider = nextSettings.llm.providers.find((entry) => entry.id === provider.id);
      return {
        success: true,
        provider: nextProvider,
        models
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  disconnectProvider(providerId) {
    try {
      const nextSettings = settingsService.disconnectProvider(providerId);
      const provider = nextSettings.llm.providers.find((entry) => entry.id === providerId);
      return {
        success: true,
        provider,
        models: []
      };
    } catch (error) {
      return {
        success: false,
        models: [],
        error: parseProviderError(error)
      };
    }
  }
  startProviderAccountLogin(providerId) {
    return providerAccountAuthService.startLogin(providerId);
  }
  finishProviderAccountLogin(request) {
    return providerAccountAuthService.finishLogin(request);
  }
  getProviderAccountStatus(providerId) {
    return providerAccountAuthService.status(providerId);
  }
  logoutProviderAccount(providerId) {
    return providerAccountAuthService.logout(providerId);
  }
  getProvider(providerId) {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    if (!provider || !isBuiltinProviderId(provider.id)) {
      throw new ProviderConnectionError("未知 Provider");
    }
    return provider;
  }
  async discoverModels(provider, apiKeyDraft, baseUrlDraft) {
    if (provider.authMode === "account") {
      throw new ProviderConnectionError("Account providers must be tested through the account login flow.");
    }
    const definition = getBuiltinProviderDefinition(provider.id);
    if (!definition?.modelDiscovery) {
      throw new ProviderConnectionError("Provider 缺少模型发现配置");
    }
    const apiKey = provider.authMode === "api-key" ? apiKeyDraft || settingsService.getProviderSecret(provider.id) : "";
    if (provider.authMode === "api-key" && !apiKey) {
      throw new ProviderConnectionError("请输入 API Key");
    }
    const strategy = definition.modelDiscovery;
    if (strategy === "static") {
      return toStaticModels(definition.recommendedModels);
    }
    const baseUrl = (baseUrlDraft || provider.baseUrl || definition.baseUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new ProviderConnectionError("请填写 Provider Base URL");
    }
    if (provider.id === "kimi-code") {
      return this.validateKimiCodeModels(apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === "anthropic-candidate-validation") {
      return this.validateAnthropicCandidateModels(provider, apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === "azure-openai") {
      return this.validateAzureCandidateModels(apiKey, baseUrl, definition.recommendedModels);
    }
    if (strategy === "google-ai-studio") {
      const payload2 = await getJson(appendQueryParam(appendPath(baseUrl, "/models"), "key", apiKey), {
        method: "GET"
      });
      return requireModels(parseModelsPayload(strategy, payload2));
    }
    const url2 = strategy === "ollama-tags" ? appendPath(new URL(baseUrl).origin, "/api/tags") : appendPath(baseUrl, "/models");
    const headers = this.createHeaders(provider, apiKey);
    const payload = await getJson(url2, {
      method: "GET",
      headers
    });
    return requireModels(parseModelsPayload(strategy, payload));
  }
  async validateAnthropicCandidateModels(provider, apiKey, baseUrl, modelIds) {
    const validModels = [];
    const url2 = appendPath(baseUrl, "/messages");
    const headers = this.createHeaders(provider, apiKey);
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url2, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: createTinyAnthropicProbeBody(modelId)
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
      }
    }
    return toStaticModels(validModels);
  }
  async validateKimiCodeModels(apiKey, baseUrl, modelIds) {
    const payload = await getJson(appendPath(baseUrl, "/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const availableModelIds = new Set(
      parseModelsPayload("openai-compatible", payload).map((model) => model.id)
    );
    return toStaticModels(modelIds.filter((modelId) => availableModelIds.has(modelId)));
  }
  async validateAzureCandidateModels(apiKey, baseUrl, modelIds) {
    const validModels = [];
    const chatUrl = appendQueryParam(
      baseUrl.endsWith("/chat/completions") ? baseUrl : appendPath(baseUrl, "/chat/completions"),
      "api-version",
      "2024-10-21"
    );
    for (const modelId of modelIds) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(chatUrl, {
          method: "POST",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json"
          },
          signal: controller.signal,
          body: createTinyOpenAiProbeBody(modelId)
        });
        clearTimeout(timeout);
        if (response.ok) {
          validModels.push(modelId);
        }
      } catch {
      }
    }
    return toStaticModels(validModels);
  }
  createHeaders(provider, apiKey) {
    if (provider.authMode === "local") {
      return {};
    }
    if (provider.kind === "anthropic") {
      return {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      };
    }
    return {
      Authorization: `Bearer ${apiKey}`
    };
  }
}
const providerConnectionService = new ProviderConnectionService();
function registerSettingsLlmHandlers(context2) {
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
  electron.ipcMain.handle("llm:testProviderDraft", async (_event, request) => {
    return providerConnectionService.testProviderDraft(request);
  });
  electron.ipcMain.handle("llm:connectProvider", async (_event, request) => {
    const result = await providerConnectionService.connectProvider(request);
    if (result.success) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:refreshProviderModels", async (_event, providerId) => {
    const result = await providerConnectionService.refreshProviderModels(providerId);
    if (result.success) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:disconnectProvider", async (_event, providerId) => {
    const result = providerConnectionService.disconnectProvider(providerId);
    if (result.success) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:startProviderAccountLogin", async (_event, providerId) => {
    return providerConnectionService.startProviderAccountLogin(providerId);
  });
  electron.ipcMain.handle("llm:getProviderAccountStatus", async (_event, providerId) => {
    const result = providerConnectionService.getProviderAccountStatus(providerId);
    if (result.connected) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:finishProviderAccountLogin", async (_event, request) => {
    const result = await providerConnectionService.finishProviderAccountLogin(request);
    if (result.connected) {
      context2.applyCurrentLlmConfig();
    }
    return result;
  });
  electron.ipcMain.handle("llm:logoutProviderAccount", async (_event, providerId) => {
    const result = providerConnectionService.logoutProviderAccount(providerId);
    context2.applyCurrentLlmConfig();
    return result;
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
    await context2.initializeIpcState();
    context2.applyCurrentLlmConfig();
    return nextSettings;
  });
}
const AVATAR_MIME_BY_EXTENSION = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp"
};
function getAvatarMimeType(filePath) {
  return AVATAR_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null;
}
function isSameFilePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
}
function copyAvatarToWorkspace(sourcePath) {
  const mimeType = getAvatarMimeType(sourcePath);
  if (!mimeType || !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return null;
  }
  const paths = appPathService.getWorkspacePaths();
  const avatarDir = path.join(paths.profilesPath, "avatar");
  const extension = path.extname(sourcePath).toLowerCase();
  const avatarPath = path.join(avatarDir, `profile-avatar${extension}`);
  fs.mkdirSync(avatarDir, { recursive: true });
  if (!isSameFilePath(sourcePath, avatarPath)) {
    fs.copyFileSync(sourcePath, avatarPath);
  }
  return avatarPath;
}
function readAvatarDataUrl(avatarPath) {
  const mimeType = getAvatarMimeType(avatarPath);
  if (!mimeType || !fs.existsSync(avatarPath) || !fs.statSync(avatarPath).isFile()) {
    return null;
  }
  const content = fs.readFileSync(avatarPath);
  return `data:${mimeType};base64,${content.toString("base64")}`;
}
function registerShellHandlers() {
  electron.ipcMain.handle("dialog:selectRdcFiles", async () => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "RenderDoc Capture", extensions: ["rdc"] }],
      properties: ["openFile", "multiSelections"]
    });
    return result.canceled ? null : result.filePaths;
  });
  electron.ipcMain.handle("dialog:selectFiles", async () => {
    const result = await electron.dialog.showOpenDialog({
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
      systemTheme: electron.nativeTheme.shouldUseDarkColors ? "dark" : "light",
      testMode: process.env.RDC_AGENT_TEST_MODE === "1"
    };
  });
  electron.ipcMain.handle("app:selectAvatar", async () => {
    const result = await electron.dialog.showOpenDialog({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    try {
      return copyAvatarToWorkspace(result.filePaths[0]);
    } catch (error) {
      console.warn("[IPC] Failed to import avatar:", error);
      return null;
    }
  });
  electron.ipcMain.handle("app:getAvatarDataUrl", async (_event, avatarPath) => {
    if (!avatarPath) {
      return null;
    }
    try {
      return readAvatarDataUrl(avatarPath);
    } catch (error) {
      console.warn("[IPC] Failed to read avatar:", error);
      return null;
    }
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
}
const ACTION_ARTIFACT_KEYS = [
  "artifactPath",
  "artifact_path",
  "filePath",
  "file_path",
  "imagePath",
  "image_path",
  "outputPath",
  "output_path",
  "reportPath",
  "report_path",
  "savedPath",
  "saved_path",
  "path"
];
function inferMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const table = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".json": "application/json",
    ".html": "text/html",
    ".htm": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".csv": "text/csv"
  };
  return table[extension];
}
function readFileTimestamps(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return {};
    }
    return {
      sizeBytes: stat.size,
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs
    };
  } catch {
    return {};
  }
}
function parseTimestamp(value) {
  if (typeof value === "number") {
    return value;
  }
  if (!value) {
    return void 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function outputKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function addSessionOutput(outputs, seen, output) {
  const key = outputKey(output.filePath);
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  outputs.push(output);
}
function isLikelyFilePath(value) {
  return /[\\/]/.test(value) || /\.(md|txt|log|json|html?|png|jpe?g|webp|gif|csv)$/i.test(value);
}
function collectActionArtifactPaths(value, results = /* @__PURE__ */ new Set()) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectActionArtifactPaths(entry, results));
    return results;
  }
  if (!value || typeof value !== "object") {
    return results;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && ACTION_ARTIFACT_KEYS.includes(key) && isLikelyFilePath(entry)) {
      results.add(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      collectActionArtifactPaths(entry, results);
    }
  }
  return results;
}
function resolveActionArtifactPath(sessionId, runId, filePath) {
  if (path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  try {
    return path.resolve(storageAdapter.getRunPath(sessionId, runId), filePath);
  } catch {
    return path.resolve(filePath);
  }
}
async function buildSessionOutputs(sessionId, runId) {
  const outputs = [];
  const seen = /* @__PURE__ */ new Set();
  const targetRuns = runId ? storageAdapter.listRuns(sessionId).filter((run) => run.runId === runId) : storageAdapter.listRuns(sessionId);
  for (const attachment of storageAdapter.listSessionAttachments(sessionId)) {
    addSessionOutput(outputs, seen, {
      id: attachment.attachmentId,
      kind: "attachment",
      title: attachment.fileName,
      fileName: attachment.fileName,
      filePath: attachment.filePath,
      source: "session attachment",
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
      createdAt: attachment.createdAt,
      updatedAt: attachment.createdAt
    });
  }
  for (const run of targetRuns) {
    const reportEntries = [
      { id: "markdown", title: "report.md", filePath: run.reportPaths?.markdownPath },
      { id: "json", title: "report.json", filePath: run.reportPaths?.jsonPath },
      { id: "html", title: "visual_report.html", filePath: run.reportPaths?.htmlPath }
    ].filter((entry) => Boolean(entry.filePath));
    for (const report of reportEntries) {
      addSessionOutput(outputs, seen, {
        id: `${run.runId}:report:${report.id}`,
        kind: "report",
        title: report.title,
        fileName: path.basename(report.filePath),
        filePath: report.filePath,
        source: "run report",
        runId: run.runId,
        mimeType: inferMimeType(report.filePath),
        ...readFileTimestamps(report.filePath)
      });
    }
    for (const artifact of artifactStore.list(sessionId, run.runId)) {
      addSessionOutput(outputs, seen, {
        id: artifact.artifactId,
        kind: "artifact",
        title: artifact.title || path.basename(artifact.filePath),
        fileName: path.basename(artifact.filePath),
        filePath: artifact.filePath,
        source: "artifact store",
        runId: artifact.runId,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        createdAt: parseTimestamp(artifact.createdAt),
        updatedAt: parseTimestamp(artifact.updatedAt)
      });
    }
  }
  const targetRunIds = new Set(targetRuns.map((run) => run.runId));
  try {
    const actionEvents = await storageAdapter.readActionChain(sessionId);
    for (const event of actionEvents) {
      if (runId && !targetRunIds.has(event.run_id)) {
        continue;
      }
      const artifactPaths = collectActionArtifactPaths(event.payload);
      for (const artifactPath of artifactPaths) {
        const resolvedPath = resolveActionArtifactPath(sessionId, event.run_id, artifactPath);
        addSessionOutput(outputs, seen, {
          id: `${event.event_id}:${outputKey(resolvedPath)}`,
          kind: "action_artifact",
          title: path.basename(resolvedPath),
          fileName: path.basename(resolvedPath),
          filePath: resolvedPath,
          source: event.event_type,
          runId: event.run_id,
          mimeType: inferMimeType(resolvedPath),
          createdAt: event.ts_ms,
          updatedAt: event.ts_ms,
          ...readFileTimestamps(resolvedPath)
        });
      }
    }
  } catch {
  }
  return outputs.sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0));
}
function registerToolEvidenceHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("tool:getCatalog", async () => {
    try {
      return await toolBridge.loadCatalog();
    } catch {
      return { tools: [], namespaces: {} };
    }
  });
  electron.ipcMain.handle("tool:getRuntimeSummary", async () => {
    return toolBridge.getRuntimeSummary();
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
    const events2 = await storageAdapter.readActionChain(sessionId);
    return {
      sessionId,
      runId: state2.currentRunId || storageAdapter.getLatestRun(sessionId)?.runId || "",
      events: events2,
      isValid: true
    };
  });
  electron.ipcMain.handle("evidence:getEvents", async (_event, eventType) => {
    const sessionId = await storageAdapter.getCurrentSessionId();
    if (!sessionId) return [];
    const events2 = await storageAdapter.readActionChain(sessionId);
    if (eventType) {
      return events2.filter((event) => event.event_type === eventType);
    }
    return events2;
  });
}
function registerWorkflowHandlers(context2) {
  const { state: state2 } = context2;
  electron.ipcMain.handle("workflow:getState", async () => {
    if (!state2.currentSessionId) {
      return null;
    }
    try {
      return await debuggerRuntime.getWorkflowState(state2.currentSessionId, state2.currentRunId || void 0);
    } catch (error) {
      console.error("[IPC] Failed to get workflow state:", error);
      return null;
    }
  });
  electron.ipcMain.handle("workflow:resume", async (_event, sessionId) => {
    try {
      if (sessionId) {
        state2.currentSessionId = sessionId;
        await storageAdapter.setCurrentSessionId(sessionId);
        state2.currentRunId = storageAdapter.getLatestRun(sessionId)?.runId || null;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  electron.ipcMain.handle("workflow:stop", async (_event, runId) => {
    const targetRunId = runId || state2.currentRunId;
    if (!targetRunId) {
      return { success: false, error: "No active run." };
    }
    const result = await debuggerRuntime.stopRun(targetRunId);
    context2.broadcastToRenderer("capture:openedStateChanged", null);
    context2.broadcastToRenderer("context:changed", rdxSessionService.snapshotContext());
    return result;
  });
  electron.ipcMain.handle("workflow:getRunUsage", async (_event, runId) => {
    const targetRunId = runId || state2.currentRunId;
    if (!targetRunId) {
      return { usage: null };
    }
    return {
      usage: debuggerLlmService.getRunContextUsage(targetRunId)
    };
  });
  electron.ipcMain.handle("workflow:listRuns", async () => {
    if (!state2.currentSessionId) {
      return { runs: [] };
    }
    return { runs: storageAdapter.listRuns(state2.currentSessionId) };
  });
  electron.ipcMain.handle("workflow:listActiveRuns", async () => {
    return { runs: runExecutionService.listActiveRuns() };
  });
  electron.ipcMain.handle("workflow:start", async (_event, request) => {
    const result = await debuggerRuntime.startPlan(request);
    if (result.success) {
      state2.currentSessionId = result.sessionId || state2.currentSessionId;
      state2.currentRunId = result.runId || state2.currentRunId;
      state2.currentProjectId = request.projectId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
      }
    }
    return result;
  });
  electron.ipcMain.handle("workflow:getPlan", async (_event, runId) => {
    return debuggerRuntime.getPlan(runId);
  });
  electron.ipcMain.handle("workflow:submitQuestions", async (_event, runId, answers) => {
    return debuggerRuntime.submitQuestions(runId, answers);
  });
  electron.ipcMain.handle("workflow:approvePlan", async (_event, runId) => {
    return debuggerRuntime.approvePlan(runId);
  });
  electron.ipcMain.handle("workflow:getWorkstreamSession", async (_event, sessionId) => {
    const targetSessionId = sessionId || state2.currentSessionId;
    if (!targetSessionId) {
      return { success: false, error: "No active session." };
    }
    return debuggerRuntime.getWorkstreamSession(targetSessionId);
  });
  electron.ipcMain.handle("workflow:requestPlanRevision", async (_event, runId, revisionText) => {
    const result = await debuggerRuntime.requestPlanRevision(runId, revisionText);
    if (result.success) {
      state2.currentSessionId = result.session?.sessionId || state2.currentSessionId;
      state2.currentRunId = result.runId || state2.currentRunId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
      }
    }
    return result;
  });
  electron.ipcMain.handle("workflow:switchWorkstreamBranch", async (_event, sessionId, branchId) => {
    return debuggerRuntime.switchWorkstreamBranch(sessionId, branchId);
  });
  electron.ipcMain.handle("workflow:exportWorkstreamSession", async (_event, sessionId, options) => {
    return debuggerRuntime.exportWorkstreamSession(sessionId, options);
  });
  electron.ipcMain.handle("workflow:restartRun", async (_event, runId) => {
    const result = await debuggerRuntime.restartRun(runId);
    if (result.success) {
      state2.currentSessionId = result.sessionId || state2.currentSessionId;
      state2.currentRunId = result.runId || state2.currentRunId;
      if (state2.currentSessionId) {
        await storageAdapter.setCurrentSessionId(state2.currentSessionId);
      }
    }
    return result;
  });
}
const state = {
  currentSessionId: null,
  currentProjectId: null,
  currentRunId: null
};
let toolTraceSubscribed = false;
let nativeThemeSubscribed = false;
async function initializeIpcState() {
  try {
    state.currentSessionId = await storageAdapter.getCurrentSessionId();
    state.currentProjectId = storageAdapter.getCurrentProjectId();
    state.currentRunId = state.currentSessionId ? storageAdapter.getLatestRun(state.currentSessionId)?.runId || null : null;
  } catch (error) {
    console.warn("[IPC] Failed to restore current session id:", error);
    state.currentSessionId = null;
    state.currentProjectId = null;
    state.currentRunId = null;
  }
  await debuggerRuntime.recoverInterruptedRuns();
}
function broadcastToRenderer(channel, ...args) {
  const windows = electron.BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}
function broadcastRunStatusChanged(payload) {
  broadcastToRenderer("workflow:runStatusChanged", payload);
}
function applyCurrentLlmConfig() {
  const llmConfig = settingsService.getLlmConfig();
  llmAdapter.configure(llmConfig);
  agentOrchestrator.applyLlmConfig(llmConfig);
}
async function appendActionEvent(event) {
  await storageAdapter.appendActionEvent(event.session_id, event);
  broadcastToRenderer("evidence:eventAdded", event);
}
async function setRunLifecycleState(sessionId, runId, patch) {
  const updatePayload = {
    status: patch.status
  };
  if (patch.lastStage) {
    updatePayload.lastStage = patch.lastStage;
    updatePayload.runtime = {
      workflow_stage: patch.lastStage
    };
  }
  if (patch.stopReason) {
    updatePayload.stopReason = patch.stopReason;
  }
  if (patch.stoppedAt) {
    updatePayload.stoppedAt = patch.stoppedAt;
  }
  if (patch.finishedAt) {
    updatePayload.finishedAt = patch.finishedAt;
  }
  await storageAdapter.updateRun(sessionId, runId, updatePayload);
  broadcastRunStatusChanged({
    runId,
    sessionId,
    status: patch.status,
    lastStage: patch.lastStage,
    stopReason: patch.stopReason
  });
}
async function selectCurrentProject(projectId) {
  if (!projectId) {
    state.currentProjectId = null;
    state.currentSessionId = null;
    state.currentRunId = null;
    storageAdapter.setCurrentProjectId(null);
    return {
      project: null,
      currentSession: null,
      currentRun: null
    };
  }
  const project = storageAdapter.getProjectById(projectId);
  if (!project) {
    return {
      project: null,
      currentSession: null,
      currentRun: null
    };
  }
  state.currentProjectId = projectId;
  const selectedSession = state.currentSessionId ? storageAdapter.readSession(state.currentSessionId) : null;
  if (!selectedSession || selectedSession.projectId !== projectId) {
    state.currentSessionId = null;
    state.currentRunId = null;
    await storageAdapter.setCurrentSessionId(null);
  } else {
    state.currentRunId = selectedSession.lastRunId || state.currentRunId;
  }
  storageAdapter.setCurrentProjectId(projectId);
  return {
    project,
    currentSession: selectedSession?.projectId === projectId ? selectedSession : null,
    currentRun: state.currentSessionId ? storageAdapter.getLatestRun(state.currentSessionId) : null
  };
}
const context = {
  state,
  broadcastToRenderer,
  broadcastRunStatusChanged,
  applyCurrentLlmConfig,
  setRunLifecycleState,
  selectCurrentProject,
  buildSessionOutputs,
  initializeIpcState
};
function registerToolTraceBridge() {
  if (toolTraceSubscribed) {
    return;
  }
  toolBridge.onToolTrace((trace) => {
    broadcastToRenderer("tool:executionComplete", trace);
    if (state.currentSessionId && state.currentRunId) {
      void appendActionEvent(storageAdapter.createActionEvent({
        runId: state.currentRunId,
        sessionId: state.currentSessionId,
        agentId: trace.runtimeOwner || "rdc-debugger",
        eventType: "tool_execution",
        status: trace.result.ok ? "ok" : "error",
        turnId: trace.turnId,
        payload: {
          tool_name: trace.toolName,
          args: trace.args,
          result: trace.result.ok ? "success" : "failed",
          error: trace.result.error,
          trace_id: trace.traceId
        }
      }));
    }
    runtimeLogService.log({
      scope: state.currentSessionId ? "session" : "app",
      namespace: "tool",
      severity: trace.result.ok ? "success" : "error",
      title: trace.toolName,
      summary: trace.result.ok ? "工具调用已完成。" : trace.result.error?.message ?? "工具调用失败。",
      detail: trace.result.duration_ms ? `${trace.result.duration_ms}ms` : void 0,
      sessionId: state.currentSessionId,
      projectId: state.currentProjectId,
      runId: state.currentRunId,
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
function preloadLlmConfig() {
  try {
    applyCurrentLlmConfig();
    console.log("[IPC] Loaded persisted LLM config");
  } catch (err) {
    console.warn("[IPC] Failed to preload LLM config:", err);
  }
}
function registerNativeThemeBridge() {
  if (nativeThemeSubscribed) {
    return;
  }
  electron.nativeTheme.on("updated", () => {
    broadcastToRenderer("app:themeChanged", electron.nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
  nativeThemeSubscribed = true;
}
function registerIPCHandlers() {
  registerToolTraceBridge();
  preloadLlmConfig();
  registerShellHandlers();
  registerConversationHandlers(context);
  registerWorkflowHandlers(context);
  registerProjectSessionHandlers(context);
  registerRuntimeTerminalHandlers();
  registerCaptureDeviceHandlers(context);
  registerAgentHandlers(context);
  registerToolEvidenceHandlers(context);
  registerSettingsLlmHandlers(context);
  registerNativeThemeBridge();
}
function setMainWindow(window) {
  replayDeviceService.setMainWindow(window);
  agentOrchestrator.setMainWindow(window);
}
async function stopAllActiveRuns() {
  await runExecutionService.stopAll();
}
const emptyPreviewLoadResult = () => ({
  preview: null,
  error: null,
  attempts: []
});
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
  humanPreview = {
    status: "closed",
    updatedAt: Date.now()
  };
  constructor(toolBridge2) {
    this.toolBridge = toolBridge2;
  }
  async bootstrap(request) {
    const requestedCaptures = request.captures ?? [];
    const requestedReplayDevice = request.replayDevice ?? null;
    if (this.canReuseOpenedCapture(request)) {
      this.captures = requestedCaptures.map((capture) => capture.id === request.primaryCaptureId && this.openedCapture ? {
        ...capture,
        captureFileId: this.openedCapture.captureFileId,
        status: "open",
        sessionId: this.openedCapture.sessionId,
        replaySessionId: this.openedCapture.replaySessionId,
        contextId: this.openedCapture.contextId
      } : { ...capture });
      this.activeCaptureId = request.primaryCaptureId || null;
      return this.snapshotContext();
    }
    if (this.contextId || this.captures.length > 0 || this.openedCapture) {
      await this.closeOrReplaceOpenedCapture();
    }
    await this.ensureRuntimeReady();
    this.captures = requestedCaptures.map((capture) => ({ ...capture }));
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === "remote");
    let replayDevice = requestedReplayDevice;
    let reusedPreparedRemote = false;
    if (hasRemoteCapture) {
      if (!replayDevice || replayDevice.type === "local") {
        throw new Error("Remote capture requires an Android Replay Device.");
      }
      replayDevice = await this.ensureReplayDeviceReady(replayDevice);
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(replayDevice);
    }
    if (!replayDevice) {
      throw new Error("Replay Device is required before bootstrap.");
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
    const previewResult = await this.ensureCaptureSession(capture, {
      projectId: request.projectId,
      inputId: request.inputId
    });
    const openedCapture = this.createOpenedCaptureState(
      request.projectId,
      request.inputId,
      request.filePath,
      replayDevice,
      previewResult
    );
    this.openedCapture = openedCapture;
    return openedCapture;
  }
  async closeOrReplaceOpenedCapture() {
    const previousCapture = this.openedCapture;
    await this.teardownRuntime();
    this.resetRuntimeState(previousCapture);
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
  async openHumanPreviewWindow(request = {}) {
    const replaySessionId = request.sessionId || this.snapshotContext().sessionId;
    if (!this.contextId || !this.runtimeOwner || !this.ownerLeaseId || !replaySessionId) {
      this.setHumanPreview({
        status: "unavailable",
        sessionId: replaySessionId || void 0,
        lastError: "Runtime context, owner lease, or replay session is not available."
      });
      return this.snapshotContext();
    }
    this.setHumanPreview({
      status: "opening",
      sessionId: replaySessionId
    });
    const result = await this.toolBridge.call({
      toolName: "rd.session.open_preview",
      args: {
        session_id: replaySessionId,
        context_id: this.contextId,
        runtime_owner: this.runtimeOwner,
        owner_lease_id: this.ownerLeaseId
      },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId
    });
    if (!result.ok) {
      const message = result.error?.message ?? "rd.session.open_preview failed.";
      this.setHumanPreview({
        status: "error",
        sessionId: replaySessionId,
        lastError: message
      });
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Human preview unavailable",
        summary: message,
        raw: { result }
      });
      return this.snapshotContext();
    }
    this.setHumanPreview(this.extractHumanPreview(result, "open", replaySessionId));
    return this.snapshotContext();
  }
  async closeHumanPreviewWindow() {
    if (!this.contextId || !this.runtimeOwner || !this.ownerLeaseId) {
      this.setHumanPreview({ status: "closed" });
      return this.snapshotContext();
    }
    const result = await this.toolBridge.call({
      toolName: "rd.session.close_preview",
      args: {
        context_id: this.contextId,
        runtime_owner: this.runtimeOwner,
        owner_lease_id: this.ownerLeaseId
      },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner,
      ownerLeaseId: this.ownerLeaseId
    });
    if (!result.ok) {
      const message = result.error?.message ?? "rd.session.close_preview failed.";
      this.setHumanPreview({
        status: "error",
        sessionId: this.humanPreview.sessionId,
        boundEventId: this.humanPreview.boundEventId,
        lastError: message
      });
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Human preview close warning",
        summary: message,
        raw: { result }
      });
      return this.snapshotContext();
    }
    this.setHumanPreview(this.extractHumanPreview(result, "closed", this.humanPreview.sessionId));
    return this.snapshotContext();
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
    let result = await this.toolBridge.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId },
      contextId
    });
    if (!result.ok) {
      if (result.error?.message?.includes("Context limit exceeded")) {
        const daemonCleaned = await this.cleanupDaemonRuntimeState();
        if (daemonCleaned) {
          result = await this.toolBridge.call({
            toolName: "rd.session.create_context",
            args: { context_id: contextId },
            contextId
          });
          if (result.ok) {
            return contextId;
          }
        }
        const cleanedCount = await this.cleanupStaleRdcAgentContexts();
        if (cleanedCount > 0) {
          result = await this.toolBridge.call({
            toolName: "rd.session.create_context",
            args: { context_id: contextId },
            contextId
          });
          if (result.ok) {
            return contextId;
          }
        }
      }
      throw new Error(`Failed to allocate context: ${result.error?.message ?? "unknown"}`);
    }
    return contextId;
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
    const result = await this.toolBridge.call({
      toolName: "rd.session.claim_runtime_owner",
      args: {
        runtime_owner: owner,
        entry_mode: "cli",
        backend: "local"
      },
      contextId
    });
    if (!result.ok) {
      throw new Error(`Failed to claim owner: ${result.error?.message ?? "unknown"}`);
    }
    const ownerInfo = result.data?.runtime_owner || result.data?.owner_lease;
    const leaseId = typeof ownerInfo?.lease_id === "string" && ownerInfo.lease_id ? ownerInfo.lease_id : generateId();
    const resolvedOwner = typeof ownerInfo?.agent_id === "string" && ownerInfo.agent_id ? ownerInfo.agent_id : owner;
    return { owner: resolvedOwner, leaseId };
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
        captureFileId,
        status: "open",
        sessionId: replayResult.data?.session_id,
        replaySessionId: replayResult.data?.replay_session_id,
        contextId: this.contextId
      };
      if (!previewContext || !captureFileId) {
        return emptyPreviewLoadResult();
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
      deviceLabel: this.deviceLabel,
      humanPreview: { ...this.humanPreview }
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
  setHumanPreview(patch) {
    this.humanPreview = {
      ...patch,
      updatedAt: patch.updatedAt ?? Date.now()
    };
    this.broadcastContextChanged();
  }
  broadcastContextChanged() {
    const snapshot = this.snapshotContext();
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("context:changed", snapshot);
      }
    }
  }
  extractHumanPreview(result, fallbackStatus, fallbackSessionId) {
    const preview = result.data?.preview && typeof result.data.preview === "object" ? result.data.preview : {};
    const enabled = typeof preview.enabled === "boolean" ? preview.enabled : fallbackStatus === "open";
    const status = fallbackStatus === "closed" ? "closed" : enabled ? "open" : "error";
    const sessionId = this.readPreviewString(preview, ["session_id", "current_session_id", "bound_session_id"]) ?? this.readPreviewString(result.data, ["current_session_id", "session_id"]) ?? fallbackSessionId;
    const boundEventId = this.readPreviewNumber(preview, ["active_event_id", "bound_event_id", "event_id"]) ?? this.readPreviewNumber(result.data, ["active_event_id", "bound_event_id", "event_id"]);
    const lastError = this.readPreviewError(preview) ?? this.readPreviewError(result.data) ?? (enabled || fallbackStatus === "closed" ? void 0 : "Preview is not enabled.");
    return {
      status,
      sessionId,
      boundEventId,
      lastError
    };
  }
  readPreviewString(source, keys) {
    if (!source) {
      return void 0;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
    return void 0;
  }
  readPreviewNumber(source, keys) {
    if (!source) {
      return void 0;
    }
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return void 0;
  }
  readPreviewError(source) {
    if (!source) {
      return void 0;
    }
    const direct = source.last_error ?? source.error ?? source.error_message;
    if (typeof direct === "string" && direct.trim()) {
      return direct;
    }
    if (direct && typeof direct === "object") {
      const message = direct.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    return void 0;
  }
  createOpenedCaptureState(projectId, inputId, filePath, replayDevice, previewResult) {
    const activeCapture = this.captures.find((capture) => capture.id === this.activeCaptureId) ?? this.captures[0];
    return {
      projectId,
      inputId,
      filePath,
      captureId: activeCapture?.id ?? inputId,
      captureFileId: activeCapture?.captureFileId,
      sessionId: activeCapture?.sessionId ?? "",
      contextId: this.contextId ?? "",
      replaySessionId: activeCapture?.replaySessionId ?? "",
      backend: activeCapture?.backendHint ?? "local",
      deviceId: replayDevice.id,
      deviceLabel: replayDevice.label,
      status: activeCapture?.status === "error" ? "error" : "open",
      openedAt: Date.now(),
      preview: previewResult.preview,
      previewError: previewResult.error,
      previewAttempts: previewResult.attempts
    };
  }
  async loadPreferredPreview(projectId, inputId, sessionId, captureFileId) {
    const attempts = [];
    const framebufferPreview = sessionId ? await this.loadFramebufferPreview(projectId, inputId, sessionId, attempts) : null;
    if (framebufferPreview) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "success",
        title: "Preview ready",
        summary: `已加载 ${inputId} 的最终渲染预览。`,
        detail: framebufferPreview.width > 0 && framebufferPreview.height > 0 ? `${framebufferPreview.width}x${framebufferPreview.height} · framebuffer · event=${framebufferPreview.resolvedEventId ?? "-"} · target=${framebufferPreview.targetSource ?? "-"}` : `framebuffer · event=${framebufferPreview.resolvedEventId ?? "-"} · target=${framebufferPreview.targetSource ?? "-"}`,
        projectId,
        raw: { preview: framebufferPreview, attempts }
      });
      return { preview: framebufferPreview, error: null, attempts };
    }
    const thumbnailPreview = await this.loadCaptureThumbnail(captureFileId, attempts);
    if (thumbnailPreview) {
      runtimeLogService.log({
        scope: "app",
        namespace: "capture",
        severity: "warning",
        title: "Preview fallback",
        summary: `最终 framebuffer 不可用，已回退为 ${inputId} 的 capture thumbnail。`,
        detail: thumbnailPreview.width > 0 && thumbnailPreview.height > 0 ? `${thumbnailPreview.width}x${thumbnailPreview.height} · thumbnail` : "thumbnail",
        projectId,
        raw: { preview: thumbnailPreview, attempts }
      });
      return { preview: thumbnailPreview, error: null, attempts };
    }
    const error = this.createPreviewError(attempts);
    runtimeLogService.log({
      scope: "app",
      namespace: "capture",
      severity: "warning",
      title: "Preview unavailable",
      summary: `已打开 ${inputId}，但当前没有可用预览内容：${error.message}`,
      projectId,
      raw: { error, attempts }
    });
    return { preview: null, error, attempts };
  }
  async loadFramebufferPreview(projectId, inputId, sessionId, attempts) {
    const outputPath = appPathService.getCapturePreviewPath(projectId, inputId);
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const swapchainPreview = await this.loadFramebufferPreviewAtEvent(
      sessionId,
      outputPath,
      attempts,
      void 0,
      "swapchain"
    );
    if (swapchainPreview) {
      return swapchainPreview;
    }
    const candidateEventIds = await this.listPreviewCandidateEvents(sessionId);
    const eventAttempts = candidateEventIds.slice().reverse().filter((eventId, index, values) => values.indexOf(eventId) === index);
    for (const eventId of eventAttempts) {
      const preview = await this.loadFramebufferPreviewAtEvent(
        sessionId,
        outputPath,
        attempts,
        eventId,
        "event_output"
      );
      if (preview) {
        return preview;
      }
    }
    return null;
  }
  async loadFramebufferPreviewAtEvent(sessionId, outputPath, attempts, eventId, targetSemantic = "swapchain") {
    const args = {
      session_id: sessionId,
      output_path: outputPath,
      file_format: "png",
      include_alpha: false,
      target: {
        semantic: targetSemantic
      }
    };
    if (eventId !== void 0) {
      args.event_id = eventId;
    }
    const result = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.export.screenshot",
      args
    ));
    if (!result.ok || result.data?.success === false) {
      attempts.push({
        source: "framebuffer_screenshot",
        status: "failed",
        eventId,
        message: this.describeToolFailure(result, "rd.export.screenshot did not return a preview image."),
        code: this.readToolFailureCode(result),
        targetSemantic,
        details: this.readToolFailureDetails(result)
      });
      return null;
    }
    const imagePath = this.resolvePreviewPath(result, outputPath);
    const metadata = this.extractPreviewMetadata(result);
    const preview = imagePath ? this.createPreviewFromPath(imagePath, "framebuffer_screenshot", void 0, void 0, metadata) : null;
    if (!preview) {
      attempts.push({
        source: "framebuffer_screenshot",
        status: "failed",
        eventId,
        message: imagePath ? `rd.export.screenshot produced an unreadable image: ${imagePath}` : "rd.export.screenshot succeeded without image_path, saved_path, artifact_path, or artifact path.",
        code: "preview_image_unreadable",
        imagePath: imagePath ?? void 0,
        targetSemantic,
        details: this.readToolFailureDetails(result),
        ...metadata
      });
      return null;
    }
    attempts.push({
      source: "framebuffer_screenshot",
      status: "success",
      eventId,
      imagePath: preview.imagePath,
      resolvedEventId: preview.resolvedEventId,
      presentEventId: preview.presentEventId,
      textureId: preview.textureId,
      targetSource: preview.targetSource,
      targetSemantic: preview.targetSemantic ?? targetSemantic,
      fallbackReason: preview.fallbackReason,
      details: result.data?.swapchain_error
    });
    return preview;
  }
  async listPreviewCandidateEvents(sessionId) {
    const result = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.event.get_actions",
      {
        session_id: sessionId,
        include_markers: true,
        include_drawcalls: true,
        max_nodes: 2e4
      }
    ));
    if (!result.ok || result.data?.success === false || !Array.isArray(result.data?.actions)) {
      return [];
    }
    const eventIds = [];
    const visit = (node) => {
      const flags = typeof node.flags === "object" && node.flags !== null ? node.flags : {};
      const isPreviewable = flags.is_draw === true || flags.is_dispatch === true || flags.is_pass_boundary === true;
      const eventId = typeof node.event_id === "number" ? node.event_id : Number(node.event_id);
      if (isPreviewable && Number.isFinite(eventId) && eventId > 0) {
        eventIds.push(eventId);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          if (typeof child === "object" && child !== null) {
            visit(child);
          }
        }
      }
    };
    for (const action of result.data.actions) {
      if (typeof action === "object" && action !== null) {
        visit(action);
      }
    }
    return Array.from(new Set(eventIds));
  }
  async loadCaptureThumbnail(captureFileId, attempts) {
    const result = await this.toolBridge.call(this.buildClaimedToolRequest(
      "rd.capture.get_thumbnail",
      {
        capture_file_id: captureFileId,
        max_size_px: 640
      }
    ));
    if (!result.ok) {
      attempts.push({
        source: "capture_thumbnail",
        status: "failed",
        message: this.describeToolFailure(result, "rd.capture.get_thumbnail did not return a thumbnail."),
        code: this.readToolFailureCode(result)
      });
      return null;
    }
    const imagePath = this.resolvePreviewPath(result);
    if (!imagePath) {
      attempts.push({
        source: "capture_thumbnail",
        status: "failed",
        message: "rd.capture.get_thumbnail succeeded without image_path, saved_path, artifact_path, or artifact path.",
        code: "thumbnail_path_missing"
      });
      return null;
    }
    const preview = this.createPreviewFromPath(
      imagePath,
      "capture_thumbnail",
      typeof result.data?.width === "number" ? result.data.width : void 0,
      typeof result.data?.height === "number" ? result.data.height : void 0
    );
    if (!preview) {
      attempts.push({
        source: "capture_thumbnail",
        status: "failed",
        message: `rd.capture.get_thumbnail produced an unreadable image: ${imagePath}`,
        code: "thumbnail_image_unreadable",
        imagePath
      });
      return null;
    }
    attempts.push({
      source: "capture_thumbnail",
      status: "success",
      imagePath: preview.imagePath
    });
    return preview;
  }
  resolvePreviewPath(result, fallbackPath) {
    const imagePath = typeof result.data?.image_path === "string" ? result.data.image_path : typeof result.data?.saved_path === "string" ? result.data.saved_path : typeof result.data?.artifact_path === "string" ? result.data.artifact_path : typeof result.data?.path === "string" ? result.data.path : result.artifacts?.[0]?.path ?? fallbackPath ?? null;
    return imagePath ? path.resolve(imagePath) : null;
  }
  createPreviewFromPath(imagePath, source, fallbackWidth, fallbackHeight, metadata = {}) {
    const normalizedPath = path.resolve(imagePath);
    if (!fs.existsSync(normalizedPath)) {
      return null;
    }
    const image = electron.nativeImage.createFromPath(normalizedPath);
    if (image.isEmpty()) {
      return null;
    }
    const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize();
    const resolvedWidth = size.width || fallbackWidth || 0;
    const resolvedHeight = size.height || fallbackHeight || 0;
    if (resolvedWidth <= 0 || resolvedHeight <= 0) {
      return null;
    }
    return {
      imagePath: normalizedPath,
      imageUrl: image.toDataURL(),
      width: resolvedWidth,
      height: resolvedHeight,
      source,
      ...metadata,
      updatedAt: Date.now()
    };
  }
  extractPreviewMetadata(result) {
    return {
      resolvedEventId: typeof result.data?.resolved_event_id === "number" ? result.data.resolved_event_id : void 0,
      presentEventId: typeof result.data?.present_event_id === "number" ? result.data.present_event_id : void 0,
      textureId: typeof result.data?.texture_id === "string" ? result.data.texture_id : void 0,
      targetSource: typeof result.data?.target_source === "string" ? result.data.target_source : void 0,
      targetSemantic: typeof result.data?.requested_semantic === "string" ? result.data.requested_semantic : void 0,
      fallbackReason: typeof result.data?.fallback_reason === "string" ? result.data.fallback_reason : void 0,
      summaryDegraded: typeof result.data?.summary_degraded === "boolean" ? result.data.summary_degraded : void 0
    };
  }
  describeToolFailure(result, fallback) {
    if (result.error?.message) {
      return result.error.message;
    }
    if (typeof result.data?.error_message === "string" && result.data.error_message) {
      return result.data.error_message;
    }
    return fallback;
  }
  readToolFailureCode(result) {
    if (result.error?.code) {
      return result.error.code;
    }
    return typeof result.data?.code === "string" ? result.data.code : void 0;
  }
  readToolFailureDetails(result) {
    if (result.error?.details) {
      return result.error.details;
    }
    return result.data?.details;
  }
  createPreviewError(attempts) {
    const failedAttempts = attempts.filter((attempt) => attempt.status === "failed");
    const lastFailure = failedAttempts[failedAttempts.length - 1];
    return {
      message: lastFailure?.message ?? "No preview attempt produced a readable image.",
      code: lastFailure?.code,
      attempts: [...attempts]
    };
  }
  canReuseOpenedCapture(request) {
    const primaryCapture = (request.captures ?? []).find((capture) => capture.id === request.primaryCaptureId);
    if (!primaryCapture || !this.openedCapture) {
      return false;
    }
    return Boolean(
      this.contextId && this.runtimeOwner && this.ownerLeaseId && this.openedCapture.status === "open" && primaryCapture.id === this.openedCapture.inputId && primaryCapture.filePath === this.openedCapture.filePath && primaryCapture.backendHint === this.openedCapture.backend && request.replayDevice?.id === this.openedCapture.deviceId
    );
  }
  async teardownRuntime() {
    const contextId = this.contextId;
    const runtimeOwner = this.runtimeOwner;
    const ownerLeaseId = this.ownerLeaseId;
    if (contextId && runtimeOwner && ownerLeaseId && this.humanPreview.status !== "closed") {
      await this.closeHumanPreviewWindow().catch((error) => {
        runtimeLogService.log({
          scope: "app",
          namespace: "context",
          severity: "warning",
          title: "Human preview teardown warning",
          summary: error instanceof Error ? error.message : String(error)
        });
      });
    }
    const replaySessionIds = Array.from(new Set(
      this.captures.map((capture) => capture.sessionId || capture.replaySessionId).filter((sessionId) => typeof sessionId === "string" && Boolean(sessionId))
    ));
    const captureFileIds = Array.from(new Set(
      this.captures.map((capture) => capture.captureFileId).filter((captureFileId) => typeof captureFileId === "string" && Boolean(captureFileId))
    ));
    for (const sessionId of replaySessionIds) {
      const result = await this.toolBridge.call({
        toolName: "rd.capture.close_replay",
        args: { session_id: sessionId },
        contextId: contextId ?? void 0,
        runtimeOwner: runtimeOwner ?? void 0,
        ownerLeaseId: ownerLeaseId ?? void 0
      });
      if (!result.ok) {
        runtimeLogService.log({
          scope: "app",
          namespace: "capture",
          severity: "warning",
          title: "Replay teardown warning",
          summary: result.error?.message ?? `Failed to close replay ${sessionId}.`,
          raw: {
            sessionId,
            contextId
          }
        });
      }
    }
    for (const captureFileId of captureFileIds) {
      const result = await this.toolBridge.call({
        toolName: "rd.capture.close_file",
        args: { capture_file_id: captureFileId },
        contextId: contextId ?? void 0,
        runtimeOwner: runtimeOwner ?? void 0,
        ownerLeaseId: ownerLeaseId ?? void 0
      });
      if (!result.ok) {
        runtimeLogService.log({
          scope: "app",
          namespace: "capture",
          severity: "warning",
          title: "Capture teardown warning",
          summary: result.error?.message ?? `Failed to close capture ${captureFileId}.`,
          raw: {
            captureFileId,
            contextId
          }
        });
      }
    }
    if (contextId && runtimeOwner && ownerLeaseId) {
      await this.toolBridge.call({
        toolName: "rd.session.release_runtime_owner",
        args: {
          runtime_owner: runtimeOwner,
          owner_lease_id: ownerLeaseId,
          force: true
        },
        contextId,
        runtimeOwner,
        ownerLeaseId
      });
    }
    if (contextId) {
      await this.toolBridge.call({
        toolName: "rd.session.clear_context",
        args: {
          target_context_id: contextId
        },
        contextId
      });
    }
  }
  async cleanupStaleRdcAgentContexts() {
    const result = await this.toolBridge.call({
      toolName: "rd.session.list_contexts",
      args: {}
    });
    if (!result.ok || !Array.isArray(result.data?.contexts)) {
      return 0;
    }
    let cleanedCount = 0;
    for (const contextEntry of result.data.contexts) {
      const targetContextId = typeof contextEntry.context_id === "string" ? contextEntry.context_id : "";
      if (!targetContextId) {
        continue;
      }
      const runtimeOwner = typeof contextEntry.runtime_owner === "string" ? contextEntry.runtime_owner : typeof contextEntry.runtime_owner?.agent_id === "string" ? String(contextEntry.runtime_owner.agent_id) : "";
      const ownerLeaseId = typeof contextEntry.owner_lease?.lease_id === "string" ? String(contextEntry.owner_lease.lease_id) : "";
      const shouldClear = targetContextId.startsWith("ctx-") || runtimeOwner.startsWith("rdc-agent-");
      if (!shouldClear) {
        continue;
      }
      if (runtimeOwner && ownerLeaseId) {
        await this.toolBridge.call({
          toolName: "rd.session.release_runtime_owner",
          args: {
            runtime_owner: runtimeOwner,
            owner_lease_id: ownerLeaseId,
            force: true
          },
          contextId: targetContextId,
          runtimeOwner,
          ownerLeaseId
        });
      }
      const clearResult = await this.toolBridge.call({
        toolName: "rd.session.clear_context",
        args: {
          target_context_id: targetContextId
        },
        contextId: targetContextId
      });
      if (clearResult.ok) {
        cleanedCount += 1;
      }
    }
    return cleanedCount;
  }
  async cleanupDaemonRuntimeState() {
    let cleaned = false;
    const daemonCleanup = await this.toolBridge.executeCLI("daemon", ["cleanup"]);
    if (daemonCleanup.exitCode === 0) {
      cleaned = true;
    } else {
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Daemon cleanup warning",
        summary: daemonCleanup.stderr.trim() || daemonCleanup.stdout.trim() || "Failed to cleanup stale daemon state."
      });
    }
    const contextClear = await this.toolBridge.executeCLI("context", ["clear"]);
    if (contextClear.exitCode === 0) {
      cleaned = true;
    } else {
      runtimeLogService.log({
        scope: "app",
        namespace: "context",
        severity: "warning",
        title: "Daemon context clear warning",
        summary: contextClear.stderr.trim() || contextClear.stdout.trim() || "Failed to clear default daemon context."
      });
    }
    return cleaned;
  }
  resetRuntimeState(previousCapture) {
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
    this.humanPreview = {
      status: "closed",
      updatedAt: Date.now()
    };
    if (previousCapture) {
      this.openedCapture = null;
    }
  }
}
const rdxSessionService = new RdxSessionService(toolBridge);
const __dirname$1 = path__namespace.dirname(url.fileURLToPath(require("url").pathToFileURL(__filename).href));
if (!process.env.RDC_AGENT_USER_DATA?.trim()) {
  electron.app.setPath("userData", path__namespace.join(electron.app.getPath("appData"), "rdc-agent"));
}
const isDev = process.env.NODE_ENV === "development" && process.env.RDC_AGENT_TEST_MODE !== "1";
const isSettingsRebuildOnly = process.env.RDC_AGENT_REBUILD_SETTINGS_ONLY === "1";
const isTestMode = process.env.RDC_AGENT_TEST_MODE === "1";
if (isTestMode) {
  electron.app.disableHardwareAcceleration();
  electron.app.commandLine.appendSwitch("disable-gpu");
  electron.app.commandLine.appendSwitch("disable-gpu-compositing");
  electron.app.commandLine.appendSwitch("in-process-gpu");
}
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
    minWidth: 360,
    minHeight: 640,
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
  void stopAllActiveRuns();
  replayDeviceService.dispose();
  if (isTestMode) {
    const forceExitTimer = setTimeout(() => electron.app.exit(0), 100);
    forceExitTimer.unref?.();
  }
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
    const hasConfiguredProvider = settingsService.hasConfiguredProvider();
    console.log("[Main] SettingsService initialized, hasConfiguredProvider:", hasConfiguredProvider);
    await toolBridge.loadCatalog();
    console.log("[Main] ToolBridge catalog initialized");
    runtimeLogService.log({
      scope: "app",
      namespace: "system",
      severity: "success",
      title: "Tool catalog ready",
      summary: "RDC 工具目录已加载。"
    });
    await initializeIpcState();
    console.log("[Main] DebuggerRuntime initialized");
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
