const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { redactText, classifyError } = require("./control-plane.cjs");

class AcpClient extends EventEmitter {
  constructor(executablePath, cwd, options = {}) {
    super();
    this.executablePath = executablePath;
    this.cwd = cwd;
    this.env = {
      ...(options.env ?? process.env),
      ...(options.pureMode ? { DEVECO_PURE: "1" } : {}),
    };
    this.resumeSessionId = options.resumeSessionId ?? null;
    this.requireResume = options.requireResume === true;
    this.network = options.network ?? null;
    this.initialized = false;
    this.transportPromise = null;
    this.process = null;
    this.sessionId = null;
    this.agentInfo = null;
    this.agentCapabilities = {};
    this.configOptions = [];
    this.nextId = 1;
    this.buffer = "";
    this.pendingRequests = new Map();
    this.pendingPermissions = new Map();
    this.closed = false;
    this.activePrompt = null;
    this.connectionPromise = null;
    this.diagnostics = [];
    this.stderrBuffer = "";
    this.isRestoring = false;
    this.replayBuffer = [];
    this.shutdownPromise = null;
  }

  async connect(options = {}) {
    if (this.closed) throw new Error("DevEco ACP runtime is closed");
    if (this.sessionId && !options.force && !options.newSession && !options.resumeSessionId &&
        (!options.cwd || options.cwd === this.cwd)) return this.snapshot();
    if (this.connectionPromise) return this.connectionPromise;
    this.connectionPromise = this.startConnection(options);
    try {
      return await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  async initialize() {
    if (this.closed) throw new Error("DevEco ACP runtime is closed");
    if (this.initialized) return this.snapshot();
    if (this.transportPromise) return this.transportPromise;
    this.transportPromise = this.startTransport();
    try { return await this.transportPromise; }
    catch (error) { this.failConnection(error); throw error; }
    finally { this.transportPromise = null; }
  }

  async startTransport() {
    if (this.closed) throw new Error("DevEco ACP session is closed");

    this.process = spawn(this.executablePath, [
      "acp",
      "--cwd",
      this.cwd,
      "--log-level",
      "ERROR",
      ...(this.network ? ["--hostname", this.network.hostname, "--port", String(this.network.port)] : []),
    ], {
      cwd: this.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: this.env,
    });

    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.readStdout(chunk));
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => this.captureStderr(chunk));
    this.process.on("error", (error) => this.failConnection(error));
    this.process.on("close", (code, signal) => {
      if (!this.closed) {
        this.failConnection(new Error(`DevEco ACP exited (${signal || code || "unknown"})`));
      }
    });

    const initialized = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: "deveco-agent-desktop",
        title: "DevEco Agent Desktop",
        version: "0.1.0",
      },
    }, 30_000);

    if (initialized?.protocolVersion !== 1) {
      throw new Error(`DevEco ACP returned unsupported protocol version ${initialized?.protocolVersion ?? "unknown"}`);
    }

    this.agentInfo = initialized.agentInfo ?? null;
    this.agentCapabilities = initialized.agentCapabilities ?? {};
    this.initialized = true;
    this.emit("initialized", this.snapshot());
    return this.snapshot();
  }

  async startConnection(options = {}) {
    await this.initialize();
    if (this.activePrompt) throw new Error("请先停止当前任务，再切换会话");
    const previous = { cwd: this.cwd, sessionId: this.sessionId, configOptions: this.configOptions };
    this.cwd = options.cwd ?? this.cwd;
    const resumeSessionId = options.newSession ? null : options.resumeSessionId ?? this.resumeSessionId;
    this.resumeSessionId = null;
    const requireResume = options.requireResume ?? this.requireResume;
    let session;
    let nextSessionId = null;
    this.isRestoring = true;
    this.replayBuffer = [];
    try {
      if (resumeSessionId) {
        if (this.agentCapabilities?.loadSession === true) {
          try {
            session = await this.request("session/load", {
              sessionId: resumeSessionId,
              cwd: this.cwd,
              mcpServers: [],
            }, 90_000);
            nextSessionId = resumeSessionId;
            this.recordDiagnostic("session", "已恢复最近会话");
          } catch (error) {
            this.replayBuffer = [];
            if (requireResume) throw error;
            this.recordDiagnostic("session", "最近会话无法恢复；已准备新会话 (" + classifyError(error.message).category + ")");
          }
        } else {
          if (requireResume) throw new Error("当前 Agent 不支持加载历史会话，无法打开所选会话");
          this.recordDiagnostic("session", "当前 ACP 能力未声明 session/load；已准备新会话");
        }
      }
      if (!nextSessionId) {
        session = await this.request("session/new", {
          cwd: this.cwd,
          mcpServers: [],
        }, 90_000);
        if (!session?.sessionId) throw new Error("DevEco ACP did not return a session ID");
        nextSessionId = session.sessionId;
      }
      this.sessionId = nextSessionId;
      this.configOptions = Array.isArray(session?.configOptions) ? session.configOptions : [];
      this.emit("ready", this.snapshot());
      this.isRestoring = false;
      for (const params of this.replayBuffer.splice(0)) {
        if (!params.sessionId || params.sessionId === this.sessionId) this.emit("session-update", params);
      }
      return this.snapshot();
    } catch (error) {
      this.cwd = previous.cwd;
      this.sessionId = previous.sessionId;
      this.configOptions = previous.configOptions;
      throw error;
    } finally {
      this.isRestoring = false;
      this.replayBuffer = [];
    }
  }

  snapshot() {
    return {
      connected: Boolean(this.process && !this.closed && this.sessionId),
      initialized: this.initialized && !this.closed,
      runtimePid: this.process?.pid ?? null,
      cwd: this.cwd,
      sessionId: this.sessionId,
      agentInfo: this.agentInfo,
      agentCapabilities: this.agentCapabilities,
      configOptions: this.configOptions,
    };
  }

  recordDiagnostic(source, message) {
    const diagnostic = { time: new Date().toISOString(), source, message: redactText(message) };
    this.diagnostics.push(diagnostic);
    if (this.diagnostics.length > 120) this.diagnostics.shift();
    this.emit("diagnostic", diagnostic);
  }

  captureStderr(chunk) {
    this.stderrBuffer += String(chunk);
    if (this.stderrBuffer.length > 64_000) this.stderrBuffer = this.stderrBuffer.slice(-32_000);
    const lines = this.stderrBuffer.split(/\r?\n/);
    this.stderrBuffer = lines.pop() ?? "";
    for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
      this.recordDiagnostic("stderr", line);
    }
  }

  getDiagnostics() {
    return this.diagnostics.slice(-100);
  }

  request(method, params, timeoutMs = 60_000) {
    if (!this.process || this.closed) return Promise.reject(new Error("DevEco ACP is not connected"));
    const id = `client-${this.nextId++}`;
    const message = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`DevEco ACP request timed out: ${method}`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer, method });
      try {
        this.write(message);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    if (!this.process || this.closed) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  async sendPrompt(text) {
    if (!this.sessionId) await this.connect();
    if (this.activePrompt) throw new Error("DevEco is already working on a prompt");
    const prompt = this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    }, 30 * 60_000);
    this.activePrompt = prompt;
    this.emit("prompt-started");
    try {
      return await prompt;
    } finally {
      if (this.activePrompt === prompt) this.activePrompt = null;
      this.emit("prompt-finished");
    }
  }

  async setConfigOption(configId, value, type = "id") {
    if (!this.sessionId) throw new Error("Start a workspace session before changing model settings");
    const params = { sessionId: this.sessionId, configId, value };
    if (type === "boolean") params.type = "boolean";
    const result = await this.request("session/set_config_option", params, 30_000);
    if (Array.isArray(result?.configOptions)) {
      this.configOptions = result.configOptions;
      this.emit("config-options", this.configOptions);
    }
    return { configOptions: this.configOptions };
  }

  async respondToPermission(requestId, optionId) {
    const permission = this.pendingPermissions.get(requestId);
    if (!permission) return false;
    this.pendingPermissions.delete(requestId);
    clearTimeout(permission.timer);
    const outcome = optionId
      ? { outcome: "selected", optionId }
      : { outcome: "cancelled" };
    this.write({ jsonrpc: "2.0", id: requestId, result: { outcome } });
    return true;
  }

  async cancelPrompt() {
    if (!this.sessionId || !this.activePrompt) return false;
    this.notify("session/cancel", { sessionId: this.sessionId });
    for (const [id] of this.pendingPermissions) await this.respondToPermission(id, null);
    return true;
  }

  write(message) {
    if (!this.process || this.process.stdin.destroyed) throw new Error("DevEco ACP input stream is closed");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  readStdout(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.failConnection(new Error("DevEco ACP sent an oversized protocol message"));
      this.process?.kill();
      return;
    }

    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        if (/^\[disposer\]/.test(line)) {
          this.recordDiagnostic("runtime", line);
          continue;
        }
        this.emit("protocol-error", "DevEco ACP returned non-JSON data on its protocol stream");
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message?.method) {
      this.handleAgentMethod(message);
      return;
    }

    const pending = this.pendingRequests.get(message?.id);
    if (!pending) return;
    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(redactText(message.error.message || ("DevEco ACP request failed: " + pending.method))));
      return;
    }
    pending.resolve(message.result ?? {});
  }

  handleAgentMethod(message) {
    if (message.method === "session/update") {
      if (!this.isRestoring && message.params?.sessionId && message.params.sessionId !== this.sessionId) return;
      const update = message.params?.update;
      if (update?.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
        this.configOptions = update.configOptions;
        this.emit("config-options", this.configOptions);
      }
      if (this.isRestoring) this.replayBuffer.push(message.params ?? {});
      else this.emit("session-update", message.params ?? {});
      return;
    }

    if (message.method === "session/request_permission") {
      const requestId = message.id;
      if (requestId === undefined) return;
      if (this.isRestoring || (message.params?.sessionId && message.params.sessionId !== this.sessionId)) {
        this.write({ jsonrpc: "2.0", id: requestId, result: { outcome: { outcome: "cancelled" } } });
        return;
      }
      const timer = setTimeout(() => this.respondToPermission(requestId, null), 10 * 60_000);
      this.pendingPermissions.set(requestId, { timer });
      this.emit("permission-request", { requestId, ...message.params });
      return;
    }

    if (message.id !== undefined) {
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported DevEco ACP client method: ${message.method}` },
      });
    }
  }

  failConnection(error) {
    if (this.closed) return;
    this.closed = true;
    if (this.stderrBuffer.trim()) this.recordDiagnostic("stderr", this.stderrBuffer.trim());
    this.stderrBuffer = "";
    const safeError = new Error(redactText(error?.message ?? error));
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(safeError);
      this.pendingRequests.delete(id);
    }
    for (const [id, permission] of this.pendingPermissions) {
      clearTimeout(permission.timer);
      this.pendingPermissions.delete(id);
      this.emit("permission-cancelled", id);
    }
    this.emit("closed", safeError);
    if (this.process) this.terminateProcessTree(this.process).catch(() => {});
  }

  waitForProcessClose(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onClose = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.removeListener("close", onClose);
        resolve(false);
      }, timeoutMs);
      child.once("close", onClose);
    });
  }

  terminateProcessTree(child) {
    if (!child) return Promise.resolve();
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try { child.stdin?.end(); } catch {}
      if (await this.waitForProcessClose(child, 1200)) return;
      if (process.platform === "win32" && child.pid) {
        await new Promise((resolve) => {
          let killer;
          try {
            killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              windowsHide: true,
              stdio: "ignore",
            });
          } catch {
            resolve();
            return;
          }
          killer.once("error", resolve);
          killer.once("close", resolve);
        });
      } else {
        try { child.kill("SIGTERM"); } catch {}
      }
      if (await this.waitForProcessClose(child, 1500)) return;
      try { child.kill("SIGKILL"); } catch {}
      await this.waitForProcessClose(child, 1000);
    })().finally(() => {
      if (this.shutdownPromise) this.shutdownPromise = null;
    });
    return this.shutdownPromise;
  }

  async stop() {
    if (!this.process) return;
    const child = this.process;
    const wasClosed = this.closed;
    for (const [id, permission] of this.pendingPermissions) {
      clearTimeout(permission.timer);
      if (!wasClosed && !child.stdin?.destroyed) {
        try { this.write({ jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } }); } catch {}
      }
      this.pendingPermissions.delete(id);
    }
    this.closed = true;
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("DevEco ACP session closed"));
      this.pendingRequests.delete(id);
    }
    await this.terminateProcessTree(child);
  }
}

module.exports = { AcpClient };
