/* doro 桌面宠物：界面 / 动画 / 交互。经济逻辑在 game.js 里。 */
(function () {
  "use strict";

  const G = window.DoroGame;
  const api = window.petAPI;
  const DoroQuiz = window.DoroQuiz;
  // 冒烟测试用 ?test=1 打开：关掉自动计时，并暴露少量只读/操作钩子
  const TEST_MODE = new URLSearchParams(location.search).has("test");
  const EXTERNAL_TOOLS = new Set(["shop", "gacha", "minigame", "sticker"]);

  // 渲染进程的异常统一上报到主进程日志，避免"点了没反应但查不到原因"
  window.addEventListener("error", (event) => {
    api.log(
      "error",
      `${event.message} @ ${event.filename}:${event.lineno}`,
      event.error && event.error.stack
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    api.log("error", "unhandledrejection", reason && (reason.stack || String(reason)));
  });

  const $ = (id) => document.getElementById(id);
  const el = {
    stage: $("stage"),
    fx: $("fx"),
    hud: $("hud"),
    petWrap: $("pet-wrap"),
    petStack: $("pet-stack"),
    petLabel: $("pet-label"),
    bubble: $("bubble"),
    bubbleText: $("bubble-text"),
    coinPill: $("coin-pill"),
    coinValue: $("coin-value"),
    coinRate: $("coin-rate"),
    chipSatiety: $("chip-satiety"),
    chipMood: $("chip-mood"),
    wishChip: $("wish-chip"),
    visitorChip: $("visitor-chip"),
    workChip: $("work-chip"),
    quizChip: $("quiz-chip"),
    quiz: $("quiz"),
    menuQuizSummary: $("menu-quiz-summary"),
    cfgQuizApi: $("cfg-quiz-api"),
    cfgQuizStatus: $("cfg-quiz-status"),
    cfgQuizSave: $("cfg-quiz-save"),
    cfgQuizRefresh: $("cfg-quiz-refresh"),
    cfgUpdateFeed: $("cfg-update-feed"),
    cfgUpdateStatus: $("cfg-update-status"),
    cfgUpdateSave: $("cfg-update-save"),
    cfgUpdateCheck: $("cfg-update-check"),
    panel: $("panel"),
    panelCoins: $("panel-coins"),
    panelIncome: $("panel-income"),
    panelTotal: $("panel-total"),
    panelPets: $("panel-pets"),
    barSatiety: $("bar-satiety"),
    barMood: $("bar-mood"),
    valSatiety: $("val-satiety"),
    valMood: $("val-mood"),
    btnFeed: $("btn-feed"),
    btnPlay: $("btn-play"),
    btnUpgrade: $("btn-upgrade"),
    upgradeCost: $("upgrade-cost"),
    menuUpgradeCost: $("menu-upgrade-cost"),
    panelHint: $("panel-hint"),
    menu: $("menu"),
    menuLibraryCount: $("menu-library-count"),
    toast: $("toast"),
    library: $("library"),
    libraryCount: $("library-count"),
    librarySize: $("library-size"),
    librarySmaller: $("library-smaller"),
    libraryLarger: $("library-larger"),
    libraryResize: $("library-resize"),
    librarySearch: $("library-search"),
    libraryTabs: $("library-tabs"),
    libraryGrid: $("library-grid"),
    libraryPage: $("library-page"),
    libraryPrev: $("library-prev"),
    libraryNext: $("library-next"),
    shop: $("shop"),
    shopBalance: $("shop-balance"),
    shopTabs: $("shop-tabs"),
    shopList: $("shop-list"),
    schedule: $("schedule"),
    scheduleDate: $("schedule-date"),
    schedTime: $("sched-time"),
    schedText: $("sched-text"),
    schedAdd: $("sched-add"),
    schedRepeat: $("sched-repeat"),
    schedList: $("sched-list"),
    menuScheduleCount: $("menu-schedule-count"),
    menuTaskCount: $("menu-task-count"),
    menuStickerCount: $("menu-sticker-count"),
    config: $("config"),
    cfgAmbient: $("cfg-ambient"),
    cfgAmbientVal: $("cfg-ambient-val"),
    cfgWalk: $("cfg-walk"),
    cfgWalkVal: $("cfg-walk-val"),
    cfgScale: $("cfg-scale"),
    cfgScaleVal: $("cfg-scale-val"),
    cfgReset: $("cfg-reset"),
    sticker: $("sticker"),
    stickerCount: $("sticker-count"),
    stickerSearch: $("sticker-search"),
    stickerPreviewImg: $("sticker-preview-img"),
    stickerRename: $("sticker-rename"),
    stickerPreviewRandom: $("sticker-preview-random"),
    stickerDelete: $("sticker-delete"),
    stickerImport: $("sticker-import"),
    stickerDownload: $("sticker-download"),
    stickerReveal: $("sticker-reveal"),
    stickerBulk: $("sticker-bulk"),
    stickerGrid: $("sticker-grid"),
    stickerPage: $("sticker-page"),
    stickerPrev: $("sticker-prev"),
    stickerNext: $("sticker-next"),
    growth: $("growth"),
    growthCoins: $("growth-coins"),
    growthDaily: $("growth-daily"),
    growthDailyDate: $("growth-daily-date"),
    growthProfileTitle: $("growth-profile-title"),
    growthProfile: $("growth-profile"),
    growthIntimacyTitle: $("growth-intimacy-title"),
    growthIntimacy: $("growth-intimacy"),
    growthDiaryTitle: $("growth-diary-title"),
    growthDiary: $("growth-diary"),
    growthPrestigeTitle: $("growth-prestige-title"),
    growthPrestige: $("growth-prestige"),
    btnPrestige: $("btn-prestige"),
    growthAchievements: $("growth-achievements"),
    growthAchCount: $("growth-ach-count"),
    growthStats: $("growth-stats"),
    growthStatsToggle: $("growth-stats-toggle"),
    growthCodex: $("growth-codex"),
    growthCodexList: $("growth-codex-list"),
    growthCheckinInfo: $("growth-checkin-info"),
    growthBank: $("growth-bank"),
    growthRoom: $("growth-room"),
    growthWorkCount: $("growth-work-count"),
    growthWork: $("growth-work"),
    btnCheckin: $("btn-checkin"),
    btnBank200: $("btn-bank-200"),
    btnBank1000: $("btn-bank-1000"),
    btnBankWithdraw: $("btn-bank-withdraw"),
    gacha: $("gacha"),
    gachaCoins: $("gacha-coins"),
    gachaPull: $("gacha-pull"),
    gachaResult: $("gacha-result"),
    minigame: $("minigame"),
    minigameStatus: $("minigame-status"),
    minigameArea: $("minigame-area"),
    minigameScore: $("minigame-score"),
    minigameStart: $("minigame-start"),
  };

  const PET_BOX = { width: 246, height: 188 };
  const LIB_PAGE_SIZE = 12;

  let state = null;
  let actions = [];
  let byName = new Map();
  let IDLE_ACTION = null;
  let WALK_ACTION = null;
  let baseAction = null;
  let libraryOpen = false;
  let shopOpen = false;
  let scheduleOpen = false;
  let configOpen = false;
  let growthOpen = false;
  let gachaOpen = false;
  let minigameOpen = false;
  let stickerOpen = false;
  const stickerState = { name: null, query: "", page: 0 };
  let stickerPendingDelete = null;
  let prestigePending = null;
  let quizOpen = false;
  let toolOpen = false;
  let toolStateRevision = 0;
  let updateStatus = null;
  let shopTab = "食物";
  const libState = { group: "全部", query: "", page: 0 };
  let libraryWindowSize = { width: 600, height: 400 };
  let currentAction = null;
  let activeLayer = null;
  let ambientTimer = null;
  let reactionTimer = null;
  let tickTimer = null;
  let saveTimer = null;
  let lastFrameAt = Date.now();
  let coinWindow = 0;
  let lastPaydayAt = 0;
  let lastPetAt = 0;
  let nextMumbleAt = 0;
  let dragging = null;
  let toastTimer = null;
  let bubbleTimer = null;
  let menuOpen = false;
  let busyUntil = 0;
  let systemSleeping = false;
  let lastHourlyCheck = new Date().getHours();

  // ------------------------------------------------------------- 基础工具
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function actionImageUrl(action) {
    return action && action.url ? action.url : `../assets/${action.file}`;
  }

  function actionThumbUrl(action) {
    return action && action.thumb ? action.thumb : `../assets/thumbs/${action.name}.png`;
  }

  function scheduleSave(delay) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(), delay === undefined ? 4000 : delay);
  }

  async function saveNow() {
    if (!state) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const bounds = await api.getBounds();
    if (bounds) state.window = { x: bounds.x, y: bounds.y };
    state.settings.baseAction = baseAction;
    await api.save(state, { revision: toolStateRevision });
  }

  function toast(text, ms) {
    el.toast.textContent = text;
    el.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms || 1800);
  }

  function speak(text, ms) {
    if (!state.settings.showBubble || state.settings.dnd) return;
    el.bubbleText.textContent = text;
    el.bubble.classList.add("show");
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => el.bubble.classList.remove("show"), ms || 2600);
  }

  function floatText(text, opts) {
    const options = opts || {};
    const node = document.createElement("div");
    node.className = `float${options.bad ? " bad" : ""}${options.heart ? " heart" : ""}`;
    node.textContent = text;
    node.style.left = `${options.x === undefined ? rand(110, 210) : options.x}px`;
    node.style.top = `${options.y === undefined ? rand(180, 230) : options.y}px`;
    el.fx.appendChild(node);
    setTimeout(() => node.remove(), 1500);
  }

  function bounce(className) {
    el.petWrap.classList.remove(className);
    // 强制重排，让同一个动画能连续播放
    void el.petWrap.offsetWidth;
    el.petWrap.classList.add(className);
    setTimeout(() => el.petWrap.classList.remove(className), 620);
  }

  // ------------------------------------------------------------- 音效
  let audioCtx = null;
  function playSound(kind) {
    if (!state || state.settings.sound === false) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const notes = {
        pet: [660, 880],
        coin: [880, 1180],
        feed: [520, 660, 780],
        play: [700, 900, 1100],
        upgrade: [440, 660, 880],
        buy: [600, 800],
        error: [300, 220],
        clock: [520, 660],
      }[kind] || [700];
      const now = audioCtx.currentTime;
      notes.forEach((freq, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const at = now + index * 0.07;
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.1);
      });
    } catch (err) {
      /* 音效失败不影响主流程 */
    }
  }

  // ------------------------------------------------------------- 事件 / 图鉴
  let wishTimer = null;

  function scheduleWish(delayMs) {
    if (wishTimer) clearTimeout(wishTimer);
    if (TEST_MODE) return;
    const wait = delayMs === undefined ? rand(20000, 45000) : delayMs;
    wishTimer = setTimeout(() => {
      if (!state.wish && !state.settings.dnd) G.createWish(state, undefined, actions);
      updateEventChips();
      scheduleSave(500);
      scheduleWish(rand(15, 30) * 60000);
    }, wait);
  }

  function updateEventChips() {
    const wish = G.wishStatus(state);
    if (wish && !wish.expired) {
      el.wishChip.textContent = `💭 想看${wish.group}类动作 +${wish.reward}（${Math.max(
        1,
        Math.ceil(wish.secondsLeft / 60)
      )}分）`;
      el.wishChip.classList.add("show");
    } else {
      el.wishChip.classList.remove("show");
      if (wish && wish.expired) {
        state.wish = null;
        scheduleWish();
      }
    }

    const visitor = G.visitorStatus(state);
    if (visitor) {
      el.visitorChip.textContent = `${visitor.icon} ${visitor.label} +${visitor.reward}（点我接待）`;
      el.visitorChip.classList.add("show");
    } else {
      el.visitorChip.classList.remove("show");
    }

    const jobs = G.workStatus(state);
    if (jobs.length) {
      const next = jobs.reduce((soonest, job) => (job.endsAt < soonest.endsAt ? job : soonest), jobs[0]);
      el.workChip.textContent = `💼 ${jobs.length} 人打工 · ${Math.ceil(next.secondsLeft / 60)} 分钟`;
      el.workChip.classList.add("show");
    } else {
      el.workChip.classList.remove("show");
    }

    if (el.quizChip) {
      const quizEvent = G.quizEventStatus(state, Date.now());
      if (quizEvent.available) {
        el.quizChip.textContent = "📚 题库事件：答对 +100（去答题）";
        el.quizChip.classList.add("show", "quiz");
      } else {
        el.quizChip.classList.remove("show");
      }
    }
    syncHudPosition();
  }

  function noteAction(action) {
    G.markSeen(state, action.name);
    const done = G.completeWish(state, action, Date.now());
    if (!done) return;
    toast(`心愿完成 +${done.reward} 金币`);
    playSound("coin");
    floatText(`💭 +${done.reward}`, { x: rand(120, 200), y: rand(160, 190) });
    updateHud(0);
    updateEventChips();
    scheduleWish(rand(15, 30) * 60000);
    updateMenu();
    if (growthOpen) renderGrowth();
  }

  function syncCompanion() {
    const existing = document.getElementById("companion-pet");
    const adopted = state.companion && state.companion.adopted && !G.workerUnavailable(state, "companion");
    if (adopted && !existing) {
      const img = new Image();
      img.id = "companion-pet";
      img.alt = "伙伴";
      img.src = "../assets/pet/idle_stand.webp";
      el.stage.appendChild(img);
    } else if (!adopted && existing) {
      existing.remove();
    }
  }

  // ------------------------------------------------------------- 鼠标命中区域
  // 主进程按这些矩形判断"光标是不是在 doro 身上"，从而决定窗口是否穿透。
  let hitboxTimer = null;
  function reportHitboxes() {
    if (hitboxTimer) return;
    hitboxTimer = setTimeout(() => {
      hitboxTimer = null;
      const boxes = [];
      const add = (node, pad) => {
        if (!node) return;
        const rect = node.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const p = pad || 0;
        boxes.push({
          x: Math.round(rect.left - p),
          y: Math.round(rect.top - p),
          w: Math.round(rect.width + p * 2),
          h: Math.round(rect.height + p * 2),
        });
      };
      add(el.petStack, 8);
      add(el.hud, 2);
      add(el.panel, 4);
      add(el.menu, 4);
      add(el.library, 4);
      add(el.shop, 4);
      add(el.schedule, 4);
      add(el.config, 4);
      add(el.growth, 4);
      add(el.gacha, 4);
      add(el.minigame, 4);
      add(el.quiz, 4);
      add(el.sticker, 4);
      api.setHitboxes(boxes);
    }, 30);
  }

  // ------------------------------------------------------------- 动作 / 动画
  function installActions(list) {
    const next = (Array.isArray(list) ? list : []).filter(Boolean);
    if (!next.length) return false;
    actions = next;
    byName = new Map(actions.map((action) => [action.name, action]));
    IDLE_ACTION = byName.has("idle_stand")
      ? "idle_stand"
      : (actions.find((action) => action.category === "idle") || actions[0]).name;
    WALK_ACTION = byName.has("walk_bag")
      ? "walk_bag"
      : (actions.find((action) => action.category === "walk") || actions[0]).name;
    return true;
  }

  function actionInfo(name) {
    return byName.get(name) || byName.get(baseAction) || byName.get(IDLE_ACTION) || actions[0];
  }

  function pickByCategory(...categories) {
    const pool = actions.filter((action) => categories.includes(action.category));
    const source = pool.length ? pool : actions;
    return source[Math.floor(Math.random() * source.length)];
  }

  function petDisplaySize(action) {
    const [w, h] = action.size;
    const scale = Math.min(PET_BOX.width / w, PET_BOX.height / h) * (state.settings.scale || 1);
    return {
      width: Math.max(24, Math.round(w * scale)),
      height: Math.max(24, Math.round(h * scale)),
    };
  }

  function layerFor(action) {
    const img = document.createElement("img");
    img.className = "pet-layer";
    img.draggable = false;
    img.alt = G.effectiveLabel(state, action);
    img.src = actionImageUrl(action);
    const size = petDisplaySize(action);
    img.style.width = `${size.width}px`;
    img.style.height = `${size.height}px`;
    return img;
  }

  function setAction(name, opts) {
    const options = opts || {};
    const action = actionInfo(name);
    if (!action) return;
    if (!options.force && currentAction === action.name && activeLayer) return;

    const next = layerFor(action);
    const previous = activeLayer;
    // 动画层挂到 #pet-stack 下，hop / hurt 这类作用在 pet-stack 上的反馈动画才能生效
    el.petStack.appendChild(next);
    currentAction = action.name;
    activeLayer = next;
    el.petLabel.textContent = `Lv.${state.level} ${G.titleForState(state)} · ${G.effectiveLabel(state, action)}`;
    syncHudPosition();
    reportHitboxes();

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      next.classList.add("in");
      if (previous) {
        previous.classList.remove("in");
        setTimeout(() => previous.remove(), 220);
      }
    };
    // 注意：这里不能用 requestAnimationFrame——窗口被遮挡 / 隐藏时 rAF 会被节流，
    // 会导致宠物层永远停在 opacity:0，重新显示窗口时宠物"消失"。
    if (next.complete) {
      reveal();
    } else {
      next.addEventListener("load", reveal, { once: true });
      next.addEventListener("error", reveal, { once: true });
      setTimeout(reveal, 2000);
    }
  }

  function playReaction(name, ms) {
    const action = actionInfo(name);
    if (!action) return;
    G.markSeen(state, action.name);
    setAction(action.name, { force: true });
    busyUntil = Date.now() + (ms || 2200);
    if (reactionTimer) clearTimeout(reactionTimer);
    reactionTimer = setTimeout(
      () => {
        if (Date.now() >= busyUntil) setAction(baseAction, { force: true });
      },
      (ms || 2200) + 40
    );
  }

  function scheduleAmbient(delay) {
    if (TEST_MODE) return;
    if (ambientTimer) clearTimeout(ambientTimer);
    const wait =
      delay === undefined ? G.nextActionDelay(undefined, state.settings.ambientIntervalSec) : delay;
    ambientTimer = setTimeout(() => {
      if (!dragging && !systemSleeping && !state.settings.dnd && Date.now() >= busyUntil) {
        const action = G.pickAmbientAction(actions, state);
        if (action && action.name !== currentAction) {
          playReaction(action.name, Math.min(6000, action.durationMs * 2 + 900));
          if (Math.random() < 0.45) speak(G.dialogueFor("auto", state), 2200);
        }
      }
      scheduleAmbient();
    }, wait);
  }

  // ------------------------------------------------------------- 界面刷新
  function updateHud(popCoin) {
    el.coinValue.textContent = G.formatCoins(state.coins);
    const rate = G.incomePerSecond(state);
    el.coinRate.textContent = `+${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)}/s`;
    el.coinRate.classList.toggle("hungry", state.satiety < G.BALANCE.hungryThreshold);

    el.chipSatiety.innerHTML = `🍚 <b>${Math.round(state.satiety)}</b>`;
    el.chipMood.innerHTML = `💗 <b>${Math.round(state.mood)}</b>`;
    el.chipSatiety.classList.toggle("low", state.satiety < G.BALANCE.hungryThreshold);
    el.chipMood.classList.toggle("low", state.mood < 30);

    el.panelCoins.textContent = G.formatCoins(state.coins);
    el.panelIncome.textContent = `+${rate.toFixed(2)} / 秒`;
    el.panelTotal.textContent = G.formatCoins(state.totalEarned);
    el.panelPets.textContent = `${state.stats.pets}`;
    el.barSatiety.style.width = `${state.satiety}%`;
    el.barMood.style.width = `${state.mood}%`;
    el.valSatiety.textContent = Math.round(state.satiety);
    el.valMood.textContent = Math.round(state.mood);

    const cost = G.upgradeCost(state);
    el.upgradeCost.textContent = `${cost}`;
    el.menuUpgradeCost.textContent = `${cost}`;
    el.btnUpgrade.disabled = state.coins < cost;
    el.btnFeed.disabled = state.coins < G.BALANCE.feedCost;
    el.btnPlay.disabled = state.coins < G.BALANCE.playCost;

    const hint = G.incomeBreakdown(state);
    if (hint.starving) {
      el.panelHint.textContent = `饿得不行了，产出只剩 ${Math.round(G.BALANCE.starvingMultiplier * 100)}%，快喂点饭！`;
    } else if (hint.hungry) {
      el.panelHint.textContent = `肚子饿了，产出只剩 ${Math.round(G.BALANCE.hungryMultiplier * 100)}%`;
    } else if (baseAction !== IDLE_ACTION)
      el.panelHint.textContent = `当前常驻动作：${actionInfo(baseAction).label}`;
    else el.panelHint.textContent = "右键 doro 可以打开菜单";

    if (popCoin) {
      el.coinPill.classList.remove("pop");
      void el.coinPill.offsetWidth;
      el.coinPill.classList.add("pop");
    }
  }

  function updateMenu() {
    el.menu.querySelectorAll("[data-toggle]").forEach((button) => {
      const key = button.dataset.toggle;
      button.classList.toggle("on", Boolean(state.settings[key]));
    });
    if (el.menuLibraryCount) {
      const progress = G.trainingProgress(state, actions);
      el.menuLibraryCount.textContent = `${progress.points} 训练点`;
    }
    if (el.menuScheduleCount) {
      el.menuScheduleCount.textContent = state.schedule.length ? `${state.schedule.length} 条` : "";
    }
    if (el.menuTaskCount) {
      const readyCount =
        G.dailyTasks(state).filter((task) => task.ready && !task.claimed).length +
        G.achievementList(state).filter((item) => item.ready && !item.claimed).length;
      el.menuTaskCount.textContent = readyCount ? `${readyCount} 可领` : "";
    }
    if (el.menuStickerCount) {
      const stickers = actions.filter((action) => G.isStickerAction(action));
      el.menuStickerCount.textContent = `${stickers.filter((action) => G.stickerRandomAllowed(state, action)).length}/${stickers.length}`;
    }
    if (el.menuQuizSummary) {
      const daily = G.quizDailyStatus(state, Date.now());
      el.menuQuizSummary.textContent = daily.done ? "今日已答" : "今日未答";
    }
  }

  // ------------------------------------------------------------- 动作库
  function resizeLibraryWindow(width, height) {
    const next = {
      width: Math.min(900, Math.max(560, Math.round(width))),
      height: Math.min(700, Math.max(380, Math.round(height))),
    };
    libraryWindowSize = next;
    el.librarySize.textContent = `${next.width} × ${next.height}`;
    api.setUiSize(next);
  }

  function libraryGroups() {
    return [
      "全部",
      "可训练",
      "收藏",
      "最近",
      ...new Set(actions.map((action) => action.group).filter(Boolean)),
    ];
  }

  function filteredActions() {
    const query = libState.query.trim().toLowerCase();
    let items;
    if (libState.group === "可训练") {
      items = actions.filter((action) => G.isTrainingEligible(action) && !G.isUnlocked(state, action));
    } else if (libState.group === "收藏") {
      items = state.favorites.map((name) => byName.get(name)).filter(Boolean);
    } else if (libState.group === "最近") {
      items = state.recent.map((name) => byName.get(name)).filter(Boolean);
    } else {
      items = actions.filter((action) => libState.group === "全部" || action.group === libState.group);
    }
    return items.filter((action) => {
      if (G.isStickerHidden(state, action)) return false;
      if (!query) return true;
      return (
        G.effectiveLabel(state, action).toLowerCase().includes(query) ||
        action.name.includes(query) ||
        String(action.category || "").includes(query)
      );
    });
  }

  function dressIndex(name) {
    return actions
      .filter((action) => action.category === "dress")
      .findIndex((action) => action.name === name);
  }

  function toggleFavorite(name) {
    if (state.favorites.includes(name)) {
      state.favorites = state.favorites.filter((entry) => entry !== name);
    } else {
      state.favorites = [name, ...state.favorites].slice(0, 100);
    }
    renderLibrary();
    scheduleSave(400);
  }

  function selectAction(action) {
    baseAction = action.name;
    busyUntil = 0;
    setAction(baseAction, { force: true });
    state.recent = [action.name, ...state.recent.filter((name) => name !== action.name)].slice(0, 12);
    G.bumpDaily(state, "actionsViewed");
    noteAction(action);
    speak(`换成「${G.effectiveLabel(state, action)}」`, 1800);
    updateMenu();
    updateHud(0);
    renderLibrary();
    scheduleSave(500);
  }

  function renderLibrary() {
    const items = filteredActions();
    const pages = Math.max(1, Math.ceil(items.length / LIB_PAGE_SIZE));
    libState.page = Math.min(Math.max(0, libState.page), pages - 1);
    const training = G.trainingProgress(state, actions);
    el.libraryCount.textContent = `${training.learned}/${training.total} 已学 · ${training.points} 训练点`;
    el.librarySize.textContent = `${libraryWindowSize.width} × ${libraryWindowSize.height}`;

    el.libraryTabs.innerHTML = "";
    libraryGroups().forEach((group) => {
      const button = document.createElement("button");
      button.textContent = group;
      button.classList.toggle("active", group === libState.group);
      button.addEventListener("click", () => {
        libState.group = group;
        libState.page = 0;
        renderLibrary();
      });
      el.libraryTabs.appendChild(button);
    });

    el.libraryGrid.innerHTML = "";
    const start = libState.page * LIB_PAGE_SIZE;
    items.slice(start, start + LIB_PAGE_SIZE).forEach((action) => {
      const button = document.createElement("button");
      const unlocked = G.isUnlocked(state, action);
      const price = action.category === "dress" ? G.dressPrice(Math.max(0, dressIndex(action.name))) : 0;
      const trainingLock = G.isTrainingEligible(action) && !G.isUnlocked(state, action);
      const trainingPrice = trainingLock ? G.trainingCost(action) : 0;
      button.className = `lib-item${action.name === baseAction ? " active" : ""}${unlocked ? "" : " locked"}`;
      button.title = `${G.effectiveLabel(state, action)} · ${action.category}${action.blocked ? " · 不参与随机" : ""}${
        unlocked ? "" : trainingLock ? ` · ${trainingPrice} 训练点学习` : ` · ${price} 币解锁`
      }`;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = actionThumbUrl(action);
      img.alt = G.effectiveLabel(state, action);
      const text = document.createElement("span");
      text.textContent = G.effectiveLabel(state, action);
      const star = document.createElement("i");
      star.className = `lib-star${state.favorites.includes(action.name) ? " on" : ""}`;
      star.textContent = "★";
      star.title = "收藏";
      star.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(action.name);
      });
      button.append(img, text, star);
      if (!unlocked) {
        const lock = document.createElement("span");
        lock.className = "lib-lock";
        lock.textContent = trainingLock ? `训${trainingPrice}` : "🔒";
        button.appendChild(lock);
      }
      if (action.blocked) {
        const blocked = document.createElement("span");
        blocked.className = "lib-block";
        blocked.textContent = "⚠";
        blocked.title = "不参与随机表演";
        button.appendChild(blocked);
      }
      button.addEventListener("click", () => {
        if (!unlocked) {
          if (trainingLock) {
            const result = G.learnAction(state, action);
            if (!result.ok) {
              toast(`训练点不足：需要 ${result.cost}，当前 ${result.points}`);
              return;
            }
            playSound("upgrade");
            toast(`学会「${G.effectiveLabel(state, action)}」，消耗 ${result.cost} 训练点`);
            updateMenu();
            scheduleSave(500);
            selectAction(action);
            return;
          }
          shopTab = "装扮";
          openSidePanel("shop");
          toast(`先去商城解锁「${G.effectiveLabel(state, action)}」（${price} 币）`);
          return;
        }
        selectAction(action);
      });
      el.libraryGrid.appendChild(button);
    });

    el.libraryPage.textContent = `${libState.page + 1} / ${pages}`;
    el.libraryPrev.disabled = libState.page <= 0;
    el.libraryNext.disabled = libState.page >= pages - 1;
  }

  // ------------------------------------------------------------- 配置中心
  function renderConfig() {
    const settings = state.settings;
    const ambient = Math.round(settings.ambientIntervalSec || 60);
    const walk = Math.round(settings.roamSpeed || 55);
    const scale = Math.round((settings.scale || 1) * 100);
    el.cfgAmbient.value = String(Math.min(600, Math.max(5, ambient)));
    el.cfgAmbientVal.textContent = `${ambient} 秒`;
    el.cfgWalk.value = String(Math.min(200, Math.max(20, walk)));
    el.cfgWalkVal.textContent = `${walk} px/秒`;
    el.cfgScale.value = String(Math.min(150, Math.max(70, scale)));
    el.cfgScaleVal.textContent = `${scale}%`;
    el.config.querySelectorAll("[data-toggle]").forEach((button) => {
      button.classList.toggle("on", Boolean(settings[button.dataset.toggle]));
    });
    if (el.cfgQuizApi) el.cfgQuizApi.value = settings.quizApiBase || "";
    if (el.cfgUpdateFeed) el.cfgUpdateFeed.value = settings.updateFeedUrl || "";
    renderUpdateStatus();
  }

  function renderUpdateStatus() {
    if (!el.cfgUpdateStatus) return;
    const status = updateStatus;
    if (!status) {
      el.cfgUpdateStatus.textContent = "尚未检查更新";
      return;
    }
    const labels = {
      dev: "开发模式（打包后可用）",
      idle: "等待检查",
      checking: "正在检查更新…",
      available: `发现新版本 v${status.version || ""}`,
      "not-available": "已是最新版本",
      downloading: `正在下载 ${status.percent || 0}%`,
      downloaded: `v${status.version || ""} 已下载，重启后安装`,
      error: `检查失败：${status.message || "未知错误"}`,
    };
    el.cfgUpdateStatus.textContent = labels[status.state] || status.state;
  }

  function growthRow(options) {
    const row = document.createElement("div");
    row.className = "growth-item";
    const main = document.createElement("div");
    main.className = "growth-main";
    const head = document.createElement("div");
    head.className = "growth-title";
    const title = document.createElement("span");
    title.textContent = options.title;
    const info = document.createElement("em");
    info.textContent = options.claimed
      ? "已领取"
      : `${options.progress}/${options.goal} · +${options.reward}`;
    head.append(title, info);
    const bar = document.createElement("div");
    bar.className = "growth-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(100, (options.progress / options.goal) * 100)}%`;
    bar.appendChild(fill);
    main.append(head, bar);

    const button = document.createElement("button");
    button.textContent = options.claimed ? "已领" : options.ready ? "领取" : "进行中";
    button.disabled = options.claimed || !options.ready;
    button.addEventListener("click", options.onClaim);
    row.append(main, button);
    return row;
  }

  function workRewardLabel(reward) {
    if (reward.type === "coins") return `${G.formatCoins(reward.amount)} 金币`;
    if (reward.type === "food") {
      const item = G.SHOP_ITEMS[reward.itemId];
      return `${item ? item.icon : "🍱"}${item ? item.name : "食物"}×${reward.amount}`;
    }
    return `装扮碎片×${reward.amount}`;
  }

  function dispatchWorker(worker, hours) {
    const result = G.dispatchWorker(state, worker, hours, Date.now());
    if (!result.ok) {
      const messages = {
        busy: "这名打工者已经出门了",
        full: "最多只能同时派两个人打工",
        missing: worker === "companion" ? "还没有伙伴 doro" : "当前没有可派遣的访客",
      };
      toast(messages[result.reason] || "暂时无法派遣");
      return;
    }
    toast(`${result.job.icon} ${result.job.label} 已出发 ${hours} 小时`);
    syncCompanion();
    updateEventChips();
    renderGrowth();
    scheduleSave(500);
  }

  function collectWork(silent) {
    const finished = G.collectFinishedJobs(state, Date.now());
    if (!finished.length) return finished;
    const summary = finished.map((job) => `${job.icon} ${workRewardLabel(job.reward)}`).join("；");
    toast(`打工归来：${summary}`, 4200);
    speak(`打工回来啦，带了${summary}`, 3600);
    playSound("coin");
    syncCompanion();
    updateHud(0);
    updateEventChips();
    updateMenu();
    if (growthOpen) renderGrowth();
    scheduleSave(500);
    if (!silent) api.notify({ title: "doro 打工归来", body: summary });
    return finished;
  }

  function exchangeWorkFragments() {
    const result = G.exchangeFragments(state, actions, Date.now());
    if (!result.ok) {
      toast("装扮碎片不足，需要 5 枚");
      return;
    }
    if (result.type === "dress") {
      toast(`碎片兑换成功：${result.action.label}`);
      speak(`换到了「${result.action.label}」`, 2400);
      renderLibrary();
    } else {
      toast(`没有可兑换装扮，碎片换成 ${G.formatCoins(result.amount)} 金币`);
    }
    playSound("coin");
    updateHud(0);
    renderGrowth();
    scheduleSave(500);
  }

  function renderGrowth() {
    el.growthCoins.textContent = `${G.formatCoins(state.coins)} 金币`;
    el.growthDailyDate.textContent = G.dayKey();
    el.growthDaily.innerHTML = "";
    G.dailyTasks(state).forEach((task) => {
      el.growthDaily.appendChild(
        growthRow({
          title: task.label,
          progress: task.progress,
          goal: task.goal,
          reward: task.reward,
          claimed: task.claimed,
          ready: task.ready,
          onClaim: () => {
            const result = G.claimDaily(state, task.id, Date.now());
            if (!result.ok) return;
            playSound("coin");
            toast(`任务完成，+${result.reward} 金币`);
            updateHud(0);
            renderGrowth();
            updateMenu();
            scheduleSave(600);
          },
        })
      );
    });

    const profile = G.profileDetails(state);
    const training = G.trainingProgress(state, actions);
    el.growthProfileTitle.textContent = `${profile.personality.icon} ${profile.personality.name}`;
    el.growthProfile.textContent = `${profile.personality.desc} · 喜欢：${profile.likes
      .map((item) => `${item.icon}${item.name}`)
      .join("、")} · 不喜欢：${profile.dislikes
      .map((item) => `${item.icon}${item.name}`)
      .join("、")} · 招式 ${training.learned}/${training.total} · ${training.points} 训练点`;

    const intimacy = G.intimacyStatus(state);
    const unlockedActionNames = Object.entries(G.INTIMACY_ACTIONS)
      .filter(([level]) => intimacy.level >= Number(level))
      .map(([, name]) => (byName.get(name) ? `「${byName.get(name).label}」` : ""))
      .filter(Boolean)
      .join("、");
    el.growthIntimacyTitle.textContent = `Lv.${intimacy.level} ${intimacy.name} · ${intimacy.points}`;
    el.growthIntimacy.textContent = `${
      intimacy.nextAt ? `距离下一阶段还差 ${intimacy.nextAt - intimacy.points} 点。` : "已经是最高亲密度。"
    }${unlockedActionNames ? ` 专属动作：${unlockedActionNames}。` : ""}${
      intimacy.level >= 5 ? " 专属装扮：蝴蝶结。" : ""
    }`;

    const diary = state.diary.entries.slice().reverse();
    el.growthDiaryTitle.textContent = `${diary.length} 篇`;
    el.growthDiary.innerHTML = "";
    if (!diary.length) {
      const empty = document.createElement("div");
      empty.className = "diary-entry";
      empty.textContent = "今天的故事还在写，跨天后会生成第一篇日记。";
      el.growthDiary.appendChild(empty);
    } else {
      diary.slice(0, 10).forEach((entry) => {
        const row = document.createElement("div");
        row.className = "diary-entry";
        const date = document.createElement("b");
        date.textContent = entry.date;
        row.append(date, document.createTextNode(entry.text));
        el.growthDiary.appendChild(row);
      });
    }

    const prestige = G.prestigeStatus(state);
    el.growthPrestigeTitle.textContent = prestige.count
      ? `${prestige.title} · ${prestige.count} 转`
      : `Lv.${prestige.requiredLevel} 解锁`;
    el.growthPrestige.textContent = prestige.count
      ? `永久产出 ×${prestige.multiplier.toFixed(2)} · 累计重置等级 ${prestige.legacyLevel} · 下次转生 ×${prestige.nextMultiplier.toFixed(
          2
        )}${prestige.nextTitle ? ` · 下一称号「${prestige.nextTitle}」` : ""}`
      : `达到 Lv.${prestige.requiredLevel} 后可重置等级，获得永久产出 ×${prestige.nextMultiplier.toFixed(
          2
        )} 和限定称号。图鉴、招式、装扮、伙伴与金币全部保留。`;
    el.btnPrestige.disabled = !prestige.eligible;
    el.btnPrestige.textContent = !prestige.eligible
      ? `Lv.${prestige.requiredLevel} 解锁转生`
      : prestigePending === "confirm"
        ? "再次点击确认转生"
        : prestige.count
          ? "再次转生"
          : "转生";

    const codex = G.codexSummary(state, actions);
    el.growthCodex.textContent = `${codex.seen} / ${codex.total}`;
    el.growthCodexList.textContent = Object.entries(codex.groups)
      .map(([group, stat]) => `${group} ${stat.seen}/${stat.total}`)
      .join(" · ");

    const checkin = G.checkinStatus(state);
    el.growthCheckinInfo.textContent = checkin.canCheckin
      ? `连续 ${checkin.streak} 天`
      : `今日已签 · 连续 ${checkin.streak} 天`;
    el.btnCheckin.disabled = !checkin.canCheckin;
    el.btnCheckin.textContent = checkin.canCheckin ? "签到" : "已签";

    const bank = G.bankStatus(state);
    el.btnBank200.disabled = bank.amount > 0 || state.coins < 200;
    el.btnBank1000.disabled = bank.amount > 0 || state.coins < 1000;
    el.btnBankWithdraw.disabled = !bank.ready;
    el.growthBank.textContent =
      bank.amount > 0
        ? bank.ready
          ? `已存 ${G.formatCoins(bank.amount)}，现在可取 ${G.formatCoins(bank.payout)}`
          : `已存 ${G.formatCoins(bank.amount)}，约 ${Math.ceil(bank.secondsLeft / 3600)} 小时后可取 ${G.formatCoins(bank.payout)}`
        : `8 小时 15% 利息，最低 200 金币`;

    const room = (state.room && state.room.furniture) || [];
    el.growthRoom.textContent = room.length
      ? `房间：${room.map((id) => (G.FURNITURE[id] ? G.FURNITURE[id].icon : "")).join(" ")}（合计 +${Math.round(
          G.roomBonusValue(state) * 100
        )}%）`
      : "房间还空着，去商城「家具」看看";

    const jobs = G.workStatus(state);
    const visitor = G.visitorStatus(state);
    const companionHome =
      state.companion && state.companion.adopted && !G.workerUnavailable(state, "companion");
    el.growthWorkCount.textContent = `${jobs.length}/2 工位 · 碎片 ${state.work.fragments}`;
    el.growthWork.innerHTML = "";
    const workSection = document.createElement("div");
    workSection.className = "work-section";
    const addWorker = (worker, icon, label, available) => {
      const row = document.createElement("div");
      row.className = "work-worker";
      const text = document.createElement("span");
      text.textContent = `${icon} ${label}`;
      row.appendChild(text);
      [2, 4, 8].forEach((hours) => {
        const button = document.createElement("button");
        button.textContent = `${hours}h`;
        button.disabled = !available || jobs.length >= 2;
        button.title = `派遣 ${hours} 小时`;
        button.addEventListener("click", () => dispatchWorker(worker, hours));
        row.appendChild(button);
      });
      if (worker === "visitor") {
        const dismiss = document.createElement("button");
        dismiss.className = "work-dismiss";
        dismiss.textContent = "请回";
        dismiss.title = "让访客离开";
        dismiss.addEventListener("click", () => {
          if (!G.dismissVisitor(state)) return;
          toast("访客已经回去了");
          updateEventChips();
          renderGrowth();
          scheduleSave(400);
        });
        row.appendChild(dismiss);
      }
      workSection.appendChild(row);
    };
    if (visitor) addWorker("visitor", visitor.icon, visitor.label, true);
    if (state.companion && state.companion.adopted) {
      addWorker(
        "companion",
        "🐣",
        companionHome ? "伙伴 doro（在家）" : "伙伴 doro（打工中）",
        companionHome
      );
    }
    if (!visitor && !(state.companion && state.companion.adopted)) {
      const empty = document.createElement("div");
      empty.className = "work-job";
      empty.textContent = "等待访客，或去商城领养伙伴 doro";
      workSection.appendChild(empty);
    }
    jobs.forEach((job) => {
      const row = document.createElement("div");
      row.className = "work-job";
      const text = document.createElement("span");
      text.textContent = `${job.icon} ${job.label} · ${job.hours}h · ${
        job.ready ? "等待领取" : `${Math.max(1, Math.ceil(job.secondsLeft / 60))} 分钟后回来`
      } · ${workRewardLabel(job.reward)}`;
      row.appendChild(text);
      if (job.ready) {
        const claim = document.createElement("button");
        claim.textContent = "领取";
        claim.addEventListener("click", () => collectWork(false));
        row.appendChild(claim);
      }
      workSection.appendChild(row);
    });
    const fragment = document.createElement("button");
    fragment.className = "work-fragment-button";
    fragment.textContent = "5 碎片兑换装扮";
    fragment.disabled = state.work.fragments < 5;
    fragment.addEventListener("click", exchangeWorkFragments);
    workSection.appendChild(fragment);
    el.growthWork.appendChild(workSection);

    const achievements = G.achievementList(state);
    el.growthAchCount.textContent = `${achievements.filter((item) => item.claimed).length}/${achievements.length}`;
    el.growthAchievements.innerHTML = "";
    achievements.forEach((item) => {
      el.growthAchievements.appendChild(
        growthRow({
          title: item.label,
          progress: item.value,
          goal: item.goal,
          reward: item.reward,
          claimed: item.claimed,
          ready: item.ready,
          onClaim: () => {
            const result = G.claimAchievement(state, item.id);
            if (!result.ok) return;
            playSound("coin");
            toast(`成就达成，+${result.reward} 金币`);
            updateHud(0);
            renderGrowth();
            updateMenu();
            scheduleSave(600);
          },
        })
      );
    });

    const stats = G.analyticsSummary(state);
    el.growthStatsToggle.textContent = state.settings.analytics ? "已开启" : "已关闭";
    el.growthStats.textContent = state.settings.analytics
      ? `累计 ${stats.days} 天 · 今日 ${Math.round(stats.todaySeconds / 60)} 分钟 · 会话 ${stats.sessions} 次（仅存本机）`
      : "在配置中心开启「本地统计」后显示；只存本机，不上传。";
  }

  function renderGacha() {
    el.gachaCoins.textContent = `${G.formatCoins(state.coins)} 金币`;
    el.gachaPull.disabled = state.coins < G.GACHA_PRICE;
  }

  const mini = { running: false, score: 0, spawnTimer: null, endTimer: null };

  function renderMinigame() {
    const status = G.minigameStatus(state);
    el.minigameStatus.textContent = mini.running
      ? "进行中…"
      : status.ready
        ? "15 秒，点金币得分"
        : `冷却 ${Math.ceil(status.secondsLeft / 60)} 分钟`;
    el.minigameStart.disabled = mini.running || !status.ready;
    el.minigameScore.textContent = String(mini.score);
  }

  const STICKER_PAGE_SIZE = 8;

  function stickerItems() {
    const query = stickerState.query.trim().toLowerCase();
    return actions
      .filter((action) => G.isStickerAction(action))
      .filter((action) => !G.isStickerHidden(state, action))
      .filter((action) => {
        if (!query) return true;
        return G.effectiveLabel(state, action).toLowerCase().includes(query) || action.name.includes(query);
      });
  }

  function renderSticker() {
    const all = actions.filter((action) => G.isStickerAction(action) && !G.isStickerHidden(state, action));
    const items = stickerItems();
    const pages = Math.max(1, Math.ceil(items.length / STICKER_PAGE_SIZE));
    stickerState.page = Math.min(Math.max(0, stickerState.page), pages - 1);
    el.stickerCount.textContent = `${all.filter((action) => G.stickerRandomAllowed(state, action)).length} / ${
      all.length
    } 参与随机`;

    const selected = items.find((action) => action.name === stickerState.name) || items[0] || null;
    if (!selected) {
      stickerState.name = null;
      el.stickerPreviewImg.removeAttribute("src");
      el.stickerPreviewImg.alt = "";
      el.stickerRename.value = "";
      el.stickerRename.disabled = true;
      el.stickerPreviewRandom.disabled = true;
      el.stickerPreviewRandom.classList.remove("on");
      el.stickerPreviewRandom.textContent = "随机：关";
      el.stickerDelete.disabled = true;
      el.stickerDelete.textContent = "删除";
      stickerPendingDelete = null;
      el.stickerGrid.innerHTML = '<div class="sticker-empty">没有匹配的表情包</div>';
      el.stickerPage.textContent = "0 / 0";
      el.stickerPrev.disabled = true;
      el.stickerNext.disabled = true;
      return;
    }
    stickerState.name = selected.name;
    el.stickerRename.disabled = false;
    el.stickerPreviewRandom.disabled = false;
    el.stickerPreviewImg.src = actionImageUrl(selected);
    el.stickerPreviewImg.alt = G.effectiveLabel(state, selected);
    el.stickerRename.value = G.effectiveLabel(state, selected);
    const allowed = G.stickerRandomAllowed(state, selected);
    el.stickerPreviewRandom.classList.toggle("on", allowed);
    el.stickerPreviewRandom.textContent = allowed ? "随机：开" : "随机：关";
    el.stickerDelete.disabled = false;
    el.stickerDelete.title = selected.user ? "删除这个自定义表情包" : "隐藏这个内置表情包";
    el.stickerDelete.textContent = "删除";
    stickerPendingDelete = null;

    el.stickerGrid.innerHTML = "";
    const start = stickerState.page * STICKER_PAGE_SIZE;
    items.slice(start, start + STICKER_PAGE_SIZE).forEach((action) => {
      const button = document.createElement("button");
      button.className = `sticker-item${action.name === stickerState.name ? " active" : ""}`;
      button.title = `${G.effectiveLabel(state, action)} · ${G.stickerRandomAllowed(state, action) ? "参与随机" : "不参与随机"}`;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = actionThumbUrl(action);
      img.alt = G.effectiveLabel(state, action);
      const label = document.createElement("span");
      label.textContent = G.effectiveLabel(state, action);
      const star = document.createElement("i");
      star.className = "sticker-star";
      star.textContent = state.favorites.includes(action.name) ? "★" : "";
      star.title = "收藏";
      star.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(action.name);
        renderSticker();
      });
      const flag = document.createElement("i");
      flag.className = "sticker-flag";
      flag.textContent = G.stickerRandomAllowed(state, action) ? "●" : "○";
      button.append(img, label, star, flag);
      button.addEventListener("click", () => {
        stickerState.name = action.name;
        renderSticker();
      });
      el.stickerGrid.appendChild(button);
    });

    el.stickerPage.textContent = `${stickerState.page + 1} / ${pages}`;
    el.stickerPrev.disabled = stickerState.page <= 0;
    el.stickerNext.disabled = stickerState.page >= pages - 1;
  }

  function stopMinigame(reward) {
    if (!mini.running) return;
    mini.running = false;
    clearInterval(mini.spawnTimer);
    clearTimeout(mini.endTimer);
    mini.spawnTimer = null;
    mini.endTimer = null;
    el.minigameArea.innerHTML = "";
    if (reward !== false) {
      const trainingBefore = state.training.points;
      const coins = G.finishMinigame(state, mini.score, Date.now());
      const trainingGain = state.training.points - trainingBefore;
      toast(`接金币得分 ${mini.score}，+${coins} 金币 · +${trainingGain} 训练点`);
      playSound("coin");
      updateHud(0);
      scheduleSave(600);
    }
    renderMinigame();
    if (growthOpen) renderGrowth();
  }

  function spawnMinigameCoin() {
    const area = el.minigameArea;
    if (!area) return;
    const coin = document.createElement("span");
    coin.className = "minigame-coin";
    coin.textContent = "🪙";
    coin.style.left = `${5 + Math.random() * (area.clientWidth - 40)}px`;
    coin.style.top = `${5 + Math.random() * (area.clientHeight - 40)}px`;
    coin.addEventListener("click", (event) => {
      event.stopPropagation();
      mini.score += 1;
      el.minigameScore.textContent = String(mini.score);
      coin.remove();
    });
    area.appendChild(coin);
    setTimeout(() => coin.remove(), 1800);
  }

  function startMinigame() {
    if (mini.running) return;
    const status = G.minigameStatus(state);
    if (!status.ready) return;
    mini.running = true;
    mini.score = 0;
    el.minigameArea.innerHTML = "";
    renderMinigame();
    mini.spawnTimer = setInterval(spawnMinigameCoin, 450);
    mini.endTimer = setTimeout(() => stopMinigame(true), 15000);
    spawnMinigameCoin();
  }

  function openSidePanel(name) {
    if (name === "quiz") {
      openQuizWindow("home");
      return;
    }
    if (!TEST_MODE && EXTERNAL_TOOLS.has(name)) {
      void openToolWindow(name, name === "shop" ? { tab: shopTab } : undefined);
      return;
    }
    libraryOpen = name === "library";
    shopOpen = name === "shop";
    scheduleOpen = name === "schedule";
    configOpen = name === "config";
    growthOpen = name === "growth";
    gachaOpen = name === "gacha";
    minigameOpen = name === "minigame";
    stickerOpen = name === "sticker";
    closeMenu();
    el.panel.classList.remove("show");
    document.body.classList.add("lib-open");
    api.setUiSize(libraryOpen ? libraryWindowSize : { width: 600, height: 400 });
    el.library.classList.toggle("show", libraryOpen);
    el.shop.classList.toggle("show", shopOpen);
    el.schedule.classList.toggle("show", scheduleOpen);
    el.config.classList.toggle("show", configOpen);
    el.growth.classList.toggle("show", growthOpen);
    el.gacha.classList.toggle("show", gachaOpen);
    el.minigame.classList.toggle("show", minigameOpen);
    el.sticker.classList.toggle("show", stickerOpen);
    if (libraryOpen) renderLibrary();
    if (shopOpen) renderShop();
    if (scheduleOpen) renderSchedule();
    if (configOpen) renderConfig();
    if (growthOpen) renderGrowth();
    if (gachaOpen) renderGacha();
    if (minigameOpen) renderMinigame();
    if (stickerOpen) renderSticker();
    if (libraryOpen) setTimeout(() => el.librarySearch.focus(), 60);
    setTimeout(syncHudPosition, 60);
    reportHitboxes();
  }

  function closeSidePanels() {
    if (
      !libraryOpen &&
      !shopOpen &&
      !scheduleOpen &&
      !configOpen &&
      !growthOpen &&
      !gachaOpen &&
      !minigameOpen &&
      !stickerOpen
    )
      return;
    libraryOpen = false;
    shopOpen = false;
    scheduleOpen = false;
    configOpen = false;
    growthOpen = false;
    gachaOpen = false;
    minigameOpen = false;
    stickerOpen = false;
    document.body.classList.remove("lib-open");
    api.setUiSize({ width: 320, height: 360 });
    el.library.classList.remove("show");
    el.shop.classList.remove("show");
    el.schedule.classList.remove("show");
    el.config.classList.remove("show");
    el.growth.classList.remove("show");
    el.gacha.classList.remove("show");
    el.minigame.classList.remove("show");
    el.sticker.classList.remove("show");
    setTimeout(syncHudPosition, 60);
    reportHitboxes();
  }

  async function openQuizWindow(mode) {
    await saveNow();
    closeMenu();
    closeSidePanels();
    await api.openQuizWindow(mode || "home");
  }

  async function openToolWindow(name, options) {
    await saveNow();
    closeMenu();
    closeSidePanels();
    await api.openToolWindow(name, options);
  }

  function applySharedToolState(payload) {
    if (!payload || !payload.save || typeof payload.save !== "object") return;
    toolStateRevision = Math.max(toolStateRevision, Number(payload.revision) || 0);
    if (Array.isArray(payload.actions)) installActions(payload.actions);
    state = G.hydrate(payload.save, payload.now || Date.now());
    baseAction = byName.has(state.settings.baseAction) ? state.settings.baseAction : IDLE_ACTION;
    if (!G.isUnlocked(state, byName.get(baseAction))) baseAction = IDLE_ACTION;
    applyTheme();
    applyVisualScale();
    syncCompanion();
    updateHud(0);
    updateMenu();
    updateEventChips();
    if (growthOpen) renderGrowth();
    if (G.isStickerHidden(state, byName.get(baseAction))) baseAction = IDLE_ACTION;
    if (!byName.has(currentAction) || G.isStickerHidden(state, byName.get(currentAction))) {
      setAction(baseAction, { force: true });
    } else {
      const action = byName.get(currentAction);
      if (action) {
        el.petLabel.textContent = `Lv.${state.level} ${G.titleForState(state)} · ${G.effectiveLabel(
          state,
          action
        )}`;
      }
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function openLibrary() {
    openSidePanel("library");
  }

  function closeLibrary() {
    closeSidePanels();
  }

  // ------------------------------------------------------------- 商城
  const SHOP_TABS = ["食物", "玩具", "增益", "主题", "家具", "装扮", "典藏"];

  function dressShopItems() {
    return actions
      .filter((action) => action.category === "dress")
      .map((action, index) => ({
        id: `dress:${action.name}`,
        name: action.label,
        type: "dress",
        action: action.name,
        price: G.dressPrice(index),
        icon: "👗",
        desc: G.isUnlocked(state, action) ? "已解锁" : "解锁后可在动作库选用",
      }));
  }

  function shopCatalog(tab) {
    if (tab === "装扮") return dressShopItems();
    if (tab === "家具") {
      return Object.values(G.FURNITURE).map((item) => ({
        id: `furniture:${item.id}`,
        name: item.name,
        type: item.id === "companion" ? "companion" : "furniture",
        furnitureId: item.id,
        price: item.price,
        icon: item.icon,
        desc: item.desc,
      }));
    }
    const map = {
      食物: ["food"],
      玩具: ["toy"],
      增益: ["buff", "permanent"],
      主题: ["theme"],
      典藏: ["luxury", "profile"],
    };
    return Object.values(G.SHOP_ITEMS).filter((item) => (map[tab] || []).includes(item.type));
  }

  function shopOwned(item) {
    if (item.type === "dress") return G.isUnlocked(state, { category: "dress", name: item.action }) ? 1 : 0;
    if (item.type === "permanent") return state.perks[item.id] ? 1 : 0;
    if (item.type === "luxury") return state.perks[item.id] ? 1 : 0;
    if (item.type === "theme") return state.perks[`theme_${item.theme}`] ? 1 : 0;
    if (item.type === "furniture") {
      return state.room && state.room.furniture.includes(item.furnitureId) ? 1 : 0;
    }
    if (item.type === "companion") return state.companion && state.companion.adopted ? 1 : 0;
    return state.inventory[item.id] || 0;
  }

  function applyTheme() {
    document.body.dataset.theme = state.settings.theme || "default";
  }

  function applyVisualScale() {
    // 宠物缩小时状态区一起缩小；放大时 HUD 保持原尺寸，避免占满桌宠窗口。
    const scale = Math.min(1, Math.max(0.6, Number(state.settings.scale) || 1));
    el.stage.style.setProperty("--pet-ui-scale", scale.toFixed(2));
  }

  function syncHudPosition() {
    if (!state || !el.hud || !el.petStack) return;
    const scale = Math.min(1, Math.max(0.6, Number(state.settings.scale) || 1));
    const petRect = el.petStack.getBoundingClientRect();
    const hudHeight = el.hud.offsetHeight * scale;
    const gap = 12 * scale;
    const top = Math.max(8, Math.round(petRect.top - hudHeight - gap));
    el.stage.style.setProperty("--hud-top", `${top}px`);
  }

  function equipTheme(theme) {
    state.settings.theme = theme;
    applyTheme();
    renderShop();
    toast("主题已切换");
    scheduleSave(500);
  }

  function renderShop() {
    el.shopBalance.textContent = `${G.formatCoins(state.coins)} 金币`;
    el.shopTabs.innerHTML = "";
    SHOP_TABS.forEach((tab) => {
      const button = document.createElement("button");
      button.textContent = tab;
      button.classList.toggle("active", tab === shopTab);
      button.addEventListener("click", () => {
        shopTab = tab;
        renderShop();
      });
      el.shopTabs.appendChild(button);
    });

    el.shopList.innerHTML = "";
    shopCatalog(shopTab).forEach((item) => {
      const owned = shopOwned(item);
      const row = document.createElement("div");
      row.className = "shop-item";

      const icon = document.createElement("span");
      icon.className = "shop-icon";
      icon.textContent = item.icon;

      const main = document.createElement("div");
      main.className = "shop-main";
      const name = document.createElement("div");
      name.className = "shop-name";
      name.textContent = item.name;
      if (owned && (item.type === "food" || item.type === "toy")) {
        const count = document.createElement("em");
        count.textContent = `×${owned}`;
        name.appendChild(count);
      }
      const desc = document.createElement("div");
      desc.className = "shop-desc";
      const buffUntil = item.type === "buff" ? G.activeBuff(state, item.buff) : 0;
      desc.textContent =
        buffUntil > Date.now()
          ? `${item.desc}（剩余 ${Math.ceil((buffUntil - Date.now()) / 60000)} 分钟）`
          : item.desc;
      main.append(name, desc);

      const price = document.createElement("span");
      price.className = "shop-price";
      price.textContent = `${G.formatCoins(item.price)} 币`;

      const ownedPermanently =
        item.type === "dress" ||
        item.type === "permanent" ||
        item.type === "luxury" ||
        item.type === "furniture" ||
        item.type === "companion";
      const buy = document.createElement("button");
      if (item.type === "theme") {
        const equipped = state.settings.theme === item.theme;
        buy.textContent = equipped ? "使用中" : owned ? "使用" : "购买";
        buy.disabled = equipped || (!owned && state.coins < item.price);
        buy.addEventListener("click", () => (owned ? equipTheme(item.theme) : buyShopItem(item)));
      } else {
        buy.textContent = ownedPermanently && owned ? "已拥有" : "购买";
        buy.disabled = (ownedPermanently && owned > 0) || state.coins < item.price;
        buy.addEventListener("click", () => buyShopItem(item));
      }

      row.append(icon, main, price, buy);
      if ((item.type === "food" || item.type === "toy") && owned > 0) {
        const use = document.createElement("button");
        use.className = "use";
        use.textContent = "使用";
        use.addEventListener("click", () => useShopItem(item));
        row.appendChild(use);
      }
      el.shopList.appendChild(row);
    });
  }

  function buyShopItem(item) {
    const result = G.purchase(state, item, Date.now());
    if (!result.ok) {
      toast(result.reason === "coin" ? "金币不够，再搬会儿砖吧" : "已经拥有啦");
      return;
    }
    toast(`买到了：${item.name}`);
    playSound("buy");
    if (item.type === "dress") {
      speak(`解锁了「${item.name}」，去动作库换上吧`, 2600);
      renderLibrary();
    } else if (item.type === "companion") {
      syncCompanion();
      speak("伙伴来啦，以后一起搬砖", 2400);
    } else if (item.type === "furniture") {
      speak(`「${item.name}」放好啦`, 2000);
    } else if (item.type === "theme") {
      applyTheme();
      speak(`${item.name} 已启用`, 2200);
    } else if (item.type === "profile") {
      const profile = G.profileDetails(state);
      toast(`性格变为「${profile.personality.name}」，偏好已更新`);
      speak(`现在的我是${profile.personality.name}型啦`, 2400);
    } else if (item.type === "luxury") {
      speak(`${item.name} 到手，产出又提高了`, 2400);
    } else if (item.type === "permanent") {
      speak("招财猫会带来好运的", 2200);
    } else {
      speak(`${item.name} 到手～`, 1800);
    }
    updateHud(0);
    renderShop();
    updateMenu();
    if (growthOpen) renderGrowth();
    scheduleSave(800);
  }

  function useShopItem(item) {
    const result = G.useItem(state, item, Date.now());
    if (!result.ok) {
      playSound("error");
      toast("背包里没有啦");
      return;
    }
    const action = item.type === "food" ? pickByCategory("eat") : pickByCategory("play", "music");
    if (action) playReaction(action.name, 2400);
    speak(
      result.preference === "like"
        ? `最喜欢${item.name}了！`
        : result.preference === "dislike"
          ? `${item.name}……不太喜欢`
          : `用掉了${item.name}`,
      1800
    );
    floatText(`${item.icon} ✓`, { x: rand(120, 200), y: rand(180, 210) });
    playSound(item.type === "food" ? "feed" : "play");
    updateHud(0);
    renderShop();
    scheduleSave(800);
  }

  // ------------------------------------------------------------- 日程
  function renderSchedule() {
    const now = Date.now();
    const key = G.dayKey(now);
    el.scheduleDate.textContent = new Date(now).toLocaleDateString("zh-CN", {
      month: "numeric",
      day: "numeric",
      weekday: "short",
    });
    el.schedList.innerHTML = "";

    if (!state.schedule.length) {
      const empty = document.createElement("div");
      empty.className = "sched-empty";
      empty.textContent = "还没有日程，加一条吧";
      el.schedList.appendChild(empty);
      return;
    }

    state.schedule.forEach((item) => {
      const done = G.isScheduleDone(item, key);
      const row = document.createElement("div");
      row.className = `sched-item${done ? " done" : ""}`;

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = done;
      check.title = done ? "标记为未完成" : "标记完成";
      check.addEventListener("change", () => {
        G.toggleScheduleItem(state, item.id, Date.now());
        if (!done) speak("完成啦，好棒", 1800);
        renderSchedule();
        updateHud(0);
        scheduleSave(500);
      });

      const time = document.createElement("span");
      time.className = "sched-time";
      time.textContent = item.time;

      const text = document.createElement("span");
      text.className = "sched-text";
      text.textContent = item.text;
      text.title = item.text;

      const once = document.createElement("em");
      once.className = "sched-once";
      once.textContent = { once: "一次", weekdays: "工作日", weekend: "周末" }[item.repeat] || "";

      const snooze = document.createElement("button");
      snooze.className = "sched-snooze";
      snooze.textContent = "延后";
      snooze.title = "10 分钟后再提醒";
      snooze.disabled = done;
      snooze.addEventListener("click", () => {
        G.snoozeScheduleItem(state, item.id, 10, Date.now());
        renderSchedule();
        toast(`已延后到 ${state.schedule.find((entry) => entry.id === item.id)?.time || ""}`);
        scheduleSave(500);
      });

      const remove = document.createElement("button");
      remove.className = "sched-remove";
      remove.textContent = "✕";
      remove.title = "删除";
      remove.addEventListener("click", () => {
        G.removeScheduleItem(state, item.id);
        renderSchedule();
        updateMenu();
        scheduleSave(500);
      });

      row.append(check, time, text, once, snooze, remove);
      el.schedList.appendChild(row);
    });
  }

  function addScheduleFromInputs() {
    const time = el.schedTime.value || "09:00";
    const text = el.schedText.value.trim();
    const result = G.addScheduleItem(state, { time, text, repeat: el.schedRepeat.value }, Date.now());
    if (!result.ok) {
      toast(
        result.reason === "time" ? "时间格式不对" : result.reason === "text" ? "写点内容吧" : "日程太多啦"
      );
      return;
    }
    el.schedText.value = "";
    renderSchedule();
    updateMenu();
    scheduleSave(600);
    toast(`已加入日程：${time} ${text}`);
    speak(`记下啦：${text}`, 2200);
  }

  function checkScheduleReminders() {
    if (TEST_MODE) return;
    const now = Date.now();
    const due = G.dueScheduleItems(state, now);
    if (!due.length) return;
    due.forEach((item) => {
      G.markScheduleNotified(state, item.id, now);
      // 勿扰模式下只记账，不发声、不弹通知
      if (state.settings.dnd) return;
      // 超过 90 分钟的老日程不打扰
      if (now - G.scheduleTimestamp(item, now) > 90 * 60000) return;
      speak(`该${item.text}啦`, 3400);
      floatText(`⏰ ${item.text}`, { x: 160, y: 170 });
      const action =
        item.action && byName.has(item.action) ? byName.get(item.action) : pickByCategory("idle", "happy");
      if (action) playReaction(action.name, 2800);
      api.notify({ title: "doro 提醒", body: `${item.time} ${item.text}` });
    });
    renderSchedule();
    scheduleSave(800);
  }

  // ------------------------------------------------------------- 金币循环
  function startLoops() {
    if (TEST_MODE) return;
    lastFrameAt = Date.now();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastFrameAt;
      lastFrameAt = now;
      const before = state.coins;
      G.tick(state, elapsed);
      api.syncToolState(state, toolStateRevision);
      const currentHour = new Date().getHours();
      if (currentHour !== lastHourlyCheck) {
        lastHourlyCheck = currentHour;
        if (!state.settings.dnd) {
          playSound("clock");
          speak(`现在是 ${currentHour} 点整`, 2200);
        }
      }
      coinWindow += state.coins - before;
      const isPayday = now - lastPaydayAt > 5000;
      updateHud(isPayday);

      if (isPayday && coinWindow >= 1) {
        floatText(`+${G.formatCoins(coinWindow)}`, {
          x: rand(120, 200),
          y: rand(190, 215),
        });
        coinWindow = 0;
        lastPaydayAt = now;
      }
      if (now > nextMumbleAt) {
        nextMumbleAt = now + rand(20000, 45000);
        if (state.satiety < G.BALANCE.hungryThreshold) speak("我饿了……", 2600);
        else if (Math.random() < 0.5) speak(G.dialogueFor("coin", state), 2200);
      }
      if (state.satiety <= G.BALANCE.emptyThreshold && Math.random() < 0.12) {
        playReaction(pickByCategory("sad").name, 2400);
      }
    }, 1000);
  }

  // ------------------------------------------------------------- 交互
  function handlePet() {
    const now = Date.now();
    if (now - lastPetAt < G.BALANCE.petCooldownMs) return;
    lastPetAt = now;
    const result = G.pet(state, now);
    floatText(`+${result.bonus}`, { x: rand(130, 190), y: rand(170, 200) });
    floatText("♥", { heart: true, x: rand(110, 210), y: rand(150, 200) });
    bounce("hop");
    playSound("pet");
    speak(result.dialogue, 2000);
    playReaction((Math.random() < 0.6 ? pickByCategory("love") : pickByCategory("idle")).name, 2000);
    updateHud(0);
    scheduleSave(1500);
  }

  function doFeed() {
    const result = G.feed(state, Date.now());
    if (result.ok) {
      playSound("feed");
      floatText(`🍚 +${G.BALANCE.feedValue}`, {
        x: rand(120, 200),
        y: rand(170, 200),
      });
      speak(result.dialogue, 2200);
      playReaction(pickByCategory("eat", "love").name, 2600);
    } else {
      playSound("error");
      speak(result.dialogue, 2200);
      bounce("hurt");
    }
    updateHud(0);
    scheduleSave(1200);
  }

  function doPlay() {
    const result = G.play(state, Date.now());
    if (result.ok) {
      playSound("play");
      floatText("💗 +25", {
        heart: true,
        x: rand(120, 200),
        y: rand(170, 200),
      });
      speak(result.dialogue, 2200);
      playReaction(pickByCategory("play", "dance", "music").name, 3000);
    } else {
      speak(result.dialogue, 2200);
    }
    updateHud(0);
    scheduleSave(1200);
  }

  function doUpgrade() {
    const result = G.upgrade(state, Date.now());
    if (result.ok) {
      playSound("upgrade");
      floatText(`Lv.${state.level}`, { x: rand(120, 200), y: rand(160, 195) });
      speak(result.dialogue, 2400);
      bounce("hop");
      playReaction(pickByCategory("work", "angry").name, 2200);
    } else {
      speak(result.dialogue, 2200);
    }
    updateHud(0);
    scheduleSave(1200);
  }

  function nextAction() {
    const action = G.pickAmbientAction(actions, state);
    G.bumpDaily(state, "actionsViewed");
    noteAction(action);
    playReaction(action.name, Math.min(6000, action.durationMs * 2 + 900));
    speak(G.effectiveLabel(state, action), 1800);
    updateMenu();
  }

  async function toggleSetting(key) {
    state.settings[key] = !state.settings[key];
    if (key === "alwaysOnTop") await api.setAlwaysOnTop(state.settings[key]);
    if (key === "clickThrough") {
      // 打开穿透后整个窗口（包括还开着的菜单）都不再接收点击，
      // 必须先收起菜单，否则菜单会"钉"在屏幕上且再也点不动。
      if (state.settings[key]) closeMenu();
      await api.setClickThrough(state.settings[key]);
    }
    if (key === "autoLaunch") state.settings.autoLaunch = await api.setAutoLaunch(state.settings[key]);
    if (key === "showBubble") {
      if (!state.settings.showBubble) el.bubble.classList.remove("show");
    }
    if (key === "autoWalk" || key === "followCursor") refreshRects();
    if (key === "sound" && state.settings.sound) playSound("coin");
    updateMenu();
    if (configOpen) renderConfig();
    scheduleSave(400);
    const labels = {
      clickThrough: "点击穿透",
      alwaysOnTop: "窗口置顶",
      autoLaunch: "开机自启",
      autoWalk: "自动散步",
      showBubble: "说话气泡",
      safeMode: "安全模式",
      sound: "音效",
      analytics: "本地统计",
      followCursor: "跟随鼠标",
      dnd: "勿扰模式",
      updateAutoCheck: "每日自动检查更新",
    };
    toast(`${labels[key] || key}：${state.settings[key] ? "开" : "关"}`);
  }

  // ------------------------------------------------------------- 拖拽
  function startDrag(event) {
    if (event.button !== 0) return;
    dragging = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      startBounds: null,
      moved: false,
      samples: [],
    };
    try {
      el.petWrap.setPointerCapture(event.pointerId);
    } catch (err) {
      // 合成事件（自动化测试）里没有真实指针，忽略即可
    }
    api.getBounds().then((bounds) => {
      if (dragging) dragging.startBounds = bounds;
    });
  }

  function moveDrag(event) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const dx = event.screenX - dragging.startScreenX;
    const dy = event.screenY - dragging.startScreenY;
    if (!dragging.moved && Math.abs(dx) + Math.abs(dy) > 5) {
      dragging.moved = true;
      busyUntil = Infinity;
      el.petWrap.classList.add("dragging");
      setAction(WALK_ACTION, { force: true });
    }
    if (!dragging.moved || !dragging.startBounds) return;
    dragging.samples.push({ x: event.screenX, y: event.screenY, t: performance.now() });
    if (dragging.samples.length > 8) dragging.samples.shift();
    api.setPosition({
      x: dragging.startBounds.x + dx,
      y: dragging.startBounds.y + dy,
    });
  }

  function endDrag(event) {
    if (!dragging || (event && event.pointerId !== dragging.pointerId)) return;
    const moved = dragging.moved;
    let velocity = { x: 0, y: 0 };
    if (moved && dragging.samples.length >= 2) {
      const now = performance.now();
      const recent = dragging.samples.filter((sample) => now - sample.t < 160);
      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const dt = Math.max(16, last.t - first.t);
        velocity = { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
      }
    }
    try {
      if (el.petWrap.hasPointerCapture(dragging.pointerId))
        el.petWrap.releasePointerCapture(dragging.pointerId);
    } catch (err) {
      // 同上
    }
    dragging = null;
    el.petWrap.classList.remove("dragging");
    busyUntil = 0;
    if (moved) {
      if (Math.hypot(velocity.x, velocity.y) > 0.25) {
        throwPet(velocity.x, velocity.y);
      } else {
        setAction(baseAction, { force: true });
        refreshRects();
      }
      scheduleSave(600);
    } else {
      handlePet();
    }
  }

  // ------------------------------------------------------------- 自主漫游
  // 仿主流桌宠：在桌面上走来走去、走走停停；可选跟随鼠标；拖拽松手后会抛掷。
  const roam = {
    timer: null,
    state: "idle", // idle | walking | paused
    targetX: null,
    dir: 1,
    pauseUntil: 0,
    bounds: null,
    area: null,
    flying: null,
  };

  async function refreshRects() {
    roam.bounds = await api.getBounds();
    roam.area = await api.getWorkArea();
  }

  function setFlip(flip) {
    el.petWrap.classList.toggle("flip", Boolean(flip));
  }

  function stopRoamWalk() {
    if (roam.state === "walking") setAction(baseAction, { force: true });
    roam.state = "idle";
    roam.targetX = null;
    setFlip(false);
  }

  async function planRoamStep() {
    if (!roam.bounds || !roam.area) await refreshRects();
    const bounds = roam.bounds;
    const area = roam.area;
    if (!bounds || !area) return;

    let targetX;
    if (state.settings.followCursor) {
      const cursor = await api.getCursor();
      const center = bounds.x + bounds.width / 2;
      if (Math.abs(cursor.x - center) < 160) {
        roam.state = "paused";
        roam.pauseUntil = Date.now() + rand(2500, 5000);
        return;
      }
      targetX = cursor.x - bounds.width / 2;
    } else {
      roam.dir = Math.random() < 0.5 ? -1 : 1;
      if (bounds.x <= area.x + 16) roam.dir = 1;
      if (bounds.x >= area.x + area.width - bounds.width - 16) roam.dir = -1;
      targetX = bounds.x + roam.dir * rand(90, 280);
    }

    targetX = Math.max(area.x, Math.min(area.x + area.width - bounds.width, targetX));
    if (Math.abs(targetX - bounds.x) < 12) {
      roam.state = "paused";
      roam.pauseUntil = Date.now() + rand(4000, 9000);
      return;
    }
    roam.dir = targetX < bounds.x ? -1 : 1;
    roam.targetX = targetX;
    roam.state = "walking";
    setFlip(roam.dir < 0);
    setAction(WALK_ACTION, { force: true });
  }

  async function roamTick() {
    if (!state || state.settings.dnd) return;
    if (!state.settings.autoWalk && !state.settings.followCursor) {
      if (roam.state === "walking") stopRoamWalk();
      return;
    }
    if (roamingBlocked() || Date.now() < busyUntil || roam.flying) {
      if (roam.state === "walking") stopRoamWalk();
      return;
    }
    if (!roam.bounds) await refreshRects();
    if (roam.state === "paused" && Date.now() < roam.pauseUntil) return;
    if (roam.state !== "walking") {
      await planRoamStep();
      return;
    }

    const step = ((state.settings.roamSpeed || 55) / 1000) * 16;
    const nextX =
      roam.dir > 0
        ? Math.min(roam.targetX, roam.bounds.x + step)
        : Math.max(roam.targetX, roam.bounds.x - step);
    roam.bounds.x = nextX;
    api.setPosition({ x: nextX, y: roam.bounds.y });
    if (Math.abs(nextX - roam.targetX) < 1) {
      stopRoamWalk();
      roam.state = "paused";
      roam.pauseUntil = Date.now() + rand(5000, 14000);
    }
  }

  function roamingBlocked() {
    return Boolean(
      dragging ||
      menuOpen ||
      libraryOpen ||
      shopOpen ||
      scheduleOpen ||
      configOpen ||
      growthOpen ||
      gachaOpen ||
      minigameOpen ||
      stickerOpen ||
      quizOpen ||
      toolOpen ||
      systemSleeping ||
      !el.petWrap
    );
  }

  function startRoam() {
    if (TEST_MODE) return;
    if (roam.timer) clearInterval(roam.timer);
    refreshRects();
    roam.timer = setInterval(roamTick, 16);
  }

  /** 松手时按最后几个采样点算速度，做抛物线 + 边缘反弹。 */
  async function throwPet(vx, vy) {
    const bounds = await api.getBounds();
    const area = await api.getWorkArea();
    if (!bounds || !area) return;
    let x = bounds.x;
    let y = bounds.y;
    let speedX = vx * 16;
    let speedY = vy * 16;
    roam.flying = true;
    setAction(WALK_ACTION, { force: true });
    const timer = setInterval(() => {
      speedY += 0.55;
      speedX *= 0.992;
      x += speedX;
      y += speedY;
      const right = area.x + area.width - bounds.width;
      const bottom = area.y + area.height - bounds.height;
      if (x < area.x) {
        x = area.x;
        speedX = Math.abs(speedX) * 0.55;
      } else if (x > right) {
        x = right;
        speedX = -Math.abs(speedX) * 0.55;
      }
      if (y < area.y) {
        y = area.y;
        speedY = Math.abs(speedY) * 0.5;
      } else if (y > bottom) {
        y = bottom;
        speedY = -Math.abs(speedY) * 0.42;
        speedX *= 0.86;
      }
      api.setPosition({ x, y });
      roam.bounds = { ...bounds, x, y };
      if (Math.abs(speedX) < 0.2 && Math.abs(speedY) < 0.2 && Math.abs(y - bottom) < 2) {
        clearInterval(timer);
        roam.flying = null;
        setAction(baseAction, { force: true });
        bounce("hurt");
        refreshRects();
        scheduleSave(600);
      }
    }, 16);
  }

  // ------------------------------------------------------------- 菜单 / 穿透
  function openMenu(x, y) {
    if (
      libraryOpen ||
      shopOpen ||
      scheduleOpen ||
      configOpen ||
      growthOpen ||
      gachaOpen ||
      minigameOpen ||
      stickerOpen
    ) {
      closeSidePanels();
    }
    menuOpen = true;
    el.menu.classList.add("show");
    const rect = el.menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(window.innerWidth - rect.width - 4, x));
    const top = Math.max(4, Math.min(window.innerHeight - rect.height - 4, y));
    el.menu.style.left = `${left}px`;
    el.menu.style.top = `${top}px`;
    updateMenu();
    reportHitboxes();
  }

  function closeMenu() {
    menuOpen = false;
    el.menu.classList.remove("show");
    reportHitboxes();
  }

  function wireEvents() {
    el.petWrap.addEventListener("pointerdown", startDrag);
    el.petWrap.addEventListener("pointermove", moveDrag);
    el.petWrap.addEventListener("pointerup", endDrag);
    el.petWrap.addEventListener("pointercancel", endDrag);
    el.petWrap.addEventListener("dblclick", (event) => {
      event.preventDefault();
      playReaction(pickByCategory("love").name, 2600);
      floatText("♥♥", { heart: true, x: rand(110, 210), y: rand(150, 200) });
    });

    el.petWrap.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(event.clientX, event.clientY);
    });
    document.addEventListener("contextmenu", (event) => {
      if (!event.target.closest || !event.target.closest("#pet-wrap")) event.preventDefault();
    });

    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest) return;
      if (!event.target.closest("#menu") && !event.target.closest("#pet-wrap")) closeMenu();
      if (
        (libraryOpen ||
          shopOpen ||
          scheduleOpen ||
          configOpen ||
          growthOpen ||
          gachaOpen ||
          minigameOpen ||
          stickerOpen ||
          quizOpen) &&
        !event.target.closest(
          "#library, #shop, #schedule, #config, #growth, #gacha, #minigame, #sticker, #quiz"
        ) &&
        !event.target.closest("#pet-wrap")
      ) {
        closeSidePanels();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMenu();
        closeSidePanels();
      }
    });

    el.menu.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.toggle) {
        toggleSetting(button.dataset.toggle);
        return;
      }
      const cmd = button.dataset.cmd;
      if (cmd === "pet") handlePet();
      else if (cmd === "feed") doFeed();
      else if (cmd === "play") doPlay();
      else if (cmd === "upgrade") doUpgrade();
      else if (cmd === "next-action") nextAction();
      else if (cmd === "summon") {
        api.summon().then(() => {
          playReaction(pickByCategory("happy").name, 1600);
          refreshRects();
          toast("我在这儿！");
        });
      } else if (cmd === "library") openLibrary();
      else if (cmd === "shop") openSidePanel("shop");
      else if (cmd === "schedule") openSidePanel("schedule");
      else if (cmd === "config") openSidePanel("config");
      else if (cmd === "growth") openSidePanel("growth");
      else if (cmd === "gacha") openSidePanel("gacha");
      else if (cmd === "minigame") openSidePanel("minigame");
      else if (cmd === "quiz") openQuizWindow("home");
      else if (cmd === "sticker") openSidePanel("sticker");
      else if (cmd === "daily-question") {
        openQuizWindow("daily");
      } else if (cmd === "clear-base") {
        baseAction = IDLE_ACTION;
        setAction(baseAction, { force: true });
        updateMenu();
        renderLibrary();
        scheduleSave(500);
        toast("已恢复随机表演");
      } else if (cmd === "reset-position") api.resetPosition().then(() => toast("已回到默认位置"));
      else if (cmd === "open-folder") api.openSaveFolder();
      else if (cmd === "open-log") api.openLog();
      else if (cmd === "quit") quitApp();
      closeMenu();
    });

    el.coinPill.addEventListener("click", () => {
      if (
        libraryOpen ||
        shopOpen ||
        scheduleOpen ||
        configOpen ||
        growthOpen ||
        gachaOpen ||
        minigameOpen ||
        quizOpen
      ) {
        closeSidePanels();
      }
      el.panel.classList.toggle("show");
      reportHitboxes();
    });

    el.wishChip.addEventListener("click", () => {
      const wish = G.wishStatus(state);
      if (!wish || wish.expired) return;
      const pool = G.availableWishActions(actions, state, wish.category);
      if (!pool.length) return;
      const action = pool[Math.floor(Math.random() * pool.length)];
      playReaction(action.name, 2400);
      noteAction(action);
      speak(`这是「${G.effectiveLabel(state, action)}」`, 1800);
    });

    if (el.quizChip) {
      el.quizChip.addEventListener("click", () => {
        const quizEvent = G.quizEventStatus(state, Date.now());
        if (!quizEvent.available) {
          toast("答题事件还在冷却中");
          return;
        }
        openQuizWindow("event");
      });
    }

    el.visitorChip.addEventListener("click", () => {
      const visitor = G.acceptVisitor(state, Date.now());
      if (!visitor) return;
      toast(`${visitor.icon} ${visitor.label} +${visitor.reward} 金币`);
      playSound("coin");
      bounce("hop");
      updateHud(0);
      updateEventChips();
      scheduleSave(600);
      if (growthOpen) renderGrowth();
    });

    el.workChip.addEventListener("click", () => openSidePanel("growth"));

    el.btnCheckin.addEventListener("click", () => {
      const result = G.doCheckin(state, Date.now());
      if (!result.ok) return;
      toast(`签到成功 +${result.reward}（连续 ${result.streak} 天）`);
      playSound("coin");
      updateHud(0);
      renderGrowth();
      updateMenu();
      scheduleSave(600);
    });

    el.btnPrestige.addEventListener("click", () => {
      const status = G.prestigeStatus(state);
      if (!status.eligible) return;
      if (prestigePending !== "confirm") {
        prestigePending = "confirm";
        el.btnPrestige.textContent = "再次点击确认转生";
        setTimeout(() => {
          if (prestigePending !== "confirm") return;
          prestigePending = null;
          el.btnPrestige.textContent = state.prestige.count ? "再次转生" : "转生";
        }, 4000);
        return;
      }
      prestigePending = null;
      const result = G.prestige(state, Date.now());
      if (!result.ok) return;
      toast(`转生成功：${result.title} · 永久产出 ×${result.multiplier.toFixed(2)}`, 4200);
      speak(`摸鱼传奇，从现在开始！我是${result.title}`, 3600);
      playSound("upgrade");
      setAction(currentAction, { force: true });
      updateHud(0);
      updateMenu();
      renderGrowth();
      scheduleSave(500);
    });

    const deposit = (amount) => {
      const result = G.bankDeposit(state, amount, Date.now());
      if (!result.ok) {
        toast(result.reason === "busy" ? "已经有一笔存款了" : "金币不足或低于 200");
        return;
      }
      toast(`已存入 ${amount} 金币，8 小时后可取`);
      updateHud(0);
      renderGrowth();
      scheduleSave(600);
    };
    el.btnBank200.addEventListener("click", () => deposit(200));
    el.btnBank1000.addEventListener("click", () => deposit(1000));
    el.btnBankWithdraw.addEventListener("click", () => {
      const result = G.bankWithdraw(state, Date.now());
      if (!result.ok) return;
      toast(`取出 ${result.payout} 金币（含 15% 利息）`);
      playSound("coin");
      updateHud(0);
      renderGrowth();
      scheduleSave(600);
    });

    $("gacha-close").addEventListener("click", closeSidePanels);
    $("minigame-close").addEventListener("click", () => {
      stopMinigame(true);
      closeSidePanels();
    });
    el.gachaPull.addEventListener("click", () => {
      const result = G.pullGacha(state, actions, Date.now());
      if (!result.ok) {
        toast("金币不够，先搬会儿砖吧");
        return;
      }
      el.gachaResult.textContent = result.label;
      toast(`扭蛋：${result.label}`);
      playSound("buy");
      if (result.type === "theme") applyTheme();
      if (result.type === "dress") renderLibrary();
      updateHud(0);
      renderGacha();
      renderShop();
      updateMenu();
      scheduleSave(600);
    });
    el.minigameStart.addEventListener("click", startMinigame);
    $("panel-close").addEventListener("click", () => {
      el.panel.classList.remove("show");
      reportHitboxes();
    });
    el.btnFeed.addEventListener("click", doFeed);
    el.btnPlay.addEventListener("click", doPlay);
    el.btnUpgrade.addEventListener("click", doUpgrade);

    el.librarySearch.addEventListener("input", () => {
      libState.query = el.librarySearch.value;
      libState.page = 0;
      renderLibrary();
    });
    el.libraryPrev.addEventListener("click", () => {
      libState.page -= 1;
      renderLibrary();
    });
    el.libraryNext.addEventListener("click", () => {
      libState.page += 1;
      renderLibrary();
    });
    el.librarySmaller.addEventListener("click", () => {
      resizeLibraryWindow(libraryWindowSize.width - 80, libraryWindowSize.height - 60);
    });
    el.libraryLarger.addEventListener("click", () => {
      resizeLibraryWindow(libraryWindowSize.width + 80, libraryWindowSize.height + 60);
    });
    let libraryResizing = null;
    el.libraryResize.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      libraryResizing = {
        pointerId: event.pointerId,
        x: event.screenX,
        y: event.screenY,
        width: libraryWindowSize.width,
        height: libraryWindowSize.height,
      };
      el.libraryResize.setPointerCapture(event.pointerId);
    });
    el.libraryResize.addEventListener("pointermove", (event) => {
      if (!libraryResizing || event.pointerId !== libraryResizing.pointerId) return;
      resizeLibraryWindow(
        libraryResizing.width + event.screenX - libraryResizing.x,
        libraryResizing.height + event.screenY - libraryResizing.y
      );
    });
    const stopLibraryResize = (event) => {
      if (!libraryResizing || event.pointerId !== libraryResizing.pointerId) return;
      libraryResizing = null;
      if (el.libraryResize.hasPointerCapture(event.pointerId))
        el.libraryResize.releasePointerCapture(event.pointerId);
    };
    el.libraryResize.addEventListener("pointerup", stopLibraryResize);
    el.libraryResize.addEventListener("pointercancel", stopLibraryResize);
    el.libraryResize.addEventListener("dblclick", () => resizeLibraryWindow(600, 400));
    // 方向键在动作库里移动焦点，回车/空格直接选中
    el.libraryGrid.addEventListener("keydown", (event) => {
      const items = [...el.libraryGrid.querySelectorAll(".lib-item")];
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      const cols = 4;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, index + step))];
      if (next) next.focus();
    });
    $("library-close").addEventListener("click", closeLibrary);

    $("shop-close").addEventListener("click", closeSidePanels);
    $("schedule-close").addEventListener("click", closeSidePanels);
    $("config-close").addEventListener("click", closeSidePanels);
    $("growth-close").addEventListener("click", closeSidePanels);

    $("sticker-close").addEventListener("click", closeSidePanels);
    el.stickerSearch.addEventListener("input", () => {
      stickerState.query = el.stickerSearch.value;
      stickerState.page = 0;
      renderSticker();
    });
    el.stickerPrev.addEventListener("click", () => {
      stickerState.page -= 1;
      renderSticker();
    });
    el.stickerNext.addEventListener("click", () => {
      stickerState.page += 1;
      renderSticker();
    });
    el.stickerPreviewRandom.addEventListener("click", () => {
      const action = byName.get(stickerState.name);
      if (!action) return;
      G.setStickerRandom(state, action.name, !G.stickerRandomAllowed(state, action));
      renderSticker();
      updateMenu();
      scheduleSave(500);
    });
    const applyStickerRename = () => {
      const action = byName.get(stickerState.name);
      if (!action) return;
      G.setStickerLabel(state, action.name, el.stickerRename.value);
      renderSticker();
      renderLibrary();
      scheduleSave(500);
    };
    el.stickerRename.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyStickerRename();
        el.stickerRename.blur();
      }
    });
    el.stickerRename.addEventListener("blur", applyStickerRename);
    el.stickerBulk.addEventListener("click", (event) => {
      const button = event.target.closest("[data-bulk]");
      if (!button) return;
      const mode = button.dataset.bulk;
      actions
        .filter((action) => G.isStickerAction(action) && !G.isStickerHidden(state, action))
        .forEach((action) => {
          if (mode === "all") G.setStickerRandom(state, action.name, true);
          else if (mode === "none") G.setStickerRandom(state, action.name, false);
          else G.setStickerRandom(state, action.name, state.favorites.includes(action.name));
        });
      renderSticker();
      updateMenu();
      scheduleSave(500);
      toast(
        mode === "all"
          ? "所有表情包已允许随机"
          : mode === "none"
            ? "所有表情包已禁止随机"
            : "只保留收藏参与随机"
      );
    });

    el.stickerImport.addEventListener("click", async () => {
      const result = await api.stickerImport();
      if (!result || !result.ok) {
        if (result && result.message) toast(result.message);
        return;
      }
      if (result.added.length) {
        result.added.forEach((action) => {
          actions.push(action);
          byName.set(action.name, action);
        });
        stickerState.name = result.added[0].name;
        renderSticker();
        renderLibrary();
        updateMenu();
        scheduleSave(400);
        toast(`已导入 ${result.added.length} 个表情包`);
      } else {
        const reason = result.skipped && result.skipped[0] ? result.skipped[0].reason : "";
        toast(reason === "duplicate" ? "这些表情包已经在库里了" : "没有可导入的文件");
      }
    });

    el.stickerReveal.addEventListener("click", () => api.stickerReveal());
    el.stickerDownload.addEventListener("click", () => {
      const result = G.restoreBuiltInStickers(state, actions);
      renderSticker();
      renderLibrary();
      updateMenu();
      scheduleSave(500);
      toast(result.restored ? `已恢复 ${result.restored} 个内置表情包` : "内置表情包都在");
    });

    el.stickerDelete.addEventListener("click", async () => {
      const action = byName.get(stickerState.name);
      if (!action) return;
      if (stickerPendingDelete !== action.name) {
        stickerPendingDelete = action.name;
        el.stickerDelete.textContent = "再点一次确认";
        setTimeout(() => {
          if (stickerPendingDelete === action.name) {
            stickerPendingDelete = null;
            el.stickerDelete.textContent = "删除";
          }
        }, 3000);
        return;
      }
      stickerPendingDelete = null;
      const deletedLabel = G.effectiveLabel(state, action);
      if (!action.user) {
        const result = G.hideBuiltInSticker(state, action);
        if (!result.ok) return;
        if (baseAction === action.name) baseAction = IDLE_ACTION;
        if (currentAction === action.name) setAction(baseAction, { force: true });
        stickerState.name = null;
        renderSticker();
        renderLibrary();
        updateMenu();
        scheduleSave(500);
        toast(`已隐藏「${deletedLabel}」，可用「下载内置」恢复`);
        return;
      }
      const result = await api.stickerDelete(action.name);
      if (!result || !result.ok) {
        toast("删除失败");
        return;
      }
      actions = actions.filter((item) => item.name !== action.name);
      byName.delete(action.name);
      state.favorites = state.favorites.filter((name) => name !== action.name);
      state.recent = state.recent.filter((name) => name !== action.name);
      delete state.stickerRandom[action.name];
      delete state.stickerLabels[action.name];
      if (baseAction === action.name) baseAction = IDLE_ACTION;
      if (currentAction === action.name) setAction(baseAction, { force: true });
      stickerState.name = null;
      renderSticker();
      renderLibrary();
      updateMenu();
      scheduleSave(400);
      toast(`已删除「${deletedLabel}」`);
    });

    el.cfgAmbient.addEventListener("input", () => {
      state.settings.ambientIntervalSec = Number(el.cfgAmbient.value);
      el.cfgAmbientVal.textContent = `${state.settings.ambientIntervalSec} 秒`;
      if (!TEST_MODE) scheduleAmbient();
      scheduleSave(500);
    });
    el.cfgWalk.addEventListener("input", () => {
      state.settings.roamSpeed = Number(el.cfgWalk.value);
      el.cfgWalkVal.textContent = `${state.settings.roamSpeed} px/秒`;
      scheduleSave(500);
    });
    el.cfgScale.addEventListener("input", () => {
      state.settings.scale = Number(el.cfgScale.value) / 100;
      el.cfgScaleVal.textContent = `${el.cfgScale.value}%`;
      applyVisualScale();
      setAction(currentAction, { force: true });
      setTimeout(syncHudPosition, 260);
      reportHitboxes();
      scheduleSave(500);
    });

    const probeQuiz = async (force) => {
      if (el.cfgQuizStatus) el.cfgQuizStatus.textContent = "正在连接题库…";
      const res = await api.quizExams({ force: Boolean(force) });
      if (!el.cfgQuizStatus) return;
      if (res && res.error) {
        el.cfgQuizStatus.textContent = `连接失败：${res.message || res.error}`;
      } else if (res && Array.isArray(res.exams)) {
        el.cfgQuizStatus.textContent = `已连接，共 ${res.exams.length} 个题库${res.cached ? "（缓存）" : ""}`;
      }
    };
    if (el.cfgQuizSave) {
      el.cfgQuizSave.addEventListener("click", async () => {
        const raw = (el.cfgQuizApi.value || "").trim().replace(/\/+$/, "");
        if (!/^https?:\/\/\S+$/i.test(raw)) {
          toast("题库地址需要以 http:// 或 https:// 开头");
          return;
        }
        state.settings.quizApiBase = raw;
        scheduleSave(200);
        await probeQuiz(true);
        if (quizOpen) DoroQuiz.refresh();
      });
    }
    if (el.cfgQuizRefresh) el.cfgQuizRefresh.addEventListener("click", () => probeQuiz(true));
    if (el.cfgUpdateSave) {
      el.cfgUpdateSave.addEventListener("click", () => {
        const raw = (el.cfgUpdateFeed.value || "").trim().replace(/\/+$/, "");
        if (!/^https?:\/\/\S+$/i.test(raw)) {
          toast("更新源需要以 http:// 或 https:// 开头");
          return;
        }
        state.settings.updateFeedUrl = raw;
        scheduleSave(200);
        toast("更新源已保存");
      });
    }
    if (el.cfgUpdateCheck) {
      el.cfgUpdateCheck.addEventListener("click", async () => {
        const raw = (el.cfgUpdateFeed.value || "").trim().replace(/\/+$/, "");
        if (raw) state.settings.updateFeedUrl = raw;
        scheduleSave(200);
        updateStatus = await api.updateCheck(raw || undefined);
        renderUpdateStatus();
      });
    }
    api.onUpdateStatus((status) => {
      updateStatus = status;
      renderUpdateStatus();
      if (configOpen) renderConfig();
    });
    el.config.querySelectorAll("[data-ambient]").forEach((button) => {
      button.addEventListener("click", () => {
        el.cfgAmbient.value = button.dataset.ambient;
        el.cfgAmbient.dispatchEvent(new Event("input"));
      });
    });
    el.config.addEventListener("click", (event) => {
      const toggle = event.target.closest("[data-toggle]");
      if (toggle) toggleSetting(toggle.dataset.toggle);
    });
    el.cfgReset.addEventListener("click", () => {
      state.settings.ambientIntervalSec = 60;
      state.settings.autoWalkIntervalSec = 45;
      state.settings.scale = 1;
      state.settings.safeMode = true;
      state.settings.sound = true;
      applyVisualScale();
      renderConfig();
      setAction(currentAction, { force: true });
      if (!TEST_MODE) {
        scheduleAmbient();
        refreshRects();
      }
      reportHitboxes();
      scheduleSave(500);
      toast("已恢复默认配置");
    });

    el.schedAdd.addEventListener("click", addScheduleFromInputs);
    el.schedText.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addScheduleFromInputs();
    });

    // 光标离开所有可交互区域时把菜单收起来（穿透模式下点不到外面）
    api.onCursor((payload) => {
      if (!payload || payload.inside !== false) return;
      // 只自动收起右键菜单。动作库 / 商城 / 日程等大面板如果也按"光标离开"
      // 收起，窗口一放大、光标落在面板外就会立刻被关掉，看起来像闪退。
      if (menuOpen) closeMenu();
    });

    api.onCommand((command) => {
      if (command === "feed") doFeed();
      else if (command === "play") doPlay();
      else if (command === "upgrade") doUpgrade();
      else if (command === "next-action") nextAction();
      else if (command === "before-quit") {
        saveNow();
      } else if (command === "quit") {
        quitApp();
      }
    });

    api.onSettings((settings) => {
      Object.assign(state.settings, settings);
      updateMenu();
      scheduleSave(400);
    });

    api.onSystemIdle((payload) => {
      const seconds = Number(payload && payload.seconds) || 0;
      if (seconds >= 600 && !systemSleeping) {
        systemSleeping = true;
        if (reactionTimer) clearTimeout(reactionTimer);
        const sleep = byName.has("sleep_curl") ? "sleep_curl" : IDLE_ACTION;
        setAction(sleep, { force: true });
      } else if (systemSleeping && seconds < 5) {
        systemSleeping = false;
        busyUntil = 0;
        const stretch = byName.has("morning_stretch") ? "morning_stretch" : IDLE_ACTION;
        playReaction(stretch, 2600);
        speak("伸个懒腰……你回来啦", 2400);
      }
    });

    api.onWindowMoved((bounds) => {
      state.window = { x: bounds.x, y: bounds.y };
    });

    api.onNotice((payload) => {
      if (!payload || !payload.text) return;
      toast(payload.text, 3200);
      speak(payload.text, 3200);
    });

    api.onQuizState((payload) => {
      quizOpen = Boolean(payload && payload.open);
      if (quizOpen) {
        closeMenu();
        closeSidePanels();
      }
      updateMenu();
    });

    api.onQuizApply((payload) => {
      if (!payload || typeof payload !== "object") return;
      G.completeQuiz(state, payload);
      updateHud(0);
      updateMenu();
      scheduleSave(500);
    });

    api.onQuizSpeak((payload) => {
      if (!payload || !payload.text) return;
      speak(payload.text, payload.ms || 2000);
    });

    api.onToolWindowState((payload) => {
      const openTools = payload && Array.isArray(payload.openTools) ? payload.openTools : [];
      toolOpen = openTools.length > 0;
      if (toolOpen) {
        closeMenu();
        closeSidePanels();
      }
      updateMenu();
    });

    api.onPetToolState((payload) => applySharedToolState(payload));

    api.onPetActionsChanged(async () => {
      if (!installActions(await api.loadActions())) return;
      if (!byName.has(baseAction)) baseAction = IDLE_ACTION;
      if (!byName.has(currentAction)) setAction(baseAction, { force: true });
      renderLibrary();
      if (stickerOpen) renderSticker();
      updateMenu();
    });

    api.onPetToolSpeak((payload) => {
      if (!payload || !payload.text) return;
      speak(payload.text, payload.ms || 2000);
    });

    window.addEventListener("beforeunload", () => {
      saveNow();
    });
  }

  async function quitApp() {
    await saveNow();
    api.quit();
  }

  // ------------------------------------------------------------- 启动
  async function init() {
    const loaded = await api.load();
    state = G.hydrate(loaded.save, loaded.now);
    applyTheme();
    applyVisualScale();
    if (loaded.crashedLastTime) {
      api.log("warn", "上次没有正常退出，已从最近的存档继续");
    }
    if (!installActions(await api.loadActions())) {
      document.body.innerHTML =
        '<p style="font:12px sans-serif;color:#c04a68;padding:10px">找不到动作资源，请先运行 npm run assets</p>';
      return;
    }
    baseAction = byName.has(state.settings.baseAction) ? state.settings.baseAction : IDLE_ACTION;
    if (!G.isUnlocked(state, byName.get(baseAction))) baseAction = IDLE_ACTION;

    DoroQuiz.configure({
      getState: () => state,
      api,
      setUiSize: (size) => api.setUiSize(size),
      toast,
      speak,
      floatText,
      playSound,
      save: (delay) => scheduleSave(delay),
      updateHud: () => updateHud(0),
      updateMenu,
      closePanels: () => {
        quizOpen = false;
        el.quiz.classList.remove("show");
        if (DoroQuiz) DoroQuiz.close();
        closeSidePanels();
      },
    });
    api.updateStatus().then((status) => {
      updateStatus = status;
      renderUpdateStatus();
    });

    wireEvents();
    setAction(baseAction, { force: true });
    updateHud(0);
    updateMenu();

    const offline = G.settleOffline(state, loaded.now);
    if (offline.earned >= 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      speak(`你回来啦，我赚了 ${G.formatCoins(offline.earned)} 金币`, 3600);
      floatText(`+${G.formatCoins(offline.earned)} 离线`, { x: 160, y: 175 });
    } else if (state.settings.showBubble) {
      speak(G.dialogueFor("idle", state), 2600);
    }

    startLoops();
    scheduleAmbient(4000);
    startRoam();
    updateEventChips();
    scheduleWish();
    collectWork(true);
    syncCompanion();
    setInterval(() => {
      G.maybeVisitor(state, Date.now());
      collectWork(false);
      updateEventChips();
      if (growthOpen) renderGrowth();
    }, 30000);
    checkScheduleReminders();
    setInterval(checkScheduleReminders, 20000);
    nextMumbleAt = Date.now() + rand(15000, 30000);

    window.addEventListener("beforeunload", () => saveNow());
    // 定时兜底存档：避免异常退出/崩溃时丢失进度（用户操作仍走上面的防抖保存）
    setInterval(() => saveNow(), 15000);

    // 调试入口：electron . --panel=shop / schedule / library
    const initialPanel = TEST_MODE ? null : new URLSearchParams(location.search).get("panel");
    const themePreview = TEST_MODE ? null : new URLSearchParams(location.search).get("theme");
    if (themePreview && ["night", "mint", "sakura"].includes(themePreview)) {
      document.body.dataset.theme = themePreview;
    }
    if (initialPanel) setTimeout(() => openSidePanel(initialPanel), 700);

    if (TEST_MODE) {
      // 只给 tools/smoke-test.js 用；正常启动不会挂这个钩子
      const openQuizPanel = () => {
        closeMenu();
        quizOpen = true;
        document.body.classList.add("lib-open");
        el.quiz.classList.add("show");
        DoroQuiz.openHome();
        reportHitboxes();
      };
      const closeQuizPanel = () => {
        quizOpen = false;
        el.quiz.classList.remove("show");
        if (DoroQuiz) DoroQuiz.close();
        reportHitboxes();
      };
      window.__doroTest = {
        getState: () => JSON.parse(JSON.stringify(state)),
        currentAction: () => currentAction,
        baseAction: () => baseAction,
        actionCount: () => actions.length,
        clickThrough: () => state.settings.clickThrough,
        feed: doFeed,
        play: doPlay,
        pet: handlePet,
        upgrade: doUpgrade,
        saveNow,
        setBase: (name) => {
          baseAction = name;
          setAction(name, { force: true });
        },
        openMenu,
        closeMenu,
        openLibrary,
        closeLibrary,
        openShop: () => openSidePanel("shop"),
        openSchedule: () => openSidePanel("schedule"),
        openConfig: () => openSidePanel("config"),
        openGrowth: () => openSidePanel("growth"),
        openGacha: () => openSidePanel("gacha"),
        openMinigame: () => openSidePanel("minigame"),
        openSticker: () => openSidePanel("sticker"),
        openToolWindow,
        openQuiz: openQuizPanel,
        startQuizMode: (mode) => {
          openQuizPanel();
          return DoroQuiz.startMode(mode);
        },
        quizOpen: () => quizOpen,
        forceWish: () => {
          G.createWish(state, Date.now(), actions);
          updateEventChips();
        },
        forceVisitor: () => {
          G.spawnVisitor(state, Date.now());
          updateEventChips();
        },
        finishWork: () => {
          state.work.jobs.forEach((job) => {
            job.endsAt = 0;
          });
          return collectWork(false);
        },
        setLevel: (level) => {
          state.level = Math.max(1, Math.round(Number(level) || 1));
          updateHud(0);
          updateMenu();
          if (growthOpen) renderGrowth();
        },
        closePanels: () => {
          closeQuizPanel();
          closeSidePanels();
        },
      };
      document.documentElement.dataset.doroReady = "1";
      if (loaded.crashedLastTime) speak("上次好像摔了一跤……", 3000);
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
