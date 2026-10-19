/*
 * doro 桌面宠物的游戏逻辑（纯函数，不依赖 DOM / Electron）。
 * 浏览器里挂到 window.DoroGame，Node 里可以 require 进来跑单元测试。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DoroGame = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SAVE_VERSION = 3;

  // ---- 经济数值 -------------------------------------------------------------
  const BALANCE = {
    baseIncomePerLevel: 1, // 每级每秒产出的基础金币
    moodBonus: 0.5, // 心情满时的额外倍率（心情 0 -> x0.5，心情 100 -> x1.5）
    // 饿肚子只打折、不归零：桌面宠物是长驻陪伴，"没饭吃就一分钱没有"太劝退
    hungryMultiplier: 0.4, // 饱食度 < 30 时的产出系数
    starvingMultiplier: 0.2, // 饱食度 <= 8 时的产出系数（仍然每秒有进账）
    hungryThreshold: 30,
    emptyThreshold: 8,
    satietyDecayPerMinute: 0.25, // 每分钟掉多少饱食度（约 6.5 小时掉完）
    moodDecayPerMinute: 2 / 3, // 每分钟掉多少心情
    feedCost: 20, // 一顿饭的价格
    feedValue: 30, // 一顿饭回多少饱食度
    playCost: 30, // 玩具的价格
    playValue: 25, // 玩具回多少心情
    petCooldownMs: 1200,
    petMoodGain: 1.2,
    petCoinBonus: [1, 3], // 摸头随机掉落的金币区间
    upgradeBaseCost: 120, // 升级花费 = upgradeBaseCost * level^upgradeCostPower
    upgradeCostPower: 1.45,
    offlineEfficiency: 0.5, // 离线收益按在线的多少比例结算
    offlineCapHours: 8, // 离线收益最多结算多少小时
    offlineSatietyFloor: 30, // 离线时饱食度最低掉到这个值
    offlineMoodFloor: 25,
  };

  const DEFAULT_STATE = {
    version: SAVE_VERSION,
    coins: 0,
    totalEarned: 0,
    level: 1,
    satiety: 80,
    mood: 80,
    lastTick: 0,
    createdAt: 0,
    stats: { pets: 0, feeds: 0, plays: 0, upgrades: 0, sessions: 0, scheduleAdded: 0 },
    inventory: {},
    buffs: {},
    perks: {},
    unlocked: [],
    favorites: [],
    recent: [],
    schedule: [],
    shopStats: { purchases: 0, spent: 0 },
    daily: { date: "", progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0 }, claimed: [] },
    achievements: [],
    metrics: { days: {} },
    window: { x: null, y: null },
    settings: {
      alwaysOnTop: true,
      clickThrough: true,
      autoLaunch: false,
      showBubble: true,
      autoWalk: false,
      scale: 1,
      ambientIntervalSec: 60,
      autoWalkIntervalSec: 45,
      safeMode: true,
      sound: true,
      theme: "default",
      analytics: false,
      followCursor: false,
      dnd: false,
      roamSpeed: 55,
    },
  };

  const DIALOGUE = {
    idle: ["……", "今天也要搬砖吗", "我在这里哦", "发呆中", "摸摸头好不好", "要不要休息一下"],
    happy: ["嘿嘿", "好开心！", "再来一次～", "最喜欢你了", "今天心情不错", "抱抱！"],
    sad: ["呜……", "我饿了", "没力气了……", "不要丢下我", "肚子叫了", "金币好难赚"],
    angry: ["哼！", "生气了", "再摸就咬你了", "别烦我", "不理你了"],
    eat: ["好吃！", "再来一碗", "谢谢投喂", "咕噜咕噜"],
    play: ["传给我传给我", "好玩！", "不要停～"],
    coin: ["金币 +1", "搬砖中", "攒钱养老", "离买房又近一步"],
    offline: ["你回来啦", "我帮你看了会儿家", "等你很久了"],
  };

  // ---- 商城 ---------------------------------------------------------------
  // food / toy 买进背包，用掉才生效；buff 立即生效一段时间；permanent 永久
  const SHOP_ITEMS = {
    fish: {
      id: "fish",
      name: "小鱼干",
      type: "food",
      price: 15,
      satiety: 15,
      mood: 3,
      icon: "🐟",
      desc: "便宜零食，垫垫肚子",
    },
    milk_tea: {
      id: "milk_tea",
      name: "珍珠奶茶",
      type: "food",
      price: 35,
      satiety: 8,
      mood: 18,
      icon: "🧋",
      desc: "心情 +18，热量不管了",
    },
    cake: {
      id: "cake",
      name: "草莓蛋糕",
      type: "food",
      price: 55,
      satiety: 30,
      mood: 15,
      icon: "🍰",
      desc: "饱食 +30、心情 +15",
    },
    hotpot: {
      id: "hotpot",
      name: "一人火锅",
      type: "food",
      price: 90,
      satiety: 55,
      mood: 25,
      icon: "🍲",
      desc: "饱食 +55、心情 +25",
    },
    wand: { id: "wand", name: "逗猫棒", type: "toy", price: 40, mood: 22, icon: "🪄", desc: "心情 +22" },
    bubble: {
      id: "bubble",
      name: "泡泡机",
      type: "toy",
      price: 70,
      mood: 32,
      satiety: -3,
      icon: "🫧",
      desc: "心情 +32，玩累了掉点饱食",
    },
    gameboy: {
      id: "gameboy",
      name: "掌机",
      type: "toy",
      price: 140,
      mood: 50,
      satiety: -6,
      icon: "🎮",
      desc: "心情 +50，一玩一下午",
    },
    coffee: {
      id: "coffee",
      name: "提神咖啡",
      type: "buff",
      price: 80,
      buff: "double_income",
      minutes: 10,
      icon: "☕",
      desc: "接下来 10 分钟产出翻倍",
    },
    lucky_cat: {
      id: "lucky_cat",
      name: "招财猫",
      type: "permanent",
      price: 320,
      icon: "🐱",
      desc: "永久 +10% 产出",
    },
    theme_night: {
      id: "theme_night",
      name: "夜行主题",
      type: "theme",
      theme: "night",
      price: 800,
      icon: "🌙",
      desc: "深色面板 + 夜间配色",
    },
    theme_mint: {
      id: "theme_mint",
      name: "薄荷主题",
      type: "theme",
      theme: "mint",
      price: 1000,
      icon: "🌿",
      desc: "清爽的薄荷绿面板",
    },
    theme_sakura: {
      id: "theme_sakura",
      name: "樱花主题",
      type: "theme",
      theme: "sakura",
      price: 1200,
      icon: "🌸",
      desc: "更浓的樱花粉面板",
    },
  };

  const DAILY_TASKS = [
    { id: "pet5", label: "摸头 5 次", goal: 5, key: "pets", reward: 30 },
    { id: "feed1", label: "喂饭 1 次", goal: 1, key: "feeds", reward: 20 },
    { id: "play1", label: "陪玩 1 次", goal: 1, key: "plays", reward: 25 },
    { id: "actions10", label: "换 10 次动作", goal: 10, key: "actionsViewed", reward: 40 },
  ];

  const ACHIEVEMENTS = [
    { id: "first_pet", label: "第一次摸头", goal: 1, reward: 20, value: (s) => s.stats.pets },
    { id: "pet100", label: "摸头 100 次", goal: 100, reward: 120, value: (s) => s.stats.pets },
    { id: "feed20", label: "喂饭 20 次", goal: 20, reward: 80, value: (s) => s.stats.feeds },
    { id: "play20", label: "陪玩 20 次", goal: 20, reward: 80, value: (s) => s.stats.plays },
    { id: "level10", label: "升到 Lv.10", goal: 10, reward: 150, value: (s) => s.level },
    { id: "buy5", label: "商城购物 5 次", goal: 5, reward: 100, value: (s) => s.shopStats.purchases },
    {
      id: "collector",
      label: "收藏 10 个动作",
      goal: 10,
      reward: 60,
      value: (s) => (s.favorites || []).length,
    },
    {
      id: "scheduler",
      label: "添加 5 条日程",
      goal: 5,
      reward: 50,
      value: (s) => s.stats.scheduleAdded || 0,
    },
  ];

  const DRESS_BASE_PRICE = 60;
  const DRESS_PRICE_STEP = 12;
  const SCHEDULE_MAX = 20;

  // 动作库按"分组"给随机表演加权：表情包/小剧场少一点，日常多一点
  const GROUP_WEIGHT = {
    日常: 1.5,
    情绪: 1.2,
    吃睡: 1,
    玩乐: 1,
    打工: 0.7,
    换装: 0.9,
    小剧场: 0.5,
    表情包: 0.3,
  };

  /** 把动作库的 category 映射成"心情/表演"类型。 */
  function actionKind(action) {
    const category = action.category || action.kind || "idle";
    if (category === "idle" || category === "walk" || category === "run") return "idle";
    if (category === "happy" || category === "love") return "happy";
    if (category === "sad") return "sad";
    if (category === "angry") return "angry";
    return "fun";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function num(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const lo = min === undefined ? -Infinity : min;
    const hi = max === undefined ? Infinity : max;
    return clamp(parsed, lo, hi);
  }

  function freshState(now) {
    const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    state.lastTick = now;
    state.createdAt = now;
    state.stats.sessions = 1;
    return state;
  }

  /**
   * 存档迁移：键是"源版本"，值是把它升到下一个版本的函数。
   * 以后改存档结构时，在这里加一条即可，老存档会被逐版本升级。
   */
  const MIGRATIONS = {
    // 0 -> 1：最初的原型版本没有 version 字段，统计里也没有 sessions
    0: (raw) => {
      const stats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
      return Object.assign({}, raw, {
        version: 1,
        stats: Object.assign({}, stats, { sessions: num(stats.sessions, 0, 0) }),
      });
    },
    // 1 -> 2：动作库 / 商城 / 日程
    1: (raw) => {
      return Object.assign({}, raw, {
        version: 2,
        inventory: raw.inventory && typeof raw.inventory === "object" ? raw.inventory : {},
        buffs: raw.buffs && typeof raw.buffs === "object" ? raw.buffs : {},
        perks: raw.perks && typeof raw.perks === "object" ? raw.perks : {},
        unlocked: Array.isArray(raw.unlocked) ? raw.unlocked : [],
        schedule: Array.isArray(raw.schedule) ? raw.schedule : [],
        shopStats:
          raw.shopStats && typeof raw.shopStats === "object" ? raw.shopStats : { purchases: 0, spent: 0 },
      });
    },
    // 2 -> 3：每日任务 / 成就 / 本地统计 / 主题
    2: (raw) => {
      return Object.assign({}, raw, {
        version: 3,
        stats: Object.assign({ scheduleAdded: 0 }, raw.stats || {}),
        daily: raw.daily || {
          date: "",
          progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0 },
          claimed: [],
        },
        achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
        metrics: raw.metrics && typeof raw.metrics === "object" ? raw.metrics : { days: {} },
      });
    },
  };

  function migrate(raw) {
    let data = Object.assign({}, raw);
    let version = Number.isFinite(Number(data.version)) ? Number(data.version) : 0;
    while (version < SAVE_VERSION && MIGRATIONS[version]) {
      data = MIGRATIONS[version](data);
      version = Number(data.version);
    }
    if (!Number.isFinite(version) || version < SAVE_VERSION) version = SAVE_VERSION;
    data.version = version;
    return data;
  }

  /** 把存档文件（可能来自老版本 / 被人手改坏）合并成一份可用的状态。 */
  function hydrate(raw, now) {
    if (!raw || typeof raw !== "object") return freshState(now);
    raw = migrate(raw);
    const state = freshState(now);
    state.coins = num(raw.coins, 0, 0);
    state.totalEarned = num(raw.totalEarned, state.coins, 0);
    state.level = Math.round(num(raw.level, 1, 1, 999));
    state.satiety = num(raw.satiety, 80, 0, 100);
    state.mood = num(raw.mood, 80, 0, 100);
    state.createdAt = num(raw.createdAt, now, 0);
    state.lastTick = num(raw.lastTick, now, 0);
    state.stats = Object.assign({}, DEFAULT_STATE.stats, raw.stats || {});
    state.stats.sessions = num(state.stats.sessions, 0, 0) + 1;
    state.inventory = raw.inventory && typeof raw.inventory === "object" ? raw.inventory : {};
    state.buffs = raw.buffs && typeof raw.buffs === "object" ? raw.buffs : {};
    state.perks = raw.perks && typeof raw.perks === "object" ? raw.perks : {};
    state.unlocked = Array.isArray(raw.unlocked)
      ? raw.unlocked.filter((name) => typeof name === "string").slice(0, 500)
      : [];
    state.favorites = Array.isArray(raw.favorites)
      ? raw.favorites.filter((name) => typeof name === "string").slice(0, 200)
      : [];
    state.recent = Array.isArray(raw.recent)
      ? raw.recent.filter((name) => typeof name === "string").slice(0, 20)
      : [];
    state.schedule = Array.isArray(raw.schedule)
      ? raw.schedule
          .filter((item) => item && typeof item === "object" && typeof item.time === "string")
          .slice(0, SCHEDULE_MAX)
          .map(normalizeScheduleItem)
      : [];
    state.shopStats = Object.assign({ purchases: 0, spent: 0 }, raw.shopStats || {});
    state.daily =
      raw.daily && typeof raw.daily === "object" && raw.daily.progress
        ? {
            date: typeof raw.daily.date === "string" ? raw.daily.date : "",
            progress: Object.assign({ pets: 0, feeds: 0, plays: 0, actionsViewed: 0 }, raw.daily.progress),
            claimed: Array.isArray(raw.daily.claimed) ? raw.daily.claimed : [],
          }
        : { date: "", progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0 }, claimed: [] };
    state.achievements = Array.isArray(raw.achievements)
      ? raw.achievements.filter((id) => typeof id === "string")
      : [];
    state.metrics =
      raw.metrics && typeof raw.metrics === "object" && raw.metrics.days
        ? { days: raw.metrics.days }
        : { days: {} };
    state.window = Object.assign({}, DEFAULT_STATE.window, raw.window || {});
    state.settings = Object.assign({}, DEFAULT_STATE.settings, raw.settings || {});
    state.settings.scale = num(state.settings.scale, 1, 0.6, 1.8);
    state.settings.ambientIntervalSec = num(state.settings.ambientIntervalSec, 60, 5, 600);
    state.settings.autoWalkIntervalSec = num(state.settings.autoWalkIntervalSec, 45, 10, 600);
    if (!["default", "night", "mint", "sakura"].includes(state.settings.theme)) {
      state.settings.theme = "default";
    }
    state.settings.analytics = state.settings.analytics === true;
    state.settings.roamSpeed = num(state.settings.roamSpeed, 55, 20, 200);
    if (state.lastTick > now) state.lastTick = now;
    return state;
  }

  /** 当前每秒实际产出的金币（含等级、心情、饱食度影响）。 */
  function incomePerSecond(state) {
    const base = state.level * BALANCE.baseIncomePerLevel;
    const moodFactor = 1 + BALANCE.moodBonus * (state.mood / 100);
    const perkFactor = state.perks && state.perks.lucky_cat ? 1.1 : 1;
    const buffUntil = (state.buffs && state.buffs.double_income) || 0;
    const buffFactor = buffUntil > Date.now() ? 2 : 1;
    const feedFactor =
      state.satiety < BALANCE.hungryThreshold
        ? state.satiety <= BALANCE.emptyThreshold
          ? BALANCE.starvingMultiplier
          : BALANCE.hungryMultiplier
        : 1;
    return base * moodFactor * feedFactor * perkFactor * buffFactor;
  }

  function incomeBreakdown(state) {
    return {
      perSecond: incomePerSecond(state),
      base: state.level * BALANCE.baseIncomePerLevel,
      moodFactor: 1 + BALANCE.moodBonus * (state.mood / 100),
      hungry: state.satiety < BALANCE.hungryThreshold,
      starving: state.satiety <= BALANCE.emptyThreshold,
    };
  }

  /**
   * 推进 elapsedMs 毫秒。超过 5 分钟的空档按"离线"处理（打折结算），
   * 避免把电脑休眠的时间算成暴富。
   */
  function tick(state, elapsedMs) {
    const seconds = Math.max(0, elapsedMs) / 1000;
    if (seconds <= 0) return { earned: 0, offline: false };

    const offline = seconds > 300;
    const efficiency = offline ? BALANCE.offlineEfficiency : 1;
    const earned = incomePerSecond(state) * seconds * efficiency;

    state.coins += earned;
    state.totalEarned += earned;
    state.satiety = clamp(state.satiety - (BALANCE.satietyDecayPerMinute * seconds) / 60, 0, 100);
    state.mood = clamp(state.mood - (BALANCE.moodDecayPerMinute * seconds) / 60, 0, 100);
    if (state.settings && state.settings.analytics && state.metrics) {
      const key = dayKey();
      state.metrics.days[key] = Math.min(86400, (state.metrics.days[key] || 0) + seconds);
      const keys = Object.keys(state.metrics.days).sort();
      if (keys.length > 60) {
        state.metrics.days = Object.fromEntries(keys.slice(-60).map((k) => [k, state.metrics.days[k]]));
      }
    }
    state.lastTick = Date.now();
    return { earned, offline, efficiency };
  }

  /** 从存档的 lastTick 结算到现在的收益。 */
  function settleOffline(state, now) {
    const elapsed = Math.max(0, (now - state.lastTick) / 1000);
    if (elapsed < 60) {
      state.lastTick = now;
      return { seconds: 0, earned: 0 };
    }
    const capped = Math.min(elapsed, BALANCE.offlineCapHours * 3600);
    const earned = incomePerSecond(state) * capped * BALANCE.offlineEfficiency;
    state.coins += earned;
    state.totalEarned += earned;
    state.satiety = Math.max(
      BALANCE.offlineSatietyFloor,
      state.satiety - (BALANCE.satietyDecayPerMinute * capped) / 60
    );
    state.mood = Math.max(BALANCE.offlineMoodFloor, state.mood - (BALANCE.moodDecayPerMinute * capped) / 60);
    state.lastTick = now;
    return { seconds: capped, earned };
  }

  function canAfford(state, cost) {
    return state.coins >= cost;
  }

  function feed(state, now) {
    if (!canAfford(state, BALANCE.feedCost)) {
      return { ok: false, reason: "coin", dialogue: "金币不够买饭……" };
    }
    if (state.satiety >= 99) {
      return { ok: false, reason: "full", dialogue: "吃不下了，撑到了" };
    }
    state.coins -= BALANCE.feedCost;
    state.satiety = clamp(state.satiety + BALANCE.feedValue, 0, 100);
    state.mood = clamp(state.mood + 4, 0, 100);
    state.stats.feeds += 1;
    bumpDaily(state, "feeds");
    state.lastTick = now || Date.now();
    return { ok: true, dialogue: "好吃！" };
  }

  function play(state, now) {
    if (!canAfford(state, BALANCE.playCost)) {
      return { ok: false, reason: "coin", dialogue: "玩具太贵了……" };
    }
    if (state.mood >= 99 && state.satiety > BALANCE.hungryThreshold) {
      return { ok: false, reason: "happy", dialogue: "我已经很开心啦" };
    }
    state.coins -= BALANCE.playCost;
    state.mood = clamp(state.mood + BALANCE.playValue, 0, 100);
    state.satiety = clamp(state.satiety - 3, 0, 100);
    state.stats.plays += 1;
    bumpDaily(state, "plays");
    state.lastTick = now || Date.now();
    return { ok: true, dialogue: "好玩！" };
  }

  function upgradeCost(state) {
    return Math.round(BALANCE.upgradeBaseCost * Math.pow(state.level, BALANCE.upgradeCostPower));
  }

  function upgrade(state, now) {
    const cost = upgradeCost(state);
    if (!canAfford(state, cost)) {
      return { ok: false, reason: "coin", cost, dialogue: "还差一点钱……" };
    }
    state.coins -= cost;
    state.level += 1;
    state.stats.upgrades += 1;
    state.lastTick = now || Date.now();
    return { ok: true, cost, dialogue: `摸鱼等级 Lv.${state.level}！` };
  }

  /** 摸头：加心情 + 偶尔掉金币。 */
  function pet(state, now, rng) {
    const random = rng || Math.random;
    state.stats.pets += 1;
    bumpDaily(state, "pets");
    state.mood = clamp(state.mood + BALANCE.petMoodGain, 0, 100);
    const [lo, hi] = BALANCE.petCoinBonus;
    const bonus = lo + Math.floor(random() * (hi - lo + 1));
    state.coins += bonus;
    state.totalEarned += bonus;
    state.lastTick = now || Date.now();
    return { bonus, dialogue: pick(DIALOGUE.happy, random) };
  }

  function pick(list, rng) {
    const random = rng || Math.random;
    return list[Math.floor(random() * list.length) % list.length];
  }

  function moodFace(state) {
    if (state.satiety <= BALANCE.emptyThreshold) return "sad";
    if (state.satiety < BALANCE.hungryThreshold) return "sad";
    if (state.mood < 30) return "sad";
    if (state.mood > 80) return "happy";
    return "idle";
  }

  function dialogueFor(kind, state, rng) {
    if (kind === "coin") return pick(DIALOGUE.coin, rng);
    if (kind === "eat") return pick(DIALOGUE.eat, rng);
    if (kind === "play") return pick(DIALOGUE.play, rng);
    if (kind === "offline") return pick(DIALOGUE.offline, rng);
    const face = moodFace(state);
    if (kind === "auto") kind = face;
    return pick(DIALOGUE[kind] || DIALOGUE.idle, rng);
  }

  /**
   * 随机挑一个"表演动作"。饿的时候只演惨的，心情好时多演开心的。
   * actions 是 assets/actions.json 里的数组。
   */
  function pickAmbientAction(actions, state, rng) {
    const random = rng || Math.random;
    const face = moodFace(state);
    const safeMode = !state.settings || state.settings.safeMode !== false;
    // 太小的贴图放大后很糊，不参与随机表演
    const usable = actions.filter((action) => {
      const size = action.size;
      const bigEnough = !size || Math.max(size[0], size[1]) >= 140;
      if (!bigEnough || !isUnlocked(state, action)) return false;
      if (action.blocked) return false;
      if (safeMode && action.group === "表情包") return false;
      return true;
    });
    const source = usable.length ? usable : actions;
    const weights = source.map((action) => {
      const kind = actionKind(action);
      let weight = GROUP_WEIGHT[action.group] || 1;
      if (kind === "fun") weight *= 0.8;
      if (kind === "idle" && action.category === "walk") weight *= 0.6;
      if (face === "sad") {
        if (kind === "sad") weight *= 4;
        if (kind === "happy" || kind === "fun") weight *= 0.35;
      } else if (face === "happy") {
        if (kind === "happy") weight *= 2.4;
        if (kind === "sad") weight *= 0.2;
      } else if (kind === "idle") {
        weight *= 1.3;
      }
      return weight;
    });
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = random() * total;
    for (let i = 0; i < source.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) return source[i];
    }
    return source[source.length - 1];
  }

  /** 下次自动换动作要等多久（毫秒）：配置秒数 ±25%。 */
  function nextActionDelay(rng, seconds) {
    const random = rng || Math.random;
    const base = clamp(Number(seconds) || 60, 5, 600);
    return base * 1000 * (0.75 + random() * 0.5);
  }

  // ---- 商城 ---------------------------------------------------------------
  /** 换装动作默认锁着，需要商城解锁；其它动作直接可用。 */
  function isUnlocked(state, action) {
    if (!action) return false;
    if (action.category !== "dress") return true;
    return (state.unlocked || []).includes(action.name);
  }

  function dressPrice(index) {
    return DRESS_BASE_PRICE + index * DRESS_PRICE_STEP;
  }

  function activeBuff(state, key, now) {
    const until = state.buffs && state.buffs[key];
    return until && until > (now || Date.now()) ? until : 0;
  }

  function purchase(state, item, now) {
    if (!item || !item.id) return { ok: false, reason: "bad-item" };
    if (!canAfford(state, item.price)) return { ok: false, reason: "coin" };
    if (item.type === "dress" && isUnlocked(state, { category: "dress", name: item.action })) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "permanent" && state.perks[item.id]) return { ok: false, reason: "owned" };
    if (item.type === "theme" && state.perks[`theme_${item.theme}`]) return { ok: false, reason: "owned" };

    const ts = now || Date.now();
    state.coins -= item.price;
    state.shopStats.purchases += 1;
    state.shopStats.spent += item.price;
    if (item.type === "food" || item.type === "toy") {
      state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
    } else if (item.type === "buff") {
      const start = Math.max(ts, activeBuff(state, item.buff, ts));
      state.buffs[item.buff] = start + item.minutes * 60000;
    } else if (item.type === "permanent") {
      state.perks[item.id] = true;
    } else if (item.type === "theme") {
      state.perks[`theme_${item.theme}`] = true;
      state.settings.theme = item.theme;
    } else if (item.type === "dress") {
      if (!state.unlocked.includes(item.action)) state.unlocked.push(item.action);
    }
    state.lastTick = ts;
    return { ok: true, item };
  }

  function useItem(state, item, now) {
    if (!item || (item.type !== "food" && item.type !== "toy")) {
      return { ok: false, reason: "not-usable" };
    }
    const count = state.inventory[item.id] || 0;
    if (count <= 0) return { ok: false, reason: "empty" };
    state.inventory[item.id] = count - 1;
    if (item.satiety) state.satiety = clamp(state.satiety + item.satiety, 0, 100);
    if (item.mood) state.mood = clamp(state.mood + item.mood, 0, 100);
    state.lastTick = now || Date.now();
    return { ok: true, item };
  }

  // ---- 日程 ---------------------------------------------------------------
  function dayKey(now) {
    const d = new Date(now || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function normalizeScheduleItem(item) {
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.test(item.time || "") ? item.time : "09:00";
    return {
      id: typeof item.id === "string" ? item.id.slice(0, 24) : `s${Math.random().toString(36).slice(2, 8)}`,
      time,
      text: String(item.text || "").slice(0, 30) || "提醒",
      action: typeof item.action === "string" ? item.action.slice(0, 40) : null,
      repeat: ["once", "weekdays", "weekend"].includes(item.repeat) ? item.repeat : "daily",
      doneDate: typeof item.doneDate === "string" ? item.doneDate : "",
      notifiedDate: typeof item.notifiedDate === "string" ? item.notifiedDate : "",
    };
  }

  function isScheduleDone(item, key) {
    return item.repeat === "once" ? Boolean(item.doneDate) : item.doneDate === key;
  }

  function addScheduleItem(state, input, now) {
    if (!state.schedule) state.schedule = [];
    if (state.schedule.length >= SCHEDULE_MAX) return { ok: false, reason: "full" };
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test((input && input.time) || "")) {
      return { ok: false, reason: "time" };
    }
    const text = String((input && input.text) || "")
      .trim()
      .slice(0, 30);
    if (!text) return { ok: false, reason: "text" };
    const item = normalizeScheduleItem({
      time: input.time,
      text,
      action: input.action || null,
      repeat: ["once", "weekdays", "weekend"].includes(input.repeat) ? input.repeat : "daily",
      id: `s${(now || Date.now()).toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    });
    state.schedule.push(item);
    state.stats.scheduleAdded = (state.stats.scheduleAdded || 0) + 1;
    state.schedule.sort((a, b) => a.time.localeCompare(b.time));
    return { ok: true, item };
  }

  function removeScheduleItem(state, id) {
    const before = state.schedule.length;
    state.schedule = state.schedule.filter((item) => item.id !== id);
    return state.schedule.length !== before;
  }

  function toggleScheduleItem(state, id, now) {
    const key = dayKey(now);
    const item = state.schedule.find((entry) => entry.id === id);
    if (!item) return false;
    item.doneDate = isScheduleDone(item, key) ? "" : key;
    return true;
  }

  /** 到了时间、今天还没完成、也还没提醒过的日程。 */
  function scheduleTimestamp(item, now) {
    const date = new Date(now || Date.now());
    const [hours, minutes] = String(item.time || "00:00")
      .split(":")
      .map(Number);
    date.setHours(hours || 0, minutes || 0, 0, 0);
    return date.getTime();
  }

  function dueScheduleItems(state, now) {
    const ts = now || Date.now();
    const key = dayKey(ts);
    const weekday = new Date(ts).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const hhmm = new Date(ts).toTimeString().slice(0, 5);
    return (state.schedule || []).filter(
      (item) =>
        item.time <= hhmm &&
        !isScheduleDone(item, key) &&
        (item.repeat !== "weekdays" || !isWeekend) &&
        (item.repeat !== "weekend" || isWeekend) &&
        (item.repeat === "once" ? !item.notifiedDate : item.notifiedDate !== key)
    );
  }

  /** 稍后提醒：把时间改成 now + minutes，并清掉今天的完成/提醒标记。 */
  function snoozeScheduleItem(state, id, minutes, now) {
    const item = state.schedule.find((entry) => entry.id === id);
    if (!item) return false;
    const date = new Date((now || Date.now()) + Math.max(1, minutes || 10) * 60000);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    item.time = `${hh}:${mm}`;
    item.doneDate = "";
    item.notifiedDate = "";
    state.schedule.sort((a, b) => a.time.localeCompare(b.time));
    return true;
  }

  function markScheduleNotified(state, id, now) {
    const item = state.schedule.find((entry) => entry.id === id);
    if (item) item.notifiedDate = dayKey(now);
  }

  // ---- 每日任务 / 成就 / 本地统计 -----------------------------------------
  function ensureDaily(state, now) {
    const key = dayKey(now || Date.now());
    if (!state.daily || state.daily.date !== key) {
      state.daily = { date: key, progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0 }, claimed: [] };
    }
    return state.daily;
  }

  function bumpDaily(state, key, amount, now) {
    const daily = ensureDaily(state, now);
    daily.progress[key] = (daily.progress[key] || 0) + (amount || 1);
  }

  function dailyTasks(state, now) {
    const daily = ensureDaily(state, now);
    return DAILY_TASKS.map((task) => {
      const progress = Math.min(task.goal, daily.progress[task.key] || 0);
      return { ...task, progress, claimed: daily.claimed.includes(task.id), ready: progress >= task.goal };
    });
  }

  function claimDaily(state, id, now) {
    const daily = ensureDaily(state, now);
    const task = DAILY_TASKS.find((entry) => entry.id === id);
    if (!task || daily.claimed.includes(id) || (daily.progress[task.key] || 0) < task.goal) {
      return { ok: false };
    }
    daily.claimed.push(id);
    state.coins += task.reward;
    state.totalEarned += task.reward;
    return { ok: true, reward: task.reward };
  }

  function achievementList(state) {
    return ACHIEVEMENTS.map((entry) => {
      const value = Math.min(entry.goal, Math.max(0, Number(entry.value(state)) || 0));
      return {
        ...entry,
        value,
        claimed: state.achievements.includes(entry.id),
        ready: value >= entry.goal,
      };
    });
  }

  function claimAchievement(state, id) {
    const entry = ACHIEVEMENTS.find((item) => item.id === id);
    if (!entry || state.achievements.includes(id)) return { ok: false };
    if ((Number(entry.value(state)) || 0) < entry.goal) return { ok: false };
    state.achievements.push(id);
    state.coins += entry.reward;
    state.totalEarned += entry.reward;
    return { ok: true, reward: entry.reward };
  }

  function analyticsSummary(state) {
    const days = Object.keys((state.metrics && state.metrics.days) || {});
    const today = (state.metrics && state.metrics.days[dayKey()]) || 0;
    return { days: days.length, todaySeconds: Math.round(today), sessions: state.stats.sessions };
  }

  function formatCoins(value) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
    return Math.floor(value).toString();
  }

  return {
    BALANCE,
    DEFAULT_STATE,
    DIALOGUE,
    GROUP_WEIGHT,
    actionKind,
    SHOP_ITEMS,
    DAILY_TASKS,
    ACHIEVEMENTS,
    DRESS_BASE_PRICE,
    DRESS_PRICE_STEP,
    SCHEDULE_MAX,
    isUnlocked,
    dressPrice,
    activeBuff,
    purchase,
    useItem,
    dayKey,
    addScheduleItem,
    removeScheduleItem,
    toggleScheduleItem,
    dueScheduleItems,
    markScheduleNotified,
    scheduleTimestamp,
    isScheduleDone,
    snoozeScheduleItem,
    ensureDaily,
    bumpDaily,
    dailyTasks,
    claimDaily,
    achievementList,
    claimAchievement,
    analyticsSummary,
    SAVE_VERSION,
    migrate,
    hydrate,
    freshState,
    incomePerSecond,
    incomeBreakdown,
    tick,
    settleOffline,
    feed,
    play,
    upgrade,
    upgradeCost,
    pet,
    moodFace,
    dialogueFor,
    pickAmbientAction,
    nextActionDelay,
    formatCoins,
    canAfford,
    clamp,
  };
});
