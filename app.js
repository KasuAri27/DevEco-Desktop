const appShell = document.querySelector("#appShell");
const sidebar = document.querySelector("#sidebar");
const taskInput = document.querySelector("#taskInput");
const toast = document.querySelector("#toast");
const mobileScrim = document.querySelector("#mobileScrim");
const welcomePanel = document.querySelector("#welcomePanel");
const conversationView = document.querySelector("#conversationView");
const messageList = document.querySelector("#messageList");
const modelList = document.querySelector("#modelList");
const modelEmpty = document.querySelector("#modelEmpty");
const modelSearch = document.querySelector("#modelSearch");
const modelButton = document.querySelector("#modelButton");
const modelPopover = document.querySelector("#modelPopover");
const effortButton = document.querySelector("#effortButton");
const effortPopover = document.querySelector("#effortPopover");
const modeButton = document.querySelector("#modeButton");
const modePopover = document.querySelector("#modePopover");
const modeList = document.querySelector("#modeList");
const sessionActionsPopover = document.querySelector("#sessionActionsPopover");
const effortSliderShell = document.querySelector("#effortSliderShell");
const effortRange = document.querySelector("#effortRange");
const effortSliderFill = document.querySelector("#effortSliderFill");
const effortTicks = document.querySelector("#effortTicks");
const effortValue = document.querySelector("#effortValue");
const effortLevelLabel = document.querySelector("#effortLevelLabel");
const effortProfileLabel = document.querySelector("#effortProfileLabel");
const effortMinLabel = document.querySelector("#effortMinLabel");
const effortMaxLabel = document.querySelector("#effortMaxLabel");
const permissionDialog = document.querySelector("#permissionDialog");
const managementDialog = document.querySelector("#managementDialog");
const managementPanels = [...document.querySelectorAll("[data-panel-content]")];
const managementNav = [...document.querySelectorAll(".management-nav-item")];
const themeHueButtons = [...document.querySelectorAll("[data-theme-hue]")];
const themeModeButtons = [...document.querySelectorAll("[data-theme-mode]")];
const nativeProviderCredentialForm = document.querySelector("#providerCredentialForm");
const modelPolicy = window.devecoModelPolicy;

const desktop = window.devecoDesktop;
const DEFAULT_THEME_PREFERENCE = Object.freeze({ hue: "blue", mode: "auto" });
let themePreference = { ...DEFAULT_THEME_PREFERENCE };
let themeWriteSequence = 0;
let themePersistenceQueue = Promise.resolve();
let desktopModelCatalog = { all: [], allowedProviderIDs: ["deveco"], defaultModel: modelPolicy.DEFAULT_MODEL };
let modelCatalogSequence = 0;
let runtimeMetadataSequence = 0;
let projectSummarySequence = 0;
let toastTimer;
let workspacePath = null;
let currentConfigOptions = [];
let modelConfig = null;
let effortConfig = null;
let modeConfig = null;
let activeEffortOptions = [];
let activeEffortDefaultIndex = 0;
let activeEffortHighestIndex = -1;
let isWorking = false;
let configChoiceBusy = false;
let isSubmitting = false;
let isSidebarSwitching = false;
let currentSessionId = null;
let sidebarProjects = [];
let sidebarSessions = [];
let sidebarRefreshSequence = 0;
let sidebarReadError = null;
let sessionsNewestFirst = true;
let showArchivedSessions = false;
let sessionMenuTarget = null;
let sessionMenuButton = null;
let inputIsComposing = false;
let agentConnected = false;
const sidebarSessionTitles = new Map();
let activeAssistantMessage = null;
let activeAssistantText = null;
let activeUserMessage = null;
let activeUserText = null;
let pendingPermission = null;
const toolActivities = new Map();
let desktopState = null;
let controlStatus = null;
let accountState = null;
let accountRefreshSequence = 0;
let accountRefreshInProgress = false;
let accountLogoutInProgress = false;
let agreementState = null;
let providerState = null;
let configSnapshot = null;
let oauthFlowId = null;
let oauthFlowProvider = null;
let oauthStarting = false;
let providerScope = "global";
let configScope = "global";
let activeOAuthPrompt = null;
let activeCredentialProvider = null;
let providerEditorBusy = false;
let privacyState = null;
let privacyOriginalDecision = "";
let devicePrivacyState = null;
let devicePrivacyOriginal = { analyticsEnabled: true, crashUploadEnabled: true };

function showToast(message, duration = 3200) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, duration);
}

function normalizeThemePreference(value) {
  return {
    hue: value?.hue === "red" ? "red" : "blue",
    mode: ["auto", "light", "dark"].includes(value?.mode) ? value.mode : "auto",
  };
}

function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}

function applyThemePreference(value) {
  themePreference = normalizeThemePreference(value);
  document.body.dataset.hue = themePreference.hue;
  document.body.dataset.mode = themePreference.mode;
  for (const button of themeHueButtons) {
    const selected = button.dataset.themeHue === themePreference.hue;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  for (const button of themeModeButtons) {
    const selected = button.dataset.themeMode === themePreference.mode;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  const dark = themePreference.mode === "dark" || (themePreference.mode === "auto" && systemThemeQuery?.matches);
  document.body.dataset.effectiveMode = dark ? "dark" : "light";
  const hint = document.querySelector("#systemThemeHint");
  hint.hidden = themePreference.mode !== "auto";
  hint.textContent = "当前系统为" + (dark ? "深色" : "浅色");
  syncThemeColorMeta();
}

async function getThemePreference() {
  if (typeof desktop?.getThemePreference === "function") {
    return normalizeThemePreference(await desktop.getThemePreference());
  }
  return { ...themePreference };
}

async function setThemePreference(value) {
  const next = normalizeThemePreference(value);
  const persisted = typeof desktop?.setThemePreference === "function";
  if (persisted) await desktop.setThemePreference(next);
  return { ...next, persisted };
}

async function initializeTheme() {
  const status = document.querySelector("#themePreferenceStatus");
  const sequence = themeWriteSequence;
  try {
    const preference = await getThemePreference();
    if (sequence !== themeWriteSequence) return;
    applyThemePreference(preference);
    status.textContent = "";
  } catch {
    if (sequence !== themeWriteSequence) return;
    applyThemePreference(DEFAULT_THEME_PREFERENCE);
    status.textContent = "";
    showToast("外观设置未能读取，已使用默认设置。");
  }
}

async function updateThemePreference(preference) {
  const next = normalizeThemePreference({ ...themePreference, ...preference });
  const sequence = ++themeWriteSequence;
  const status = document.querySelector("#themePreferenceStatus");
  applyThemePreference(next);
  status.textContent = "";

  const save = themePersistenceQueue.catch(() => {}).then(() => setThemePreference(next));
  themePersistenceQueue = save;
  try {
    const result = await save;
    if (sequence !== themeWriteSequence) return;
    if (!result.persisted) showToast("外观设置未能保存，下次启动可能恢复默认。");
  } catch (error) {
    if (sequence !== themeWriteSequence) return;
    showToast("外观设置未能保存，下次启动可能恢复默认。");
  }
}

const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
systemThemeQuery?.addEventListener("change", () => {
  if (document.body.dataset.mode === "auto") applyThemePreference(themePreference);
});

function bindThemeRadioGroup(buttons, field) {
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => updateThemePreference({ [field]: field === "hue" ? button.dataset.themeHue : button.dataset.themeMode }));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    });
  });
}
bindThemeRadioGroup(themeHueButtons, "hue");
bindThemeRadioGroup(themeModeButtons, "mode");

function createUiIcon(name) {
  const icon = document.createElement("span");
  icon.className = "ui-icon";
  icon.dataset.icon = name;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function createProviderLogo(providerId) {
  const company = modelPolicy.brand(providerId);
  if (!company) return createUiIcon("server");
  const image = document.createElement("img");
  image.className = "provider-logo";
  image.src = company.logo;
  image.alt = company.name;
  return image;
}

async function refreshModelCatalog() {
  if (!desktop?.getModelCatalog) return;
  const sequence = ++modelCatalogSequence;
  try {
    const catalog = await desktop.getModelCatalog();
    if (sequence !== modelCatalogSequence) return;
    if (JSON.stringify(catalog) === JSON.stringify(desktopModelCatalog)) return;
    desktopModelCatalog = catalog;
    applyConfigOptions(currentConfigOptions);
  } catch { /* Keep the last confirmed catalog; the main process also enforces the policy. */ }
}

async function refreshWorkspaceSummary() {
  const name = document.querySelector("#summaryProjectName");
  name.textContent = workspacePath?.split(/[\\/]/).filter(Boolean).at(-1) || "尚未选择工程";
  const type = document.querySelector("#summaryProjectType");
  const api = document.querySelector("#summaryProjectApi");
  type.hidden = true;
  api.hidden = true;
  if (!workspacePath || !desktop?.getWorkspaceSummary) return;
  const directory = workspacePath;
  const sequence = ++projectSummarySequence;
  try {
    const summary = await desktop.getWorkspaceSummary();
    if (sequence !== projectSummarySequence || directory !== workspacePath) return;
    type.textContent = summary.projectType || "";
    type.hidden = !summary.projectType;
    api.textContent = summary.apiLevel ? "API " + summary.apiLevel : "";
    api.hidden = !summary.apiLevel;
  } catch { /* Unknown project metadata stays hidden. */ }
}

function setStatus(status = {}) {
  const label = document.querySelector("#agentStatus");
  const detail = document.querySelector("#connectionStatus");
  const indicator = document.querySelector("#connectionIndicator");
  const caption = document.querySelector("#composerCaption");
  const state = status.state ?? "disconnected";
  agentConnected = state === "connected";
  document.querySelector("#runtimeRetry").hidden = state !== "error";
  document.querySelector("#summaryConnection").textContent = state === "connected" ? "Agent 已连接" : state === "connecting" ? "正在连接 Agent" : "Agent 未连接";
  document.querySelector("#projectSummary").classList.toggle("is-connected", state === "connected");
  document.querySelector("#structureSuggestionState").textContent = state === "connected" ? "工程已连接" : "先连接一个工程";
  label.classList.toggle("is-connected", state === "connected");
  label.classList.toggle("is-error", state === "error");
  document.querySelector("#agentStatusText").textContent = status.message ?? "等待选择工程";
  detail.textContent = status.agentInfo?.version ? "DevEco Code " + status.agentInfo.version : status.message ?? "等待选择工程";
  indicator.classList.toggle("is-connected", state === "connected");
  indicator.classList.toggle("is-error", state === "error");
  if (caption && state !== "connected") caption.textContent = status.message || "选择工程后连接本机 DevEco Agent。";
  syncComposerAvailability();
}

function syncComposerAvailability() {
  const busy = isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy;
  document.querySelector("#sendButton").disabled = busy || Boolean(workspacePath && !agentConnected);
  modeButton.disabled = busy || !agentConnected || !modeConfig?.options?.length;
  modelButton.disabled = busy || !agentConnected || !modelConfig?.options?.length;
  effortButton.disabled = busy || !agentConnected;
  document.querySelector("#newTaskButton").disabled = busy || Boolean(workspacePath && !agentConnected);
  document.querySelector("#toggleArchivedSessions").disabled = busy || !desktop || !workspacePath;
  syncHuaweiAccountActions();
}

function closePopovers(exceptId) {
  document.querySelectorAll(".popover").forEach((popover) => {
    if (popover.id === exceptId) return;
    popover.hidden = true;
    document.querySelectorAll(`[aria-controls="${popover.id}"]`).forEach((button) => button.setAttribute("aria-expanded", "false"));
  });
}

function togglePopover(button, popover) {
  const shouldOpen = popover.hidden;
  closePopovers(shouldOpen ? popover.id : undefined);
  popover.hidden = !shouldOpen;
  button.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) {
    document.querySelector("#overlayRoot").append(popover);
    positionPopover(popover, button);
  }
  if (shouldOpen && popover === effortPopover) renderEffortValue();
}

function positionPopover(popover, button) {
  if (popover.hidden) return;
  const bounds = button.getBoundingClientRect();
  const height = window.visualViewport?.height || window.innerHeight;
  const width = window.visualViewport?.width || window.innerWidth;
  if (bounds.top > height || bounds.bottom < 0) { closePopovers(); return; }
  const gap = 9;
  const margin = 12;
  const above = Math.max(0, bounds.top - gap - margin);
  const below = Math.max(0, height - bounds.bottom - gap - margin);
  const openAbove = above >= Math.min(400, height * .55) || above >= below;
  const available = Math.max(90, openAbove ? above : below);
  popover.style.position = "fixed";
  popover.style.right = "auto";
  popover.style.bottom = "auto";
  popover.style.maxHeight = available + "px";
  popover.style.setProperty("--popover-space", available + "px");
  const measured = popover.getBoundingClientRect();
  popover.style.left = Math.max(margin, Math.min(bounds.right - measured.width, width - measured.width - margin)) + "px";
  popover.style.top = Math.max(margin, openAbove ? bounds.top - gap - measured.height : bounds.bottom + gap) + "px";
}

function repositionPopovers() {
  for (const [popover, button] of [[modelPopover, modelButton], [effortPopover, effortButton], [modePopover, modeButton]]) {
    if (!popover.hidden) positionPopover(popover, button);
  }
  if (!sessionActionsPopover.hidden) {
    if (sessionMenuButton?.isConnected) positionPopover(sessionActionsPopover, sessionMenuButton);
    else closePopovers();
  }
}
window.addEventListener("resize", repositionPopovers);
window.visualViewport?.addEventListener("resize", repositionPopovers);
document.addEventListener("scroll", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest(".popover")) repositionPopovers();
}, { capture: true, passive: true });

function setMobileMenu(open) {
  sidebar.classList.toggle("mobile-open", open);
  mobileScrim.hidden = !open;
}

function setWorking(working) {
  isWorking = working;
  document.querySelector("#sendButton").hidden = working;
  document.querySelector("#cancelButton").hidden = !working;
  document.querySelector("#newTaskButton").disabled = working;
  document.querySelector("#projectChip").disabled = working;
  document.querySelector("#addProject").disabled = working;
  document.querySelector("#composerCaption").textContent = working
    ? "DevEco Agent 正在处理…"
    : "Enter 发送 · Ctrl+Enter 换行";
  renderSidebarRows();
  syncComposerAvailability();
}

function updateWorkspace(path) {
  if (!sameSidebarWorkspace(path, workspacePath)) {
    sidebarSessions = [];
    sidebarReadError = null;
    showArchivedSessions = false;
    currentSessionId = null;
    clearConversation();
    document.querySelector("#breadcrumbTitle").textContent = "新建任务";
  }
  workspacePath = path || null;
  void refreshWorkspaceSummary();
  if (workspacePath) {
    sidebarProjects = [workspacePath, ...sidebarProjects.filter((directory) => !sameSidebarWorkspace(directory, workspacePath))];
  }
  renderSidebarRows();
  const projectModelOption = document.querySelector('#defaultModelScope option[value="project"]');
  if (projectModelOption) projectModelOption.disabled = !workspacePath;
  const projectName = document.querySelector("#projectName");
  const pathLabel = document.querySelector("#workspacePathLabel");
  if (!workspacePath) {
    projectName.textContent = "选择工程";
    pathLabel.textContent = "Agent 在所选工程目录中工作";
    return;
  }
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  projectName.textContent = parts.at(-1) || workspacePath;
  projectName.title = workspacePath;
  pathLabel.textContent = workspacePath;
  pathLabel.title = workspacePath;
}

function sameSidebarWorkspace(left, right) {
  return Boolean(left && right && left.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLocaleLowerCase() ===
    right.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLocaleLowerCase());
}

function sidebarSessionTitle(session) {
  const title = session.title || "新会话";
  return /^New session(?:\s*-|$)/i.test(title) || title === "新会话"
    ? sidebarSessionTitles.get(session.id) || "新会话"
    : title;
}

function makeSidebarButton(label, title, iconId, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-action";
  button.title = title;
  button.disabled = isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy;
  if (active) button.setAttribute("aria-current", "page");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "icon");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + iconId);
  icon.append(use);
  const copy = document.createElement("span");
  copy.className = "sidebar-list-label";
  if (iconId === "i-folder") {
    button.classList.add("project-sidebar-item");
    const name = document.createElement("strong");
    name.textContent = label;
    const path = document.createElement("small");
    path.textContent = title;
    copy.append(name, path);
  } else copy.textContent = label;
  button.append(icon, copy);
  button.addEventListener("click", onClick);
  return button;
}

function renderSidebarRows() {
  if (!sessionActionsPopover.hidden) closePopovers();
  const projectList = document.querySelector("#projectList");
  const sessionList = document.querySelector("#recentSessionList");
  const query = document.querySelector("#searchInput").value.trim().toLocaleLowerCase();
  const projects = sidebarProjects.filter((directory) => directory.toLocaleLowerCase().includes(query));
  const sessions = sidebarSessions.filter((session) => session.hasUserMessage === true && Boolean(session.archived) === showArchivedSessions && sidebarSessionTitle(session).toLocaleLowerCase().includes(query))
    .slice().sort((left, right) => sessionsNewestFirst ? right.updatedAt - left.updatedAt : left.updatedAt - right.updatedAt);
  projectList.replaceChildren(...projects.map((directory) => makeSidebarButton(
    directory.split(/[\\/]/).filter(Boolean).at(-1) || directory,
    directory,
    "i-folder",
    sameSidebarWorkspace(directory, workspacePath),
    () => openSidebarItem(null, directory),
  )));
  sessionList.replaceChildren(...sessions.map(makeSessionRow));
  document.querySelector("#recentHeading").textContent = showArchivedSessions ? "已归档会话" : "最近会话";
  document.querySelector("#archiveToggleLabel").textContent = showArchivedSessions ? "返回最近会话" : "已归档会话";
  document.querySelector("#toggleArchivedSessions").setAttribute("aria-pressed", String(showArchivedSessions));
  document.querySelector("#projectEmptyState").hidden = projects.length > 0;
  const projectEmptyCopy = document.querySelector("#projectEmptyState > span:last-child");
  projectEmptyCopy.textContent = query ? "没有匹配的项目" : "连接工程后，项目会显示在这里";
  const sessionEmpty = document.querySelector("#sessionEmptyState");
  sessionEmpty.hidden = sessions.length > 0;
  sessionEmpty.textContent = sidebarReadError || (query ? "没有匹配的会话" : showArchivedSessions ? "还没有归档的会话" : "发送第一条消息后，会话会出现在这里");
}

function makeSessionRow(session) {
  const row = makeElement("div", "sidebar-session-row");
  row.dataset.sessionId = session.id;
  row.classList.toggle("is-active", session.id === currentSessionId);
  const actions = makeElement("button", "icon-button small session-actions-button");
  actions.type = "button";
  actions.disabled = isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy;
  actions.setAttribute("aria-label", sidebarSessionTitle(session) + "的更多操作");
  actions.setAttribute("aria-haspopup", "menu");
  actions.setAttribute("aria-controls", "sessionActionsPopover");
  actions.setAttribute("aria-expanded", "false");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "icon");
  icon.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-more");
  icon.append(use);
  actions.append(icon);
  const open = makeSidebarButton(sidebarSessionTitle(session), sidebarSessionTitle(session) + "\n" + session.directory +
    (session.archived ? "\n已归档，打开操作菜单可恢复" : ""), session.archived ? "i-archive" : "i-clock", session.id === currentSessionId,
    () => session.archived ? showSessionMenu(session, actions) : openSidebarItem(session, session.directory));
  if (session.archived) open.classList.add("session-archive-open");
  actions.addEventListener("click", () => showSessionMenu(session, actions));
  row.append(open, actions);
  return row;
}

function showSessionMenu(session, button) {
  const sameTarget = sessionMenuTarget?.id === session.id;
  if (!sameTarget) closePopovers();
  sessionMenuTarget = session;
  sessionMenuButton = button;
  document.querySelector("#archiveSessionActionLabel").textContent = session.archived ? "恢复会话" : "归档会话";
  document.querySelector("#archiveSessionActionIcon").setAttribute("href", session.archived ? "#i-restore" : "#i-archive");
  togglePopover(button, sessionActionsPopover);
  if (!sessionActionsPopover.hidden) sessionActionsPopover.querySelector("button").focus({ preventScroll: true });
}

async function manageSidebarSession(action) {
  const session = sessionMenuTarget;
  if (!session || !desktop || isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy) return;
  closePopovers();
  isSidebarSwitching = true;
  renderSidebarRows();
  syncComposerAvailability();
  try {
    const result = action === "delete" ? await desktop.deleteSession(session.id, session.directory)
      : action === "restore" ? await desktop.restoreSession(session.id, session.directory)
      : await desktop.archiveSession(session.id, session.directory);
    if (result?.cancelled) return;
    if (action === "delete") sidebarSessionTitles.delete(session.id);
    sidebarSessions = sidebarSessions.filter((item) => item.id !== session.id);
    if (action === "restore") showArchivedSessions = false;
    await refreshSidebar();
    showToast(result?.warning || (action === "delete" ? "会话已删除" : action === "restore" ? "会话已恢复到最近会话" : "会话已归档，可在“已归档会话”中恢复"), result?.warning ? 5200 : 3200);
  } catch (error) {
    showToast(error.message || "会话操作失败", 5200);
  } finally {
    isSidebarSwitching = false;
    renderSidebarRows();
    syncComposerAvailability();
    if (!managementDialog.open && !permissionDialog.open) {
      const row = [...document.querySelectorAll(".sidebar-session-row")].find((item) => item.dataset.sessionId === session.id);
      (row?.querySelector(".session-actions-button") || taskInput).focus({ preventScroll: true });
    }
  }
}

function registerSidebarSession(session) {
  if (!session?.sessionId) return;
  updateWorkspace(session.workspacePath || session.cwd || workspacePath);
  currentSessionId = session.sessionId;
  renderSidebarRows();
}

async function refreshSidebar() {
  if (!desktop) return;
  const sequence = ++sidebarRefreshSequence;
  const archived = showArchivedSessions;
  try {
    const snapshot = await desktop.getSidebar({ archived });
    const sameDirectory = (!snapshot.workspacePath && !workspacePath) || sameSidebarWorkspace(snapshot.workspacePath, workspacePath);
    if (sequence !== sidebarRefreshSequence || archived !== showArchivedSessions || !sameDirectory) return;
    sidebarProjects = snapshot.projects;
    sidebarSessions = snapshot.sessions;
    currentSessionId = snapshot.currentSessionId;
    sidebarReadError = null;
    renderSidebarRows();
    if (snapshot.readFailures) showToast("部分会话的消息暂未读到，已暂时隐藏，请稍后重试。");
  } catch (error) {
    if (sequence !== sidebarRefreshSequence || archived !== showArchivedSessions) return;
    sidebarReadError = "会话列表读取失败，请重新连接后重试";
    renderSidebarRows();
  }
}

async function openSidebarItem(session, directory) {
  if (!desktop || isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy) return;
  if (agentConnected && sameSidebarWorkspace(directory, workspacePath) && (!session || session.id === currentSessionId)) return;
  isSidebarSwitching = true;
  renderSidebarRows();
  syncComposerAvailability();
  try {
    const state = session ? await desktop.openSession(session.id, directory) : await desktop.openWorkspace(directory);
    registerSidebarSession(state);
    applyConfigOptions(state.configOptions);
    document.querySelector("#breadcrumbTitle").textContent = session ? sidebarSessionTitle(session) : "项目会话";
    setMobileMenu(false);
    await refreshSidebar();
  } catch (error) {
    showToast(error.message || "会话连接失败", 5200);
  } finally {
    isSidebarSwitching = false;
    renderSidebarRows();
    syncComposerAvailability();
  }
}

function setConversationVisible(visible) {
  welcomePanel.hidden = visible;
  conversationView.hidden = !visible;
  document.querySelector("#welcomeSuggestions").hidden = visible;
  document.querySelector(".workspace").classList.toggle("has-conversation", visible);
  if (visible) conversationView.scrollTop = conversationView.scrollHeight;
}

function appendMessage(role, text = "") {
  const row = document.createElement("article");
  row.className = `message-row ${role}-message`;

  const avatar = document.createElement("span");
  avatar.className = `message-avatar ${role}-avatar`;
  if (role === "user") avatar.textContent = "你";
  else avatar.append(createProviderLogo("deveco"));

  const body = document.createElement("div");
  body.className = "message-body";
  const header = document.createElement("div");
  header.className = "message-author";
  header.textContent = role === "user" ? "你" : "DevEco Agent";
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  body.append(header, content);
  row.append(avatar, body);
  messageList.append(row);
  setConversationVisible(true);
  conversationView.scrollTop = conversationView.scrollHeight;
  return { row, body, content };
}

function appendActivity(text, id = `activity-${Date.now()}-${Math.random()}`) {
  if (!activeAssistantMessage) {
    activeAssistantMessage = appendMessage("assistant");
    activeAssistantText = activeAssistantMessage.content;
  }
  let activity = toolActivities.get(id);
  if (!activity) {
    activity = document.createElement("div");
    activity.className = "agent-activity";
    activeAssistantMessage.body.append(activity);
    toolActivities.set(id, activity);
  }
  activity.textContent = text;
  conversationView.scrollTop = conversationView.scrollHeight;
}

function clearConversation() {
  messageList.replaceChildren();
  toolActivities.clear();
  activeAssistantMessage = null;
  activeAssistantText = null;
  activeUserMessage = null;
  activeUserText = null;
  setConversationVisible(false);
}

function providerFor(option) {
  const value = String(option.value ?? "");
  if (value.includes("/")) return value.split("/", 1)[0];
  if (option.provider) return String(option.provider);
  return "DevEco Agent";
}

function providerMonogram(provider) {
  const words = provider.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]) : [provider.slice(0, 2)])
    .join("").toUpperCase() || "DE";
}

function getOptionId(option) {
  return option?.configId ?? option?.id;
}

function renderModelOptions() {
  const previousScroll = modelList.scrollTop;
  const collapsed = new Set([...modelList.querySelectorAll(".model-provider-group")]
    .filter((group) => group.querySelector(".provider-heading")?.getAttribute("aria-expanded") === "false")
    .map((group) => group.dataset.provider));
  modelList.replaceChildren();
  if (!modelConfig?.options?.length) {
    modelEmpty.textContent = workspacePath ? "先登录 Huawei 或配置模型服务，才能选择模型" : "连接工程后选择模型";
    modelEmpty.hidden = false;
    modelList.append(modelEmpty);
    modelButton.disabled = !workspacePath;
    const modelValue = document.querySelector("#modelValue");
    modelValue.textContent = workspacePath ? "选择模型" : "DevEco / GLM-5.3";
    modelValue.classList.remove("model-id");
    return;
  }

  modelButton.disabled = configChoiceBusy || isWorking;
  const groups = new Map();
  for (const option of modelConfig.options) {
    const id = providerFor(option);
    const provider = modelPolicy.brand(id)?.key || id;
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(option);
  }

  const providerNames = Object.fromEntries(desktopModelCatalog.all.map((provider) => [provider.id, provider.displayName || provider.name || provider.id]));
  const ordered = [...groups].sort((left, right) => modelPolicy.providerOrder(providerFor(left[1][0]), providerFor(right[1][0]), providerNames));
  for (const [provider, options] of ordered) {
    const providerID = providerFor(options[0]);
    const company = modelPolicy.brand(providerID);
    const providerName = company?.name ?? desktopModelCatalog.all.find((item) => item.id === providerID)?.name ?? providerID;
    options.sort((left, right) => {
      const preferred = (String(right.value).toLowerCase() === modelPolicy.DEFAULT_MODEL.toLowerCase() ? 1 : 0) -
        (String(left.value).toLowerCase() === modelPolicy.DEFAULT_MODEL.toLowerCase() ? 1 : 0);
      return preferred || modelPolicy.modelName(left).localeCompare(modelPolicy.modelName(right), "zh-CN", { numeric: true });
    });
    const group = document.createElement("div");
    group.className = "model-provider-group";
    group.dataset.provider = provider.toLocaleLowerCase();
    const heading = document.createElement("button");
    heading.type = "button";
    heading.className = "provider-heading";
    heading.setAttribute("aria-expanded", "true");
    const logo = document.createElement("span");
    logo.className = "provider-heading-logo";
    logo.append(createProviderLogo(providerID));
    const title = document.createElement("strong");
    title.textContent = providerName;
    heading.append(logo, title, createUiIcon("chevron-down"));
    const children = document.createElement("div");
    children.className = "model-provider-models";
    heading.addEventListener("click", () => {
      children.hidden = !children.hidden;
      heading.setAttribute("aria-expanded", String(!children.hidden));
      repositionPopovers();
    });
    group.append(heading, children);
    if (collapsed.has(group.dataset.provider)) {
      children.hidden = true;
      heading.setAttribute("aria-expanded", "false");
    }

    for (const option of options) {
      const value = String(option.value ?? "");
      const button = document.createElement("button");
      button.className = "model-option";
      button.type = "button";
      button.dataset.value = value;
      button.dataset.provider = providerName;
      button.dataset.name = String(option.name ?? value);
      button.dataset.description = String(option.description ?? "");
      button.classList.toggle("selected", value === modelConfig.currentValue);

      const copy = document.createElement("span");
      copy.className = "model-option-copy";
      const name = document.createElement("strong");
      name.textContent = modelPolicy.modelName(option);
      const detail = document.createElement("small");
      detail.textContent = option.description || (new Set(options.map(providerFor)).size > 1 ? value : value.slice(value.indexOf("/") + 1));
      detail.classList.toggle("model-id", !option.description);
      copy.append(name, detail);
      const check = document.createElement("span");
      check.className = "model-check";
      check.append(createUiIcon("check"));
      check.hidden = value !== modelConfig.currentValue;
      button.append(copy, check);
      button.addEventListener("click", () => chooseConfigOption(modelConfig, value));
      children.append(button);
    }
    modelList.append(group);
  }

  const query = modelSearch.value.trim().toLocaleLowerCase();
  filterModels(query);
  updateModelButton();
  modelList.scrollTop = previousScroll;
  repositionPopovers();
}

function filterModels(query) {
  let visible = 0;
  modelList.querySelectorAll(".model-provider-group").forEach((group) => {
    let groupVisible = 0;
    group.querySelectorAll(".model-option").forEach((option) => {
      const match = !query || `${option.dataset.provider} ${option.dataset.name} ${option.dataset.description}`.toLocaleLowerCase().includes(query);
      option.hidden = !match;
      if (match) { visible += 1; groupVisible += 1; }
    });
    group.hidden = groupVisible === 0;
    if (query && groupVisible > 0) {
      group.querySelector(".model-provider-models").hidden = false;
      group.querySelector(".provider-heading").setAttribute("aria-expanded", "true");
    }
  });
  if (modelConfig?.options?.length) {
    modelEmpty.textContent = "没有匹配的模型";
    modelEmpty.hidden = visible > 0;
    if (visible === 0) modelList.append(modelEmpty);
  }
  repositionPopovers();
}

function updateModelButton() {
  const selected = modelConfig?.options?.find((option) => String(option.value) === String(modelConfig.currentValue));
  const modelName = selected ? modelPolicy.modelName(selected) : "选择模型";
  const provider = selected ? providerFor(selected) : "DevEco Agent";
  document.querySelector("#providerMonogram").replaceChildren(createProviderLogo(selected ? provider : "deveco"));
  const modelValue = document.querySelector("#modelValue");
  const companyName = modelPolicy.brand(provider)?.name ?? desktopModelCatalog.all.find((item) => item.id === provider)?.name ?? provider;
  modelValue.textContent = selected ? companyName + " / " + modelName : modelName;
  modelValue.classList.toggle("model-id", Boolean(selected) && (selected.name == null || String(selected.name) === String(selected.value)));
  modelValue.title = String(selected?.value ?? "");
  modelPopover.querySelector(".popover-heading span").textContent = selected ? companyName : "";
  modelPopover.querySelectorAll(".model-option").forEach((option) => {
    const chosen = option.dataset.value === String(modelConfig?.currentValue ?? "");
    option.classList.toggle("selected", chosen);
    option.querySelector(".model-check").hidden = !chosen;
  });
}

function renderEffortValue() {
  if (!activeEffortOptions.length) return;
  const index = Math.max(0, Math.min(activeEffortOptions.length - 1, Number(effortRange.value)));
  const selected = activeEffortOptions[index];
  const progress = activeEffortOptions.length > 1 ? (index / (activeEffortOptions.length - 1)) * 100 : 0;
  effortValue.textContent = selected.label;
  effortLevelLabel.textContent = selected.label;
  effortRange.setAttribute("aria-valuetext", selected.label);
  effortSliderFill.style.width = `${progress}%`;
  effortSliderShell.style.setProperty("--effort-run", `${effortSliderShell.clientWidth + 24}px`);
  effortSliderShell.classList.toggle("is-max", activeEffortHighestIndex >= 0 && index === activeEffortHighestIndex && index === activeEffortOptions.length - 1);
  [...effortTicks.children].forEach((tick, tickIndex) => tick.classList.toggle("is-reached", tickIndex <= index));
}

function renderEffortControl() {
  const effortState = window.devecoManagementState.effortOptions(effortConfig);
  if (effortState.options.length === 0) {
    activeEffortOptions = [];
    activeEffortHighestIndex = -1;
    effortSliderShell.classList.add("is-disabled");
    effortRange.disabled = true;
    effortRange.min = "0";
    effortRange.max = "0";
    effortRange.value = "0";
    effortValue.textContent = "自动";
    effortLevelLabel.textContent = "自动";
    effortProfileLabel.textContent = modelConfig?.name || "当前模型不提供思考档位";
    effortMinLabel.textContent = "不支持";
    effortMaxLabel.textContent = "";
    effortSliderFill.style.width = "0%";
    effortSliderShell.classList.remove("is-max");
    effortTicks.replaceChildren();
    effortButton.disabled = !workspacePath;
    return;
  }

  activeEffortOptions = effortState.options;
  activeEffortDefaultIndex = effortState.defaultIndex;
  activeEffortHighestIndex = effortState.highestIndex;
  effortButton.disabled = false;
  effortSliderShell.classList.toggle("is-disabled", effortState.disabled);
  effortRange.disabled = effortState.disabled || configChoiceBusy || isWorking;
  const maxIndex = activeEffortOptions.length - 1;
  const currentIndex = effortState.currentIndex;
  effortRange.min = "0";
  effortRange.max = String(maxIndex);
  effortRange.step = "1";
  effortRange.value = String(currentIndex >= 0 ? currentIndex : activeEffortDefaultIndex);
  effortMinLabel.textContent = activeEffortOptions[0].label;
  effortMaxLabel.textContent = activeEffortOptions[maxIndex].label;
  effortProfileLabel.textContent = modelConfig?.options?.find((option) => String(option.value) === String(modelConfig.currentValue))?.name ?? "当前模型";
  effortTicks.replaceChildren(...activeEffortOptions.map((option, index) => {
    const tick = document.createElement("span");
    tick.className = "effort-tick";
    tick.style.left = `${maxIndex > 0 ? (index / maxIndex) * 100 : 50}%`;
    tick.setAttribute("aria-hidden", "true");
    return tick;
  }));
  renderEffortValue();
}

function applyConfigOptions(configOptions = []) {
  currentConfigOptions = Array.isArray(configOptions) ? configOptions : [];
  const options = window.devecoManagementState.acpOptions(modelPolicy.filterConfigOptions(currentConfigOptions, desktopModelCatalog));
  modelConfig = options.model;
  effortConfig = options.effort;
  modeConfig = options.mode;
  if (!modelConfig?.options?.some((option) => String(option.value) === String(modelConfig.currentValue))) effortConfig = null;
  renderModelOptions();
  renderEffortControl();
  renderModeControl();
  syncComposerAvailability();
}

function renderModeControl() {
  const options = modeConfig?.options ?? [];
  const labels = { build: "构建", plan: "规划", goal: "目标" };
  const descriptions = { build: "修改工程并执行开发任务", plan: "先分析问题，梳理方案与步骤", goal: "围绕目标持续推进任务" };
  const current = options.find((option) => option.value === modeConfig.currentValue);
  document.querySelector("#modeValue").textContent = current ? labels[current.value] || current.name || current.value : "工作模式";
  modeList.replaceChildren();
  if (!options.length) {
    modeList.append(makeElement("div", "model-empty", workspacePath ? "Agent 尚未发布工作模式" : "连接工程后选择工作模式"));
    modeButton.disabled = true;
    return;
  }
  for (const option of options) {
    const button = makeElement("button", "mode-option");
    button.type = "button";
    const selected = option.value === modeConfig.currentValue;
    button.setAttribute("aria-pressed", String(selected));
    const copy = makeElement("span", "mode-option-copy");
    copy.append(makeElement("strong", "", labels[option.value] || option.name || option.value),
      makeElement("small", "", descriptions[option.value] || option.description || "使用当前 Agent 提供的模式"));
    button.append(copy);
    if (selected) button.append(createUiIcon("check"));
    button.addEventListener("click", () => chooseConfigOption(modeConfig, option.value));
    modeList.append(button);
  }
  repositionPopovers();
}

async function chooseConfigOption(config, value) {
  if (!desktop || !config || !workspacePath || configChoiceBusy || isWorking || isSidebarSwitching) return;
  const configId = getOptionId(config);
  if (!configId) return showToast("DevEco Agent 返回了没有标识符的配置项");
  const option = config.options?.find((candidate) => String(candidate.value) === String(value));
  const type = config.type === "boolean" ? "boolean" : "id";
  configChoiceBusy = true;
  syncComposerAvailability();
  modelButton.disabled = true;
  effortButton.disabled = true;
  effortRange.disabled = true;
  document.querySelector("#newTaskButton").disabled = true;
  renderSidebarRows();
  try {
    const result = await desktop.setConfigOption(configId, type === "boolean" ? Boolean(value) : String(value), type);
    applyConfigOptions(result.configOptions ?? currentConfigOptions);
    closePopovers();
  } catch (error) {
    showToast(error.message || "Agent 不接受这个设置");
    applyConfigOptions(currentConfigOptions);
  } finally {
    configChoiceBusy = false;
    document.querySelector("#newTaskButton").disabled = isWorking || isSubmitting || isSidebarSwitching;
    renderModelOptions();
    renderEffortControl();
    renderSidebarRows();
    syncComposerAvailability();
  }
}

function makeElement(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function setPill(node, label, tone = "neutral") {
  if (!node) return;
  node.textContent = label;
  node.className = "status-pill" + (tone === "neutral" ? " neutral" : tone ? " " + tone : "");
}

let environmentLoadSequence = 0;

function environmentHint(id) {
  return ({
    node: "桌面包内置 Node.js 24.15.0，可手动覆盖",
    agent: "桌面包内置 ACP 运行时",
    cli: "桌面包内置命令行工具",
    studio: "签名工具（可选）",
    sdk: "需与当前工程匹配（可选）",
  })[id] ?? "本机工具";
}

function renderEnvironmentState(environment) {
  const root = document.querySelector("#environmentList");
  const summary = document.querySelector("#environmentSummary");
  if (!root || !summary) return;
  const items = environment?.items ?? [];
  const required = new Set(["node", "agent", "cli"]);
  const missing = items.filter((item) => required.has(item.id) && !item.available);
  const incompatibleNode = items.find((item) => item.id === "node" && item.available && item.compatibility !== "compatible");
  summary.className = "environment-summary" + (missing.length || incompatibleNode ? " warning" : " ready");
  summary.textContent = missing.length
    ? "内置运行时未就绪：请重新检测，或手动指定 deveco.exe 和 node.exe。"
    : incompatibleNode
      ? "内置运行时已找到，但 Node.js 版本不满足要求。"
      : "桌面包内的 DevEco Code Agent、devecocli 与 Node.js 均已就绪。";

  root.replaceChildren();
  for (const item of items) {
    const row = makeElement("article", "environment-row");
    const title = makeElement("div", "environment-row-title");
    title.append(makeElement("strong", "", item.label ?? item.id), makeElement("small", "", environmentHint(item.id)));
    const executablePath = makeElement("code", "environment-path", item.path || "未检测到安装路径");
    const version = makeElement("div", "environment-version");
    const optional = item.id === "studio" || item.id === "sdk";
    const tone = item.available
      ? item.compatibility === "incompatible" ? "warning" : ""
      : optional ? "neutral" : "error";
    const state = item.available
      ? item.compatibility === "incompatible" ? "版本不兼容" : "已检测到"
      : optional ? "可选，未检测" : "未检测到";
    version.append(
      makeElement("span", "status-pill" + (tone ? " " + tone : ""), state),
      makeElement("small", "", item.version ? "版本 " + item.version : "版本未知"),
    );
    row.append(title, executablePath, version);
    root.append(row);
  }
  if (!items.length) root.append(makeElement("div", "empty-state", "暂时无法读取本机环境，请稍后重新检测。"));
  if (desktopState) {
    desktopState.environment = environment;
    desktopState.agentInstalled = Boolean(items.find((item) => item.id === "agent")?.path);
  }
}

async function loadEnvironmentState() {
  if (!desktop) {
    document.querySelector("#environmentSummary").textContent = "请在 DevEco Agent Desktop 中检测本机 CLI。";
    return;
  }
  const sequence = ++environmentLoadSequence;
  const button = document.querySelector("#refreshEnvironment");
  button.disabled = true;
  document.querySelector("#environmentSummary").textContent = "正在扫描本机 DevEco Code CLI…";
  try {
    const environment = await desktop.getEnvironment();
    if (sequence === environmentLoadSequence) renderEnvironmentState(environment);
  } catch (error) {
    if (sequence === environmentLoadSequence) {
      const summary = document.querySelector("#environmentSummary");
      summary.className = "environment-summary warning";
      summary.textContent = error.message || "本机 CLI 检测失败，请重试。";
    }
  } finally {
    if (sequence === environmentLoadSequence) button.disabled = false;
  }
}

async function selectEnvironmentExecutable(kind) {
  const button = document.querySelector(kind === "agent" ? "#selectAgentExecutable" : "#selectNodeExecutable");
  button.disabled = true;
  try {
    const environment = await desktop.selectEnvironmentPath(kind);
    if (environment) {
      renderEnvironmentState(environment);
      showToast(kind === "agent" ? "已更新 DevEco Code CLI 路径" : "已更新 Node.js 路径");
    }
  } catch (error) {
    const summary = document.querySelector("#environmentSummary");
    summary.className = "environment-summary warning";
    summary.textContent = error.message || "更新 CLI 路径失败。";
  } finally {
    button.disabled = false;
  }
}

function setManagementPanel(panelId) {
  const panel = managementPanels.find((item) => item.id === panelId);
  if (!panel) return;
  managementPanels.forEach((item) => { item.hidden = item !== panel; });
  managementNav.forEach((item) => item.classList.toggle("selected", item.dataset.panel === panelId));
  if (panelId === "accountPanel") loadAccountState();
  if (panelId === "agreementPanel") {
    loadAgreementState();
    loadPrivacyState();
  }
  if (panelId === "environmentPanel") loadEnvironmentState();
  if (panelId === "providerPanel") loadProviderState();
  if (panelId === "configPanel") loadConfigState();
}

function openManagement(panelId) {
  closePopovers();
  if (!managementDialog.open) managementDialog.showModal();
  setManagementPanel(panelId || "accountPanel");
}

function renderAccountState(account) {
  accountState = account;
  const state = account?.sessionState ?? (account?.credentialCached ? "cached-unverified" : account?.loggedIn ? "cached-unverified" : "signed-out");
  const hasCredential = Boolean(account?.credentialCached || account?.loggedIn || account?.identityLoggedIn);
  const statusNote = document.querySelector("#huaweiAccountStatus");
  statusNote.textContent = hasCredential && account?.removable === false ? "该账号由当前运行配置管理。"
    : state === "valid" ? "账号已登录。"
    : state === "expired" ? "登录已过期，请重新登录。"
    : state === "inconsistent" ? "账号信息尚未同步，请刷新或重新登录。"
    : state === "unknown" ? "暂时无法确认登录状态，请稍后刷新。"
    : state === "cached-unverified" ? "已保存账号记录，登录有效性待确认。"
    : "登录华为账号后，可查看认证信息并使用 DevEco 模型。";
  statusNote.hidden = state === "valid" && account?.removable !== false;
  const pill = document.querySelector("#huaweiAccountPill");
  pill.className = "account-login-state" + (state === "valid" ? "" : state === "expired" || state === "inconsistent" ? " warning" : " neutral");
  pill.textContent = state === "valid" ? "已登录" : state === "expired" ? "登录已过期" : state === "inconsistent" ? "待同步" :
    state === "cached-unverified" ? "待验证" : state === "unknown" ? "状态未知" : "未登录";
  const rawName = hasCredential ? String(account?.userName || "").trim().slice(0, 120) : "";
  const phone = rawName.match(/^(?:\+?86[ -]?)?(1[3-9]\d)(\d{4})(\d{4})$/);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawName);
  const displayName = phone || email ? "华为账号" : rawName || (hasCredential ? "华为用户" : state === "signed-out" ? "尚未登录" : "华为账号");
  document.querySelector("#huaweiAccountName").textContent = displayName;
  document.querySelector("#huaweiAccountAvatar").textContent = phone || email || !rawName ? "华" : Array.from(displayName)[0].toLocaleUpperCase();
  const identifier = document.querySelector("#huaweiAccountIdentifier");
  identifier.textContent = phone ? phone[1] + "****" + phone[3] : email ? rawName[0] + "***@" + rawName.split("@")[1] : "";
  identifier.hidden = !identifier.textContent;
  document.querySelector("#huaweiLogin").textContent = state === "expired" ? "重新登录" : hasCredential ? "切换账号" : "登录账号";
  const realName = account?.realName ?? "unknown";
  document.querySelector("#realNameStatus").textContent = realName === "recorded-verified" ? "华为账号实名记录已通过（缓存）"
    : realName === "recorded-unverified" ? "完成华为实名认证后，请重新核验" : hasCredential ? "暂未获取认证信息，可前往开发者联盟查看" : "登录后读取认证信息";
  setPill(document.querySelector("#realNamePill"), realName === "recorded-verified" ? "已实名" : realName === "recorded-unverified" ? "待认证" : "待获取",
    realName === "recorded-verified" ? "" : realName === "recorded-unverified" ? "warning" : "neutral");
  document.querySelector("#developerTypeValue").textContent = hasCredential || state === "unknown" ? "暂未获取" : "登录后查看";
  document.querySelector("#developerTypeValue").title = "认证类型请以华为开发者联盟中的信息为准";
  syncHuaweiAccountActions();
  renderAccountModelAccess();
}

async function loadAccountState() {
  if (!desktop) return;
  if (oauthStarting || oauthFlowId || accountLogoutInProgress || accountRefreshInProgress) return;
  const sequence = ++accountRefreshSequence;
  accountRefreshInProgress = true;
  syncHuaweiAccountActions();
  document.querySelector("#huaweiAccountStatus").hidden = false;
  document.querySelector("#huaweiAccountStatus").textContent = "正在更新账号状态…";
  try {
    const result = await desktop.refreshAccount();
    if (sequence === accountRefreshSequence) renderAccountState(result);
  } catch (error) {
    if (sequence === accountRefreshSequence) renderAccountState({ ...accountState, sessionState: "unknown", identityError: error.message });
  } finally {
    if (sequence === accountRefreshSequence) { accountRefreshInProgress = false; syncHuaweiAccountActions(); }
  }
}

function syncHuaweiAccountActions() {
  const hasCredential = Boolean(accountState?.credentialCached || accountState?.loggedIn || accountState?.identityLoggedIn);
  const authorizing = oauthStarting || Boolean(oauthFlowId && oauthFlowProvider === "deveco");
  const busy = isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy || authorizing || Boolean(oauthFlowId) || accountLogoutInProgress;
  document.querySelector("#huaweiLogin").disabled = !desktop || busy || (hasCredential && accountState?.removable === false);
  document.querySelector("#huaweiLogout").hidden = !hasCredential;
  document.querySelector("#huaweiLogout").disabled = busy || accountState?.removable !== true;
  document.querySelector("#recheckRealName").disabled = !desktop || busy || !hasCredential;
  document.querySelector("#refreshAccount").disabled = !desktop || Boolean(oauthFlowId) || authorizing || accountRefreshInProgress || accountLogoutInProgress;
  document.querySelector("#cancelHuaweiAuth").hidden = !authorizing;
}

function renderAccountModelAccess() {
  const signedIn = accountState?.sessionState === "valid";
  const realName = accountState?.realName;
  const legal = agreementState && window.devecoManagementState.agreement(agreementState, false);
  const label = !accountState || accountState.sessionState === "unknown" ? "待确认"
    : !signedIn ? accountState.sessionState === "expired" ? "待登录" : accountState?.credentialCached ? "待验证" : "待登录"
    : realName === "recorded-unverified" ? "待认证" : realName !== "recorded-verified" || !legal ? "待确认"
    : !legal.accepted ? "待同意协议" : "可用";
  setPill(document.querySelector("#modelAccessPill"), label, label === "可用" ? "" : "neutral");
  document.querySelector("#modelAccessDescription").textContent = label === "可用" ? "账号使用条件已满足，实际请求限额以服务端为准"
    : label === "待同意协议" ? "请在“协议与隐私”中阅读并同意当前协议"
    : label === "待认证" ? "完成实名认证后，可使用 DevEco 模型"
    : "登录并确认认证信息后使用，实际请求限额以服务端为准";
}

function renderAgreement(agreement) {
  agreementState = agreement;
  renderAccountModelAccess();
  if (!agreement) {
    document.querySelector("#agreementVersion").textContent = "协议暂不可用";
    document.querySelector("#agreementState").textContent = "检查管理服务后重试。";
    document.querySelector("#agreementConsent").checked = false;
    document.querySelector("#agreementConsent").disabled = true;
    document.querySelector("#acceptAgreement").disabled = true;
    document.querySelector("#openTerms").disabled = true;
    document.querySelector("#openPrivacy").disabled = true;
    return;
  }
  const agreementUi = window.devecoManagementState.agreement(agreement, false);
  const { reviewRequired, accepted } = agreementUi;
  const consent = document.querySelector("#agreementConsent");
  consent.checked = false;
  consent.disabled = false;
  document.querySelector("#agreementVersion").textContent = "当前版本 " + agreement.version;
  document.querySelector("#agreementState").textContent = reviewRequired
    ? "Huawei 服务协议已更新，需要重新阅读并主动同意。"
    : accepted
      ? "当前版本已记录同意"
      : "尚未同意当前版本；继续使用内置服务前需要主动选择";
  document.querySelector("#agreementUploadState").textContent = agreement.upload?.state
    ? "协议同步状态：" + agreement.upload.state
    : "";
  document.querySelector("#acceptAgreement").disabled = !window.devecoManagementState.agreement(agreement, consent.checked).canSubmit;
  consent.disabled = accepted;
  document.querySelector("#openTerms").disabled = !agreement.termsUrl;
  document.querySelector("#openPrivacy").disabled = !agreement.privacyUrl;
}

async function loadAgreementState() {
  try {
    renderAgreement(await desktop.getAgreement());
  } catch (error) {
    renderAgreement(null);
    document.querySelector("#agreementUploadState").textContent = error.message;
  }
}

async function submitAgreementConsent() {
  const checked = document.querySelector("#agreementConsent").checked;
  if (!checked || !agreementState) return;
  const button = document.querySelector("#acceptAgreement");
  button.disabled = true;
  try {
    const updated = await desktop.acceptAgreement(
      agreementState.version,
      agreementState.upload?.revision,
      true,
    );
    renderAgreement(updated);
    showToast("已提交你对当前协议版本的同意");
  } catch (error) {
    document.querySelector("#agreementUploadState").textContent = error.message;
    button.disabled = false;
  }
}

// 仅展示这 5 家热门服务；id 与核心模型目录一致，国内版优先，目录里没有时回退到国际版。
const FEATURED_PROVIDERS = modelPolicy.providers.filter((provider) => provider.key !== "deveco");

function providerHasCredential(providerId) {
  return (providerState?.authEntries ?? []).some((item) => item.providerID === providerId) ||
    (providerState?.providers?.connected ?? []).includes(providerId);
}

function slugifyProviderName(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return "custom-" + (slug || Date.now().toString(36));
}

function makeProviderRow({ id, name, status, ready, actions }) {
  const row = makeElement("article", "provider-row");
  row.dataset.providerId = id;
  row.dataset.expanded = String(activeCredentialProvider === id && !nativeProviderCredentialForm.hidden);
  const header = makeElement("div", "provider-row-header");
  const mark = makeElement("span", "provider-badge");
  mark.append(createProviderLogo(id));
  const copy = makeElement("div", "provider-row-main");
  const state = makeElement("small", ready ? "is-ready" : "");
  state.append(makeElement("i", "provider-state-dot"), document.createTextNode(status));
  copy.append(makeElement("strong", "", name), state);
  const actionBox = makeElement("div", "provider-row-actions");
  actionBox.append(...actions);
  header.append(mark, copy, actionBox);
  row.append(header);
  if (activeCredentialProvider === id && !nativeProviderCredentialForm.hidden) row.append(nativeProviderCredentialForm);
  return row;
}

function stageProviderCredentialForm() {
  document.querySelector("#providerCredentialHost").append(nativeProviderCredentialForm);
}

function closeNativeProviderForm(force = false) {
  if (providerEditorBusy && !force) return;
  activeCredentialProvider = null;
  nativeProviderCredentialForm.hidden = true;
  document.querySelector("#nativeProviderApiKey").value = "";
  document.querySelector("#nativeProviderApiKey").type = "password";
  document.querySelector("#toggleProviderKey").setAttribute("aria-label", "显示 API Key");
  document.querySelector("#toggleProviderKey .ui-icon").dataset.icon = "eye";
  stageProviderCredentialForm();
  if (providerState) renderProviderRows();
}

function makeActionButton(label, className, handler) {
  const button = makeElement("button", className, label);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function renderProviderRows() {
  const root = document.querySelector("#providerRows");
  stageProviderCredentialForm();
  root.replaceChildren();
  const all = providerState?.providers?.all ?? [];
  const configProviders = providerState?.config?.providers ?? {};

  let configuredCount = 0;
  for (const featured of FEATURED_PROVIDERS) {
    const candidates = featured.ids.map((id) => all.find((item) => item.id === id)).filter(Boolean);
    const provider = candidates.find((item) => providerHasCredential(item.id)) || candidates[0] || { id: featured.ids[0], unavailable: true };
    const ready = providerHasCredential(provider.id);
    if (ready) configuredCount += 1;
    const expanded = activeCredentialProvider === provider.id && !nativeProviderCredentialForm.hidden;
    const configure = makeActionButton(expanded ? "收起" : ready ? "管理" : "配置", "secondary-button provider-configure", () => {
      if (expanded) closeNativeProviderForm();
      else showProviderCredentialForm(provider.id, (providerState.authEntries ?? []).find((item) => item.providerID === provider.id), featured.name);
    });
    configure.disabled = provider.unavailable || providerEditorBusy;
    configure.setAttribute("aria-expanded", String(expanded));
    if (expanded) configure.append(createUiIcon("chevron-up"));
    const actions = [configure];
    if (ready) actions.push(makeActionButton("移除", "text-button", () => removeProviderCredential(provider.id)));
    root.append(makeProviderRow({ id: provider.id, name: featured.name, status: provider.unavailable ? "当前 Agent 未提供此服务" : ready ? "已配置" : "未配置", ready, actions }));
  }

  // 自定义 Provider：只列出用户自己加的 openai-compatible 条目。
  for (const config of Object.values(configProviders)) {
    if (config.npm !== "@ai-sdk/openai-compatible" || modelPolicy.blocked(config.id) || modelPolicy.brand(config.id)) continue;
    const ready = providerHasCredential(config.id);
    root.append(makeProviderRow({
      id: config.id,
      name: config.name || config.id,
      status: ready ? "已配置" : "缺少 Key",
      ready,
      actions: [
        makeActionButton("编辑", "secondary-button", () => showProviderEditor(config)),
        makeActionButton("移除", "text-button", () => removeProvider(config.id)),
      ],
    }));
  }
  document.querySelector("#providerConfiguredCount").textContent = "已配置 " + configuredCount + " / " + FEATURED_PROVIDERS.length;
}

async function loadProviderState() {
  stageProviderCredentialForm();
  document.querySelector("#providerRows").replaceChildren(makeElement("div", "empty-state", "读取中…"));
  try {
    providerState = await desktop.getProviders(providerScope);
    renderProviderRows();
    void refreshModelCatalog();
  } catch (error) {
    document.querySelector("#providerRows").replaceChildren(makeElement("div", "empty-state", error.message));
  }
}

function showProviderEditor(config = null) {
  if (providerEditorBusy) return;
  closeNativeProviderForm();
  const form = document.querySelector("#providerForm");
  document.querySelector("#providerCredentialForm").hidden = true;
  document.querySelector("#providerFormTitle").textContent = config ? "编辑 " + (config.name || config.id) : "自定义 Provider";
  form.dataset.editingId = config?.id ?? "";
  form.dataset.editingModelName = config?.models?.[0]?.name ?? "";
  form.dataset.editingContext = config?.models?.[0]?.contextLimit ?? "";
  form.dataset.editingOutput = config?.models?.[0]?.outputLimit ?? "";
  form.dataset.editingTools = config?.models?.[0]?.supportsTools === true ? "true" : "";
  document.querySelector("#providerName").value = config?.name ?? "";
  document.querySelector("#providerBaseUrl").value = config?.baseURL ?? "";
  document.querySelector("#providerModelId").value = config?.models?.[0]?.id ?? "";
  document.querySelector("#providerApiKey").value = "";
  document.querySelector("#providerFormError").hidden = true;
  form.hidden = false;
  document.querySelector("#showProviderForm").hidden = true;
  document.querySelector("#providerName").focus();
}

async function saveProviderForm(event) {
  event.preventDefault();
  const form = document.querySelector("#providerForm");
  const errorBox = document.querySelector("#providerFormError");
  const button = document.querySelector("#saveProvider");
  errorBox.hidden = true;
  button.disabled = true;
  const name = document.querySelector("#providerName").value.trim();
  const modelId = document.querySelector("#providerModelId").value.trim();
  // 后端要求这些字段；界面不再让用户填，编辑时沿用原值，新增时给出保守默认。
  const input = {
    id: form.dataset.editingId || slugifyProviderName(name),
    name,
    baseURL: document.querySelector("#providerBaseUrl").value.trim(),
    modelId,
    modelName: form.dataset.editingModelName || modelId,
    contextLimit: Number(form.dataset.editingContext) || 128000,
    outputLimit: Number(form.dataset.editingOutput) || 8192,
    supportsTools: form.dataset.editingTools || "",
    apiKey: document.querySelector("#providerApiKey").value,
  };
  try {
    await desktop.saveProvider(input, providerScope);
    document.querySelector("#providerApiKey").value = "";
    form.hidden = true;
    document.querySelector("#showProviderForm").hidden = false;
    await loadProviderState();
    showToast("已保存");
  } catch (error) {
    errorBox.textContent = error.message || "保存失败";
    errorBox.hidden = false;
    errorBox.focus();
  } finally {
    button.disabled = false;
  }
}

function showProviderCredentialForm(providerID, existingCredential, displayName = providerID) {
  if (!providerID || providerID === "deveco" || providerEditorBusy) return;
  activeCredentialProvider = providerID;
  document.querySelector("#providerForm").hidden = true;
  document.querySelector("#showProviderForm").hidden = false;
  document.querySelector("#providerCredentialTarget").textContent = displayName;
  document.querySelector("#saveProviderCredential").textContent = "保存";
  document.querySelector("#nativeProviderApiKey").value = "";
  document.querySelector("#nativeProviderApiKey").type = "password";
  document.querySelector("#nativeProviderApiKey").placeholder = "粘贴 " + displayName + " 的 API Key";
  document.querySelector("#toggleProviderKey").setAttribute("aria-label", "显示 API Key");
  document.querySelector("#toggleProviderKey .ui-icon").dataset.icon = "eye";
  document.querySelector("#providerCredentialError").hidden = true;
  document.querySelector("#providerCredentialStatus").textContent = "";
  document.querySelector("#providerCredentialForm").hidden = false;
  renderProviderRows();
  document.querySelector("#nativeProviderApiKey").focus();
}

async function saveNativeProviderCredential(event) {
  event.preventDefault();
  if (!activeCredentialProvider || activeCredentialProvider === "deveco" || providerEditorBusy) return;
  const providerID = activeCredentialProvider;
  const input = document.querySelector("#nativeProviderApiKey");
  const error = document.querySelector("#providerCredentialError");
  const button = document.querySelector("#saveProviderCredential");
  error.hidden = true;
  button.disabled = true;
  setProviderEditorBusy(true);
  try {
    await desktop.saveProviderCredential(providerID, input.value, providerScope);
    input.value = "";
    document.querySelector("#providerCredentialForm").hidden = true;
    activeCredentialProvider = null;
    await loadProviderState();
    showToast("已保存");
  } catch (failure) {
    error.textContent = failure.message || "保存失败";
    error.hidden = false;
    error.focus();
  } finally {
    button.disabled = false;
    setProviderEditorBusy(false);
  }
}

function setProviderEditorBusy(busy) {
  providerEditorBusy = busy;
  document.querySelector("#nativeProviderApiKey").readOnly = busy;
  for (const id of ["saveProviderCredential", "checkProviderConnection", "cancelProviderCredential"]) document.querySelector("#" + id).disabled = busy;
  if (providerState) renderProviderRows();
}

async function checkProviderConnection() {
  if (!activeCredentialProvider || providerEditorBusy || !desktop) return;
  const key = document.querySelector("#nativeProviderApiKey").value;
  if (!key.trim()) return document.querySelector("#nativeProviderApiKey").focus();
  const providerID = activeCredentialProvider;
  const status = document.querySelector("#providerCredentialStatus");
  setProviderEditorBusy(true);
  status.textContent = "正在检测模型目录访问…";
  try {
    const result = await desktop.checkProviderConnection(providerID, key);
    status.textContent = result.message;
    status.dataset.tone = result.status === "accessible" ? "ok" : "neutral";
  } catch {
    status.textContent = "检测未完成，请检查网络后重试。";
  } finally { setProviderEditorBusy(false); }
}

async function removeProvider(providerId) {
  if (!window.confirm("确定移除这个自定义 Provider 吗？")) return;
  try {
    await desktop.removeProvider(providerId, providerScope);
    await loadProviderState();
    showToast("已移除");
  } catch (error) {
    showToast(error.message || "移除失败", 5000);
  }
}

async function removeProviderCredential(providerId) {
  if (!window.confirm("确定移除已保存的 API Key 吗？")) return;
  try {
    await desktop.removeProviderCredential(providerId);
    await loadProviderState();
    showToast("已移除");
  } catch (error) {
    showToast(error.message || "移除失败", 5000);
  }
}

function showProviderOAuthForm(providerID, methodIndex, method) {
  if (oauthStarting || oauthFlowId) {
    showToast("当前已有授权正在进行；请先完成或取消后再开始新的授权。", 5000);
    return;
  }
  activeOAuthPrompt = { providerID, methodIndex, method };
  oauthFlowId = null;
  oauthFlowProvider = providerID;
  const card = document.querySelector("#providerAuthPromptCard");
  const fields = document.querySelector("#providerAuthFields");
  fields.replaceChildren();
  document.querySelector("#providerAuthError").hidden = true;
  document.querySelector("#providerAuthTitle").textContent = (method.label || "OAuth 登录") + " · " + providerID;
  document.querySelector("#providerAuthStatus").textContent = "继续后由 DevEco Code 在系统浏览器中完成授权。";
  document.querySelector("#providerAuthContinue").textContent = "开始授权";
  document.querySelector("#providerAuthContinue").disabled = false;
  for (const prompt of method.prompts ?? []) {
    const label = makeElement("label", prompt.type === "text" ? "" : "");
    label.append(document.createTextNode(prompt.message || prompt.key));
    let input;
    if (prompt.type === "select") {
      input = makeElement("select");
      for (const option of prompt.options ?? []) {
        const item = makeElement("option", "", option.label || option.value);
        item.value = option.value;
        input.append(item);
      }
    } else {
      input = makeElement("input");
      input.type = /key|token|secret|password/i.test(prompt.key) ? "password" : "text";
      input.placeholder = prompt.placeholder || "";
      input.autocomplete = input.type === "password" ? "new-password" : "off";
      input.required = true;
    }
    input.name = prompt.key;
    label.append(input);
    fields.append(label);
  }
  card.hidden = false;
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (method.prompts?.length) fields.querySelector("input,select")?.focus();
  else document.querySelector("#providerAuthContinue").focus();
}

function addOAuthCodeField() {
  const fields = document.querySelector("#providerAuthFields");
  if (fields.querySelector('[name="__oauth_code"]')) return;
  const label = makeElement("label", "form-span-two");
  label.append(document.createTextNode("授权码"));
  const input = makeElement("input");
  input.name = "__oauth_code";
  input.autocomplete = "one-time-code";
  input.required = true;
  label.append(input);
  fields.append(label);
  document.querySelector("#providerAuthContinue").textContent = "提交授权码";
  input.focus();
}

async function submitProviderOAuth(event) {
  event.preventDefault();
  if (!activeOAuthPrompt || oauthStarting) return;
  oauthStarting = true;
  const button = document.querySelector("#providerAuthContinue");
  const errorBox = document.querySelector("#providerAuthError");
  errorBox.hidden = true;
  button.disabled = true;
  try {
    if (oauthFlowId && activeOAuthPrompt.authorizationMethod === "code") {
      const code = document.querySelector('[name="__oauth_code"]')?.value?.trim();
      await desktop.completeOAuth(oauthFlowId, code);
      document.querySelector("#providerAuthStatus").textContent = "授权码已提交，等待核心确认…";
      return;
    }
    const inputs = {};
    for (const field of document.querySelectorAll("#providerAuthFields [name]")) {
      if (field.name === "__oauth_code") continue;
      inputs[field.name] = field.value;
    }
    const result = await desktop.startOAuth(
      activeOAuthPrompt.providerID,
      activeOAuthPrompt.methodIndex,
      inputs,
      providerScope,
    );
    oauthFlowId = result.flowId;
    oauthFlowProvider = activeOAuthPrompt.providerID;
    if (result.method === "code") {
      activeOAuthPrompt.authorizationMethod = "code";
      addOAuthCodeField();
      document.querySelector("#providerAuthStatus").textContent = result.instructions || "请在系统浏览器完成授权，再输入授权码。";
    } else {
      activeOAuthPrompt.authorizationMethod = "auto";
      document.querySelector("#providerAuthStatus").textContent = result.instructions || "请在系统浏览器完成授权；可随时取消或等待超时。";
      button.disabled = true;
    }
  } catch (error) {
    errorBox.textContent = error.message || "OAuth 启动失败";
    errorBox.hidden = false;
    errorBox.focus();
    button.disabled = false;
  } finally {
    oauthStarting = false;
  }
}

async function cancelProviderOAuth() {
  if (!oauthFlowId) {
    if (activeOAuthPrompt) await desktop.cancelOAuthProvider(activeOAuthPrompt.providerID).catch(() => {});
    document.querySelector("#providerAuthPromptCard").hidden = true;
    activeOAuthPrompt = null;
    if (!oauthStarting) oauthFlowProvider = null;
    return;
  }
  try { await desktop.cancelOAuth(oauthFlowId); }
  catch (error) { document.querySelector("#providerAuthStatus").textContent = error.message || "取消请求未完成"; }
}

function renderConfigState(config) {
  configSnapshot = config;
  void loadDefaultModelChoices();
}

async function loadConfigState() {
  configScope = "global";
  try {
    renderConfigState(await desktop.getConfig(configScope));
  } catch (error) {
    document.querySelector("#configSaveStatus").textContent = error.message || "读取失败";
  }
}

async function saveConfiguration(event) {
  event.preventDefault();
  const errorBox = document.querySelector("#configFormError");
  errorBox.hidden = true;
  const value = document.querySelector("#configModel").value;
  if (!value || value === String(configSnapshot?.fields?.model ?? "")) {
    document.querySelector("#configSaveStatus").textContent = "没有需要保存的改动";
    return;
  }
  const button = document.querySelector("#saveConfig");
  button.disabled = true;
  try {
    const result = await desktop.updateConfig(configScope, { model: value });
    renderConfigState(result.config);
    document.querySelector("#configSaveStatus").textContent = "已保存，新会话生效";
  } catch (error) {
    errorBox.textContent = error.message || "保存失败";
    errorBox.hidden = false;
    errorBox.focus();
  } finally {
    button.disabled = false;
  }
}

async function saveCurrentModelAsDefault() {
  if (!modelConfig?.currentValue) return showToast("当前会话没有可保存的模型");
  const scope = document.querySelector("#defaultModelScope").value;
  if (scope === "project" && !workspacePath) return showToast("先选择工程，才能保存项目默认模型");
  const button = document.querySelector("#saveDefaultModel");
  button.disabled = true;
  try {
    const result = await desktop.setDefaultModel(String(modelConfig.currentValue), scope);
    showToast("默认模型已保存到" + (scope === "project" ? "当前工程" : "全局配置") + "，新会话生效。");
    if (result?.effective === "next-session") closePopovers();
  } catch (error) {
    showToast(error.message || "默认模型保存失败", 5000);
  } finally {
    button.disabled = false;
  }
}

async function selectWorkspace(options = {}) {
  if (isWorking || isSidebarSwitching || configChoiceBusy || (isSubmitting && options.fromSubmit !== true)) {
    showToast("先停止当前任务，再切换工程。");
    return false;
  }
  if (!desktop) {
    showToast("请在项目目录运行 npm start，使用桌面窗口连接本机 Agent。");
    return false;
  }
  isSidebarSwitching = true;
  renderSidebarRows();
  syncComposerAvailability();
  try {
    const session = await desktop.selectWorkspace();
    if (!session) return false;
    updateWorkspace(session.workspacePath);
    registerSidebarSession(session);
    void refreshSidebar();
    applyConfigOptions(session.configOptions);
    return true;
  } catch (error) {
    setStatus({ state: "error", message: error.message });
    showToast(error.message || "工程连接失败", 5200);
    return false;
  } finally {
    isSidebarSwitching = false;
    renderSidebarRows();
    syncComposerAvailability();
  }
}

function renderPrivacyState(state) {
  privacyState = state;
  const allow = document.querySelector("#improvementConsentAllow");
  const decline = document.querySelector("#improvementConsentDecline");
  const save = document.querySelector("#savePrivacyPreference");
  const status = document.querySelector("#improvementConsentStatus");
  const availability = document.querySelector("#privacyAvailability");
  if (!state?.available) {
    allow.disabled = true;
    decline.disabled = true;
    save.disabled = true;
    status.textContent = state?.reason || "当前账号偏好不可用。";
    setPill(availability, "不可用", "neutral");
    return;
  }
  privacyOriginalDecision = state.decision === "granted" ? "true" : state.decision === "declined" ? "false" : "";
  allow.checked = privacyOriginalDecision === "true";
  decline.checked = privacyOriginalDecision === "false";
  allow.disabled = false;
  decline.disabled = false;
  save.disabled = true;
  status.textContent = state.decision === "granted"
    ? "当前账号已允许体验改进数据收集。"
    : state.decision === "declined"
      ? "当前账号已拒绝体验改进数据收集。"
      : state.decision === "undecided"
        ? "当前账号尚未表态；核心按默认关闭处理。"
        : "当前账号偏好未知。";
  setPill(availability, state.decision === "granted" ? "已允许" : state.decision === "declined" ? "已拒绝" : state.decision === "undecided" ? "默认关闭" : "未知", "neutral");
}

function renderDevicePrivacyState(state) {
  devicePrivacyState = state;
  const analytics = document.querySelector("#analyticsUploadEnabled");
  const crashes = document.querySelector("#crashUploadEnabled");
  const save = document.querySelector("#saveDevicePrivacy");
  const status = document.querySelector("#devicePrivacyStatus");
  const availability = document.querySelector("#devicePrivacyAvailability");
  if (!state?.available) {
    analytics.disabled = true;
    crashes.disabled = true;
    save.disabled = true;
    status.textContent = state?.reason || "设备级偏好读取失败。";
    setPill(availability, "不可用", "neutral");
    return;
  }
  devicePrivacyOriginal = {
    analyticsEnabled: state.analyticsEnabled === true,
    crashUploadEnabled: state.crashUploadEnabled === true,
  };
  analytics.checked = devicePrivacyOriginal.analyticsEnabled;
  crashes.checked = devicePrivacyOriginal.crashUploadEnabled;
  analytics.disabled = false;
  crashes.disabled = false;
  save.disabled = true;
  status.textContent = state.source === "default"
    ? "本机尚未保存这些选项；按 DevEco Code 核心默认值显示为开启。"
    : "已从 DevEco Code 本机偏好读取。";
  setPill(availability, "可用", "neutral");
}

async function loadPrivacyState() {
  try {
    const [accountPreference, devicePreference] = await Promise.all([
      desktop.getPrivacyPreference(),
      desktop.getDevicePrivacy(),
    ]);
    renderPrivacyState(accountPreference);
    renderDevicePrivacyState(devicePreference);
  } catch (error) {
    renderPrivacyState({ available: false, decision: "unknown", reason: error.message || "隐私偏好读取失败" });
    renderDevicePrivacyState({ available: false, reason: error.message || "设备级偏好读取失败" });
  }
}

async function savePrivacyState() {
  if (!privacyState?.available) return;
  const selected = document.querySelector('input[name="improvementConsentChoice"]:checked');
  if (!selected) return;
  const granted = selected.value === "true";
  const button = document.querySelector("#savePrivacyPreference");
  button.disabled = true;
  try {
    const result = await desktop.setPrivacyPreference(granted, privacyState.revision);
    renderPrivacyState(result);
    document.querySelector("#privacySaveStatus").textContent = result.effective === "current-session-refreshed"
      ? "偏好已保存并已重新加载空闲 Agent。"
      : "偏好已保存；Agent 下次连接时生效。";
  } catch (error) {
    document.querySelector("#privacySaveStatus").textContent = error.message || "隐私偏好保存失败，请重新读取后重试";
    await loadPrivacyState();
  }
}

async function saveDevicePrivacyState() {
  if (!devicePrivacyState?.available || !devicePrivacyState?.revision) return;
  const preferences = {
    analyticsEnabled: document.querySelector("#analyticsUploadEnabled").checked,
    crashUploadEnabled: document.querySelector("#crashUploadEnabled").checked,
  };
  const button = document.querySelector("#saveDevicePrivacy");
  button.disabled = true;
  try {
    const result = await desktop.setDevicePrivacy(preferences, devicePrivacyState.revision);
    renderDevicePrivacyState(result);
    document.querySelector("#devicePrivacyStatus").textContent = result.effective === "current-session-refreshed"
      ? "设备偏好已保存，空闲 Agent 已重新加载。"
      : "设备偏好已保存；下次 Agent 连接时生效。";
  } catch (error) {
    document.querySelector("#devicePrivacyStatus").textContent = error.message || "设备偏好保存失败，请重新读取后重试";
    await loadPrivacyState();
  }
}

async function beginHuaweiLogin(recheck = false) {
  if (oauthStarting || oauthFlowId) {
    showToast("当前已有授权正在进行；请先完成或取消后再开始新的授权。", 5000);
    return;
  }
  oauthFlowProvider = "deveco";
  oauthFlowId = null;
  oauthStarting = true;
  accountRefreshSequence += 1;
  accountRefreshInProgress = false;
  syncHuaweiAccountActions();
  let started = false;
  document.querySelector("#huaweiLogin").disabled = true;
  document.querySelector("#recheckRealName").disabled = true;
  document.querySelector("#huaweiAccountStatus").hidden = false;
  document.querySelector("#huaweiAccountStatus").textContent = recheck
    ? "正在启动官方授权以重新核验实名状态…"
    : "正在启动 Huawei 官方授权…";
  document.querySelector("#cancelHuaweiAuth").hidden = false;
  try {
    const flow = recheck ? await desktop.recheckRealName() : await desktop.startHuaweiLogin();
    oauthFlowId = flow.flowId;
    started = true;
    document.querySelector("#huaweiAccountStatus").textContent = recheck
      ? "请在系统浏览器完成授权，返回后将更新认证状态。"
      : "请在系统浏览器完成 Huawei ID 授权。";
  } catch (error) {
    document.querySelector("#huaweiAccountStatus").textContent = error.message || "Huawei 授权启动失败";
    document.querySelector("#cancelHuaweiAuth").hidden = true;
  } finally {
    oauthStarting = false;
    if (!started) {
      document.querySelector("#huaweiLogin").disabled = false;
      document.querySelector("#recheckRealName").disabled = !accountState?.credentialCached;
      document.querySelector("#cancelHuaweiAuth").hidden = true;
      oauthFlowProvider = null;
    }
    syncHuaweiAccountActions();
  }
}

async function cancelHuaweiLogin() {
  try {
    if (oauthFlowId) await desktop.cancelOAuth(oauthFlowId);
    else await desktop.cancelOAuthProvider("deveco");
  } catch (error) {
    document.querySelector("#huaweiAccountStatus").textContent = error.message || "取消授权失败";
  }
}

async function handleOAuthProgress(event) {
  if (event.providerID !== oauthFlowProvider) return;
  oauthFlowId = event.flowId;
  if (event.providerID === "deveco") {
    const status = document.querySelector("#huaweiAccountStatus");
    status.hidden = false;
    if (event.status === "waiting") status.textContent = "等待系统浏览器中的 Huawei ID 授权…";
    if (event.status === "complete") {
      status.textContent = "授权完成，正在刷新账号和实名状态…";
      document.querySelector("#cancelHuaweiAuth").hidden = true;
      document.querySelector("#huaweiLogin").disabled = false;
      document.querySelector("#recheckRealName").disabled = !accountState?.credentialCached;
      oauthFlowId = null;
      oauthFlowProvider = null;
      oauthStarting = false;
      await loadAccountState();
    }
    if (event.status === "failed") {
      status.textContent = event.error || "Huawei 授权失败";
      document.querySelector("#cancelHuaweiAuth").hidden = true;
      document.querySelector("#huaweiLogin").disabled = false;
      document.querySelector("#recheckRealName").disabled = !accountState?.credentialCached;
      oauthFlowId = null;
      oauthFlowProvider = null;
      oauthStarting = false;
      await loadAccountState();
    }
    if (event.status === "cancelled") {
      status.textContent = "授权已取消";
      document.querySelector("#cancelHuaweiAuth").hidden = true;
      document.querySelector("#huaweiLogin").disabled = false;
      document.querySelector("#recheckRealName").disabled = !accountState?.credentialCached;
      oauthFlowId = null;
      oauthFlowProvider = null;
      oauthStarting = false;
      await loadAccountState();
    }
    return;
  }
  const status = document.querySelector("#providerAuthStatus");
  const button = document.querySelector("#providerAuthContinue");
  if (event.status === "waiting") status.textContent = "等待系统浏览器中的授权完成；可随时取消。";
  if (event.status === "awaiting-code") {
    addOAuthCodeField();
    status.textContent = "请在系统浏览器完成授权，再输入授权码。";
    button.disabled = false;
  }
  if (event.status === "complete") {
    status.textContent = "授权成功；正在刷新 Provider 状态…";
    document.querySelector("#providerAuthPromptCard").hidden = true;
    oauthFlowId = null;
    activeOAuthPrompt = null;
    await loadProviderState();
  }
  if (event.status === "failed" || event.status === "cancelled") {
    status.textContent = event.status === "failed" ? (event.error || "OAuth 授权失败") : "OAuth 授权已取消";
    button.disabled = false;
    if (event.status === "cancelled") {
      oauthFlowId = null;
      activeOAuthPrompt = null;
    }
  }
}

async function initializeManagement(state) {
  desktopState = state;
  const cachedAccount = state.account
    ? {
      credentialCached: state.account.loggedIn,
      removable: state.account.removable,
      realName: state.account.realName,
      realNameSource: state.account.realNameSource,
      sessionState: state.account.loggedIn ? "cached-unverified" : "signed-out",
    }
    : null;
  if (cachedAccount) renderAccountState(cachedAccount);
  if (state.agreement) renderAgreement(state.agreement);
  document.querySelector('#defaultModelScope option[value="project"]').disabled = !workspacePath;
  if (state.agreementNeedsAttention) openManagement("agreementPanel");
  if (state.state) applyConfigOptions(state.state.configOptions ?? []);
}

async function refreshRuntimeMetadata() {
  if (!desktop) return;
  const sequence = ++runtimeMetadataSequence;
  try {
    const state = await desktop.getState({ includeManagement: true });
    if (sequence !== runtimeMetadataSequence) return;
    desktopState = state;
    controlStatus = state.controlStatus;
    if (!accountState && state.account) renderAccountState({
      credentialCached: state.account.loggedIn,
      removable: state.account.removable,
      realName: state.account.realName,
      realNameSource: state.account.realNameSource,
      sessionState: state.account.loggedIn ? "cached-unverified" : "signed-out",
    });
    if (state.agreement) renderAgreement(state.agreement);
    if (state.agreementNeedsAttention && !managementDialog.open) openManagement("agreementPanel");
  } catch { /* Connection status is delivered independently of account metadata. */ }
}

// 填充「默认模型」下拉：可选项取自核心的模型目录。
async function loadDefaultModelChoices() {
  const select = document.querySelector("#configModel");
  try {
    const catalog = await desktop.getModelCatalog();
    desktopModelCatalog = catalog;
    const current = configSnapshot?.fields?.model ?? "";
    select.replaceChildren();
    for (const provider of catalog.all.slice().sort((left, right) => modelPolicy.providerOrder(left.id, right.id))) {
      if (!provider.models?.length) continue;
      const group = document.createElement("optgroup");
      group.label = provider.displayName || provider.name || provider.id;
      for (const model of provider.models) {
        const option = makeElement("option", "", model.name || model.id);
        option.value = provider.id + "/" + model.id;
        group.append(option);
      }
      select.append(group);
    }
    const values = [...select.options].map((option) => ({ value: option.value }));
    select.value = values.some((option) => option.value === current) ? current : modelPolicy.preferredValue(values) || "";
    select.disabled = !values.length;
    if (!values.length) select.append(makeElement("option", "", "先配置模型服务或登录 Huawei"));
  } catch {
    select.replaceChildren(makeElement("option", "", "暂时无法读取模型列表"));
  }
}

function showPermissionRequest(request) {
  pendingPermission = request;
  const title = request.title || request.toolCall?.title || "DevEco Agent 请求执行操作";
  const description = request.description || "Agent 需要你的许可后才能继续。";
  document.querySelector("#permissionTitle").textContent = title;
  document.querySelector("#permissionDescription").textContent = description;
  const detail = document.querySelector("#permissionDetail");
  const toolCall = request.toolCall ?? request.subject?.toolCall;
  const command = request.subject?.command;
  const detailText = command
    ? `${command}\n工作目录：${request.subject.cwd || workspacePath || "未知"}`
    : toolCall?.title || toolCall?.rawInput
      ? `${toolCall.title || "工具调用"}${toolCall.rawInput ? `\n${JSON.stringify(toolCall.rawInput, null, 2)}` : ""}`
      : "";
  detail.textContent = detailText.slice(0, 2800);
  detail.hidden = !detail.textContent;

  const optionsRoot = document.querySelector("#permissionOptions");
  optionsRoot.replaceChildren();
  for (const option of request.options ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `permission-option ${String(option.kind).startsWith("allow") ? "allow-option" : "reject-option"}`;
    button.textContent = option.name || (String(option.kind).startsWith("allow") ? "允许一次" : "拒绝");
    button.addEventListener("click", () => answerPermission(request, option.optionId));
    optionsRoot.append(button);
  }
  if (!permissionDialog.open) permissionDialog.showModal();
}

async function answerPermission(request, optionId = null) {
  if (!desktop || !request) return;
  await desktop.respondPermission(request.id ?? request.requestId, optionId);
  pendingPermission = null;
  if (permissionDialog.open) permissionDialog.close("answered");
}

function renderSessionUpdate(params) {
  const update = params?.update;
  if (!update) return;
  if (update.sessionUpdate === "user_message_chunk") {
    activeAssistantMessage = null;
    activeAssistantText = null;
    if (!activeUserMessage) {
      activeUserMessage = appendMessage("user");
      activeUserText = activeUserMessage.content;
    }
    if (update.content?.type === "text") activeUserText.textContent += update.content.text;
    conversationView.scrollTop = conversationView.scrollHeight;
    return;
  }
  if (update.sessionUpdate === "agent_message_chunk") {
    activeUserMessage = null;
    activeUserText = null;
    if (!activeAssistantMessage) {
      activeAssistantMessage = appendMessage("assistant");
      activeAssistantText = activeAssistantMessage.content;
    }
    if (update.content?.type === "text") activeAssistantText.textContent += update.content.text;
    conversationView.scrollTop = conversationView.scrollHeight;
    return;
  }

  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    const id = update.toolCallId || update.id || `${update.sessionUpdate}-${Date.now()}`;
    const title = update.title || update.kind || "Agent 操作";
    const state = update.status === "completed" ? "已完成" : update.status === "failed" ? "失败" : "处理中";
    appendActivity(`${title} · ${state}`, id);
    return;
  }

  if (update.sessionUpdate === "plan") {
    const entries = (update.entries ?? []).map((entry) => entry.content).filter(Boolean);
    if (entries.length) appendActivity(`计划：${entries.join(" · ")}`, "agent-plan");
    return;
  }

  if (update.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
    applyConfigOptions(update.configOptions);
    return;
  }

  if (update.sessionUpdate === "notice") {
    showToast(update.content?.text || update.message || "DevEco Agent 提示");
  }
}

function handleDesktopEvent(event) {
  if (!event) return;
  if (event.type === "status") setStatus(event.status);
  if (event.type === "control:status") {
    controlStatus = event.status;
  }
  if (event.type === "environment:updated") renderEnvironmentState(event.environment);
  if (event.type === "agreement:required") {
    if (event.reason) document.querySelector("#agreementUploadState").textContent = event.reason;
    openManagement("agreementPanel");
  }
  if (event.type === "runtime-ready") void refreshRuntimeMetadata();
  if (event.type === "sidebar:changed" && sameSidebarWorkspace(event.workspacePath, workspacePath)) void refreshSidebar();
  if (event.type === "session-reset") { clearConversation(); currentSessionId = event.sessionId ?? null; }
  if (event.type === "session-ready") {
    registerSidebarSession(event.state);
    void refreshSidebar();
    void refreshModelCatalog();
    void refreshRuntimeMetadata();
    applyConfigOptions(event.state?.configOptions ?? []);
    const version = event.state?.agentInfo?.version;
    if (version) document.querySelector("#connectionStatus").textContent = "DevEco Code " + version;
    document.querySelector("#composerCaption").textContent = "Enter 发送 · Ctrl+Enter 换行";
  }
  if (event.type === "config-options") applyConfigOptions(event.configOptions);
  if (event.type === "session-update") renderSessionUpdate(event.params);
  if (event.type === "permission-request") showPermissionRequest(event.request);
  if (event.type === "permission-cancelled" && pendingPermission?.requestId === event.requestId) {
    pendingPermission = null;
    if (permissionDialog.open) permissionDialog.close("cancelled");
  }
  if (event.type === "prompt-started") setWorking(true);
  if (event.type === "prompt-finished") {
    setWorking(false);
    void refreshSidebar();
  }
  if (event.type === "oauth:progress") void handleOAuthProgress(event);
  if (event.type === "oauth:refreshed") {
    void refreshModelCatalog();
    if (event.providerID === "deveco") void loadAccountState();
    if (!document.querySelector("#providerPanel").hidden) void loadProviderState();
  }
}

document.querySelector("#collapseSidebar").addEventListener("click", () => appShell.classList.toggle("sidebar-collapsed"));
document.querySelector("#showSidebarButton").addEventListener("click", () => appShell.classList.remove("sidebar-collapsed"));
document.querySelector("#mobileMenuButton").addEventListener("click", () => setMobileMenu(true));
mobileScrim.addEventListener("click", () => setMobileMenu(false));

document.querySelector("#newTaskButton").addEventListener("click", async () => {
  if (isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy) return;
  isSidebarSwitching = true;
  showArchivedSessions = false;
  renderSidebarRows();
  syncComposerAvailability();
  setMobileMenu(false);
  try {
    if (desktop && workspacePath) {
      const session = await desktop.createSession();
      registerSidebarSession(session);
      applyConfigOptions(session.configOptions);
    } else clearConversation();
    taskInput.value = "";
    document.querySelector("#breadcrumbTitle").textContent = "新建任务";
  } catch (error) {
    showToast(error.message || "新会话创建失败", 5200);
  } finally {
    isSidebarSwitching = false;
    renderSidebarRows();
    syncComposerAvailability();
    void refreshSidebar();
    taskInput.focus();
  }
});

document.querySelectorAll(".suggestion-card").forEach((card) => {
  card.addEventListener("click", () => { taskInput.value = card.dataset.prompt; taskInput.focus(); });
});

const searchField = document.querySelector("#searchField");
const searchInput = document.querySelector("#searchInput");
document.querySelector("#searchButton").addEventListener("click", () => { searchField.hidden = false; searchInput.focus(); });
document.querySelector("#closeSearch").addEventListener("click", () => { searchField.hidden = true; searchInput.value = ""; renderSidebarRows(); });
searchInput.addEventListener("input", renderSidebarRows);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchField.hidden = true;
    searchInput.value = "";
    renderSidebarRows();
    document.querySelector("#searchButton").focus();
  }
});

modelButton.addEventListener("click", (event) => {
  togglePopover(event.currentTarget, modelPopover);
  if (!modelPopover.hidden) void refreshModelCatalog();
});
effortButton.addEventListener("click", (event) => togglePopover(event.currentTarget, effortPopover));
modeButton.addEventListener("click", (event) => togglePopover(event.currentTarget, modePopover));
modelSearch.addEventListener("input", () => filterModels(modelSearch.value.trim().toLocaleLowerCase()));
document.querySelector("#resetEffort").addEventListener("click", () => {
  effortRange.value = String(activeEffortDefaultIndex);
  renderEffortValue();
  if (effortConfig && activeEffortOptions[activeEffortDefaultIndex]) {
    chooseConfigOption(effortConfig, activeEffortOptions[activeEffortDefaultIndex].value);
  }
});
effortRange.addEventListener("input", renderEffortValue);
effortRange.addEventListener("change", () => {
  if (effortConfig && activeEffortOptions[Number(effortRange.value)]) {
    chooseConfigOption(effortConfig, activeEffortOptions[Number(effortRange.value)].value);
  }
});

document.querySelector("#composerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy) return;
  const text = taskInput.value.trim();
  if (!text) { taskInput.focus(); return; }
  if (!desktop) { showToast("请在项目目录运行 npm start，使用桌面窗口连接本机 Agent。"); return; }
  if (workspacePath && !agentConnected) { showToast("工作区尚未就绪，请等待连接完成或点击重新连接。"); return; }
  isSubmitting = true;
  syncComposerAvailability();
  try {
    if (!workspacePath && !(await selectWorkspace({ fromSubmit: true }))) return;
    if (!agentConnected) return;
    await submitTask(text);
  } finally {
    isSubmitting = false;
    renderSidebarRows();
    syncComposerAvailability();
  }
});

async function submitTask(text) {
  if (isWorking) return;

  appendMessage("user", text);
  activeAssistantMessage = appendMessage("assistant", "");
  activeAssistantText = activeAssistantMessage.content;
  const pending = document.createElement("span");
  pending.className = "agent-typing";
  pending.setAttribute("aria-label", "Agent 正在思考");
  pending.innerHTML = "<i></i><i></i><i></i>";
  activeAssistantMessage.body.append(pending);
  setConversationVisible(true);
  document.querySelector("#breadcrumbTitle").textContent = text.slice(0, 34);
  const sidebarSession = sidebarSessions.find((session) => session.id === currentSessionId);
  if (currentSessionId && (!sidebarSession || !sidebarSessionTitles.has(currentSessionId))) {
    sidebarSessionTitles.set(currentSessionId, text.split(/\r?\n/)[0].slice(0, 80));
  }
  if (sidebarSession) sidebarSession.updatedAt = Date.now();
  renderSidebarRows();
  taskInput.value = "";
  setWorking(true);

  try {
    await desktop.sendPrompt(text);
    pending.remove();
    if (!activeAssistantText?.textContent.trim() && !activeAssistantMessage.body.querySelector(".agent-activity")) {
      activeAssistantText.textContent = "Agent 已完成本轮处理。";
    }
  } catch (error) {
    pending.remove();
    if (!activeAssistantText?.textContent.trim()) activeAssistantText.textContent = error.message || "DevEco Agent 请求失败";
    activeAssistantMessage.row.classList.add("message-error");
    if (/401|unauthori[sz]ed|token[_ ]?refresh[_ ]?failed|token expired|not logged in|重新登录|重新验证/i.test(error.message || "")) {
      openManagement("accountPanel");
    }
  } finally {
    setWorking(false);
    void refreshSidebar();
    conversationView.scrollTop = conversationView.scrollHeight;
    taskInput.focus();
  }
}

taskInput.addEventListener("compositionstart", () => { inputIsComposing = true; });
taskInput.addEventListener("compositionend", () => { inputIsComposing = false; });
taskInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing || inputIsComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (event.repeat) return;
  if (event.ctrlKey) {
    taskInput.setRangeText("\n", taskInput.selectionStart, taskInput.selectionEnd, "end");
    taskInput.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (!isWorking && !isSubmitting && !isSidebarSwitching) document.querySelector("#composerForm").requestSubmit();
});

document.querySelector("#projectChip").addEventListener("click", selectWorkspace);
document.querySelector("#connectProject").addEventListener("click", selectWorkspace);
document.querySelector("#addProject").addEventListener("click", selectWorkspace);
document.querySelector("#openIdeButton").addEventListener("click", () => {
  showToast(workspacePath ? "DevEco Studio 工程联动将在下一阶段接入。" : "先选择一个 HarmonyOS 工程。");
});
document.querySelector("#attachButton").addEventListener("click", () => showToast("文件附件和上下文选择将在 Agent 主链路之后接入。"));
document.querySelector("#runtimeRetry").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  if (!desktop || isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy) return;
  button.disabled = true;
  try {
    if (workspacePath) await desktop.reconnectAgent();
    else await desktop.retryManagement();
  } catch (error) {
    setStatus({ state: "error", message: error.message || "重新连接失败" });
    showToast(error.message || "重新连接失败");
  } finally { button.disabled = false; }
});
document.querySelector("#filterProjects").addEventListener("click", () => { searchField.hidden = false; searchInput.focus(); });
document.querySelector("#sortSessions").addEventListener("click", () => {
  sessionsNewestFirst = !sessionsNewestFirst;
  document.querySelector("#sortSessions").title = sessionsNewestFirst ? "最新会话优先" : "最早会话优先";
  renderSidebarRows();
});

document.querySelector("#toggleArchivedSessions").addEventListener("click", async () => {
  if (isWorking || isSubmitting || isSidebarSwitching || configChoiceBusy) return;
  showArchivedSessions = !showArchivedSessions;
  sidebarReadError = null;
  sidebarSessions = [];
  renderSidebarRows();
  document.querySelector("#sessionEmptyState").textContent = "正在读取会话…";
  await refreshSidebar();
});
document.querySelector("#archiveSessionAction").addEventListener("click", () => manageSidebarSession(sessionMenuTarget?.archived ? "restore" : "archive"));
document.querySelector("#deleteSessionAction").addEventListener("click", () => manageSidebarSession("delete"));
sessionActionsPopover.addEventListener("keydown", (event) => {
  const buttons = [...sessionActionsPopover.querySelectorAll("button")];
  const index = buttons.indexOf(document.activeElement);
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closePopovers();
    sessionMenuButton?.focus({ preventScroll: true });
  }
  if (event.key === "Tab") {
    closePopovers();
    sessionMenuButton?.focus({ preventScroll: true });
  }
});
document.querySelector("#settingsButton").addEventListener("click", () => openManagement());
document.querySelector("#refreshEnvironment").addEventListener("click", loadEnvironmentState);
document.querySelector("#selectAgentExecutable").addEventListener("click", () => selectEnvironmentExecutable("agent"));
document.querySelector("#selectNodeExecutable").addEventListener("click", () => selectEnvironmentExecutable("node"));
document.querySelector("#closeManagement").addEventListener("click", () => {
  if (oauthFlowId) desktop.cancelOAuth(oauthFlowId).catch(() => {});
  else if (oauthFlowProvider) desktop.cancelOAuthProvider(oauthFlowProvider).catch(() => {});
  managementDialog.close();
});
managementDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (oauthFlowId) desktop.cancelOAuth(oauthFlowId).catch(() => {});
  else if (oauthFlowProvider) desktop.cancelOAuthProvider(oauthFlowProvider).catch(() => {});
  managementDialog.close();
});
managementNav.forEach((button) => button.addEventListener("click", () => setManagementPanel(button.dataset.panel)));
document.querySelector("#refreshAccount").addEventListener("click", loadAccountState);
document.querySelector("#huaweiLogin").addEventListener("click", () => beginHuaweiLogin(false));
document.querySelector("#huaweiLogout").addEventListener("click", async () => {
  if (isWorking) return showToast("请先停止当前任务，再退出 Huawei 账号。");
  const button = document.querySelector("#huaweiLogout");
  accountRefreshSequence += 1;
  accountRefreshInProgress = false;
  accountLogoutInProgress = true;
  syncHuaweiAccountActions();
  button.disabled = true;
  try {
    const state = await desktop.logoutHuawei();
    renderAccountState({ ...state, credentialCached: false, sessionState: "signed-out" });
    void refreshModelCatalog();
    showToast("已从 DevEco Code 退出 Huawei 账号");
  } catch (error) {
    showToast(error.message || "退出账号失败", 5000);
  } finally {
    accountLogoutInProgress = false;
    button.disabled = false;
    syncHuaweiAccountActions();
  }
});
document.querySelector("#cancelHuaweiAuth").addEventListener("click", cancelHuaweiLogin);
document.querySelector("#openRealName").addEventListener("click", async () => {
  try { await desktop.openRealNamePage(); }
  catch (error) { showToast(error.message || "官方认证页未能打开"); }
});
document.querySelector("#recheckRealName").addEventListener("click", () => beginHuaweiLogin(true));

document.querySelector("#refreshAgreement").addEventListener("click", loadAgreementState);
document.querySelector("#agreementConsent").addEventListener("change", () => {
  const consentChecked = document.querySelector("#agreementConsent").checked;
  document.querySelector("#acceptAgreement").disabled = !window.devecoManagementState.agreement(agreementState, consentChecked).canSubmit;
});
document.querySelector("#acceptAgreement").addEventListener("click", submitAgreementConsent);
document.querySelector("#openTerms").addEventListener("click", async () => {
  if (!agreementState?.termsUrl) return;
  try { await desktop.openLegalPage(agreementState.termsUrl); }
  catch (error) { showToast(error.message || "服务条款页未能打开"); }
});
document.querySelector("#openPrivacy").addEventListener("click", async () => {
  if (!agreementState?.privacyUrl) return;
  try { await desktop.openLegalPage(agreementState.privacyUrl); }
  catch (error) { showToast(error.message || "隐私声明页未能打开"); }
});
document.querySelectorAll('input[name="improvementConsentChoice"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const selected = document.querySelector('input[name="improvementConsentChoice"]:checked');
    document.querySelector("#savePrivacyPreference").disabled =
      !privacyState?.available || !privacyState?.revision || !selected || selected.value === privacyOriginalDecision;
  });
});
document.querySelector("#savePrivacyPreference").addEventListener("click", savePrivacyState);
for (const id of ["analyticsUploadEnabled", "crashUploadEnabled"]) {
  document.querySelector("#" + id).addEventListener("change", () => {
    const changed = document.querySelector("#analyticsUploadEnabled").checked !== devicePrivacyOriginal.analyticsEnabled ||
      document.querySelector("#crashUploadEnabled").checked !== devicePrivacyOriginal.crashUploadEnabled;
    document.querySelector("#saveDevicePrivacy").disabled = !devicePrivacyState?.available ||
      !devicePrivacyState?.revision || !changed;
  });
}
document.querySelector("#saveDevicePrivacy").addEventListener("click", saveDevicePrivacyState);

document.querySelector("#showProviderForm").addEventListener("click", () => showProviderEditor());
document.querySelector("#cancelProviderForm").addEventListener("click", () => {
  document.querySelector("#providerForm").hidden = true;
  document.querySelector("#showProviderForm").hidden = false;
  document.querySelector("#providerApiKey").value = "";
});
document.querySelector("#cancelProviderCredential").addEventListener("click", () => {
  closeNativeProviderForm();
});
document.querySelector("#providerCredentialForm").addEventListener("submit", saveNativeProviderCredential);
document.querySelector("#checkProviderConnection").addEventListener("click", checkProviderConnection);
document.querySelector("#toggleProviderKey").addEventListener("click", () => {
  const input = document.querySelector("#nativeProviderApiKey");
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  document.querySelector("#toggleProviderKey").setAttribute("aria-label", visible ? "隐藏 API Key" : "显示 API Key");
  document.querySelector("#toggleProviderKey .ui-icon").dataset.icon = visible ? "eye-slash" : "eye";
});
document.querySelector("#openProviderKey").addEventListener("click", async () => {
  if (!activeCredentialProvider || !desktop) return;
  try { await desktop.openProviderKeyPage(activeCredentialProvider); }
  catch { showToast("Key 管理页面未能打开。"); }
});
document.querySelector("#providerForm").addEventListener("submit", saveProviderForm);
document.querySelector("#providerAuthPromptCard").addEventListener("submit", submitProviderOAuth);
document.querySelector("#providerAuthCancel").addEventListener("click", cancelProviderOAuth);

document.querySelector("#configForm").addEventListener("submit", saveConfiguration);
document.querySelector("#defaultModelScope").addEventListener("change", () => {
  const projectOption = document.querySelector('#defaultModelScope option[value="project"]');
  projectOption.disabled = !workspacePath;
});
document.querySelector("#saveDefaultModel").addEventListener("click", saveCurrentModelAsDefault);

document.querySelector("#cancelButton").addEventListener("click", async () => {
  try { await desktop?.cancelPrompt(); } catch (error) { showToast(error.message || "停止请求失败"); }
});
document.querySelector("#permissionCancel").addEventListener("click", () => answerPermission(pendingPermission));
permissionDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  answerPermission(pendingPermission);
});
permissionDialog.addEventListener("close", () => {
  if (pendingPermission && permissionDialog.returnValue !== "answered") answerPermission(pendingPermission);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".control-wrap, .popover, .session-actions-button, .session-archive-open")) closePopovers();
});
document.addEventListener("keydown", (event) => {
  const isModifier = event.ctrlKey || event.metaKey;
  if (isModifier && event.key.toLowerCase() === "n") {
    event.preventDefault();
    document.querySelector("#newTaskButton").click();
  }
  if (isModifier && event.key.toLowerCase() === "k") {
    event.preventDefault();
    document.querySelector("#searchButton").click();
  }
  if (event.key === "Escape") {
    closePopovers();
    setMobileMenu(false);
  }
});

applyConfigOptions([]);
void initializeTheme();
void refreshModelCatalog();

if (desktop) {
  setStatus({ state: "connecting", message: "正在准备工作环境…" });
  desktop.onEvent(handleDesktopEvent);
  desktop.getState().then((state) => {
    desktopState = state;
    sidebarProjects = state.recentWorkspaces ?? [];
    updateWorkspace(state.workspacePath);
    if (state.state?.sessionId) registerSidebarSession(state.state);
    void refreshSidebar();
    setStatus(state.status);
    controlStatus = state.controlStatus;
    initializeManagement(state);
    void refreshRuntimeMetadata();
    if (!state.agentInstalled) setStatus({ state: "error", message: "内置 DevEco Code 运行时未就绪，请打开设置 → 运行环境重新检测" });
  }).catch((error) => showToast(error.message || "桌面状态读取失败"));
} else {
  setStatus({ state: "disconnected", message: "桌面 Agent 桥未启动" });
  document.querySelector("#composerCaption").textContent = "这是浏览器预览；运行 npm start 后可连接本机 DevEco Agent。";
}
