/*
 * 应用更新服务：走 electron-updater 的 generic 源（局域网 Docker 静态目录）。
 *
 * 状态机：idle → checking → available/not-available → downloading → downloaded → installing
 * 开发模式下（未打包）不发起真实检查，只返回 dev 状态，避免 electron-updater 报错。
 */
"use strict";

const { app } = require("electron");

let autoUpdater = null;
try {
  // 依赖缺失时不让整个应用起不来，只是没有更新能力。
  ({ autoUpdater } = require("electron-updater"));
} catch (err) {
  autoUpdater = null;
}

const DEFAULT_FEED_URL = "http://192.168.0.193:9400/updates";

function normalizeFeedUrl(value) {
  if (typeof value !== "string") return DEFAULT_FEED_URL;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) return DEFAULT_FEED_URL;
  return trimmed.slice(0, 200);
}

class UpdaterService {
  constructor({ feedUrl, onStatus, log } = {}) {
    this.feedUrl = normalizeFeedUrl(feedUrl);
    this.onStatus = typeof onStatus === "function" ? onStatus : () => {};
    this.log = typeof log === "function" ? log : () => {};
    this.status = {
      state: "idle",
      version: "",
      percent: 0,
      message: autoUpdater ? "" : "未安装 electron-updater",
      feedUrl: this.feedUrl,
      packaged: false,
    };
    this.ready = false;
    this.checking = false;
  }

  init() {
    if (!autoUpdater) {
      this.emit({ state: "error", message: "缺少 electron-updater，无法检查更新" });
      return;
    }
    this.ready = true;
    this.status.packaged = app.isPackaged;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    this.applyFeed();

    autoUpdater.on("checking-for-update", () => {
      this.emit({ state: "checking", message: "正在检查更新…" });
    });
    autoUpdater.on("update-available", (info) => {
      this.checking = false;
      this.emit({
        state: "available",
        version: info && info.version ? info.version : "",
        message: `发现新版本 ${info && info.version ? "v" + info.version : ""}`,
      });
      this.log("info", "发现新版本", info && info.version ? info.version : "");
    });
    autoUpdater.on("update-not-available", () => {
      this.checking = false;
      this.emit({ state: "not-available", message: "已经是最新版本" });
    });
    autoUpdater.on("download-progress", (progress) => {
      this.emit({
        state: "downloading",
        percent: Math.max(0, Math.min(100, Math.round(Number(progress && progress.percent) || 0))),
        message: "正在下载更新…",
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.emit({
        state: "downloaded",
        version: info && info.version ? info.version : this.status.version,
        percent: 100,
        message: "更新已下载，点击安装",
      });
      this.log("info", "更新已下载", info && info.version ? info.version : "");
    });
    autoUpdater.on("error", (err) => {
      this.checking = false;
      this.emit({
        state: "error",
        message: `更新失败：${err && err.message ? err.message : "未知错误"}`.slice(0, 200),
      });
      this.log("warn", "更新出错", err && err.message ? err.message : String(err));
    });
  }

  applyFeed() {
    if (!autoUpdater) return;
    try {
      autoUpdater.setFeedURL({ provider: "generic", url: this.feedUrl });
    } catch (err) {
      this.log("warn", "设置更新源失败", err.message);
    }
  }

  setFeedUrl(value) {
    this.feedUrl = normalizeFeedUrl(value);
    this.status.feedUrl = this.feedUrl;
    if (this.ready) this.applyFeed();
    return this.snapshot();
  }

  snapshot() {
    return { ...this.status, feedUrl: this.feedUrl, packaged: Boolean(app.isPackaged) };
  }

  emit(patch) {
    this.status = { ...this.status, ...patch, feedUrl: this.feedUrl, packaged: Boolean(app.isPackaged) };
    try {
      this.onStatus(this.snapshot());
    } catch (err) {
      this.log("warn", "更新状态回调失败", err.message);
    }
  }

  async check({ manual = false } = {}) {
    if (!autoUpdater) return this.snapshot();
    if (!app.isPackaged) {
      if (manual) this.emit({ state: "dev", message: "开发模式不检查更新，请用打包后的应用测试" });
      return this.snapshot();
    }
    if (this.status.state === "downloading" || this.status.state === "downloaded") return this.snapshot();
    if (this.checking) return this.snapshot();
    this.checking = true;
    this.emit({ state: "checking", message: "正在检查更新…" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.checking = false;
      this.emit({
        state: "error",
        message: `检查更新失败：${err && err.message ? err.message : "未知错误"}`.slice(0, 200),
      });
      this.log("warn", "检查更新失败", err && err.message ? err.message : String(err));
    }
    return this.snapshot();
  }

  async download() {
    if (!autoUpdater || !app.isPackaged) return this.snapshot();
    if (this.status.state !== "available") return this.snapshot();
    this.emit({ state: "downloading", percent: 0, message: "正在下载更新…" });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      this.emit({
        state: "error",
        message: `下载更新失败：${err && err.message ? err.message : "未知错误"}`.slice(0, 200),
      });
    }
    return this.snapshot();
  }

  install() {
    if (!autoUpdater || !app.isPackaged) return false;
    if (this.status.state !== "downloaded") return false;
    this.emit({ state: "installing", message: "正在重启并安装更新…" });
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        this.log("warn", "安装更新失败", err.message);
      }
    });
    return true;
  }
}

module.exports = {
  UpdaterService,
  DEFAULT_FEED_URL,
  normalizeFeedUrl,
};
