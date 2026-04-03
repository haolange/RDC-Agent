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
function nowIso$1() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
class ToolBridge {
  toolsPath;
  catalog = null;
  activeProcesses = /* @__PURE__ */ new Map();
  constructor() {
    if (electron.app.isPackaged) {
      this.toolsPath = path__namespace.join(process.resourcesPath, "tools");
    } else {
      this.toolsPath = path__namespace.join(electron.app.getAppPath(), "resources", "tools");
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
  /**
   * 调用rd.*工具
   * 使用参数数组模式，避免命令字符串拼接注入风险
   */
  async call(request) {
    const startTime = nowMs();
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
      const result = await this.executeCLI("call", cliArgs, {
        timeout: 6e4
        // 60秒超时
      });
      if (result.exitCode === 0 && result.stdout.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(result.stdout);
        } catch {
          return {
            ok: true,
            data: { raw: result.stdout },
            duration_ms: nowMs() - startTime,
            trace_id: generateEventId("tool")
          };
        }
        if (parsed.ok === false) {
          const errObj = parsed.error ?? {};
          return {
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
        }
        return {
          ok: true,
          data: parsed.data ?? parsed,
          artifacts: parsed.artifacts,
          duration_ms: nowMs() - startTime,
          trace_id: generateEventId("tool")
        };
      }
      return {
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
    } catch (error) {
      return {
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
const SETTINGS_FILE_NAME = "settings.json";
const LOG_FILE_NAME = "rdc-agent.log";
const normalizePath = (targetPath) => path.resolve(targetPath);
const isSamePath = (left, right) => {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  return process.platform === "win32" ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase() : normalizedLeft === normalizedRight;
};
class AppPathService {
  workspaceRootCache = null;
  getBootstrapDir() {
    return path.join(electron.app.getPath("appData"), "RdcAgent");
  }
  getBootstrapPath() {
    return path.join(this.getBootstrapDir(), "workspace-bootstrap.json");
  }
  getDefaultWorkspaceRoot() {
    return normalizePath(path.join(electron.app.getPath("appData"), "rdc-agent"));
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
      migrationOrphansPath: path.join(root, "migration-orphans")
    };
  }
  initializeWorkspaceRoot() {
    const workspaceRoot = this.getWorkspaceRoot();
    const paths = this.getWorkspacePaths(workspaceRoot);
    this.ensureWorkspaceStructure(paths);
    this.copyLegacyData(paths.workspaceRoot);
    this.writeBootstrapState({ workspaceRoot: paths.workspaceRoot });
    return paths;
  }
  setWorkspaceRoot(nextRoot) {
    const currentRoot = this.getWorkspaceRoot();
    const resolvedRoot = normalizePath(nextRoot || this.getDefaultWorkspaceRoot());
    if (!isSamePath(currentRoot, resolvedRoot)) {
      this.ensureWorkspaceStructure(this.getWorkspacePaths(resolvedRoot));
      this.copyWorkspaceData(currentRoot, resolvedRoot);
      this.copyLegacyData(resolvedRoot);
    } else {
      this.ensureWorkspaceStructure(this.getWorkspacePaths(resolvedRoot));
      this.copyLegacyData(resolvedRoot);
    }
    this.workspaceRootCache = resolvedRoot;
    this.writeBootstrapState({ workspaceRoot: resolvedRoot });
    return this.getWorkspacePaths(resolvedRoot);
  }
  resetWorkspaceRoot() {
    return this.setWorkspaceRoot(this.getDefaultWorkspaceRoot());
  }
  readBootstrapState() {
    const bootstrapPath = this.getBootstrapPath();
    try {
      if (!fs.existsSync(bootstrapPath)) {
        return {};
      }
      return JSON.parse(fs.readFileSync(bootstrapPath, "utf8"));
    } catch (error) {
      console.warn("[AppPathService] Failed to read bootstrap state:", error);
      return {};
    }
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
  }
  copyLegacyData(targetRoot) {
    const legacyUserDataRoot = electron.app.getPath("userData");
    const legacySettingsRoot = path.join(electron.app.getPath("appData"), "RdcAgent");
    const legacyDevWorkspace = path.join(electron.app.getAppPath(), "workspace");
    const legacyPackagedWorkspace = path.join(path.dirname(electron.app.getPath("exe")), "workspace");
    const legacyDevLog = path.join(electron.app.getAppPath(), "dev-stdout.log");
    this.copyWorkspaceData(legacyUserDataRoot, targetRoot);
    this.copyWorkspaceData(legacySettingsRoot, targetRoot);
    this.copyWorkspaceData(legacyDevWorkspace, targetRoot);
    this.copyWorkspaceData(legacyPackagedWorkspace, targetRoot);
    this.copyLogFile(legacyDevLog, this.getWorkspacePaths(targetRoot).logPath);
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
      lastStage: "preflight_pending",
      backend,
      createdAt: startedAt,
      updatedAt: startedAt,
      runtime: {
        backend,
        entry_mode: "cli",
        context_id: null,
        runtime_owner: null,
        session_id: sessionId,
        workflow_stage: "preflight_pending"
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
        last_updated: nowIso$1(),
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
    if (workflowStage === "finalized" && merged.status === "running") {
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
    if (stage === "finalized") {
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
      startedAt: Date.parse(String(runYaml.created_at || nowIso$1())),
      finishedAt: runYaml.finished_at ? Date.parse(String(runYaml.finished_at)) : void 0,
      status: runYaml.status || "running",
      lastStage: String(runYaml.last_stage || "preflight_pending"),
      backend: runYaml.runtime?.backend || "local",
      createdAt: Date.parse(String(runYaml.created_at || nowIso$1())),
      updatedAt: Date.parse(String(runYaml.updated_at || runYaml.created_at || nowIso$1())),
      runtime: {
        backend: runYaml.runtime?.backend || "local",
        entry_mode: runYaml.runtime?.entry_mode || "cli",
        context_id: runYaml.runtime?.context_id || null,
        runtime_owner: runYaml.runtime?.runtime_owner || null,
        session_id: String(runYaml.runtime?.session_id || sessionId),
        workflow_stage: runYaml.runtime?.workflow_stage || "preflight_pending"
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
const toModels = (modelIds) => Array.from(new Set(modelIds)).map((modelId) => ({
  id: modelId,
  label: modelId,
  enabled: true
}));
const createBuiltinProviderEntry = (id) => {
  const definition = BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === id);
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
    baseUrl: definition.baseUrl,
    models: toModels(defaultModels),
    recommendedModels: definition.recommendedModels,
    docsUrl: definition.docsUrl,
    isConfigured: false
  };
};
const createBuiltinProviderEntries = () => BUILTIN_LLM_PROVIDER_DEFINITIONS.map((entry) => createBuiltinProviderEntry(entry.id));
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
const EMPTY_PATHS = {
  workspaceRoot: "",
  defaultWorkspaceRoot: "",
  settingsPath: "",
  logsPath: "",
  logPath: "",
  projectsPath: "",
  knowledgePath: "",
  migrationOrphansPath: ""
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
const VALID_THEMES = ["dark", "light", "system"];
const VALID_LANGUAGES = ["zh-CN", "en"];
const VALID_FONT_SCALES = ["small", "medium", "large"];
const VALID_PROVIDER_KINDS = ["openrouter", "openai-compatible", "anthropic", "ollama"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pickEnum = (value, allowed, fallback) => {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
};
const dedupeStrings = (values) => Array.from(new Set(values.filter(Boolean)));
const sanitizeSidebar = (input, defaults, fallback) => {
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
};
const createDefaultAgentRoutes = () => Object.entries(DEFAULT_MODEL_ROUTING).map(([agentId, route]) => ({
  agentId,
  providerId: route.provider,
  modelId: route.model
}));
const createDefaultSettings = () => ({
  appearance: DEFAULT_APPEARANCE,
  layout: DEFAULT_LAYOUT,
  profile: DEFAULT_PROFILE,
  workspace: {
    rootPath: appPathService.getWorkspaceRoot()
  },
  llm: {
    providers: createBuiltinProviderEntries(),
    agentRoutes: createDefaultAgentRoutes()
  },
  paths: EMPTY_PATHS
});
const toModelId = (value) => value.trim();
const sanitizeModels = (models, fallback = []) => {
  const candidates = Array.isArray(models) ? models : [];
  const normalized = candidates.map((entry) => {
    if (typeof entry === "string") {
      const modelId2 = toModelId(entry);
      return modelId2 ? { id: modelId2, label: modelId2, enabled: true } : null;
    }
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const candidate = entry;
    const modelId = typeof candidate.id === "string" ? toModelId(candidate.id) : "";
    if (!modelId) {
      return null;
    }
    return {
      id: modelId,
      label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : modelId,
      enabled: candidate.enabled !== false
    };
  }).filter((entry) => entry !== null);
  const merged = dedupeStrings([
    ...normalized.filter((entry) => entry.enabled).map((entry) => entry.id),
    ...fallback
  ]);
  return merged.map((modelId) => {
    const existing = normalized.find((entry) => entry.id === modelId);
    return existing ?? {
      id: modelId,
      label: modelId,
      enabled: true
    };
  });
};
const getBuiltinDefinition = (providerId) => BUILTIN_LLM_PROVIDER_DEFINITIONS.find((entry) => entry.id === providerId);
const getProviderConfigState = (provider) => {
  if (!provider.enabled) return false;
  if (provider.kind === "ollama") return true;
  return Boolean(provider.apiKey.trim());
};
const sanitizeProvider = (entry, fallback) => {
  const builtin = getBuiltinDefinition(typeof entry.id === "string" ? entry.id : fallback?.id ?? "");
  const providerId = typeof entry.id === "string" && entry.id.trim() || fallback?.id || builtin?.id || "custom-provider";
  const recommendedModels = dedupeStrings([
    ...Array.isArray(entry.recommendedModels) ? entry.recommendedModels.filter((value) => typeof value === "string") : [],
    ...fallback?.recommendedModels ?? [],
    ...builtin?.recommendedModels ?? []
  ]);
  const models = sanitizeModels(
    entry.models,
    dedupeStrings([
      ...(fallback?.models ?? []).filter((model) => model.enabled).map((model) => model.id),
      ...builtin?.defaultModels ?? []
    ])
  );
  const resolved = {
    id: providerId,
    kind: pickEnum(
      entry.kind,
      VALID_PROVIDER_KINDS,
      fallback?.kind ?? builtin?.kind ?? "openai-compatible"
    ),
    label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : fallback?.label ?? builtin?.label ?? providerId,
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : fallback?.enabled ?? builtin?.enabled ?? false,
    apiKey: typeof entry.apiKey === "string" ? entry.apiKey.trim() : fallback?.apiKey ?? "",
    baseUrl: typeof entry.baseUrl === "string" && entry.baseUrl.trim() ? entry.baseUrl.trim() : fallback?.baseUrl ?? builtin?.baseUrl,
    models,
    recommendedModels,
    docsUrl: typeof entry.docsUrl === "string" && entry.docsUrl.trim() ? entry.docsUrl.trim() : fallback?.docsUrl ?? builtin?.docsUrl,
    isConfigured: false
  };
  resolved.isConfigured = getProviderConfigState(resolved);
  return resolved;
};
const importLegacyCredentials = (settings) => {
  const credentials = Array.isArray(settings.llm?.credentials) ? settings.llm?.credentials : [];
  const imported = /* @__PURE__ */ new Map();
  for (const credential of credentials) {
    const providerId = typeof credential.provider === "string" ? credential.provider : "";
    if (!providerId || !credential.apiKey?.trim()) {
      continue;
    }
    const current = imported.get(providerId);
    if (!current || credential.isDefault) {
      imported.set(providerId, credential);
    }
  }
  return Array.from(imported.entries()).map(([providerId, credential]) => {
    const builtinFallback = createBuiltinProviderEntries().find((entry) => entry.id === providerId);
    return sanitizeProvider({
      id: providerId,
      label: credential.label || builtinFallback?.label || providerId,
      enabled: true,
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      models: builtinFallback?.models ?? [],
      recommendedModels: builtinFallback?.recommendedModels ?? [],
      docsUrl: builtinFallback?.docsUrl,
      kind: builtinFallback?.kind ?? "openai-compatible"
    }, builtinFallback);
  });
};
const mergeProviders = (rawProviders, legacySettings, legacyStore) => {
  const builtinProviders = createBuiltinProviderEntries();
  const providerMap = /* @__PURE__ */ new Map();
  for (const provider of builtinProviders) {
    providerMap.set(provider.id, provider);
  }
  const importedProviders = Array.isArray(rawProviders) ? rawProviders.map((entry) => sanitizeProvider(entry, providerMap.get(entry.id))) : [];
  for (const provider of importedProviders) {
    providerMap.set(provider.id, provider);
  }
  for (const provider of importLegacyCredentials(legacySettings)) {
    const fallback = providerMap.get(provider.id);
    providerMap.set(provider.id, sanitizeProvider(provider, fallback));
  }
  if (legacyStore.openRouter?.apiKey) {
    const fallback = providerMap.get("openrouter");
    providerMap.set("openrouter", sanitizeProvider({
      id: "openrouter",
      enabled: true,
      apiKey: legacyStore.openRouter.apiKey,
      baseUrl: legacyStore.openRouter.baseUrl,
      models: fallback?.models ?? [],
      recommendedModels: fallback?.recommendedModels ?? [],
      docsUrl: fallback?.docsUrl,
      kind: "openrouter",
      label: fallback?.label ?? "OpenRouter"
    }, fallback));
  }
  return Array.from(providerMap.values()).map((provider) => sanitizeProvider(provider, providerMap.get(provider.id)));
};
const ensureRouteModel = (provider, modelId) => {
  if (!modelId) {
    return provider;
  }
  if (provider.models.some((model) => model.id === modelId)) {
    return provider;
  }
  return {
    ...provider,
    models: [...provider.models, { id: modelId, label: modelId, enabled: true }]
  };
};
const sanitizeAgentRoutes = (rawRoutes, providers) => {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const providedRoutes = Array.isArray(rawRoutes) ? rawRoutes.filter((entry) => Boolean(entry && typeof entry === "object" && "agentId" in entry)) : [];
  const routeMap = new Map(providedRoutes.map((route) => [route.agentId, route]));
  const normalizedRoutes = [];
  for (const [agentId, fallback] of Object.entries(DEFAULT_MODEL_ROUTING)) {
    const candidate = routeMap.get(agentId);
    const providerId = candidate?.providerId || fallback.provider;
    const preferredModelId = candidate?.modelId || fallback.model;
    const initialProvider = providerMap.get(providerId) || providerMap.get(fallback.provider) || providers[0];
    if (!initialProvider) {
      continue;
    }
    const providerWithModel = ensureRouteModel(initialProvider, preferredModelId);
    providerMap.set(providerWithModel.id, providerWithModel);
    normalizedRoutes.push({
      agentId,
      providerId: providerWithModel.id,
      modelId: preferredModelId
    });
  }
  return {
    providers: Array.from(providerMap.values()).map((provider) => sanitizeProvider(provider, provider)),
    routes: normalizedRoutes
  };
};
const sanitizeSettings = (raw, legacyStore, workspaceRoot) => {
  const fallback = createDefaultSettings();
  const candidate = raw ?? {};
  const appearance = candidate.appearance ?? {};
  const profile = candidate.profile ?? {};
  const resolvedWorkspaceRoot = candidate.workspace?.rootPath?.trim() || workspaceRoot;
  const providers = mergeProviders(candidate.llm?.providers, candidate, legacyStore);
  const { providers: normalizedProviders, routes } = sanitizeAgentRoutes(candidate.llm?.agentRoutes, providers);
  return {
    appearance: {
      theme: pickEnum(appearance.theme, VALID_THEMES, fallback.appearance.theme),
      language: pickEnum(appearance.language, VALID_LANGUAGES, fallback.appearance.language),
      fontScale: pickEnum(appearance.fontScale, VALID_FONT_SCALES, fallback.appearance.fontScale)
    },
    layout: {
      leftSidebar: sanitizeSidebar(candidate.layout?.leftSidebar, LEFT_DEFAULTS, fallback.layout.leftSidebar),
      rightPanel: sanitizeSidebar(candidate.layout?.rightPanel, RIGHT_DEFAULTS, fallback.layout.rightPanel)
    },
    profile: {
      nickname: typeof profile.nickname === "string" && profile.nickname.trim().length > 0 ? profile.nickname.trim() : fallback.profile.nickname,
      avatarPath: typeof profile.avatarPath === "string" ? profile.avatarPath : fallback.profile.avatarPath
    },
    workspace: {
      rootPath: resolvedWorkspaceRoot
    },
    llm: {
      providers: normalizedProviders,
      agentRoutes: routes
    },
    paths: EMPTY_PATHS
  };
};
const mergeSettings = (current, patch, legacyStore, workspaceRoot) => sanitizeSettings({
  ...current,
  appearance: {
    ...current.appearance,
    ...patch.appearance ?? {}
  },
  layout: {
    leftSidebar: {
      ...current.layout.leftSidebar,
      ...patch.layout?.leftSidebar ?? {}
    },
    rightPanel: {
      ...current.layout.rightPanel,
      ...patch.layout?.rightPanel ?? {}
    }
  },
  profile: {
    ...current.profile,
    ...patch.profile ?? {}
  },
  workspace: {
    ...current.workspace,
    ...patch.workspace ?? {}
  },
  llm: {
    providers: patch.llm?.providers ?? current.llm.providers,
    agentRoutes: patch.llm?.agentRoutes ?? current.llm.agentRoutes
  }
}, legacyStore, workspaceRoot);
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
    const settings = this.readSettings(runtimePaths.workspaceRoot);
    this.writeSettings(settings, runtimePaths.workspaceRoot);
    this.initialized = true;
    return this.getAll(runtimePaths);
  }
  ensureInitialized() {
    if (!this.initialized) {
      this.initialize();
    }
  }
  readSettings(workspaceRoot) {
    const settingsPath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
    const legacySettingsPath = path.join(electron.app.getPath("appData"), "RdcAgent", "settings.json");
    let rawSettings = null;
    try {
      if (fs.existsSync(settingsPath)) {
        rawSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } else if (fs.existsSync(legacySettingsPath)) {
        rawSettings = JSON.parse(fs.readFileSync(legacySettingsPath, "utf8"));
      }
    } catch (error) {
      console.warn("[SettingsService] Failed to read settings file:", error);
    }
    return sanitizeSettings(rawSettings, this.legacyStore.store, workspaceRoot);
  }
  writeSettings(settings, workspaceRoot = settings.workspace.rootPath) {
    const settingsPath = appPathService.getWorkspacePaths(workspaceRoot).settingsPath;
    const persisted = {
      ...settings,
      workspace: {
        rootPath: workspaceRoot
      },
      paths: EMPTY_PATHS
    };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(persisted, null, 2), "utf8");
  }
  getAll(runtimePaths) {
    this.ensureInitialized();
    const paths = appPathService.getWorkspacePaths();
    const settings = this.readSettings(paths.workspaceRoot);
    const nextSettings = {
      ...settings,
      workspace: {
        rootPath: paths.workspaceRoot
      },
      paths: {
        ...paths,
        ...runtimePaths ?? {}
      }
    };
    this.writeSettings(nextSettings, paths.workspaceRoot);
    return nextSettings;
  }
  setAll(patch, runtimePaths) {
    this.ensureInitialized();
    const currentSettings = this.getAll(runtimePaths);
    const requestedRoot = patch.workspace?.rootPath?.trim() || currentSettings.workspace.rootPath;
    const nextPaths = appPathService.setWorkspaceRoot(requestedRoot);
    const nextSettings = mergeSettings(currentSettings, patch, this.legacyStore.store, nextPaths.workspaceRoot);
    this.writeSettings(nextSettings, nextPaths.workspaceRoot);
    return this.getAll(nextPaths);
  }
  getLlmConfig() {
    const settings = this.getAll();
    const providers = settings.llm.providers.map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      label: provider.label,
      enabled: provider.enabled,
      apiKey: provider.apiKey,
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
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";
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
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || this.baseUrl;
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
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
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
  applyLlmConfig(config) {
    const routeMap = new Map(config.agentRoutes.map((route) => [route.agentId, route]));
    for (const [agentId, agentConfig] of this.agentConfigs.entries()) {
      const fallback = DEFAULT_MODEL_ROUTING[agentId];
      const route = routeMap.get(agentId);
      this.agentConfigs.set(agentId, {
        ...agentConfig,
        modelProvider: route?.providerId ?? fallback.provider,
        modelName: route?.modelId ?? fallback.model
      });
    }
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
   * 获取 Specialist 可用工具清单（Task 4b）
   * 根据角色过滤可用工具，确保 skeptic_agent 和 curator_agent 不接收任何 live tool
   */
  getToolsForRole(agentId) {
    if (agentId === "skeptic_agent") {
      return [];
    }
    if (agentId === "curator_agent") {
      return [];
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
const POLL_INTERVAL_MS = 5e3;
const ACTIVATE_TIMEOUT_MS = 25e3;
const RECOVERY_PROBE_TIMEOUT_MS = 12e3;
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
function buildRemoteReadyText(bootstrap) {
  if (!bootstrap) {
    return "Remote server ready";
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
  return suffix.length > 0 ? `Remote server ready · ${suffix.join(" · ")}` : "Remote server ready";
}
function buildRecoveryReadyText(bootstrap) {
  const readyText = buildRemoteReadyText(bootstrap);
  return readyText.replace("Remote server ready", "Remote server ready to resume");
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
  let detailText = "Ready to start remote server";
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
  probeContexts = /* @__PURE__ */ new Map();
  preparedRemotes = /* @__PURE__ */ new Map();
  recoveryProbePromises = /* @__PURE__ */ new Map();
  recoveryProbeAttempted = /* @__PURE__ */ new Set();
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
    if (!device || device.status !== "recoverable") {
      return;
    }
    this.updateDevice({
      ...device,
      status: "offline",
      remoteId: void 0,
      detailText: "Ready to start remote server",
      lastError: void 0,
      recoverySource: "cache"
    });
  }
  async probeRecovery(deviceId) {
    const existingPromise = this.recoveryProbePromises.get(deviceId);
    if (existingPromise) {
      return existingPromise;
    }
    const recoveryPromise = this.performRecoveryProbe(deviceId).finally(() => {
      this.recoveryProbePromises.delete(deviceId);
    });
    this.recoveryProbePromises.set(deviceId, recoveryPromise);
    return recoveryPromise;
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
    if (device.status === "recoverable") {
      return this.resolvePreparedRemote(device.id) !== null;
    }
    return device.status !== "offline";
  }
  matchesResumeCache(device) {
    return Boolean(
      device.type === "android" && device.serial && this.resumeCache && this.resumeCache.serial === device.serial
    );
  }
  maybeAnnotateRecovery(device) {
    if (!this.matchesResumeCache(device)) {
      return device;
    }
    return {
      ...device,
      recoveryEligible: true,
      recoverySource: device.recoverySource ?? "cache",
      recoveryValidatedAt: device.recoveryValidatedAt ?? this.resumeCache?.lastValidatedAt,
      bootstrap: device.bootstrap ?? this.resumeCache?.bootstrap
    };
  }
  maybeScheduleRecoveryProbe(devices) {
    const cached = this.resumeCache;
    if (!cached) {
      return;
    }
    const candidate = devices.find(
      (device) => device.type === "android" && device.serial === cached.serial && device.status === "offline" && device.lastError === void 0
    );
    if (!candidate) {
      return;
    }
    if (this.recoveryProbeAttempted.has(candidate.id) || this.resolvePreparedRemote(candidate.id)) {
      return;
    }
    this.recoveryProbeAttempted.add(candidate.id);
    void this.probeRecovery(candidate.id).catch((error) => {
      console.warn("[ReplayDeviceService] Recovery probe failed:", error);
    });
  }
  async performRefresh() {
    const detectedDevices = await this.detectAdbDevices();
    const now = Date.now();
    const nextDevices = /* @__PURE__ */ new Map([[LOCAL_DEVICE.id, { ...LOCAL_DEVICE, lastSeen: now }]]);
    const detectedIds = /* @__PURE__ */ new Set(["local"]);
    for (const detected of detectedDevices) {
      const annotatedDetected = this.maybeAnnotateRecovery(detected);
      detectedIds.add(annotatedDetected.id);
      const previous = this.devices.get(annotatedDetected.id);
      if (previous && this.shouldPreserveTransientState(previous) && annotatedDetected.lastError === void 0) {
        nextDevices.set(detected.id, {
          ...annotatedDetected,
          status: previous.status,
          detailText: previous.detailText ?? annotatedDetected.detailText,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? annotatedDetected.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: annotatedDetected.lastSeen ?? previous.lastSeen,
          recoveryEligible: previous.recoveryEligible ?? annotatedDetected.recoveryEligible,
          recoveryValidatedAt: previous.recoveryValidatedAt ?? annotatedDetected.recoveryValidatedAt,
          recoverySource: previous.recoverySource ?? annotatedDetected.recoverySource
        });
      } else if (previous && previous.activationErrorMessage && previous.lastError && annotatedDetected.status === "offline" && annotatedDetected.lastError === void 0) {
        nextDevices.set(detected.id, {
          ...annotatedDetected,
          detailText: previous.detailText ?? previous.activationErrorMessage,
          lastError: previous.lastError,
          remoteId: previous.remoteId,
          bootstrap: previous.bootstrap ?? annotatedDetected.bootstrap,
          activationPhase: previous.activationPhase,
          activationErrorCode: previous.activationErrorCode,
          activationErrorMessage: previous.activationErrorMessage,
          activationUpdatedAt: previous.activationUpdatedAt,
          lastSeen: annotatedDetected.lastSeen ?? previous.lastSeen,
          recoveryEligible: previous.recoveryEligible ?? annotatedDetected.recoveryEligible,
          recoveryValidatedAt: previous.recoveryValidatedAt ?? annotatedDetected.recoveryValidatedAt,
          recoverySource: previous.recoverySource ?? annotatedDetected.recoverySource
        });
      } else {
        nextDevices.set(annotatedDetected.id, annotatedDetected);
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
    const devices = this.replaceDevices(nextDevices);
    this.maybeScheduleRecoveryProbe(devices);
    return devices;
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
    const isRecoverable = device.status === "recoverable";
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: isRecoverable ? "Resuming remote server..." : "Preparing Android remote server...",
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
        isRecoverable ? this.resumePreparedRemote(deviceId) : this.activateRemoteDevice(deviceId),
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
  async performRecoveryProbe(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device || device.type !== "android" || !device.serial) {
      return;
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Validating remote server for resume...",
      lastError: void 0,
      activationPhase: "context",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now(),
      recoveryEligible: true,
      recoverySource: "startup_probe"
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timed out while probing remote recovery.")), RECOVERY_PROBE_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        this.probeRemoteSurface(device),
        timeoutPromise
      ]);
    } catch (error) {
      this.preparedRemotes.delete(deviceId);
      const current = this.devices.get(deviceId) ?? device;
      this.updateDevice({
        ...current,
        status: "offline",
        detailText: "Ready to start remote server",
        lastError: void 0,
        activationPhase: "idle",
        activationErrorCode: void 0,
        activationErrorMessage: void 0,
        activationUpdatedAt: Date.now(),
        recoveryEligible: true,
        recoverySource: "cache"
      });
      console.warn("[ReplayDeviceService] Recovery probe did not prepare a resumable surface:", error);
    }
  }
  async probeRemoteSurface(device) {
    if (!device.serial) {
      throw new Error("Android device serial is missing.");
    }
    await this.ensureDaemonReady();
    const contextId = `ctx-device-resume-${sanitizeDeviceId(device.serial)}`;
    this.probeContexts.set(device.id, contextId);
    await toolBridge.call({
      toolName: "rd.session.clear_context",
      args: { target_context_id: contextId }
    });
    const contextResult = await toolBridge.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId }
    });
    if (!contextResult.ok) {
      const parsedError = parseToolError(contextResult, "Failed to create a recovery probe context.");
      throw new Error(parsedError.message);
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Validating remote server for resume...",
      lastError: void 0,
      activationPhase: "init",
      activationUpdatedAt: Date.now(),
      recoveryEligible: true,
      recoverySource: "startup_probe"
    });
    const initResult = await toolBridge.call({
      toolName: "rd.core.init",
      args: {},
      contextId
    });
    if (!initResult.ok) {
      const parsedError = parseToolError(initResult, "Failed to initialize recovery probe capability.");
      throw new Error(parsedError.message);
    }
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Validating remote server for resume...",
      lastError: void 0,
      activationPhase: "connect",
      activationUpdatedAt: Date.now(),
      recoveryEligible: true,
      recoverySource: "startup_probe"
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
      throw new Error("Remote recovery probe did not return a remote_id.");
    }
    const bootstrap = parseAndroidBootstrapMetadata(
      connectResult.data?.detail && typeof connectResult.data.detail === "object" ? connectResult.data.detail.bootstrap : void 0
    );
    const pingResult = await toolBridge.call({
      toolName: "rd.remote.ping",
      args: { remote_id: remoteId },
      contextId
    });
    if (!pingResult.ok) {
      const parsedError = parseToolError(pingResult, "Remote server recovery ping failed.");
      throw new Error(parsedError.message);
    }
    const targetsResult = await toolBridge.call({
      toolName: "rd.remote.list_targets",
      args: { remote_id: remoteId },
      contextId
    });
    if (!targetsResult.ok) {
      const parsedError = parseToolError(targetsResult, "Remote recovery target discovery failed.");
      throw new Error(parsedError.message);
    }
    const validatedAt = Date.now();
    this.preparedRemotes.set(device.id, {
      deviceId: device.id,
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
    this.updateDevice({
      ...device,
      status: "recoverable",
      remoteId,
      bootstrap,
      detailText: buildRecoveryReadyText(bootstrap),
      lastError: void 0,
      activationPhase: "ready",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: validatedAt,
      lastSeen: Date.now(),
      recoveryEligible: true,
      recoveryValidatedAt: validatedAt,
      recoverySource: "startup_probe"
    });
  }
  async resumePreparedRemote(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device?.serial) {
      throw new Error("Android device serial is missing.");
    }
    const prepared = this.resolvePreparedRemote(deviceId);
    if (!prepared) {
      return this.activateRemoteDevice(deviceId);
    }
    if (prepared.serial !== device.serial) {
      this.invalidatePreparedRemote(deviceId);
      return this.activateRemoteDevice(deviceId);
    }
    await this.ensureDaemonReady();
    this.updateDevice({
      ...device,
      status: "loading",
      detailText: "Resuming remote server...",
      lastError: void 0,
      activationPhase: "ping",
      activationUpdatedAt: Date.now(),
      recoveryEligible: true,
      recoverySource: "prepared_surface"
    });
    const pingResult = await toolBridge.call({
      toolName: "rd.remote.ping",
      args: { remote_id: prepared.remoteId },
      contextId: prepared.contextId
    });
    if (!pingResult.ok) {
      this.invalidatePreparedRemote(deviceId);
      return this.activateRemoteDevice(deviceId);
    }
    return {
      ...device,
      status: "online",
      remoteId: prepared.remoteId,
      bootstrap: prepared.bootstrap ?? device.bootstrap,
      detailText: buildRemoteReadyText(prepared.bootstrap ?? device.bootstrap),
      lastError: void 0,
      activationPhase: "ready",
      activationErrorCode: void 0,
      activationErrorMessage: void 0,
      activationUpdatedAt: Date.now(),
      lastSeen: Date.now(),
      recoveryEligible: true,
      recoveryValidatedAt: prepared.validatedAt,
      recoverySource: "prepared_surface"
    };
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
    const contextId = `ctx-device-${sanitizeDeviceId(device.serial)}-${generateShortId()}`;
    this.probeContexts.set(deviceId, contextId);
    const contextResult = await toolBridge.call({
      toolName: "rd.session.create_context",
      args: { context_id: contextId }
    });
    if (!contextResult.ok) {
      const parsedError = parseToolError(contextResult, "Failed to create a replay device context.");
      this.updateDevice(applyActivationFailure(device, "context", parsedError.message, parsedError.code));
      throw new Error(parsedError.message);
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
      this.updateDevice(applyActivationFailure(device, "init", parsedError.message, parsedError.code));
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
      this.updateDevice(applyActivationFailure(device, "connect", parsedError.message, parsedError.code));
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
      this.updateDevice(applyActivationFailure({ ...device, remoteId, bootstrap }, "ping", parsedError.message, parsedError.code));
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
      this.updateDevice(applyActivationFailure({ ...device, remoteId, bootstrap }, "targets", parsedError.message, parsedError.code));
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
      lastSeen: Date.now(),
      recoveryEligible: true,
      recoveryValidatedAt: validatedAt,
      recoverySource: "prepared_surface"
    };
  }
  async ensureDaemonReady() {
    const statusResult = await toolBridge.executeCLI("daemon", ["status"]);
    if (statusResult.exitCode === 0) {
      return;
    }
    const startResult = await toolBridge.executeCLI("daemon", ["start"]);
    if (startResult.exitCode !== 0) {
      const stderr = startResult.stderr.trim();
      throw new Error(stderr || "Failed to start the rdx daemon.");
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
    this.devices.set(device.id, device);
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
    const agentRole = state.agentRole;
    const agentConfig = config.agentConfigs[agentRole];
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
  // === 新增 Session 相关字段（Task 4a）===
  /** 当前 run 的 captures 列表 */
  captures: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => []
  }),
  /** Primary capture ID */
  primaryCaptureId: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
  }),
  /** 当前 Replay Device */
  replayDevice: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => null
  }),
  /** 当前模式 */
  mode: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => "debugger"
  }),
  /** 调试目标描述 */
  goal: langgraph.Annotation({
    reducer: (_, b) => b,
    default: () => ""
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
  electron.ipcMain.handle("context:get", async () => {
    return rdxSessionService.snapshotContext();
  });
  electron.ipcMain.handle("capture:list", async () => {
    return { captures: rdxSessionService.getCaptureDescriptors() };
  });
  electron.ipcMain.handle("capture:open", async (_event, filePath) => {
    try {
      if (!filePath) {
        return { success: false, error: "filePath is required for capture:open" };
      }
      return { success: false, error: "capture:open is not yet implemented" };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  electron.ipcMain.handle(
    "capture:openProjectInput",
    async (_event, request) => {
      try {
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
        return { success: true, openedCapture, contextSnapshot };
      } catch (err) {
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
  electron.ipcMain.handle("workflow:start", async (_event, request, userGoal) => {
    const isNewRequest = !Array.isArray(request);
    const capturePaths = isNewRequest ? request.captures.map((c) => c.filePath) : request;
    const goal = isNewRequest ? request.goal : userGoal ?? "";
    try {
      if (!ensureGraphInitialized()) {
        return {
          success: false,
          error: "WorkflowGraph not initialized"
        };
      }
      let contextSnapshot;
      if (isNewRequest) {
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
      }
      const gateResult = await harnessController.executeEntryGate({
        capturePaths,
        platform: "rdc-agent",
        entryMode: "cli",
        backend: isNewRequest ? request.captures.some((c) => c.backendHint === "remote") ? "remote" : "local" : "local",
        mode: isNewRequest ? request.mode : "debugger",
        captures: isNewRequest ? request.captures : void 0,
        replayDevice: isNewRequest ? request.replayDevice : void 0
      });
      if (gateResult.status === "blocked") {
        return {
          success: false,
          error: gateResult.blockers.map((b) => b.reason).join("; ")
        };
      }
      let caseId;
      if (isNewRequest) {
        caseId = request.sessionId || await storageAdapter.createCase({
          projectId: request.projectId,
          userGoal: goal,
          symptomSummary: goal
        });
      } else {
        const projectId = currentProjectId || storageAdapter.getCurrentProjectId();
        if (!projectId) {
          return {
            success: false,
            error: "Project is required before starting a workflow."
          };
        }
        caseId = await storageAdapter.createCase({
          projectId,
          userGoal: goal,
          symptomSummary: goal
        });
      }
      const { runId, sessionId } = await storageAdapter.createRun({
        caseId,
        capturePaths,
        mode: isNewRequest ? request.mode : "debugger",
        goal,
        captures: isNewRequest ? request.captures : void 0,
        backend: isNewRequest ? request.captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local" : "local"
      });
      currentSessionId = sessionId;
      currentRunId = runId;
      if (isNewRequest) {
        currentProjectId = request.projectId;
      }
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
        backend: isNewRequest ? request.captures.some((capture) => capture.backendHint === "remote") ? "remote" : "local" : "local",
        mode: isNewRequest ? request.mode : "debugger",
        goal,
        captures: isNewRequest ? request.captures : [],
        primaryCaptureId: isNewRequest ? request.primaryCaptureId : "",
        replayDevice: isNewRequest ? request.replayDevice : null,
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
      migrationOrphansPath: paths.migrationOrphansPath
    });
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
    this.replayDevice = request.replayDevice;
    this.deviceLabel = request.replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    const hasRemoteCapture = this.captures.some((capture) => capture.backendHint === "remote");
    let reusedPreparedRemote = false;
    if (hasRemoteCapture) {
      if (request.replayDevice.type === "local" || request.replayDevice.status !== "online") {
        throw new Error("Remote capture requires an online Replay Device.");
      }
      reusedPreparedRemote = await this.tryAdoptPreparedRemote(request.replayDevice);
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
    if (hasRemoteCapture) {
      if (reusedPreparedRemote) {
        const preparedRemoteStillValid = await this.validatePreparedRemoteHandle();
        if (!preparedRemoteStillValid) {
          this.remoteId = null;
          this.remoteStatus = "disconnected";
          await this.ensureRemoteConnection(request.replayDevice);
        } else {
          this.remoteStatus = "online";
        }
      } else {
        await this.ensureRemoteConnection(request.replayDevice);
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
    const capture = {
      id: request.inputId,
      filePath: request.filePath,
      role: "primary",
      backendHint: request.replayDevice.type === "local" ? "local" : "remote",
      status: "pending"
    };
    this.captures = [capture];
    this.activeCaptureId = capture.id;
    this.replayDevice = request.replayDevice;
    this.deviceLabel = request.replayDevice.label;
    this.remoteId = null;
    this.remoteStatus = "disconnected";
    await this.prepareFreshContext();
    const ownerResult = await this.claimOwner(this.contextId);
    this.runtimeOwner = ownerResult.owner;
    this.ownerLeaseId = ownerResult.leaseId;
    if (capture.backendHint === "remote") {
      if (request.replayDevice.type === "local" || !["connected", "online"].includes(request.replayDevice.status)) {
        throw new Error("Remote capture requires an available Replay Device.");
      }
      await this.ensureRemoteConnection(request.replayDevice);
    }
    await this.ensureCaptureSession(capture);
    const openedCapture = this.createOpenedCaptureState(request.projectId, request.inputId, request.filePath, request.replayDevice);
    this.openedCapture = openedCapture;
    return openedCapture;
  }
  async closeOrReplaceOpenedCapture() {
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
  }
  async prepareFreshContext() {
    this.contextId = await this.allocateContext();
    await this.initializeContextRuntime();
  }
  async ensureRuntimeReady() {
    const statusResult = await this.toolBridge.executeCLI("daemon", ["status"]);
    if (statusResult.exitCode === 0) {
      return;
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
  async ensureCaptureSession(capture) {
    const captureIndex = this.captures.findIndex((item) => item.id === capture.id);
    if (captureIndex < 0) {
      throw new Error(`Capture ${capture.id} not in captures list`);
    }
    this.captures[captureIndex] = { ...this.captures[captureIndex], status: "opening" };
    try {
      const openResult = await this.toolBridge.call({
        toolName: "rd.capture.open_file",
        args: { file_path: capture.filePath },
        contextId: this.contextId,
        runtimeOwner: this.runtimeOwner
      });
      if (!openResult.ok) {
        throw new Error(`Failed to open capture file: ${openResult.error?.message ?? "unknown"}`);
      }
      const replayArgs = {
        capture_file_id: openResult.data?.capture_file_id ?? capture.id
      };
      if (capture.backendHint === "remote") {
        if (!this.remoteId) {
          throw new Error("Remote replay requested but remote connection is not ready.");
        }
        replayArgs.remote_id = this.remoteId;
      }
      const replayResult = await this.toolBridge.call({
        toolName: "rd.capture.open_replay",
        args: replayArgs,
        contextId: this.contextId,
        runtimeOwner: this.runtimeOwner
      });
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
    const connectResult = await this.toolBridge.call({
      toolName: "rd.remote.connect",
      args: {
        timeout_ms: 5e3,
        options: {
          transport: "adb_android",
          device_serial: device.serial
        }
      },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner
    });
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
    const pingResult = await this.toolBridge.call({
      toolName: "rd.remote.ping",
      args: { remote_id: remoteId },
      contextId: this.contextId,
      runtimeOwner: this.runtimeOwner
    });
    if (!pingResult.ok) {
      this.remoteStatus = "error";
      throw new Error(`Remote ping failed (hard fail): ${pingResult.error?.message ?? device.activationErrorMessage ?? "unknown"}`);
    }
    this.remoteStatus = "online";
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
      runtimeOwner: this.runtimeOwner ?? void 0
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
  createOpenedCaptureState(projectId, inputId, filePath, replayDevice) {
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
      openedAt: Date.now()
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
const isDev = process.env.NODE_ENV === "development" || !electron.app.isPackaged;
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
  settingsService.initialize();
  await storageAdapter.initializeWorkspace();
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
    await initWorkflowGraph(workspacePath);
    console.log("[Main] WorkflowGraph initialized");
    await replayDeviceService.initialize();
    console.log("[Main] ReplayDeviceService initialized");
  } catch (error) {
    console.error("[Main] Failed to initialize services:", error);
  }
}
function getMainWindow() {
  return mainWindow;
}
exports.getMainWindow = getMainWindow;
exports.rdxSessionService = rdxSessionService;
