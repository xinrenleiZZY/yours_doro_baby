/*
 * 性能实测：冷启动耗时、渲染帧率、Electron 各进程内存。
 * 运行：node_modules\.bin\electron tools\measure-perf.js
 * 输出：_perf-report.json
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPORT = path.join(ROOT, "_perf-report.json");
const startedAt = Date.now();

app.setPath("userData", path.join(ROOT, ".tmp-perf-userdata"));
app.on("window-all-closed", () => {});

const SAVE = {
  version: 3,
  coins: 500,
  totalEarned: 900,
  level: 2,
  satiety: 70,
  mood: 70,
  lastTick: Date.now() - 5000,
  createdAt: Date.now() - 86400000,
  stats: { pets: 0, feeds: 0, plays: 0, upgrades: 0, sessions: 1, scheduleAdded: 0 },
  settings: { ambientIntervalSec: 60, autoWalkIntervalSec: 45, scale: 1 },
};

function registerStubs() {
  ipcMain.handle("pet:load", () => ({
    save: SAVE,
    now: Date.now(),
    savePath: path.join(ROOT, "save.json"),
    logPath: path.join(ROOT, "main.log"),
    crashedLastTime: false,
  }));
  ipcMain.handle("pet:save", () => ({ ok: true }));
  ipcMain.handle("pet:actions", () =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "actions.json"), "utf8"))
  );
  ipcMain.handle("win:get-bounds", () => ({ x: 0, y: 0, width: 320, height: 360 }));
  ipcMain.handle("win:set-position", () => true);
  ipcMain.handle("win:set-ui-size", () => true);
  ipcMain.handle("pet:hitboxes", () => true);
  ipcMain.handle("win:set-click-through", () => true);
  ipcMain.handle("win:set-always-on-top", () => true);
  ipcMain.handle("win:set-auto-launch", () => false);
  ipcMain.handle("app:quit", () => true);
  ipcMain.handle("app:reset-position", () => true);
  ipcMain.handle("app:open-save-folder", () => true);
  ipcMain.handle("app:open-log", () => true);
  ipcMain.handle("app:notify", () => true);
  ipcMain.handle("app:log", () => true);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  registerStubs();
  const win = new BrowserWindow({
    width: 320,
    height: 360,
    show: true,
    opacity: 0,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(path.join(ROOT, "renderer", "index.html"), { query: { test: "1" } });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const ready = await win.webContents
      .executeJavaScript(`document.documentElement.dataset.doroReady === "1"`, true)
      .catch(() => false);
    if (ready) break;
    await wait(50);
  }
  const coldStartMs = Date.now() - startedAt;

  const fps = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      function step() {
        frames += 1;
        if (performance.now() - t0 < 2000) requestAnimationFrame(step);
        else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
      }
      requestAnimationFrame(step);
    })`,
    true
  );

  await wait(6000);
  const appMetrics = app.getAppMetrics();
  const perProcess = appMetrics.map((entry) => ({
    pid: entry.pid,
    type: entry.type,
    workingSetMB: Math.round((entry.memory.workingSetSize / 1024) * 10) / 10,
    privateMB: Math.round((entry.memory.privateBytes / 1024) * 10) / 10,
  }));
  const report = {
    measuredAt: new Date().toISOString(),
    coldStartMs,
    fps,
    processes: perProcess,
    totalWorkingSetMB: Math.round(perProcess.reduce((sum, p) => sum + p.workingSetMB, 0) * 10) / 10,
    totalPrivateMB: Math.round(perProcess.reduce((sum, p) => sum + p.privateMB, 0) * 10) / 10,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
  win.destroy();
  app.exit(0);
});
