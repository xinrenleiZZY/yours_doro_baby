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
  save: (state, meta) => ipcRenderer.invoke("pet:save", state, meta),
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
  onSystemIdle: (handler) => on("pet:system-idle", handler),

  // 题库：网络与判卷都在主进程，渲染进程只拿无答案题面。
  quizExams: (options) => ipcRenderer.invoke("quiz:exams", options),
  quizCreate: (payload) => ipcRenderer.invoke("quiz:create", payload),
  quizAnswer: (payload) => ipcRenderer.invoke("quiz:answer", payload),
  quizGrade: (payload) => ipcRenderer.invoke("quiz:grade", payload),
  quizExamStatus: () => ipcRenderer.invoke("quiz:exam-status"),
  quizExamResume: () => ipcRenderer.invoke("quiz:exam-resume"),
  quizExamAbandon: () => ipcRenderer.invoke("quiz:exam-abandon"),

  // 独立答题窗口
  openQuizWindow: (mode) => ipcRenderer.invoke("quiz-ui:open", { mode }),
  quizSnapshot: () => ipcRenderer.invoke("quiz-ui:snapshot"),
  quizApply: (payload) => ipcRenderer.invoke("quiz-ui:apply", payload),
  quizResize: (size) => ipcRenderer.invoke("quiz-ui:resize", size),
  quizClose: () => ipcRenderer.invoke("quiz-ui:close"),
  quizSpeak: (text, ms) => ipcRenderer.invoke("quiz-ui:speak", { text, ms }),
  onQuizState: (handler) => on("quiz:state", handler),
  onQuizCommand: (handler) => on("quiz-window:command", handler),
  onQuizApply: (handler) => on("pet:quiz-apply", handler),
  onQuizSpeak: (handler) => on("pet:quiz-speak", handler),

  // 独立工具窗口：主进程统一处理交易，宠物与工具窗口共享同一份存档
  openToolWindow: (tool, options) => ipcRenderer.invoke("tool:open", { tool, ...(options || {}) }),
  toolSnapshot: () => ipcRenderer.invoke("tool:snapshot"),
  toolCommand: (tool, command) => ipcRenderer.invoke("tool:command", { tool, command }),
  toolClose: () => ipcRenderer.invoke("tool:close"),
  toolSpeak: (text, ms) => ipcRenderer.invoke("tool:speak", { text, ms }),
  syncToolState: (state, revision) => ipcRenderer.send("tool:live-state", { state, revision }),
  onToolState: (handler) => on("tool:state", handler),
  onToolActionsChanged: (handler) => on("tool:actions-changed", handler),
  onToolCommand: (handler) => on("tool-window:command", handler),
  onToolWindowState: (handler) => on("pet:tool-window-state", handler),
  onPetToolState: (handler) => on("pet:tool-state", handler),
  onPetActionsChanged: (handler) => on("pet:actions-changed", handler),
  onPetToolSpeak: (handler) => on("pet:tool-speak", handler),

  stickerImport: () => ipcRenderer.invoke("sticker:import"),
  stickerDelete: (name) => ipcRenderer.invoke("sticker:delete", name),
  stickerReveal: () => ipcRenderer.invoke("sticker:reveal"),

  // 应用更新
  updateCheck: (feedUrl) => ipcRenderer.invoke("app:update-check", feedUrl),
  updateDownload: () => ipcRenderer.invoke("app:update-download"),
  updateInstall: () => ipcRenderer.invoke("app:update-install"),
  updateStatus: () => ipcRenderer.invoke("app:update-status"),
  onUpdateStatus: (handler) => on("app:update-status", handler),
});
