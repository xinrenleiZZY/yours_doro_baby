/*
 * 界面冒烟测试：真的把 renderer 跑起来，用合成事件点一遍。
 *
 * 设计要点（对应 docs/优化路线图.md P0-2）：
 * - 渲染页带 ?test=1，关掉每秒产币 / 随机动作等计时器，断言只看"操作带来的相对变化"；
 * - 不依赖 requestAnimationFrame（隐藏窗口里 rAF 会被节流），全部用轮询等待；
 * - 每个用例先取操作前状态，再断言差值，避免顺序耦合；
 * - 结果写进 _smoke-report.txt，GUI 进程的 stdout 不可靠。
 *
 * 运行：npm run test:smoke
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const G = require("../renderer/game.js");
const { applyToolCommand } = require("../lib/tool-actions.js");

const ROOT = path.join(__dirname, "..");
const REPORT = path.join(ROOT, "_smoke-report.txt");
const ACTION_NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "actions.json"), "utf8")).map(
  (action) => action.name
);

// 测试专用 profile，不污染真实存档
app.setPath("userData", path.join(ROOT, ".tmp-smoke-userdata"));

const BASE_SAVE = {
  version: 12,
  coins: 500,
  totalEarned: 900,
  level: 1,
  satiety: 50,
  mood: 50,
  lastTick: Date.now() - 5000,
  createdAt: Date.now() - 86400000,
  stats: { pets: 0, feeds: 0, plays: 0, upgrades: 0, sessions: 1 },
  window: { x: 100, y: 100 },
  settings: {
    alwaysOnTop: true,
    clickThrough: true,
    autoLaunch: false,
    showBubble: true,
    autoWalk: false,
    scale: 1,
  },
  training: {
    points: 100,
    totalEarned: 100,
    totalSpent: 0,
    learned: ACTION_NAMES.filter((name) => name !== "toilet_reading"),
  },
  work: { jobs: [], fragments: 0, completed: 0 },
  prestige: { count: 0, legacyLevel: 0 },
  intimacy: { points: 130, dailyDate: "", dailyPoints: 0 },
  diary: {
    entries: [{ date: "2026-10-21", text: "今天赚了 3.2K 金币，看了 7 个动作，接待了 1 位访客。" }],
  },
  stickerHidden: [],
};

let seed = JSON.parse(JSON.stringify(BASE_SAVE));
let lastSaved = null;
let lastHitboxes = [];
let toolState = null;
let toolRevision = 0;
let aiConfigState = {
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  persona: "测试人格：说话简短。",
  hasApiKey: false,
  encryptionAvailable: true,
};
let aiHistoryState = [];
const calls = {
  setPosition: [],
  clickThrough: [],
  save: [],
  logs: [],
  notifications: [],
  stickerDeleted: [],
  toolOpened: [],
  uiSizes: [],
  quit: 0,
  aiChats: [],
  aiSaves: [],
  aiClosed: 0,
};
const results = [];
const lines = [];
let crashed = false;

// Electron 在最后一个窗口关闭时默认会退出应用；测试里要保留进程跑重启场景
app.on("window-all-closed", () => {});

function say(line) {
  lines.push(line);
  try {
    fs.writeFileSync(REPORT, `${lines.join("\n")}\n`, "utf8");
  } catch (err) {
    /* 忽略 */
  }
}

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  say(`${ok ? "  ok  " : "FAIL  "}${name}${detail ? `  (${detail})` : ""}`);
}

function fixtureActions() {
  const actions = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "actions.json"), "utf8"));
  actions.push({
    name: "user_deadbeef00",
    label: "测试导入",
    category: "meme",
    group: "表情包",
    file: "user-stickers/test.png",
    url: "file:///tmp/doro-test-sticker.png",
    thumb: "file:///tmp/doro-test-sticker.png",
    size: [100, 100],
    frames: 1,
    durationMs: 0,
    blocked: false,
    user: true,
  });
  return actions;
}

function registerStubs() {
  ipcMain.handle("pet:load", () => ({
    save: seed,
    now: Date.now(),
    autoLaunch: false,
    savePath: path.join(ROOT, "save.json"),
    logPath: path.join(ROOT, "main.log"),
    crashedLastTime: false,
  }));
  ipcMain.handle("pet:save", (_event, state) => {
    lastSaved = state;
    toolState = G.hydrate(state, Date.now());
    calls.save.push(state);
    return { ok: true };
  });
  ipcMain.handle("pet:actions", () => {
    return fixtureActions();
  });
  ipcMain.handle("sticker:import", () => ({ ok: false, canceled: true }));
  ipcMain.handle("sticker:delete", (_event, name) => {
    calls.stickerDeleted.push(name);
    return { ok: true };
  });
  ipcMain.handle("sticker:reveal", () => true);
  ipcMain.handle("tool:open", (_event, payload) => {
    calls.toolOpened.push(payload && payload.tool);
    return { ok: true };
  });
  ipcMain.handle("tool:snapshot", () => ({
    save: toolState || G.hydrate(lastSaved || seed, Date.now()),
    actions: fixtureActions(),
    now: Date.now(),
    revision: toolRevision,
  }));
  ipcMain.handle("tool:command", (_event, payload) => {
    const tool = payload && payload.tool;
    const base = toolState || G.hydrate(lastSaved || seed, Date.now());
    const applied = applyToolCommand(base, fixtureActions(), tool, payload && payload.command, Date.now());
    if (!applied.ok) return applied;
    toolState = applied.state;
    toolRevision += 1;
    return {
      ...applied,
      save: toolState,
      actions: fixtureActions(),
      revision: toolRevision,
      now: Date.now(),
    };
  });
  ipcMain.handle("tool:speak", () => true);
  ipcMain.handle("tool:close", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target) target.close();
    return true;
  });
  ipcMain.handle("win:get-bounds", () => ({ x: 100, y: 100, width: 320, height: 360 }));
  ipcMain.handle("pet:hitboxes", (_event, boxes) => {
    lastHitboxes = boxes;
    return true;
  });
  ipcMain.handle("win:set-position", (_event, pos) => {
    calls.setPosition.push(pos);
    return pos;
  });
  ipcMain.handle("win:set-ui-size", (_event, size) => {
    calls.uiSizes.push(size);
    return size;
  });
  ipcMain.handle("win:set-click-through", (_event, value) => {
    calls.clickThrough.push(value);
    return value;
  });
  ipcMain.handle("win:set-always-on-top", (_event, value) => value);
  ipcMain.handle("win:set-auto-launch", (_event, value) => Boolean(value));
  ipcMain.handle("app:open-save-folder", () => true);
  ipcMain.handle("app:open-log", () => true);
  ipcMain.handle("app:reset-position", () => ({ x: 0, y: 0 }));
  ipcMain.handle("app:log", (_event, entry) => {
    calls.logs.push(entry);
    return true;
  });
  ipcMain.handle("app:notify", (_event, payload) => {
    calls.notifications.push(payload);
    return true;
  });
  ipcMain.handle("app:quit", () => {
    calls.quit += 1;
    return true;
  });
  ipcMain.handle("screen:get-work-area", () => ({ x: 0, y: 0, width: 1920, height: 1080 }));
  ipcMain.handle("app:update-status", () => ({ state: "idle", version: "0.2.0" }));
  ipcMain.handle("app:update-check", () => ({ state: "not-available", version: "0.2.0" }));
  ipcMain.handle("app:update-download", () => ({ state: "downloaded", version: "0.2.1" }));
  ipcMain.handle("app:update-install", () => ({ state: "installing" }));

  ipcMain.handle("ai:status", () => ({
    configured: aiConfigState.hasApiKey,
    provider: "openai-compatible",
    model: aiConfigState.model,
    hasApiKey: aiConfigState.hasApiKey,
  }));
  ipcMain.handle("ai:config-get", () => ({ ...aiConfigState, persona: aiConfigState.persona }));
  ipcMain.handle("ai:config-save", (_event, config) => {
    aiConfigState = {
      ...aiConfigState,
      baseUrl: String(config.baseUrl || ""),
      model: String(config.model || ""),
      persona: String(config.persona || ""),
      hasApiKey: Boolean(config.apiKey) || (aiConfigState.hasApiKey && !config.clearApiKey),
    };
    calls.aiSaves.push(config);
    return {
      ok: true,
      config: { ...aiConfigState },
      status: {
        configured: aiConfigState.hasApiKey,
        model: aiConfigState.model,
        hasApiKey: aiConfigState.hasApiKey,
      },
    };
  });
  ipcMain.handle("ai:history", () => aiHistoryState.map((item) => ({ ...item })));
  ipcMain.handle("ai:clear-history", () => {
    aiHistoryState = [];
    return { ok: true };
  });
  ipcMain.handle("ai:chat", (_event, payload) => {
    calls.aiChats.push(payload);
    const intent = { reply: "那就先歇十分钟吧。", emotion: "gentle", gesture: "stretch" };
    aiHistoryState.push({ role: "user", content: payload.message, at: Date.now() });
    aiHistoryState.push({ role: "assistant", content: intent.reply, at: Date.now() });
    return { ok: true, intent, history: aiHistoryState };
  });
  ipcMain.handle("ai:close", (event) => {
    calls.aiClosed += 1;
    const target = BrowserWindow.fromWebContents(event.sender);
    if (target) target.close();
    return true;
  });

  // 题库相关：用固定假数据跑通 UI 流程
  ipcMain.handle("quiz:exams", () => ({
    exams: [
      {
        code: "architect",
        name: "系统架构设计师",
        shortName: "架构",
        category: "软考",
        questionCount: 118,
        examConfig: { durationMinutes: 150, questionCount: 75, totalScore: 75, passScore: 45 },
      },
    ],
    cached: false,
    baseUrl: "http://192.168.0.193:9300",
  }));
  ipcMain.handle("quiz:create", (_event, payload) => {
    const mode = (payload && payload.mode) || "random";
    const count = mode === "quiz" ? 10 : mode === "exam" ? 75 : 1;
    const questions = Array.from({ length: count }, (_, index) => ({
      id: `q${index}`,
      type: "single",
      stem: `测试题目 ${index + 1}`,
      options: [
        { key: "A", text: "选项甲" },
        { key: "B", text: "选项乙" },
      ],
      chapterName: "测试章节",
    }));
    const now = Date.now();
    return {
      token: `tk-${mode}`,
      mode,
      examCode: "architect",
      questions,
      startedAt: now,
      endsAt: mode === "exam" ? now + 150 * 60 * 1000 : 0,
      totalScore: 75,
      passScore: 45,
      durationMinutes: mode === "exam" ? 150 : 0,
    };
  });
  ipcMain.handle("quiz:answer", (_event, payload) => ({
    id: payload.questionId,
    correct: true,
    chosen: payload.choice,
    answer: ["A"],
    explanation: "测试解析",
  }));
  ipcMain.handle("quiz:grade", (_event, payload) => ({
    score: 75,
    totalScore: 75,
    passScore: 45,
    passed: true,
    correct: 75,
    wrong: 0,
    total: 75,
    results: [],
    details: payload.answers || {},
  }));
  ipcMain.handle("quiz:exam-status", () => ({ active: false }));
  ipcMain.handle("quiz:exam-resume", () => ({ error: "NO_EXAM" }));
  ipcMain.handle("quiz:exam-abandon", () => ({ ok: true }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openWindow() {
  const win = new BrowserWindow({
    width: 320,
    height: 360,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(ROOT, "renderer", "index.html"), { query: { test: "1" } });
  await waitFor(win, `document.documentElement.dataset.doroReady === "1"`, 5000, "renderer 初始化");
  await waitFor(win, `Boolean(document.querySelector(".pet-layer.in"))`, 5000, "宠物动画加载");
  return win;
}

async function openToolWindowPage(tool) {
  const win = new BrowserWindow({
    width: 620,
    height: 700,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(ROOT, "renderer", "tool-window.html"), { query: { tool } });
  await waitFor(win, `document.documentElement.dataset.toolReady === "1"`, 5000, `${tool} 工具窗口`);
  return win;
}

async function openChatWindowPage() {
  const win = new BrowserWindow({
    width: 540,
    height: 720,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(ROOT, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(ROOT, "renderer", "chat-window.html"));
  await waitFor(win, `document.documentElement.dataset.chatReady === "1"`, 5000, "AI 聊天窗口");
  return win;
}

async function js(win, code) {
  return win.webContents.executeJavaScript(code, true);
}

async function waitFor(win, expression, timeout, label) {
  const deadline = Date.now() + (timeout || 3000);
  while (Date.now() < deadline) {
    const ok = await js(win, `Boolean(${expression})`).catch(() => false);
    if (ok) return true;
    await wait(40);
  }
  throw new Error(`等待超时：${label || expression}`);
}

function pointer(type, x, y, id) {
  return `(() => {
    const el = document.getElementById("pet-wrap");
    el.dispatchEvent(new PointerEvent("${type}", {
      bubbles: true, pointerId: ${id}, button: 0, buttons: ${type === "pointerup" ? 0 : 1},
      clientX: ${x - 100}, clientY: ${y - 100}, screenX: ${x}, screenY: ${y}
    }));
    return true;
  })()`;
}

const getState = (win) => js(win, `window.__doroTest.getState()`);

async function runScenarios(win) {
  // 1. 启动状态
  const boot = await js(
    win,
    `(() => {
      const layers = [...document.querySelectorAll(".pet-layer")];
      const visible = layers.filter((n) => n.classList.contains("in"));
      return {
        layers: layers.length,
        visible: visible.length,
        src: visible[0] ? visible[0].getAttribute("src") : null,
        width: visible[0] ? parseFloat(visible[0].style.width) : 0,
        label: document.getElementById("pet-label").textContent,
        libButton: Boolean(document.querySelector('[data-cmd="library"]')),
        actionCount: window.__doroTest.actionCount(),
        coin: document.getElementById("coin-value").textContent,
        rate: document.getElementById("coin-rate").textContent,
      };
    })()`
  );
  check(
    "待机动画已显示且只有一层可见",
    boot.visible === 1 && /idle_stand\.webp$/.test(boot.src || ""),
    boot.src
  );
  check("宠物尺寸按内容裁边计算", boot.width > 100, `${boot.width}px`);
  check("动作库已载入", boot.libButton && boot.actionCount >= 280, `${boot.actionCount} 个动作`);
  check(
    "金币 / 产出显示",
    boot.coin === "500" && /^\+1\.[0-9]\/s$/.test(boot.rate),
    `${boot.coin} ${boot.rate}`
  );

  win.webContents.send("pet:system-idle", { seconds: 700 });
  await wait(120);
  check(
    "系统空闲 10 分钟会进入睡觉动作",
    (await js(win, `window.__doroTest.currentAction()`)) === "sleep_curl"
  );
  win.webContents.send("pet:system-idle", { seconds: 0 });
  await wait(120);
  check("用户回来后播放伸懒腰", (await js(win, `window.__doroTest.currentAction()`)) === "morning_stretch");

  // 2. 账本面板 + 喂饭
  await js(win, `document.getElementById("coin-pill").click()`);
  check(
    "点金币胶囊打开账本面板",
    await js(win, `document.getElementById("panel").classList.contains("show")`)
  );

  const beforeFeed = await getState(win);
  await js(win, `document.getElementById("btn-feed").click()`);
  await wait(80);
  const afterFeed = await getState(win);
  check(
    "喂饭：扣 20 金币、回 30 饱食度",
    Math.abs(beforeFeed.coins - afterFeed.coins - 20) < 0.01 &&
      Math.abs(afterFeed.satiety - Math.min(100, beforeFeed.satiety + 30)) < 0.01 &&
      afterFeed.stats.feeds === beforeFeed.stats.feeds + 1,
    `${beforeFeed.coins.toFixed(0)}→${afterFeed.coins.toFixed(0)}，饱食 ${beforeFeed.satiety}→${afterFeed.satiety}`
  );

  // 3. 陪玩
  const beforePlay = await getState(win);
  await js(win, `document.getElementById("btn-play").click()`);
  await wait(80);
  const afterPlay = await getState(win);
  check(
    "陪玩：扣 30 金币、心情上涨",
    Math.abs(beforePlay.coins - afterPlay.coins - 30) < 0.01 &&
      afterPlay.mood >= Math.min(100, beforePlay.mood + 25) - 0.01 &&
      afterPlay.stats.plays === beforePlay.stats.plays + 1,
    `${beforePlay.coins.toFixed(0)}→${afterPlay.coins.toFixed(0)}，心情 ${beforePlay.mood.toFixed(0)}→${afterPlay.mood.toFixed(0)}`
  );

  // 4. 升级
  const beforeUpgrade = await getState(win);
  const upgradeCost = await js(win, `Number(document.getElementById("upgrade-cost").textContent)`);
  await js(win, `document.getElementById("btn-upgrade").click()`);
  await wait(80);
  const afterUpgrade = await getState(win);
  check(
    "升级：等级 +1、按标价扣费",
    afterUpgrade.level === beforeUpgrade.level + 1 &&
      Math.abs(beforeUpgrade.coins - afterUpgrade.coins - upgradeCost) < 0.01,
    `Lv.${beforeUpgrade.level}→Lv.${afterUpgrade.level}，花费 ${upgradeCost}`
  );
  check("升级后标签同步", /Lv\.2/.test(await js(win, `document.getElementById("pet-label").textContent`)));

  // 5. 点一下 = 摸头
  const beforePet = await getState(win);
  await js(win, pointer("pointerdown", 300, 300, 7));
  await js(win, pointer("pointerup", 300, 300, 7));
  await wait(120);
  const afterPet = await getState(win);
  check(
    "点一下 doro：摸头次数 +1、掉 1~3 金币",
    afterPet.stats.pets === beforePet.stats.pets + 1 &&
      afterPet.coins - beforePet.coins >= 1 &&
      afterPet.coins - beforePet.coins <= 3.01,
    `+${(afterPet.coins - beforePet.coins).toFixed(0)} 金币`
  );
  check("摸头会冒出气泡", await js(win, `document.getElementById("bubble").classList.contains("show")`));

  // 6. 拖拽
  const beforeDrag = calls.setPosition.length;
  await js(win, pointer("pointerdown", 400, 400, 9));
  await wait(120);
  await js(win, pointer("pointermove", 470, 430, 9));
  await wait(80);
  check("拖拽时播放走路动画", (await js(win, `window.__doroTest.currentAction()`)) === "walk_bag");
  await js(win, pointer("pointerup", 470, 430, 9));
  await wait(120);
  const moved = calls.setPosition.slice(beforeDrag);
  check(
    "拖拽会移动窗口",
    moved.length > 0 && moved.some((p) => p.x === 170 && p.y === 130),
    JSON.stringify(moved.slice(-1))
  );
  check("松手后回到常驻动作", (await js(win, `window.__doroTest.currentAction()`)) === "idle_stand");

  // 7. 右键菜单 + 动作库
  await js(
    win,
    `document.getElementById("pet-wrap").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 60, clientY: 60 }))`
  );
  check("右键打开菜单", await js(win, `document.getElementById("menu").classList.contains("show")`));
  await js(win, `document.querySelector('[data-cmd="library"]').click()`);
  await wait(150);
  const library = await js(
    win,
    `({
      open: document.getElementById("library").classList.contains("show"),
      items: document.querySelectorAll(".lib-item").length,
      tabs: document.querySelectorAll(".lib-tabs button").length,
      menuOpen: document.getElementById("menu").classList.contains("show")
    })`
  );
  check("动作库能打开并分页展示", library.open && library.items === 12, `${library.items} 个/页`);
  check("动作库有分类标签", library.tabs >= 5, `${library.tabs} 个`);

  const sizeBefore = calls.uiSizes[calls.uiSizes.length - 1];
  await js(win, `document.getElementById("library-larger").click()`);
  await wait(80);
  const sizeAfter = calls.uiSizes[calls.uiSizes.length - 1];
  check(
    "动作库放大按钮会调整窗口尺寸",
    sizeAfter && sizeBefore && sizeAfter.width > sizeBefore.width && sizeAfter.height > sizeBefore.height,
    `${JSON.stringify(sizeBefore)}→${JSON.stringify(sizeAfter)}`
  );

  win.setSize(900, 700);
  await wait(150);
  const wideLibrary = await js(
    win,
    `(() => {
      const grid = document.getElementById("library-grid");
      const item = document.querySelector(".lib-item");
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        itemHeight: item.getBoundingClientRect().height,
        noOverflow: grid.scrollWidth <= grid.clientWidth + 1
      };
    })()`
  );
  win.setSize(560, 600);
  await wait(150);
  const narrowLibrary = await js(
    win,
    `(() => {
      const grid = document.getElementById("library-grid");
      const item = document.querySelector(".lib-item");
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        itemHeight: item.getBoundingClientRect().height,
        noOverflow: grid.scrollWidth <= grid.clientWidth + 1
      };
    })()`
  );
  check(
    "动作库随窗口宽度自动换列",
    wideLibrary.columns > narrowLibrary.columns &&
      wideLibrary.itemHeight <= 84 &&
      narrowLibrary.itemHeight <= 84 &&
      wideLibrary.noOverflow &&
      narrowLibrary.noOverflow,
    `宽${wideLibrary.columns}列，窄${narrowLibrary.columns}列`
  );
  win.setSize(600, 400);
  await wait(100);

  await js(
    win,
    `(() => {
      const input = document.getElementById("library-search");
      input.value = "如厕看报";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(120);
  const trainingBefore = await getState(win);
  await js(win, `document.querySelector(".lib-item").click()`);
  await wait(180);
  const trainingAfter = await getState(win);
  check(
    "未学动作可消耗训练点学习",
    trainingAfter.training.learned.includes("toilet_reading") &&
      trainingAfter.training.points < trainingBefore.training.points,
    `${trainingBefore.training.points}→${trainingAfter.training.points} 点`
  );

  await js(
    win,
    `(() => {
      const input = document.getElementById("library-search");
      input.value = "猫";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(120);
  const searchHits = await js(win, `document.querySelectorAll(".lib-item").length`);
  check("动作库支持搜索", searchHits >= 1 && searchHits < 12, `搜到 ${searchHits} 个`);

  await js(win, `document.querySelector(".lib-item").click()`);
  await wait(150);
  const picked = await js(
    win,
    `({
      base: window.__doroTest.baseAction(),
      current: window.__doroTest.currentAction(),
      label: document.getElementById("pet-label").textContent
    })`
  );
  check(
    "能从动作库切换常驻动作",
    picked.base === picked.current && /猫|宠物/.test(picked.label),
    picked.label
  );
  const chosenAction = picked.base;

  await js(win, `document.getElementById("library-close").click()`);
  await wait(80);
  check(
    "动作库能关闭",
    (await js(win, `document.getElementById("library").classList.contains("show")`)) === false
  );

  // 7a. 收藏 + 装扮锁
  await js(win, `window.__doroTest.openLibrary()`);
  await wait(120);
  await js(win, `document.querySelector(".lib-item .lib-star").click()`);
  await wait(120);
  check("动作库能收藏", (await getState(win)).favorites.length === 1, "1 个收藏");
  await js(
    win,
    `[...document.querySelectorAll("#library-tabs button")].find((b) => b.textContent === "收藏").click()`
  );
  await wait(120);
  check("收藏标签能筛选", (await js(win, `document.querySelectorAll(".lib-item").length`)) === 1);

  await js(
    win,
    `(() => {
      const input = document.getElementById("library-search");
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(80);
  await js(
    win,
    `[...document.querySelectorAll("#library-tabs button")].find((b) => b.textContent === "换装").click()`
  );
  await wait(120);
  const libDebug = await js(
    win,
    `({
      tabs: [...document.querySelectorAll("#library-tabs button")].map((b) => b.textContent),
      active: document.querySelector("#library-tabs button.active")?.textContent,
      items: document.querySelectorAll(".lib-item").length,
      first: document.querySelector(".lib-item")?.className
    })`
  );
  check("动作库分类切换", libDebug.active === "换装" && libDebug.items > 0, JSON.stringify(libDebug));
  const locked = await js(win, `document.querySelectorAll(".lib-item.locked").length`);
  check("未解锁装扮显示为锁定", locked === 12, `${locked} 个`);
  await js(win, `document.querySelector(".lib-item.locked").click()`);
  await wait(150);
  const jumped = await js(
    win,
    `({
      shop: document.getElementById("shop").classList.contains("show"),
      tab: document.querySelector("#shop-tabs button.active")?.textContent
    })`
  );
  check("点锁定装扮会跳到商城", jumped.shop && jumped.tab === "装扮", JSON.stringify(jumped));
  await js(win, `window.__doroTest.closePanels()`);

  // 7b. 商城
  await js(win, `window.__doroTest.openShop()`);
  await wait(150);
  await js(win, `document.querySelectorAll("#shop-tabs button")[0].click()`);
  await wait(80);
  win.webContents.send("pet:cursor", { inside: false });
  await wait(150);
  check("光标离开不会关掉商城", await js(win, `document.getElementById("shop").classList.contains("show")`));
  const shop = await js(
    win,
    `({
      open: document.getElementById("shop").classList.contains("show"),
      items: document.querySelectorAll(".shop-item").length,
      tabs: document.querySelectorAll("#shop-tabs button").length,
      balance: document.getElementById("shop-balance").textContent
    })`
  );
  check("商城能打开并列出货物", shop.open && shop.items >= 4 && shop.tabs === 7, JSON.stringify(shop));

  const beforeBuy = await getState(win);
  await js(win, `document.querySelector(".shop-item button").click()`);
  await wait(150);
  const afterBuy = await getState(win);
  check(
    "购买会扣金币并入背包",
    Math.abs(beforeBuy.coins - afterBuy.coins - 15) < 0.01 &&
      (afterBuy.inventory.fish || 0) === (beforeBuy.inventory.fish || 0) + 1,
    `${beforeBuy.coins.toFixed(0)}→${afterBuy.coins.toFixed(0)}，鱼干 ×${afterBuy.inventory.fish}`
  );

  const beforeUse = await getState(win);
  await js(
    win,
    `[...document.querySelectorAll(".shop-item")]
      .find((row) => row.textContent.includes("小鱼干"))
      .querySelector("button.use").click()`
  );
  await wait(150);
  const afterUse = await getState(win);
  check(
    "使用食物恢复饱食度",
    afterUse.satiety > beforeUse.satiety &&
      (afterUse.inventory.fish || 0) === (beforeUse.inventory.fish || 0) - 1,
    `${beforeUse.satiety.toFixed(0)}→${afterUse.satiety.toFixed(0)}`
  );

  await js(
    win,
    `[...document.querySelectorAll("#shop-tabs button")].find((b) => b.textContent === "装扮").click()`
  );
  await wait(120);
  const dressCount = await js(win, `document.querySelectorAll(".shop-item").length`);
  check("商城有装扮分类", dressCount > 5, `${dressCount} 件`);
  await js(
    win,
    `[...document.querySelectorAll("#shop-tabs button")].find((b) => b.textContent === "主题").click()`
  );
  await wait(120);
  const themeCount = await js(win, `document.querySelectorAll(".shop-item").length`);
  check("商城有主题分类", themeCount === 3, `${themeCount} 个`);

  await js(
    win,
    `[...document.querySelectorAll("#shop-tabs button")].find((b) => b.textContent === "典藏").click()`
  );
  await wait(120);
  const luxury = await js(
    win,
    `({
      items: document.querySelectorAll(".shop-item").length,
      hasReshape: [...document.querySelectorAll(".shop-name")].some((n) => n.textContent.includes("性格重塑卡")),
      hasMillionItem: [...document.querySelectorAll(".shop-price")].some((n) => /M/.test(n.textContent))
    })`
  );
  check(
    "典藏分类包含性格重塑与百万级商品",
    luxury.items === 7 && luxury.hasReshape && luxury.hasMillionItem,
    JSON.stringify(luxury)
  );

  // 7c. 日程
  await js(win, `window.__doroTest.openSchedule()`);
  await wait(150);
  await js(
    win,
    `(() => {
      document.getElementById("sched-time").value = "23:59";
      document.getElementById("sched-text").value = "喝一杯水";
      document.getElementById("sched-repeat").value = "once";
      document.getElementById("sched-add").click();
      return true;
    })()`
  );
  await wait(150);
  const sched = await getState(win);
  check(
    "能添加日程",
    sched.schedule.length === 1 &&
      sched.schedule[0].text === "喝一杯水" &&
      sched.schedule[0].repeat === "once",
    JSON.stringify(sched.schedule[0] || null)
  );

  const beforeSnooze = sched.schedule[0].time;
  await js(win, `document.querySelector(".sched-snooze").click()`);
  await wait(150);
  const schedSnoozed = await getState(win);
  check("日程能延后 10 分钟", schedSnoozed.schedule[0].time !== beforeSnooze, schedSnoozed.schedule[0].time);

  await js(win, `document.querySelector('.sched-item input[type="checkbox"]').click()`);
  await wait(150);
  const schedDone = await getState(win);
  check("日程能勾选完成", Boolean(schedDone.schedule[0].doneDate), schedDone.schedule[0].doneDate);

  await js(win, `document.querySelector(".sched-remove").click()`);
  await wait(150);
  const schedRemoved = await getState(win);
  check("日程能删除", schedRemoved.schedule.length === 0, `${schedRemoved.schedule.length} 条`);

  // 7d. 配置中心
  await js(win, `window.__doroTest.openConfig()`);
  await wait(150);
  const config = await js(
    win,
    `({
      open: document.getElementById("config").classList.contains("show"),
      ambient: document.getElementById("cfg-ambient").value,
      toggles: document.querySelectorAll("#config [data-toggle]").length
    })`
  );
  check(
    "配置中心能打开",
    config.open && config.toggles === 10 && config.ambient === "60",
    JSON.stringify(config)
  );

  const configScroll = await js(
    win,
    `(() => {
      const panel = document.getElementById("config");
      const scroller = panel.querySelector(".cfg-scroll");
      scroller.scrollTop = scroller.scrollHeight;
      const footer = panel.querySelector(".cfg-footer").getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return {
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
        atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
        footerVisible: footer.bottom <= panelRect.bottom + 1 && footer.top >= panelRect.top
      };
    })()`
  );
  check(
    "配置中心可以向下滚动到底部",
    configScroll.scrollHeight > configScroll.clientHeight &&
      configScroll.scrollTop > 0 &&
      configScroll.atBottom &&
      configScroll.footerVisible,
    JSON.stringify(configScroll)
  );

  await js(
    win,
    `(() => {
      const slider = document.getElementById("cfg-ambient");
      slider.value = "120";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(120);
  check("动作频率可调", (await getState(win)).settings.ambientIntervalSec === 120, "120 秒");

  await js(
    win,
    `[...document.querySelectorAll("#config [data-ambient]")].find((b) => b.textContent.includes("快")).click()`
  );
  await wait(120);
  check("频率预设生效", (await getState(win)).settings.ambientIntervalSec === 25, "25 秒");

  const uiScaleBaseline = await js(
    win,
    `(() => {
      const hud = document.getElementById("hud").getBoundingClientRect();
      const label = document.getElementById("pet-label").getBoundingClientRect();
      const pet = document.getElementById("pet-stack").getBoundingClientRect();
      return {
        hud: { left: hud.left, top: hud.top, width: hud.width, height: hud.height },
        petTop: pet.top,
        label: {
          center: label.left + label.width / 2,
          bottom: label.bottom,
          width: label.width,
          height: label.height
        }
      };
    })()`
  );
  await js(
    win,
    `(() => {
      const slider = document.getElementById("cfg-scale");
      slider.value = "70";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(320);
  const uiScaleSmall = await js(
    win,
    `(() => {
      const hud = document.getElementById("hud").getBoundingClientRect();
      const label = document.getElementById("pet-label").getBoundingClientRect();
      const pet = document.getElementById("pet-stack").getBoundingClientRect();
      return {
        hud: { left: hud.left, top: hud.top, width: hud.width, height: hud.height },
        petTop: pet.top,
        label: {
          center: label.left + label.width / 2,
          bottom: label.bottom,
          width: label.width,
          height: label.height
        }
      };
    })()`
  );
  check(
    "状态区随宠物缩小并贴近宠物上方",
    uiScaleSmall.hud.width < uiScaleBaseline.hud.width * 0.8 &&
      uiScaleSmall.label.width < uiScaleBaseline.label.width * 0.8 &&
      Math.abs(uiScaleSmall.hud.left - uiScaleBaseline.hud.left) < 1.5 &&
      uiScaleSmall.hud.top > uiScaleBaseline.hud.top + 20 &&
      Math.abs(uiScaleSmall.petTop - (uiScaleSmall.hud.top + uiScaleSmall.hud.height) - 12 * 0.7) < 2 &&
      Math.abs(uiScaleSmall.label.center - uiScaleBaseline.label.center) < 1.5 &&
      Math.abs(uiScaleSmall.label.bottom - uiScaleBaseline.label.bottom) < 1.5,
    `HUD ${uiScaleBaseline.hud.width.toFixed(0)}→${uiScaleSmall.hud.width.toFixed(0)} top ${uiScaleBaseline.hud.top.toFixed(1)}→${uiScaleSmall.hud.top.toFixed(1)}，间距 ${(uiScaleSmall.petTop - uiScaleSmall.hud.top - uiScaleSmall.hud.height).toFixed(1)}；标签 ${uiScaleBaseline.label.width.toFixed(0)}→${uiScaleSmall.label.width.toFixed(0)}`
  );

  await js(
    win,
    `(() => {
      const slider = document.getElementById("cfg-scale");
      slider.value = "120";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(150);
  check("宠物大小可调", Math.abs((await getState(win)).settings.scale - 1.2) < 0.001, "120%");

  await js(win, `document.getElementById("cfg-reset").click()`);
  await wait(150);
  const resetCfg = await getState(win);
  check(
    "配置能恢复默认",
    resetCfg.settings.ambientIntervalSec === 60 && Math.abs(resetCfg.settings.scale - 1) < 0.001,
    `${resetCfg.settings.ambientIntervalSec}s / ${Math.round(resetCfg.settings.scale * 100)}%`
  );

  await js(win, `document.getElementById("config-close").click()`);
  await wait(80);
  check(
    "配置中心能关闭",
    (await js(win, `document.getElementById("config").classList.contains("show")`)) === false
  );

  // 7e. 任务与成就
  await js(win, `window.__doroTest.openGrowth()`);
  await wait(150);
  const growth = await js(
    win,
    `({
      open: document.getElementById("growth").classList.contains("show"),
      daily: document.querySelectorAll("#growth-daily .growth-item").length,
      ach: document.querySelectorAll("#growth-achievements .growth-item").length
    })`
  );
  check(
    "任务与成就面板能打开",
    growth.open && growth.daily === 4 && growth.ach === 12,
    JSON.stringify(growth)
  );
  const profilePanel = await js(
    win,
    `({
      title: document.getElementById("growth-profile-title").textContent,
      detail: document.getElementById("growth-profile").textContent
    })`
  );
  check(
    "成长面板展示性格与偏好",
    Boolean(profilePanel.title) && /喜欢/.test(profilePanel.detail),
    JSON.stringify(profilePanel)
  );
  const intimacyPanel = await js(
    win,
    `({
      title: document.getElementById("growth-intimacy-title").textContent,
      detail: document.getElementById("growth-intimacy").textContent,
      diaryTitle: document.getElementById("growth-diary-title").textContent,
      diary: document.getElementById("growth-diary").textContent
    })`
  );
  check(
    "成长面板展示亲密度与桌面日记",
    /Lv\.3/.test(intimacyPanel.title) &&
      /专属动作/.test(intimacyPanel.detail) &&
      /1 篇/.test(intimacyPanel.diaryTitle) &&
      /3\.2K/.test(intimacyPanel.diary),
    JSON.stringify(intimacyPanel)
  );

  const beforeClaim = await getState(win);
  await js(win, `document.querySelector("#growth-daily .growth-item:nth-child(2) button").click()`);
  await wait(150);
  const afterClaim = await getState(win);
  check(
    "能领取每日任务奖励",
    afterClaim.coins > beforeClaim.coins && afterClaim.daily.claimed.includes("feed1"),
    `${beforeClaim.coins.toFixed(0)}→${afterClaim.coins.toFixed(0)}`
  );

  const beforeCheckin = await getState(win);
  await js(win, `document.getElementById("btn-checkin").click()`);
  await wait(150);
  const afterCheckin = await getState(win);
  check(
    "每日签到",
    afterCheckin.coins > beforeCheckin.coins && afterCheckin.checkin.lastDate !== "",
    `${beforeCheckin.coins.toFixed(0)}→${afterCheckin.coins.toFixed(0)}`
  );

  await js(win, `document.getElementById("btn-bank-200").click()`);
  await wait(150);
  const afterBank = await getState(win);
  check("存钱罐能存钱", afterBank.bank.amount === 200, `${afterBank.bank.amount} 金币`);

  const codexText = await js(win, `document.getElementById("growth-codex").textContent`);
  check("图鉴进度显示", /\d+ \/ 296/.test(codexText), codexText);
  await js(win, `document.getElementById("growth-close").click()`);

  // 7f. 扭蛋 / 接金币
  await js(win, `window.__doroTest.openGacha()`);
  await wait(150);
  const gachaOpen = await js(win, `document.getElementById("gacha").classList.contains("show")`);
  const gachaDisabled = await js(win, `document.getElementById("gacha-pull").disabled`);
  check("扭蛋机面板能打开", gachaOpen && gachaDisabled === true, `disabled=${gachaDisabled}`);

  await js(win, `window.__doroTest.openMinigame()`);
  await wait(150);
  await js(win, `document.getElementById("minigame-start").click()`);
  await wait(700);
  const coinCount = await js(win, `document.querySelectorAll(".minigame-coin").length`);
  if (coinCount > 0) await js(win, `document.querySelector(".minigame-coin").click()`);
  const score = await js(win, `Number(document.getElementById("minigame-score").textContent)`);
  const beforeMini = await getState(win);
  await js(win, `document.getElementById("minigame-close").click()`);
  await wait(250);
  const afterMini = await getState(win);
  check(
    "接金币小游戏能玩并结算",
    score >= 1 && afterMini.coins > beforeMini.coins,
    `score=${score}，${beforeMini.coins.toFixed(0)}→${afterMini.coins.toFixed(0)}`
  );

  // 7g. 心愿 / 访客
  await js(win, `window.__doroTest.forceWish()`);
  await wait(100);
  check("心愿事件显示", await js(win, `document.getElementById("wish-chip").classList.contains("show")`));
  const beforeWish = await getState(win);
  await js(win, `document.getElementById("wish-chip").click()`);
  await wait(200);
  const afterWish = await getState(win);
  check(
    "心愿能完成",
    afterWish.coins > beforeWish.coins,
    `${beforeWish.coins.toFixed(0)}→${afterWish.coins.toFixed(0)}`
  );

  await js(win, `window.__doroTest.forceVisitor()`);
  await wait(100);
  const visitorShown = await js(win, `document.getElementById("visitor-chip").classList.contains("show")`);
  const beforeVisitor = await getState(win);
  await js(win, `document.getElementById("visitor-chip").click()`);
  await wait(200);
  const afterVisitor = await getState(win);
  check(
    "访客能接待",
    visitorShown && afterVisitor.coins > beforeVisitor.coins,
    `${beforeVisitor.coins.toFixed(0)}→${afterVisitor.coins.toFixed(0)}`
  );

  await js(win, `window.__doroTest.forceVisitor()`);
  await js(win, `window.__doroTest.openGrowth()`);
  await wait(150);
  const visitorWorkBefore = await getState(win);
  await js(
    win,
    `[...document.querySelectorAll(".work-worker button")].find((button) => button.textContent === "2h").click()`
  );
  await wait(180);
  const visitorWorkAfter = await getState(win);
  check(
    "访客可以派去 2 小时打工",
    visitorWorkAfter.visitor === null &&
      visitorWorkAfter.work.jobs.length === visitorWorkBefore.work.jobs.length + 1 &&
      visitorWorkAfter.work.jobs.some((job) => job.worker === "visitor"),
    `jobs=${visitorWorkAfter.work.jobs.length}`
  );
  check(
    "打工中显示工作提示",
    await js(win, `document.getElementById("work-chip").classList.contains("show")`)
  );
  const workChipPoint = await js(
    win,
    `(() => {
      const r = document.getElementById("work-chip").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
  );
  check(
    "工作提示出现后命中框立即更新",
    lastHitboxes.some(
      (box) =>
        workChipPoint.x >= box.x &&
        workChipPoint.x <= box.x + box.w &&
        workChipPoint.y >= box.y &&
        workChipPoint.y <= box.y + box.h
    ),
    JSON.stringify(workChipPoint)
  );
  const completedBefore = visitorWorkAfter.work.completed;
  await js(win, `window.__doroTest.finishWork()`);
  await wait(180);
  const visitorWorkDone = await getState(win);
  check(
    "打工结束后自动结算并释放工位",
    visitorWorkDone.work.jobs.length === 0 && visitorWorkDone.work.completed === completedBefore + 1,
    `completed=${visitorWorkDone.work.completed}`
  );

  await js(win, `window.__doroTest.forceVisitor()`);
  await js(win, `window.__doroTest.openGrowth()`);
  await wait(120);
  await js(win, `document.querySelector(".work-dismiss").click()`);
  await wait(120);
  check("访客可以被请回", (await getState(win)).visitor === null);
  await js(win, `document.getElementById("growth-close").click()`);

  // 7h. 题库答题
  await js(win, `window.__doroTest.openQuiz()`);
  await wait(250);
  const quizHome = await js(
    win,
    `({
      open: document.getElementById("quiz").classList.contains("show"),
      modes: document.querySelectorAll(".quiz-mode").length,
      subtitle: document.getElementById("quiz-subtitle").textContent
    })`
  );
  check("题库面板能打开并展示五种模式", quizHome.open && quizHome.modes === 5, JSON.stringify(quizHome));

  const beforeDaily = await getState(win);
  await js(win, `window.__doroTest.startQuizMode("daily")`);
  await wait(350);
  const quizQuestion = await js(
    win,
    `({
      stem: document.querySelector(".quiz-stem")?.textContent || "",
      options: document.querySelectorAll(".quiz-option").length
    })`
  );
  check(
    "每日一题能取到题目",
    quizQuestion.options === 2 && quizQuestion.stem.includes("测试题目"),
    JSON.stringify(quizQuestion)
  );
  await js(win, `document.querySelector(".quiz-option").click()`);
  await wait(120);
  await js(win, `document.querySelector(".quiz-actions .quiz-btn").click()`);
  await wait(400);
  const afterDaily = await getState(win);
  check(
    "每日一题答对 +100 金币",
    Math.abs(afterDaily.coins - beforeDaily.coins - 100) < 0.01 && afterDaily.quiz.dailyDone === true,
    `${beforeDaily.coins.toFixed(0)}→${afterDaily.coins.toFixed(0)}`
  );
  check("答题后显示判定反馈", await js(win, `Boolean(document.querySelector(".quiz-feedback.ok"))`));
  await js(win, `document.getElementById("quiz-close").click()`);
  await wait(120);
  check(
    "题库面板能关闭",
    (await js(win, `document.getElementById("quiz").classList.contains("show")`)) === false
  );

  const beforeQuizBridge = await getState(win);
  win.webContents.send("pet:quiz-apply", { mode: "random", correct: 1, wrong: 0, now: Date.now() });
  await wait(200);
  const afterQuizBridge = await getState(win);
  check(
    "独立答题窗口的奖励能同步到宠物",
    afterQuizBridge.coins > beforeQuizBridge.coins,
    `${beforeQuizBridge.coins.toFixed(0)}→${afterQuizBridge.coins.toFixed(0)}`
  );

  // 7i. 动作库管理
  await js(win, `window.__doroTest.openSticker()`);
  await wait(200);
  const stickerInfo = await js(
    win,
    `({
      open: document.getElementById("sticker").classList.contains("show"),
      items: document.querySelectorAll(".sticker-item").length,
      count: document.getElementById("sticker-count").textContent,
      preview: document.getElementById("sticker-preview-img").getAttribute("src")
    })`
  );
  check(
    "动作库管理能打开",
    stickerInfo.open &&
      stickerInfo.items === 8 &&
      /296/.test(stickerInfo.count) &&
      Boolean(stickerInfo.preview),
    JSON.stringify(stickerInfo)
  );

  const beforeSticker = await getState(win);
  await js(win, `document.getElementById("sticker-preview-random").click()`);
  await wait(150);
  const afterSticker = await getState(win);
  check(
    "表情包随机开关能切换",
    JSON.stringify(beforeSticker.stickerRandom) !== JSON.stringify(afterSticker.stickerRandom),
    JSON.stringify(afterSticker.stickerRandom)
  );

  await js(
    win,
    `(() => {
      const input = document.getElementById("sticker-rename");
      input.value = "测试改名";
      input.dispatchEvent(new Event("blur"));
      return true;
    })()`
  );
  await wait(150);
  const renamed = await getState(win);
  check(
    "表情包能改名",
    Object.values(renamed.stickerLabels).includes("测试改名"),
    JSON.stringify(renamed.stickerLabels)
  );

  await js(win, `document.querySelector('[data-bulk="none"]').click()`);
  await wait(180);
  const bulk = await getState(win);
  check(
    "表情包批量禁止随机",
    Object.values(bulk.stickerRandom).length >= 296 &&
      Object.values(bulk.stickerRandom).every((value) => value === false),
    `${Object.keys(bulk.stickerRandom).length} 条`
  );

  await js(
    win,
    `(() => {
      const input = document.getElementById("sticker-search");
      input.value = "测试导入";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await wait(150);
  check("自定义表情包可以被搜索", (await js(win, `document.querySelectorAll(".sticker-item").length`)) === 1);
  await js(win, `document.querySelector(".sticker-item").click()`);
  await wait(100);
  await js(win, `document.getElementById("sticker-delete").click()`);
  await wait(100);
  await js(win, `document.getElementById("sticker-delete").click()`);
  await wait(250);
  check(
    "自定义表情包可以删除",
    calls.stickerDeleted.includes("user_deadbeef00") &&
      (await js(win, `document.querySelectorAll(".sticker-item").length`)) === 0
  );
  check(
    "搜索无结果时清空预览",
    (await js(
      win,
      `!document.getElementById("sticker-preview-img").hasAttribute("src") &&
        document.getElementById("sticker-rename").disabled &&
        document.getElementById("sticker-preview-random").disabled`
    )) === true
  );
  await js(win, `document.getElementById("sticker-close").click()`);

  // 8. 设置开关
  const beforeToggle = await getState(win);
  await js(win, `document.querySelector('[data-toggle="clickThrough"]').click()`);
  await wait(100);
  const afterToggle = await getState(win);
  check(
    "点击穿透开关能切换",
    afterToggle.settings.clickThrough === !beforeToggle.settings.clickThrough,
    `${beforeToggle.settings.clickThrough} → ${afterToggle.settings.clickThrough}`
  );
  check("开关状态同步给主进程", calls.clickThrough.length > 0, `${calls.clickThrough.length} 次`);
  check("切换后有提示", /点击穿透/.test(await js(win, `document.getElementById("toast").textContent`)));

  // 8b. 回归：命中区域上报 + 从菜单打开穿透时必须收起菜单（防止"卡死"）
  await js(win, `window.__doroTest.closePanels()`);
  await js(win, `document.getElementById("panel-close").click()`);
  await wait(120);
  const baseBoxes = lastHitboxes.length;
  await js(win, `window.__doroTest.openMenu(10, 10)`);
  await wait(120);
  const menuBoxes = lastHitboxes.length;
  check("菜单展开时命中区域会扩大", menuBoxes === baseBoxes + 1, `${baseBoxes} → ${menuBoxes}`);

  await js(win, `document.querySelector('[data-toggle="clickThrough"]').click()`);
  await wait(150);
  const menuHidden = await js(win, `!document.getElementById("menu").classList.contains("show")`);
  check(
    "打开穿透时菜单自动收起（防止卡死）",
    menuHidden === true && calls.clickThrough[calls.clickThrough.length - 1] === true,
    `menuHidden=${menuHidden} last=${calls.clickThrough[calls.clickThrough.length - 1]}`
  );
  check("穿透模式下仍保留宠物命中区域", lastHitboxes.length === baseBoxes, `${lastHitboxes.length} 个区域`);

  const petCenter = await js(
    win,
    `(() => {
      const r = document.getElementById("pet-stack").getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`
  );
  const covered = lastHitboxes.some(
    (box) =>
      petCenter.x >= box.x &&
      petCenter.x <= box.x + box.w &&
      petCenter.y >= box.y &&
      petCenter.y <= box.y + box.h
  );
  check("宠物中心落在命中区域内", covered === true, `${Math.round(petCenter.x)},${Math.round(petCenter.y)}`);

  // 9. 存档
  await js(win, `window.__doroTest.saveNow()`);
  await wait(120);
  check("存档能写回", lastSaved && lastSaved.level === 2, lastSaved ? `Lv.${lastSaved.level}` : "null");
  check(
    "存档包含完整字段",
    Boolean(lastSaved && lastSaved.stats && lastSaved.settings && lastSaved.window),
    lastSaved ? Object.keys(lastSaved).join(",") : "null"
  );

  await js(win, `window.__doroTest.setLevel(50)`);
  await js(win, `window.__doroTest.openGrowth()`);
  await wait(120);
  const prestigeBefore = await getState(win);
  await js(win, `document.getElementById("btn-prestige").click()`);
  await wait(80);
  await js(win, `document.getElementById("btn-prestige").click()`);
  await wait(160);
  const prestigeAfter = await getState(win);
  check(
    "Lv.50 可以通过二次确认转生",
    prestigeBefore.level === 50 && prestigeAfter.level === 1 && prestigeAfter.prestige.count === 1,
    `Lv.${prestigeBefore.level}→Lv.${prestigeAfter.level}，转生 ${prestigeAfter.prestige.count}`
  );
  check(
    "转生显示永久倍率与限定称号",
    (await js(win, `document.getElementById("growth-prestige-title").textContent`)).includes("摸鱼新生") &&
      (await js(win, `document.getElementById("growth-prestige").textContent`)).includes("×1.15"),
    await js(win, `document.getElementById("growth-prestige").textContent`)
  );
  await js(win, `document.getElementById("growth-close").click()`);

  // 10. 渲染进程异常会上报主进程日志
  await js(win, `setTimeout(() => { throw new Error("smoke-boom"); }, 0); true`);
  await wait(300);
  check(
    "渲染进程异常写入日志",
    calls.logs.some((entry) => String(entry.message).includes("smoke-boom")),
    `${calls.logs.length} 条日志`
  );
  return chosenAction;
}

async function runToolWindowScenarios() {
  toolState = G.hydrate({ coins: 2000, satiety: 80, mood: 80 }, Date.now());
  toolRevision += 1;

  const shop = await openToolWindowPage("shop");
  const shopInfo = await js(
    shop,
    `({
      tool: document.body.dataset.tool,
      open: document.getElementById("shop").classList.contains("show"),
      balance: document.getElementById("shop-balance").textContent,
      items: document.querySelectorAll(".shop-item").length,
      tabs: document.querySelectorAll("#shop-tabs button").length
    })`
  );
  check(
    "商城以独立窗口打开",
    shopInfo.tool === "shop" &&
      shopInfo.open &&
      shopInfo.items > 0 &&
      shopInfo.tabs === 7 &&
      /金币/.test(shopInfo.balance),
    JSON.stringify(shopInfo)
  );
  shop.setSize(460, 600);
  await wait(150);
  const narrowShop = await js(
    shop,
    `(() => {
      const list = document.getElementById("shop-list");
      const item = document.querySelector(".shop-item");
      return {
        noOverflow: list.scrollWidth <= list.clientWidth + 1,
        itemWidth: item.getBoundingClientRect().width,
        listWidth: list.getBoundingClientRect().width
      };
    })()`
  );
  check(
    "商城在窄窗口自动收缩且不横向溢出",
    narrowShop.noOverflow && narrowShop.itemWidth <= narrowShop.listWidth + 1,
    JSON.stringify(narrowShop)
  );
  const shopBefore = toolState;
  await js(shop, `document.querySelector(".shop-item button:not(.use)").click()`);
  await wait(220);
  check(
    "独立商城购买会写入共享状态",
    toolState.inventory.fish === 1 && toolState.coins < shopBefore.coins,
    `${shopBefore.coins}→${toolState.coins}，鱼×${toolState.inventory.fish}`
  );
  await js(shop, `document.querySelector(".shop-item .use").click()`);
  await wait(220);
  check("独立商城可使用背包物品", toolState.inventory.fish === 0, `鱼×${toolState.inventory.fish}`);
  shop.close();
  await wait(120);

  toolState = G.hydrate({ coins: 2000, satiety: 80, mood: 80 }, Date.now());
  toolRevision += 1;
  const gacha = await openToolWindowPage("gacha");
  const pullsBefore = toolState.gacha.pulls;
  check(
    "扭蛋机以独立窗口打开",
    (await js(
      gacha,
      `document.body.dataset.tool === "gacha" && document.getElementById("gacha").classList.contains("show")`
    )) === true
  );
  await js(gacha, `document.getElementById("gacha-pull").click()`);
  await wait(220);
  check(
    "独立扭蛋机抽奖会写入共享状态",
    toolState.gacha.pulls === pullsBefore + 1 &&
      Boolean(await js(gacha, `document.getElementById("gacha-result").textContent`)),
    `pulls=${toolState.gacha.pulls}`
  );
  gacha.close();
  await wait(120);

  toolState = G.hydrate({ coins: 0, satiety: 80, mood: 80 }, Date.now());
  toolRevision += 1;
  const minigame = await openToolWindowPage("minigame");
  check(
    "接金币以独立窗口打开",
    (await js(
      minigame,
      `document.body.dataset.tool === "minigame" && document.getElementById("minigame").classList.contains("show")`
    )) === true
  );
  await js(minigame, `document.getElementById("minigame-start").click()`);
  await wait(620);
  const miniCoins = await js(minigame, `document.querySelectorAll(".minigame-coin").length`);
  if (miniCoins > 0) await js(minigame, `document.querySelector(".minigame-coin").click()`);
  await js(minigame, `document.getElementById("minigame-close").click()`);
  await wait(300);
  check(
    "独立接金币窗口能结算并记录冷却",
    toolState.minigame.lastPlayedAt > 0 && toolState.coins >= 5,
    `score=${miniCoins - 1 >= 0 ? "≥0" : "0"}，coins=${toolState.coins}`
  );

  toolState = G.hydrate({ coins: 2000, satiety: 80, mood: 80 }, Date.now());
  toolRevision += 1;
  const sticker = await openToolWindowPage("sticker");
  const stickerInfo = await js(
    sticker,
    `({
      tool: document.body.dataset.tool,
      open: document.getElementById("sticker").classList.contains("show"),
      items: document.querySelectorAll(".sticker-item").length,
      count: document.getElementById("sticker-count").textContent
    })`
  );
  check(
    "动作库管理以独立窗口打开",
    stickerInfo.tool === "sticker" &&
      stickerInfo.open &&
      stickerInfo.items === 8 &&
      /296/.test(stickerInfo.count),
    JSON.stringify(stickerInfo)
  );
  sticker.setSize(900, 720);
  await wait(150);
  const wideSticker = await js(
    sticker,
    `(() => {
      const grid = document.getElementById("sticker-grid");
      const item = document.querySelector(".sticker-item");
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        height: item.getBoundingClientRect().height,
        overflow: grid.scrollWidth <= grid.clientWidth + 1
      };
    })()`
  );
  sticker.setSize(460, 600);
  await wait(150);
  const narrowSticker = await js(
    sticker,
    `(() => {
      const grid = document.getElementById("sticker-grid");
      const item = document.querySelector(".sticker-item");
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        height: item.getBoundingClientRect().height,
        overflow: grid.scrollWidth <= grid.clientWidth + 1
      };
    })()`
  );
  check(
    "动作库管理会随窗口宽度自动换列且不再拉伸空行",
    wideSticker.columns > narrowSticker.columns &&
      wideSticker.height <= 100 &&
      narrowSticker.height <= 90 &&
      wideSticker.overflow &&
      narrowSticker.overflow,
    `宽${wideSticker.columns}列/${wideSticker.height.toFixed(0)}px，窄${narrowSticker.columns}列/${narrowSticker.height.toFixed(0)}px`
  );
  await js(sticker, `document.querySelector(".sticker-item").click()`);
  await js(sticker, `document.getElementById("sticker-delete").click()`);
  await js(sticker, `document.getElementById("sticker-delete").click()`);
  await wait(200);
  check(
    "内置动作删除后只隐藏",
    toolState.stickerHidden.length === 1 &&
      /\/ 295 参与随机/.test(await js(sticker, `document.getElementById("sticker-count").textContent`)),
    JSON.stringify(toolState.stickerHidden)
  );
  await js(sticker, `document.getElementById("sticker-download").click()`);
  await wait(200);
  check(
    "下载内置按钮能恢复隐藏动作",
    toolState.stickerHidden.length === 0 &&
      /\/ 296 参与随机/.test(await js(sticker, `document.getElementById("sticker-count").textContent`)),
    `hidden=${toolState.stickerHidden.length}`
  );
  const randomBefore = JSON.stringify(toolState.stickerRandom);
  await js(sticker, `document.getElementById("sticker-preview-random").click()`);
  await wait(220);
  check(
    "独立表情窗口的随机设置会写入共享状态",
    JSON.stringify(toolState.stickerRandom) !== randomBefore,
    JSON.stringify(toolState.stickerRandom)
  );
  sticker.close();
  await wait(120);
}

async function runChatWindowScenario() {
  const chat = await openChatWindowPage();
  const initial = await js(
    chat,
    `({
      settingsOpen: !document.getElementById("settings").hidden,
      status: document.getElementById("status").textContent,
      messages: document.querySelectorAll(".message").length
    })`
  );
  check(
    "未配置时聊天窗口会引导填写接口",
    initial.settingsOpen && /还没配置/.test(initial.status) && initial.messages === 0,
    JSON.stringify(initial)
  );

  await js(
    chat,
    `(() => {
      document.getElementById("base-url").value = "https://api.example.com/v1";
      document.getElementById("model").value = "test-chat";
      document.getElementById("api-key").value = "test-secret";
      document.getElementById("persona").value = "测试人格：说话简短。";
      document.getElementById("save-settings").click();
      return true;
    })()`
  );
  await waitFor(chat, `document.getElementById("status").classList.contains("ready")`, 3000, "聊天配置保存");
  check(
    "聊天配置通过主进程保存",
    calls.aiSaves.length === 1 &&
      aiConfigState.hasApiKey &&
      aiConfigState.model === "test-chat" &&
      calls.aiSaves[0].apiKey === "test-secret",
    JSON.stringify({ saves: calls.aiSaves.length, model: aiConfigState.model })
  );

  await js(
    chat,
    `(() => {
      document.getElementById("message").value = "写代码写累了";
      document.getElementById("send").click();
      return true;
    })()`
  );
  await waitFor(
    chat,
    `[...document.querySelectorAll(".message.assistant .bubble")].some((node) => node.textContent.includes("歇十分钟"))`,
    3000,
    "聊天回复"
  );
  const chatResult = await js(
    chat,
    `({
      assistant: [...document.querySelectorAll(".message.assistant .bubble")].map((node) => node.textContent),
      error: document.querySelectorAll(".message.error").length,
      status: document.getElementById("status").textContent
    })`
  );
  check(
    "聊天回复会显示并写入短期历史",
    chatResult.assistant.some((text) => text.includes("歇十分钟")) &&
      chatResult.error === 0 &&
      aiHistoryState.length === 2 &&
      calls.aiChats[0].message === "写代码写累了",
    JSON.stringify(chatResult)
  );
  chat.showInactive();
  await wait(200);
  fs.writeFileSync(path.join(ROOT, "_shot_chat_window.png"), (await chat.webContents.capturePage()).toPNG());
  chat.hide();

  await js(chat, `document.getElementById("close").click()`);
  await wait(160);
  check("聊天窗口可以关闭", calls.aiClosed === 1 && chat.isDestroyed(), `closed=${calls.aiClosed}`);
}

async function runRestartScenario(chosenAction) {
  // 用上一次存档重新开一个窗口，验证"重启后进度还在"
  seed = lastSaved;
  const win = await openWindow();
  const restored = await getState(win);
  check(
    "重启后金币 / 等级 / 常驻动作都还在",
    Math.abs(restored.coins - lastSaved.coins) < 0.01 &&
      restored.level === lastSaved.level &&
      restored.settings.baseAction === chosenAction,
    `Lv.${restored.level} · ${restored.coins.toFixed(0)} 金币 · ${restored.settings.baseAction}`
  );
  check("重启后仍是所选动作", (await js(win, `window.__doroTest.currentAction()`)) === chosenAction);

  // 退出按钮
  await js(win, `window.__doroTest.openMenu(10, 10)`);
  await js(win, `document.querySelector('[data-cmd="quit"]').click()`);
  await wait(500);
  check("退出按钮会通知主进程", calls.quit > 0, `${calls.quit}`);
  win.destroy();
}

async function main() {
  registerStubs();
  const win = await openWindow();
  let chosenAction = null;
  try {
    chosenAction = await runScenarios(win);
    win.destroy();
    await runToolWindowScenarios();
    await runChatWindowScenario();
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
  await runRestartScenario(chosenAction);

  const failed = results.filter((r) => !r.ok);
  say(`\n通过 ${results.length - failed.length} / ${results.length}`);
  if (failed.length) say(`失败项：\n${failed.map((r) => ` - ${r.name}`).join("\n")}`);
  app.exit(failed.length ? 1 : 0);
}

process.on("uncaughtException", (err) => {
  if (crashed) return;
  crashed = true;
  say(`冒烟测试崩溃：${err && err.stack ? err.stack : err}`);
  app.exit(2);
});

app.whenReady().then(() =>
  main().catch((err) => {
    say(`冒烟测试失败：${err && err.stack ? err.stack : err}`);
    app.exit(2);
  })
);
