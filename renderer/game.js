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

  const SAVE_VERSION = 9;

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
    petCooldownMs: 1500,
    petMoodGain: 1.0,
    petCoinBonus: [1, 2], // 摸头随机掉落的金币区间
    upgradeBaseCost: 120, // 升级花费 = upgradeBaseCost * level^upgradeCostPower
    upgradeCostPower: 1.35,
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
    stickerRandom: {},
    stickerLabels: {},
    schedule: [],
    shopStats: { purchases: 0, spent: 0 },
    daily: { date: "", progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0 }, claimed: [] },
    achievements: [],
    metrics: { days: {} },
    seenActions: [],
    wish: null,
    checkin: { lastDate: "", streak: 0 },
    bank: { amount: 0, dueAt: 0 },
    gacha: { pulls: 0 },
    minigame: { lastPlayedAt: 0 },
    visitor: null,
    nextVisitorAt: 0,
    room: { furniture: [] },
    companion: { adopted: false },
    profile: {
      personality: "gentle",
      likes: ["milk_tea", "wand"],
      dislikes: ["bubble"],
      reshapes: 0,
    },
    training: {
      points: 0,
      totalEarned: 0,
      totalSpent: 0,
      learned: ["idle_stand", "walk_bag", "sleep_cat", "closeup_soft"],
    },
    work: {
      jobs: [],
      fragments: 0,
      completed: 0,
    },
    quiz: {
      examCode: "architect",
      dailyDate: "",
      dailyDone: false,
      dailyCorrect: false,
      eventReadyAt: 0,
      totals: { answered: 0, correct: 0, wrong: 0, earned: 0, spent: 0 },
      exam: { taken: 0, bestScore: 0, lastScore: 0, lastPassed: false },
      history: [],
    },
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
      quizApiBase: "http://192.168.0.193:9300",
      updateFeedUrl: "http://192.168.0.193:9400/updates",
      updateAutoCheck: true,
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

  const PERSONALITIES = {
    gentle: {
      id: "gentle",
      name: "温柔",
      icon: "🌷",
      desc: "温和稳定的基准性格，互动与产出没有额外修正",
      income: 1,
      petMood: 1,
      feedMood: 1,
      playMood: 1,
      actionWeights: { love: 1.2, happy: 1.1 },
    },
    clever: {
      id: "clever",
      name: "机灵",
      icon: "✨",
      desc: "更爱小剧场和表情包，永久 +6% 产出",
      income: 1.06,
      petMood: 0.9,
      feedMood: 1,
      playMood: 1.05,
      actionWeights: { scene: 1.5, meme: 1.35 },
    },
    diligent: {
      id: "diligent",
      name: "勤勉",
      icon: "💼",
      desc: "更爱打工动作，永久 +12% 产出，摸头心情较低",
      income: 1.12,
      petMood: 0.7,
      feedMood: 1,
      playMood: 0.9,
      actionWeights: { work: 1.7, idle: 1.1 },
    },
    gourmet: {
      id: "gourmet",
      name: "贪吃",
      icon: "🍰",
      desc: "更爱吃睡动作，喂饭心情 +80%，永久 -3% 产出",
      income: 0.97,
      petMood: 1,
      feedMood: 1.8,
      playMood: 1,
      actionWeights: { eat: 1.65 },
    },
    playful: {
      id: "playful",
      name: "活泼",
      icon: "🎈",
      desc: "更爱玩乐动作，陪玩心情 +45%，永久 -2% 产出",
      income: 0.98,
      petMood: 1.1,
      feedMood: 1,
      playMood: 1.45,
      actionWeights: { play: 1.7, music: 1.35 },
    },
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
      price: 120,
      buff: "double_income",
      minutes: 10,
      icon: "☕",
      desc: "接下来 10 分钟产出 ×1.5",
    },
    lucky_cat: {
      id: "lucky_cat",
      name: "招财猫",
      type: "permanent",
      price: 2000,
      icon: "🐱",
      desc: "永久 +10% 产出",
    },
    theme_night: {
      id: "theme_night",
      name: "夜行主题",
      type: "theme",
      theme: "night",
      price: 6000,
      icon: "🌙",
      desc: "深色面板 + 夜间配色",
    },
    theme_mint: {
      id: "theme_mint",
      name: "薄荷主题",
      type: "theme",
      theme: "mint",
      price: 10000,
      icon: "🌿",
      desc: "清爽的薄荷绿面板",
    },
    theme_sakura: {
      id: "theme_sakura",
      name: "樱花主题",
      type: "theme",
      theme: "sakura",
      price: 16000,
      icon: "🌸",
      desc: "更浓的樱花粉面板",
    },
    luxury_cushion: {
      id: "luxury_cushion",
      name: "鎏金软垫",
      type: "luxury",
      price: 66000,
      bonus: 0.08,
      icon: "🛋️",
      desc: "永久 +8% 产出，典藏级舒适",
    },
    luxury_crystal: {
      id: "luxury_crystal",
      name: "星辉水晶灯",
      type: "luxury",
      price: 188000,
      bonus: 0.12,
      icon: "🔮",
      desc: "永久 +12% 产出，房间里会发光",
    },
    luxury_office: {
      id: "luxury_office",
      name: "私人摸鱼办公室",
      type: "luxury",
      price: 520000,
      bonus: 0.18,
      icon: "🏢",
      desc: "永久 +18% 产出，带门禁的那种",
    },
    luxury_estate: {
      id: "luxury_estate",
      name: "doro 小庄园",
      type: "luxury",
      price: 1280000,
      bonus: 0.3,
      icon: "🏡",
      desc: "永久 +30% 产出，从桌宠升级为地主",
    },
    luxury_hourglass: {
      id: "luxury_hourglass",
      name: "时间沙漏",
      type: "luxury",
      price: 2500000,
      bonus: 0.45,
      icon: "⏳",
      desc: "永久 +45% 产出，摸鱼时间也是资产",
    },
    profile_personality: {
      id: "profile_personality",
      name: "性格重塑卡",
      type: "profile",
      profileAction: "personality",
      price: 88000,
      icon: "🎭",
      desc: "随机重塑性格，并重新抽取偏好",
    },
    profile_preferences: {
      id: "profile_preferences",
      name: "偏好重置券",
      type: "profile",
      profileAction: "preferences",
      price: 24000,
      icon: "💡",
      desc: "保留性格，重新抽取喜欢与不喜欢",
    },
  };

  const PREFERENCE_ITEM_IDS = ["fish", "milk_tea", "cake", "hotpot", "wand", "bubble", "gameboy"];
  const STARTER_ACTIONS = ["idle_stand", "walk_bag", "sleep_cat", "closeup_soft"];
  const TRAINING_COSTS = {
    日常: 12,
    情绪: 14,
    吃睡: 10,
    玩乐: 16,
    打工: 18,
    小剧场: 24,
    表情包: 28,
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
    {
      id: "seen10",
      label: "图鉴：看过 10 个动作",
      goal: 10,
      reward: 40,
      value: (s) => (s.seenActions || []).length,
    },
    {
      id: "seen50",
      label: "图鉴：看过 50 个动作",
      goal: 50,
      reward: 100,
      value: (s) => (s.seenActions || []).length,
    },
    {
      id: "seen100",
      label: "图鉴：看过 100 个动作",
      goal: 100,
      reward: 200,
      value: (s) => (s.seenActions || []).length,
    },
    {
      id: "seen295",
      label: "图鉴：集齐 295 个动作",
      goal: 295,
      reward: 600,
      value: (s) => (s.seenActions || []).length,
    },
  ];

  const WISH_CATEGORIES = [
    { key: "idle", group: "日常" },
    { key: "happy", group: "情绪" },
    { key: "eat", group: "吃睡" },
    { key: "play", group: "玩乐" },
    { key: "dress", group: "换装" },
    { key: "scene", group: "小剧场" },
  ];

  const TITLES = [
    { level: 50, name: "摸鱼合伙人" },
    { level: 30, name: "摸鱼总监" },
    { level: 20, name: "摸鱼经理" },
    { level: 10, name: "摸鱼主管" },
    { level: 5, name: "摸鱼专员" },
    { level: 1, name: "摸鱼实习生" },
  ];

  const GACHA_PRICE = 500;
  const BANK_HOURS = 8;
  const BANK_RATE = 0.15;
  const MINIGAME_COOLDOWN_MS = 5 * 60000;

  const FURNITURE = {
    cat_tree: { id: "cat_tree", name: "猫爬架", icon: "🐈", price: 800, bonus: 0.05, desc: "+5% 产出" },
    rug: { id: "rug", name: "小地毯", icon: "🧶", price: 500, bonus: 0.02, desc: "+2% 产出" },
    plant: { id: "plant", name: "绿植", icon: "🪴", price: 1200, bonus: 0.04, desc: "+4% 产出" },
    lamp: { id: "lamp", name: "落地灯", icon: "💡", price: 2000, bonus: 0.06, desc: "+6% 产出" },
    companion: {
      id: "companion",
      name: "伙伴 doro",
      icon: "🐣",
      price: 3000,
      bonus: 0.08,
      desc: "领养小伙伴，+8% 产出",
    },
  };

  const DRESS_BASE_PRICE = 80;
  const DRESS_PRICE_STEP = 20;
  const SCHEDULE_MAX = 20;

  // ---- 题库 -------------------------------------------------------------
  // 每种模式的奖励规则：答对 / 答错分别对金币的影响。模拟考试不涉及金币。
  const QUIZ_RULES = {
    daily: { correct: 100, wrong: 0 },
    quiz: { correct: 100, wrong: -10 },
    random: { correct: 100, wrong: -10 },
    event: { correct: 100, wrong: 0 },
    exam: { correct: 0, wrong: 0 },
  };
  const QUIZ_EVENT_COOLDOWN_MS = 20 * 60000;

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

  function seededRandom(seed) {
    let value = Number(seed) >>> 0;
    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function shuffle(list, random) {
    const result = list.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function createProfile(personalityId, random) {
    const personality = PERSONALITIES[personalityId] ? personalityId : "gentle";
    const rng = typeof random === "function" ? random : Math.random;
    const shuffled = shuffle(PREFERENCE_ITEM_IDS, rng);
    return {
      personality,
      likes: shuffled.slice(0, 2),
      dislikes: shuffled.slice(2, 3),
      reshapes: 0,
    };
  }

  function normalizeProfile(raw, seed) {
    const source = raw && typeof raw === "object" ? raw : {};
    const personality = PERSONALITIES[source.personality] ? source.personality : "gentle";
    const generated = createProfile(personality, seededRandom(seed || Date.now()));
    const validIds = new Set(PREFERENCE_ITEM_IDS);
    const likes = Array.isArray(source.likes)
      ? [...new Set(source.likes.filter((id) => validIds.has(id)))].slice(0, 2)
      : [];
    while (likes.length < 2) {
      const next = generated.likes.find((id) => !likes.includes(id));
      if (!next) break;
      likes.push(next);
    }
    const dislikes = Array.isArray(source.dislikes)
      ? [...new Set(source.dislikes.filter((id) => validIds.has(id) && !likes.includes(id)))].slice(0, 1)
      : [];
    if (!dislikes.length) {
      const next = generated.dislikes.find((id) => !likes.includes(id));
      if (next) dislikes.push(next);
    }
    return {
      personality,
      likes,
      dislikes,
      reshapes: num(source.reshapes, 0, 0, 1e9),
    };
  }

  function personalityOf(state) {
    const profile = state && state.profile ? state.profile : DEFAULT_STATE.profile;
    return PERSONALITIES[profile.personality] || PERSONALITIES.gentle;
  }

  function preferenceFor(state, itemId) {
    const profile = state && state.profile ? state.profile : DEFAULT_STATE.profile;
    if (profile.likes.includes(itemId)) return "like";
    if (profile.dislikes.includes(itemId)) return "dislike";
    return "neutral";
  }

  function profileDetails(state) {
    const profile = normalizeProfile(state.profile, state.createdAt);
    const personality = personalityOf({ profile });
    const itemDetails = (ids) => ids.map((id) => SHOP_ITEMS[id]).filter(Boolean);
    return {
      personality,
      likes: itemDetails(profile.likes),
      dislikes: itemDetails(profile.dislikes),
      reshapes: profile.reshapes,
    };
  }

  function reshapeProfile(state, mode, random) {
    const rng = typeof random === "function" ? random : Math.random;
    const current = normalizeProfile(state.profile, state.createdAt);
    let personality = current.personality;
    if (mode === "personality") {
      const choices = Object.keys(PERSONALITIES).filter((id) => id !== personality);
      personality = choices[Math.floor(rng() * choices.length) % choices.length];
    }
    const next = createProfile(personality, rng);
    next.reshapes = current.reshapes + 1;
    if (mode !== "personality" && mode !== "preferences") return current;
    state.profile = next;
    return next;
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
    // 3 -> 4：图鉴 / 心愿 / 签到 / 银行 / 扭蛋 / 访客 / 房间 / 伙伴
    3: (raw) => {
      return Object.assign({}, raw, {
        version: 4,
        seenActions: Array.isArray(raw.seenActions) ? raw.seenActions : [],
        wish: raw.wish || null,
        checkin: raw.checkin || { lastDate: "", streak: 0 },
        bank: raw.bank || { amount: 0, dueAt: 0 },
        gacha: raw.gacha || { pulls: 0 },
        minigame: raw.minigame || { lastPlayedAt: 0 },
        visitor: raw.visitor || null,
        nextVisitorAt: raw.nextVisitorAt || 0,
        room: raw.room || { furniture: [] },
        companion: raw.companion || { adopted: false },
      });
    },
    // 4 -> 5：题库（每日一题 / 随堂小测 / 随机刷题 / 答题事件 / 模拟考试）与更新配置
    4: (raw) => {
      return Object.assign({}, raw, {
        version: 5,
        quiz: raw.quiz || {
          examCode: "architect",
          dailyDate: "",
          dailyDone: false,
          dailyCorrect: false,
          eventReadyAt: 0,
          totals: { answered: 0, correct: 0, wrong: 0, earned: 0, spent: 0 },
          exam: { taken: 0, bestScore: 0, lastScore: 0, lastPassed: false },
          history: [],
        },
        settings: Object.assign(
          {
            quizApiBase: "http://192.168.0.193:9300",
            updateFeedUrl: "http://192.168.0.193:9400/updates",
            updateAutoCheck: true,
          },
          raw.settings || {}
        ),
      });
    },
    // 5 -> 6：表情包管理（随机开关 / 自定义名称）
    5: (raw) => {
      return Object.assign({}, raw, {
        version: 6,
        stickerRandom: raw.stickerRandom && typeof raw.stickerRandom === "object" ? raw.stickerRandom : {},
        stickerLabels: raw.stickerLabels && typeof raw.stickerLabels === "object" ? raw.stickerLabels : {},
      });
    },
    // 6 -> 7：性格、偏好与典藏商品
    6: (raw) => {
      return Object.assign({}, raw, {
        version: 7,
        profile: raw.profile && typeof raw.profile === "object" ? raw.profile : DEFAULT_STATE.profile,
      });
    },
    // 7 -> 8：动作训练。旧档按历史记录补偿已学招式，避免已有动作被收回。
    7: (raw) => {
      const learned = [
        ...STARTER_ACTIONS,
        ...(Array.isArray(raw.seenActions) ? raw.seenActions : []),
        ...(Array.isArray(raw.favorites) ? raw.favorites : []),
        ...(Array.isArray(raw.recent) ? raw.recent : []),
        raw.settings && raw.settings.baseAction ? raw.settings.baseAction : "",
      ];
      return Object.assign({}, raw, {
        version: 8,
        training: {
          points: 0,
          totalEarned: 0,
          totalSpent: 0,
          learned: [...new Set(learned.filter(Boolean))],
        },
      });
    },
    // 8 -> 9：伙伴 / 访客派遣打工
    8: (raw) => {
      return Object.assign({}, raw, {
        version: 9,
        work: raw.work && typeof raw.work === "object" ? raw.work : DEFAULT_STATE.work,
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
    state.stickerRandom = {};
    if (raw.stickerRandom && typeof raw.stickerRandom === "object") {
      Object.entries(raw.stickerRandom)
        .filter(([name, value]) => /^[a-z0-9_]{1,40}$/.test(name) && typeof value === "boolean")
        .slice(0, 400)
        .forEach(([name, value]) => {
          state.stickerRandom[name] = value;
        });
    }
    state.stickerLabels = {};
    if (raw.stickerLabels && typeof raw.stickerLabels === "object") {
      Object.entries(raw.stickerLabels)
        .filter(([name, value]) => /^[a-z0-9_]{1,40}$/.test(name) && typeof value === "string")
        .slice(0, 400)
        .forEach(([name, value]) => {
          const label = value.trim().slice(0, 16);
          if (label) state.stickerLabels[name] = label;
        });
    }
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
    state.seenActions = Array.isArray(raw.seenActions)
      ? raw.seenActions.filter((name) => typeof name === "string").slice(0, 500)
      : [];
    state.wish = raw.wish && typeof raw.wish === "object" ? raw.wish : null;
    state.checkin =
      raw.checkin && typeof raw.checkin === "object"
        ? { lastDate: String(raw.checkin.lastDate || ""), streak: num(raw.checkin.streak, 0, 0, 9999) }
        : { lastDate: "", streak: 0 };
    state.bank =
      raw.bank && typeof raw.bank === "object"
        ? { amount: num(raw.bank.amount, 0, 0), dueAt: num(raw.bank.dueAt, 0, 0) }
        : { amount: 0, dueAt: 0 };
    state.gacha =
      raw.gacha && typeof raw.gacha === "object" ? { pulls: num(raw.gacha.pulls, 0, 0) } : { pulls: 0 };
    state.minigame =
      raw.minigame && typeof raw.minigame === "object"
        ? { lastPlayedAt: num(raw.minigame.lastPlayedAt, 0, 0) }
        : { lastPlayedAt: 0 };
    state.visitor = raw.visitor && typeof raw.visitor === "object" ? raw.visitor : null;
    state.nextVisitorAt = num(raw.nextVisitorAt, 0, 0);
    if (!state.nextVisitorAt) state.nextVisitorAt = now + 10 * 60000;
    state.room =
      raw.room && Array.isArray(raw.room.furniture)
        ? { furniture: raw.room.furniture.slice(0, 20) }
        : { furniture: [] };
    state.companion =
      raw.companion && typeof raw.companion === "object"
        ? { adopted: raw.companion.adopted === true }
        : { adopted: false };
    state.work =
      raw.work && typeof raw.work === "object"
        ? {
            jobs: Array.isArray(raw.work.jobs)
              ? raw.work.jobs
                  .filter(
                    (job) =>
                      job &&
                      ["visitor", "companion"].includes(job.worker) &&
                      ["coins", "food", "fragments"].includes(job.reward && job.reward.type) &&
                      Number.isFinite(Number(job.endsAt))
                  )
                  .slice(0, 2)
                  .map((job) => ({
                    id: String(job.id || "").slice(0, 30),
                    worker: job.worker,
                    label: String(job.label || "打工者").slice(0, 30),
                    icon: String(job.icon || "💼").slice(0, 4),
                    hours: [2, 4, 8].includes(Number(job.hours)) ? Number(job.hours) : 2,
                    startedAt: num(job.startedAt, 0, 0),
                    endsAt: num(job.endsAt, 0, 0),
                    reward: {
                      type: job.reward.type,
                      amount: num(job.reward.amount, 0, 0, 1e12),
                      itemId: typeof job.reward.itemId === "string" ? job.reward.itemId.slice(0, 24) : "",
                    },
                  }))
              : [],
            fragments: num(raw.work.fragments, 0, 0, 1e9),
            completed: num(raw.work.completed, 0, 0, 1e9),
          }
        : { jobs: [], fragments: 0, completed: 0 };
    state.profile = normalizeProfile(raw.profile, state.createdAt);
    const learned = Array.isArray(raw.training && raw.training.learned)
      ? raw.training.learned.filter((name) => typeof name === "string").slice(0, 500)
      : [];
    state.training = {
      points: num(raw.training && raw.training.points, 0, 0, 1e9),
      totalEarned: num(raw.training && raw.training.totalEarned, 0, 0, 1e12),
      totalSpent: num(raw.training && raw.training.totalSpent, 0, 0, 1e12),
      learned: [...new Set([...STARTER_ACTIONS, ...learned])],
    };
    state.quiz = normalizeQuiz(raw.quiz);
    state.quiz.eventReadyAt = num(state.quiz.eventReadyAt, 0, 0);
    if (!state.quiz.eventReadyAt) state.quiz.eventReadyAt = now + QUIZ_EVENT_COOLDOWN_MS;
    state.window = Object.assign({}, DEFAULT_STATE.window, raw.window || {});
    state.settings = Object.assign({}, DEFAULT_STATE.settings, raw.settings || {});
    if (!/^https?:\/\/[^\s/]+/i.test(String(state.settings.quizApiBase || ""))) {
      state.settings.quizApiBase = DEFAULT_STATE.settings.quizApiBase;
    }
    if (!/^https?:\/\/[^\s/]+/i.test(String(state.settings.updateFeedUrl || ""))) {
      state.settings.updateFeedUrl = DEFAULT_STATE.settings.updateFeedUrl;
    }
    state.settings.updateAutoCheck = state.settings.updateAutoCheck !== false;
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

  function luxuryIncomeBonus(state) {
    return Object.values(SHOP_ITEMS)
      .filter((item) => item.type === "luxury" && state.perks && state.perks[item.id])
      .reduce((sum, item) => sum + (Number(item.bonus) || 0), 0);
  }

  /** 当前每秒实际产出的金币（含等级、心情、饱食度、性格与典藏影响）。 */
  function incomePerSecond(state) {
    const base = state.level * BALANCE.baseIncomePerLevel;
    const moodFactor = 1 + BALANCE.moodBonus * (state.mood / 100);
    const perkFactor = state.perks && state.perks.lucky_cat ? 1.1 : 1;
    const personalityFactor = personalityOf(state).income;
    const buffUntil = (state.buffs && state.buffs.double_income) || 0;
    const buffFactor = buffUntil > Date.now() ? 1.5 : 1;
    const feedFactor =
      state.satiety < BALANCE.hungryThreshold
        ? state.satiety <= BALANCE.emptyThreshold
          ? BALANCE.starvingMultiplier
          : BALANCE.hungryMultiplier
        : 1;
    const roomBonus = roomBonusValue(state);
    const companionBonus =
      state.companion && state.companion.adopted && !workerUnavailable(state, "companion")
        ? FURNITURE.companion.bonus
        : 0;
    const luxuryBonus = luxuryIncomeBonus(state);
    return (
      base *
      moodFactor *
      feedFactor *
      perkFactor *
      buffFactor *
      personalityFactor *
      (1 + roomBonus + companionBonus + luxuryBonus)
    );
  }

  function incomeBreakdown(state) {
    return {
      perSecond: incomePerSecond(state),
      base: state.level * BALANCE.baseIncomePerLevel,
      moodFactor: 1 + BALANCE.moodBonus * (state.mood / 100),
      personalityFactor: personalityOf(state).income,
      luxuryBonus: luxuryIncomeBonus(state),
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
    state.mood = clamp(state.mood + 4 * personalityOf(state).feedMood, 0, 100);
    state.stats.feeds += 1;
    bumpDaily(state, "feeds");
    const training = awardTrainingPoints(state, 2, "feed");
    state.lastTick = now || Date.now();
    return { ok: true, dialogue: "好吃！", training };
  }

  function play(state, now) {
    if (!canAfford(state, BALANCE.playCost)) {
      return { ok: false, reason: "coin", dialogue: "玩具太贵了……" };
    }
    if (state.mood >= 99 && state.satiety > BALANCE.hungryThreshold) {
      return { ok: false, reason: "happy", dialogue: "我已经很开心啦" };
    }
    state.coins -= BALANCE.playCost;
    state.mood = clamp(state.mood + BALANCE.playValue * personalityOf(state).playMood, 0, 100);
    state.satiety = clamp(state.satiety - 3, 0, 100);
    state.stats.plays += 1;
    bumpDaily(state, "plays");
    const training = awardTrainingPoints(state, 2, "play");
    state.lastTick = now || Date.now();
    return { ok: true, dialogue: "好玩！", training };
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
    state.mood = clamp(state.mood + BALANCE.petMoodGain * personalityOf(state).petMood, 0, 100);
    const [lo, hi] = BALANCE.petCoinBonus;
    const bonus = lo + Math.floor(random() * (hi - lo + 1));
    state.coins += bonus;
    state.totalEarned += bonus;
    const training = awardTrainingPoints(state, 1, "pet");
    state.lastTick = now || Date.now();
    return { bonus, dialogue: pick(DIALOGUE.happy, random), training };
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
    // 太小的贴图放大后很糊，不参与随机表演
    const usable = actions.filter((action) => {
      const size = action.size;
      const bigEnough = !size || Math.max(size[0], size[1]) >= 140;
      if (!bigEnough || !isUnlocked(state, action)) return false;
      if (!stickerRandomAllowed(state, action)) return false;
      return true;
    });
    const fallback = actions.filter((action) => isUnlocked(state, action));
    const source = usable.length ? usable : fallback.length ? fallback : actions;
    const personality = personalityOf(state);
    const weights = source.map((action) => {
      const kind = actionKind(action);
      let weight = GROUP_WEIGHT[action.group] || 1;
      weight *= personality.actionWeights[action.category] || personality.actionWeights[action.group] || 1;
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
  function isTrainingEligible(action) {
    return Boolean(
      action &&
      action.name &&
      action.file &&
      !action.user &&
      action.category !== "dress" &&
      !STARTER_ACTIONS.includes(action.name)
    );
  }

  function isActionLearned(state, action) {
    if (!action) return false;
    if (!isTrainingEligible(action)) return true;
    return Boolean(state.training && state.training.learned.includes(action.name));
  }

  function trainingCost(action) {
    if (!isTrainingEligible(action)) return 0;
    const base = TRAINING_COSTS[action.group] || 16;
    const durationExtra = clamp(Math.round((Number(action.durationMs) || 0) / 700), 0, 12);
    return base + durationExtra;
  }

  function awardTrainingPoints(state, amount, reason) {
    if (!state.training) state.training = { points: 0, totalEarned: 0, totalSpent: 0, learned: [] };
    const gained = Math.max(0, Math.round(Number(amount) || 0));
    state.training.points += gained;
    state.training.totalEarned += gained;
    return { gained, total: state.training.points, reason: reason || "" };
  }

  function learnAction(state, action) {
    if (!isTrainingEligible(action)) return { ok: false, reason: "not-trainable" };
    if (isActionLearned(state, action)) return { ok: false, reason: "learned" };
    const cost = trainingCost(action);
    if (!state.training || state.training.points < cost) {
      return { ok: false, reason: "points", cost, points: state.training ? state.training.points : 0 };
    }
    state.training.points -= cost;
    state.training.totalSpent += cost;
    state.training.learned.push(action.name);
    return { ok: true, cost, points: state.training.points, name: action.name };
  }

  function trainingProgress(state, actions) {
    const trainable = (Array.isArray(actions) ? actions : []).filter((action) => isTrainingEligible(action));
    const learned = trainable.filter((action) => isActionLearned(state, action));
    return {
      points: state.training ? state.training.points : 0,
      learned: learned.length,
      total: trainable.length,
      remaining: trainable.length - learned.length,
    };
  }

  /** 换装需要商城解锁；普通动作需要训练学会；自定义表情包默认可用。 */
  function isUnlocked(state, action) {
    if (!action) return false;
    if (action.category === "dress") return (state.unlocked || []).includes(action.name);
    return isActionLearned(state, action);
  }

  function isStickerAction(action) {
    return Boolean(action && action.group === "表情包");
  }

  function effectiveLabel(state, action) {
    if (!action) return "";
    const custom = state.stickerLabels && state.stickerLabels[action.name];
    return (typeof custom === "string" && custom.trim()) || action.label;
  }

  /**
   * 表情包是否参与随机表演：
   * - 存档里显式开/关优先；
   * - 否则静态 blocked 标记生效；
   * - 安全模式默认排除整个表情包分组。
   */
  function stickerRandomAllowed(state, action) {
    if (!action) return false;
    const override = state.stickerRandom && state.stickerRandom[action.name];
    if (override === true) return true;
    if (override === false) return false;
    if (action.blocked) return false;
    if (isStickerAction(action) && (!state.settings || state.settings.safeMode !== false)) return false;
    return true;
  }

  function setStickerRandom(state, name, value) {
    if (!name) return;
    if (!state.stickerRandom) state.stickerRandom = {};
    state.stickerRandom[name] = Boolean(value);
  }

  function setStickerLabel(state, name, label) {
    if (!name) return;
    if (!state.stickerLabels) state.stickerLabels = {};
    const clean = String(label || "")
      .trim()
      .slice(0, 16);
    if (clean) state.stickerLabels[name] = clean;
    else delete state.stickerLabels[name];
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
    if (item.type === "dress" && isUnlocked(state, { category: "dress", name: item.action })) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "permanent" && state.perks[item.id]) return { ok: false, reason: "owned" };
    if (item.type === "theme" && state.perks[`theme_${item.theme}`]) return { ok: false, reason: "owned" };
    if (item.type === "furniture" && state.room && state.room.furniture.includes(item.furnitureId)) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "companion" && state.companion && state.companion.adopted) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "luxury" && state.perks[item.id]) return { ok: false, reason: "owned" };
    if (!canAfford(state, item.price)) return { ok: false, reason: "coin" };

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
    } else if (item.type === "furniture") {
      if (!state.room) state.room = { furniture: [] };
      state.room.furniture.push(item.furnitureId);
    } else if (item.type === "companion") {
      if (!state.companion) state.companion = { adopted: false };
      state.companion.adopted = true;
    } else if (item.type === "dress") {
      if (!state.unlocked.includes(item.action)) state.unlocked.push(item.action);
    } else if (item.type === "luxury") {
      state.perks[item.id] = true;
    } else if (item.type === "profile") {
      reshapeProfile(state, item.profileAction);
    }
    state.lastTick = ts;
    return {
      ok: true,
      item,
      profile: item.type === "profile" ? profileDetails(state) : undefined,
    };
  }

  function useItem(state, item, now) {
    if (!item || (item.type !== "food" && item.type !== "toy")) {
      return { ok: false, reason: "not-usable" };
    }
    const count = state.inventory[item.id] || 0;
    if (count <= 0) return { ok: false, reason: "empty" };
    state.inventory[item.id] = count - 1;
    if (item.satiety) state.satiety = clamp(state.satiety + item.satiety, 0, 100);
    const preference = preferenceFor(state, item.id);
    const moodMultiplier = preference === "like" ? 1.5 : preference === "dislike" ? 0.5 : 1;
    if (item.mood) state.mood = clamp(state.mood + item.mood * moodMultiplier, 0, 100);
    state.lastTick = now || Date.now();
    return { ok: true, item, preference };
  }

  // ---- 日程 ---------------------------------------------------------------
  function dayKey(now) {
    const d = new Date(now || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // ---- 题库：状态与奖励 ---------------------------------------------------
  function normalizeQuiz(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const totals = source.totals && typeof source.totals === "object" ? source.totals : {};
    const exam = source.exam && typeof source.exam === "object" ? source.exam : {};
    const history = Array.isArray(source.history)
      ? source.history
          .filter((item) => item && typeof item === "object")
          .slice(-20)
          .map((item) => ({
            at: num(item.at, 0, 0),
            mode: ["daily", "quiz", "random", "event", "exam"].includes(item.mode) ? item.mode : "random",
            correct: num(item.correct, 0, 0, 999),
            total: num(item.total, 0, 0, 999),
            delta: num(item.delta, 0, -99999, 99999),
          }))
      : [];
    return {
      examCode: /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(String(source.examCode || ""))
        ? String(source.examCode)
        : "architect",
      dailyDate: typeof source.dailyDate === "string" ? source.dailyDate.slice(0, 10) : "",
      dailyDone: source.dailyDone === true,
      dailyCorrect: source.dailyCorrect === true,
      eventReadyAt: num(source.eventReadyAt, 0, 0),
      totals: {
        answered: num(totals.answered, 0, 0),
        correct: num(totals.correct, 0, 0),
        wrong: num(totals.wrong, 0, 0),
        earned: num(totals.earned, 0, 0),
        spent: num(totals.spent, 0, 0),
      },
      exam: {
        taken: num(exam.taken, 0, 0),
        bestScore: num(exam.bestScore, 0, 0, 999),
        lastScore: num(exam.lastScore, 0, 0, 999),
        lastPassed: exam.lastPassed === true,
      },
      history,
    };
  }

  /** 每天第一次进入时重置"每日一题"，并确保答题事件有冷却时间。 */
  function ensureQuiz(state, now) {
    const today = dayKey(now);
    if (state.quiz.dailyDate !== today) {
      state.quiz.dailyDate = today;
      state.quiz.dailyDone = false;
      state.quiz.dailyCorrect = false;
    }
    if (!state.quiz.eventReadyAt) state.quiz.eventReadyAt = now + QUIZ_EVENT_COOLDOWN_MS;
    return state.quiz;
  }

  function quizDailyStatus(state, now) {
    const quiz = ensureQuiz(state, now || Date.now());
    return {
      available: !quiz.dailyDone,
      done: quiz.dailyDone,
      correct: quiz.dailyCorrect,
      date: quiz.dailyDate,
      todayCorrect: quiz.dailyCorrect,
    };
  }

  function quizEventStatus(state, now) {
    const quiz = ensureQuiz(state, now || Date.now());
    const current = now || Date.now();
    return {
      available: current >= quiz.eventReadyAt,
      readyAt: quiz.eventReadyAt,
      remainingMs: Math.max(0, quiz.eventReadyAt - current),
    };
  }

  /**
   * 结算一次答题结果并返回金币变化。
   * 扣金币不会把余额扣成负数（余额不足时最多扣到 0）。
   */
  function completeQuiz(state, payload) {
    const now = payload && payload.now ? payload.now : Date.now();
    const mode = payload && QUIZ_RULES[payload.mode] ? payload.mode : "random";
    const correct = Math.max(0, Math.round(Number(payload && payload.correct) || 0));
    const wrong = Math.max(0, Math.round(Number(payload && payload.wrong) || 0));
    const rule = QUIZ_RULES[mode];
    let delta = correct * rule.correct + wrong * rule.wrong;
    if (delta < 0) delta = -Math.min(Math.floor(state.coins), -delta);
    state.coins = Math.max(0, state.coins + delta);

    const totals = state.quiz.totals;
    totals.answered += correct + wrong;
    totals.correct += correct;
    totals.wrong += wrong;
    if (delta > 0) {
      state.totalEarned += delta;
      totals.earned += delta;
    } else if (delta < 0) {
      totals.spent += -delta;
    }

    if (mode === "daily") {
      state.quiz.dailyDate = dayKey(now);
      state.quiz.dailyDone = true;
      state.quiz.dailyCorrect = correct > 0 && wrong === 0;
    }
    if (mode === "event") {
      state.quiz.eventReadyAt = now + QUIZ_EVENT_COOLDOWN_MS;
    }
    if (mode === "exam" && payload.exam) {
      const exam = payload.exam;
      state.quiz.exam.taken += 1;
      state.quiz.exam.lastScore = Math.max(0, Math.round(Number(exam.score) || 0));
      state.quiz.exam.lastPassed = exam.passed === true;
      state.quiz.exam.bestScore = Math.max(state.quiz.exam.bestScore, state.quiz.exam.lastScore);
    }

    state.quiz.history.push({ at: now, mode, correct, total: correct + wrong, delta });
    if (state.quiz.history.length > 20) state.quiz.history = state.quiz.history.slice(-20);

    return { delta, rule, mode, correct, wrong };
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

  // ---- 图鉴 / 心愿 / 签到 / 银行 / 扭蛋 / 小游戏 / 访客 / 房间 ---------------
  function markSeen(state, name) {
    if (!name) return;
    if (!Array.isArray(state.seenActions)) state.seenActions = [];
    if (!state.seenActions.includes(name)) {
      state.seenActions.push(name);
      if (state.seenActions.length > 500) state.seenActions.shift();
    }
  }

  function codexSummary(state, actions) {
    const list = actions || [];
    const seen = new Set(state.seenActions || []);
    const groups = {};
    let seenCount = 0;
    list.forEach((action) => {
      const group = action.group || "其它";
      if (!groups[group]) groups[group] = { total: 0, seen: 0 };
      groups[group].total += 1;
      if (seen.has(action.name)) {
        groups[group].seen += 1;
        seenCount += 1;
      }
    });
    return { total: list.length, seen: seenCount, groups };
  }

  function titleForLevel(level) {
    const entry = TITLES.find((item) => level >= item.level);
    return entry ? entry.name : TITLES[TITLES.length - 1].name;
  }

  function wishStatus(state, now) {
    const wish = state.wish;
    if (!wish) return null;
    const ts = now || Date.now();
    const secondsLeft = Math.max(0, Math.ceil((wish.expiresAt - ts) / 1000));
    return { ...wish, secondsLeft, expired: secondsLeft <= 0 };
  }

  function availableWishActions(actions, state, category) {
    return (Array.isArray(actions) ? actions : []).filter(
      (action) => action && action.category === category && isUnlocked(state, action) && !action.blocked
    );
  }

  function createWish(state, now, actions) {
    const ts = now || Date.now();
    const candidates = Array.isArray(actions)
      ? WISH_CATEGORIES.filter((entry) => availableWishActions(actions, state, entry.key).length)
      : WISH_CATEGORIES;
    const source = candidates.length ? candidates : WISH_CATEGORIES;
    const choice = source[Math.floor(Math.random() * source.length)];
    state.wish = {
      id: `w${ts.toString(36)}`,
      category: choice.key,
      group: choice.group,
      reward: 40 + (state.level || 1) * 2,
      expiresAt: ts + 10 * 60000,
    };
    return state.wish;
  }

  function completeWish(state, action, now) {
    const wish = state.wish;
    if (!wish || !action || (now || Date.now()) >= wish.expiresAt) return null;
    if (action.category !== wish.category) return null;
    state.wish = null;
    state.coins += wish.reward;
    state.totalEarned += wish.reward;
    state.mood = clamp(state.mood + 5, 0, 100);
    return { reward: wish.reward };
  }

  function checkinStatus(state, now) {
    const key = dayKey(now);
    const lastDate = (state.checkin && state.checkin.lastDate) || "";
    return { canCheckin: lastDate !== key, streak: (state.checkin && state.checkin.streak) || 0, lastDate };
  }

  function doCheckin(state, now) {
    const ts = now || Date.now();
    const key = dayKey(ts);
    if (!state.checkin) state.checkin = { lastDate: "", streak: 0 };
    if (state.checkin.lastDate === key) return { ok: false };
    const yesterday = dayKey(ts - 86400000);
    state.checkin.streak = state.checkin.lastDate === yesterday ? state.checkin.streak + 1 : 1;
    state.checkin.lastDate = key;
    const reward = 20 + Math.min(state.checkin.streak, 7) * 10;
    state.coins += reward;
    state.totalEarned += reward;
    return { ok: true, reward, streak: state.checkin.streak };
  }

  function bankStatus(state, now) {
    const bank = state.bank || { amount: 0, dueAt: 0 };
    const ts = now || Date.now();
    const amount = bank.amount || 0;
    return {
      amount,
      dueAt: bank.dueAt || 0,
      ready: amount > 0 && ts >= bank.dueAt,
      secondsLeft: Math.max(0, Math.ceil(((bank.dueAt || 0) - ts) / 1000)),
      payout: Math.round(amount * (1 + BANK_RATE)),
    };
  }

  function bankDeposit(state, amount, now) {
    const ts = now || Date.now();
    const value = Math.floor(Number(amount) || 0);
    const status = bankStatus(state, ts);
    if (status.amount > 0) return { ok: false, reason: "busy" };
    if (value < 100 || value > state.coins) return { ok: false, reason: "coin" };
    state.coins -= value;
    state.bank = { amount: value, dueAt: ts + BANK_HOURS * 3600000 };
    return { ok: true };
  }

  function bankWithdraw(state, now) {
    const status = bankStatus(state, now);
    if (!status.ready) return { ok: false };
    state.coins += status.payout;
    state.totalEarned += status.payout - status.amount;
    state.bank = { amount: 0, dueAt: 0 };
    return { ok: true, payout: status.payout };
  }

  /** 扭蛋：金币 / 食物玩具 / 未解锁装扮 / 未拥有主题。 */
  function pullGacha(state, actions, now) {
    if (state.coins < GACHA_PRICE) return { ok: false, reason: "coin" };
    state.coins -= GACHA_PRICE;
    state.gacha.pulls = (state.gacha.pulls || 0) + 1;
    const roll = Math.random();
    const items = Object.values(SHOP_ITEMS).filter((item) => item.type === "food" || item.type === "toy");
    const lockedDress = (actions || []).filter(
      (a) => a.category === "dress" && !state.unlocked.includes(a.name)
    );
    const themes = Object.values(SHOP_ITEMS).filter(
      (item) => item.type === "theme" && !state.perks[`theme_${item.theme}`]
    );

    if (roll < 0.45) {
      const amount = 100 + Math.floor(Math.random() * 401);
      state.coins += amount;
      state.totalEarned += amount;
      return { ok: true, type: "coins", label: `金币 +${amount}`, amount };
    }
    if (roll < 0.72 && items.length) {
      const item = items[Math.floor(Math.random() * items.length)];
      state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
      return { ok: true, type: "item", label: `${item.icon} ${item.name}` };
    }
    if (roll < 0.9 && lockedDress.length) {
      const action = lockedDress[Math.floor(Math.random() * lockedDress.length)];
      state.unlocked.push(action.name);
      return { ok: true, type: "dress", label: `解锁「${action.label}」`, action: action.name };
    }
    if (themes.length) {
      const theme = themes[Math.floor(Math.random() * themes.length)];
      state.perks[`theme_${theme.theme}`] = true;
      state.settings.theme = theme.theme;
      return { ok: true, type: "theme", label: `${theme.icon} ${theme.name}`, theme: theme.theme };
    }
    const amount = 300;
    state.coins += amount;
    state.totalEarned += amount;
    return { ok: true, type: "coins", label: `金币 +${amount}`, amount };
  }

  function minigameStatus(state, now) {
    const ts = now || Date.now();
    const last = (state.minigame && state.minigame.lastPlayedAt) || 0;
    const secondsLeft = Math.max(0, Math.ceil((MINIGAME_COOLDOWN_MS - (ts - last)) / 1000));
    return { ready: secondsLeft === 0, secondsLeft };
  }

  function minigameTrainingGain(score) {
    return 4 + Math.max(0, Math.round(Number(score) || 0)) * 2;
  }

  function finishMinigame(state, score, now) {
    const ts = now || Date.now();
    const reward = Math.max(5, Math.round((Number(score) || 0) * 2));
    state.coins += reward;
    state.totalEarned += reward;
    state.minigame = { lastPlayedAt: ts };
    awardTrainingPoints(state, minigameTrainingGain(score), "minigame");
    return reward;
  }

  function spawnVisitor(state, now) {
    const ts = now || Date.now();
    const kinds = [
      { kind: "cat", label: "猫猫来访", icon: "🐈", reward: 80 },
      { kind: "pigeon", label: "鸽子来访", icon: "🐦", reward: 60 },
      { kind: "friend", label: "另一只 doro 来访", icon: "🐣", reward: 120 },
    ];
    const choice = kinds[Math.floor(Math.random() * kinds.length)];
    state.visitor = { ...choice, expiresAt: ts + 3 * 60000 };
    state.nextVisitorAt = ts + (25 + Math.random() * 20) * 60000;
    return state.visitor;
  }

  function visitorStatus(state, now) {
    if (!state.visitor) return null;
    const ts = now || Date.now();
    if (ts >= state.visitor.expiresAt) {
      state.visitor = null;
      return null;
    }
    return { ...state.visitor, secondsLeft: Math.ceil((state.visitor.expiresAt - ts) / 1000) };
  }

  function maybeVisitor(state, now) {
    const ts = now || Date.now();
    if (state.visitor) return visitorStatus(state, ts);
    if (ts < (state.nextVisitorAt || 0)) return null;
    return spawnVisitor(state, ts);
  }

  function acceptVisitor(state, now) {
    const visitor = visitorStatus(state, now);
    if (!visitor) return null;
    state.visitor = null;
    state.coins += visitor.reward;
    state.totalEarned += visitor.reward;
    state.mood = clamp(state.mood + 5, 0, 100);
    return visitor;
  }

  function dismissVisitor(state) {
    if (!state.visitor) return false;
    state.visitor = null;
    return true;
  }

  function workerUnavailable(state, worker) {
    return (state.work.jobs || []).some((job) => job.worker === worker);
  }

  function makeWorkReward(state, hours, random) {
    const rng = typeof random === "function" ? random : Math.random;
    const roll = rng();
    if (roll < 0.58) {
      const amount = Math.max(hours * 120, Math.round(incomePerSecond(state) * hours * 3600 * 0.22));
      return { type: "coins", amount, itemId: "" };
    }
    if (roll < 0.88) {
      const foods = Object.values(SHOP_ITEMS).filter((item) => item.type === "food");
      const item = foods[Math.floor(rng() * foods.length) % foods.length];
      return { type: "food", amount: hours, itemId: item.id };
    }
    return { type: "fragments", amount: Math.ceil(hours / 2), itemId: "" };
  }

  function dispatchWorker(state, worker, hours, now, random) {
    if (![2, 4, 8].includes(hours)) return { ok: false, reason: "duration" };
    if (workerUnavailable(state, worker)) return { ok: false, reason: "busy" };
    if (state.work.jobs.length >= 2) return { ok: false, reason: "full" };
    let source;
    if (worker === "companion") {
      if (!state.companion || !state.companion.adopted) return { ok: false, reason: "missing" };
      source = { label: "伙伴 doro", icon: "🐣" };
    } else if (worker === "visitor") {
      const visitor = visitorStatus(state, now);
      if (!visitor) return { ok: false, reason: "missing" };
      source = { label: visitor.label, icon: visitor.icon };
      state.visitor = null;
    } else {
      return { ok: false, reason: "worker" };
    }
    const ts = now || Date.now();
    const job = {
      id: `job_${ts.toString(36)}_${worker}`,
      worker,
      label: source.label,
      icon: source.icon,
      hours,
      startedAt: ts,
      endsAt: ts + hours * 3600 * 1000,
      reward: makeWorkReward(state, hours, random),
    };
    state.work.jobs.push(job);
    state.nextVisitorAt = Math.max(state.nextVisitorAt || 0, ts + 20 * 60000);
    return { ok: true, job };
  }

  function workStatus(state, now) {
    const ts = now || Date.now();
    return (state.work.jobs || []).map((job) => ({
      ...job,
      secondsLeft: Math.max(0, Math.ceil((job.endsAt - ts) / 1000)),
      ready: job.endsAt <= ts,
    }));
  }

  function collectFinishedJobs(state, now) {
    const ts = now || Date.now();
    const ready = (state.work.jobs || []).filter((job) => job.endsAt <= ts);
    if (!ready.length) return [];
    state.work.jobs = state.work.jobs.filter((job) => job.endsAt > ts);
    return ready.map((job) => {
      state.work.completed += 1;
      if (job.reward.type === "coins") {
        state.coins += job.reward.amount;
        state.totalEarned += job.reward.amount;
      } else if (job.reward.type === "food") {
        state.inventory[job.reward.itemId] = (state.inventory[job.reward.itemId] || 0) + job.reward.amount;
      } else {
        state.work.fragments += job.reward.amount;
      }
      return { ...job, settled: true };
    });
  }

  function exchangeFragments(state, actions, now, random) {
    const cost = 5;
    if (state.work.fragments < cost) return { ok: false, reason: "fragments" };
    const locked = (Array.isArray(actions) ? actions : []).filter(
      (action) => action.category === "dress" && !state.unlocked.includes(action.name)
    );
    state.work.fragments -= cost;
    if (!locked.length) {
      const coins = Math.max(1000, Math.round(incomePerSecond(state) * 600));
      state.coins += coins;
      state.totalEarned += coins;
      return { ok: true, type: "coins", amount: coins };
    }
    const rng = typeof random === "function" ? random : Math.random;
    const action = locked[Math.floor(rng() * locked.length) % locked.length];
    state.unlocked.push(action.name);
    state.lastTick = now || Date.now();
    return { ok: true, type: "dress", action };
  }

  function roomBonusValue(state) {
    const owned = (state.room && state.room.furniture) || [];
    return owned.reduce((sum, id) => {
      const item = FURNITURE[id];
      return sum + (item && item.id !== "companion" ? item.bonus : 0);
    }, 0);
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
    PERSONALITIES,
    actionKind,
    SHOP_ITEMS,
    PREFERENCE_ITEM_IDS,
    DAILY_TASKS,
    ACHIEVEMENTS,
    WISH_CATEGORIES,
    TITLES,
    GACHA_PRICE,
    BANK_HOURS,
    BANK_RATE,
    MINIGAME_COOLDOWN_MS,
    FURNITURE,
    DRESS_BASE_PRICE,
    DRESS_PRICE_STEP,
    SCHEDULE_MAX,
    QUIZ_RULES,
    QUIZ_EVENT_COOLDOWN_MS,
    normalizeQuiz,
    ensureQuiz,
    quizDailyStatus,
    quizEventStatus,
    completeQuiz,
    isUnlocked,
    isStickerAction,
    personalityOf,
    preferenceFor,
    profileDetails,
    reshapeProfile,
    isTrainingEligible,
    isActionLearned,
    trainingCost,
    awardTrainingPoints,
    learnAction,
    trainingProgress,
    effectiveLabel,
    stickerRandomAllowed,
    setStickerRandom,
    setStickerLabel,
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
    markSeen,
    codexSummary,
    titleForLevel,
    wishStatus,
    createWish,
    completeWish,
    availableWishActions,
    checkinStatus,
    doCheckin,
    bankStatus,
    bankDeposit,
    bankWithdraw,
    pullGacha,
    minigameStatus,
    minigameTrainingGain,
    finishMinigame,
    spawnVisitor,
    visitorStatus,
    maybeVisitor,
    acceptVisitor,
    dismissVisitor,
    workerUnavailable,
    dispatchWorker,
    workStatus,
    collectFinishedJobs,
    exchangeFragments,
    roomBonusValue,
    SAVE_VERSION,
    migrate,
    hydrate,
    freshState,
    incomePerSecond,
    incomeBreakdown,
    luxuryIncomeBonus,
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
