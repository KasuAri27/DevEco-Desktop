const { app, BrowserWindow, dialog, ipcMain, protocol, shell, nativeTheme } = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { AcpClient } = require("./acp-client.cjs");
const { SessionLibrary } = require("./session-library.cjs");
const { SingleOAuthGate, clearLateAuthorization } = require("./oauth-lifecycle.cjs");
const modelPolicy = require("../model-policy.js");
const jsonc = require("jsonc-parser");
const {
  ControlPlane,
  redactText,
  classifyError,
  accountSessionState,
  prependExecutableDirectory,
  sanitizeForRenderer,
  HUAWEI_REALNAME_URL,
} = require("./control-plane.cjs");
const {
  getCurrentPrivacy,
  setCurrentPrivacy,
  getDevicePrivacy,
  setDevicePrivacy,
} = require("./native-privacy.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const APP_ORIGIN = "deveco://app";
const allowedFiles = new Map([
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/management-ui-state.js", ["management-ui-state.js", "text/javascript; charset=utf-8"]],
  ["/model-policy.js", ["model-policy.js", "text/javascript; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/assets/huawei.svg", ["assets/huawei.svg", "image/svg+xml"]],
]);
for (const name of ["deepseek", "qwen", "zhipu", "moonshot", "xiaomi"]) {
  allowedFiles.set(`/assets/providers/${name}.svg`, [`assets/providers/${name}.svg`, "image/svg+xml"]);
}
for (const name of ["sun", "moon", "computer-desktop", "eye", "eye-slash", "check", "chevron-up", "chevron-down", "code-bracket", "exclamation-circle", "device-phone", "plus", "folder", "server", "shield-check", "user", "bolt"]) {
  allowedFiles.set(`/assets/ui/${name}.svg`, [`assets/ui/${name}.svg`, "image/svg+xml"]);
}

protocol.registerSchemesAsPrivileged([{
  scheme: "deveco",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
}]);

let mainWindow;
let acpClient;
let controlPlane;
let selectedWorkspace = null;
let sessionStartInProgress = false;
let agentStatus = { state: "disconnected", message: "选择工程以连接 DevEco Agent" };
let controlStatus = { state: "disconnected", message: "正在启动本机管理服务" };
let persistedState = {
  workspace: null,
  sessionId: null,
  sessionWorkspace: null,
  recentWorkspaces: [],
  studioPath: null,
  sdkPath: null,
  agentPath: null,
  nodePath: null,
  environmentSnapshot: null,
  onboardingComplete: false,
  themePreference: { hue: "blue", mode: "auto" },
  desktopDefaultModel: modelPolicy.DEFAULT_MODEL,
  projectDefaultModels: {},
  sessionModels: {},
  sessionModes: {},
};
let settingsWriteQueue = Promise.resolve();
const oauthFlows = new Map();
const oauthGate = new SingleOAuthGate();
const sessionLibrary = new SessionLibrary(() => requireControl());
let isCleaningUp = false;
let canQuit = false;

const settingsPath = () => path.join(app.getPath("userData"), "desktop-settings.json");

function emitEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("agent:event", payload);
}

function setAgentStatus(state, message, extra = {}) {
  agentStatus = { state, message, ...extra };
  emitEvent({ type: "status", status: agentStatus });
}

function isTrustedSender(event) {
  return event.senderFrame?.url?.startsWith(`${APP_ORIGIN}/`) ?? false;
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error("Untrusted renderer request");
}

async function readSettings() {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    for (const key of ["workspace", "sessionId", "sessionWorkspace", "studioPath", "sdkPath", "agentPath", "nodePath"]) {
      if (typeof parsed[key] === "string") persistedState[key] = parsed[key];
    }
    if (parsed.environmentSnapshot && typeof parsed.environmentSnapshot === "object") {
      persistedState.environmentSnapshot = parsed.environmentSnapshot;
    }
    persistedState.onboardingComplete = parsed.onboardingComplete === true;
    persistedState.themePreference = normalizeTheme(parsed.themePreference);
    if (typeof parsed.desktopDefaultModel === "string" && !modelPolicy.blocked(modelPolicy.providerId(parsed.desktopDefaultModel))) {
      persistedState.desktopDefaultModel = parsed.desktopDefaultModel;
    }
    for (const key of ["projectDefaultModels", "sessionModels", "sessionModes"]) {
      if (parsed[key] && typeof parsed[key] === "object" && !Array.isArray(parsed[key])) {
        persistedState[key] = Object.fromEntries(Object.entries(parsed[key])
          .filter(([, value]) => typeof value === "string" && value.length <= 200 && !modelPolicy.blocked(modelPolicy.providerId(value)))
          .slice(-100));
      }
    }
    if (Array.isArray(parsed.recentWorkspaces)) {
      persistedState.recentWorkspaces = parsed.recentWorkspaces
        .filter((directory) => typeof directory === "string" && path.isAbsolute(directory))
        .slice(0, 20);
    }
  } catch {
    persistedState = {
      workspace: null,
      sessionId: null,
      sessionWorkspace: null,
      recentWorkspaces: [],
      studioPath: null,
      sdkPath: null,
      agentPath: null,
      nodePath: null,
      environmentSnapshot: null,
      onboardingComplete: false,
      themePreference: { hue: "blue", mode: "auto" },
      desktopDefaultModel: modelPolicy.DEFAULT_MODEL,
      projectDefaultModels: {},
      sessionModels: {},
      sessionModes: {},
    };
  }
  selectedWorkspace = persistedState.workspace;
  if (selectedWorkspace) rememberWorkspace(selectedWorkspace);
}

function sameWorkspace(left, right) {
  if (!left || !right) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function rememberWorkspace(directory) {
  persistedState.recentWorkspaces = [directory, ...persistedState.recentWorkspaces
    .filter((previous) => !sameWorkspace(previous, directory))].slice(0, 20);
}

function assertKnownWorkspace(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) ||
      ![selectedWorkspace, ...persistedState.recentWorkspaces].some((known) => sameWorkspace(known, directory))) {
    throw new Error("请先通过选择工程添加此项目");
  }
  return path.resolve(directory);
}

async function listWorkspaceSessions(directory, options = {}) {
  await ensureControlPlane();
  return sessionLibrary.list(directory, options);
}

async function getSidebarSnapshot(options = {}) {
  const directory = selectedWorkspace;
  const archived = options?.archived === true;
  const result = directory ? await listWorkspaceSessions(directory, { archived }) : { sessions: [], readFailures: 0 };
  return {
    workspacePath: directory,
    projects: [...persistedState.recentWorkspaces],
    ...result,
    archived,
    currentSessionId: acpClient?.sessionId ?? (sameWorkspace(persistedState.sessionWorkspace, directory) ? persistedState.sessionId : null),
  };
}

async function watchSubmittedSession(client, sessionId, directory) {
  for (const delay of [0, 300, 700, 1500, 3000, 5000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (acpClient !== client || client.closed || client.sessionId !== sessionId) return;
    const session = await sessionLibrary.get(sessionId, directory);
    if (await sessionLibrary.hasUserMessage(session, { refresh: true })) {
      emitEvent({ type: "sidebar:changed", workspacePath: directory });
      return;
    }
    if (!client.activePrompt) return;
  }
}

async function finishSessionMutation(sessionId, directory, { removed = false } = {}) {
  const active = acpClient?.sessionId === sessionId && sameWorkspace(acpClient.cwd, directory);
  const warnings = [];
  if (persistedState.sessionId === sessionId) persistedState.sessionId = null;
  if (removed) {
    delete persistedState.sessionModels[sessionId];
    delete persistedState.sessionModes[sessionId];
  }
  if (active) {
    acpClient.sessionId = null;
    acpClient.configOptions = [];
    emitEvent({ type: "session-reset", sessionId: null });
    emitEvent({ type: "config-options", configOptions: [] });
    setAgentStatus("connecting", "正在准备新会话…");
  }
  try { await saveSettings(); }
  catch { warnings.push("会话数据已更新，但桌面偏好暂未保存"); }
  if (active) {
    try { await startAgentSession(directory, { resume: false }); }
    catch (error) {
      if (acpClient) { acpClient.sessionId = null; acpClient.configOptions = []; }
      setAgentStatus("error", classifyError(error.message).message);
      warnings.push("会话操作已完成；新会话连接失败，请重新连接");
    }
  }
  emitEvent({ type: "sidebar:changed", workspacePath: directory });
  return { completed: true, sessionId, warning: warnings.join("；") || null };
}

function saveSettings() {
  const contents = JSON.stringify(persistedState, null, 2);
  settingsWriteQueue = settingsWriteQueue.catch(() => {}).then(async () => {
    const destination = settingsPath();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + "." + crypto.randomUUID() + ".tmp";
    try {
      await fs.writeFile(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  });
  return settingsWriteQueue;
}

function normalizeTheme(value) {
  return { hue: value?.hue === "red" ? "red" : "blue", mode: ["auto", "light", "dark"].includes(value?.mode) ? value.mode : "auto" };
}

function windowCanvasColor() {
  const theme = persistedState.themePreference;
  const dark = theme.mode === "dark" || (theme.mode === "auto" && nativeTheme.shouldUseDarkColors);
  return theme.hue === "red" ? (dark ? "#191314" : "#FBF7F6") : (dark ? "#13161B" : "#F5F6F8");
}

function applyWindowTheme() {
  nativeTheme.themeSource = persistedState.themePreference.mode === "auto" ? "system" : persistedState.themePreference.mode;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowCanvasColor());
}

async function getDesktopModelCatalog(directory = selectedWorkspace) {
  await ensureControlPlane();
  const [providers, auth, config] = await Promise.all([
    requireControl().getProviders(directory || undefined),
    requireControl().getAuthMetadata(),
    requireControl().getConfig(directory ? "project" : "global", directory || undefined),
  ]);
  return modelPolicy.buildCatalog(sanitizeProviders(providers), auth, config.providers);
}

async function assertDesktopModel(value) {
  const catalog = await getDesktopModelCatalog();
  if (!modelPolicy.isAvailable(value, catalog)) {
    throw new Error("请选择已配置的支持服务或自定义服务中的模型；DevEco 模型需要先完成 Huawei 登录");
  }
  return catalog;
}

function desktopSessionSnapshot(client) {
  const state = client.snapshot();
  return { ...state, configOptions: modelPolicy.filterConfigOptions(state.configOptions, client.desktopCatalog) };
}

async function readProjectMetadata(filePath, root) {
  try {
    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(filePath);
    if (!realFile.toLowerCase().startsWith(realRoot.toLowerCase() + path.sep)) return null;
    const stat = await fs.stat(realFile);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const errors = [];
    const result = jsonc.parse(await fs.readFile(realFile, "utf8"), errors, { allowTrailingComma: true });
    return errors.length ? null : result;
  } catch { return null; }
}

async function getWorkspaceSummary() {
  const directory = selectedWorkspace;
  if (!directory) return { name: null, projectType: null, apiLevel: null };
  const profile = await readProjectMetadata(path.join(directory, "build-profile.json5"), directory);
  const source = typeof profile?.modules?.[0]?.srcPath === "string" ? profile.modules[0].srcPath : "entry";
  const moduleInfo = await readProjectMetadata(path.resolve(directory, source, "src/main/module.json5"), directory);
  const sdk = profile?.app?.products?.[0]?.compatibleSdkVersion;
  const apiLevel = typeof sdk === "number" && Number.isInteger(sdk) && sdk > 0 ? sdk : null;
  return { name: path.basename(directory), projectType: moduleInfo?.module?.abilities ? "Stage 模型" : null, apiLevel };
}

function bundledRuntimePaths() {
  const root = app.isPackaged ? process.resourcesPath : path.join(APP_ROOT, "bundled-runtime");
  const codeRoot = path.join(root, "node_modules", "@deveco", "deveco-code");
  return {
    codeRoot,
    agentPath: path.join(codeRoot, "bin", "deveco.exe"),
    cliEntry: path.join(codeRoot, "node_modules", "@deveco", "deveco-cli", "cli.js"),
    cliMarker: path.join(codeRoot, "vendor", ".deveco-cli-entry"),
    nodePath: app.isPackaged
      ? path.join(root, "node", "node.exe")
      : path.join(APP_ROOT, "bundled-runtime", "node-runtime", "node.exe"),
  };
}

function ensureBundledCliEntryMarker(runtime = bundledRuntimePaths()) {
  if (!fsSync.existsSync(runtime.agentPath) || !fsSync.existsSync(runtime.cliEntry)) return false;
  const entry = path.resolve(runtime.cliEntry);
  try {
    const current = fsSync.readFileSync(runtime.cliMarker, "utf8").trim();
    if (current !== entry) fsSync.writeFileSync(runtime.cliMarker, entry + "\n", "utf8");
    return true;
  } catch {
    try {
      fsSync.mkdirSync(path.dirname(runtime.cliMarker), { recursive: true });
      fsSync.writeFileSync(runtime.cliMarker, entry + "\n", "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

function resolveAgentExecutable() {
  const candidates = [];

  function addPackageCandidates(root) {
    if (!root) return;
    const base = path.resolve(root);
    const packagePaths = [
      path.join("node_modules", "@deveco", "deveco-code", "node_modules", "@deveco", "deveco-code-windows-x64", "bin", "deveco.exe"),
      path.join("node_modules", "@deveco", "deveco-code", "node_modules", "@deveco", "deveco-code-windows-x64-baseline", "bin", "deveco.exe"),
      path.join("node_modules", "@deveco", "deveco-code", "bin", "deveco.exe"),
      path.join("node_modules", "@deveco", "deveco-code-windows-x64", "bin", "deveco.exe"),
      path.join("node_modules", "@deveco", "deveco-code-windows-x64-baseline", "bin", "deveco.exe"),
      path.join("bin", "deveco.exe"),
      "deveco.exe",
    ];
    candidates.push(...packagePaths.map((relativePath) => path.join(base, relativePath)));
  }

  function addPackageCandidatesFromAncestors(root) {
    let directory = path.resolve(root);
    for (let depth = 0; depth < 4; depth += 1) {
      addPackageCandidates(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  function addConfiguredLocation(location) {
    if (typeof location !== "string" || !location.trim()) return;
    const target = path.resolve(location.trim().replace(/^"|"$/g, ""));
    if (/\.exe$/i.test(target)) candidates.push(target);
    else if (/\.cmd$/i.test(target) || /\.ps1$/i.test(target)) addPackageCandidatesFromAncestors(path.dirname(target));
    else {
      let isFile = false;
      try { isFile = fsSync.statSync(target).isFile(); } catch { /* Treat an unknown path as an install directory. */ }
      if (isFile) addPackageCandidatesFromAncestors(path.dirname(target));
      else {
        candidates.push(path.join(target, "deveco.exe"));
        addPackageCandidatesFromAncestors(target);
      }
    }
  }

  addConfiguredLocation(persistedState.agentPath);
  const bundled = bundledRuntimePaths();
  if (ensureBundledCliEntryMarker(bundled)) candidates.push(bundled.agentPath);
  const configured = process.env.DEVECO_EXECUTABLE || process.env.DEVECO_BIN_PATH;
  addConfiguredLocation(configured);

  const npmPrefixes = [
    process.env.NPM_CONFIG_PREFIX,
    process.env.npm_config_prefix,
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "npm") : null,
  ];
  for (const prefix of npmPrefixes) addPackageCandidates(prefix);

  for (const command of ["deveco.exe", "deveco.cmd"]) {
    try {
      const matches = execFileSync("where.exe", [command], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      }).split(/\r?\n/).filter(Boolean);
      for (const match of matches) addConfiguredLocation(match);
    } catch {
      // PATH lookup can fail when the CLI or its npm shim is not installed.
    }
  }

  return candidates.find((candidate) => {
    try { return fsSync.statSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}

function childEnvironment() {
  let env = { ...process.env };
  if (persistedState.studioPath) env.DEVECO_HOME = persistedState.studioPath;
  if (persistedState.sdkPath) env.DEVECO_SDK_HOME = persistedState.sdkPath;
  const bundled = bundledRuntimePaths();
  const nodePath = persistedState.nodePath || (fsSync.existsSync(bundled.nodePath) ? bundled.nodePath : null);
  if (nodePath) {
    env.DEVECO_NODE_PATH = nodePath;
    env = prependExecutableDirectory(env, nodePath);
  }
  if (ensureBundledCliEntryMarker(bundled)) {
    env.DEVECO_CLI_DISABLE_UPDATE = "1";
    env.DEVECO_CLI_SKIP_VERSION_CHECK = "1";
  }
  return env;
}

function ensureControlPlane() {
  if (controlPlane) return controlPlane.start();
  const executable = resolveAgentExecutable();
  controlPlane = new ControlPlane(executable, {
    cwd: APP_ROOT,
    environment: childEnvironment(),
    launcher: ({ executablePath, env, hostname, port }) => {
      const client = new AcpClient(executablePath, APP_ROOT, { env, network: { hostname, port } });
      client.deferDesktopReady = false;
      client.desktopReplay = [];
      acpClient = client;
      wireAgentEvents(client);
      const ready = client.initialize();
      return { child: client.process, ready, stop: () => client.stop() };
    },
  });
  controlPlane.on("diagnostic", (diagnostic) => {
    emitEvent({ type: "control:diagnostic", diagnostic });
  });
  controlPlane.on("ready", (snapshot) => {
    controlStatus = { state: "connected", message: "Agent 运行时已就绪", snapshot };
    emitEvent({ type: "control:status", status: controlStatus });
    if (!acpClient?.sessionId && !sessionStartInProgress) setAgentStatus("standby", "Agent 已就绪，连接工程即可开始", { agentInfo: acpClient?.agentInfo });
    emitEvent({ type: "runtime-ready" });
  });
  controlPlane.on("exit", ({ code, signal }) => {
    controlStatus = { state: "error", message: "Agent 运行时已退出", code, signal };
    emitEvent({ type: "control:status", status: controlStatus });
  });
  controlStatus = { state: "connecting", message: "正在准备 Agent 运行时" };
  setAgentStatus("connecting", "正在准备工作环境…", { phase: "runtime" });
  emitEvent({ type: "control:status", status: controlStatus });
  return controlPlane.start().then((snapshot) => {
    controlStatus = { state: "connected", message: "Agent 运行时已就绪", snapshot };
    return snapshot;
  }).catch((error) => {
    controlStatus = { state: "error", message: classifyError(error.message).message };
    setAgentStatus("error", controlStatus.message);
    emitEvent({ type: "control:status", status: controlStatus });
    throw error;
  });
}

async function restartControlPlane() {
  if (controlPlane) await controlPlane.stop();
  else await stopAgent();
  acpClient = null;
  controlPlane = null;
  return ensureControlPlane();
}

async function stopAgent() {
  if (!acpClient) return;
  const client = acpClient;
  acpClient = null;
  await client.stop();
}

function wireAgentEvents(client) {
  client.on("ready", (state) => {
    if (client.deferDesktopReady) return;
    setAgentStatus("connected", "已连接", { agentInfo: state.agentInfo });
    emitEvent({ type: "session-ready", state: desktopSessionSnapshot(client) });
  });
  client.on("session-update", (params) => {
    if (client.deferDesktopReady) client.desktopReplay?.push(params);
    else emitDesktopSessionUpdate(client, params);
  });
  client.on("config-options", (configOptions) => {
    if (!client.deferDesktopReady) emitEvent({ type: "config-options", configOptions: modelPolicy.filterConfigOptions(configOptions, client.desktopCatalog) });
  });
  client.on("permission-request", (request) => emitEvent({ type: "permission-request", request }));
  client.on("permission-cancelled", (requestId) => emitEvent({ type: "permission-cancelled", requestId }));
  client.on("prompt-started", () => emitEvent({ type: "prompt-started" }));
  client.on("prompt-finished", () => emitEvent({ type: "prompt-finished" }));
  client.on("diagnostic", (diagnostic) => emitEvent({ type: "agent:diagnostic", diagnostic }));
  client.on("protocol-error", (message) => setAgentStatus("error", redactText(message)));
  client.on("closed", (error) => {
    if (acpClient !== client) return;
    acpClient = null;
    setAgentStatus("error", classifyError(error.message || "DevEco Agent 连接中断").message);
  });
}

function emitDesktopSessionUpdate(client, params) {
  if (params?.update?.sessionUpdate === "config_option_update") {
    params = { ...params, update: { ...params.update, configOptions: modelPolicy.filterConfigOptions(params.update.configOptions, client.desktopCatalog) } };
  }
  emitEvent({ type: "session-update", params });
}

async function startAgentSession(workspacePath = selectedWorkspace, options = {}) {
  if (sessionStartInProgress) throw new Error("Agent 正在连接，请稍后再切换项目或会话");
  sessionStartInProgress = true;
  try {
    return await connectAgentSession(workspacePath, options);
  } finally {
    sessionStartInProgress = false;
  }
}

async function connectAgentSession(workspacePath = selectedWorkspace, options = {}) {
  if (!workspacePath) throw new Error("请先选择一个 HarmonyOS 工程目录");
  const info = await fs.stat(workspacePath).catch(() => null);
  if (!info?.isDirectory()) throw new Error("选择的工程目录不存在或无法访问，请重新选择");
  const catalog = await getDesktopModelCatalog(workspacePath);

  const client = acpClient;
  if (!client || client.closed || !client.initialized) throw new Error("Agent 运行时尚未就绪，请稍后重试");
  const previous = {
    workspace: selectedWorkspace,
    sessionId: persistedState.sessionId,
    sessionWorkspace: persistedState.sessionWorkspace,
    recentWorkspaces: [...persistedState.recentWorkspaces],
    clientState: client.snapshot(),
    catalog: client.desktopCatalog,
  };
  let resumeSessionId = options.resumeSessionId ?? (options.resume !== false &&
    persistedState.sessionWorkspace === workspacePath &&
    typeof persistedState.sessionId === "string"
    ? persistedState.sessionId
    : null);
  if (resumeSessionId) {
    try {
      const metadata = await sessionLibrary.get(resumeSessionId, workspacePath);
      if (metadata.time?.archived) throw new Error("此会话已归档，请先恢复后再继续");
    } catch (error) {
      if (options.requireResume) throw error;
      resumeSessionId = null;
    }
  }
  setAgentStatus("connecting", resumeSessionId ? "正在恢复会话…" : "正在打开工作区…", { phase: "session", agentInfo: client.agentInfo });
  client.desktopCatalog = catalog;
  client.deferDesktopReady = true;
  client.desktopReplay = [];
  try {
    await client.connect({ cwd: workspacePath, resumeSessionId, newSession: !resumeSessionId, requireResume: options.requireResume === true, force: true });
    const modelOption = client.configOptions.find((option) => option.category === "model" || option.id === "model" || option.configId === "model");
    const permitted = modelPolicy.filterConfigOptions(client.configOptions, catalog).find((option) => option.category === "model" || option.id === "model" || option.configId === "model");
    const preferred = (resumeSessionId && persistedState.sessionModels[resumeSessionId]) ||
      persistedState.projectDefaultModels[path.resolve(workspacePath).toLowerCase()] || persistedState.desktopDefaultModel;
    const value = modelPolicy.preferredValue(permitted?.options, preferred);
    if (value && value !== modelOption?.currentValue) await client.setConfigOption(modelOption.configId ?? modelOption.id, value);
    const modeOption = client.configOptions.find((option) => option.category === "mode" || option.id === "mode");
    const savedMode = persistedState.sessionModes[client.sessionId];
    if (savedMode && savedMode !== modeOption?.currentValue && modeOption?.options?.some((option) => option.value === savedMode)) {
      await client.setConfigOption(modeOption.configId ?? modeOption.id, savedMode);
    }
    const state = desktopSessionSnapshot(client);
    selectedWorkspace = workspacePath;
    persistedState.workspace = workspacePath;
    rememberWorkspace(workspacePath);
    persistedState.sessionId = state.sessionId;
    persistedState.sessionWorkspace = workspacePath;
    await saveSettings();
    client.deferDesktopReady = false;
    setAgentStatus("connected", "已连接", { agentInfo: state.agentInfo });
    emitEvent({ type: "session-reset", sessionId: state.sessionId });
    emitEvent({ type: "session-ready", state });
    for (const params of client.desktopReplay.splice(0)) {
      if (params?.update?.sessionUpdate !== "config_option_update") emitDesktopSessionUpdate(client, params);
    }
    return { ...state, workspacePath };
  } catch (error) {
    if (!client.closed && client.sessionId !== previous.clientState.sessionId) {
      if (previous.clientState.sessionId) {
        await client.connect({ cwd: previous.clientState.cwd, resumeSessionId: previous.clientState.sessionId, requireResume: true, force: true }).catch(() => {});
      } else {
        client.cwd = previous.clientState.cwd;
        client.sessionId = null;
        client.configOptions = [];
      }
    }
    client.desktopCatalog = previous.catalog;
    client.deferDesktopReady = false;
    client.desktopReplay = [];
    selectedWorkspace = previous.workspace;
    persistedState.workspace = previous.workspace;
    persistedState.sessionId = previous.sessionId;
    persistedState.sessionWorkspace = previous.sessionWorkspace;
    persistedState.recentWorkspaces = previous.recentWorkspaces;
    setAgentStatus("error", classifyError(error.message || "DevEco Agent 启动失败").message);
    throw error;
  }
}

async function stopAllProcesses() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  for (const flow of oauthFlows.values()) {
    if (flow.status === "waiting" && controlPlane) {
      await controlPlane.cancelProviderOAuth(flow.providerID, flow.directory).catch(() => {});
    }
  }
  oauthFlows.clear();
  if (controlPlane) await controlPlane.stop();
  else await stopAgent();
  acpClient = null;
  controlPlane = null;
}

function requireControl() {
  if (!controlPlane) throw new Error("DevEco Code 管理服务未运行");
  return controlPlane;
}

function assertOAuthIdle(action) {
  oauthGate.assertUnlocked(action);
}

async function withManagementMutation(action, callback) {
  if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再进行管理变更");
  if (sessionStartInProgress) throw new Error("工作区正在连接，请等待就绪后再操作");
  const lease = oauthGate.beginManagementMutation(action);
  try {
    return await callback();
  } finally {
    oauthGate.endManagementMutation(lease);
  }
}

function releaseOAuthFlow(flow) {
  if (flow?.timer) clearTimeout(flow.timer);
  if (flow?.id) oauthFlows.delete(flow.id);
  oauthGate.release(flow);
}

function sanitizeOAuthInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return {};
  const result = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (typeof value !== "string" || key.length > 80 || value.length > 2048) throw new Error("OAuth 输入无效或过长");
    result[key] = value;
  }
  return result;
}

function publishOAuthResult(flow, status, payload = {}) {
  flow.status = status;
  emitEvent({
    type: "oauth:progress",
    flowId: flow.id,
    providerID: flow.providerID,
    status,
    ...payload,
  });
}

function finishOAuthFlow(flow, error) {
  if (flow.status === "cancelled") {
    releaseOAuthFlow(flow);
    return;
  }
  releaseOAuthFlow(flow);
  if (error) {
    publishOAuthResult(flow, "failed", { error: classifyError(error.message).message });
    return;
  }
  publishOAuthResult(flow, "complete");
  ensureControlPlane().then(async () => {
    const [account, providers] = await Promise.all([
      requireControl().getAccountMetadata().catch(() => null),
      requireControl().getProviders(flow.directory).catch(() => null),
    ]);
    emitEvent({ type: "oauth:refreshed", providerID: flow.providerID, account, providers: sanitizeProviders(providers) });
    await reloadAgentSessionAfterSettingsChange();
  }).catch(() => {});
}

async function reloadAgentSessionAfterSettingsChange() {
  if (!acpClient || !selectedWorkspace || acpClient.activePrompt) return { effective: "next-session" };
  try {
    await startAgentSession(selectedWorkspace, { resume: true });
    return { effective: "current-session-refreshed" };
  } catch (error) {
    emitEvent({
      type: "agent:diagnostic",
      diagnostic: {
        time: new Date().toISOString(),
        source: "reconnect",
        message: classifyError(error.message).message,
      },
    });
    return { effective: "next-session", error: classifyError(error.message).message };
  }
}

function sanitizeProviders(data) {
  if (!data || typeof data !== "object") return { all: [], connected: [], default: {} };
  const all = Array.isArray(data.all) ? data.all : [];
  return {
    all: all.map((provider) => {
      const models = provider?.models && typeof provider.models === "object"
        ? Object.entries(provider.models).map(([id, model]) => ({
          id,
          name: typeof model?.name === "string" ? model.name : id,
          variants: model?.variants && typeof model.variants === "object" ? Object.keys(model.variants) : [],
        }))
        : [];
      return {
        id: String(provider?.id ?? ""),
        name: String(provider?.name ?? provider?.id ?? ""),
        source: String(provider?.source ?? ""),
        connected: Array.isArray(data.connected) && data.connected.includes(provider?.id),
        models,
      };
    }),
    connected: Array.isArray(data.connected) ? data.connected.map(String) : [],
    default: data.default && typeof data.default === "object" ? data.default : {},
  };
}

function openOfficialPage(kind) {
  const urls = {
    realname: HUAWEI_REALNAME_URL,
  };
  const target = urls[kind];
  if (!target) throw new Error("不支持打开此页面");
  return shell.openExternal(target);
}

function openProviderAuthorization(url) {
  const parsed = new URL(url);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error("Provider 授权链接必须使用 HTTPS 或本机回调地址");
  }
  return shell.openExternal(parsed.toString());
}

async function beginOAuthFromTrustedPage(providerID) {
  await ensureControlPlane();
  const methods = await requireControl().getProviderAuthMethods(selectedWorkspace);
  const available = Array.isArray(methods?.[providerID]) ? methods[providerID] : [];
  const methodIndex = available.findIndex((item) => item.type === "oauth");
  if (methodIndex < 0) throw new Error("当前 Provider 未发布 OAuth 登录方法");
  return beginOAuthFlow(providerID, methodIndex, {}, selectedWorkspace);
}

async function beginOAuthFlow(providerID, methodIndex, inputs, directory) {
  if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再开始 Provider 授权");
  const flow = oauthGate.reserve({
    id: crypto.randomUUID(),
    providerID,
    methodIndex,
    directory,
    authorizationMethod: null,
    authorizationPending: true,
    authorizationRequested: false,
    cancelRequested: false,
    cancelSent: false,
    cancelPublished: false,
    status: "authorizing",
    timer: null,
  });
  oauthFlows.set(flow.id, flow);
  flow.timer = setTimeout(() => {
    cancelOAuthFlow(flow.id).catch(() => {});
  }, 10 * 60_000);
  try {
    await ensureControlPlane();
    if (flow.cancelRequested) throw new Error("Provider 授权已取消");
    const methods = await requireControl().getProviderAuthMethods(directory);
    const available = Array.isArray(methods?.[providerID]) ? methods[providerID] : [];
    const method = available[methodIndex];
    if (!method || method.type !== "oauth") throw new Error("当前 Provider 未发布所选 OAuth 方法");
    if (flow.cancelRequested) throw new Error("Provider 授权已取消");
    flow.authorizationRequested = true;
    const authorization = await requireControl().authorizeProvider(providerID, methodIndex, inputs, directory);
    if (await clearLateAuthorization(flow, () => cancelCoreOAuth(flow, true))) {
      throw new Error("Provider 授权已取消");
    }
    if (flow.cancelRequested) {
      await cancelCoreOAuth(flow, true);
      throw new Error("Provider 授权已取消");
    }
    if (!authorization || !["auto", "code"].includes(authorization.method)) {
      throw new Error("DevEco Code 未返回有效 OAuth 授权流程");
    }
    flow.authorizationMethod = authorization.method;
    flow.status = authorization.method === "code" ? "awaiting-code" : "waiting";
    if (authorization.url) await openProviderAuthorization(authorization.url);
    if (await clearLateAuthorization(flow, () => cancelCoreOAuth(flow, true))) {
      throw new Error("Provider 授权已取消");
    }
    if (flow.cancelRequested) {
      await cancelCoreOAuth(flow, true);
      throw new Error("Provider 授权已取消");
    }
    flow.authorizationPending = false;
    if (authorization.method === "auto") launchOAuthCallback(flow);
    else publishOAuthResult(flow, "awaiting-code");

    return {
      flowId: flow.id,
      authorizationUrlOpened: Boolean(authorization.url),
      method: authorization.method,
      instructions: redactText(authorization.instructions || ""),
      status: flow.status,
      timeoutMs: 10 * 60_000,
    };
  } catch (error) {
    flow.authorizationPending = false;
    if (flow.cancelRequested || flow.status === "cancelled") {
      await cancelCoreOAuth(flow);
      if (!flow.cancelPublished) {
        flow.cancelPublished = true;
        publishOAuthResult(flow, "cancelled");
      }
      releaseOAuthFlow(flow);
      throw new Error("Provider 授权已取消");
    }
    if (flow.authorizationRequested) await cancelCoreOAuth(flow);
    releaseOAuthFlow(flow);
    throw error;
  }
}

function launchOAuthCallback(flow, code) {
  if (!flow || flow.status === "cancelled" || flow.callbackStarted) return;
  flow.callbackStarted = true;
  publishOAuthResult(flow, "waiting");
  requireControl().completeProviderOAuth(flow.providerID, flow.methodIndex, code, flow.directory)
    .then((result) => {
      if (result !== true) throw new Error("DevEco Code 未确认 OAuth 回调完成");
      finishOAuthFlow(flow, null);
    })
    .catch((error) => finishOAuthFlow(flow, error));
}

async function cancelOAuthFlow(flowId) {
  const flow = oauthFlows.get(flowId);
  if (!flow) return false;
  oauthGate.requestCancel(flow);
  if (flow.timer) clearTimeout(flow.timer);
  await cancelCoreOAuth(flow);
  if (!flow.cancelPublished) {
    flow.cancelPublished = true;
    publishOAuthResult(flow, "cancelled");
  }
  if (!flow.authorizationPending) releaseOAuthFlow(flow);
  return true;
}

async function cancelCoreOAuth(flow, force = false) {
  if (!flow || (flow.cancelSent && !force)) return;
  flow.cancelSent = true;
  await ensureControlPlane().catch(() => {});
  await controlPlane?.cancelProviderOAuth(flow.providerID, flow.directory).catch(() => {});
}

async function cancelOAuthForProvider(providerID) {
  const flow = [...oauthFlows.values()].find((item) => item.providerID === providerID);
  return flow ? cancelOAuthFlow(flow.id) : false;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: windowCanvasColor(),
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, "assets", "huawei-app.png"),
    title: "DevEco Agent Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
}

app.setName("DevEco Agent Desktop");
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

app.whenReady().then(async () => {
  if (!singleInstance) return;
  await readSettings();
  applyWindowTheme();
  protocol.handle("deveco", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app" || !allowedFiles.has(url.pathname)) return new Response("Not found", { status: 404 });
    const [relativePath, contentType] = allowedFiles.get(url.pathname);
    const contents = await fs.readFile(path.join(APP_ROOT, relativePath));
    return new Response(contents, { headers: { "Content-Type": contentType, "X-Content-Type-Options": "nosniff" } });
  });

  ipcMain.handle("theme:get", (event) => {
    assertTrustedSender(event);
    return { ...persistedState.themePreference };
  });
  ipcMain.handle("theme:set", async (event, preference) => {
    assertTrustedSender(event);
    if (!preference || !["red", "blue"].includes(preference.hue) || !["light", "dark", "auto"].includes(preference.mode)) {
      throw new Error("外观选项无效");
    }
    persistedState.themePreference = normalizeTheme(preference);
    await saveSettings();
    applyWindowTheme();
    return { ...persistedState.themePreference };
  });
  ipcMain.handle("models:catalog", async (event) => {
    assertTrustedSender(event);
    return getDesktopModelCatalog();
  });
  ipcMain.handle("workspace:summary", async (event) => {
    assertTrustedSender(event);
    return getWorkspaceSummary();
  });
  ipcMain.handle("provider:open-key-page", (event, providerID) => {
    assertTrustedSender(event);
    const target = modelPolicy.brand(providerID)?.keyUrl;
    if (!target) throw new Error("该服务没有内置的 Key 管理页面");
    return shell.openExternal(target);
  });
  ipcMain.handle("provider:check-connection", async (event, providerID, apiKey) => {
    assertTrustedSender(event);
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096) throw new Error("请先填写需要检测的 API Key");
    const endpoints = {
      deepseek: "https://api.deepseek.com/models",
      "alibaba-cn": "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
      zhipuai: "https://open.bigmodel.cn/api/paas/v4/models",
      zai: "https://api.z.ai/api/paas/v4/models",
      "moonshotai-cn": "https://api.moonshot.cn/v1/models",
      moonshotai: "https://api.moonshot.ai/v1/models",
      xiaomi: "https://api.xiaomimimo.com/v1/models",
    };
    const endpoint = endpoints[providerID];
    if (!endpoint) throw new Error("该服务没有内置的连接检测入口");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(endpoint, { method: "GET", headers: { Authorization: "Bearer " + apiKey.trim() }, signal: controller.signal, redirect: "error" });
      if ([404, 405, 501].includes(response.status)) return { status: "unsupported", message: "该服务不支持模型目录检测，可保存后通过实际对话确认。" };
      if (response.status === 401) return { status: "rejected", message: "服务未接受此 Key，请检查内容和所属平台。" };
      if (response.status === 403) return { status: "rejected", message: "此 Key 暂无模型目录访问权限，请检查账号或区域。" };
      if (!response.ok) return { status: "unknown", message: "服务返回 HTTP " + response.status + "，暂未确认连接。" };
      const result = await response.json().catch(() => null);
      if (!Array.isArray(result?.data)) return { status: "unsupported", message: "服务响应不是可验证的模型目录，可保存后通过实际对话确认。" };
      return { status: "accessible", message: "可访问模型目录（" + result.data.length + " 个模型）。未发送对话请求。" };
    } catch (error) {
      return { status: "unknown", message: error?.name === "AbortError" ? "检测超时，请检查网络后重试。" : "暂未确认连接，请检查网络、代理或服务状态。" };
    } finally { clearTimeout(timer); }
  });

  ipcMain.handle("app:get-state", async (event, options) => {
    assertTrustedSender(event);
    void ensureControlPlane().catch(() => {});
    const environment = persistedState.environmentSnapshot;
    const service = options?.includeManagement === true && controlPlane?.ready ? controlPlane : null;
    const [account, agreement, effectiveConfig] = await Promise.all([
      service?.getAccountMetadata().catch(() => null),
      service?.getAgreement().catch(() => null),
      service?.request("/config" + (selectedWorkspace ? "?directory=" + encodeURIComponent(selectedWorkspace) : "")).catch(() => null),
    ]);
    const activeModel = acpClient?.configOptions.find((option) => option.category === "model" || option.id === "model")?.currentValue;
    const usesHuaweiModel = String(activeModel || effectiveConfig?.model || "").startsWith("deveco/");
    const agreementNeedsAttention = Boolean(agreement &&
      (!agreement.accepted || (usesHuaweiModel && agreement.upload?.state === "review_required")));
    return {
      workspacePath: selectedWorkspace,
      recentWorkspaces: [...persistedState.recentWorkspaces],
      status: agentStatus,
      controlStatus,
      account,
      agreement,
      agreementNeedsAttention,
      environment,
      onboardingComplete: persistedState.onboardingComplete,
      agentInstalled: Boolean(resolveAgentExecutable()),
      state: acpClient && !acpClient.deferDesktopReady ? desktopSessionSnapshot(acpClient) : null,
    };
  });

  ipcMain.handle("workspace:select", async (event) => {
    assertTrustedSender(event);
    return withManagementMutation("切换项目", async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择 HarmonyOS 工程目录",
        buttonLabel: "连接工程",
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return startAgentSession(result.filePaths[0], { resume: true });
    });
  });

  ipcMain.handle("sidebar:get", async (event, options) => {
    assertTrustedSender(event);
    return getSidebarSnapshot({ archived: options?.archived === true });
  });

  ipcMain.handle("workspace:open", async (event, directory) => {
    assertTrustedSender(event);
    return withManagementMutation("切换项目", async () => {
      const target = assertKnownWorkspace(directory);
      if (sameWorkspace(target, selectedWorkspace) && acpClient?.sessionId && !acpClient.closed && !acpClient.deferDesktopReady) {
        return { ...desktopSessionSnapshot(acpClient), workspacePath: selectedWorkspace };
      }
      const { sessions } = await listWorkspaceSessions(target);
      return startAgentSession(target, sessions.length
        ? { resumeSessionId: sessions[0].id, requireResume: true }
        : { resume: false });
    });
  });

  ipcMain.handle("agent:open-session", async (event, sessionId, directory) => {
    assertTrustedSender(event);
    return withManagementMutation("切换会话", async () => {
      const target = assertKnownWorkspace(directory);
      if (typeof sessionId !== "string" || !/^ses_[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("会话 ID 无效");
      await ensureControlPlane();
      const metadata = await requireControl().request("/session/" + encodeURIComponent(sessionId) + "?directory=" + encodeURIComponent(target));
      if (metadata?.id !== sessionId || metadata.parentID || metadata.time?.archived || !sameWorkspace(metadata.directory, target)) {
        throw new Error("所选会话不属于此项目或已归档");
      }
      if (acpClient?.sessionId === sessionId && sameWorkspace(target, selectedWorkspace) && !acpClient.closed && !acpClient.deferDesktopReady) {
        return { ...desktopSessionSnapshot(acpClient), workspacePath: selectedWorkspace };
      }
      return startAgentSession(target, { resumeSessionId: sessionId, requireResume: true });
    });
  });

  ipcMain.handle("agent:new-session", async (event) => {
    assertTrustedSender(event);
    return withManagementMutation("新建会话", () => startAgentSession(selectedWorkspace, { resume: false }));
  });

  ipcMain.handle("agent:archive-session", async (event, sessionId, directory) => {
    assertTrustedSender(event);
    return withManagementMutation("归档会话", async () => {
      const target = assertKnownWorkspace(directory);
      await ensureControlPlane();
      await sessionLibrary.setArchived(sessionId, target, true);
      return finishSessionMutation(sessionId, target);
    });
  });

  ipcMain.handle("agent:restore-session", async (event, sessionId, directory) => {
    assertTrustedSender(event);
    return withManagementMutation("恢复归档会话", async () => {
      const target = assertKnownWorkspace(directory);
      await ensureControlPlane();
      await sessionLibrary.setArchived(sessionId, target, false);
      emitEvent({ type: "sidebar:changed", workspacePath: target });
      return { completed: true, sessionId };
    });
  });

  ipcMain.handle("agent:delete-session", async (event, sessionId, directory) => {
    assertTrustedSender(event);
    return withManagementMutation("删除会话", async () => {
      const target = assertKnownWorkspace(directory);
      await ensureControlPlane();
      const session = await sessionLibrary.get(sessionId, target);
      const confirmation = await dialog.showMessageBox(mainWindow, {
        type: "warning", title: "删除会话", message: "删除“" + String(session.title || "新会话").slice(0, 120) + "”？",
        detail: "会话及其消息记录将从本机 Agent 中永久删除，无法恢复。",
        buttons: ["取消", "删除会话"], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (confirmation.response !== 1) return { cancelled: true };
      await sessionLibrary.remove(sessionId, target);
      return finishSessionMutation(sessionId, target, { removed: true });
    });
  });

  ipcMain.handle("agent:reconnect", async (event) => {
    assertTrustedSender(event);
    if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后重连");
    return withManagementMutation("重新连接工作区", () => startAgentSession(selectedWorkspace, { resume: true }));
  });

  ipcMain.handle("agent:send", async (event, text) => {
    assertTrustedSender(event);
    assertOAuthIdle("提交任务");
    if (typeof text !== "string" || !text.trim() || text.length > 100_000) throw new Error("任务内容为空或过长");
    const client = acpClient;
    const sessionId = client?.sessionId;
    const isSessionReady = () => client && acpClient === client && !client.closed && sessionId === client.sessionId &&
      !client.deferDesktopReady && !sessionStartInProgress && agentStatus.state === "connected" && sameWorkspace(client.cwd, selectedWorkspace);
    if (!sessionId || !isSessionReady()) throw new Error("工作区尚未准备完成，请等待连接就绪后再发送");
    let agreement;
    try {
      agreement = await requireControl().getAgreement();
    } catch {
      emitEvent({ type: "agreement:required", reason: "当前无法核验协议状态" });
      throw new Error("无法确认当前 DevEco Code 协议状态；任务未发送。请检查管理服务连接后重试。");
    }
    const modelOption = (client.configOptions ?? []).find((option) =>
      option?.category === "model" || option?.id === "model" || option?.configId === "model");
    const currentModel = typeof modelOption?.currentValue === "string" ? modelOption.currentValue : "";
    await assertDesktopModel(currentModel);
    const needsProductConsent = agreement?.accepted !== true;
    const needsHuaweiServiceReview = currentModel.startsWith("deveco/") && agreement?.upload?.state === "review_required";
    if (needsProductConsent || needsHuaweiServiceReview) {
      emitEvent({
        type: "agreement:required",
        reason: needsHuaweiServiceReview ? "Huawei 服务协议已更新" : "需要同意当前版本的 DevEco Code 产品协议",
      });
      throw new Error(needsHuaweiServiceReview
        ? "Huawei 服务协议需要重新阅读并同意；任务未发送。"
        : "请先在协议与隐私页面阅读并同意当前产品协议；任务未发送。");
    }
    assertOAuthIdle("提交任务");
    if (!isSessionReady() || client.configOptions.find((option) => option?.category === "model" || option?.id === "model" || option?.configId === "model")?.currentValue !== currentModel) {
      throw new Error("工作区或模型已改变，任务未发送，请重新提交");
    }
    const prompt = client.sendPrompt(text.trim());
    void watchSubmittedSession(client, sessionId, selectedWorkspace).catch(() => {});
    try { return await prompt; }
    finally {
      sessionLibrary.forget(sessionId);
      emitEvent({ type: "sidebar:changed", workspacePath: client.cwd });
    }
  });

  ipcMain.handle("agent:set-config-option", async (event, configId, value, type = "id") => {
    assertTrustedSender(event);
    if (typeof configId !== "string" || !configId || !(typeof value === "string" || typeof value === "boolean")) {
      throw new Error("无效的模型设置");
    }
    return withManagementMutation("切换会话设置", async () => {
      const client = acpClient;
      if (!client) throw new Error("Agent 尚未连接");
      if (client.deferDesktopReady) throw new Error("请等待连接完成后再切换");
      const option = client.configOptions.find((item) => (item.configId ?? item.id) === configId);
      if (!option) throw new Error("当前会话未提供此设置");
      const isModel = option.category === "model" || option.id === "model" || option.configId === "model";
      const isMode = option.category === "mode" || option.id === "mode" || option.configId === "mode";
      if (isModel && !option.options?.some((candidate) => String(candidate.value) === String(value))) throw new Error("当前会话未提供此模型，请刷新模型目录后重试");
      if (isMode && !option.options?.some((candidate) => String(candidate.value) === String(value))) throw new Error("当前会话未提供此工作模式");
      if (isModel) client.desktopCatalog = await assertDesktopModel(value);
      const result = await client.setConfigOption(configId, value, type);
      if (isModel) {
        persistedState.sessionModels = Object.fromEntries(Object.entries({ ...persistedState.sessionModels, [client.sessionId]: String(value) }).slice(-100));
        await saveSettings();
      }
      if (isMode) {
        persistedState.sessionModes = Object.fromEntries(Object.entries({ ...persistedState.sessionModes, [client.sessionId]: String(value) }).slice(-100));
        await saveSettings();
      }
      return { ...result, configOptions: modelPolicy.filterConfigOptions(result.configOptions, client.desktopCatalog) };
    });
  });

  ipcMain.handle("agent:set-default-model", async (event, model, scope = "global") => {
    assertTrustedSender(event);
    return withManagementMutation("更改默认模型", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再更改默认模型");
      if (scope !== "global" && scope !== "project") throw new Error("默认模型作用域无效");
      if (typeof model !== "string" || !model.trim() || model.length > 200) throw new Error("默认模型无效");
      if (scope === "project" && !selectedWorkspace) throw new Error("先选择工程，才能设置项目默认模型");
      await ensureControlPlane();
      await assertDesktopModel(model.trim());
      const result = await requireControl().updateConfig(scope, selectedWorkspace, { model: model.trim() });
      if (scope === "project") persistedState.projectDefaultModels[path.resolve(selectedWorkspace).toLowerCase()] = model.trim();
      else persistedState.desktopDefaultModel = model.trim();
      await saveSettings();
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { config: result, effective: reload.effective };
    });
  });

  ipcMain.handle("agent:cancel", async (event) => {
    assertTrustedSender(event);
    return acpClient?.cancelPrompt() ?? false;
  });

  ipcMain.handle("agent:permission-response", async (event, requestId, optionId) => {
    assertTrustedSender(event);
    if (!acpClient || (optionId !== null && typeof optionId !== "string")) return false;
    return acpClient.respondToPermission(requestId, optionId);
  });

  ipcMain.handle("management:retry", async (event) => {
    assertTrustedSender(event);
    return withManagementMutation("重启 Agent 运行时", async () => {
      const snapshot = await restartControlPlane();
      if (selectedWorkspace) await startAgentSession(selectedWorkspace, { resume: true });
      return { status: controlStatus, snapshot };
    });
  });

  ipcMain.handle("account:refresh", async (event) => {
    assertTrustedSender(event);
    await ensureControlPlane();
    const [metadata, identity] = await Promise.all([
      requireControl().getAccountMetadata(),
      requireControl().getCliUserStatus(persistedState).catch((error) => ({ loggedIn: false, userName: null, error: classifyError(error.message).message })),
    ]);
    const sessionState = accountSessionState(metadata, identity);
    return {
      loggedIn: sessionState === "valid",
      sessionState,
      credentialCached: metadata.loggedIn,
      identityLoggedIn: identity.loggedIn === true,
      userName: identity.userName,
      realName: metadata.realName,
      realNameSource: metadata.realNameSource,
      credentialType: metadata.credentialType,
      removable: metadata.removable,
      identityChecked: identity.status === "valid" || identity.status === "expired",
      identityError: identity.error ?? null,
    };
  });

  ipcMain.handle("account:start-login", async (event) => {
    assertTrustedSender(event);
    if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再登录");
    await ensureControlPlane();
    const providerID = "deveco";
    const methods = await requireControl().getProviderAuthMethods(selectedWorkspace);
    const oauthMethods = Array.isArray(methods?.[providerID]) ? methods[providerID] : [];
    const method = oauthMethods.findIndex((item) => item.type === "oauth");
    if (method < 0) throw new Error("当前 DevEco Code 未发布 Huawei OAuth 登录方法");
    return beginOAuthFlow(providerID, method, {}, selectedWorkspace);
  });

  ipcMain.handle("account:logout", async (event) => {
    assertTrustedSender(event);
    return withManagementMutation("退出账号", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再退出账号");
      await ensureControlPlane();
      const currentAccount = await requireControl().getAccountMetadata();
      if (!currentAccount.removable) throw new Error("当前账号由运行环境覆盖，不能从桌面端移除");
      await requireControl().removeCredential("deveco");
      await restartControlPlane();
      await reloadAgentSessionAfterSettingsChange();
      const account = await requireControl().getAccountMetadata();
      return { loggedIn: account.loggedIn, realName: account.realName, sessionState: "signed-out" };
    });
  });

  ipcMain.handle("account:recheck-realname", async (event) => {
    assertTrustedSender(event);
    if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再核验实名状态");
    return beginOAuthFromTrustedPage("deveco");
  });

  ipcMain.handle("oauth:start", async (event, providerID, methodIndex, inputs, directory) => {
    assertTrustedSender(event);
    if (typeof providerID !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(providerID)) throw new Error("Provider ID 无效");
    const targetDirectory = directory === "project" ? selectedWorkspace : undefined;
    return beginOAuthFlow(providerID, methodIndex, sanitizeOAuthInputs(inputs), targetDirectory);
  });

  ipcMain.handle("oauth:complete", async (event, flowId, code) => {
    assertTrustedSender(event);
    const flow = oauthFlows.get(flowId);
    if (!flow) throw new Error("此授权流程已结束或超时");
    if (flow.authorizationMethod !== "code") throw new Error("此流程不需要手动授权码");
    if (typeof code !== "string" || !code.trim() || code.length > 2048) throw new Error("授权码无效");
    launchOAuthCallback(flow, code.trim());
    return { flowId, status: "waiting" };
  });

  ipcMain.handle("oauth:cancel", async (event, flowId) => {
    assertTrustedSender(event);
    return cancelOAuthFlow(flowId);
  });

  ipcMain.handle("oauth:cancel-provider", async (event, providerID) => {
    assertTrustedSender(event);
    return cancelOAuthForProvider(providerID);
  });

  ipcMain.handle("provider:list", async (event, scope = "project") => {
    assertTrustedSender(event);
    if (scope !== "global" && scope !== "project") throw new Error("Provider 作用域无效");
    await ensureControlPlane();
    if (scope === "project" && !selectedWorkspace) throw new Error("先选择工程，才能查看项目 Provider");
    const directory = scope === "project" ? selectedWorkspace : undefined;
    const [providers, methods, account, authEntries, config] = await Promise.all([
      requireControl().getProviders(directory),
      requireControl().getProviderAuthMethods(directory),
      requireControl().getAccountMetadata(),
      requireControl().getAuthMetadata(),
      requireControl().getConfig(scope, directory),
    ]);
    return {
      providers: sanitizeProviders(providers),
      authMethods: sanitizeForRenderer(methods && typeof methods === "object" ? methods : {}),
      authEntries,
      config,
      account,
      scope,
      directory: scope === "project" ? directory : null,
    };
  });

  ipcMain.handle("provider:save", async (event, input, scope = "global") => {
    assertTrustedSender(event);
    return withManagementMutation("保存 Provider 配置", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再更改 Provider");
      await ensureControlPlane();
      if (scope !== "global" && scope !== "project") throw new Error("Provider 配置作用域无效");
      const result = await requireControl().addOrEditProvider(input, scope, selectedWorkspace);
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { ...result, providers: sanitizeProviders(result.providers), scope, effective: reload.effective };
    });
  });

  ipcMain.handle("provider:save-credential", async (event, providerID, apiKey, scope = "global") => {
    assertTrustedSender(event);
    return withManagementMutation("保存 Provider 凭据", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再更改 Provider 凭据");
      await ensureControlPlane();
      const directory = scope === "project" ? selectedWorkspace : undefined;
      const result = await requireControl().saveProviderApiCredential(providerID, apiKey, scope, directory);
      await requireControl().refreshProviders(directory);
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { ...result, scope, effective: reload.effective };
    });
  });

  ipcMain.handle("provider:remove", async (event, providerID, scope = "global") => {
    assertTrustedSender(event);
    return withManagementMutation("移除 Provider", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再移除 Provider");
      if (scope !== "global" && scope !== "project") throw new Error("Provider 作用域无效");
      await ensureControlPlane();
      if (typeof providerID !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(providerID)) throw new Error("Provider ID 无效");
      if (providerID === "deveco") throw new Error("内置 DevEco Provider 请在账号中心退出登录");
      const result = await requireControl().removeProvider(providerID, scope, selectedWorkspace);
      const providers = await requireControl().refreshProviders(scope === "project" ? selectedWorkspace : undefined);
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { ...result, providers: sanitizeProviders(providers), effective: reload.effective };
    });
  });

  ipcMain.handle("provider:remove-credential", async (event, providerID) => {
    assertTrustedSender(event);
    return withManagementMutation("移除 Provider 凭据", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再移除凭据");
      if (typeof providerID !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(providerID) || providerID === "deveco") {
        throw new Error("不能通过此入口移除该 Provider 凭据");
      }
      await ensureControlPlane();
      await requireControl().removeCredential(providerID);
      return reloadAgentSessionAfterSettingsChange();
    });
  });

  ipcMain.handle("provider:refresh", async (event, scope = "project") => {
    assertTrustedSender(event);
    return withManagementMutation("刷新 Provider 目录", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再刷新 Provider 目录");
      if (scope !== "global" && scope !== "project") throw new Error("Provider 作用域无效");
      await ensureControlPlane();
      const directory = scope === "project" ? selectedWorkspace : undefined;
      if (scope === "project" && !directory) throw new Error("先选择工程，才能刷新项目 Provider");
      const providers = sanitizeProviders(await requireControl().refreshProviders(directory));
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { ...providers, effective: reload.effective };
    });
  });

  ipcMain.handle("agreement:get", async (event) => {
    assertTrustedSender(event);
    await ensureControlPlane();
    return requireControl().getAgreement();
  });

  ipcMain.handle("agreement:accept", async (event, version, serviceRevision, userAccepted) => {
    assertTrustedSender(event);
    return withManagementMutation("提交协议同意", async () => {
      if (userAccepted !== true) throw new Error("请先阅读并主动勾选协议");
      await ensureControlPlane();
      return requireControl().acceptAgreement(version, serviceRevision);
    });
  });

  ipcMain.handle("privacy:get", async (event) => {
    assertTrustedSender(event);
    await ensureControlPlane();
    const paths = await requireControl().request("/path");
    return sanitizeForRenderer(await getCurrentPrivacy({ config: paths?.config, state: paths?.state }));
  });

  ipcMain.handle("privacy:set", async (event, granted, revision) => {
    assertTrustedSender(event);
    return withManagementMutation("更改账号隐私偏好", async () => {
      if (typeof granted !== "boolean" || typeof revision !== "string" || !revision) {
        throw new Error("隐私偏好参数无效，请先重新读取当前账号偏好");
      }
      await ensureControlPlane();
      const paths = await requireControl().request("/path");
      const result = await setCurrentPrivacy({ config: paths?.config, state: paths?.state }, granted, revision);
      if (!result?.available || result.decision === "unknown") {
        throw new Error(result?.reason || "当前账号偏好无法保存，请重新读取后重试");
      }
      await restartControlPlane();
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { ...sanitizeForRenderer(result), effective: reload.effective };
    });
  });

  ipcMain.handle("privacy-device:get", async (event) => {
    assertTrustedSender(event);
    await ensureControlPlane();
    const paths = await requireControl().request("/path");
    return sanitizeForRenderer(await getDevicePrivacy({ config: paths?.config, state: paths?.state }));
  });

  ipcMain.handle("privacy-device:set", async (event, preferences, revision) => {
    assertTrustedSender(event);
    return withManagementMutation("更改设备隐私偏好", async () => {
      if (!preferences || typeof preferences.analyticsEnabled !== "boolean" ||
          typeof preferences.crashUploadEnabled !== "boolean" || typeof revision !== "string" || !revision) {
        throw new Error("设备隐私偏好参数无效，请先重新读取后再保存");
      }
      await ensureControlPlane();
      const paths = await requireControl().request("/path");
      const result = await setDevicePrivacy(
        { config: paths?.config, state: paths?.state },
        preferences,
        revision,
      );
      if (!result?.available) throw new Error(result?.reason || "设备隐私偏好不可用");
      await restartControlPlane();
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { ...sanitizeForRenderer(result), effective: reload.effective };
    });
  });

  ipcMain.handle("legal:open", async (event, address) => {
    assertTrustedSender(event);
    if (typeof address !== "string") throw new Error("页面地址无效");
    const parsed = new URL(address);
    const host = parsed.hostname.toLowerCase();
    const isHuaweiHost = host === "huawei.com" || host.endsWith(".huawei.com") ||
      host === "dbankcloud.cn" || host.endsWith(".dbankcloud.cn") ||
      host === "devecostudio.huawei.com" || host.endsWith(".devecostudio.huawei.com");
    if (parsed.protocol !== "https:" || !isHuaweiHost) throw new Error("只允许打开 Huawei 官方 HTTPS 页面");
    return shell.openExternal(parsed.toString());
  });

  ipcMain.handle("legal:open-realname", async (event) => {
    assertTrustedSender(event);
    return openOfficialPage("realname");
  });

  ipcMain.handle("settings:get-config", async (event, scope = "global") => {
    assertTrustedSender(event);
    if (scope !== "global" && scope !== "project") throw new Error("配置作用域无效");
    await ensureControlPlane();
    if (scope === "project" && !selectedWorkspace) throw new Error("先选择工程，才能读取项目配置");
    return requireControl().getConfig(scope, selectedWorkspace);
  });

  ipcMain.handle("settings:update-config", async (event, scope, patch) => {
    assertTrustedSender(event);
    return withManagementMutation("保存配置", async () => {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再保存配置");
      if (scope !== "global" && scope !== "project") throw new Error("配置作用域无效");
      if (scope === "project" && !selectedWorkspace) throw new Error("先选择工程，才能保存项目配置");
      await ensureControlPlane();
      if (typeof patch?.model === "string" && patch.model) await assertDesktopModel(patch.model);
      const config = await requireControl().updateConfig(scope, selectedWorkspace, patch);
      if (typeof patch?.model === "string" && patch.model) {
        if (scope === "project") persistedState.projectDefaultModels[path.resolve(selectedWorkspace).toLowerCase()] = patch.model;
        else persistedState.desktopDefaultModel = patch.model;
        await saveSettings();
      }
      const reload = await reloadAgentSessionAfterSettingsChange();
      return { config, effective: reload.effective };
    });
  });

  ipcMain.handle("settings:select-path", async (event, kind) => {
    assertTrustedSender(event);
    if (!["studio", "sdk", "agent", "node"].includes(kind)) throw new Error("路径类型无效");
    const requiresRuntimeRestart = ["studio", "sdk", "agent", "node"].includes(kind);
    if (requiresRuntimeRestart) assertOAuthIdle("重启 DevEco 后台");
    if (requiresRuntimeRestart && acpClient?.activePrompt) {
      throw new Error("当前任务仍在运行，请先停止后再更改工具路径");
    }
    const selectFile = kind === "agent" || kind === "node";
    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === "studio" ? "选择 DevEco Studio 安装目录"
        : kind === "sdk" ? "选择 HarmonyOS SDK 目录"
        : kind === "agent" ? "选择 deveco.exe"
        : "选择 node.exe",
      properties: selectFile ? ["openFile"] : ["openDirectory"],
      ...(selectFile ? { filters: [{ name: "Windows executable", extensions: ["exe"] }] } : {}),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const target = path.resolve(result.filePaths[0]);
    if (kind === "agent" && path.basename(target).toLowerCase() !== "deveco.exe") {
      throw new Error("Agent 路径必须指向 deveco.exe");
    }
    if (kind === "node" && path.basename(target).toLowerCase() !== "node.exe") {
      throw new Error("Node 路径必须指向 node.exe");
    }
    return withManagementMutation("更改工具路径", async () => {
      if (requiresRuntimeRestart && acpClient?.activePrompt) {
        throw new Error("当前任务仍在运行，请先停止后再更改工具路径");
      }
      if (kind === "studio") persistedState.studioPath = target;
      else if (kind === "sdk") persistedState.sdkPath = target;
      else if (kind === "agent") persistedState.agentPath = target;
      else persistedState.nodePath = target;
      await saveSettings();
      if (requiresRuntimeRestart) {
        await restartControlPlane().catch(() => {});
        if (selectedWorkspace) await startAgentSession(selectedWorkspace, { resume: true }).catch(() => {});
      }
      const environment = await requireControl().getEnvironment(persistedState);
      persistedState.environmentSnapshot = environment;
      await saveSettings();
      emitEvent({ type: "environment:updated", environment });
      return environment;
    });
  });

  ipcMain.handle("settings:complete-onboarding", async (event) => {
    assertTrustedSender(event);
    return withManagementMutation("完成首次设置", async () => {
      await ensureControlPlane();
      const readiness = await requireControl().getSetupReadiness(selectedWorkspace, persistedState);
      if (!readiness.ready) return { completed: false, readiness };
      persistedState.onboardingComplete = true;
      await saveSettings();
      return { completed: true, readiness };
    });
  });

  ipcMain.handle("setup:readiness", async (event) => {
    assertTrustedSender(event);
    await ensureControlPlane();
    return requireControl().getSetupReadiness(selectedWorkspace, persistedState);
  });

  ipcMain.handle("environment:get", async (event) => {
    assertTrustedSender(event);
    const detectedExecutable = resolveAgentExecutable();
    if (controlPlane && controlPlane.executablePath !== detectedExecutable) {
      if (acpClient?.activePrompt) throw new Error("当前任务仍在运行，请先停止后再重新检测 CLI");
      await restartControlPlane().catch(() => {});
    } else {
      await ensureControlPlane().catch(() => {});
    }
    if (!controlPlane) return null;
    const environment = await controlPlane.getEnvironment(persistedState);
    persistedState.environmentSnapshot = environment;
    await saveSettings();
    return environment;
  });

  ipcMain.handle("environment:check-signature", async (event) => {
    assertTrustedSender(event);
    await ensureControlPlane();
    return requireControl().runDeveloperPreflight(selectedWorkspace, persistedState);
  });

  ipcMain.handle("diagnostics:get", async (event) => {
    assertTrustedSender(event);
    return {
      agent: acpClient?.getDiagnostics?.() ?? [],
      control: controlPlane?.snapshot().diagnostics ?? [],
      status: agentStatus,
      controlStatus,
      runtimePid: acpClient && !acpClient.closed ? acpClient.process?.pid ?? null : null,
    };
  });

  ipcMain.handle("diagnostics:retry-agent", async (event) => {
    assertTrustedSender(event);
    return withManagementMutation("重新连接工作区", () => startAgentSession(selectedWorkspace, { resume: true }));
  });

  ensureControlPlane().catch(() => {});
  await createWindow();
  if (selectedWorkspace) {
    startAgentSession(selectedWorkspace, { resume: true }).catch((error) => {
      setAgentStatus("error", classifyError(error.message || "DevEco Agent 启动失败").message);
    });
  }
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("before-quit", (event) => {
  if (canQuit) return;
  event.preventDefault();
  stopAllProcesses().then(() => settingsWriteQueue.catch(() => {})).finally(() => {
    canQuit = true;
    app.quit();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
