/* 渲染进程和主进程之间唯一的桥：只暴露明确需要的能力。 */
const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Map();

function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(handler, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("petAPI", {
  load: () => ipcRenderer.invoke("pet:load"),
  save: (state) => ipcRenderer.invoke("pet:save", state),
  loadActions: () => ipcRenderer.invoke("pet:actions"),

  getBounds: () => ipcRenderer.invoke("win:get-bounds"),
  getWorkArea: () => ipcRenderer.invoke("screen:get-work-area"),
  getCursor: () => ipcRenderer.invoke("screen:get-cursor"),
  summon: () => ipcRenderer.invoke("win:summon"),
  setPosition: (pos) => ipcRenderer.invoke("win:set-position", pos),
  setUiSize: (size) => ipcRenderer.invoke("win:set-ui-size", size),
  setHitboxes: (boxes) => ipcRenderer.invoke("pet:hitboxes", boxes),
  resetPosition: () => ipcRenderer.invoke("app:reset-position"),

  setClickThrough: (enabled) => ipcRenderer.invoke("win:set-click-through", enabled),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("win:set-always-on-top", enabled),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("win:set-auto-launch", enabled),
  openSaveFolder: () => ipcRenderer.invoke("app:open-save-folder"),
  openLog: () => ipcRenderer.invoke("app:open-log"),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  log: (level, message, extra) => ipcRenderer.invoke("app:log", { level, message, extra }),
  quit: () => ipcRenderer.invoke("app:quit"),

  onCommand: (handler) => on("pet:command", handler),
  onSettings: (handler) => on("pet:settings", handler),
  onWindowMoved: (handler) => on("pet:window-moved", handler),
  onCursor: (handler) => on("pet:cursor", handler),
  onNotice: (handler) => on("pet:notice", handler),
});
