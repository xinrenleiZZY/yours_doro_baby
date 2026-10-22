/* 独立商城 / 扭蛋机 / 接金币 / 表情包窗口。 */
(function () {
  "use strict";

  const G = window.DoroGame;
  const api = window.petAPI;
  const params = new URLSearchParams(location.search);
  const tool = params.get("tool") || "";
  const ELEMENTS = {
    shop: document.getElementById("shop"),
    gacha: document.getElementById("gacha"),
    minigame: document.getElementById("minigame"),
    sticker: document.getElementById("sticker"),
  };
  const $ = (id) => document.getElementById(id);
  const SHOP_TABS = ["食物", "玩具", "增益", "主题", "家具", "装扮", "典藏"];
  const STICKER_PAGE_SIZE = 8;
  const TOOL_TITLES = {
    shop: "doro 商城",
    gacha: "doro 扭蛋机",
    minigame: "doro 接金币",
    sticker: "doro 动作库管理",
  };

  let state = null;
  let actions = [];
  let revision = 0;
  let shopTab = SHOP_TABS.includes(params.get("tab")) ? params.get("tab") : "食物";
  let stickerQuery = "";
  let stickerPage = 0;
  let stickerName = null;
  let pendingDelete = null;
  let toastTimer = null;
  let audioCtx = null;
  const mini = { running: false, score: 0, spawnTimer: null, endTimer: null };

  function showToast(text, ms) {
    const node = $("tool-toast");
    if (!node) return;
    node.textContent = String(text || "");
    node.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), ms || 1800);
  }

  function beep(kind) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const notes = {
        coin: [880, 1180],
        buy: [600, 800],
        error: [300, 220],
      }[kind] || [700];
      notes.forEach((frequency, index) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const at = audioCtx.currentTime + index * 0.07;
        osc.type = "sine";
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.1);
      });
    } catch (err) {
      /* 音效失败不影响工具窗口 */
    }
  }

  function actionImageUrl(action) {
    return action && action.url ? action.url : `../assets/${action.file}`;
  }

  function actionThumbUrl(action) {
    return action && action.thumb ? action.thumb : `../assets/thumbs/${action.name}.png`;
  }

  function render() {
    if (!state) return;
    if (tool === "shop") renderShop();
    else if (tool === "gacha") renderGacha();
    else if (tool === "minigame") renderMinigame();
    else if (tool === "sticker") renderSticker();
  }

  function renderLive() {
    if (tool === "shop") $("shop-balance").textContent = `${G.formatCoins(state.coins)} 金币`;
    else if (tool === "gacha") renderGacha();
    else if (tool === "minigame") renderMinigame();
  }

  function applySnapshot(snapshot) {
    if (!snapshot || !snapshot.save) return;
    const nextRevision = Number(snapshot.revision) || 0;
    if (nextRevision < revision) return;
    revision = nextRevision;
    state = G.hydrate(snapshot.save, snapshot.now || Date.now());
    if (Array.isArray(snapshot.actions)) actions = snapshot.actions;
    document.body.dataset.theme = state.settings.theme || "default";
    document.title = TOOL_TITLES[tool] || "doro 工具";
    if (snapshot.source === "pet-live") renderLive();
    else render();
  }

  async function runCommand(command, sound) {
    const response = await api.toolCommand(tool, command);
    if (!response || !response.ok) {
      beep("error");
      showToast((response && (response.message || response.error)) || "操作失败");
      return null;
    }
    applySnapshot(response);
    if (sound) beep(sound);
    if (response.message) showToast(response.message);
    if (response.speech) api.toolSpeak(response.speech, 2200);
    return response;
  }

  // ------------------------------------------------------------- 商城
  function shopCatalog(tab) {
    if (tab === "装扮") {
      return actions
        .filter((action) => action.category === "dress")
        .map((action, index) => ({
          kind: "dress",
          key: `dress:${action.name}`,
          action: action.name,
          name: action.label,
          type: "dress",
          price: G.dressPrice(index),
          icon: "👗",
          desc: G.isUnlocked(state, action) ? "已解锁" : "解锁后可在动作库选用",
        }));
    }
    if (tab === "家具") {
      return Object.values(G.FURNITURE).map((item) => ({
        kind: "furniture",
        key: `furniture:${item.id}`,
        id: item.id,
        name: item.name,
        type: item.id === "companion" ? "companion" : "furniture",
        price: item.price,
        icon: item.icon,
        desc: item.desc,
      }));
    }
    const typeMap = {
      食物: ["food"],
      玩具: ["toy"],
      增益: ["buff", "permanent"],
      主题: ["theme"],
      典藏: ["luxury", "profile"],
    };
    return Object.values(G.SHOP_ITEMS)
      .filter((item) => (typeMap[tab] || []).includes(item.type))
      .map((item) => ({ ...item, kind: "catalog", key: item.id }));
  }

  function shopOwned(item) {
    if (item.type === "dress") return state.unlocked.includes(item.action);
    if (item.type === "permanent") return Boolean(state.perks[item.id]);
    if (item.type === "luxury") return Boolean(state.perks[item.id]);
    if (item.type === "theme") return Boolean(state.perks[`theme_${item.theme}`]);
    if (item.type === "furniture") return state.room.furniture.includes(item.id);
    if (item.type === "companion") return Boolean(state.companion.adopted);
    return state.inventory[item.id] || 0;
  }

  function shopRef(item) {
    if (item.kind === "catalog") return { kind: "catalog", id: item.id };
    if (item.kind === "furniture") return { kind: "furniture", id: item.id };
    return { kind: "dress", action: item.action };
  }

  function renderShop() {
    $("shop-balance").textContent = `${G.formatCoins(state.coins)} 金币`;
    const tabs = $("shop-tabs");
    tabs.innerHTML = "";
    SHOP_TABS.forEach((tab) => {
      const button = document.createElement("button");
      button.textContent = tab;
      button.classList.toggle("active", tab === shopTab);
      button.addEventListener("click", () => {
        shopTab = tab;
        renderShop();
      });
      tabs.appendChild(button);
    });

    const list = $("shop-list");
    list.innerHTML = "";
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

      const buy = document.createElement("button");
      const permanent =
        item.type === "dress" ||
        item.type === "permanent" ||
        item.type === "luxury" ||
        item.type === "furniture" ||
        item.type === "companion";
      if (item.type === "theme") {
        const equipped = state.settings.theme === item.theme;
        buy.textContent = equipped ? "使用中" : owned ? "使用" : "购买";
        buy.disabled = equipped || (!owned && state.coins < item.price);
        buy.addEventListener("click", () =>
          owned
            ? runCommand({ type: "equip-theme", theme: item.theme })
            : runCommand({ type: "buy", item: shopRef(item) }, "buy")
        );
      } else {
        buy.textContent = permanent && owned ? "已拥有" : "购买";
        buy.disabled = (permanent && Boolean(owned)) || state.coins < item.price;
        buy.addEventListener("click", () => runCommand({ type: "buy", item: shopRef(item) }, "buy"));
      }

      row.append(icon, main, price, buy);
      if ((item.type === "food" || item.type === "toy") && owned > 0) {
        const use = document.createElement("button");
        use.className = "use";
        use.textContent = "使用";
        use.addEventListener("click", () => runCommand({ type: "use", item: shopRef(item) }, "coin"));
        row.appendChild(use);
      }
      list.appendChild(row);
    });
  }

  // ------------------------------------------------------------- 扭蛋
  function renderGacha() {
    $("gacha-coins").textContent = `${G.formatCoins(state.coins)} 金币`;
    $("gacha-pull").disabled = state.coins < G.GACHA_PRICE;
    $("gacha-ten").disabled = state.coins < G.GACHA_TEN_PRICE;
    const pulls = state.gacha.pulls || 0;
    $("gacha-pulls").textContent = String(pulls);
    $("gacha-pity").textContent = String(G.GACHA_PITY_PULLS - (pulls % G.GACHA_PITY_PULLS));
  }

  function showGachaResults(results) {
    const output = $("gacha-result");
    const machine = $("gacha-machine");
    output.innerHTML = "";
    results.forEach((result) => {
      const row = document.createElement("div");
      row.className = "gacha-reward";
      row.dataset.tier = result.tier || "common";
      row.textContent = result.label;
      output.appendChild(row);
    });
    const order = { common: 0, rare: 1, jackpot: 2, super: 3, legendary: 4, mythic: 5 };
    const best = results.reduce(
      (top, result) => ((order[result.tier] || 0) > (order[top.tier] || 0) ? result : top),
      results[0]
    );
    machine.classList.remove("spinning", "jackpot");
    void machine.offsetWidth;
    machine.classList.add("spinning");
    if (["jackpot", "super", "legendary", "mythic"].includes(best.tier)) {
      machine.classList.add("jackpot");
      beep("coin");
    }
    setTimeout(() => machine.classList.remove("spinning"), 500);
    setTimeout(() => machine.classList.remove("jackpot"), 2200);
  }

  // ------------------------------------------------------------- 接金币
  function renderMinigame() {
    const status = G.minigameStatus(state);
    $("minigame-status").textContent = mini.running
      ? "进行中…"
      : status.ready
        ? "15 秒，点金币得分"
        : `冷却 ${Math.ceil(status.secondsLeft / 60)} 分钟`;
    $("minigame-start").disabled = mini.running || !status.ready;
    $("minigame-score").textContent = String(mini.score);
  }

  function spawnCoin() {
    const area = $("minigame-area");
    if (!area) return;
    const coin = document.createElement("span");
    coin.className = "minigame-coin";
    coin.textContent = "🪙";
    coin.style.left = `${5 + Math.random() * Math.max(1, area.clientWidth - 40)}px`;
    coin.style.top = `${5 + Math.random() * Math.max(1, area.clientHeight - 40)}px`;
    coin.addEventListener("click", (event) => {
      event.stopPropagation();
      mini.score += 1;
      $("minigame-score").textContent = String(mini.score);
      coin.remove();
    });
    area.appendChild(coin);
    setTimeout(() => coin.remove(), 1800);
  }

  function startMinigame() {
    if (mini.running || !G.minigameStatus(state).ready) return;
    mini.running = true;
    mini.score = 0;
    $("minigame-area").innerHTML = "";
    renderMinigame();
    mini.spawnTimer = setInterval(spawnCoin, 450);
    mini.endTimer = setTimeout(() => finishMinigame(), 15000);
    spawnCoin();
  }

  async function finishMinigame() {
    if (!mini.running) return null;
    mini.running = false;
    clearInterval(mini.spawnTimer);
    clearTimeout(mini.endTimer);
    mini.spawnTimer = null;
    mini.endTimer = null;
    $("minigame-area").innerHTML = "";
    const response = await runCommand({ type: "finish", score: mini.score }, "coin");
    renderMinigame();
    return response;
  }

  // ------------------------------------------------------------- 动作库管理
  function stickerItems() {
    const query = stickerQuery.trim().toLowerCase();
    return actions
      .filter((action) => !G.isStickerHidden(state, action))
      .filter((action) => {
        if (!query) return true;
        return G.effectiveLabel(state, action).toLowerCase().includes(query) || action.name.includes(query);
      });
  }

  function renderSticker() {
    const all = actions.filter((action) => !G.isStickerHidden(state, action));
    const items = stickerItems();
    const pages = Math.max(1, Math.ceil(items.length / STICKER_PAGE_SIZE));
    stickerPage = Math.min(Math.max(0, stickerPage), pages - 1);
    $("sticker-count").textContent =
      `${all.filter((action) => G.stickerRandomAllowed(state, action)).length} / ${all.length} 参与随机`;

    const selected = items.find((action) => action.name === stickerName) || items[0] || null;
    const grid = $("sticker-grid");
    if (!selected) {
      stickerName = null;
      $("sticker-preview-img").removeAttribute("src");
      $("sticker-rename").value = "";
      $("sticker-rename").disabled = true;
      $("sticker-preview-random").disabled = true;
      $("sticker-delete").disabled = true;
      grid.innerHTML = '<div class="sticker-empty">没有匹配的动作</div>';
      $("sticker-page").textContent = "0 / 0";
      $("sticker-prev").disabled = true;
      $("sticker-next").disabled = true;
      return;
    }

    stickerName = selected.name;
    $("sticker-preview-img").src = actionImageUrl(selected);
    $("sticker-preview-img").alt = G.effectiveLabel(state, selected);
    $("sticker-rename").disabled = false;
    $("sticker-rename").value = G.effectiveLabel(state, selected);
    $("sticker-preview-random").disabled = false;
    $("sticker-preview-random").classList.toggle("on", G.stickerRandomAllowed(state, selected));
    $("sticker-preview-random").textContent = G.stickerRandomAllowed(state, selected)
      ? "随机：开"
      : "随机：关";
    $("sticker-delete").disabled = false;
    $("sticker-delete").title = selected.user ? "删除这个自定义动作" : "隐藏这个内置动作";
    $("sticker-delete").textContent = "删除";
    pendingDelete = null;

    grid.innerHTML = "";
    const start = stickerPage * STICKER_PAGE_SIZE;
    items.slice(start, start + STICKER_PAGE_SIZE).forEach((action) => {
      const button = document.createElement("button");
      button.className = `sticker-item${action.name === stickerName ? " active" : ""}`;
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = actionThumbUrl(action);
      img.alt = G.effectiveLabel(state, action);
      const label = document.createElement("span");
      label.textContent = G.effectiveLabel(state, action);
      const star = document.createElement("i");
      star.className = "sticker-star";
      star.textContent = state.favorites.includes(action.name) ? "★" : "";
      star.addEventListener("click", async (event) => {
        event.stopPropagation();
        await runCommand({ type: "favorite", name: action.name });
      });
      const flag = document.createElement("i");
      flag.className = "sticker-flag";
      flag.textContent = G.stickerRandomAllowed(state, action) ? "●" : "○";
      button.append(img, label, star, flag);
      button.addEventListener("click", () => {
        stickerName = action.name;
        renderSticker();
      });
      grid.appendChild(button);
    });

    $("sticker-page").textContent = `${stickerPage + 1} / ${pages}`;
    $("sticker-prev").disabled = stickerPage <= 0;
    $("sticker-next").disabled = stickerPage >= pages - 1;
  }

  // ------------------------------------------------------------- 事件
  function closeWindow() {
    if (mini.running) {
      finishMinigame().finally(() => api.toolClose());
      return;
    }
    api.toolClose();
  }

  function wireEvents() {
    const close = ELEMENTS[tool] && ELEMENTS[tool].querySelector("header button:last-child");
    if (close) close.addEventListener("click", closeWindow);

    if (tool === "shop") {
      // 商品按钮由 renderShop 动态绑定。
      return;
    }

    if (tool === "gacha") {
      $("gacha-pull").addEventListener("click", async () => {
        const response = await runCommand({ type: "pull" }, "buy");
        if (response && response.result) showGachaResults([response.result]);
      });
      $("gacha-ten").addEventListener("click", async () => {
        const response = await runCommand({ type: "pull-ten" }, "buy");
        if (response && response.result && response.result.results) {
          showGachaResults(response.result.results);
        }
      });
      return;
    }

    if (tool === "minigame") {
      $("minigame-start").addEventListener("click", startMinigame);
      return;
    }

    if (tool === "sticker") {
      let renameTimer = null;
      $("sticker-search").addEventListener("input", (event) => {
        stickerQuery = event.target.value;
        stickerPage = 0;
        renderSticker();
      });
      $("sticker-prev").addEventListener("click", () => {
        stickerPage -= 1;
        renderSticker();
      });
      $("sticker-next").addEventListener("click", () => {
        stickerPage += 1;
        renderSticker();
      });
      $("sticker-preview-random").addEventListener("click", async () => {
        const action = actions.find((item) => item.name === stickerName);
        if (!action) return;
        await runCommand({
          type: "set-random",
          name: action.name,
          value: !G.stickerRandomAllowed(state, action),
        });
      });
      const rename = async () => {
        if (renameTimer) clearTimeout(renameTimer);
        renameTimer = null;
        if (!stickerName) return;
        await runCommand({
          type: "set-label",
          name: stickerName,
          label: $("sticker-rename").value,
        });
      };
      $("sticker-rename").addEventListener("blur", rename);
      $("sticker-rename").addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        rename();
        $("sticker-rename").blur();
      });
      $("sticker-bulk").addEventListener("click", async (event) => {
        const button = event.target.closest("[data-bulk]");
        if (!button) return;
        const mode = button.dataset.bulk === "fav" ? "favorites" : button.dataset.bulk;
        await runCommand({ type: "batch-random", mode });
        showToast(
          mode === "all" ? "所有动作已允许随机" : mode === "none" ? "所有动作已禁止随机" : "仅收藏参与随机"
        );
      });
      $("sticker-import").addEventListener("click", async () => {
        const result = await api.stickerImport();
        if (!result || !result.ok) {
          if (result && result.message) showToast(result.message);
          return;
        }
        if (result.added && result.added.length) {
          actions = await api.loadActions();
          stickerName = result.added[0].name;
          showToast(`已导入 ${result.added.length} 个动作图片`);
        } else {
          const reason = result.skipped && result.skipped[0] ? result.skipped[0].reason : "";
          showToast(reason === "duplicate" ? "这些动作图片已经在库里了" : "没有可导入的文件");
        }
        renderSticker();
      });
      $("sticker-download").addEventListener("click", async () => {
        const response = await runCommand({ type: "restore" });
        if (response && response.result) {
          showToast(
            response.result.restored ? `已恢复 ${response.result.restored} 个内置动作` : "内置动作都在"
          );
        }
      });
      $("sticker-reveal").addEventListener("click", () => api.stickerReveal());
      $("sticker-delete").addEventListener("click", async () => {
        const action = actions.find((item) => item.name === stickerName);
        if (!action) return;
        if (pendingDelete !== action.name) {
          pendingDelete = action.name;
          $("sticker-delete").textContent = "再点一次确认";
          setTimeout(() => {
            if (pendingDelete === action.name) {
              pendingDelete = null;
              $("sticker-delete").textContent = "删除";
            }
          }, 3000);
          return;
        }
        pendingDelete = null;
        const response = await runCommand({
          type: action.user ? "delete" : "hide",
          name: action.name,
        });
        if (response) stickerName = null;
      });
    }
  }

  async function boot() {
    if (!ELEMENTS[tool]) throw new Error("未知工具窗口");
    document.body.dataset.tool = tool;
    ELEMENTS[tool].classList.add("show");
    const snapshot = await api.toolSnapshot();
    applySnapshot(snapshot);
    wireEvents();

    api.onToolState((payload) => applySnapshot(payload));
    api.onToolActionsChanged(async () => {
      const list = await api.loadActions();
      if (Array.isArray(list) && list.length) actions = list;
      render();
    });
    api.onToolCommand((payload) => {
      if (payload && SHOP_TABS.includes(payload.tab)) {
        shopTab = payload.tab;
        renderShop();
      }
    });

    window.__toolTest = {
      getTool: () => tool,
      getState: () => (state ? JSON.parse(JSON.stringify(state)) : null),
      runCommand,
      revision: () => revision,
      miniScore: () => mini.score,
    };
    document.documentElement.dataset.toolReady = "1";
  }

  window.addEventListener("DOMContentLoaded", () => {
    boot().catch((err) => showToast(`工具窗口初始化失败：${err.message}`, 5000));
  });
})();
