const { spawn, execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const jsoncParser = require("jsonc-parser");

const AUTH_SOURCE = "deveco-code";
const DEVECO_PROVIDER = "deveco";
const HUAWEI_REALNAME_URL = "https://developer.huawei.com/consumer/cn/personalcenter/myInfo/personalInfo";
const CONFIG_FIELDS = new Set(["model", "small_model", "default_agent", "username", "share", "autoupdate", "logLevel", "snapshot"]);

function redactText(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{16,}/gi, "Basic [redacted]")
    .replace(/\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{12,}\b/gi, "[redacted API key]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted token]")
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret|authorization|jwtToken|tempToken)\s*["']?\s*[:=]\s*["']?)[^,\s"'&}]+/gi, "$1[redacted]")
    .replace(/([?&](?:code|state|token|access_token|refresh_token)=)[^&#\s]+/gi, "$1[redacted]")
    .slice(0, 3000);
}

function sanitizeForRenderer(value, key = "", depth = 0) {
  if (/(?:api.?key|access|refresh|secret|password|authorization|token|credential|jwt|dek|kek|private.?key)/i.test(key)) {
    return undefined;
  }
  if (depth > 16) return undefined;
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((item) => sanitizeForRenderer(item, "", depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 500)) {
    const safe = sanitizeForRenderer(childValue, childKey, depth + 1);
    if (safe !== undefined) result[childKey] = safe;
  }
  return result;
}

function classifyError(value) {
  const message = redactText(value);
  if (/timed?\s*out|timeout/i.test(message)) return { category: "timeout", message };
  if (/401|unauthori[sz]ed|token expired|re-login|sign in/i.test(message)) return { category: "authentication", message };
  if (/real.?name|实名/i.test(message)) return { category: "real-name", message };
  if (/network|fetch failed|econn|enotfound|tls|proxy/i.test(message)) return { category: "network", message };
  if (/provider|api.?key|model/i.test(message)) return { category: "provider", message };
  if (/protocol|json|acp/i.test(message)) return { category: "protocol", message };
  if (/studio|sdk|node|deveco\.exe|toolchain|not found/i.test(message)) return { category: "environment", message };
  return { category: "unknown", message };
}

function readJson(filePath) {
  try {
    return JSON.parse(require("node:fs").readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function firstExistingDirectory(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (require("node:fs").statSync(candidate).isDirectory()) return path.resolve(candidate);
    } catch {}
  }
  return null;
}

function resolveNodeExecutable(preferredPath) {
  const candidates = [];
  if (preferredPath) candidates.push(preferredPath);
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) candidates.push(path.join(directory, "node.exe"));
  }
  try {
    const found = execFileSync("where.exe", ["node.exe"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).split(/\r?\n/).filter(Boolean);
    candidates.push(...found);
  } catch {}
  return candidates.find((candidate) => {
    try { return require("node:fs").statSync(candidate).isFile(); } catch { return false; }
  }) ?? null;
}

function prependExecutableDirectory(environment, executablePath) {
  const result = { ...environment };
  if (!executablePath) return result;
  const key = Object.keys(result).find((name) => name.toLowerCase() === "path") ?? "PATH";
  const directory = path.dirname(path.resolve(executablePath));
  const entries = String(result[key] ?? "").split(path.delimiter)
    .filter((entry) => entry && path.resolve(entry).toLowerCase() !== directory.toLowerCase());
  result[key] = [directory, ...entries].join(path.delimiter);
  return result;
}

function prependExecutableDirectory(environment, executablePath) {
  const result = { ...environment };
  if (!executablePath) return result;
  const key = Object.keys(result).find((name) => name.toLowerCase() === "path") ?? "PATH";
  const directory = path.dirname(path.resolve(executablePath));
  const entries = String(result[key] ?? "").split(path.delimiter)
    .filter((entry) => entry && path.resolve(entry).toLowerCase() !== directory.toLowerCase());
  result[key] = [directory, ...entries].join(path.delimiter);
  return result;
}

function prependExecutableDirectory(environment, executablePath) {
  const result = { ...environment };
  if (!executablePath) return result;
  const key = Object.keys(result).find((name) => name.toLowerCase() === "path") ?? "PATH";
  const directory = path.dirname(path.resolve(executablePath));
  const entries = String(result[key] ?? "").split(path.delimiter)
    .filter((entry) => entry && path.resolve(entry).toLowerCase() !== directory.toLowerCase());
  result[key] = [directory, ...entries].join(path.delimiter);
  return result;
}

function packageVersion(filePath) {
  return filePath ? readJson(filePath)?.version ?? null : null;
}

function findPackageRoot(executablePath, packageName) {
  let current = executablePath ? path.dirname(path.resolve(executablePath)) : null;
  for (let depth = 0; current && depth < 10; depth += 1) {
    const pkg = readJson(path.join(current, "package.json"));
    if (pkg?.name === packageName) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function sanitizeProviderSummary(providerId, provider) {
  const models = provider?.models && typeof provider.models === "object"
    ? Object.entries(provider.models).map(([id, model]) => ({
      id,
      name: typeof model?.name === "string" ? model.name : id,
      contextLimit: Number.isFinite(model?.limit?.context) ? model.limit.context : null,
      outputLimit: Number.isFinite(model?.limit?.output) ? model.limit.output : null,
      supportsTools: model?.tool_call === true,
      variants: model?.variants && typeof model.variants === "object" ? Object.keys(model.variants) : [],
    }))
    : [];
  const options = provider?.options && typeof provider.options === "object" ? provider.options : {};
  return {
    id: providerId,
    name: typeof provider?.name === "string" ? provider.name : providerId,
    npm: typeof provider?.npm === "string" ? provider.npm : "",
    baseURL: typeof options.baseURL === "string" ? options.baseURL : "",
    legacyConfigApiKeyPresent: typeof options.apiKey === "string" && options.apiKey.length > 0,
    models,
  };
}

function sanitizeConfig(config, scope, directory, sources = {}) {
  const fields = {};
  for (const key of CONFIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(config ?? {}, key)) fields[key] = config[key];
  }
  const providers = Object.fromEntries(
    Object.entries(config?.provider ?? {}).map(([id, provider]) => [id, sanitizeProviderSummary(id, provider)]),
  );
  return { scope, directory: scope === "project" ? directory : null, fields, providers, sources };
}

function validateConfigPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("配置内容无效");
  const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!CONFIG_FIELDS.has(key)) throw new Error("该配置项不允许从桌面端修改");
    if (key === "autoupdate" && value !== true && value !== false && value !== "notify") throw new Error("自动更新设置无效");
    if (key === "share" && !["manual", "auto", "disabled"].includes(value)) throw new Error("分享设置无效");
    if (key === "snapshot" && typeof value !== "boolean") throw new Error("快照设置必须为开关");
    if (["model", "small_model", "default_agent", "username", "logLevel"].includes(key) &&
        (typeof value !== "string" || value.length > 200 || value.includes("\0"))) {
      throw new Error("文本配置项无效或过长");
    }
    result[key] = value;
  }
  if (Object.keys(result).length === 0) throw new Error("没有可保存的配置项");
  return result;
}

function findProjectConfigFile(directory) {
  const fsSync = require("node:fs");
  const start = path.resolve(directory);
  const candidates = [
    path.join(start, ".deveco", "deveco.jsonc"),
    path.join(start, ".deveco", "deveco.json"),
    path.join(start, "deveco.jsonc"),
    path.join(start, "deveco.json"),
  ];
  return candidates.find((candidate) => {
    try { return fsSync.statSync(candidate).isFile(); } catch { return false; }
  }) ?? path.join(start, "deveco.jsonc");
}

function parseProjectConfig(text, filePath) {
  const errors = [];
  const value = jsoncParser.parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("项目 DevEco 配置不是有效的 JSONC，已停止保存");
  }
  return value;
}

function applyConfigPatch(text, patch, location = []) {
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    let result = text;
    for (const [key, value] of Object.entries(patch)) {
      result = applyConfigPatch(result, value, [...location, key]);
    }
    return result;
  }
  const edits = jsoncParser.modify(text, location, patch, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  return jsoncParser.applyEdits(text, edits);
}

function removeConfigValue(text, location) {
  const edits = jsoncParser.modify(text, location, undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  return jsoncParser.applyEdits(text, edits);
}

function validateProviderInput(input) {
  const id = String(input?.id ?? "").trim();
  const name = String(input?.name ?? "").trim();
  const baseURL = String(input?.baseURL ?? "").trim();
  const modelId = String(input?.modelId ?? "").trim();
  const modelName = String(input?.modelName ?? "").trim();
  const contextLimit = Number(input?.contextLimit);
  const outputLimit = Number(input?.outputLimit);
  const supportsTools = input?.supportsTools === true || input?.supportsTools === "true"
    ? true
    : input?.supportsTools === false || input?.supportsTools === "false" ? false : null;
  const apiKey = typeof input?.apiKey === "string" ? input.apiKey : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id) || id === DEVECO_PROVIDER) {
    throw new Error("Provider ID 需为 1–64 位字母、数字、点、横线或下划线，且不能占用内置 ID");
  }
  if (!name || name.length > 80) throw new Error("请填写 1–80 个字符的 Provider 名称");
  let endpoint;
  try { endpoint = new URL(baseURL); } catch { throw new Error("API 端点必须是有效的 http 或 https URL"); }
  if (!["https:", "http:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("API 端点必须使用 http/https，且不能在 URL 中嵌入账号或密钥");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(modelId)) throw new Error("模型 ID 格式无效");
  if (!modelName || modelName.length > 120) throw new Error("请填写模型显示名称");
  if (!Number.isSafeInteger(contextLimit) || contextLimit < 1 || contextLimit > 10_000_000) throw new Error("请填写有效的上下文长度");
  if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 1_000_000) throw new Error("请填写有效的最大输出长度");
  if (apiKey.length > 4096) throw new Error("API Key 过长");
  return { id, name, baseURL, modelId, modelName, contextLimit, outputLimit, supportsTools, apiKey };
}

function parseTeamRows(output) {
  const text = String(output ?? "");
  if (/no teams found/i.test(text)) return [];
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^id\s{2,}name$/i.test(line) && !/^-{2,}(?:\s+-{2,})?$/.test(line))
    .map((line) => {
      const match = line.match(/^(.+?)\s{2,}(.+)$/);
      return match ? { id: match[1].trim(), name: match[2].trim() } : null;
    })
    .filter(Boolean)
    .slice(0, 100);
}

function evaluateSetupReadiness(input) {
  const issues = [];
  const productAgreementAccepted = input.agreement?.accepted === true;
  if (!productAgreementAccepted) {
    issues.push({ code: "agreement", message: "请阅读并主动同意当前版本的 DevEco Code 产品协议" });
  }
  const items = new Map((input.environment?.items ?? []).map((item) => [item.id, item]));
  for (const id of ["node", "agent", "cli"]) {
    const item = items.get(id);
    if (!item?.available) issues.push({ code: "environment", message: `需要配置可用的 ${item?.label ?? id}` });
    else if (id === "node" && item.compatibility !== "compatible") {
      issues.push({ code: "environment", message: "Node.js 版本需要为 22 或更新版本" });
    }
  }
  if (!input.workspace) issues.push({ code: "workspace", message: "请选择一个 HarmonyOS 工程目录" });

  const providerData = input.providers ?? { all: [], connected: [] };
  const authIds = new Set((input.auth ?? []).map((item) => item.providerID));
  const connected = new Set(providerData.connected ?? []);
  const account = input.account ?? {};
  const identity = input.identity ?? {};
  const agreement = input.agreement ?? {};
  const effective = [];
  const catalogModels = [];
  for (const provider of providerData.all ?? []) {
    const models = Array.isArray(provider?.models)
      ? provider.models
      : provider?.models && typeof provider.models === "object"
        ? Object.entries(provider.models).map(([id, model]) => ({ id, ...model }))
        : [];
    if (!provider?.id || !models.length) continue;
    const normalized = { ...provider, models };
    for (const model of models) {
      catalogModels.push({
        value: provider.id + "/" + model.id,
        label: String(provider.name ?? provider.id) + " / " + String(model.name ?? model.id),
        providerID: provider.id,
        modelID: model.id,
      });
    }
    if (provider.id === DEVECO_PROVIDER) {
      const signedIn = account.loggedIn === true && identity.status === "valid";
      const realName = account.realName === "recorded-verified";
      const serviceAgreementReviewed = agreement.upload?.state !== "review_required";
      if (signedIn && realName && productAgreementAccepted && serviceAgreementReviewed) effective.push(normalized);
      continue;
    }
    if (connected.has(provider.id) || authIds.has(provider.id)) effective.push(normalized);
  }

  const defaultModel = typeof input.config?.model === "string" ? input.config.model : "";
  const separator = defaultModel.indexOf("/");
  const providerID = separator > 0 ? defaultModel.slice(0, separator) : "";
  const modelID = separator > 0 ? defaultModel.slice(separator + 1) : "";
  const modelAvailable = effective.some((provider) => provider.id === providerID &&
    (provider.models ?? []).some((model) => model.id === modelID));
  if (!modelAvailable) {
    const configuredProvider = (providerData.all ?? []).find((provider) => provider.id === providerID);
    if (providerID === DEVECO_PROVIDER && configuredProvider) {
      if (!account.loggedIn || identity.status !== "valid") issues.push({ code: "account", message: "内置 DevEco 模型需要重新验证 Huawei 登录状态" });
      else if (account.realName !== "recorded-verified") issues.push({ code: "account", message: "内置 DevEco 模型需要完成实名并通过新的授权回调复核" });
      else if (!productAgreementAccepted || agreement.upload?.state === "review_required") issues.push({ code: "agreement", message: "请阅读并主动同意当前版本的 Huawei 服务协议" });
      else issues.push({ code: "config", message: "请选择当前可用的 DevEco 默认模型" });
    } else if (!effective.length) {
      issues.push({ code: "provider", message: "请添加 Provider 并配置可用模型与凭据" });
    } else {
      issues.push({ code: "config", message: "请在配置中心选择已连接 Provider 中的可用默认模型" });
    }
  }
  const priority = ["environment", "agreement", "provider", "account", "config", "workspace"];
  const nextAction = priority.find((code) => issues.some((issue) => issue.code === code)) ?? null;
  return {
    ready: issues.length === 0,
    issues,
    nextAction,
    defaultModel: defaultModel || null,
    modelOptions: catalogModels.slice(0, 1000),
    configuredProviderIDs: [...connected],
    environmentCompatible: !issues.some((issue) => issue.code === "environment"),
    workspaceSelected: Boolean(input.workspace),
    modelSource: modelAvailable ? "core-provider-catalog-and-configured-credential" : "unavailable",
    remoteModelRequestSent: false,
  };
}

function isCustomOpenAIProviderAllowed(providerID, existingConfig, catalogProviderIDs) {
  if (existingConfig) return existingConfig.npm === "@ai-sdk/openai-compatible";
  return !catalogProviderIDs.has(providerID);
}

function accountSessionState(metadata, identity) {
  if (identity?.status === "expired") return "expired";
  if (identity?.loggedIn === true && metadata?.loggedIn === true) return "valid";
  if (identity?.loggedIn === true) return "inconsistent";
  if (metadata?.loggedIn === true) return "cached-unverified";
  if (identity?.error || identity?.status === "unknown") return "unknown";
  return "signed-out";
}

function removeDisabledProvider(disabledProviders, providerID) {
  return Array.isArray(disabledProviders)
    ? disabledProviders.filter((id) => id !== providerID)
    : null;
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout: redactText(stdout), stderr: redactText(stderr) });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, timedOut: true, error: "命令超过等待时间" });
    }, options.timeoutMs ?? 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { if (stdout.length < 100_000) stdout += chunk; });
    child.stderr.on("data", (chunk) => { if (stderr.length < 100_000) stderr += chunk; });
    child.on("error", (error) => finish({ code: null, error: error.message }));
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

class ControlPlane extends EventEmitter {
  constructor(executablePath, options = {}) {
    super();
    this.executablePath = executablePath;
    this.cwd = options.cwd ?? process.cwd();
    this.environment = options.environment ?? process.env;
    this.pureMode = options.pureMode === true;
    this.launcher = options.launcher ?? null;
    this.stopChild = null;
    this.child = null;
    this.port = null;
    this.baseUrl = null;
    this.authorization = null;
    this.startPromise = null;
    this.ready = false;
    this.log = [];
  }

  snapshot() {
    return {
      running: Boolean(this.ready && this.child && this.baseUrl),
      runtimePid: this.child?.pid ?? null,
      url: this.baseUrl,
      diagnostics: this.log.slice(-80),
    };
  }

  capture(stream, source) {
    if (!stream) return;
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const clean = redactText(line);
        if (!clean) continue;
        this.log.push({ time: new Date().toISOString(), source, message: clean });
        if (this.log.length > 160) this.log.shift();
        this.emit("diagnostic", this.log.at(-1));
      }
    });
  }

  async start() {
    if (this.startPromise) return this.startPromise;
    if (this.ready && this.child && this.baseUrl) return this.snapshot();
    this.startPromise = this.startInternal();
    try { return await this.startPromise; }
    finally { this.startPromise = null; }
  }

  async startInternal() {
    if (!this.executablePath) throw new Error("找不到 DevEco Code 可执行文件");
    this.ready = false;
    this.port = await findFreePort();
    const password = crypto.randomBytes(32).toString("base64url");
    this.baseUrl = "http://127.0.0.1:" + this.port;
    this.authorization = "Basic " + Buffer.from("deveco:" + password).toString("base64");
    const env = {
      ...this.environment,
      DEVECO_SERVER_PASSWORD: password,
      DEVECO_SERVER_USERNAME: "deveco",
    };
    const launched = this.launcher ? this.launcher({ executablePath: this.executablePath, cwd: this.cwd, env, hostname: "127.0.0.1", port: this.port }) : null;
    this.child = launched ? launched.child : spawn(this.executablePath, [
      "serve", ...(this.pureMode ? ["--pure"] : []), "--hostname", "127.0.0.1", "--port", String(this.port), "--log-level", "ERROR",
    ], {
      cwd: this.cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.stopChild = launched?.stop ?? null;
    let transportError = null;
    const transportReady = Promise.resolve(launched?.ready).catch((error) => { transportError = error; });
    const child = this.child;
    if (!child) throw new Error("Agent 运行时未能创建");
    if (!launched) this.capture(child.stdout, "serve-stdout");
    if (!launched) this.capture(child.stderr, "serve-stderr");
    child.once("error", (error) => {
      if (this.child === child) {
        this.log.push({ time: new Date().toISOString(), source: "serve", message: classifyError(error.message).message });
        this.emit("diagnostic", this.log.at(-1));
      }
    });
    child.once("close", (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = false;
      this.baseUrl = null;
      this.authorization = null;
      this.emit("exit", { code, signal });
    });

    const deadline = Date.now() + 25_000;
    let lastError = null;
    while (Date.now() < deadline) {
      if (transportError) { await this.stop(); throw transportError; }
      if (child.exitCode !== null) throw new Error("DevEco Code 管理服务启动失败");
      try {
        const health = await this.request("/global/health", { timeoutMs: 1500 });
        if (health?.healthy === true) {
          await transportReady;
          if (transportError) throw transportError;
          this.ready = true;
          this.emit("ready", this.snapshot());
          return this.snapshot();
        }
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    await this.stop();
    throw new Error("DevEco Code 管理服务启动超时" + (lastError ? "：" + classifyError(lastError.message).message : ""));
  }

  async request(route, options = {}) {
    if (!this.baseUrl) throw new Error("DevEco Code 管理服务未运行");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
    try {
      const response = await fetch(this.baseUrl + route, {
        method: options.method ?? "GET",
        headers: {
          Authorization: this.authorization,
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        const detail = typeof data?.message === "string" ? data.message
          : typeof data?.error === "string" ? data.error
          : "HTTP " + response.status;
        throw new Error(classifyError(detail).message);
      }
      return options.withCursor ? { data, nextCursor: response.headers.get("x-next-cursor") } : data;
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("DevEco Code 管理请求超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  directoryQuery(directory) {
    return directory ? "?directory=" + encodeURIComponent(directory) : "";
  }

  async patchProjectConfig(directory, patch) {
    if (!directory) throw new Error("先选择工程，才能保存项目配置");
    const filePath = findProjectConfigFile(directory);
    let before = "{}\n";
    try { before = await fs.readFile(filePath, "utf8"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    parseProjectConfig(before, filePath);
    const updated = applyConfigPatch(before, patch);
    parseProjectConfig(updated, filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = filePath + ".desktop-" + crypto.randomBytes(8).toString("hex") + ".tmp";
    await fs.writeFile(tempPath, updated, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw new Error("无法原子更新项目 DevEco 配置: " + redactText(error.message));
    }
    await this.request("/global/dispose", { method: "POST" });
    const effective = await this.request("/config" + this.directoryQuery(directory));
    for (const [key, value] of Object.entries(patch)) {
      if (key === "provider" || key === "disabled_providers") continue;
      if (JSON.stringify(effective?.[key]) !== JSON.stringify(value)) {
        throw new Error("项目配置已写入可识别文件，但 DevEco Code 读回值不一致；请检查更高优先级的项目配置");
      }
    }
    return this.getConfig("project", directory);
  }

  async writeConfigAtomically(filePath, contents) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = filePath + ".desktop-" + crypto.randomBytes(8).toString("hex") + ".tmp";
    await fs.writeFile(tempPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw new Error("无法原子更新 DevEco 配置: " + redactText(error.message));
    }
  }

  async removeGlobalProviderConfigApiKey(providerID) {
    const paths = await this.request("/path");
    const configDirectory = typeof paths?.config === "string" ? paths.config : "";
    if (!configDirectory || !path.isAbsolute(configDirectory)) {
      throw new Error("核心未返回有效的全局配置目录，无法安全迁移旧 API Key");
    }
    let removed = false;
    for (const filename of ["config.json", "deveco.json", "deveco.jsonc"]) {
      const filePath = path.join(configDirectory, filename);
      let before;
      try { before = await fs.readFile(filePath, "utf8"); }
      catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      const parsed = parseProjectConfig(before, filePath);
      const configuredKey = parsed?.provider?.[providerID]?.options?.apiKey;
      if (typeof configuredKey !== "string" || !configuredKey.length) continue;
      const updated = removeConfigValue(before, ["provider", providerID, "options", "apiKey"]);
      parseProjectConfig(updated, filePath);
      await this.writeConfigAtomically(filePath, updated);
      removed = true;
    }
    await this.request("/global/dispose", { method: "POST" });
    const effective = await this.request("/global/config");
    if (typeof effective?.provider?.[providerID]?.options?.apiKey === "string" &&
        effective.provider[providerID].options.apiKey.length) {
      throw new Error("新 API Key 已保存到核心凭据库，但较高优先级的旧配置密钥仍生效；请检查全局配置文件后重试");
    }
    return { removed };
  }

  async getAccountMetadata() {
    const list = await this.getAuthMetadata();
    const entry = Array.isArray(list) ? list.find((item) => item.providerID === DEVECO_PROVIDER) : null;
    return {
      loggedIn: Boolean(entry && entry.type === "oauth"),
      providerID: entry?.providerID ?? DEVECO_PROVIDER,
      credentialType: entry?.type ?? null,
      removable: entry ? entry.removable === true : null,
      realName: typeof entry?.isRealName === "boolean" ? (entry.isRealName ? "recorded-verified" : "recorded-unverified") : "unknown",
      realNameSource: typeof entry?.isRealName === "boolean" ? "cached" : "unavailable",
    };
  }

  async authConfigDirectory() {
    const paths = await this.request("/path");
    const directory = typeof paths?.config === "string" ? paths.config : "";
    if (!directory || !path.isAbsolute(directory)) throw new Error("核心未返回有效的认证配置目录");
    return directory;
  }

  async getAuthMetadata() {
    const list = await this.request("/auth");
    return Array.isArray(list)
      ? list.map((item) => ({
        providerID: String(item?.providerID ?? ""),
        type: String(item?.type ?? ""),
        removable: item?.removable === true,
        ...(typeof item?.isRealName === "boolean" ? { isRealName: item.isRealName } : {}),
      }))
      : [];
  }

  async getAgreement() {
    return this.request("/global/product-agreement");
  }

  async acceptAgreement(version, serviceRevision) {
    if (typeof version !== "string" || !version) throw new Error("协议版本无效");
    const body = { version, accepted: true };
    if (typeof serviceRevision === "string" && serviceRevision) body.serviceRevision = serviceRevision;
    return this.request("/global/product-agreement", { method: "POST", body });
  }

  async getProviderAuthMethods(directory) {
    return this.request("/provider/auth" + this.directoryQuery(directory));
  }

  async getSetupReadiness(directory, settings = {}) {
    const [environment, providers, auth, config, agreement] = await Promise.all([
      settings.environmentSnapshot ? Promise.resolve(settings.environmentSnapshot) : this.getEnvironment(settings),
      this.getProviders(directory),
      this.getAuthMetadata(),
      this.request("/config" + this.directoryQuery(directory)),
      this.getAgreement().catch(() => null),
    ]);
    let account = { loggedIn: false, realName: "unknown" };
    let identity = { loggedIn: false, status: "not-confirmed" };
    if (typeof config?.model === "string" && config.model.startsWith(DEVECO_PROVIDER + "/")) {
      [account, identity] = await Promise.all([this.getAccountMetadata(), this.getCliUserStatus(settings)]);
    }
    return evaluateSetupReadiness({
      workspace: directory,
      environment,
      providers,
      auth,
      config,
      account,
      identity,
      agreement,
    });
  }

  async getProviders(directory) {
    return this.request("/provider" + this.directoryQuery(directory));
  }

  async refreshProviders(directory) {
    return this.request("/provider/refresh" + this.directoryQuery(directory), { method: "POST" });
  }

  async authorizeProvider(providerID, method, inputs, directory) {
    if (typeof providerID !== "string" || !providerID || !Number.isInteger(method) || method < 0) {
      throw new Error("OAuth 方法无效");
    }
    return this.request("/provider/" + encodeURIComponent(providerID) + "/oauth/authorize" + this.directoryQuery(directory), {
      method: "POST",
      body: { method, ...(inputs && Object.keys(inputs).length ? { inputs } : {}) },
      timeoutMs: 30_000,
    });
  }

  async completeProviderOAuth(providerID, method, code, directory) {
    return this.request("/provider/" + encodeURIComponent(providerID) + "/oauth/callback" + this.directoryQuery(directory), {
      method: "POST",
      body: { method, ...(code ? { code } : {}) },
      timeoutMs: 10 * 60_000,
    });
  }

  async cancelProviderOAuth(providerID, directory) {
    return this.request("/provider/" + encodeURIComponent(providerID) + "/oauth/cancel" + this.directoryQuery(directory), {
      method: "POST",
      timeoutMs: 5000,
    });
  }

  async saveApiCredential(providerID, apiKey) {
    if (typeof providerID !== "string" || !providerID || typeof apiKey !== "string" || !apiKey.trim()) {
      throw new Error("Provider ID 和 API Key 均为必填项");
    }
    return this.request("/auth/" + encodeURIComponent(providerID), {
      method: "PUT",
      body: { type: "api", key: apiKey },
    });
  }

  async saveProviderApiCredential(providerID, apiKey, scope, directory) {
    if (providerID === DEVECO_PROVIDER) throw new Error("内置 Huawei Provider 必须使用官方 OAuth 登录");
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(String(providerID ?? ""))) throw new Error("Provider ID 无效");
    if (scope !== "global" && scope !== "project") throw new Error("Provider 作用域无效");
    if (scope === "project" && !directory) throw new Error("先选择工程，再保存项目 Provider 凭据");
    if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096) throw new Error("API Key 无效或过长");
    const providerDirectory = await this.getProviders(scope === "project" ? directory : undefined);
    if (!(providerDirectory?.all ?? []).some((item) => item?.id === providerID)) {
      throw new Error("核心 Provider 目录中没有此 Provider；请先添加它的定义");
    }
    const configPath = scope === "global" ? "/global/config" : "/config" + this.directoryQuery(directory);
    const effective = await this.request(configPath);
    const legacyKey = effective?.provider?.[providerID]?.options?.apiKey;
    const hasLegacyKey = typeof legacyKey === "string" && legacyKey.length > 0;
    let localProjectKey = false;
    if (scope === "project") {
      const filePath = findProjectConfigFile(directory);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const local = parseProjectConfig(raw, filePath)?.provider?.[providerID]?.options?.apiKey;
        localProjectKey = typeof local === "string" && local.length > 0;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (hasLegacyKey && !localProjectKey) {
        throw new Error("当前项目继承了全局配置中的旧密钥；请切到全局范围重新录入并迁移密钥");
      }
      const global = await this.request("/global/config");
      if (typeof global?.provider?.[providerID]?.options?.apiKey === "string" &&
          global.provider[providerID].options.apiKey.length) {
        throw new Error("全局配置仍含旧密钥；请先在全局范围保存并迁移 API Key，项目作用域不会改写全局设置");
      }
    } else if (directory) {
      const filePath = findProjectConfigFile(directory);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const local = parseProjectConfig(raw, filePath)?.provider?.[providerID]?.options?.apiKey;
        if (typeof local === "string" && local.length) {
          throw new Error("当前工程有自己的旧 API Key；请切到项目作用域替换并迁移密钥，再保存全局凭据");
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await this.saveApiCredential(providerID, apiKey.trim());
    if (scope === "global" && hasLegacyKey) {
      await this.removeGlobalProviderConfigApiKey(providerID);
    } else if (scope === "project" && localProjectKey) {
      await this.patchProjectConfig(directory, {
        provider: { [providerID]: { options: { apiKey: undefined } } },
      });
      const after = await this.request("/config" + this.directoryQuery(directory));
      if (typeof after?.provider?.[providerID]?.options?.apiKey === "string" &&
          after.provider[providerID].options.apiKey.length) {
        throw new Error("新 API Key 已保存，但生效配置仍包含其他来源的旧密钥；请检查全局设置后重试");
      }
    }
    await this.request("/global/dispose", { method: "POST" });
    return { saved: true, legacyConfigKeyMigrated: hasLegacyKey };
  }

  async removeCredential(providerID) {
    return this.request("/auth/" + encodeURIComponent(providerID), { method: "DELETE" });
  }

  async getConfig(scope, directory) {
    if (scope === "project" && !directory) throw new Error("先选择工程，才能读取项目配置");
    const route = scope === "global" ? "/global/config" : "/config" + this.directoryQuery(directory);
    const config = await this.request(route);
    if (scope !== "project") return sanitizeConfig(config, scope, directory);
    const [global, fileText] = await Promise.all([
      this.request("/global/config"),
      fs.readFile(findProjectConfigFile(directory), "utf8").catch((error) => {
        if (error?.code === "ENOENT") return "{}";
        throw error;
      }),
    ]);
    const local = parseProjectConfig(fileText);
    const sources = {};
    for (const key of CONFIG_FIELDS) {
      sources[key] = Object.prototype.hasOwnProperty.call(local, key)
        ? "project"
        : Object.prototype.hasOwnProperty.call(global ?? {}, key)
          ? "global"
          : "inherited-or-default";
    }
    return sanitizeConfig(config, scope, directory, sources);
  }

  async updateConfig(scope, directory, patch) {
    if (scope === "project" && !directory) throw new Error("先选择工程，才能保存项目配置");
    const safePatch = validateConfigPatch(patch);
    if (scope === "project") return this.patchProjectConfig(directory, safePatch);
    const config = await this.request("/global/config", { method: "PATCH", body: safePatch });
    return sanitizeConfig(config, "global", directory);
  }

  async addOrEditProvider(input, scope, directory) {
    if (scope === "project" && !directory) throw new Error("先选择工程，才能配置项目 Provider");
    const item = validateProviderInput(input);
    const rawConfig = await this.request(scope === "global" ? "/global/config" : "/config" + this.directoryQuery(directory));
    const previous = rawConfig?.provider?.[item.id];
    const providerDirectory = await this.getProviders(directory);
    const catalogProviderIDs = new Set((providerDirectory?.all ?? []).map((entry) => entry?.id));
    if (!isCustomOpenAIProviderAllowed(item.id, previous, catalogProviderIDs)) {
      throw new Error("该 Provider 使用原生 SDK；请使用独立凭据入口，不要用 OpenAI 兼容表单覆盖其定义");
    }
    const legacyEffectiveKey = typeof previous?.options?.apiKey === "string" && previous.options.apiKey.length > 0;
    let legacyProjectKey = false;
    let localDisabledProviders = null;
    if (scope === "project") {
      const projectConfigPath = findProjectConfigFile(directory);
      try {
        const raw = await fs.readFile(projectConfigPath, "utf8");
        const projectConfig = parseProjectConfig(raw, projectConfigPath);
        const local = projectConfig?.provider?.[item.id]?.options?.apiKey;
        legacyProjectKey = typeof local === "string" && local.length > 0;
        localDisabledProviders = removeDisabledProvider(projectConfig.disabled_providers, item.id);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (legacyEffectiveKey && !legacyProjectKey) {
        throw new Error("当前项目继承了全局配置中的旧密钥；请切到全局范围重新录入密钥并迁移后，再编辑项目 Provider");
      }
      const globalConfig = await this.request("/global/config");
      if (typeof globalConfig?.provider?.[item.id]?.options?.apiKey === "string" &&
          globalConfig.provider[item.id].options.apiKey.length) {
        throw new Error("全局配置仍含旧密钥；请先在全局范围迁移 API Key，项目作用域不会改写全局设置");
      }
    } else if (directory) {
      const projectConfigPath = findProjectConfigFile(directory);
      try {
        const raw = await fs.readFile(projectConfigPath, "utf8");
        const localKey = parseProjectConfig(raw, projectConfigPath)?.provider?.[item.id]?.options?.apiKey;
        if (typeof localKey === "string" && localKey.length) {
          throw new Error("当前工程有自己的旧 API Key；请先切到项目作用域替换并迁移密钥，再修改全局 Provider");
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    const hasLegacyKey = scope === "global" ? legacyEffectiveKey : legacyProjectKey;
    if (hasLegacyKey && !item.apiKey.trim()) {
      throw new Error("此 Provider 的旧配置包含 API Key；请重新输入一次以迁移到核心加密凭据库，之后桌面端会清除旧配置值");
    }
    const model = {
      name: item.modelName,
      limit: { context: item.contextLimit, output: item.outputLimit },
    };
    if (item.supportsTools !== null) model.tool_call = item.supportsTools;
    const provider = {
      name: item.name,
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: item.baseURL },
      models: { [item.modelId]: model },
    };
    if (hasLegacyKey) provider.options.apiKey = undefined;
    const patch = { provider: { [item.id]: provider } };
    if (scope === "project" && localDisabledProviders) patch.disabled_providers = localDisabledProviders;
    if (scope === "global") {
      await this.request("/global/config", { method: "PATCH", body: patch });
    } else {
      await this.patchProjectConfig(directory, patch);
    }
    if (item.apiKey.trim()) await this.saveApiCredential(item.id, item.apiKey.trim());
    if (scope === "global" && hasLegacyKey) await this.removeGlobalProviderConfigApiKey(item.id);
    if (scope === "project" && hasLegacyKey) {
      await this.request("/global/dispose", { method: "POST" });
      const effective = await this.request("/config" + this.directoryQuery(directory));
      if (typeof effective?.provider?.[item.id]?.options?.apiKey === "string" &&
          effective.provider[item.id].options.apiKey.length) {
        throw new Error("新 API Key 已保存，但项目生效配置仍包含旧密钥；请重新读取配置后处理较高优先级来源");
      }
    }
    const refreshed = await this.refreshProviders(directory);
    if (!(refreshed?.all ?? []).some((entry) => entry?.id === item.id)) {
      throw new Error("Provider 定义已保存，但当前工程仍将其禁用；请检查该工程更高优先级的 Provider 禁用设置");
    }
    return {
      provider: sanitizeProviderSummary(item.id, provider),
      providers: refreshed,
      credentialSaved: Boolean(item.apiKey.trim()),
      effective: "next-session",
    };
  }

  async removeProvider(providerID, scope, directory) {
    if (scope === "global") {
      await this.request("/provider/" + encodeURIComponent(providerID), { method: "DELETE" });
      return { removed: true, scope, effective: "global" };
    }
    if (!directory) throw new Error("先选择工程，才能从项目中移除 Provider");
    const filePath = findProjectConfigFile(directory);
    let projectConfig = {};
    try {
      const raw = await fs.readFile(filePath, "utf8");
      projectConfig = parseProjectConfig(raw, filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const disabled = new Set(Array.isArray(projectConfig.disabled_providers) ? projectConfig.disabled_providers : []);
    disabled.add(providerID);
    await this.patchProjectConfig(directory, { disabled_providers: [...disabled] });
    return { removed: true, scope, effective: "project-disabled" };
  }

  async getEnvironment(settings = {}) {
    const packageRoot = findPackageRoot(this.executablePath, "@deveco/deveco-code");
    const packageJson = packageRoot ? path.join(packageRoot, "package.json") : null;
    const root = path.resolve(__dirname, "..");
    const binary = this.executablePath && require("node:fs").existsSync(this.executablePath) ? this.executablePath : null;
    const studioPath = firstExistingDirectory([
      settings.studioPath,
      process.env.DEVECO_HOME,
      "D:\\IDE\\DevEco Studio",
    ]);
    const sdkPath = firstExistingDirectory([
      settings.sdkPath,
      process.env.DEVECO_SDK_HOME,
      studioPath ? path.join(studioPath, "sdk", "default") : null,
    ]);
    const studioInfo = studioPath
      ? readJson(path.join(studioPath, "product-info.json"))
      : null;
    const sdkInfo = sdkPath ? readJson(path.join(sdkPath, "sdk-pkg.json")) : null;
    const nodePath = resolveNodeExecutable(settings.nodePath ?? this.environment.DEVECO_NODE_PATH);
    const probeEnvironment = this.environment ?? process.env;
    const [nodeResult, agentResult, cliResult] = await Promise.all([
      nodePath ? runProcess(nodePath, ["--version"], { env: probeEnvironment, timeoutMs: 5000 }) : Promise.resolve(null),
      binary ? runProcess(binary, ["--version"], { env: probeEnvironment, timeoutMs: 5000 }) : Promise.resolve(null),
      binary ? runProcess(binary, ["__devecocli-proxy", "--", "--version"], { env: probeEnvironment, timeoutMs: 5000 }) : Promise.resolve(null),
    ]);
    const nodeVersion = nodeResult?.code === 0 ? nodeResult.stdout.trim() : null;
    const cliPackage = packageRoot
      ? path.join(packageRoot, "node_modules", "@deveco", "deveco-cli-common", "package.json")
      : null;
    const cliEntry = packageRoot ? path.join(packageRoot, "node_modules", "@deveco", "deveco-cli", "cli.js") : null;
    const cliShim = path.join(os.homedir(), ".cache", "deveco", "bin", "devecocli.cmd");
    const cliPath = cliEntry && require("node:fs").existsSync(cliEntry)
      ? cliEntry
      : require("node:fs").existsSync(cliShim)
        ? cliShim
        : binary ? binary + " (__devecocli-proxy)" : null;
    const items = [
      { id: "node", label: "Node.js", path: nodePath, version: nodeVersion, required: "DevEco CLI requires Node.js 22+" },
      { id: "agent", label: "DevEco Code Agent", path: binary, version: agentResult?.code === 0 ? agentResult.stdout.trim() : packageVersion(packageJson), required: "0.2.3 or compatible" },
      { id: "cli", label: "devecocli", path: cliPath, version: cliResult?.code === 0 ? cliResult.stdout.trim() : packageVersion(cliPackage), required: "1.3.4 or compatible" },
      { id: "studio", label: "DevEco Studio", path: studioPath, version: studioInfo?.version ?? studioInfo?.versionName ?? studioInfo?.buildNumber ?? null, required: "Studio 6.1.0+ for signing tools" },
      { id: "sdk", label: "HarmonyOS SDK", path: sdkPath, version: sdkInfo?.data?.version ?? sdkInfo?.data?.apiVersion ?? sdkInfo?.version ?? sdkInfo?.apiVersion ?? sdkInfo?.label ?? null, required: "SDK matching the selected project" },
    ];
    for (const item of items) {
      item.available = Boolean(item.path && item.version);
      if (item.id === "node" && item.version) {
        item.compatibility = Number(item.version.replace(/^v/, "").split(".")[0]) >= 22 ? "compatible" : "incompatible";
      } else if (item.id === "studio" && item.version) {
        const match = item.version.match(/(\d+)\.(\d+)/);
        item.compatibility = match
          ? (Number(match[1]) > 6 || (Number(match[1]) === 6 && Number(match[2]) >= 1) ? "compatible" : "incompatible")
          : "detected";
      } else {
        item.compatibility = item.available ? "detected" : "missing";
      }
    }
    return {
      checkedAt: new Date().toISOString(),
      root,
      items,
      configured: {
        studioPath: settings.studioPath ?? null,
        sdkPath: settings.sdkPath ?? null,
        nodePath: settings.nodePath ?? null,
        agentPath: settings.agentPath ?? null,
      },
    };
  }

  async runDeveloperPreflight(workspace, settings = {}) {
    if (!this.executablePath) throw new Error("找不到 DevEco Code / devecocli 运行时");
    const configHome = await this.authConfigDirectory();
    const env = {
      ...this.environment,
      DEVECO_CLI_AUTH_SOURCE: AUTH_SOURCE,
      DEVECO_CODE_AUTH_DIR: configHome,
      DEVECO_CLI_DISABLE_TELEMETRY: "1",
      DEVECO_CLI_SKIP_VERSION_CHECK: "1",
    };
    if (settings.studioPath) {
      env.DEVECO_HOME = settings.studioPath;
      env.DEVECO_CLI_STUDIO_PATH = settings.studioPath;
    }
    const status = await runProcess(this.executablePath, ["__devecocli-proxy", "--", "auth", "status"], {
      cwd: this.cwd,
      env,
      timeoutMs: 25_000,
    });
    const statusOutput = status.stdout + "\n" + status.stderr;
    const accountName = statusOutput.match(/Current user:\s*(.+)/i)?.[1]?.trim().slice(0, 120) ?? null;
    const loggedIn = Boolean(accountName) && status.code === 0 && !/not logged in/i.test(statusOutput);
    const explicitExpiry = /401|token_refresh_failed|token expired|invalid refresh token/i.test(statusOutput);
    const metadata = await this.getAccountMetadata().catch(() => null);
    if (!loggedIn) {
      return {
        account: explicitExpiry ? "expired" : metadata?.loggedIn ? "cached-unverified" : "unknown",
        accountName: null,
        realName: metadata?.realName ?? "unknown",
        realNameSource: metadata?.realNameSource ?? "unavailable",
        teams: "unknown",
        teamList: [],
        signing: "unknown",
        reason: status.timedOut
          ? "开发者账号检查超时，请重试"
          : explicitExpiry ? "核心返回了明确的认证过期信号"
          : metadata?.loggedIn ? "本机有账号记录，但只读 CLI 未确认状态；此结果不能单独证明认证过期"
          : status.code === 0 ? "只读 CLI 未确认登录；实名与团队能力仍为未知" : classifyError(statusOutput).message,
        checkedAt: new Date().toISOString(),
        source: "DevEco CLI read-only auth status and team list",
        generatedSigningMaterials: false,
      };
    }
    const teamResult = await runProcess(this.executablePath, ["__devecocli-proxy", "--", "auth", "team", "list"], {
      cwd: this.cwd,
      env,
      timeoutMs: 25_000,
    });
    const teamOutput = teamResult.stdout + "\n" + teamResult.stderr;
    const teamList = parseTeamRows(teamOutput);
    const teamStatus = teamList.length ? "verified"
      : /no teams found/i.test(teamOutput) ? "unavailable"
      : teamResult.code === 0 ? "unavailable" : "unknown";
    const realName = metadata?.realName ?? "unknown";
    const signing = realName === "recorded-verified" && teamStatus === "verified"
      ? "account-prerequisites-ready"
      : realName === "recorded-unverified" || teamStatus === "unavailable" ? "blocked" : "unknown";
    return {
      account: "verified",
      accountName,
      realName,
      realNameSource: metadata?.realNameSource ?? "unavailable",
      teams: teamStatus,
      teamList,
      signing,
      reason: signing === "account-prerequisites-ready"
        ? "登录态、已记录的实名状态和团队成员资格均已检查；设备与工程签名环境需在实际项目中确认"
        : "登录和团队状态已检查；实名为核心账号缓存状态，完成官方认证后可重新授权复核",
      checkedAt: new Date().toISOString(),
      source: "DevEco CLI read-only auth status and team list",
      generatedSigningMaterials: false,
    };
  }

  async getCliUserStatus(settings = {}) {
    if (!this.executablePath) return { loggedIn: false, userName: null, status: "unknown", error: "未找到 CLI 运行时" };
    const configHome = await this.authConfigDirectory();
    const result = await runProcess(this.executablePath, ["__devecocli-proxy", "--", "auth", "status"], {
      cwd: this.cwd,
      env: {
        ...this.environment,
        DEVECO_CLI_AUTH_SOURCE: AUTH_SOURCE,
        DEVECO_CODE_AUTH_DIR: configHome,
        DEVECO_CLI_DISABLE_TELEMETRY: "1",
        DEVECO_CLI_SKIP_VERSION_CHECK: "1",
        ...(settings.studioPath ? { DEVECO_HOME: settings.studioPath } : {}),
      },
      timeoutMs: 20_000,
    });
    const output = result.stdout + "\n" + result.stderr;
    const match = output.match(/Current user:\s*(.+)/i);
    if (/401|token_refresh_failed|token expired|invalid refresh token/i.test(output)) {
      return { loggedIn: false, userName: null, status: "expired", error: "核心报告了明确的认证过期信号" };
    }
    if (result.timedOut || result.code !== 0) {
      return { loggedIn: false, userName: null, status: "unknown", error: result.timedOut ? "开发者账号检查超时" : classifyError(output).message };
    }
    if (match) return { loggedIn: true, userName: match[1].trim().slice(0, 120), status: "valid" };
    if (/not logged in/i.test(output)) return { loggedIn: false, userName: null, status: "not-confirmed", error: "只读 CLI 状态未确认登录；该结果不能区分退出与网络检查失败" };
    return { loggedIn: false, userName: null, status: "unknown", error: "CLI 未返回可识别的账号状态" };
  }

  async stop() {
    const child = this.child;
    this.ready = false;
    if (!child) {
      this.baseUrl = null;
      this.authorization = null;
      const stopChild = this.stopChild;
      this.stopChild = null;
      if (stopChild) await stopChild();
      return;
    }
    try {
      await this.request("/global/dispose", { method: "POST", timeoutMs: 2500 });
    } catch {}
    this.child = null;
    this.baseUrl = null;
    this.authorization = null;
    const stopChild = this.stopChild;
    this.stopChild = null;
    if (stopChild) {
      await stopChild();
      return;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      child.once("close", () => { clearTimeout(timer); resolve(); });
      try { child.kill(); } catch { clearTimeout(timer); resolve(); }
    });
  }
}

module.exports = {
  ControlPlane,
  redactText,
  classifyError,
  sanitizeForRenderer,
  sanitizeConfig,
  sanitizeProviderSummary,
  validateConfigPatch,
  validateProviderInput,
  findProjectConfigFile,
  parseProjectConfig,
  applyConfigPatch,
  removeConfigValue,
  evaluateSetupReadiness,
  isCustomOpenAIProviderAllowed,
  accountSessionState,
  resolveNodeExecutable,
  prependExecutableDirectory,
  prependExecutableDirectory,
  prependExecutableDirectory,
  removeDisabledProvider,
  HUAWEI_REALNAME_URL,
};
