/*
 * Electron 主进程：负责窗口（透明 / 无边框 / 置顶 / 可穿透）、托盘、存档读写、日志。
 * 游戏逻辑全在渲染进程（renderer/game.js），主进程只管"窗口和文件"。
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  shell,
  Notification,
  globalShortcut,
  dialog,
  powerMonitor,
  safeStorage,
  clipboard,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { SAVE_MAX_BYTES, sanitizeSave } = require("./lib/save-schema");
const { sanitizeHitboxes, computeIgnore } = require("./lib/pointer");
const { sanitizeNotification } = require("./lib/notify");
const { QuizService } = require("./lib/quiz-api");
const { UpdaterService } = require("./lib/updater");
const { StickerStore } = require("./lib/sticker-store");
const { AiService } = require("./lib/ai-service");
const { SocialClient } = require("./lib/social-client");
const G = require("./renderer/game.js");
const { applyToolCommand } = require("./lib/tool-actions");

const WINDOW_SIZE = { width: 320, height: 360 };
// 答题窗口：独立、不透明、可拖动，避免撑大透明的宠物窗口
const QUIZ_WINDOW_SIZE = { width: 640, height: 720 };
const CHAT_WINDOW_SIZE = { width: 540, height: 720 };
const SOCIAL_WINDOW_SIZE = { width: 620, height: 720 };
const USER_DATA = app.getPath("userData");
const SAVE_FILE = path.join(USER_DATA, "save.json");
const SESSION_FILE = path.join(USER_DATA, "session.json");
const LOG_DIR = path.join(USER_DATA, "logs");
const LOG_FILE = path.join(LOG_DIR, "main.log");
const QUIZ_CACHE_FILE = path.join(USER_DATA, "quiz-cache.json");
const QUIZ_EXAM_FILE = path.join(USER_DATA, "quiz-exam.json");
const USER_STICKER_DIR = path.join(USER_DATA, "user-stickers");
const USER_STICKERS_FILE = path.join(USER_DATA, "user-stickers.json");
const AI_CONFIG_FILE = path.join(USER_DATA, "ai-config.json");
const AI_HISTORY_FILE = path.join(USER_DATA, "ai-history.json");
const SOCIAL_PROFILE_FILE = path.join(USER_DATA, "social-profile.json");
const TOOL_WINDOW_SPECS = {
  shop: { width: 620, height: 700, title: "doro 商城" },
  gacha: { width: 500, height: 520, title: "doro 扭蛋机" },
  minigame: { width: 620, height: 560, title: "doro 接金币" },
  sticker: { width: 640, height: 720, title: "doro 表情包管理" },
};
const LOG_MAX_BYTES = 1024 * 1024;
const DEV = process.argv.includes("--dev");
// 调试鼠标穿透时可以设 DORO_TRACE_HOVER=1，把每次穿透状态变化写进日志
const TRACE_HOVER = process.env.DORO_TRACE_HOVER === "1";

let win = null;
let quizWin = null;
let chatWin = null;
let socialWin = null;
const toolWindows = new Map();
let tray = null;
let saveTimer = null;
let crashedLastTime = false;
let sessionClosed = false;
let uiRestoreBounds = null;
let lastRenderReloadAt = 0;
let lastChatReloadAt = 0;
let systemWatchTimer = null;
let rendererCrashNotice = false;
const runtime = {
  alwaysOnTop: true,
  clickThrough: true,
  autoLaunch: false,
};

const quizService = new QuizService({
  cacheFile: QUIZ_CACHE_FILE,
  examFile: QUIZ_EXAM_FILE,
  log,
});
let updater = null;
let updateTimer = null;
let latestToolState = null;
let toolStateRevision = 0;
const stickerStore = new StickerStore({
  dir: USER_STICKER_DIR,
  manifestFile: USER_STICKERS_FILE,
  probeSize: (file) => {
    try {
      const image = nativeImage.createFromPath(file);
      return image.isEmpty() ? null : image.getSize();
    } catch (err) {
      return null;
    }
  },
  log,
});
const aiService = new AiService({
  configFile: AI_CONFIG_FILE,
  historyFile: AI_HISTORY_FILE,
  safeStorage,
  log,
});
const socialClient = new SocialClient({
  profileFile: SOCIAL_PROFILE_FILE,
  baseUrl: "http://192.168.0.193:9500",
  log,
});

/** 每天 08:00 自动检查一次更新；错过的日子不补检。 */
function scheduleDailyUpdateCheck() {
  if (updateTimer) clearTimeout(updateTimer);
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  updateTimer = setTimeout(() => {
    checkUpdateIfEnabled(false);
    scheduleDailyUpdateCheck();
  }, next.getTime() - now.getTime());
  if (updateTimer.unref) updateTimer.unref();
}

function settingsOfSave() {
  const save = readSave();
  return save && save.settings && typeof save.settings === "object" ? save.settings : {};
}

function checkUpdateIfEnabled(manual) {
  if (!updater) return { state: "error", message: "更新服务未初始化" };
  if (!manual && settingsOfSave().updateAutoCheck === false) return updater.snapshot();
  updater.check({ manual });
  return updater.snapshot();
}

function initUpdater() {
  const settings = settingsOfSave();
  updater = new UpdaterService({
    feedUrl: settings.updateFeedUrl,
    log,
    onStatus: (status) => {
      send("app:update-status", status);
      buildTrayMenu();
    },
  });
  updater.init();
  scheduleDailyUpdateCheck();
  // 启动后延迟检查，避免和窗口初始化抢资源
  setTimeout(() => checkUpdateIfEnabled(false), 20 * 1000);
}

/** 托盘里的更新菜单项：发现新版本 → 下载并安装。 */
function updateMenuItem() {
  const status = updater ? updater.snapshot() : { state: "error", message: "更新服务未初始化" };
  if (status.state === "available") {
    return {
      label: `发现新版本 v${status.version || ""}，点击更新`,
      click: async () => {
        await updater.download();
        if (updater.snapshot().state === "downloaded") updater.install();
      },
    };
  }
  if (status.state === "downloading") {
    return { label: `正在下载更新 ${status.percent || 0}%`, enabled: false };
  }
  if (status.state === "downloaded") {
    return { label: `重启并安装 v${status.version || ""}`, click: () => updater.install() };
  }
  if (status.state === "checking") {
    return { label: "正在检查更新…", enabled: false };
  }
  if (status.state === "dev") {
    return { label: "检查更新（开发模式）", click: () => checkUpdateIfEnabled(true) };
  }
  return {
    label: status.state === "error" ? "检查更新（上次失败，重试）" : "检查更新",
    click: () => checkUpdateIfEnabled(true),
  };
}

// 点击穿透的命中判定：渲染进程上报"哪些矩形区域需要接收鼠标"，
// 主进程轮询光标位置决定是否穿透。
// 不用 setIgnoreMouseEvents(..., {forward:true})：实测部分 Windows 环境完全
// 不转发 mousemove，会导致开启穿透后窗口再也点不动。
const pointerWatch = {
  hitboxes: [],
  timer: null,
  ignoring: null,
};

// ---------------------------------------------------------------- 日志
function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return "";
  }
}

/** 追加一行日志；超过 1MB 自动轮转成 main.log.1，失败时静默。 */
function log(level, message, extra) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}${extra === undefined ? "" : ` ${safeJson(extra)}`}\n`;
  if (DEV || level === "error") console.error(line.trim());
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch (err) {
    /* 日志本身失败不再抛错 */
  }
}

// ---------------------------------------------------------------- 会话 / 崩溃标记
function beginSession() {
  try {
    const raw = fs.readFileSync(SESSION_FILE, "utf8");
    const previous = JSON.parse(raw);
    crashedLastTime = Boolean(previous && previous.running);
  } catch (err) {
    crashedLastTime = false;
  }
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(
      SESSION_FILE,
      JSON.stringify({ running: true, startedAt: Date.now(), pid: process.pid }),
      "utf8"
    );
  } catch (err) {
    log("warn", "写会话标记失败", err.message);
  }
  if (crashedLastTime) log("warn", "检测到上次异常退出，本轮已保留存档");
  log("info", "启动", { version: app.getVersion(), crashedLastTime });
}

function endSession() {
  if (sessionClosed) return;
  sessionClosed = true;
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ running: false, endedAt: Date.now() }), "utf8");
  } catch (err) {
    /* 忽略 */
  }
}

// ---------------------------------------------------------------- 存档读写
function readSave() {
  try {
    const raw = fs.readFileSync(SAVE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    log("warn", "存档内容不是对象，按新档处理");
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      log("error", "读取存档失败", err.message);
      // 把坏档留一份现场，方便排查
      try {
        fs.copyFileSync(SAVE_FILE, `${SAVE_FILE}.broken-${Date.now()}`);
      } catch (copyErr) {
        /* 忽略 */
      }
    }
  }
  return null;
}

function writeSave(state) {
  let payload;
  try {
    payload = JSON.stringify(state, null, 2);
  } catch (err) {
    return { ok: false, error: "serialize-failed" };
  }
  if (Buffer.byteLength(payload, "utf8") > SAVE_MAX_BYTES) {
    log("warn", "拒绝写入超大存档", { bytes: payload.length });
    return { ok: false, error: "too-large" };
  }
  try {
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    const tmp = `${SAVE_FILE}.tmp`;
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, SAVE_FILE);
    return { ok: true, path: SAVE_FILE };
  } catch (err) {
    log("error", "写入存档失败", err.message);
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------- 窗口
function clampToWorkArea(x, y, size) {
  const box = size || WINDOW_SIZE;
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const area = display.workArea;
  // 至少保留 3/4 在屏幕内，避免把宠物拖到完全看不见的地方
  const maxX = area.x + area.width - box.width * 0.75;
  const minX = area.x - box.width * 0.25;
  const maxY = area.y + area.height - box.height * 0.75;
  const minY = area.y - box.height * 0.25;
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, x))),
    y: Math.round(Math.min(maxY, Math.max(minY, y))),
  };
}

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - WINDOW_SIZE.width - 40,
    y: area.y + area.height - WINDOW_SIZE.height - 20,
  };
}

function setClickThrough(enabled) {
  const next = Boolean(enabled);
  const changed = next !== runtime.clickThrough;
  runtime.clickThrough = next;
  if (!win) return runtime.clickThrough;
  // 悬停进出 doro 会让这个开关频繁翻转，只在真正变化时重建托盘菜单
  if (changed) buildTrayMenu();
  if (runtime.clickThrough) startPointerWatch();
  else stopPointerWatch();
  return runtime.clickThrough;
}

function applyIgnoreState(ignore) {
  if (!win || pointerWatch.ignoring === ignore) return;
  pointerWatch.ignoring = ignore;
  win.setIgnoreMouseEvents(ignore);
  if (TRACE_HOVER) log("debug", "clickThrough", { ignore });
  send("pet:cursor", { inside: !ignore });
}

function tickPointer() {
  if (!win) return;
  const ignore = computeIgnore({
    clickThrough: runtime.clickThrough,
    point: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    boxes: pointerWatch.hitboxes,
  });
  applyIgnoreState(ignore);
}

function startPointerWatch() {
  if (pointerWatch.timer) clearInterval(pointerWatch.timer);
  pointerWatch.ignoring = null;
  tickPointer();
  // 高频轮询，避免用户移动后立即点击时仍处于上一次的穿透状态。
  pointerWatch.timer = setInterval(tickPointer, 16);
}

function stopPointerWatch() {
  if (pointerWatch.timer) clearInterval(pointerWatch.timer);
  pointerWatch.timer = null;
  applyIgnoreState(false);
}

function setAlwaysOnTop(enabled) {
  runtime.alwaysOnTop = Boolean(enabled);
  if (win) {
    win.setAlwaysOnTop(runtime.alwaysOnTop, "screen-saver");
    if (runtime.alwaysOnTop) win.show();
  }
  buildTrayMenu();
  return runtime.alwaysOnTop;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function loadActionList() {
  const file = path.join(__dirname, "assets", "actions.json");
  const bundled = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(bundled) ? [...bundled, ...stickerStore.listActions()] : stickerStore.listActions();
}

function aiPetContext() {
  const state = latestToolState || readSave() || {};
  const personality = state.profile ? G.personalityOf(state) : { name: "温柔" };
  const intimacy = state.intimacy ? G.intimacyStatus(state) : { level: 1, name: "刚认识" };
  return {
    localTime: new Date().toLocaleString("zh-CN", { hour12: false }),
    weekday: new Date().toLocaleDateString("zh-CN", { weekday: "long" }),
    personality: personality.name,
    level: Number(state.level) || 1,
    mood: Math.round(Number(state.mood) || 0),
    satiety: Math.round(Number(state.satiety) || 0),
    intimacyLevel: intimacy.level,
    intimacyName: intimacy.name,
    coins: G.formatCoins(Number(state.coins) || 0),
    dnd: Boolean(state.settings && state.settings.dnd),
    systemIdleSeconds: powerMonitor.getSystemIdleTime(),
  };
}

function socialPublicContext() {
  const state = latestToolState || readSave() || {};
  const personality = state.profile ? G.personalityOf(state) : { name: "温柔" };
  const intimacy = state.intimacy ? G.intimacyStatus(state) : { name: "初次见面" };
  return {
    level: Number(state.level) || 1,
    personality: personality.name,
    intimacyName: intimacy.name,
  };
}

function broadcastToolWindows(channel, payload, exceptWebContents) {
  toolWindows.forEach((toolWin) => {
    if (!toolWin || toolWin.isDestroyed()) return;
    if (exceptWebContents && toolWin.webContents === exceptWebContents) return;
    toolWin.webContents.send(channel, payload);
  });
}

function notifyToolWindowState() {
  send("pet:tool-window-state", { openTools: [...toolWindows.keys()] });
}

/** 统一走这里设置窗口位置：挡掉 NaN / 非整数，失败只记日志不抛给渲染层。 */
function safeSetPosition(x, y) {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pos = { x: Math.round(x), y: Math.round(y) };
  try {
    win.setPosition(pos.x, pos.y, false);
    return pos;
  } catch (err) {
    log("warn", "设置窗口位置失败", { ...pos, error: err.message });
    return null;
  }
}

function summonToCursor() {
  if (!win) return null;
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  const bounds = win.getBounds();
  const x = Math.max(
    area.x + 8,
    Math.min(area.x + area.width - bounds.width - 8, point.x - bounds.width / 2)
  );
  const y = Math.max(
    area.y + 8,
    Math.min(area.y + area.height - bounds.height - 8, point.y - bounds.height * 0.6)
  );
  win.showInactive();
  safeSetPosition(x, y);
  return { x, y };
}

function createWindow() {
  const saved = readSave();
  const savedWindow = (saved && saved.window) || {};
  const fallback = defaultPosition();
  const pos = clampToWorkArea(
    Number.isFinite(savedWindow.x) ? savedWindow.x : fallback.x,
    Number.isFinite(savedWindow.y) ? savedWindow.y : fallback.y
  );

  win = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    title: "doro",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(runtime.alwaysOnTop, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setMenuBarVisibility(false);
  const panelArg = process.argv.find((arg) => arg.startsWith("--panel="));
  const themeArg = process.argv.find((arg) => arg.startsWith("--theme="));
  const query = {};
  if (panelArg) query.panel = panelArg.split("=")[1];
  if (themeArg) query.theme = themeArg.split("=")[1];
  win.loadFile(
    path.join(__dirname, "renderer", "index.html"),
    Object.keys(query).length ? { query } : undefined
  );

  win.once("ready-to-show", () => {
    win.showInactive();
    const settings = (saved && saved.settings) || {};
    setAlwaysOnTop(settings.alwaysOnTop !== false);
    setClickThrough(settings.clickThrough !== false);
  });

  win.on("moved", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send("pet:window-moved", win.getBounds()), 400);
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    log("error", "渲染进程异常退出", details);
    if (details.reason === "clean-exit") return;
    const now = Date.now();
    if (now - lastRenderReloadAt > 60000) {
      lastRenderReloadAt = now;
      rendererCrashNotice = true;
      log("warn", "渲染进程崩溃，1 秒后自动重载");
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.reload();
      }, 1000);
    }
  });
  win.webContents.on("did-finish-load", () => {
    if (!rendererCrashNotice) return;
    rendererCrashNotice = false;
    send("pet:notice", { text: "刚刚卡了一下，已经恢复" });
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    log("error", "preload 加载失败", { preloadPath, message: error.message });
  });

  win.on("closed", () => {
    win = null;
  });

  if (DEV) win.webContents.openDevTools({ mode: "detach" });
}

function toggleWindow() {
  if (!win) return createWindow();
  if (win.isVisible()) {
    win.hide();
  } else {
    win.showInactive();
  }
  buildTrayMenu();
}

// ---------------------------------------------------------------- 答题窗口
function createQuizWindow(mode) {
  log("info", "创建答题窗口", { mode: mode || "home" });
  if (quizWin && !quizWin.isDestroyed()) {
    quizWin.show();
    quizWin.focus();
    if (mode) quizWin.webContents.send("quiz-window:command", { mode });
    return quizWin;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(QUIZ_WINDOW_SIZE.width, area.width - 40);
  const height = Math.min(QUIZ_WINDOW_SIZE.height, area.height - 40);
  quizWin = new BrowserWindow({
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#fff7f2",
    title: "doro 题库",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  quizWin.setAlwaysOnTop(true, "floating");
  quizWin.setMenuBarVisibility(false);
  quizWin.webContents.on("did-finish-load", () => log("info", "答题窗口加载完成"));
  quizWin.webContents.on("did-fail-load", (_e, code, description, url) => {
    log("error", "答题窗口加载失败", { code, description, url });
  });
  quizWin.loadFile(
    path.join(__dirname, "renderer", "quiz-window.html"),
    mode ? { query: { mode: String(mode) } } : undefined
  );
  quizWin.once("ready-to-show", () => {
    if (!quizWin) return;
    quizWin.show();
    quizWin.focus();
    log("info", "答题窗口 ready", {
      bounds: quizWin.getBounds(),
      visible: quizWin.isVisible(),
      onTop: quizWin.isAlwaysOnTop(),
    });
    if (mode) quizWin.webContents.send("quiz-window:command", { mode });
  });
  quizWin.on("closed", () => {
    quizWin = null;
    send("quiz:state", { open: false });
  });
  send("quiz:state", { open: true });
  return quizWin;
}

// ---------------------------------------------------------------- AI 聊天窗口
function isChatWindowSender(event) {
  return Boolean(
    chatWin && !chatWin.isDestroyed() && event && event.sender && event.sender === chatWin.webContents
  );
}

function createChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.show();
    chatWin.focus();
    return chatWin;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(CHAT_WINDOW_SIZE.width, area.width - 40);
  const height = Math.min(CHAT_WINDOW_SIZE.height, area.height - 40);
  chatWin = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(420, width),
    minHeight: Math.min(520, height),
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#fff8f5",
    title: "和 doro 聊天",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.setAlwaysOnTop(true, "floating");
  chatWin.setMenuBarVisibility(false);
  chatWin.webContents.on("did-finish-load", () => log("info", "AI 聊天窗口加载完成"));
  chatWin.webContents.on("did-fail-load", (_event, code, description, url) => {
    log("error", "AI 聊天窗口加载失败", { code, description, url });
  });
  chatWin.webContents.on("render-process-gone", (_event, details) => {
    log("error", "AI 聊天窗口渲染进程退出", details);
    if (details.reason === "clean-exit") return;
    const now = Date.now();
    if (now - lastChatReloadAt > 60000) {
      lastChatReloadAt = now;
      setTimeout(() => {
        if (chatWin && !chatWin.isDestroyed()) chatWin.reload();
      }, 1000);
    }
  });
  chatWin.loadFile(path.join(__dirname, "renderer", "chat-window.html"));
  chatWin.once("ready-to-show", () => {
    if (!chatWin || chatWin.isDestroyed()) return;
    chatWin.show();
    chatWin.focus();
  });
  chatWin.on("closed", () => {
    chatWin = null;
  });
  return chatWin;
}

function isSocialWindowSender(event) {
  return Boolean(socialWin && !socialWin.isDestroyed() && event && event.sender === socialWin.webContents);
}

function createSocialWindow() {
  if (socialWin && !socialWin.isDestroyed()) {
    socialWin.show();
    socialWin.focus();
    return socialWin;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(SOCIAL_WINDOW_SIZE.width, area.width - 40);
  const height = Math.min(SOCIAL_WINDOW_SIZE.height, area.height - 40);
  socialWin = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(480, width),
    minHeight: Math.min(560, height),
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    frame: false,
    resizable: true,
    maximizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#fff8f5",
    title: "doro 好友与资料",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  socialWin.setAlwaysOnTop(true, "floating");
  socialWin.setMenuBarVisibility(false);
  socialWin.webContents.on("did-fail-load", (_event, code, description, url) => {
    log("error", "好友窗口加载失败", { code, description, url });
  });
  socialWin.loadFile(path.join(__dirname, "renderer", "social-window.html"));
  socialWin.once("ready-to-show", () => {
    if (!socialWin || socialWin.isDestroyed()) return;
    socialWin.show();
    socialWin.focus();
  });
  socialWin.on("closed", () => {
    socialWin = null;
  });
  return socialWin;
}

// ---------------------------------------------------------------- 独立工具窗口
function createToolWindow(tool, options) {
  const spec = TOOL_WINDOW_SPECS[tool];
  if (!spec) return null;
  const existing = toolWindows.get(tool);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    if (options && options.tab) {
      existing.webContents.send("tool-window:command", { tab: options.tab });
    }
    return existing;
  }

  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(spec.width, area.width - 40);
  const height = Math.min(spec.height, area.height - 40);
  const cascade = (toolWindows.size % 5) * 24;
  const toolWin = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(460, width),
    minHeight: Math.min(400, height),
    x: area.x + Math.round((area.width - width) / 2) + cascade,
    y: area.y + Math.round((area.height - height) / 2) + cascade,
    frame: false,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#fff7f2",
    title: spec.title,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toolWindows.set(tool, toolWin);
  toolWin.setAlwaysOnTop(true, "floating");
  toolWin.setMenuBarVisibility(false);
  toolWin.webContents.on("did-finish-load", () => log("info", "工具窗口加载完成", { tool }));
  toolWin.webContents.on("did-fail-load", (_event, code, description, url) => {
    log("error", "工具窗口加载失败", { tool, code, description, url });
  });
  toolWin.webContents.on("render-process-gone", (_event, details) => {
    log("error", "工具窗口渲染进程退出", { tool, details });
  });
  toolWin.loadFile(path.join(__dirname, "renderer", "tool-window.html"), {
    query: { tool, ...(options && options.tab ? { tab: String(options.tab) } : {}) },
  });
  toolWin.once("ready-to-show", () => {
    if (toolWin.isDestroyed()) return;
    toolWin.show();
    toolWin.focus();
    if (options && options.tab) {
      toolWin.webContents.send("tool-window:command", { tab: options.tab });
    }
    log("info", "工具窗口 ready", { tool, bounds: toolWin.getBounds() });
  });
  toolWin.on("closed", () => {
    if (toolWindows.get(tool) === toolWin) toolWindows.delete(tool);
    notifyToolWindowState();
  });
  notifyToolWindowState();
  return toolWin;
}

// ---------------------------------------------------------------- 托盘
function buildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: win && win.isVisible() ? "先躲起来" : "出来玩", click: toggleWindow },
    { type: "separator" },
    { label: "和 doro 聊天（Ctrl+Alt+C）", click: () => createChatWindow() },
    { label: "好友与个人资料", click: () => createSocialWindow() },
    { label: "喂饭（20 金币）", click: () => send("pet:command", "feed") },
    { label: "陪玩（30 金币）", click: () => send("pet:command", "play") },
    { label: "叫它过来（Ctrl+Alt+R）", click: summonToCursor },
    { label: "换个动作", click: () => send("pet:command", "next-action") },
    { label: "搬砖升级", click: () => send("pet:command", "upgrade") },
    { type: "separator" },
    {
      label: "窗口置顶",
      type: "checkbox",
      checked: runtime.alwaysOnTop,
      click: (item) => {
        setAlwaysOnTop(item.checked);
        send("pet:settings", { alwaysOnTop: runtime.alwaysOnTop });
      },
    },
    {
      label: "点击穿透（只在 doro 身上响应鼠标）",
      type: "checkbox",
      checked: runtime.clickThrough,
      click: (item) => {
        setClickThrough(item.checked);
        send("pet:settings", { clickThrough: runtime.clickThrough });
      },
    },
    {
      label: "开机自动启动",
      type: "checkbox",
      checked: runtime.autoLaunch,
      click: (item) => {
        runtime.autoLaunch = item.checked;
        app.setLoginItemSettings({ openAtLogin: runtime.autoLaunch, args: [] });
        send("pet:settings", { autoLaunch: runtime.autoLaunch });
        buildTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "回到默认位置",
      click: () => {
        if (!win) return;
        const pos = defaultPosition();
        safeSetPosition(pos.x, pos.y);
      },
    },
    { label: "打开存档文件夹", click: () => shell.showItemInFolder(SAVE_FILE) },
    { label: "打开日志", click: () => shell.openPath(LOG_FILE) },
    { type: "separator" },
    updateMenuItem(),
    { type: "separator" },
    {
      label: "退出 doro",
      click: () => {
        send("pet:command", "quit");
        setTimeout(() => app.quit(), 350);
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip("doro 桌面宠物");
}

function createTray() {
  const iconPath = path.join(__dirname, "assets", "icons", "tray.ico");
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty())
    image = nativeImage.createFromPath(path.join(__dirname, "assets", "icons", "tray.png"));
  tray = new Tray(image);
  tray.on("click", toggleWindow);
  tray.on("double-click", toggleWindow);
  buildTrayMenu();
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle("pet:load", () => {
    const save = readSave();
    const login = app.getLoginItemSettings();
    runtime.autoLaunch = Boolean(login.openAtLogin);
    const settings = save && save.settings && typeof save.settings === "object" ? save.settings : {};
    quizService.configure({ baseUrl: settings.quizApiBase });
    if (updater && settings.updateFeedUrl) updater.setFeedUrl(settings.updateFeedUrl);
    return {
      save,
      now: Date.now(),
      autoLaunch: runtime.autoLaunch,
      savePath: SAVE_FILE,
      logPath: LOG_FILE,
      crashedLastTime,
      version: app.getVersion(),
      quiz: quizService.status(),
    };
  });

  ipcMain.handle("pet:save", (_event, state, meta) => {
    if (meta && Number.isFinite(Number(meta.revision)) && Number(meta.revision) < toolStateRevision) {
      return { ok: false, error: "stale-state" };
    }
    const clean = sanitizeSave(state);
    if (!clean) {
      log("warn", "拒绝写入非法存档");
      return { ok: false, error: "invalid-save" };
    }
    quizService.configure({ baseUrl: clean.settings.quizApiBase });
    if (updater) updater.setFeedUrl(clean.settings.updateFeedUrl);
    const result = writeSave(clean);
    if (result.ok) {
      latestToolState = clean;
      broadcastToolWindows("tool:state", {
        save: clean,
        now: Date.now(),
        revision: toolStateRevision,
        source: "pet-save",
      });
    }
    return result;
  });

  // ---- AI 聊天（密钥、上下文与网络留在主进程） -------------------------
  ipcMain.handle("ai:status", (event) =>
    isChatWindowSender(event) ? aiService.status() : { configured: false, error: "unauthorized" }
  );
  ipcMain.handle("ai:config-get", (event) =>
    isChatWindowSender(event) ? aiService.publicConfig() : { error: "unauthorized" }
  );
  ipcMain.handle("ai:config-save", (event, config) =>
    isChatWindowSender(event) ? aiService.updateConfig(config) : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("ai:history", (event) => (isChatWindowSender(event) ? aiService.publicHistory() : []));
  ipcMain.handle("ai:clear-history", (event) =>
    isChatWindowSender(event) ? aiService.clearHistory() : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("ai:open", () => {
    createChatWindow();
    return true;
  });
  ipcMain.handle("ai:close", (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (owner && owner === chatWin) owner.close();
    return true;
  });
  ipcMain.handle("ai:chat", async (event, payload) => {
    if (!isChatWindowSender(event)) return { ok: false, error: "unauthorized" };
    const message = payload && typeof payload.message === "string" ? payload.message : "";
    if (!message.trim()) return { ok: false, error: "empty-message" };
    try {
      const result = await aiService.chat({
        message,
        context: aiPetContext(),
      });
      if (result.ok && isChatWindowSender(event)) {
        send("pet:ai-intent", { intent: result.intent, source: "chat" });
      }
      return result;
    } catch (err) {
      log("error", "AI 聊天处理失败", err && err.stack ? err.stack : String(err));
      return { ok: false, error: "internal" };
    }
  });

  // ---- 局域网好友与个人资料 ---------------------------------------------
  ipcMain.handle("social:open", () => {
    createSocialWindow();
    return true;
  });
  ipcMain.handle("social:snapshot", (event) =>
    isSocialWindowSender(event) ? socialClient.snapshot() : { configured: false, error: "unauthorized" }
  );
  ipcMain.handle("social:setup", async (event, payload) => {
    if (!isSocialWindowSender(event)) return { ok: false, error: "unauthorized" };
    const urlResult = socialClient.setServerUrl(payload && payload.serverUrl);
    if (!urlResult.ok && urlResult.error !== "already-registered") return urlResult;
    return socialClient.register({
      ...(payload || {}),
      ...socialPublicContext(),
    });
  });
  ipcMain.handle("social:get", (event) =>
    isSocialWindowSender(event) ? socialClient.social() : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:update", (event, payload) =>
    isSocialWindowSender(event)
      ? socialClient.updateProfile({ ...(payload || {}), ...socialPublicContext() })
      : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:search", (event, query) =>
    isSocialWindowSender(event) ? socialClient.search(query) : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:request", (event, payload) =>
    isSocialWindowSender(event)
      ? socialClient.requestFriend(payload && payload.targetId, payload && payload.message)
      : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:respond", (event, payload) =>
    isSocialWindowSender(event)
      ? socialClient.respondFriend(payload && payload.requestId, payload && payload.accept)
      : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:remove", (event, friendId) =>
    isSocialWindowSender(event) ? socialClient.removeFriend(friendId) : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:presence", (event, online) =>
    isSocialWindowSender(event)
      ? socialClient.presence(Boolean(online))
      : { ok: false, error: "unauthorized" }
  );
  ipcMain.handle("social:copy", (event, text) => {
    if (!isSocialWindowSender(event)) return false;
    clipboard.writeText(String(text || "").slice(0, 100));
    return true;
  });
  ipcMain.handle("social:close", (event) => {
    if (socialWin && BrowserWindow.fromWebContents(event.sender) === socialWin) socialWin.close();
    return true;
  });

  // ---- 题库（网络与判卷都在主进程） ------------------------------------
  ipcMain.handle("quiz:exams", async (_event, options) => {
    try {
      return await quizService.listExams({ force: Boolean(options && options.force) });
    } catch (err) {
      log("warn", "获取题库科目失败", err.message);
      return { error: err.code || "OFFLINE", message: err.message };
    }
  });

  ipcMain.handle("quiz:create", async (_event, payload) => {
    try {
      return await quizService.createSession(payload || {});
    } catch (err) {
      log("warn", "创建答题会话失败", err.message);
      return { error: err.code || "FAILED", message: err.message };
    }
  });

  ipcMain.handle("quiz:answer", (_event, payload) => {
    try {
      return quizService.gradeAnswer(
        payload && payload.token,
        payload && payload.questionId,
        payload && payload.choice
      );
    } catch (err) {
      log("warn", "单题判卷失败", err.message);
      return { error: err.code || "FAILED", message: err.message };
    }
  });

  ipcMain.handle("quiz:grade", (_event, payload) => {
    try {
      return quizService.grade(payload && payload.token, payload && payload.answers);
    } catch (err) {
      log("warn", "答题判卷失败", err.message);
      return { error: err.code || "FAILED", message: err.message };
    }
  });

  ipcMain.handle("quiz:exam-status", () => quizService.examStatus());

  ipcMain.handle("quiz:exam-resume", () => {
    try {
      return quizService.resumeExam();
    } catch (err) {
      return { error: err.code || "NO_EXAM", message: err.message };
    }
  });

  ipcMain.handle("quiz:exam-abandon", () => quizService.abandonExam());

  // ---- 独立答题窗口 ----------------------------------------------------
  ipcMain.handle("quiz-ui:open", (_event, payload) => {
    createQuizWindow(payload && payload.mode);
    return true;
  });

  ipcMain.handle("quiz-ui:snapshot", () => ({ save: readSave(), now: Date.now() }));

  ipcMain.handle("quiz-ui:apply", (_event, payload) => {
    if (!payload || typeof payload !== "object") return false;
    send("pet:quiz-apply", payload);
    return true;
  });

  ipcMain.handle("quiz-ui:speak", (_event, payload) => {
    if (!payload || typeof payload !== "object") return false;
    send("pet:quiz-speak", {
      text: String(payload.text || "").slice(0, 80),
      ms: Math.min(8000, Math.max(600, Number(payload.ms) || 2000)),
    });
    return true;
  });

  ipcMain.handle("quiz-ui:resize", (_event, size) => {
    if (!quizWin || !size || typeof size !== "object") return null;
    const bounds = quizWin.getBounds();
    const area = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }).workArea;
    const width = Math.min(Math.max(520, Math.round(Number(size.width) || 640)), area.width - 20);
    const height = Math.min(Math.max(480, Math.round(Number(size.height) || 640)), area.height - 20);
    const x = Math.min(Math.max(area.x + 10, bounds.x), area.x + area.width - width - 10);
    const y = Math.min(Math.max(area.y + 10, bounds.y), area.y + area.height - height - 10);
    quizWin.setBounds({ x, y, width, height });
    return quizWin.getBounds();
  });

  ipcMain.handle("quiz-ui:close", () => {
    if (quizWin) quizWin.close();
    return true;
  });

  // ---- 应用更新 --------------------------------------------------------
  ipcMain.handle("app:update-check", (_event, feedUrl) => {
    if (updater && feedUrl) updater.setFeedUrl(feedUrl);
    return checkUpdateIfEnabled(true);
  });
  ipcMain.handle("app:update-download", async () => (updater ? updater.download() : null));
  ipcMain.handle("app:update-install", () => (updater ? updater.install() : false));
  ipcMain.handle("app:update-status", () => (updater ? updater.snapshot() : null));

  ipcMain.handle("pet:actions", () => {
    try {
      return loadActionList();
    } catch (err) {
      log("error", "读取动作清单失败", err.message);
      return [];
    }
  });

  // ---- 用户表情包（增 / 删 / 查） --------------------------------------
  ipcMain.handle("sticker:import", async () => {
    if (!win) return { ok: false, message: "宠物窗口未就绪" };
    const result = await dialog.showOpenDialog(win, {
      title: "导入表情包",
      buttonLabel: "导入",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "表情包图片", extensions: ["gif", "webp", "png", "apng", "jpg", "jpeg"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const imported = stickerStore.importFiles(result.filePaths);
    log("info", "导入表情包", {
      added: imported.added.map((item) => item.name),
      skipped: imported.skipped.length,
    });
    if (imported.added.length) {
      send("pet:actions-changed", {});
      broadcastToolWindows("tool:actions-changed", {});
    }
    return { ok: true, ...imported };
  });

  ipcMain.handle("sticker:delete", (_event, name) => {
    const ok = stickerStore.remove(name);
    if (ok) {
      log("info", "删除表情包", name);
      send("pet:actions-changed", {});
      broadcastToolWindows("tool:actions-changed", {});
    }
    return { ok };
  });

  ipcMain.handle("sticker:reveal", () => {
    fs.mkdirSync(USER_STICKER_DIR, { recursive: true });
    shell.openPath(USER_STICKER_DIR);
    return true;
  });

  // ---- 独立工具窗口：商城 / 扭蛋机 / 接金币 / 表情包 -------------------
  ipcMain.handle("tool:open", (_event, payload) => {
    const tool = payload && String(payload.tool || "");
    createToolWindow(tool, { tab: payload && payload.tab });
    return { ok: Boolean(TOOL_WINDOW_SPECS[tool]) };
  });

  ipcMain.handle("tool:snapshot", () => {
    const saved = latestToolState || sanitizeSave(readSave()) || G.freshState(Date.now());
    return {
      save: saved,
      actions: loadActionList(),
      now: Date.now(),
      revision: toolStateRevision,
    };
  });

  ipcMain.on("tool:live-state", (event, payload) => {
    if (!win || event.sender !== win.webContents || !payload) return;
    const clean = sanitizeSave(payload.state);
    if (!clean) return;
    const revision = Number(payload.revision) || 0;
    if (revision < toolStateRevision) return;
    latestToolState = clean;
    broadcastToolWindows("tool:state", {
      save: clean,
      now: Date.now(),
      revision,
      source: "pet-live",
    });
  });

  ipcMain.handle("tool:command", (event, payload) => {
    const tool = payload && String(payload.tool || "");
    const command = payload && payload.command;
    const owner = toolWindows.get(tool);
    if (!owner || owner.isDestroyed() || owner.webContents !== event.sender) {
      return { ok: false, error: "invalid-window" };
    }

    const base = latestToolState || sanitizeSave(readSave()) || G.freshState(Date.now());
    let actions = loadActionList();
    let effectiveCommand = command;
    let actionsChanged = false;
    if (tool === "sticker" && command && command.type === "delete") {
      const name = String(command.name || "");
      if (!stickerStore.remove(name)) return { ok: false, error: "delete-failed" };
      actions = loadActionList();
      actionsChanged = true;
      effectiveCommand = { type: "forget", name };
    }

    const now = Date.now();
    const applied = applyToolCommand(base, actions, tool, effectiveCommand, now);
    if (!applied.ok) return applied;
    const clean = sanitizeSave(applied.state);
    if (!clean) return { ok: false, error: "invalid-state" };
    const written = writeSave(clean);
    if (!written.ok) return written;

    toolStateRevision += 1;
    latestToolState = clean;
    actions = loadActionList();
    const statePayload = {
      save: clean,
      actions,
      now,
      revision: toolStateRevision,
      source: "tool-command",
    };
    send("pet:tool-state", statePayload);
    broadcastToolWindows("tool:state", statePayload, event.sender);
    if (actionsChanged) {
      send("pet:actions-changed", {});
      broadcastToolWindows("tool:actions-changed", {}, event.sender);
    }
    return {
      ...applied,
      state: clean,
      save: clean,
      actions,
      revision: toolStateRevision,
      now,
      message:
        effectiveCommand && effectiveCommand.type === "forget" ? "已删除自定义表情包" : applied.message,
    };
  });

  ipcMain.handle("tool:speak", (_event, payload) => {
    const text = payload && typeof payload.text === "string" ? payload.text.slice(0, 120) : "";
    if (!text) return false;
    send("pet:tool-speak", { text, ms: Math.min(5000, Math.max(600, Number(payload.ms) || 2000)) });
    return true;
  });

  ipcMain.handle("tool:close", (event) => {
    const toolWin = BrowserWindow.fromWebContents(event.sender);
    if (toolWin && toolWin !== win) toolWin.close();
    return true;
  });

  ipcMain.handle("win:get-bounds", () => (win ? win.getBounds() : null));

  ipcMain.handle("screen:get-work-area", () => {
    if (!win) return screen.getPrimaryDisplay().workArea;
    const bounds = win.getBounds();
    return screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    }).workArea;
  });

  ipcMain.handle("screen:get-cursor", () => screen.getCursorScreenPoint());
  ipcMain.handle("win:summon", () => summonToCursor());

  ipcMain.handle("pet:hitboxes", (_event, boxes) => {
    pointerWatch.hitboxes = sanitizeHitboxes(boxes);
    tickPointer();
    return true;
  });

  ipcMain.handle("win:set-position", (_event, pos) => {
    if (!win || !pos || typeof pos !== "object") return null;
    const x = Number(pos.x);
    const y = Number(pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const next = clampToWorkArea(x, y);
    return safeSetPosition(next.x, next.y);
  });

  ipcMain.handle("win:set-ui-size", (_event, size) => {
    if (!win || !size || typeof size !== "object") return null;
    const width = Math.round(Number(size.width));
    const height = Math.round(Number(size.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    const previous = win.getBounds();
    const next = {
      width: Math.min(900, Math.max(WINDOW_SIZE.width, width)),
      height: Math.min(700, Math.max(WINDOW_SIZE.height, height)),
    };
    win.setSize(next.width, next.height, false);
    if (next.width > WINDOW_SIZE.width) {
      // 展开面板时整块窗口必须留在工作区内，否则底部的按钮会被任务栏/屏幕边缘挡住
      if (!uiRestoreBounds) uiRestoreBounds = previous;
      const bounds = win.getBounds();
      const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
      const x = Math.min(bounds.x, area.x + area.width - bounds.width - 8);
      const y = Math.min(bounds.y, area.y + area.height - bounds.height - 8);
      safeSetPosition(Math.max(area.x + 8, x), Math.max(area.y + 8, y));
    } else if (uiRestoreBounds) {
      win.setBounds(uiRestoreBounds);
      uiRestoreBounds = null;
    }
    return win.getBounds();
  });

  ipcMain.handle("win:set-click-through", (_event, enabled) => setClickThrough(enabled));
  ipcMain.handle("win:set-always-on-top", (_event, enabled) => setAlwaysOnTop(enabled));

  ipcMain.handle("win:set-auto-launch", (_event, enabled) => {
    runtime.autoLaunch = Boolean(enabled);
    app.setLoginItemSettings({ openAtLogin: runtime.autoLaunch, args: [] });
    buildTrayMenu();
    return runtime.autoLaunch;
  });

  ipcMain.handle("app:log", (_event, entry) => {
    const level = entry && typeof entry.level === "string" ? entry.level : "info";
    const allowed = ["debug", "info", "warn", "error"];
    const message = entry && typeof entry.message === "string" ? entry.message.slice(0, 4000) : "";
    if (!message) return false;
    const extra = entry && typeof entry.extra === "string" ? entry.extra.slice(0, 4000) : undefined;
    log(allowed.includes(level) ? level : "info", `[renderer] ${message}`, extra);
    return true;
  });

  ipcMain.handle("app:notify", (_event, payload) => {
    const clean = sanitizeNotification(payload);
    if (!clean || !Notification.isSupported()) return false;
    const notification = new Notification({
      title: clean.title,
      body: clean.body,
      icon: path.join(__dirname, "assets", "icons", "tray.png"),
    });
    notification.on("click", () => {
      if (!win) return;
      win.showInactive();
      win.setAlwaysOnTop(runtime.alwaysOnTop, "screen-saver");
    });
    notification.show();
    return true;
  });

  ipcMain.handle("app:quit", () => {
    app.quit();
    return true;
  });

  ipcMain.handle("app:open-save-folder", () => {
    shell.showItemInFolder(SAVE_FILE);
    return true;
  });

  ipcMain.handle("app:open-log", () => {
    shell.openPath(LOG_FILE);
    return true;
  });

  ipcMain.handle("app:reset-position", () => {
    if (!win) return null;
    const pos = defaultPosition();
    safeSetPosition(pos.x, pos.y);
    return pos;
  });
}

// ---------------------------------------------------------------- 生命周期
process.on("uncaughtException", (err) => {
  log("error", "主进程未捕获异常", err && err.stack ? err.stack : String(err));
});
process.on("unhandledRejection", (reason) => {
  log("error", "主进程未处理的 Promise 拒绝", reason && reason.stack ? reason.stack : String(reason));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      win.showInactive();
      win.setAlwaysOnTop(runtime.alwaysOnTop, "screen-saver");
    }
  });

  app.whenReady().then(() => {
    beginSession();
    registerIpc();
    createWindow();
    initUpdater();
    createTray();
    if (systemWatchTimer) clearInterval(systemWatchTimer);
    systemWatchTimer = setInterval(() => {
      send("pet:system-idle", { seconds: powerMonitor.getSystemIdleTime() });
    }, 5000);
    const quizArg = process.argv.find((arg) => arg.startsWith("--quiz="));
    if (quizArg) setTimeout(() => createQuizWindow(quizArg.split("=")[1]), 1200);
    const toolArg = process.argv.find((arg) => arg.startsWith("--tool="));
    if (toolArg && TOOL_WINDOW_SPECS[toolArg.split("=")[1]]) {
      setTimeout(() => createToolWindow(toolArg.split("=")[1]), 1200);
    }
    if (process.argv.includes("--chat")) setTimeout(() => createChatWindow(), 1200);
    if (process.argv.includes("--social")) setTimeout(() => createSocialWindow(), 1200);
    const shortcutToggle = globalShortcut.register("CommandOrControl+Alt+D", () => toggleWindow());
    const shortcutSummon = globalShortcut.register("CommandOrControl+Alt+R", () => summonToCursor());
    const shortcutChat = globalShortcut.register("CommandOrControl+Alt+C", () => createChatWindow());
    log("info", "注册全局快捷键", {
      toggle: shortcutToggle,
      summon: shortcutSummon,
      chat: shortcutChat,
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (win) win.showInactive();
    });
  });

  app.on("window-all-closed", () => {
    // 托盘宠物：关掉窗口就等于退出
    app.quit();
  });

  app.on("before-quit", () => {
    send("pet:command", "before-quit");
    endSession();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (updateTimer) clearTimeout(updateTimer);
    if (systemWatchTimer) clearInterval(systemWatchTimer);
  });
}
