class SessionLibrary {
  constructor(getControl) {
    this.getControl = getControl;
    this.messageCache = new Map();
    this.pendingReads = new Map();
  }

  route(sessionId, directory) {
    if (typeof sessionId !== "string" || !/^ses_[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw new Error("会话 ID 无效");
    return "/session/" + encodeURIComponent(sessionId) + "?directory=" + encodeURIComponent(directory);
  }

  async get(sessionId, directory) {
    const session = await this.getControl().request(this.route(sessionId, directory));
    const normalized = (value) => String(value ?? "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
    if (session?.id !== sessionId || session.parentID || normalized(session.directory) !== normalized(directory)) {
      throw new Error("所选会话不属于此项目");
    }
    return session;
  }

  async hasUserMessage(session, { refresh = false } = {}) {
    const key = session.directory.toLowerCase() + "\n" + session.id;
    const version = Number(session.time?.updated ?? 0);
    const cached = this.messageCache.get(key);
    if (!refresh && cached && cached.version === version && cached.expiresAt > Date.now()) return cached.value;
    if (this.pendingReads.has(key)) return this.pendingReads.get(key);
    const read = this.readUserMessage(session).then((value) => {
      this.messageCache.delete(key);
      this.messageCache.set(key, { value, version, expiresAt: Date.now() + (value ? 60_000 : 1500) });
      if (this.messageCache.size > 2000) this.messageCache.delete(this.messageCache.keys().next().value);
      return value;
    }).finally(() => this.pendingReads.delete(key));
    this.pendingReads.set(key, read);
    return read;
  }

  async readUserMessage(session) {
    let cursor = null;
    const seen = new Set();
    const checkedParents = new Set();
    do {
      const route = "/session/" + encodeURIComponent(session.id) + "/message?directory=" + encodeURIComponent(session.directory) +
        "&limit=8" + (cursor ? "&before=" + encodeURIComponent(cursor) : "");
      const page = await this.getControl().request(route, { withCursor: true });
      if (!Array.isArray(page.data)) throw new Error("Agent 返回的消息列表无效");
      if (page.data.some((message) => message?.info?.role === "user")) return true;
      const parentId = page.data.findLast((message) => message?.info?.role === "assistant" && message.info.parentID)?.info.parentID;
      if (parentId && !checkedParents.has(parentId)) {
        checkedParents.add(parentId);
        const parent = await this.getControl().request("/session/" + encodeURIComponent(session.id) + "/message/" +
          encodeURIComponent(parentId) + "?directory=" + encodeURIComponent(session.directory)).catch(() => null);
        if (parent?.info?.role === "user") return true;
      }
      cursor = page.nextCursor;
      if (!page.data.length || !cursor || seen.has(cursor)) return false;
      seen.add(cursor);
    } while (cursor);
    return false;
  }

  forget(sessionId) {
    for (const key of this.messageCache.keys()) {
      if (key.endsWith("\n" + sessionId)) this.messageCache.delete(key);
    }
  }

  async list(directory, { archived = false, limit = 50 } = {}) {
    const sessions = [];
    const seen = new Set();
    let cursor = null;
    let readFailures = 0;
    do {
      // Including archived records also keeps native records restored with timestamp 0 visible.
      const route = "/experimental/session?directory=" + encodeURIComponent(directory) + "&roots=true&archived=true&limit=100" +
        (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const page = await this.getControl().request(route, { withCursor: true });
      if (!Array.isArray(page.data)) throw new Error("Agent 返回的会话列表无效");
      const candidates = page.data.filter((session) => !session.parentID &&
        Boolean(session.time?.archived) === archived &&
        session.directory?.replace(/\\/g, "/").toLowerCase() === directory.replace(/\\/g, "/").toLowerCase());
      for (let index = 0; index < candidates.length && sessions.length < limit; index += 6) {
        const group = candidates.slice(index, index + 6);
        const results = await Promise.allSettled(group.map((session) => this.hasUserMessage(session)));
        for (let offset = 0; offset < group.length && sessions.length < limit; offset += 1) {
          if (results[offset].status === "rejected") { readFailures += 1; continue; }
          if (!results[offset].value) continue;
          const session = group[offset];
          sessions.push({
            id: session.id,
            directory: session.directory,
            title: typeof session.title === "string" ? session.title : "新会话",
            updatedAt: Number(session.time?.updated ?? session.time?.created ?? 0),
            archived: Boolean(session.time?.archived),
            archivedAt: Number(session.time?.archived ?? 0),
            hasUserMessage: true,
          });
        }
      }
      cursor = page.nextCursor;
      if (sessions.length >= limit || !page.data.length || !cursor || seen.has(cursor)) break;
      seen.add(cursor);
    } while (cursor);
    return { sessions, readFailures };
  }

  async setArchived(sessionId, directory, archived) {
    await this.get(sessionId, directory);
    const session = await this.getControl().request(this.route(sessionId, directory), {
      method: "PATCH", body: { time: { archived: archived ? Date.now() : 0 } },
    });
    if (session?.id !== sessionId || Boolean(session.time?.archived) !== archived) throw new Error("Agent 未确认会话归档状态");
    return session;
  }

  async remove(sessionId, directory) {
    await this.get(sessionId, directory);
    const result = await this.getControl().request(this.route(sessionId, directory), { method: "DELETE" });
    if (result !== true) throw new Error("Agent 未确认会话删除结果");
    this.forget(sessionId);
  }
}

module.exports = { SessionLibrary };
