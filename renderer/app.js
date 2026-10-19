/* doro 桌面宠物：界面 / 动画 / 交互。经济逻辑在 game.js 里。 */
(function () {
  "use strict";

  const G = window.DoroGame;
  const api = window.petAPI;
  // 冒烟测试用 ?test=1 打开：关掉自动计时，并暴露少量只读/操作钩子
  const TEST_MODE = new URLSearchParams(location.search).has("test");

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
    config: $("config"),
    cfgAmbient: $("cfg-ambient"),
    cfgAmbientVal: $("cfg-ambient-val"),
    cfgWalk: $("cfg-walk"),
    cfgWalkVal: $("cfg-walk-val"),
    cfgScale: $("cfg-scale"),
    cfgScaleVal: $("cfg-scale-val"),
    cfgReset: $("cfg-reset"),
    growth: $("growth"),
    growthCoins: $("growth-coins"),
    growthDaily: $("growth-daily"),
    growthDailyDate: $("growth-daily-date"),
    growthAchievements: $("growth-achievements"),
    growthAchCount: $("growth-ach-count"),
    growthStats: $("growth-stats"),
    growthStatsToggle: $("growth-stats-toggle"),
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
  let shopTab = "食物";
  const libState = { group: "全部", query: "", page: 0 };
  let currentAction = null;
  let activeLayer = null;
  let ambientTimer = null;
  let reactionTimer = null;
  let tickTimer = null;
  let saveTimer = null;
  let walkTimer = null;
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

  // ------------------------------------------------------------- 基础工具
  function rand(min, max) {
    return min + Math.random() * (max - min);
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
    await api.save(state);
  }

  function toast(text, ms) {
    el.toast.textContent = text;
    el.toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms || 1800);
  }

  function speak(text, ms) {
    if (!state.settings.showBubble) return;
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
      api.setHitboxes(boxes);
    }, 30);
  }

  // ------------------------------------------------------------- 动作 / 动画
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
    img.alt = action.label;
    img.src = `../assets/${action.file}`;
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
    el.petLabel.textContent = `Lv.${state.level} ${action.label}`;
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
      if (!dragging && Date.now() >= busyUntil) {
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
    if (el.menuLibraryCount) el.menuLibraryCount.textContent = `${actions.length} 个`;
    if (el.menuScheduleCount) {
      el.menuScheduleCount.textContent = state.schedule.length ? `${state.schedule.length} 条` : "";
    }
    if (el.menuTaskCount) {
      const readyCount =
        G.dailyTasks(state).filter((task) => task.ready && !task.claimed).length +
        G.achievementList(state).filter((item) => item.ready && !item.claimed).length;
      el.menuTaskCount.textContent = readyCount ? `${readyCount} 可领` : "";
    }
  }

  // ------------------------------------------------------------- 动作库
  function libraryGroups() {
    return ["全部", "收藏", "最近", ...new Set(actions.map((action) => action.group).filter(Boolean))];
  }

  function filteredActions() {
    const query = libState.query.trim().toLowerCase();
    let items;
    if (libState.group === "收藏") {
      items = state.favorites.map((name) => byName.get(name)).filter(Boolean);
    } else if (libState.group === "最近") {
      items = state.recent.map((name) => byName.get(name)).filter(Boolean);
    } else {
      items = actions.filter((action) => libState.group === "全部" || action.group === libState.group);
    }
    return items.filter((action) => {
      if (!query) return true;
      return (
        action.label.toLowerCase().includes(query) ||
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
    speak(`换成「${action.label}」`, 1800);
    updateMenu();
    updateHud(0);
    renderLibrary();
    scheduleSave(500);
  }

  function renderLibrary() {
    const items = filteredActions();
    const pages = Math.max(1, Math.ceil(items.length / LIB_PAGE_SIZE));
    libState.page = Math.min(Math.max(0, libState.page), pages - 1);
    el.libraryCount.textContent = `${items.length} / ${actions.length}`;

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
      button.className = `lib-item${action.name === baseAction ? " active" : ""}${unlocked ? "" : " locked"}`;
      button.title = `${action.label} · ${action.category}${action.blocked ? " · 不参与随机" : ""}${
        unlocked ? "" : ` · ${price} 币解锁`
      }`;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = `../assets/thumbs/${action.name}.png`;
      img.alt = action.label;
      const text = document.createElement("span");
      text.textContent = action.label;
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
        lock.textContent = "🔒";
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
          shopTab = "装扮";
          openSidePanel("shop");
          toast(`先去商城解锁「${action.label}」（${price} 币）`);
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
    const walk = Math.round(settings.autoWalkIntervalSec || 45);
    const scale = Math.round((settings.scale || 1) * 100);
    el.cfgAmbient.value = String(Math.min(600, Math.max(5, ambient)));
    el.cfgAmbientVal.textContent = `${ambient} 秒`;
    el.cfgWalk.value = String(Math.min(600, Math.max(10, walk)));
    el.cfgWalkVal.textContent = `${walk} 秒`;
    el.cfgScale.value = String(Math.min(150, Math.max(70, scale)));
    el.cfgScaleVal.textContent = `${scale}%`;
    el.config.querySelectorAll("[data-toggle]").forEach((button) => {
      button.classList.toggle("on", Boolean(settings[button.dataset.toggle]));
    });
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

  function openSidePanel(name) {
    libraryOpen = name === "library";
    shopOpen = name === "shop";
    scheduleOpen = name === "schedule";
    configOpen = name === "config";
    growthOpen = name === "growth";
    closeMenu();
    el.panel.classList.remove("show");
    document.body.classList.add("lib-open");
    api.setUiSize({ width: 600, height: 400 });
    el.library.classList.toggle("show", libraryOpen);
    el.shop.classList.toggle("show", shopOpen);
    el.schedule.classList.toggle("show", scheduleOpen);
    el.config.classList.toggle("show", configOpen);
    el.growth.classList.toggle("show", growthOpen);
    if (libraryOpen) renderLibrary();
    if (shopOpen) renderShop();
    if (scheduleOpen) renderSchedule();
    if (configOpen) renderConfig();
    if (growthOpen) renderGrowth();
    if (libraryOpen) setTimeout(() => el.librarySearch.focus(), 60);
    reportHitboxes();
  }

  function closeSidePanels() {
    if (!libraryOpen && !shopOpen && !scheduleOpen && !configOpen && !growthOpen) return;
    libraryOpen = false;
    shopOpen = false;
    scheduleOpen = false;
    configOpen = false;
    growthOpen = false;
    document.body.classList.remove("lib-open");
    api.setUiSize({ width: 320, height: 360 });
    el.library.classList.remove("show");
    el.shop.classList.remove("show");
    el.schedule.classList.remove("show");
    el.config.classList.remove("show");
    el.growth.classList.remove("show");
    reportHitboxes();
  }

  function openLibrary() {
    openSidePanel("library");
  }

  function closeLibrary() {
    closeSidePanels();
  }

  // ------------------------------------------------------------- 商城
  const SHOP_TABS = ["食物", "玩具", "增益", "主题", "装扮"];

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
    const map = { 食物: ["food"], 玩具: ["toy"], 增益: ["buff", "permanent"], 主题: ["theme"] };
    return Object.values(G.SHOP_ITEMS).filter((item) => (map[tab] || []).includes(item.type));
  }

  function shopOwned(item) {
    if (item.type === "dress") return G.isUnlocked(state, { category: "dress", name: item.action }) ? 1 : 0;
    if (item.type === "permanent") return state.perks[item.id] ? 1 : 0;
    if (item.type === "theme") return state.perks[`theme_${item.theme}`] ? 1 : 0;
    return state.inventory[item.id] || 0;
  }

  function applyTheme() {
    document.body.dataset.theme = state.settings.theme || "default";
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
      price.textContent = `${item.price} 币`;

      const ownedPermanently = item.type === "dress" || item.type === "permanent";
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
    } else if (item.type === "theme") {
      applyTheme();
      speak(`${item.name} 已启用`, 2200);
    } else if (item.type === "permanent") {
      speak("招财猫会带来好运的", 2200);
    } else {
      speak(`${item.name} 到手～`, 1800);
    }
    updateHud(0);
    renderShop();
    updateMenu();
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
    speak(`用掉了${item.name}`, 1800);
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
    playReaction(action.name, Math.min(6000, action.durationMs * 2 + 900));
    speak(action.label, 1800);
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
    if (key === "autoWalk") scheduleAutoWalk();
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
    api.setPosition({
      x: dragging.startBounds.x + dx,
      y: dragging.startBounds.y + dy,
    });
  }

  function endDrag(event) {
    if (!dragging || (event && event.pointerId !== dragging.pointerId)) return;
    const moved = dragging.moved;
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
      setAction(baseAction, { force: true });
      scheduleSave(600);
    } else {
      handlePet();
    }
  }

  // ------------------------------------------------------------- 自动散步
  function scheduleAutoWalk() {
    if (TEST_MODE) return;
    if (walkTimer) clearTimeout(walkTimer);
    const base = Math.max(10, Number(state.settings.autoWalkIntervalSec) || 45) * 1000;
    const wait = base * (0.75 + Math.random() * 0.5);
    walkTimer = setTimeout(async () => {
      if (state.settings.autoWalk && !dragging && !menuOpen && Date.now() >= busyUntil) {
        await autoWalkStep();
      }
      scheduleAutoWalk();
    }, wait);
  }

  async function autoWalkStep() {
    const bounds = await api.getBounds();
    if (!bounds) return;
    const distance = (Math.random() < 0.5 ? -1 : 1) * rand(70, 180);
    const duration = 1500;
    const startedAt = performance.now();
    busyUntil = Date.now() + duration + 400;
    setAction(WALK_ACTION, { force: true });
    return new Promise((resolve) => {
      // 用定时器推进而不是 rAF：窗口被遮挡时也能走完，避免卡在走路动作上
      const timer = setInterval(() => {
        if (!state.settings.autoWalk || dragging) {
          clearInterval(timer);
          setAction(baseAction, { force: true });
          return resolve();
        }
        const t = Math.min(1, (performance.now() - startedAt) / duration);
        api.setPosition({ x: bounds.x + distance * t, y: bounds.y });
        if (t >= 1) {
          clearInterval(timer);
          setAction(baseAction, { force: true });
          scheduleSave(600);
          resolve();
        }
      }, 16);
    });
  }

  // ------------------------------------------------------------- 菜单 / 穿透
  function openMenu(x, y) {
    if (libraryOpen || shopOpen || scheduleOpen || configOpen || growthOpen) closeSidePanels();
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
        (libraryOpen || shopOpen || scheduleOpen || configOpen || growthOpen) &&
        !event.target.closest("#library, #shop, #schedule, #config, #growth") &&
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
      else if (cmd === "library") openLibrary();
      else if (cmd === "shop") openSidePanel("shop");
      else if (cmd === "schedule") openSidePanel("schedule");
      else if (cmd === "config") openSidePanel("config");
      else if (cmd === "growth") openSidePanel("growth");
      else if (cmd === "clear-base") {
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
      if (libraryOpen || shopOpen || scheduleOpen) closeSidePanels();
      el.panel.classList.toggle("show");
      reportHitboxes();
    });
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

    el.cfgAmbient.addEventListener("input", () => {
      state.settings.ambientIntervalSec = Number(el.cfgAmbient.value);
      el.cfgAmbientVal.textContent = `${state.settings.ambientIntervalSec} 秒`;
      if (!TEST_MODE) scheduleAmbient();
      scheduleSave(500);
    });
    el.cfgWalk.addEventListener("input", () => {
      state.settings.autoWalkIntervalSec = Number(el.cfgWalk.value);
      el.cfgWalkVal.textContent = `${state.settings.autoWalkIntervalSec} 秒`;
      if (!TEST_MODE) scheduleAutoWalk();
      scheduleSave(500);
    });
    el.cfgScale.addEventListener("input", () => {
      state.settings.scale = Number(el.cfgScale.value) / 100;
      el.cfgScaleVal.textContent = `${el.cfgScale.value}%`;
      setAction(currentAction, { force: true });
      reportHitboxes();
      scheduleSave(500);
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
      renderConfig();
      setAction(currentAction, { force: true });
      if (!TEST_MODE) {
        scheduleAmbient();
        scheduleAutoWalk();
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
      if (menuOpen) closeMenu();
      if (libraryOpen || shopOpen || scheduleOpen) closeSidePanels();
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

    api.onWindowMoved((bounds) => {
      state.window = { x: bounds.x, y: bounds.y };
    });

    api.onNotice((payload) => {
      if (!payload || !payload.text) return;
      toast(payload.text, 3200);
      speak(payload.text, 3200);
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
    if (loaded.crashedLastTime) {
      api.log("warn", "上次没有正常退出，已从最近的存档继续");
    }
    actions = (await api.loadActions()).filter(Boolean);
    if (!actions.length) {
      document.body.innerHTML =
        '<p style="font:12px sans-serif;color:#c04a68;padding:10px">找不到动作资源，请先运行 npm run assets</p>';
      return;
    }
    byName = new Map(actions.map((action) => [action.name, action]));
    // 优先用指定的默认动作，库被裁剪过也能工作
    IDLE_ACTION = byName.has("idle_stand")
      ? "idle_stand"
      : (actions.find((action) => action.category === "idle") || actions[0]).name;
    WALK_ACTION = byName.has("walk_bag")
      ? "walk_bag"
      : (actions.find((action) => action.category === "walk") || actions[0]).name;
    baseAction = byName.has(state.settings.baseAction) ? state.settings.baseAction : IDLE_ACTION;
    if (!G.isUnlocked(state, byName.get(baseAction))) baseAction = IDLE_ACTION;

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
    scheduleAutoWalk();
    checkScheduleReminders();
    setInterval(checkScheduleReminders, 20000);
    nextMumbleAt = Date.now() + rand(15000, 30000);

    window.addEventListener("beforeunload", () => saveNow());
    // 定时兜底存档：避免异常退出/崩溃时丢失进度（用户操作仍走上面的防抖保存）
    setInterval(() => saveNow(), 15000);

    if (TEST_MODE) {
      // 只给 tools/smoke-test.js 用；正常启动不会挂这个钩子
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
        closePanels: closeSidePanels,
      };
      document.documentElement.dataset.doroReady = "1";
      if (loaded.crashedLastTime) speak("上次好像摔了一跤……", 3000);
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
