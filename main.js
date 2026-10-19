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
} = require("electron");
const fs = require("fs");
const path = require("path");
const { SAVE_MAX_BYTES, sanitizeSave } = require("./lib/save-schema");
const { sanitizeHitboxes, computeIgnore } = require("./lib/pointer");
const { sanitizeNotification } = require("./lib/notify");

const WINDOW_SIZE = { width: 320, height: 360 };
const USER_DATA = app.getPath("userData");
const SAVE_FILE = path.join(USER_DATA, "save.json");
const SESSION_FILE = path.join(USER_DATA, "session.json");
const LOG_DIR = path.join(USER_DATA, "logs");
const LOG_FILE = path.join(LOG_DIR, "main.log");
const LOG_MAX_BYTES = 1024 * 1024;
const DEV = process.argv.includes("--dev");
// 调试鼠标穿透时可以设 DORO_TRACE_HOVER=1，把每次穿透状态变化写进日志
const TRACE_HOVER = process.env.DORO_TRACE_HOVER === "1";

let win = null;
let tray = null;
let saveTimer = null;
let crashedLastTime = false;
let sessionClosed = false;
let uiRestoreBounds = null;
let lastRenderReloadAt = 0;
let rendererCrashNotice = false;
const runtime = {
  alwaysOnTop: true,
  clickThrough: true,
  autoLaunch: false,
};

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
  pointerWatch.timer = setInterval(tickPointer, 80);
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
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

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

// ---------------------------------------------------------------- 托盘
function buildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: win && win.isVisible() ? "先躲起来" : "出来玩", click: toggleWindow },
    { type: "separator" },
    { label: "喂饭（20 金币）", click: () => send("pet:command", "feed") },
    { label: "陪玩（30 金币）", click: () => send("pet:command", "play") },
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
    return {
      save,
      now: Date.now(),
      autoLaunch: runtime.autoLaunch,
      savePath: SAVE_FILE,
      logPath: LOG_FILE,
      crashedLastTime,
    };
  });

  ipcMain.handle("pet:save", (_event, state) => {
    const clean = sanitizeSave(state);
    if (!clean) {
      log("warn", "拒绝写入非法存档");
      return { ok: false, error: "invalid-save" };
    }
    return writeSave(clean);
  });

  ipcMain.handle("pet:actions", () => {
    try {
      const file = path.join(__dirname, "assets", "actions.json");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      log("error", "读取动作清单失败", err.message);
      return [];
    }
  });

  ipcMain.handle("win:get-bounds", () => (win ? win.getBounds() : null));

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
      // 展开动作库时尽量保证整块面板可见；关闭时会还原到原来的位置
      uiRestoreBounds = previous;
      const bounds = win.getBounds();
      const area = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
      const x = Math.min(bounds.x, area.x + area.width - bounds.width - 8);
      safeSetPosition(Math.max(area.x + 8, x), bounds.y);
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
    createTray();

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
}
