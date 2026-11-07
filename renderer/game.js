/* global require */
/*
 * doro 桌面宠物的游戏逻辑（纯函数，不依赖 DOM / Electron）。
 * 浏览器里挂到 window.DoroGame，Node 里可以 require 进来跑单元测试。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./cultivation"), require("./opportunities"));
  } else {
    root.DoroGame = factory(root.DoroCultivation, root.DoroOpportunities);
  }
})(typeof self !== "undefined" ? self : this, function (C, O) {
  "use strict";

  const SAVE_VERSION = 30;

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
    rentals: { furniture: {}, dress: {} },
    leaderboardBoosts: { period: "", activeUntil: 0, boards: [] },
    favorites: [],
    recent: [],
    stickerRandom: {},
    stickerLabels: {},
    stickerHidden: [],
    schedule: [],
    shopStats: { purchases: 0, spent: 0 },
    daily: {
      date: "",
      progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0, coinsEarned: 0, visitors: 0 },
      claimed: [],
    },
    achievements: [],
    metrics: { days: {} },
    seenActions: [],
    wish: null,
    checkin: { lastDate: "", streak: 0 },
    bank: { amount: 0, dueAt: 0 },
    gacha: { pulls: 0, upPulls: 0, upPity: 0, history: [] },
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
    prestige: {
      count: 0,
      legacyLevel: 0,
    },
    cultivation: C.emptyCultivation(0),
    opportunities: O.emptyState(0),
    intimacy: {
      points: 0,
      dailyDate: "",
      dailyPoints: 0,
    },
    diary: {
      entries: [],
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
      equippedFashion: "",
      quizApiBase: "http://192.168.0.193:9300",
      updateFeedUrl: "http://192.168.0.193:9400/updates",
      updateAutoCheck: true,
      autoFeed: false,
      shortcuts: { ...C.DEFAULT_SHORTCUTS },
    },
  };

  const BLACK_TOWER_FLOORS = Object.freeze([
    { floor: 1, name: "黑塔一层", minLevel: 1, enemy: "噬灵鼠", costRatio: 0.14, rewardRatio: 0.18, difficulty: 0.22 },
    { floor: 2, name: "黑塔二层", minLevel: 11, enemy: "骨甲魇犬", costRatio: 0.17, rewardRatio: 0.26, difficulty: 0.27 },
    { floor: 3, name: "黑塔三层", minLevel: 21, enemy: "腐羽鸦妖", costRatio: 0.2, rewardRatio: 0.34, difficulty: 0.32 },
    { floor: 4, name: "黑塔四层", minLevel: 31, enemy: "赤瞳石傀", costRatio: 0.23, rewardRatio: 0.43, difficulty: 0.37 },
    { floor: 5, name: "黑塔五层", minLevel: 41, enemy: "阴煞鬼将", costRatio: 0.26, rewardRatio: 0.52, difficulty: 0.42 },
    { floor: 6, name: "黑塔六层", minLevel: 51, enemy: "雷脊妖猿", costRatio: 0.29, rewardRatio: 0.62, difficulty: 0.46 },
    { floor: 7, name: "黑塔七层", minLevel: 61, enemy: "玄冰魔犀", costRatio: 0.32, rewardRatio: 0.72, difficulty: 0.49 },
    { floor: 8, name: "黑塔八层", minLevel: 71, enemy: "无面剑侍", costRatio: 0.35, rewardRatio: 0.83, difficulty: 0.52 },
    { floor: 9, name: "黑塔九层", minLevel: 81, enemy: "吞光魔龙", costRatio: 0.38, rewardRatio: 0.94, difficulty: 0.55 },
    { floor: 10, name: "黑塔之巅", minLevel: 91, enemy: "黑塔魔君", costRatio: 0.42, rewardRatio: 1.08, difficulty: 0.58 },
  ]);
  const COMBAT_GROWTH = Object.freeze({
    hp: 1.08,
    attack: 1.075,
    defense: 1.07,
  });

  function normalizeShortcuts(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const clean = {};
    Object.keys(C.DEFAULT_SHORTCUTS).forEach((key) => {
      const value = source[key];
      clean[key] =
        typeof value === "string" && /^[A-Za-z0-9+_-]{1,64}$/.test(value.trim())
          ? value.trim()
          : C.DEFAULT_SHORTCUTS[key];
    });
    return clean;
  }

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
    stone_low: {
      id: "stone_low",
      name: "下品灵石",
      type: "cultivation",
      cultivationType: "stone",
      stoneTier: "low",
      price: 50,
      icon: "💠",
      desc: "最多提供 10 点修炼能量",
    },
    stone_mid: {
      id: "stone_mid",
      name: "中品灵石",
      type: "cultivation",
      cultivationType: "stone",
      stoneTier: "mid",
      price: 300,
      icon: "🔷",
      desc: "最多提供 100 点修炼能量",
    },
    stone_high: {
      id: "stone_high",
      name: "上品灵石",
      type: "cultivation",
      cultivationType: "stone",
      stoneTier: "high",
      price: 1800,
      icon: "🔹",
      desc: "最多提供 1000 点修炼能量",
    },
    stone_supreme: {
      id: "stone_supreme",
      name: "极品灵石",
      type: "cultivation",
      cultivationType: "stone",
      stoneTier: "supreme",
      price: 10800,
      icon: "💎",
      desc: "最多提供 10000 点修炼能量",
    },
    breakthrough_pill: {
      id: "breakthrough_pill",
      name: "破境丹",
      type: "cultivation",
      cultivationType: "breakthrough",
      price: 1200,
      icon: "🧪",
      desc: "用于大境界突破，可替代心魔试炼",
    },
    life_pill: {
      id: "life_pill",
      name: "延寿丹",
      type: "cultivation",
      cultivationType: "life",
      price: 1800,
      icon: "🍥",
      desc: "服用后永久增加 100 年寿元上限",
    },
    technique_pill: {
      id: "technique_pill",
      name: "悟道丹",
      type: "cultivation",
      cultivationType: "technique",
      price: 1200,
      icon: "📖",
      desc: "服用后随机提升一部已修功法的进度",
    },
    cultivation_pill: {
      id: "cultivation_pill",
      name: "培元丹",
      type: "cultivation",
      cultivationType: "cultivation",
      price: 900,
      icon: "🌀",
      desc: "服用后随机获得当前小境界 8%–16% 的修为",
    },
    heart_pill: {
      id: "heart_pill",
      name: "静心丹",
      type: "cultivation",
      cultivationType: "heart",
      price: 700,
      icon: "🪷",
      desc: "服用后恢复 2–5 点道心",
    },
    bigu_pill: {
      id: "bigu_pill",
      name: "辟谷丹",
      type: "cultivation",
      cultivationType: "bigu",
      price: 1200,
      icon: "🌙",
      desc: "服下一颗后辟谷一日（修仙界一年），期间不再消耗饱食度",
    },
    thunder_pearl: {
      id: "thunder_pearl",
      name: "避雷珠",
      type: "cultivation",
      cultivationType: "thunder",
      price: 1200,
      icon: "⚡",
      desc: "渡劫时降低雷劫强度，提升突破成功率",
    },
    coffee: {
      id: "coffee",
      name: "提神咖啡",
      type: "buff",
      price: 120,
      buff: "double_income",
      minutes: 10,
      incomeMultiplier: 1.5,
      icon: "☕",
      desc: "接下来 10 分钟产出 ×1.5",
    },
    lemon_soda: {
      id: "lemon_soda",
      name: "柠檬气泡水",
      type: "buff",
      price: 180,
      buff: "income_lemon_soda",
      minutes: 10,
      incomeMultiplier: 1.25,
      icon: "🍋",
      desc: "接下来 10 分钟产出 ×1.25",
    },
    honey_bar: {
      id: "honey_bar",
      name: "蜂蜜能量棒",
      type: "buff",
      price: 260,
      buff: "income_honey_bar",
      minutes: 15,
      incomeMultiplier: 1.35,
      icon: "🍯",
      desc: "接下来 15 分钟产出 ×1.35",
    },
    matcha_latte: {
      id: "matcha_latte",
      name: "抹茶拿铁",
      type: "buff",
      price: 360,
      buff: "income_matcha_latte",
      minutes: 20,
      incomeMultiplier: 1.5,
      icon: "🍵",
      desc: "接下来 20 分钟产出 ×1.5",
    },
    energy_drink: {
      id: "energy_drink",
      name: "能量饮料",
      type: "buff",
      price: 520,
      buff: "income_energy_drink",
      minutes: 15,
      incomeMultiplier: 1.8,
      icon: "🥤",
      desc: "接下来 15 分钟产出 ×1.8",
    },
    night_owl_drink: {
      id: "night_owl_drink",
      name: "夜猫子特调",
      type: "buff",
      price: 700,
      buff: "income_night_owl",
      minutes: 30,
      incomeMultiplier: 1.7,
      icon: "🌃",
      desc: "接下来 30 分钟产出 ×1.7",
    },
    lucky_clover: {
      id: "lucky_clover",
      name: "幸运四叶草",
      type: "buff",
      price: 900,
      buff: "income_lucky_clover",
      minutes: 10,
      incomeMultiplier: 2.2,
      icon: "🍀",
      desc: "接下来 10 分钟产出 ×2.2",
    },
    cloud_aroma: {
      id: "cloud_aroma",
      name: "云端香薰",
      type: "buff",
      price: 1200,
      buff: "income_cloud_aroma",
      minutes: 20,
      incomeMultiplier: 2,
      icon: "☁️",
      desc: "接下来 20 分钟产出 ×2",
    },
    starlight_charm: {
      id: "starlight_charm",
      name: "星河护符",
      type: "buff",
      price: 1800,
      buff: "income_starlight_charm",
      minutes: 15,
      incomeMultiplier: 2.5,
      icon: "🌟",
      desc: "接下来 15 分钟产出 ×2.5",
    },
    master_tea: {
      id: "master_tea",
      name: "摸鱼大师茶",
      type: "buff",
      price: 2800,
      buff: "income_master_tea",
      minutes: 45,
      incomeMultiplier: 1.6,
      icon: "🫖",
      desc: "接下来 45 分钟产出 ×1.6",
    },
    time_capsule: {
      id: "time_capsule",
      name: "时光胶囊",
      type: "buff",
      price: 5000,
      buff: "income_time_capsule",
      minutes: 30,
      incomeMultiplier: 3,
      icon: "⏳",
      desc: "接下来 30 分钟产出 ×3",
    },
    lucky_cat: {
      id: "lucky_cat",
      name: "招财猫",
      type: "permanent",
      price: 2000,
      bonus: 0.1,
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
    fashion_starlight_hat: {
      id: "fashion_starlight_hat",
      name: "星辉礼帽",
      type: "fashion",
      price: 1500,
      score: 120,
      icon: "🎩",
      overlay: "fashion/starlight_hat.svg",
      overlayTop: 2,
      overlayLeft: 50,
      overlayWidth: 48,
      desc: "可叠穿星辉礼帽，时装积分 +120",
    },
    fashion_round_glasses: {
      id: "fashion_round_glasses",
      name: "圆框眼镜",
      type: "fashion",
      price: 1800,
      score: 150,
      icon: "👓",
      overlay: "fashion/round_glasses.svg",
      overlayTop: 30,
      overlayLeft: 50,
      overlayWidth: 40,
      desc: "可叠穿圆框眼镜，时装积分 +150",
    },
    fashion_red_scarf: {
      id: "fashion_red_scarf",
      name: "暖红围巾",
      type: "fashion",
      price: 2200,
      score: 180,
      icon: "🧣",
      overlay: "fashion/red_scarf.svg",
      overlayTop: 52,
      overlayLeft: 50,
      overlayWidth: 54,
      desc: "可叠穿暖红围巾，时装积分 +180",
    },
    fashion_cat_backpack: {
      id: "fashion_cat_backpack",
      name: "猫猫背包",
      type: "fashion",
      price: 2600,
      score: 220,
      icon: "🎒",
      overlay: "fashion/cat_backpack.svg",
      overlayTop: 45,
      overlayLeft: 72,
      overlayWidth: 26,
      desc: "可叠穿猫猫背包，时装积分 +220",
    },
    fashion_flower_crown: {
      id: "fashion_flower_crown",
      name: "春日花环",
      type: "fashion",
      price: 3200,
      score: 260,
      icon: "🌼",
      overlay: "fashion/flower_crown.svg",
      overlayTop: 6,
      overlayLeft: 50,
      overlayWidth: 50,
      desc: "可叠穿春日花环，时装积分 +260",
    },
    fashion_music_headset: {
      id: "fashion_music_headset",
      name: "音乐耳机",
      type: "fashion",
      price: 3800,
      score: 300,
      icon: "🎧",
      overlay: "fashion/music_headset.svg",
      overlayTop: 14,
      overlayLeft: 50,
      overlayWidth: 55,
      desc: "可叠穿音乐耳机，时装积分 +300",
    },
    fashion_angel_wings: {
      id: "fashion_angel_wings",
      name: "小天使翅膀",
      type: "fashion",
      price: 4500,
      score: 360,
      icon: "🪽",
      overlay: "fashion/angel_wings.svg",
      overlayTop: 35,
      overlayLeft: 50,
      overlayWidth: 76,
      desc: "可叠穿小天使翅膀，时装积分 +360",
    },
    fashion_bow_tie: {
      id: "fashion_bow_tie",
      name: "绅士领结",
      type: "fashion",
      price: 5200,
      score: 420,
      icon: "🎀",
      overlay: "fashion/bow_tie.svg",
      overlayTop: 55,
      overlayLeft: 50,
      overlayWidth: 32,
      desc: "可叠穿绅士领结，时装积分 +420",
    },
    fashion_detective_hat: {
      id: "fashion_detective_hat",
      name: "侦探帽",
      type: "fashion",
      price: 6500,
      score: 500,
      icon: "🕵️",
      overlay: "fashion/detective_hat.svg",
      overlayTop: -2,
      overlayLeft: 50,
      overlayWidth: 52,
      desc: "可叠穿侦探帽，时装积分 +500",
    },
    fashion_space_helmet: {
      id: "fashion_space_helmet",
      name: "太空头盔",
      type: "fashion",
      price: 8000,
      score: 600,
      icon: "🧑‍🚀",
      overlay: "fashion/space_helmet.svg",
      overlayTop: 4,
      overlayLeft: 50,
      overlayWidth: 62,
      desc: "可叠穿太空头盔，时装积分 +600",
    },
    fashion_butterfly_clip: {
      id: "fashion_butterfly_clip",
      name: "蝶翼发夹",
      type: "fashion",
      price: 11000,
      score: 720,
      icon: "🦋",
      overlay: "fashion/butterfly_clip.svg",
      overlayTop: 4,
      overlayLeft: 50,
      overlayWidth: 34,
      desc: "可叠穿蝶翼发夹，时装积分 +720",
    },
    fashion_cloud_earmuffs: {
      id: "fashion_cloud_earmuffs",
      name: "云朵耳罩",
      type: "fashion",
      price: 13500,
      score: 820,
      icon: "☁️",
      overlay: "fashion/cloud_earmuffs.svg",
      overlayTop: 22,
      overlayLeft: 50,
      overlayWidth: 66,
      desc: "可叠穿云朵耳罩，时装积分 +820",
    },
    fashion_strawberry_band: {
      id: "fashion_strawberry_band",
      name: "草莓发带",
      type: "fashion",
      price: 16000,
      score: 920,
      icon: "🍓",
      overlay: "fashion/strawberry_band.svg",
      overlayTop: 3,
      overlayLeft: 50,
      overlayWidth: 56,
      desc: "可叠穿草莓发带，时装积分 +920",
    },
    fashion_moon_earrings: {
      id: "fashion_moon_earrings",
      name: "月光耳坠",
      type: "fashion",
      price: 19000,
      score: 1050,
      icon: "🌙",
      overlay: "fashion/moon_earrings.svg",
      overlayTop: 38,
      overlayLeft: 82,
      overlayWidth: 20,
      desc: "可叠穿月光耳坠，时装积分 +1050",
    },
    fashion_bell_collar: {
      id: "fashion_bell_collar",
      name: "铃铛项圈",
      type: "fashion",
      price: 23000,
      score: 1200,
      icon: "🔔",
      overlay: "fashion/bell_collar.svg",
      overlayTop: 58,
      overlayLeft: 50,
      overlayWidth: 38,
      desc: "可叠穿铃铛项圈，时装积分 +1200",
    },
    fashion_crystal_tiara: {
      id: "fashion_crystal_tiara",
      name: "水晶小皇冠",
      type: "fashion",
      price: 28000,
      score: 1380,
      icon: "👑",
      overlay: "fashion/crystal_tiara.svg",
      overlayTop: -1,
      overlayLeft: 50,
      overlayWidth: 42,
      desc: "可叠穿水晶小皇冠，时装积分 +1380",
    },
    fashion_bunny_pack: {
      id: "fashion_bunny_pack",
      name: "兔兔背包",
      type: "fashion",
      price: 34000,
      score: 1580,
      icon: "🐰",
      overlay: "fashion/bunny_pack.svg",
      overlayTop: 44,
      overlayLeft: 18,
      overlayWidth: 28,
      desc: "可叠穿兔兔背包，时装积分 +1580",
    },
    fashion_rainbow_cape: {
      id: "fashion_rainbow_cape",
      name: "彩虹披风",
      type: "fashion",
      price: 42000,
      score: 1820,
      icon: "🌈",
      overlay: "fashion/rainbow_cape.svg",
      overlayTop: 38,
      overlayLeft: 50,
      overlayWidth: 88,
      desc: "可叠穿彩虹披风，时装积分 +1820",
    },
    fashion_star_eye_patch: {
      id: "fashion_star_eye_patch",
      name: "星星眼罩",
      type: "fashion",
      price: 52000,
      score: 2100,
      icon: "⭐",
      overlay: "fashion/star_eye_patch.svg",
      overlayTop: 28,
      overlayLeft: 58,
      overlayWidth: 38,
      desc: "可叠穿星星眼罩，时装积分 +2100",
    },
    fashion_lunar_veil: {
      id: "fashion_lunar_veil",
      name: "月纱头饰",
      type: "fashion",
      price: 65000,
      score: 2450,
      icon: "🎐",
      overlay: "fashion/lunar_veil.svg",
      overlayTop: 8,
      overlayLeft: 50,
      overlayWidth: 60,
      desc: "可叠穿月纱头饰，时装积分 +2450",
    },
    luxury_cushion: {
      id: "luxury_cushion",
      name: "鎏金软垫",
      type: "luxury",
      price: 66000,
      score: 100,
      bonus: 0.08,
      icon: "🛋️",
      desc: "永久 +8% 产出，典藏级舒适",
    },
    luxury_crystal: {
      id: "luxury_crystal",
      name: "星辉水晶灯",
      type: "luxury",
      price: 188000,
      score: 300,
      bonus: 0.12,
      icon: "🔮",
      desc: "永久 +12% 产出，房间里会发光",
    },
    luxury_office: {
      id: "luxury_office",
      name: "私人摸鱼办公室",
      type: "luxury",
      price: 520000,
      score: 800,
      bonus: 0.18,
      icon: "🏢",
      desc: "永久 +18% 产出，带门禁的那种",
    },
    luxury_estate: {
      id: "luxury_estate",
      name: "doro 小庄园",
      type: "luxury",
      price: 1280000,
      score: 2000,
      bonus: 0.3,
      icon: "🏡",
      desc: "永久 +30% 产出，从桌宠升级为地主",
    },
    luxury_hourglass: {
      id: "luxury_hourglass",
      name: "时间沙漏",
      type: "luxury",
      price: 2500000,
      score: 5000,
      bonus: 0.45,
      icon: "⏳",
      desc: "永久 +45% 产出，摸鱼时间也是资产",
    },
    luxury_cloud_sofa: {
      id: "luxury_cloud_sofa",
      name: "云端懒人沙发",
      type: "luxury",
      price: 5000000,
      score: 8000,
      bonus: 0.55,
      icon: "☁️",
      desc: "永久 +55% 产出，坐下去就起不来了",
    },
    luxury_meteor_clock: {
      id: "luxury_meteor_clock",
      name: "流星座钟",
      type: "luxury",
      price: 9000000,
      score: 12000,
      bonus: 0.62,
      icon: "☄️",
      desc: "永久 +62% 产出，每一秒都带一点星尘",
    },
    luxury_moon_observatory: {
      id: "luxury_moon_observatory",
      name: "月球摸鱼台",
      type: "luxury",
      price: 20000000,
      score: 25000,
      bonus: 0.75,
      icon: "🌕",
      desc: "永久 +75% 产出，离地球很远，离下班很近",
    },
    luxury_aurora: {
      id: "luxury_aurora",
      name: "极光屏风",
      type: "luxury",
      price: 35000000,
      score: 40000,
      bonus: 0.85,
      icon: "🌌",
      desc: "永久 +85% 产出，把极光搬进摸鱼房间",
    },
    luxury_night_train: {
      id: "luxury_night_train",
      name: "月夜列车模型",
      type: "luxury",
      price: 70000000,
      score: 70000,
      bonus: 1,
      icon: "🚂",
      desc: "永久 +100% 产出，开往不用打卡的远方",
    },
    luxury_cosmic_cafe: {
      id: "luxury_cosmic_cafe",
      name: "宇宙咖啡馆",
      type: "luxury",
      price: 150000000,
      score: 150000,
      bonus: 1.2,
      icon: "🪐",
      desc: "永久 +120% 产出，在星环旁边慢慢喝",
    },
    luxury_eternal_office: {
      id: "luxury_eternal_office",
      name: "永恒摸鱼神殿",
      type: "luxury",
      price: 500000000,
      score: 500000,
      bonus: 1.8,
      icon: "🏛️",
      desc: "永久 +180% 产出，传说级摸鱼资产",
    },
    luxury_meteor_shower: {
      id: "luxury_meteor_shower",
      name: "流星雨穹顶",
      type: "luxury",
      price: 300000000,
      score: 280000,
      bonus: 1.5,
      icon: "🌠",
      desc: "永久 +150% 产出，每天都有流星许愿",
    },
    luxury_crystal_palace: {
      id: "luxury_crystal_palace",
      name: "水晶宫温室",
      type: "luxury",
      price: 500000000,
      score: 450000,
      bonus: 1.7,
      icon: "🏰",
      desc: "永久 +170% 产出，晶莹剔透的摸鱼宫殿",
    },
    luxury_dragon_pearl: {
      id: "luxury_dragon_pearl",
      name: "龙珠夜明珠",
      type: "luxury",
      price: 800000000,
      score: 700000,
      bonus: 1.95,
      icon: "🐉",
      desc: "永久 +195% 产出，传说龙族也在摸鱼",
    },
    luxury_sakura_gate: {
      id: "luxury_sakura_gate",
      name: "千年樱花门",
      type: "luxury",
      price: 1200000000,
      score: 1000000,
      bonus: 2.2,
      icon: "⛩️",
      desc: "永久 +220% 产出，穿过花门就是下班",
    },
    luxury_black_hole: {
      id: "luxury_black_hole",
      name: "迷你黑洞摆件",
      type: "luxury",
      price: 2000000000,
      score: 1600000,
      bonus: 2.5,
      icon: "🌑",
      desc: "永久 +250% 产出，把加班吸走",
    },
    luxury_phoenix_feather: {
      id: "luxury_phoenix_feather",
      name: "不死鸟羽冠",
      type: "luxury",
      price: 3000000000,
      score: 2400000,
      bonus: 2.8,
      icon: "🪶",
      desc: "永久 +280% 产出，摸鱼之魂永不熄灭",
    },
    luxury_ocean_crown: {
      id: "luxury_ocean_crown",
      name: "深海王冠",
      type: "luxury",
      price: 5000000000,
      score: 3800000,
      bonus: 3.2,
      icon: "🔱",
      desc: "永久 +320% 产出，统治整片摸鱼海",
    },
    luxury_clock_tower: {
      id: "luxury_clock_tower",
      name: "永恒钟楼",
      type: "luxury",
      price: 8000000000,
      score: 6000000,
      bonus: 3.6,
      icon: "🕰️",
      desc: "永久 +360% 产出，把下班时间永远定格",
    },
    luxury_galaxy_ark: {
      id: "luxury_galaxy_ark",
      name: "银河方舟",
      type: "luxury",
      price: 12000000000,
      score: 9000000,
      bonus: 4,
      icon: "🚀",
      desc: "永久 +400% 产出，载着 doro 离开工位",
    },
    luxury_infinite_lounge: {
      id: "luxury_infinite_lounge",
      name: "无限摸鱼厅",
      type: "luxury",
      price: 20000000000,
      score: 14000000,
      bonus: 4.5,
      icon: "♾️",
      desc: "永久 +450% 产出，传说中永远不用加班的地方",
    },
    luxury_stardust_music_box: {
      id: "luxury_stardust_music_box",
      name: "星屑音乐盒",
      type: "luxury",
      price: 30000000000,
      score: 19000000,
      bonus: 5,
      icon: "🎼",
      desc: "永久 +500% 产出，每一枚齿轮都落满星光",
    },
    luxury_moon_castle: {
      id: "luxury_moon_castle",
      name: "月光城堡",
      type: "luxury",
      price: 45000000000,
      score: 27000000,
      bonus: 5.6,
      icon: "🏰",
      desc: "永久 +560% 产出，把整座城堡泡在月色里",
    },
    luxury_time_garden: {
      id: "luxury_time_garden",
      name: "时空花园",
      type: "luxury",
      price: 68000000000,
      score: 38000000,
      bonus: 6.2,
      icon: "🌷",
      desc: "永久 +620% 产出，花开时时间会偷偷暂停",
    },
    luxury_phoenix_throne: {
      id: "luxury_phoenix_throne",
      name: "凤凰王座",
      type: "luxury",
      price: 100000000000,
      score: 52000000,
      bonus: 6.8,
      icon: "🔥",
      desc: "永久 +680% 产出，坐下的瞬间浴火重生",
    },
    luxury_nebula_library: {
      id: "luxury_nebula_library",
      name: "星云图书馆",
      type: "luxury",
      price: 150000000000,
      score: 72000000,
      bonus: 7.4,
      icon: "📖",
      desc: "永久 +740% 产出，每本书都藏着一片星云",
    },
    luxury_interstellar_post: {
      id: "luxury_interstellar_post",
      name: "星际邮局",
      type: "luxury",
      price: 220000000000,
      score: 100000000,
      bonus: 8,
      icon: "📮",
      desc: "永久 +800% 产出，把加班通知寄往宇宙尽头",
    },
    luxury_dream_park: {
      id: "luxury_dream_park",
      name: "梦境游乐园",
      type: "luxury",
      price: 320000000000,
      score: 135000000,
      bonus: 8.7,
      icon: "🎡",
      desc: "永久 +870% 产出，摩天轮每转一圈都在摸鱼",
    },
    luxury_sun_temple: {
      id: "luxury_sun_temple",
      name: "太阳神殿",
      type: "luxury",
      price: 450000000000,
      score: 180000000,
      bonus: 9.4,
      icon: "☀️",
      desc: "永久 +940% 产出，让阳光替 doro 打卡",
    },
    luxury_cosmic_cafe_end: {
      id: "luxury_cosmic_cafe_end",
      name: "宇宙尽头咖啡厅",
      type: "luxury",
      price: 650000000000,
      score: 240000000,
      bonus: 10.2,
      icon: "☕",
      desc: "永久 +1020% 产出，宇宙尽头也没有下班提醒",
    },
    luxury_doro_universe: {
      id: "luxury_doro_universe",
      name: "doro 永恒宇宙",
      type: "luxury",
      price: 1000000000000,
      score: 330000000,
      bonus: 11.5,
      icon: "🌌",
      desc: "永久 +1150% 产出，让整片宇宙陪 doro 一起摸鱼",
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
    rank_level_crown: {
      id: "rank_level_crown",
      name: "摸鱼等级王冠",
      type: "champion",
      leaderboard: "level",
      score: 1000,
      permanentBonus: 0.05,
      dailyIncomeBonus: 1,
      icon: "👑",
      desc: "永久产出 +5%；永耀：当天等级榜分数 +20%，产出 +100%",
    },
    rank_furniture_trophy: {
      id: "rank_furniture_trophy",
      name: "家具大师奖杯",
      type: "champion",
      leaderboard: "furniture",
      score: 1000,
      permanentBonus: 0,
      dailyIncomeBonus: 2,
      icon: "🏆",
      desc: "永耀：当天家具榜分数 +20%，产出 +200%",
    },
    rank_fashion_crown: {
      id: "rank_fashion_crown",
      name: "时装之星皇冠",
      type: "champion",
      leaderboard: "fashion",
      score: 1000,
      permanentBonus: 0,
      dailyIncomeBonus: 2,
      icon: "💎",
      desc: "永耀：当天时装榜分数 +20%，产出 +200%",
    },
    rank_collection_obelisk: {
      id: "rank_collection_obelisk",
      name: "典藏守护方尖碑",
      type: "champion",
      leaderboard: "collection",
      score: 1000,
      permanentBonus: 0,
      dailyIncomeBonus: 2,
      icon: "🗿",
      desc: "永耀：当天典藏榜分数 +20%，产出 +200%",
    },
  };

  const CHAMPION_BY_BOARD = Object.fromEntries(
    Object.values(SHOP_ITEMS)
      .filter((item) => item.type === "champion")
      .map((item) => [item.leaderboard, item])
  );
  const CHAMPION_ITEM_IDS = Object.freeze(
    Object.keys(CHAMPION_BY_BOARD).map((board) => CHAMPION_BY_BOARD[board].id)
  );
  const LEADERBOARD_BOARD_IDS = Object.freeze(["level", "furniture", "fashion", "collection"]);
  const CHAMPION_SCORE_MULTIPLIER = 1.2;
  const CHAMPION_INCOME_BONUS = 2;
  const PREFERENCE_ITEM_IDS = ["fish", "milk_tea", "cake", "hotpot", "wand", "bubble", "gameboy"];
  const STARTER_ACTIONS = ["idle_stand", "walk_bag", "sleep_cat", "closeup_soft", "idle_sit"];
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

  const INTIMACY_LEVELS = [
    { level: 5, min: 600, name: "灵魂挚友" },
    { level: 4, min: 280, name: "知心伙伴" },
    { level: 3, min: 120, name: "默契搭档" },
    { level: 2, min: 40, name: "逐渐熟悉" },
    { level: 1, min: 0, name: "初次见面" },
  ];
  const INTIMACY_ACTIONS = {
    2: "scene_cat",
    3: "sleep_hug_pillow",
    4: "scene_flower",
  };
  const INTIMACY_DIALOGUE = [
    "和你待在一起，比赚金币还开心",
    "今天也想多陪你一会儿",
    "你一回来，我就安心了",
    "我们已经是老朋友了吧？",
  ];

  const GACHA_PRICE = 500;
  const GACHA_TEN_PRICE = 4500;
  const GACHA_PITY_PULLS = 80;
  const GACHA_COMMON_COIN_LOW_RATE = 0.9;
  const GACHA_COMMON_COIN_LOW_MIN = 100;
  const GACHA_COMMON_COIN_LOW_MAX = 500;
  const GACHA_COMMON_COIN_HIGH_MIN = 500;
  const GACHA_COMMON_COIN_HIGH_MAX = 2500;
  const GACHA_LIMITED_DAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
  const GACHA_UP_ID = "up_moon_office";
  const GACHA_UP_VERSION = "v0.0.0.1";
  const GACHA_UP_START = Date.parse("2026-10-25T00:00:00+08:00");
  const GACHA_UP_END = Date.parse("2026-12-21T00:00:00+08:00");
  const GACHA_UP_PRICE = 5000;
  const GACHA_UP_TEN_PRICE = 50000;
  const GACHA_UP_PITY_PULLS = 300;
  const GACHA_UP_BIG_ID = "luxury_moon_observatory";
  const GACHA_UP_OFFICE_ID = "luxury_office";
  const GACHA_UP_BIG_DUPLICATE_COINS = 20000000;
  const GACHA_UP_OFFICE_DUPLICATE_COINS = 520000;
  const DAY_MS = 86400000;
  const GACHA_TOP_PRIZES = [
    {
      amount: 10000000,
      tier: "mythic",
      tierLabel: "摸鱼神话",
      until: 1,
    },
    {
      amount: 500000,
      tier: "legendary",
      tierLabel: "传说大奖",
      until: 6,
    },
    {
      amount: 50000,
      tier: "super",
      tierLabel: "超级大奖",
      until: 606,
    },
    {
      amount: 5000,
      tier: "jackpot",
      tierLabel: "大奖",
      until: 8606,
    },
  ];
  const GACHA_PITY_PRIZES = Object.freeze(GACHA_TOP_PRIZES.filter((prize) => prize.amount !== 10000000));
  // 分支占比仅作用于未命中金币大奖的普通抽取，合计必须为 1。
  const GACHA_RATES = Object.freeze({
    commonCoins: 0.697,
    consumable: 0.02,
    timedFurniture: 0.02,
    buff: 0.03,
    timedOutfit: 0.008,
    legacyOutfitUnlock: 0.005,
    themeOrFallback: 0.22,
  });
  const GACHA_UP_RATES = Object.freeze({
    bigCollection: 0.000025,
    officeCollection: 0.000075,
    commonCoins: 0.8,
    consumable: 0.1524,
    timedFurniture: 0.0125,
    buff: 0.0125,
    timedOutfit: 0.0125,
    legacyOutfitUnlock: 0.01,
  });
  const GACHA_BRANCH_ENDS = Object.freeze({
    commonCoins: GACHA_RATES.commonCoins,
    consumable: GACHA_RATES.commonCoins + GACHA_RATES.consumable,
    timedFurniture: GACHA_RATES.commonCoins + GACHA_RATES.consumable + GACHA_RATES.timedFurniture,
    buff: GACHA_RATES.commonCoins + GACHA_RATES.consumable + GACHA_RATES.timedFurniture + GACHA_RATES.buff,
    timedOutfit:
      GACHA_RATES.commonCoins +
      GACHA_RATES.consumable +
      GACHA_RATES.timedFurniture +
      GACHA_RATES.buff +
      GACHA_RATES.timedOutfit,
    legacyOutfitUnlock:
      GACHA_RATES.commonCoins +
      GACHA_RATES.consumable +
      GACHA_RATES.timedFurniture +
      GACHA_RATES.buff +
      GACHA_RATES.timedOutfit +
      GACHA_RATES.legacyOutfitUnlock,
  });
  const GACHA_UP_BRANCH_ENDS = Object.freeze({
    bigCollection: 25,
    officeCollection: 100,
    commonCoins: 800100,
    consumable: 952500,
    timedFurniture: 965000,
    buff: 977500,
    timedOutfit: 990000,
    legacyOutfitUnlock: 1000000,
  });
  const GACHA_POOLS = Object.freeze({
    standard: Object.freeze({
      id: "standard",
      label: "常驻奖池",
      subtitle: "永久开放",
      price: GACHA_PRICE,
      tenPrice: GACHA_TEN_PRICE,
      pity: GACHA_PITY_PULLS,
    }),
    up: Object.freeze({
      id: "up",
      label: "UP 奖池",
      subtitle: `${GACHA_UP_VERSION} · 10.25–12.20`,
      price: GACHA_UP_PRICE,
      tenPrice: GACHA_UP_TEN_PRICE,
      pity: GACHA_UP_PITY_PULLS,
      startsAt: GACHA_UP_START,
      endsAt: GACHA_UP_END,
    }),
  });
  const BANK_HOURS = 8;
  const BANK_RATE = 0.15;
  const MINIGAME_COOLDOWN_MS = 5 * 60000;
  const MINIGAME_COIN_VALUE = 10000;

  const FURNITURE = {
    cat_tree: {
      id: "cat_tree",
      name: "猫爬架",
      icon: "🐈",
      price: 800,
      score: 80,
      bonus: 0.05,
      desc: "+5% 产出",
    },
    rug: { id: "rug", name: "小地毯", icon: "🧶", price: 500, score: 30, bonus: 0.02, desc: "+2% 产出" },
    plant: { id: "plant", name: "绿植", icon: "🪴", price: 1200, score: 60, bonus: 0.04, desc: "+4% 产出" },
    lamp: { id: "lamp", name: "落地灯", icon: "💡", price: 2000, score: 100, bonus: 0.06, desc: "+6% 产出" },
    companion: {
      id: "companion",
      name: "伙伴 doro",
      icon: "🐣",
      price: 3000,
      score: 200,
      bonus: 0.08,
      desc: "领养小伙伴，+8% 产出",
    },
    bookshelf: {
      id: "bookshelf",
      name: "星海书架",
      icon: "📚",
      price: 5000,
      score: 180,
      bonus: 0.09,
      desc: "永久 +9% 产出",
    },
    gaming_chair: {
      id: "gaming_chair",
      name: "猫爪电竞椅",
      icon: "💺",
      price: 12000,
      score: 300,
      bonus: 0.12,
      desc: "永久 +12% 产出",
    },
    fish_tank: {
      id: "fish_tank",
      name: "摸鱼水族箱",
      icon: "🐠",
      price: 30000,
      score: 500,
      bonus: 0.16,
      desc: "永久 +16% 产出",
    },
    cloud_bed: {
      id: "cloud_bed",
      name: "云朵吊床",
      icon: "🛖",
      price: 80000,
      score: 800,
      bonus: 0.22,
      desc: "永久 +22% 产出",
    },
    zen_garden: {
      id: "zen_garden",
      name: "禅意庭院",
      icon: "🎐",
      price: 180000,
      score: 1200,
      bonus: 0.28,
      desc: "永久 +28% 产出",
    },
    golden_desk: {
      id: "golden_desk",
      name: "黄金摸鱼桌",
      icon: "🪙",
      price: 500000,
      score: 2000,
      bonus: 0.35,
      desc: "永久 +35% 产出",
    },
    neon_sign: {
      id: "neon_sign",
      name: "摸鱼霓虹灯",
      icon: "🪧",
      price: 260000,
      score: 1600,
      bonus: 0.3,
      desc: "永久 +30% 产出",
    },
    cat_wheel: {
      id: "cat_wheel",
      name: "猫咪跑轮",
      icon: "🎡",
      price: 360000,
      score: 2200,
      bonus: 0.34,
      desc: "永久 +34% 产出",
    },
    retro_tv: {
      id: "retro_tv",
      name: "复古电视",
      icon: "📺",
      price: 480000,
      score: 3000,
      bonus: 0.38,
      desc: "永久 +38% 产出",
    },
    coffee_bar: {
      id: "coffee_bar",
      name: "家庭咖啡吧",
      icon: "☕",
      price: 650000,
      score: 4000,
      bonus: 0.42,
      desc: "永久 +42% 产出",
    },
    moon_window: {
      id: "moon_window",
      name: "月景落地窗",
      icon: "🌙",
      price: 850000,
      score: 5200,
      bonus: 0.46,
      desc: "永久 +46% 产出",
    },
    record_player: {
      id: "record_player",
      name: "黑胶唱片机",
      icon: "🎶",
      price: 1100000,
      score: 6800,
      bonus: 0.5,
      desc: "永久 +50% 产出",
    },
    mecha_model: {
      id: "mecha_model",
      name: "机甲模型柜",
      icon: "🤖",
      price: 1500000,
      score: 8800,
      bonus: 0.55,
      desc: "永久 +55% 产出",
    },
    snow_globe: {
      id: "snow_globe",
      name: "星雪水晶球",
      icon: "🔮",
      price: 2000000,
      score: 11000,
      bonus: 0.6,
      desc: "永久 +60% 产出",
    },
    star_projector: {
      id: "star_projector",
      name: "星海投影仪",
      icon: "🌠",
      price: 3000000,
      score: 16000,
      bonus: 0.68,
      desc: "永久 +68% 产出",
    },
    doro_throne: {
      id: "doro_throne",
      name: "doro 黄金王座",
      icon: "👑",
      price: 5000000,
      score: 26000,
      bonus: 0.8,
      desc: "永久 +80% 产出",
    },
    star_cat_bed: {
      id: "star_cat_bed",
      name: "星梦猫窝",
      icon: "🌌",
      price: 6500000,
      score: 34000,
      bonus: 0.85,
      desc: "永久 +85% 产出",
    },
    sakura_swing: {
      id: "sakura_swing",
      name: "樱花秋千",
      icon: "🌸",
      price: 8000000,
      score: 42000,
      bonus: 0.9,
      desc: "永久 +90% 产出",
    },
    mini_library: {
      id: "mini_library",
      name: "迷你图书馆",
      icon: "📚",
      price: 10000000,
      score: 52000,
      bonus: 0.96,
      desc: "永久 +96% 产出",
    },
    dessert_cart: {
      id: "dessert_cart",
      name: "奶油甜品车",
      icon: "🍰",
      price: 13000000,
      score: 65000,
      bonus: 1.02,
      desc: "永久 +102% 产出",
    },
    whale_fountain: {
      id: "whale_fountain",
      name: "鲸鱼喷泉",
      icon: "🐋",
      price: 16000000,
      score: 80000,
      bonus: 1.08,
      desc: "永久 +108% 产出",
    },
    cloud_game_pod: {
      id: "cloud_game_pod",
      name: "云端游戏舱",
      icon: "🎮",
      price: 20000000,
      score: 100000,
      bonus: 1.15,
      desc: "永久 +115% 产出",
    },
    moonlight_desk: {
      id: "moonlight_desk",
      name: "月光书桌",
      icon: "🌙",
      price: 25000000,
      score: 122000,
      bonus: 1.22,
      desc: "永久 +122% 产出",
    },
    orbit_gramophone: {
      id: "orbit_gramophone",
      name: "星轨留声机",
      icon: "🎵",
      price: 32000000,
      score: 150000,
      bonus: 1.3,
      desc: "永久 +130% 产出",
    },
    rainbow_greenhouse: {
      id: "rainbow_greenhouse",
      name: "彩虹温室",
      icon: "🌈",
      price: 42000000,
      score: 185000,
      bonus: 1.4,
      desc: "永久 +140% 产出",
    },
    forest_wish_pool: {
      id: "forest_wish_pool",
      name: "森林许愿池",
      icon: "⛲",
      price: 55000000,
      score: 230000,
      bonus: 1.52,
      desc: "永久 +152% 产出",
    },
  };

  let DRESS_BASE_PRICE = 80;
  let DRESS_PRICE_STEP = 20;
  const DRESS_PRICE_OVERRIDES = {};
  const DRESS_SCORE_OVERRIDES = {};
  const DRESS_LISTED_OVERRIDES = {};
  const CATALOG_ITEM_TYPES = new Set([
    "food",
    "toy",
    "buff",
    "permanent",
    "theme",
    "luxury",
    "profile",
    "fashion",
    "cultivation",
  ]);
  const dynamicShopIds = new Set();
  const dynamicFurnitureIds = new Set();
  const RENTAL_DAYS = [1, 3, 7, 30];
  const PERMANENT_PRICE_MULTIPLIER = 1000;
  const SCHEDULE_MAX = 20;

  // ---- 题库 -------------------------------------------------------------
  // 每种模式的奖励规则：答对 / 答错分别对金币的影响。模拟考试不涉及金币。
  const QUIZ_RULES = {
    daily: { correct: 10000, wrong: 0 },
    quiz: { correct: 10000, wrong: -100 },
    random: { correct: 10000, wrong: -100 },
    event: { correct: 10000, wrong: 0 },
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

  function validCatalogId(id) {
    return (
      typeof id === "string" &&
      /^[a-z][a-z0-9_]{0,39}$/.test(id) &&
      !["__proto__", "constructor", "prototype"].includes(id)
    );
  }

  function applyCatalog(catalog) {
    dynamicShopIds.forEach((id) => delete SHOP_ITEMS[id]);
    dynamicFurnitureIds.forEach((id) => delete FURNITURE[id]);
    dynamicShopIds.clear();
    dynamicFurnitureIds.clear();
    Object.keys(DRESS_PRICE_OVERRIDES).forEach((name) => delete DRESS_PRICE_OVERRIDES[name]);
    Object.keys(DRESS_SCORE_OVERRIDES).forEach((name) => delete DRESS_SCORE_OVERRIDES[name]);
    Object.keys(DRESS_LISTED_OVERRIDES).forEach((name) => delete DRESS_LISTED_OVERRIDES[name]);

    const input = catalog && typeof catalog === "object" ? catalog : {};
    const dressConfig = input.dresses && typeof input.dresses === "object" ? input.dresses : {};
    if (Number.isFinite(Number(dressConfig.basePrice))) {
      DRESS_BASE_PRICE = Math.max(1, Math.min(1000000, Math.round(Number(dressConfig.basePrice))));
    }
    if (Number.isFinite(Number(dressConfig.priceStep))) {
      DRESS_PRICE_STEP = Math.max(0, Math.min(100000, Math.round(Number(dressConfig.priceStep))));
    }
    Object.entries(
      dressConfig.overrides && typeof dressConfig.overrides === "object" ? dressConfig.overrides : {}
    )
      .slice(0, 500)
      .forEach(([name, value]) => {
        if (!validCatalogId(name) || !value || typeof value !== "object") return;
        if (Number.isFinite(Number(value.price))) {
          DRESS_PRICE_OVERRIDES[name] = Math.max(1, Math.round(Number(value.price)));
        }
        if (Number.isFinite(Number(value.score))) {
          DRESS_SCORE_OVERRIDES[name] = Math.max(0, Math.round(Number(value.score)));
        }
        if (value.listed === false) DRESS_LISTED_OVERRIDES[name] = false;
      });

    Object.entries(input.items && typeof input.items === "object" ? input.items : {})
      .slice(0, 300)
      .forEach(([id, value]) => {
        if (!validCatalogId(id) || !value || typeof value !== "object") return;
        if (!CATALOG_ITEM_TYPES.has(value.type)) return;
        const item = { ...value, id, listed: value.listed !== false };
        item.price = Math.max(1, Math.round(Number(item.price) || 1));
        if (Object.prototype.hasOwnProperty.call(item, "score")) {
          item.score = Math.max(0, Math.round(Number(item.score) || 0));
        }
        if (Object.prototype.hasOwnProperty.call(item, "bonus")) {
          item.bonus = Math.max(0, Math.min(20, Number(item.bonus) || 0));
        }
        if (item.type === "buff") {
          item.minutes = Math.max(1, Math.min(1440, Math.round(Number(item.minutes) || 1)));
          item.incomeMultiplier = Math.max(1, Math.min(10, Number(item.incomeMultiplier) || 1));
          if (!validCatalogId(item.buff)) return;
        }
        if (item.type === "fashion") {
          if (!/^fashion\/[a-z0-9_]{1,50}\.svg$/.test(String(item.overlay || ""))) return;
          item.overlayTop = Math.max(-20, Math.min(100, Number(item.overlayTop) || 0));
          item.overlayLeft = Math.max(0, Math.min(100, Number(item.overlayLeft) || 50));
          item.overlayWidth = Math.max(5, Math.min(150, Number(item.overlayWidth) || 50));
        }
        if (item.type === "cultivation") {
          if (
            !["stone", "breakthrough", "life", "technique", "cultivation", "heart", "thunder"].includes(
              item.cultivationType
            )
          ) {
            return;
          }
          if (
            item.cultivationType === "stone" &&
            !["low", "mid", "high", "supreme"].includes(item.stoneTier)
          ) {
            return;
          }
        }
        if (!SHOP_ITEMS[id]) dynamicShopIds.add(id);
        SHOP_ITEMS[id] = item;
      });

    Object.entries(input.furniture && typeof input.furniture === "object" ? input.furniture : {})
      .slice(0, 300)
      .forEach(([id, value]) => {
        if (!validCatalogId(id) || !value || typeof value !== "object") return;
        const item = { ...value, id, listed: value.listed !== false };
        item.price = Math.max(1, Math.round(Number(item.price) || 1));
        item.score = Math.max(0, Math.round(Number(item.score) || 0));
        item.bonus = Math.max(0, Math.min(20, Number(item.bonus) || 0));
        if (!FURNITURE[id]) dynamicFurnitureIds.add(id);
        FURNITURE[id] = item;
      });
    return { version: String(input.version || "builtin"), items: SHOP_ITEMS, furniture: FURNITURE };
  }

  function normalizeEntitlementMap(input) {
    const result = {};
    Object.entries(input && typeof input === "object" ? input : {})
      .slice(0, 500)
      .forEach(([id, value]) => {
        if (!validCatalogId(id) || !value || typeof value !== "object") return;
        const permanent = value.permanent === true;
        const expiresAt = Math.max(0, Number(value.expiresAt) || 0);
        if (!permanent && !expiresAt) return;
        result[id] = { permanent, expiresAt };
      });
    return result;
  }

  function extractShopEntitlements(state) {
    const result = { version: 1, items: {}, furniture: {}, dress: {} };
    Object.values(SHOP_ITEMS).forEach((item) => {
      if (item.type === "permanent" || item.type === "luxury" || item.type === "champion") {
        if (state.perks && state.perks[item.id]) {
          result.items[item.id] = { permanent: true, expiresAt: 0 };
        }
      } else if (item.type === "theme" && state.perks && state.perks[`theme_${item.theme}`]) {
        result.items[item.id] = { permanent: true, expiresAt: 0 };
      }
    });
    ((state.room && state.room.furniture) || []).forEach((id) => {
      if (FURNITURE[id]) result.furniture[id] = { permanent: true, expiresAt: 0 };
    });
    Object.entries((state.rentals && state.rentals.furniture) || {}).forEach(([id, expiresAt]) => {
      if (!FURNITURE[id] || !Number(expiresAt)) return;
      const current = result.furniture[id] || { permanent: false, expiresAt: 0 };
      result.furniture[id] = {
        permanent: current.permanent,
        expiresAt: Math.max(current.expiresAt, Number(expiresAt)),
      };
    });
    (state.unlocked || []).forEach((name) => {
      if (/^[a-z][a-z0-9_]{0,39}$/.test(name)) {
        result.dress[name] = { permanent: true, expiresAt: 0 };
      }
    });
    Object.entries((state.rentals && state.rentals.dress) || {}).forEach(([name, expiresAt]) => {
      if (!Number(expiresAt)) return;
      const current = result.dress[name] || { permanent: false, expiresAt: 0 };
      result.dress[name] = {
        permanent: current.permanent,
        expiresAt: Math.max(current.expiresAt, Number(expiresAt)),
      };
    });
    return result;
  }

  function mergeShopEntitlements(state, remote) {
    const input = remote && typeof remote === "object" ? remote : {};
    const items = normalizeEntitlementMap(input.items);
    const furniture = normalizeEntitlementMap(input.furniture);
    const dress = normalizeEntitlementMap(input.dress);
    let changed = 0;
    Object.entries(items).forEach(([id, entitlement]) => {
      const item = SHOP_ITEMS[id];
      if (!item || !entitlement.permanent) return;
      const key = item.type === "theme" ? `theme_${item.theme}` : item.id;
      if (!state.perks[key]) {
        state.perks[key] = true;
        changed += 1;
      }
    });
    if (!state.room) state.room = { furniture: [] };
    Object.entries(furniture).forEach(([id, entitlement]) => {
      if (!FURNITURE[id]) return;
      if (entitlement.permanent && !state.room.furniture.includes(id)) {
        state.room.furniture.push(id);
        changed += 1;
      }
      if (entitlement.expiresAt > Number(state.rentals.furniture[id] || 0)) {
        state.rentals.furniture[id] = entitlement.expiresAt;
        changed += 1;
      }
      if (entitlement.permanent && id === "companion" && state.companion && !state.companion.adopted) {
        state.companion.adopted = true;
        changed += 1;
      }
    });
    Object.entries(dress).forEach(([name, entitlement]) => {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) return;
      if (entitlement.permanent && !state.unlocked.includes(name)) {
        state.unlocked.push(name);
        changed += 1;
      }
      if (entitlement.expiresAt > Number(state.rentals.dress[name] || 0)) {
        state.rentals.dress[name] = entitlement.expiresAt;
        changed += 1;
      }
    });
    return { ok: changed > 0, changed };
  }

  function freshState(now, rng) {
    const state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    state.lastTick = now;
    state.createdAt = now;
    state.stats.sessions = 1;
    state.cultivation = C.createCultivation(now, rng);
    state.opportunities = O.emptyState(now);
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
        gacha: raw.gacha || { pulls: 0, history: [] },
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
    // 9 -> 10：转生 / 摸鱼传奇
    9: (raw) => {
      return Object.assign({}, raw, {
        version: 10,
        prestige: raw.prestige && typeof raw.prestige === "object" ? raw.prestige : DEFAULT_STATE.prestige,
      });
    },
    // 10 -> 11：亲密度与桌面日记
    10: (raw) => {
      return Object.assign({}, raw, {
        version: 11,
        intimacy: raw.intimacy && typeof raw.intimacy === "object" ? raw.intimacy : DEFAULT_STATE.intimacy,
        diary: raw.diary && typeof raw.diary === "object" ? raw.diary : DEFAULT_STATE.diary,
      });
    },
    // 11 -> 12：内置表情包可隐藏 / 恢复
    11: (raw) => {
      return Object.assign({}, raw, {
        version: 12,
        stickerHidden: Array.isArray(raw.stickerHidden) ? raw.stickerHidden : [],
      });
    },
    // 12 -> 13：家具 / 装扮限时租赁与排行榜分数
    12: (raw) => {
      return Object.assign({}, raw, {
        version: 13,
        rentals:
          raw.rentals && typeof raw.rentals === "object"
            ? {
                furniture:
                  raw.rentals.furniture && typeof raw.rentals.furniture === "object"
                    ? raw.rentals.furniture
                    : {},
                dress: raw.rentals.dress && typeof raw.rentals.dress === "object" ? raw.rentals.dress : {},
              }
            : { furniture: {}, dress: {} },
      });
    },
    // 13 -> 14：榜一当日增幅状态
    13: (raw) => {
      return Object.assign({}, raw, {
        version: 14,
        leaderboardBoosts:
          raw.leaderboardBoosts && typeof raw.leaderboardBoosts === "object"
            ? raw.leaderboardBoosts
            : { period: "", activeUntil: 0, boards: [] },
      });
    },
    // 14 -> 15：抽卡双池计数（旧档补零即可）
    14: (raw) => Object.assign({}, raw, { version: 15 }),
    // 15 -> 16：修仙属性、寿元、突破与轮回
    15: (raw) => Object.assign({}, raw, { version: 16, cultivation: raw.cultivation || null }),
    // 16 -> 17：橘子大陆、区域特性与四档灵石
    16: (raw) =>
      Object.assign({}, raw, {
        version: 17,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                stones: raw.cultivation.stones || {
                  low: Number(raw.cultivation.spiritStones) || 0,
                  mid: 0,
                  high: 0,
                  supreme: 0,
                },
                selectedStoneTier: raw.cultivation.selectedStoneTier || "low",
                regionId: raw.cultivation.regionId || null,
              }
            : null,
      }),
    // 17 -> 18：打坐吐纳与聚灵阵
    17: (raw) =>
      Object.assign({}, raw, {
        version: 18,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                formationId: raw.cultivation.formationId || "gathering",
                meditation: raw.cultivation.meditation || {
                  active: false,
                  lastAt: Date.now(),
                  totalSeconds: 0,
                },
              }
            : null,
      }),
    // 18 -> 19：灵石固定能量与自定义购买 / 消耗数量
    18: (raw) =>
      Object.assign({}, raw, {
        version: 19,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                buyQuantity: raw.cultivation.buyQuantity || 10,
                consumeQuantity: raw.cultivation.consumeQuantity || 1,
              }
            : null,
      }),
    // 19 -> 20：功法参悟冷却
    19: (raw) =>
      Object.assign({}, raw, {
        version: 20,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? { ...raw.cultivation, techniqueReadyAt: raw.cultivation.techniqueReadyAt || 0 }
            : null,
      }),
    // 20 -> 21：仙人神魂转世
    20: (raw) =>
      Object.assign({}, raw, {
        version: 21,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                soul: raw.cultivation.soul || {
                  level: 0,
                  count: 0,
                  root: "",
                  attributeBonus: 0,
                },
              }
            : null,
      }),
    // 21 -> 22：功法卷轴、已学功法与装备槽
    21: (raw) =>
      Object.assign({}, raw, {
        version: 22,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                techniqueScrolls: raw.cultivation.techniqueScrolls || {},
                techniquesKnown: raw.cultivation.techniquesKnown || [],
                equippedTechnique: raw.cultivation.equippedTechnique || "",
              }
            : null,
      }),
    // 22 -> 23：完整灵根谱系与组合功法
    22: (raw) => Object.assign({}, raw, { version: 23 }),
    // 23 -> 24：数据驱动机缘、选项效果与机缘录
    23: (raw) =>
      Object.assign({}, raw, {
        version: 24,
        opportunities: O.normalizeState(raw.opportunities, 0),
      }),
    // 24 -> 25：功法分类、五类多修与单部功法修炼进度
    24: (raw) =>
      Object.assign({}, raw, {
        version: 25,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? (() => {
                const equippedTechniques =
                  raw.cultivation.equippedTechniques || [raw.cultivation.equippedTechnique].filter(Boolean);
                const techniqueProgress = { ...(raw.cultivation.techniqueProgress || {}) };
                equippedTechniques.forEach((id) => {
                  if (techniqueProgress[id] === undefined) techniqueProgress[id] = 100;
                });
                return { ...raw.cultivation, techniqueProgress, equippedTechniques };
              })()
            : null,
      }),
    // 25 -> 26：随机洞天福地、随机修炼效果与功法丹药
    25: (raw) =>
      Object.assign({}, raw, {
        version: 26,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                cave: raw.cultivation.cave || {
                  refreshAt: 0,
                  spots: [],
                  active: null,
                  readyAt: 0,
                  visits: 0,
                  lastLoot: null,
                },
                pills: {
                  breakthrough: 0,
                  life: 0,
                  technique: 0,
                  cultivation: 0,
                  heart: 0,
                  ...(raw.cultivation.pills || {}),
                },
              }
            : null,
      }),
    // 26 -> 27：灵石批量吸收会话
    26: (raw) =>
      Object.assign({}, raw, {
        version: 27,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                stoneSession: raw.cultivation.stoneSession || C.emptyCultivation(0).stoneSession,
              }
            : null,
      }),
    // 27 -> 28：灵力、黑塔挑战、自定义快捷键、自动进食与培元丹阶段额度
    27: (raw) =>
      Object.assign({}, raw, {
        version: 28,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                cultivationPillUse: raw.cultivation.cultivationPillUse || {
                  level: 0,
                  count: 0,
                },
                spiritualPower: raw.cultivation.spiritualPower,
                spiritualPowerUpdatedAt:
                  raw.cultivation.spiritualPowerUpdatedAt || raw.cultivation.lastAgedAt || Date.now(),
                blackTower: raw.cultivation.blackTower || {
                  selectedFloor: 1,
                  bestFloor: 0,
                  attempts: 0,
                  wins: 0,
                  lastResult: null,
                },
              }
            : null,
        settings: {
          ...(raw.settings || {}),
          autoFeed: raw.settings && raw.settings.autoFeed === true,
          shortcuts: normalizeShortcuts(raw.settings && raw.settings.shortcuts),
        },
      }),
    // 28 -> 29：辟谷丹与元婴期灵力维持
    28: (raw) =>
      Object.assign({}, raw, {
        version: 29,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                biguUntil: raw.cultivation.biguUntil || 0,
                pills: {
                  breakthrough: 0,
                  life: 0,
                  technique: 0,
                  cultivation: 0,
                  heart: 0,
                  bigu: 0,
                  ...(raw.cultivation.pills || {}),
                },
              }
            : null,
      }),
    // 29 -> 30：生命/攻击/防御与黑塔逐层实时战斗
    29: (raw) =>
      Object.assign({}, raw, {
        version: 30,
        cultivation:
          raw.cultivation && typeof raw.cultivation === "object"
            ? {
                ...raw.cultivation,
                hp: raw.cultivation.hp || 0,
                blackTower: {
                  selectedFloor: 1,
                  bestFloor: 0,
                  attempts: 0,
                  wins: 0,
                  autoAdvance: false,
                  loop: false,
                  nextBattleAt: 0,
                  battle: null,
                  lastResult: null,
                  ...(raw.cultivation.blackTower || {}),
                },
              }
            : null,
      }),
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
  function hydrate(raw, now, rng) {
    if (!raw || typeof raw !== "object") return freshState(now, rng);
    raw = migrate(raw);
    const state = freshState(now, rng);
    state.coins = num(raw.coins, 0, 0);
    state.totalEarned = num(raw.totalEarned, state.coins, 0);
    state.level = Math.round(num(raw.level, 1, 1, 999));
    state.cultivation = C.normalizeCultivation(raw.cultivation, now, rng);
    if (!(Number(raw.cultivation && raw.cultivation.hp) > 0)) {
      state.cultivation.hp = combatStats(state).maxHp;
    }
    if (
      state.cultivation.blackTower &&
      state.cultivation.blackTower.battle &&
      state.cultivation.blackTower.battle.active
    ) {
      state.cultivation.blackTower.battle.lastAttackAt = now;
    }
    if (!Number.isFinite(Number(raw.cultivation && raw.cultivation.spiritualPower))) {
      state.cultivation.spiritualPowerMax = spiritualPowerCapacity(state.cultivation, state.level);
      state.cultivation.spiritualPower = state.cultivation.spiritualPowerMax;
      state.cultivation.spiritualPowerUpdatedAt = now;
    }
    state.opportunities = O.normalizeState(raw.opportunities, now);
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
    state.rentals = {
      furniture: Object.fromEntries(
        Object.entries((raw.rentals && raw.rentals.furniture) || {})
          .filter(
            ([id, expiresAt]) =>
              /^[a-z0-9_]{1,40}$/.test(id) && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0
          )
          .slice(0, 100)
      ),
      dress: Object.fromEntries(
        Object.entries((raw.rentals && raw.rentals.dress) || {})
          .filter(
            ([id, expiresAt]) =>
              /^[a-z0-9_]{1,40}$/.test(id) && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0
          )
          .slice(0, 200)
      ),
    };
    state.leaderboardBoosts = {
      period: /^\d{4}-\d{2}-\d{2}$/.test(
        String((raw.leaderboardBoosts && raw.leaderboardBoosts.period) || "")
      )
        ? String(raw.leaderboardBoosts.period)
        : "",
      activeUntil: num(raw.leaderboardBoosts && raw.leaderboardBoosts.activeUntil, 0, 0),
      boards: Array.isArray(raw.leaderboardBoosts && raw.leaderboardBoosts.boards)
        ? [...new Set(raw.leaderboardBoosts.boards.filter((board) => LEADERBOARD_BOARD_IDS.includes(board)))]
        : [],
    };
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
    state.stickerHidden = Array.isArray(raw.stickerHidden)
      ? [
          ...new Set(
            raw.stickerHidden.filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name))
          ),
        ]
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
            progress: Object.assign(
              { pets: 0, feeds: 0, plays: 0, actionsViewed: 0, coinsEarned: 0, visitors: 0 },
              raw.daily.progress
            ),
            claimed: Array.isArray(raw.daily.claimed) ? raw.daily.claimed : [],
          }
        : {
            date: "",
            progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0, coinsEarned: 0, visitors: 0 },
            claimed: [],
          };
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
    state.gacha = {
      pulls: raw.gacha && typeof raw.gacha === "object" ? num(raw.gacha.pulls, 0, 0) : 0,
      upPulls: raw.gacha && typeof raw.gacha === "object" ? num(raw.gacha.upPulls, 0, 0) : 0,
      upPity:
        raw.gacha && typeof raw.gacha === "object" ? num(raw.gacha.upPity, 0, 0, GACHA_UP_PITY_PULLS) : 0,
      history: Array.isArray(raw.gacha && raw.gacha.history)
        ? raw.gacha.history
            .filter((entry) => entry && typeof entry === "object" && typeof entry.label === "string")
            .slice(0, 50)
            .map((entry) => ({
              at: num(entry.at, 0, 0, Number.MAX_SAFE_INTEGER),
              type: String(entry.type || "").slice(0, 20),
              label: String(entry.label).slice(0, 100),
              tier: ["common", "rare", "jackpot", "super", "legendary", "mythic"].includes(entry.tier)
                ? entry.tier
                : "common",
              amount: num(entry.amount, 0, 0, 100000000),
              durationDays: num(entry.durationDays, 0, 0, 7),
              itemId: String(entry.itemId || "").slice(0, 50),
              pool: entry.pool === "up" ? "up" : "standard",
              guaranteed: entry.guaranteed === true,
            }))
        : [],
    };
    state.minigame =
      raw.minigame && typeof raw.minigame === "object"
        ? { lastPlayedAt: num(raw.minigame.lastPlayedAt, 0, 0) }
        : { lastPlayedAt: 0 };
    state.visitor = raw.visitor && typeof raw.visitor === "object" ? raw.visitor : null;
    state.nextVisitorAt = num(raw.nextVisitorAt, 0, 0);
    if (!state.nextVisitorAt) state.nextVisitorAt = now + 10 * 60000;
    state.room =
      raw.room && Array.isArray(raw.room.furniture)
        ? { furniture: raw.room.furniture.slice(0, 100) }
        : { furniture: [] };
    state.companion =
      raw.companion && typeof raw.companion === "object"
        ? { adopted: raw.companion.adopted === true }
        : { adopted: false };
    // v12 以前的伙伴只记录 adopted；补进房间资产，升级后不会消失。
    if (state.companion.adopted && !state.room.furniture.includes("companion")) {
      state.room.furniture.push("companion");
    }
    state.room.furniture = [
      ...new Set(
        state.room.furniture.filter(
          (id) =>
            typeof id === "string" &&
            /^[a-z][a-z0-9_]{0,39}$/.test(id) &&
            !["__proto__", "constructor", "prototype"].includes(id)
        )
      ),
    ].slice(0, 100);
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
    state.prestige = {
      count: Math.round(num(raw.prestige && raw.prestige.count, 0, 0, 9999)),
      legacyLevel: num(raw.prestige && raw.prestige.legacyLevel, 0, 0, 1e9),
    };
    state.intimacy = {
      points: num(raw.intimacy && raw.intimacy.points, 0, 0, 1e9),
      dailyDate: typeof (raw.intimacy && raw.intimacy.dailyDate) === "string" ? raw.intimacy.dailyDate : "",
      dailyPoints: num(raw.intimacy && raw.intimacy.dailyPoints, 0, 0, 1e9),
    };
    state.diary = {
      entries: Array.isArray(raw.diary && raw.diary.entries)
        ? raw.diary.entries
            .filter((entry) => entry && typeof entry === "object" && typeof entry.text === "string")
            .slice(-30)
            .map((entry) => ({
              date: String(entry.date || "").slice(0, 10),
              text: entry.text.slice(0, 500),
            }))
        : [],
    };
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
    state.settings.autoFeed = state.settings.autoFeed === true;
    state.settings.shortcuts = normalizeShortcuts(state.settings.shortcuts);
    state.settings.scale = num(state.settings.scale, 1, 0.6, 1.8);
    state.settings.ambientIntervalSec = num(state.settings.ambientIntervalSec, 60, 5, 600);
    state.settings.autoWalkIntervalSec = num(state.settings.autoWalkIntervalSec, 45, 10, 600);
    if (!["default", "night", "mint", "sakura"].includes(state.settings.theme)) {
      state.settings.theme = "default";
    }
    state.settings.analytics = state.settings.analytics === true;
    state.settings.roamSpeed = num(state.settings.roamSpeed, 55, 20, 200);
    state.settings.equippedFashion =
      typeof state.settings.equippedFashion === "string" &&
      /^fashion_[a-z0-9_]{1,32}$/.test(state.settings.equippedFashion)
        ? state.settings.equippedFashion
        : "";
    if (state.lastTick > now) state.lastTick = now;
    const lifespanEvent = advanceLifespan(state, now || Date.now(), rng);
    if (lifespanEvent.died) state.lastTick = now || Date.now();
    return state;
  }

  function luxuryIncomeBonus(state) {
    return Object.values(SHOP_ITEMS)
      .filter((item) => item.type === "luxury" && state.perks && state.perks[item.id])
      .reduce((sum, item) => sum + (Number(item.bonus) || 0), 0);
  }

  function permanentIncomeBonus(state) {
    return Object.values(SHOP_ITEMS)
      .filter((item) => item.type === "permanent" && state.perks && state.perks[item.id])
      .reduce((sum, item) => sum + (Number(item.bonus) || 0), 0);
  }

  function activeChampionBoards(state, now) {
    const boost = state.leaderboardBoosts;
    if (!boost || Number(boost.activeUntil) <= (now || Date.now())) return [];
    return LEADERBOARD_BOARD_IDS.filter((board) => (boost.boards || []).includes(board));
  }

  function championPermanentIncomeBonus(state) {
    return Object.values(CHAMPION_BY_BOARD).reduce(
      (sum, item) => sum + (state.perks && state.perks[item.id] ? Number(item.permanentBonus) || 0 : 0),
      0
    );
  }

  function championIncomeBonus(state, now) {
    return activeChampionBoards(state, now).reduce(
      (sum, board) =>
        sum + (Number(CHAMPION_BY_BOARD[board] && CHAMPION_BY_BOARD[board].dailyIncomeBonus) || 0),
      0
    );
  }

  /** 多个限时产出增益同时生效时，只采用最高倍率，避免叠乘失控。 */
  function activeIncomeBuffMultiplier(state, now) {
    const ts = now || Date.now();
    return Object.values(SHOP_ITEMS).reduce((highest, item) => {
      if (item.type !== "buff" || !activeBuff(state, item.buff, ts)) return highest;
      return Math.max(highest, Number(item.incomeMultiplier) || 1);
    }, 1);
  }

  function fastingStatus(state, now) {
    const ts = now || Date.now();
    const biguUntil = Math.max(0, Number(state.cultivation && state.cultivation.biguUntil) || 0);
    if (state.level >= 41) {
      return {
        active: true,
        source: "nascent",
        until: 0,
        remainingMs: 0,
        label: "元婴辟谷",
      };
    }
    if (ts < biguUntil) {
      return {
        active: true,
        source: "bigu",
        until: biguUntil,
        remainingMs: biguUntil - ts,
        label: "辟谷丹",
      };
    }
    return { active: false, source: "", until: biguUntil, remainingMs: 0, label: "" };
  }

  /** 当前每秒实际产出的金币（含等级、心情、饱食度、性格与典藏影响）。 */
  function incomePerSecond(state, now) {
    const base = state.level * BALANCE.baseIncomePerLevel * C.realmPowerMultiplier(state.level);
    const moodFactor = 1 + BALANCE.moodBonus * (state.mood / 100);
    const personalityFactor = personalityOf(state).income;
    const prestigeFactor = 1;
    const buffFactor = activeIncomeBuffMultiplier(state);
    const feedFactor =
      !fastingStatus(state, now).active && state.satiety < BALANCE.hungryThreshold
        ? state.satiety <= BALANCE.emptyThreshold
          ? BALANCE.starvingMultiplier
          : BALANCE.hungryMultiplier
        : 1;
    const roomBonus = roomBonusValue(state);
    const companionBonus =
      ownsFurniture(state, "companion") && !workerUnavailable(state, "companion")
        ? FURNITURE.companion.bonus
        : 0;
    const luxuryBonus = luxuryIncomeBonus(state);
    const permanentBonus = permanentIncomeBonus(state);
    const championPermanentBonus = championPermanentIncomeBonus(state);
    const championBonus = championIncomeBonus(state);
    return (
      base *
      moodFactor *
      feedFactor *
      buffFactor *
      personalityFactor *
      prestigeFactor *
      (1 + roomBonus + companionBonus + luxuryBonus + permanentBonus + championPermanentBonus + championBonus)
    );
  }

  function incomeBreakdown(state, now) {
    const fasting = fastingStatus(state, now);
    return {
      perSecond: incomePerSecond(state, now),
      base: state.level * BALANCE.baseIncomePerLevel * C.realmPowerMultiplier(state.level),
      moodFactor: 1 + BALANCE.moodBonus * (state.mood / 100),
      personalityFactor: personalityOf(state).income,
      prestigeFactor: 1,
      luxuryBonus: luxuryIncomeBonus(state),
      permanentBonus: permanentIncomeBonus(state),
      championPermanentBonus: championPermanentIncomeBonus(state),
      championBonus: championIncomeBonus(state),
      championBoards: activeChampionBoards(state),
      hungry: !fasting.active && state.satiety < BALANCE.hungryThreshold,
      starving: !fasting.active && state.satiety <= BALANCE.emptyThreshold,
      fasting,
    };
  }

  /**
   * 推进 elapsedMs 毫秒。超过 5 分钟的空档按"离线"处理（打折结算），
   * 避免把电脑休眠的时间算成暴富。
   */
  function tick(state, elapsedMs, rng) {
    const seconds = Math.max(0, elapsedMs) / 1000;
    if (seconds <= 0) return { earned: 0, offline: false };
    const tickNow = Math.max(0, Number(state.lastTick) || Date.now()) + seconds * 1000;

    const offline = seconds > 300;
    const efficiency = offline ? BALANCE.offlineEfficiency : 1;
    const earned = incomePerSecond(state, tickNow) * seconds * efficiency;

    state.coins += earned;
    state.totalEarned += earned;
    ensureDaily(state, tickNow).progress.coinsEarned += earned;
    const fasting = fastingStatus(state, tickNow);
    if (!fasting.active) {
      state.satiety = clamp(
        state.satiety - (BALANCE.satietyDecayPerMinute * seconds) / 60,
        0,
        100
      );
    }
    state.mood = clamp(state.mood - (BALANCE.moodDecayPerMinute * seconds) / 60, 0, 100);
    const autoFed =
      state.settings &&
      state.settings.autoFeed &&
      !fasting.active &&
      state.satiety < BALANCE.hungryThreshold &&
      state.coins >= BALANCE.feedCost
        ? feed(state, tickNow).ok
        : false;
    if (state.settings && state.settings.analytics && state.metrics) {
      const key = dayKey();
      state.metrics.days[key] = Math.min(86400, (state.metrics.days[key] || 0) + seconds);
      const keys = Object.keys(state.metrics.days).sort();
      if (keys.length > 60) {
        state.metrics.days = Object.fromEntries(keys.slice(-60).map((k) => [k, state.metrics.days[k]]));
      }
    }
    state.lastTick = tickNow;
    const spiritualPower = recoverSpiritualPower(state, tickNow);
    const towerBattle = advanceBlackTowerBattle(state, tickNow, rng);
    regenerateCombatHealth(state, seconds);
    const meditation = settleMeditation(state, tickNow);
    const stoneCultivation = settleStoneCultivation(state, tickNow, rng);
    const lifespan = advanceLifespan(state, tickNow, rng);
    return {
      earned,
      offline,
      efficiency,
      autoFed,
      spiritualPower,
      towerBattle,
      meditation,
      stoneCultivation,
      lifespan,
      died: lifespan.died,
    };
  }

  /** 从存档的 lastTick 结算到现在的收益。 */
  function settleOffline(state, now, rng) {
    const spiritualPower = recoverSpiritualPower(state, now);
    const meditation = settleMeditation(state, now);
    const stoneCultivation = settleStoneCultivation(state, now, rng);
    const elapsed = Math.max(0, (now - state.lastTick) / 1000);
    if (elapsed < 60) {
      state.lastTick = now;
      return { seconds: 0, earned: 0, meditation, stoneCultivation, spiritualPower };
    }
    const capped = Math.min(elapsed, BALANCE.offlineCapHours * 3600);
    const earned = incomePerSecond(state, now) * capped * BALANCE.offlineEfficiency;
    state.coins += earned;
    state.totalEarned += earned;
    const offlineStart = now - capped * 1000;
    const biguUntil = Math.max(0, Number(state.cultivation && state.cultivation.biguUntil) || 0);
    const decaySeconds =
      state.level >= 41
        ? 0
        : Math.max(0, (now - Math.max(offlineStart, biguUntil)) / 1000);
    if (decaySeconds > 0) {
      state.satiety = Math.max(
        BALANCE.offlineSatietyFloor,
        state.satiety - (BALANCE.satietyDecayPerMinute * decaySeconds) / 60
      );
    }
    state.mood = Math.max(BALANCE.offlineMoodFloor, state.mood - (BALANCE.moodDecayPerMinute * capped) / 60);
    regenerateCombatHealth(state, capped);
    state.lastTick = now;
    const lifespan = advanceLifespan(state, now, rng);
    return {
      seconds: capped,
      earned,
      meditation,
      stoneCultivation,
      spiritualPower,
      lifespan,
      died: lifespan.died,
    };
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
    const intimacy = addIntimacy(state, 2, now);
    state.lastTick = now || Date.now();
    return { ok: true, dialogue: "好吃！", training, intimacy };
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
    const intimacy = addIntimacy(state, 2, now);
    state.lastTick = now || Date.now();
    return { ok: true, dialogue: "好玩！", training, intimacy };
  }

  /**
   * 灵力上限取当前修为与此前每个小等级修为需求的总和。
   * 这样越往后修出的灵力越浑厚，也不会只看当前一格经验而突然跌落。
   */
  function totalCultivationAmount(cultivation, level) {
    let total = Math.max(0, Number(cultivation && cultivation.exp) || 0);
    const currentLevel = Math.max(1, Math.min(C.MAX_LEVEL, Math.round(Number(level) || 1)));
    for (let value = 1; value < currentLevel; value += 1) {
      total += C.expRequired(value);
    }
    return total;
  }

  function spiritualPowerCapacity(cultivation, level) {
    return Math.max(100, Math.round(totalCultivationAmount(cultivation, level) / 10));
  }

  function spiritualPowerRecoveryRate(state) {
    const cultivation = state.cultivation;
    const attrs = C.talentSummary(cultivation.attributes);
    const root = C.ROOTS[attrs.root] || C.ROOTS.mixed;
    const region = C.regionById(cultivation.regionId) || C.ORANGE_REGIONS[0];
    const formation = C.formationById(cultivation.formationId);
    const techniqueBonus = C.techniqueBonuses(cultivation);
    const caveBonus = C.caveBonuses(cultivation);
    const max = spiritualPowerCapacity(cultivation, state.level);
    const meditationFactor = cultivation.meditation && cultivation.meditation.active ? 1.15 : 1;
    const cultivationFactor =
      (1 + Math.min(1.5, Math.max(0, state.level - 1) / 500)) * Math.sqrt(root.gain || 1);
    const basePerSecond = Math.max(0.02, max * 0.00035 * cultivationFactor);
    const environmentFactor =
      region.qi *
      formation.multiplier *
      techniqueBonus.cultivationMultiplier *
      caveBonus.expMultiplier *
      meditationFactor;
    const perSecond = basePerSecond * environmentFactor;
    const maintenancePerSecond =
      state.level >= 41
        ? basePerSecond * 1.2 * (cultivation.meditation && cultivation.meditation.active ? 0.1 : 1)
        : 0;
    return {
      perSecond,
      basePerSecond,
      maintenancePerSecond,
      netPerSecond: perSecond - maintenancePerSecond,
      max,
      environmentFactor,
      cultivationFactor,
      region,
      formation,
      caveBonus,
    };
  }

  function recoverSpiritualPower(state, now, options) {
    const ts = now || Date.now();
    const settings = options || {};
    state.cultivation = C.normalizeCultivation(state.cultivation, ts);
    const cultivation = state.cultivation;
    const max = spiritualPowerCapacity(cultivation, state.level);
    const last = Math.max(0, Math.min(ts, Number(cultivation.spiritualPowerUpdatedAt) || ts));
    const elapsedSeconds = settings.recover === false ? 0 : Math.max(0, (ts - last) / 1000);
    const rate = spiritualPowerRecoveryRate(state);
    cultivation.spiritualPowerMax = max;
    cultivation.spiritualPower = Math.min(
      max,
      Math.max(0, Number(cultivation.spiritualPower) || 0) + rate.netPerSecond * elapsedSeconds
    );
    cultivation.spiritualPowerUpdatedAt = ts;
    return {
      current: cultivation.spiritualPower,
      max,
      perSecond: rate.perSecond,
      basePerSecond: rate.basePerSecond,
      maintenancePerSecond: rate.maintenancePerSecond,
      netPerSecond: rate.netPerSecond,
      environmentFactor: rate.environmentFactor,
      cultivationFactor: rate.cultivationFactor,
      region: rate.region,
      formation: rate.formation,
      caveBonus: rate.caveBonus,
    };
  }

  function combatStats(state) {
    const cultivation = state.cultivation;
    const attrs = C.talentSummary(cultivation && cultivation.attributes);
    const lineage = Math.max(0, Number(attrs.rootLineage) || 0);
    const total = totalCultivationAmount(cultivation, state.level);
    const level = Math.max(1, Math.min(C.MAX_LEVEL, Math.round(Number(state.level) || 1)));
    const hpGrowth = Math.pow(COMBAT_GROWTH.hp, level - 1);
    const attackGrowth = Math.pow(COMBAT_GROWTH.attack, level - 1);
    const defenseGrowth = Math.pow(COMBAT_GROWTH.defense, level - 1);
    const maxHp = Math.max(
      100,
      Math.round(
        (220 + attrs.daoHeart * 2 + attrs.lifespan * 0.35) *
          hpGrowth *
          (1 + lineage * 0.01)
      )
    );
    const attack = Math.max(
      8,
      Math.round(
        (10 + attrs.insight * 0.035 + Number(cultivation && cultivation.technique) * 0.003) *
          attackGrowth *
          (1 + lineage * 0.008)
      )
    );
    const defense = Math.max(
      3,
      Math.round(
        (5 + attrs.daoHeart * 0.025 + lineage * 1.5) *
          defenseGrowth *
          (1 + lineage * 0.006)
      )
    );
    const blockChance = clamp(
      0.08 + (defense / Math.max(1, defense + 160 + state.level * 2)) * 0.5 + attrs.daoHeart * 0.0005,
      0.08,
      0.6
    );
    const dodgeChance = clamp(
      0.02 + attrs.fortune * 0.0009 + attrs.insight * 0.00035,
      0.02,
      0.35
    );
    return {
      maxHp,
      attack,
      defense,
      blockChance,
      dodgeChance,
      cultivationTotal: total,
    };
  }

  function towerLog(battle, at, type, text) {
    if (!battle) return;
    battle.log.push({
      at,
      type: String(type || "info").slice(0, 20),
      text: String(text || "").slice(0, 160),
    });
    if (battle.log.length > 20) battle.log.splice(0, battle.log.length - 20);
  }

  function towerFoeStats(state, entry, guardian) {
    const stats = combatStats(state);
    const floor = entry.floor;
    const maxHp = guardian
      ? Math.max(40, Math.round(stats.attack * (8 + floor * 0.9)))
      : Math.max(12, Math.round(stats.attack * (1.15 + floor * 0.08)));
    const attack = Math.max(
      3,
      Math.round(stats.defense * (0.62 + floor * 0.035) * (guardian ? 1.9 : 1))
    );
    return { maxHp, attack };
  }

  function awardTowerFightExperience(state, battle, entry, guardian) {
    const ratio = guardian
      ? 0.03 * (1 + entry.floor * 0.08)
      : 0.0012 * (1 + entry.floor * 0.08);
    const gained = Math.max(1, Math.round(C.expRequired(state.level) * ratio));
    const advanced = C.addExperience(state.cultivation, state.level, gained);
    state.level = advanced.level;
    battle.rewardGained += gained;
    return gained;
  }

  function blackTowerStatus(state, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const power = recoverSpiritualPower(state, now || Date.now());
    const stats = combatStats(state);
    if (!Number.isFinite(Number(state.cultivation.hp))) state.cultivation.hp = stats.maxHp;
    state.cultivation.hp = clamp(Number(state.cultivation.hp) || 0, 0, stats.maxHp);
    const tower = state.cultivation.blackTower;
    const unlocked = BLACK_TOWER_FLOORS.filter((entry) => state.level >= entry.minLevel);
    if (!unlocked.some((entry) => entry.floor === tower.selectedFloor)) {
      tower.selectedFloor = unlocked[unlocked.length - 1].floor;
    }
    const selected = BLACK_TOWER_FLOORS.find((entry) => entry.floor === tower.selectedFloor);
    return {
      floors: BLACK_TOWER_FLOORS.map((entry) => ({
        ...entry,
        unlocked: state.level >= entry.minLevel,
        cost: Math.max(1, Math.round(power.max * entry.costRatio)),
        reward: Math.max(1, Math.round(C.expRequired(state.level) * entry.rewardRatio)),
      })),
      selected: {
        ...selected,
        unlocked: state.level >= selected.minLevel,
        cost: Math.max(1, Math.round(power.max * selected.costRatio)),
        reward: Math.max(1, Math.round(C.expRequired(state.level) * selected.rewardRatio)),
      },
      power,
      combat: {
        ...stats,
        hp: state.cultivation.hp,
      },
      attempts: tower.attempts,
      wins: tower.wins,
      bestFloor: tower.bestFloor,
      lastResult: tower.lastResult,
      autoAdvance: tower.autoAdvance,
      loop: tower.loop,
      nextBattleAt: tower.nextBattleAt,
      battle: tower.battle
        ? {
            ...tower.battle,
            log: tower.battle.log.map((entry) => ({ ...entry })),
            mobsRemaining: Math.max(0, tower.battle.total - tower.battle.kills),
          }
        : null,
    };
  }

  function setBlackTowerFloor(state, floor, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const entry = BLACK_TOWER_FLOORS.find((item) => item.floor === Math.round(Number(floor)));
    if (!entry) return { ok: false, reason: "floor" };
    if (state.level < entry.minLevel) {
      return { ok: false, reason: "locked", requiredLevel: entry.minLevel, floor: entry };
    }
    state.cultivation.blackTower.selectedFloor = entry.floor;
    return { ok: true, floor: entry };
  }

  function startBlackTowerBattle(state, floor, now, rng) {
    const ts = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, random);
    const status = blackTowerStatus(state, ts);
    const requestedFloor = Math.round(Number(floor) || status.selected.floor);
    const entry = BLACK_TOWER_FLOORS.find((item) => item.floor === requestedFloor);
    if (!entry) return { ok: false, reason: "floor" };
    if (state.level < entry.minLevel) {
      return { ok: false, reason: "locked", requiredLevel: entry.minLevel, floor: entry };
    }
    if (status.combat.hp / Math.max(1, status.combat.maxHp) < 0.2) {
      return {
        ok: false,
        reason: "low-hp",
        hp: status.combat.hp,
        maxHp: status.combat.maxHp,
        floor: entry,
      };
    }
    if (
      state.level < C.MAX_LEVEL &&
      C.isBreakthroughLevel(state.level) &&
      state.cultivation.exp >= C.expRequired(state.level)
    ) {
      return { ok: false, reason: "breakthrough", floor: entry };
    }
    const cost = Math.max(1, Math.round(status.power.max * entry.costRatio));
    if (status.power.current + 1e-9 < cost) {
      return {
        ok: false,
        reason: "power",
        required: cost,
        available: Math.floor(status.power.current),
        floor: entry,
      };
    }
    if (status.battle && status.battle.active) {
      return { ok: false, reason: "active", battle: status.battle, floor: entry };
    }

    const tower = state.cultivation.blackTower;
    const stats = combatStats(state);
    state.cultivation.hp = clamp(Number(state.cultivation.hp) || 0, 0, stats.maxHp);
    state.cultivation.spiritualPower = Math.max(0, status.power.current - cost);
    state.cultivation.spiritualPowerUpdatedAt = ts;
    tower.selectedFloor = entry.floor;
    tower.nextBattleAt = 0;
    const foe = towerFoeStats(state, entry, false);
    const guardian = towerFoeStats(state, entry, true);
    tower.attempts += 1;
    tower.battle = {
      active: true,
      paused: false,
      phase: "mobs",
      floor: entry.floor,
      entryCost: cost,
      kills: 0,
      total: 100,
      mobHp: foe.maxHp,
      mobMaxHp: foe.maxHp,
      mobAttack: foe.attack,
      guardianHp: guardian.maxHp,
      guardianMaxHp: guardian.maxHp,
      guardianAttack: guardian.attack,
      guardianSpawned: false,
      guardianDefeated: false,
      startedAt: ts,
      lastAttackAt: ts,
      clearedAt: 0,
      failedAt: 0,
      rewardGained: 0,
      log: [],
    };
    towerLog(tower.battle, ts, "start", `进入${entry.name}，开始挑战百只妖物`);
    return {
      ok: true,
      floor: entry,
      cost,
      battle: { ...tower.battle, log: tower.battle.log.map((item) => ({ ...item })) },
      dialogue: `进入${entry.name}，消耗 ${cost} 灵力`,
    };
  }

  function finishBlackTowerFloor(state, ts, entry) {
    const tower = state.cultivation.blackTower;
    const battle = tower.battle;
    const gained = Math.max(1, Math.round(C.expRequired(state.level) * entry.rewardRatio));
    const advanced = C.addExperience(state.cultivation, state.level, gained);
    state.level = advanced.level;
    battle.rewardGained += gained;
    tower.wins += 1;
    tower.bestFloor = Math.max(tower.bestFloor, entry.floor);
    tower.lastResult = {
      floor: entry.floor,
      enemy: entry.enemy,
      outcome: "win",
      gained: battle.rewardGained,
      spent: battle.entryCost,
      at: ts,
    };
    Object.assign(battle, {
      active: false,
      paused: false,
      phase: "cleared",
      clearedAt: ts,
      guardianDefeated: true,
    });
    towerLog(battle, ts, "clear", `清除百只妖物与${entry.enemy}，本层通关，修为 +${gained}`);
    const nextEntry = BLACK_TOWER_FLOORS.find((item) => item.floor === entry.floor + 1);
    if (tower.loop) {
      tower.nextBattleAt = ts + 2000;
    } else if (tower.autoAdvance && nextEntry && state.level >= nextEntry.minLevel) {
      tower.nextBattleAt = ts + 2000;
    } else {
      tower.nextBattleAt = 0;
      if (tower.autoAdvance) tower.autoAdvance = false;
    }
    return { gained, advanced };
  }

  function combatRecoveryRate(state) {
    const maxHp = combatStats(state).maxHp;
    const meditating = Boolean(state.cultivation.meditation && state.cultivation.meditation.active);
    const cultivating = Boolean(state.cultivation.stoneSession && state.cultivation.stoneSession.active);
    const mode = meditating ? "meditation" : cultivating ? "stone" : "idle";
    const ratio = meditating ? 0.003 : cultivating ? 0.002 : 0.0003;
    return {
      mode,
      ratio,
      perSecond: maxHp * ratio,
      maxHp,
    };
  }

  function regenerateCombatHealth(state, seconds) {
    if (!(seconds > 0)) return;
    const battle = state.cultivation && state.cultivation.blackTower && state.cultivation.blackTower.battle;
    if (battle && battle.active) return;
    const recovery = combatRecoveryRate(state);
    const current = Math.max(0, Number(state.cultivation.hp) || 0);
    state.cultivation.hp = Math.min(recovery.maxHp, current + recovery.perSecond * seconds);
  }

  function advanceBlackTowerBattle(state, now, rng) {
    const ts = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, random);
    const tower = state.cultivation.blackTower;
    if (!tower.battle) return { advanced: false };
    if (
      !tower.battle.active &&
      tower.nextBattleAt &&
      ts >= tower.nextBattleAt &&
      (tower.autoAdvance || tower.loop)
    ) {
      const nextFloor = tower.loop
        ? tower.battle.floor
        : Math.min(10, tower.battle.floor + 1);
      const started = startBlackTowerBattle(state, nextFloor, ts, random);
      if (!started.ok) {
        tower.nextBattleAt = 0;
        tower.autoAdvance = false;
        towerLog(tower.battle, ts, "stop", `自动挑战停止：${started.reason}`);
        return { advanced: false, started: false, reason: started.reason };
      }
      return { advanced: true, started: true, floor: nextFloor };
    }
    const battle = tower.battle;
    if (!battle.active || battle.paused) return { advanced: false };
    const steps = Math.min(600, Math.floor(Math.max(0, ts - battle.lastAttackAt) / 1000));
    if (!steps) return { advanced: false };
    const entry = BLACK_TOWER_FLOORS.find((item) => item.floor === battle.floor);
    const player = combatStats(state);
    state.cultivation.hp = clamp(Number(state.cultivation.hp) || 0, 0, player.maxHp);
    battle.lastAttackAt += steps * 1000;

    for (let step = 0; step < steps; step += 1) {
      if (battle.kills < 100 && battle.mobHp <= 0) {
        const foe = towerFoeStats(state, entry, false);
        battle.mobHp = foe.maxHp;
        battle.mobMaxHp = foe.maxHp;
        battle.mobAttack = foe.attack;
      }
      const guardianActive = battle.kills >= 100 && !battle.guardianDefeated;
      if (guardianActive) battle.phase = "guardian";
      const targetHp = guardianActive ? battle.guardianHp : battle.mobHp;
      const targetMax = guardianActive ? battle.guardianMaxHp : battle.mobMaxHp;
      const damage = Math.max(
        1,
        Math.round(player.attack * (0.9 + random() * 0.2) - battle.floor * 1.5)
      );
      const remainingHp = Math.max(0, targetHp - damage);
      if (guardianActive) battle.guardianHp = remainingHp;
      else battle.mobHp = remainingHp;

      if (remainingHp <= 0) {
        if (guardianActive) {
          awardTowerFightExperience(state, battle, entry, true);
          battle.guardianDefeated = true;
          finishBlackTowerFloor(state, ts, entry);
          break;
        }
        awardTowerFightExperience(state, battle, entry, false);
        battle.kills += 1;
        if (
          battle.kills === 1 ||
          battle.kills % 10 === 0 ||
          battle.kills === 70 ||
          battle.kills === 100
        ) {
          towerLog(
            battle,
            ts,
            "kill",
            `击杀进度 ${battle.kills}/100，剩余 ${100 - battle.kills} 只`
          );
        }
        if (battle.kills === 70) {
          battle.guardianSpawned = true;
          towerLog(battle, ts, "guardian", `${entry.enemy}出现在塔层深处`);
        }
        if (battle.kills === 100) {
          battle.phase = "guardian";
          towerLog(battle, ts, "guardian", `${entry.enemy}开始迎战`);
        }
        if (battle.kills < 100) {
          const foe = towerFoeStats(state, entry, false);
          battle.mobHp = foe.maxHp;
          battle.mobMaxHp = foe.maxHp;
          battle.mobAttack = foe.attack;
        }
        continue;
      }

      const enemyAttack = guardianActive ? battle.guardianAttack : battle.mobAttack;
      if (random() < player.blockChance) {
        towerLog(battle, ts, "block", `防御成功，抵挡${guardianActive ? entry.enemy : "小怪"}的攻击`);
      } else if (random() < player.dodgeChance) {
        towerLog(battle, ts, "dodge", `闪避成功，躲开${guardianActive ? entry.enemy : "小怪"}的攻击`);
      } else {
        const hurt = Math.max(1, Math.round(enemyAttack - player.defense * 0.35));
        state.cultivation.hp = Math.max(0, state.cultivation.hp - hurt);
        towerLog(
          battle,
          ts,
          "hit",
          `${guardianActive ? entry.enemy : "小怪"}造成 ${hurt} 点伤害`
        );
        if (state.cultivation.hp / Math.max(1, player.maxHp) < 0.2) {
          state.cultivation.hp = Math.max(1, state.cultivation.hp);
          Object.assign(battle, {
            active: false,
            paused: false,
            phase: "retreated",
          });
          tower.lastResult = {
            floor: battle.floor,
            enemy: entry.enemy,
            outcome: "retreat",
            gained: battle.rewardGained,
            spent: battle.entryCost,
            at: ts,
          };
          tower.autoAdvance = false;
          tower.loop = false;
          tower.nextBattleAt = 0;
          towerLog(battle, ts, "retreat", "生命低于 20%，已自动退出黑塔");
          break;
        }
      }
      if (targetHp / Math.max(1, targetMax) < 0.5 && step === 0) {
        towerLog(battle, ts, "info", `当前目标生命 ${remainingHp}/${targetMax}`);
      }
    }
    return {
      advanced: true,
      phase: battle.phase,
      kills: battle.kills,
      hp: state.cultivation.hp,
    };
  }

  function challengeBlackTower(state, floor, now, rng) {
    return startBlackTowerBattle(state, floor, now, rng);
  }

  function setBlackTowerAutomation(state, patch, now, rng) {
    const ts = now || Date.now();
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, rng);
    const tower = state.cultivation.blackTower;
    if (patch && patch.autoAdvance === true) {
      tower.autoAdvance = true;
      tower.loop = false;
    }
    if (patch && patch.loop === true) {
      tower.loop = true;
      tower.autoAdvance = false;
    }
    if (patch && patch.autoAdvance === false) tower.autoAdvance = false;
    if (patch && patch.loop === false) tower.loop = false;
    if (!tower.autoAdvance && !tower.loop) {
      return { ok: true, autoAdvance: false, loop: false };
    }
    if (tower.battle && tower.battle.active) {
      return { ok: true, autoAdvance: tower.autoAdvance, loop: tower.loop };
    }
    if (tower.battle && tower.battle.phase === "cleared") {
      const nextFloor = tower.loop ? tower.battle.floor : tower.battle.floor + 1;
      const started = startBlackTowerBattle(state, nextFloor, ts, rng);
      return {
        ok: started.ok,
        ...started,
        autoAdvance: tower.autoAdvance,
        loop: tower.loop,
      };
    }
    const started = startBlackTowerBattle(state, tower.selectedFloor, ts, rng);
    return {
      ok: started.ok,
      ...started,
      autoAdvance: tower.autoAdvance,
      loop: tower.loop,
    };
  }

  function toggleBlackTowerPause(state, now) {
    const ts = now || Date.now();
    state.cultivation = C.normalizeCultivation(state.cultivation, ts);
    const battle = state.cultivation.blackTower.battle;
    if (!battle || !battle.active) return { ok: false, reason: "inactive" };
    battle.paused = !battle.paused;
    battle.lastAttackAt = ts;
    towerLog(battle, ts, "info", battle.paused ? "战斗已暂停" : "战斗继续");
    return { ok: true, paused: battle.paused };
  }

  function nextBlackTowerFloor(state, now, rng) {
    const battle = state.cultivation.blackTower.battle;
    if (!battle || battle.phase !== "cleared") return { ok: false, reason: "not-cleared" };
    return startBlackTowerBattle(state, battle.floor + 1, now || Date.now(), rng);
  }

  function cultivationStatus(state, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const spiritualPower = recoverSpiritualPower(state, now || Date.now());
    const combat = combatStats(state);
    const healthRecovery = combatRecoveryRate(state);
    state.cultivation.hp = clamp(Number(state.cultivation.hp) || 0, 0, combat.maxHp);
    const realm = C.realmStatus(state.level);
    const required = C.expRequired(state.level);
    const life = C.lifesStatus(state.cultivation, state.level);
    const boundary = C.isBreakthroughLevel(state.level);
    const exp = boundary
      ? Math.min(required, Number(state.cultivation.exp) || 0)
      : Number(state.cultivation.exp) || 0;
    const breakthroughLevel = C.breakthroughTarget(state.level);
    const nextRealm = realm.nextRealm;
    const selectedStoneTier = C.STONE_TIERS[state.cultivation.selectedStoneTier]
      ? state.cultivation.selectedStoneTier
      : "low";
    const stoneCounts = { ...state.cultivation.stones };
    const totalStones = Object.values(stoneCounts).reduce((sum, count) => sum + count, 0);
    const region = C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0];
    const formation = C.formationById(state.cultivation.formationId);
    const meditation = C.meditationRate(state.cultivation, state.level);
    const stoneRate = C.stoneAbsorptionRate(state.cultivation, state.level);
    const stoneChances = C.stoneBatchChances(state.cultivation);
    const stoneSession = state.cultivation.stoneSession;
    const pillUse = state.cultivation.cultivationPillUse;
    if (Number(pillUse.level) !== state.level) {
      pillUse.level = state.level;
      pillUse.count = 0;
    }
    const stoneElapsed = stoneSession.active
      ? Math.max(0, (now || Date.now()) - stoneSession.startedAt)
      : stoneSession.completedAt
        ? stoneSession.durationMs *
          Math.min(
            1,
            (Number(stoneSession.settledEnergy) || (stoneSession.noProgress ? 0 : stoneSession.totalEnergy)) /
              Math.max(1, stoneSession.totalEnergy)
          )
        : 0;
    const stoneProgress = stoneSession.durationMs ? Math.min(1, stoneElapsed / stoneSession.durationMs) : 0;
    return {
      ...realm,
      exp,
      required,
      progress: state.level >= C.MAX_LEVEL ? 1 : Math.min(1, exp / Math.max(1, required)),
      boundary,
      expFull: required > 0 && exp >= required,
      canCultivate:
        state.level < C.MAX_LEVEL &&
        (!boundary || exp < required) &&
        !stoneSession.active &&
        (stoneCounts[selectedStoneTier] || 0) > 0,
      life,
      breakthroughLevel,
      nextRealm,
      pillName:
        C.PILL_NAMES[
          breakthroughLevel
            ? C.realmStatus(breakthroughLevel).major.id
            : nextRealm
              ? nextRealm.id
              : realm.major.id
        ] || "破境丹",
      permissions: realm.major.permissions.slice(),
      attributes: C.talentSummary(state.cultivation.attributes),
      root: C.ROOTS[state.cultivation.attributes.root] || C.ROOTS.mixed,
      technique: Number(state.cultivation.technique) || 0,
      spiritStones: Number(stoneCounts.low) || 0,
      stoneCounts,
      totalStones,
      selectedStoneTier,
      selectedStone: C.STONE_TIERS[selectedStoneTier],
      stoneRate,
      stoneChances,
      stoneSession: {
        ...stoneSession,
        progress: stoneProgress,
        absorbedEnergy: stoneSession.active
          ? Math.min(stoneSession.totalEnergy, stoneSession.energyPerSecond * (stoneElapsed / 1000))
          : stoneSession.completedAt
            ? Number(stoneSession.settledEnergy) || 0
            : 0,
        remainingMs: stoneSession.active ? Math.max(0, stoneSession.endsAt - (now || Date.now())) : 0,
      },
      buyQuantity: Number(state.cultivation.buyQuantity) || 10,
      consumeQuantity: Number(state.cultivation.consumeQuantity) || 1,
      region,
      continent: C.ORANGE_CONTINENT,
      formation,
      meditation: {
        ...meditation,
        active: Boolean(state.cultivation.meditation && state.cultivation.meditation.active),
        totalSeconds: Number(
          (state.cultivation.meditation && state.cultivation.meditation.totalSeconds) || 0
        ),
      },
      spiritualPower,
      combat: {
        ...combat,
        hp: state.cultivation.hp,
        recoveryPerSecond:
          state.cultivation.blackTower.battle && state.cultivation.blackTower.battle.active
            ? 0
            : healthRecovery.perSecond,
        recoveryMode: healthRecovery.mode,
      },
      herbs: Number(state.cultivation.herbs) || 0,
      breakthroughPills: Number(state.cultivation.pills && state.cultivation.pills.breakthrough) || 0,
      lifePills: Number(state.cultivation.pills && state.cultivation.pills.life) || 0,
      techniquePills: Number(state.cultivation.pills && state.cultivation.pills.technique) || 0,
      cultivationPills: Number(state.cultivation.pills && state.cultivation.pills.cultivation) || 0,
      cultivationPillUse: { ...pillUse, max: 2 },
      heartPills: Number(state.cultivation.pills && state.cultivation.pills.heart) || 0,
      biguPills: Number(state.cultivation.pills && state.cultivation.pills.bigu) || 0,
      fasting: fastingStatus(state, now || Date.now()),
      thunderPearls: Number(state.cultivation.thunderPearls) || 0,
      techniqueReadyAt: Number(state.cultivation.techniqueReadyAt) || 0,
      karma: Number(state.cultivation.karma) || 0,
      demonized: Boolean(state.cultivation.demonized),
      cooldown: Math.max(0, (Number(state.cultivation.cooldownUntil) || 0) - (now || Date.now())),
    };
  }

  function techniqueStatus(state) {
    state.cultivation = C.normalizeCultivation(state.cultivation, Date.now());
    const cultivation = state.cultivation;
    const equippedList = C.activeTechniques(cultivation);
    const equipped = equippedList[0] || null;
    const bonuses = C.techniqueBonuses(cultivation);
    return {
      scrolls: { ...cultivation.techniqueScrolls },
      known: [...cultivation.techniquesKnown],
      progress: { ...cultivation.techniqueProgress },
      equipped,
      equippedId: equipped ? equipped.id : "",
      equippedIds: equippedList.map((technique) => technique.id),
      equippedByCategory: Object.fromEntries(
        equippedList.map((technique) => [technique.category, technique.id])
      ),
      bonuses,
      root: cultivation.attributes.root,
    };
  }

  function syncEquippedTechniques(cultivation, ids) {
    const categories = new Set();
    const selected = [];
    (ids || []).forEach((id) => {
      const technique = C.techniqueById(id);
      if (
        !technique ||
        !cultivation.techniquesKnown.includes(id) ||
        !C.techniqueCompatible(cultivation, id) ||
        categories.has(technique.category)
      ) {
        return;
      }
      categories.add(technique.category);
      selected.push(technique);
    });
    selected.sort(
      (left, right) =>
        Object.keys(C.TECHNIQUE_CATEGORIES).indexOf(left.category) -
        Object.keys(C.TECHNIQUE_CATEGORIES).indexOf(right.category)
    );
    cultivation.equippedTechniques = selected.map((technique) => technique.id);
    cultivation.equippedTechnique = cultivation.equippedTechniques[0] || "";
  }

  function addTechniqueScroll(state, techniqueId, count) {
    state.cultivation = C.normalizeCultivation(state.cultivation, Date.now());
    const technique = C.techniqueById(techniqueId);
    if (!technique) return { ok: false, reason: "technique" };
    const amount = Math.max(1, Math.min(99, Math.round(Number(count) || 1)));
    state.cultivation.techniqueScrolls[technique.id] =
      (Number(state.cultivation.techniqueScrolls[technique.id]) || 0) + amount;
    return { ok: true, technique, count: state.cultivation.techniqueScrolls[technique.id] };
  }

  function studyTechnique(state, techniqueId, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const technique = C.techniqueById(techniqueId);
    if (!technique) return { ok: false, reason: "technique" };
    if (!C.techniqueCompatible(state.cultivation, technique.id)) {
      return { ok: false, reason: "root", requiredRoot: technique.root };
    }
    const count = Number(state.cultivation.techniqueScrolls[technique.id]) || 0;
    if (count <= 0) return { ok: false, reason: "missing" };
    state.cultivation.techniqueScrolls[technique.id] = count - 1;
    const known = state.cultivation.techniquesKnown.includes(technique.id);
    if (known) {
      const gainedMastery = Math.max(1, technique.masteryBonus / 2);
      const gainedProgress = Math.max(1, technique.masteryBonus * 0.18);
      state.cultivation.technique = Math.min(
        C.MAX_TECHNIQUE_MASTERY,
        state.cultivation.technique + gainedMastery
      );
      C.addTechniqueProgress(state.cultivation, technique.id, gainedProgress);
      return {
        ok: true,
        duplicate: true,
        technique,
        gainedMastery,
        gainedProgress,
        progress: C.techniqueProgress(state.cultivation, technique.id),
        dialogue: `再次研读${technique.name}，修炼进度与功法领悟提高`,
      };
    }
    state.cultivation.techniquesKnown.push(technique.id);
    const initialProgress = Math.max(1, Math.min(20, technique.masteryBonus * 0.35));
    C.addTechniqueProgress(state.cultivation, technique.id, initialProgress);
    const equippedByCategory = C.activeTechniques(state.cultivation).some(
      (item) => item.category === technique.category
    );
    if (!equippedByCategory) {
      syncEquippedTechniques(state.cultivation, [...state.cultivation.equippedTechniques, technique.id]);
    }
    state.cultivation.technique = Math.min(
      C.MAX_TECHNIQUE_MASTERY,
      state.cultivation.technique + technique.masteryBonus
    );
    return {
      ok: true,
      duplicate: false,
      technique,
      gainedMastery: technique.masteryBonus,
      gainedProgress: initialProgress,
      progress: C.techniqueProgress(state.cultivation, technique.id),
      dialogue: equippedByCategory
        ? `学会了${technique.name}，可在背包中替换${technique.categoryName}功法`
        : `学会并开始修炼${technique.name}`,
    };
  }

  function equipTechnique(state, techniqueId, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const technique = C.techniqueById(techniqueId);
    if (!technique) return { ok: false, reason: "technique" };
    if (!state.cultivation.techniquesKnown.includes(techniqueId)) {
      return { ok: false, reason: "missing" };
    }
    if (!C.techniqueCompatible(state.cultivation, technique.id)) {
      return { ok: false, reason: "root" };
    }
    const active = C.activeTechniques(state.cultivation)
      .filter((item) => item.category !== technique.category)
      .map((item) => item.id);
    syncEquippedTechniques(state.cultivation, [...active, technique.id]);
    return {
      ok: true,
      technique,
      equippedIds: [...state.cultivation.equippedTechniques],
    };
  }

  function unequipTechnique(state, techniqueId, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    if (!state.cultivation.techniquesKnown.includes(techniqueId)) {
      return { ok: false, reason: "missing" };
    }
    syncEquippedTechniques(
      state.cultivation,
      state.cultivation.equippedTechniques.filter((id) => id !== techniqueId)
    );
    return {
      ok: true,
      equippedIds: [...state.cultivation.equippedTechniques],
    };
  }

  function buySpiritStones(state, count, tierId) {
    state.cultivation = C.normalizeCultivation(state.cultivation, Date.now());
    const amount = Math.max(1, Math.min(9999, Math.floor(Number(count) || 1)));
    const tier =
      C.STONE_TIERS[tierId] || C.STONE_TIERS[state.cultivation.selectedStoneTier] || C.STONE_TIERS.low;
    if (state.level >= C.MAX_LEVEL) return { ok: false, reason: "max-level", amount };
    const item = SHOP_ITEMS[`stone_${tier.id}`];
    const result = purchaseMany(state, item, amount, Date.now());
    if (!result.ok) {
      return { ok: false, reason: result.reason, cost: result.total, amount };
    }
    return {
      ok: true,
      cost: result.total,
      amount,
      tier: tier.id,
      total: state.cultivation.stones[tier.id],
    };
  }

  /**
   * 开始一次灵石批量修炼。点击只创建一次吸收会话，不按灵石颗数循环结算。
   * 灵石在开始时一次性扣除，完成时再统一判定一次无进展、顿悟与区域反噬。
   */
  function cultivate(state, times, now, rng, tierId) {
    const requested = Math.max(1, Math.min(9999, Math.floor(Number(times) || 1)));
    const startedAt = now || Date.now();
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, rng);
    if (state.cultivation.stoneSession.active) {
      return {
        ok: false,
        reason: "session",
        session: { ...state.cultivation.stoneSession },
      };
    }
    if (state.level >= C.MAX_LEVEL) {
      return { ok: false, reason: "max-level", used: 0, gained: 0, levelsGained: 0 };
    }
    if (C.isBreakthroughLevel(state.level) && state.cultivation.exp >= C.expRequired(state.level)) {
      return { ok: false, reason: "breakthrough", used: 0, gained: 0, levelsGained: 0 };
    }
    const tier =
      C.STONE_TIERS[tierId] || C.STONE_TIERS[state.cultivation.selectedStoneTier] || C.STONE_TIERS.low;
    const available = Math.floor(Number(state.cultivation.stones[tier.id]) || 0);
    if (available <= 0) return { ok: false, reason: "stones", used: 0, gained: 0, levelsGained: 0 };
    if (available < requested) {
      return {
        ok: false,
        reason: "stones",
        required: requested,
        available,
        used: 0,
        gained: 0,
        levelsGained: 0,
      };
    }
    settleMeditation(state, startedAt);
    if (
      state.cultivation.stoneSession.active ||
      state.level >= C.MAX_LEVEL ||
      (C.isBreakthroughLevel(state.level) && state.cultivation.exp >= C.expRequired(state.level))
    ) {
      return { ok: false, reason: "breakthrough", used: 0, gained: 0, levelsGained: 0 };
    }
    const used = requested;
    const totalEnergy = used * tier.energy;
    const rate = C.stoneAbsorptionRate(state.cultivation, state.level);
    const durationMs = Math.max(1000, Math.ceil((totalEnergy / rate.perSecond) * 1000));
    state.cultivation.stones[tier.id] -= used;
    if (tier.id === "low") {
      state.cultivation.spiritStones = state.cultivation.stones.low;
    }
    state.cultivation.meditation.active = false;
    state.cultivation.meditation.lastAt = startedAt;
    state.cultivation.stoneSession = {
      active: true,
      startedAt,
      endsAt: startedAt + durationMs,
      completedAt: 0,
      quantity: used,
      tier: tier.id,
      totalEnergy,
      energyPerSecond: rate.perSecond,
      durationMs,
      gained: 0,
      levelsGained: 0,
      noProgress: false,
      epiphany: false,
      damaged: 0,
      techniqueGain: 0,
    };
    state.lastTick = startedAt;
    return {
      ok: true,
      started: true,
      used,
      quantity: used,
      tier: tier.id,
      totalEnergy,
      energyPerSecond: rate.perSecond,
      durationMs,
      endsAt: startedAt + durationMs,
      gained: 0,
      levelsGained: 0,
      noProgress: 0,
      epiphanies: 0,
      damaged: 0,
      rate,
      region: C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0],
      reason: used < requested ? "stones" : "",
      dialogue: `开始炼化${used}颗${tier.short}，总能量 ${totalEnergy}`,
    };
  }

  /**
   * 到点后统一结算一次批量修炼；重复调用不会重复加修为。
   * finishEarly=true 时按已炼化时间占比结算，主动结束时也能拿到已经吸收的部分。
   */
  function settleStoneCultivation(state, now, rng, finishEarly) {
    const ts = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, random);
    const session = state.cultivation.stoneSession;
    if (!session.active) {
      return {
        active: false,
        completed: false,
        gained: 0,
        progress: session.completedAt ? 1 : 0,
      };
    }
    if (ts < session.endsAt && finishEarly !== true) {
      return {
        active: true,
        completed: false,
        gained: 0,
        remainingMs: session.endsAt - ts,
        progress: Math.min(1, Math.max(0, (ts - session.startedAt) / session.durationMs)),
      };
    }

    const elapsedRatio = session.durationMs
      ? Math.min(1, Math.max(0, (ts - session.startedAt) / session.durationMs))
      : 1;
    const endedEarly = finishEarly === true && ts < session.endsAt;
    const settledEnergy = Math.max(0, Math.min(session.totalEnergy, session.totalEnergy * elapsedRatio));
    const startLevel = state.level;
    const tier = C.STONE_TIERS[session.tier] || C.STONE_TIERS.low;
    const attrs = C.talentSummary(state.cultivation.attributes);
    const root = C.ROOTS[attrs.root] || C.ROOTS.mixed;
    const region = C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0];
    const techniqueBonus = C.techniqueBonuses(state.cultivation);
    const caveBonus = C.caveBonuses(state.cultivation);
    const chances = C.stoneBatchChances(state.cultivation);
    const noProgress = random() < chances.noProgress;
    let gained = 0;
    let epiphany = false;
    let damaged = 0;
    let techniqueGain = 0;

    if (!noProgress) {
      const insightFactor = 0.65 + attrs.insight * 0.0085;
      const qualityFactor = 0.6 + random() * 0.4;
      const randomFactor = 0.8 + random() * 0.55;
      const lineageFactor = 1 + attrs.rootLineage * 0.15;
      const demonFactor = state.cultivation.demonized ? 1.25 : 1;
      epiphany = random() < chances.epiphany;
      const absorptionRate = epiphany
        ? 1
        : Math.min(
            1,
            qualityFactor *
              root.gain *
              insightFactor *
              demonFactor *
              randomFactor *
              lineageFactor *
              region.qi *
              techniqueBonus.cultivationMultiplier *
              caveBonus.expMultiplier
          );
      gained = Math.max(0, Math.round(settledEnergy * absorptionRate));
      if (epiphany) {
        state.cultivation.epiphanyCount = (Number(state.cultivation.epiphanyCount) || 0) + 1;
      }
      techniqueGain =
        0.15 +
        attrs.insight * 0.002 +
        techniqueBonus.masteryBonus * 0.04 +
        Math.log2(Math.max(1, session.quantity)) * 0.04 +
        (epiphany ? 1 : 0);
      state.cultivation.technique = Math.min(
        C.MAX_TECHNIQUE_MASTERY,
        (Number(state.cultivation.technique) || 0) + techniqueGain
      );
      C.advanceEquippedTechniques(
        state.cultivation,
        (0.06 + attrs.insight * 0.0008 + (epiphany ? 0.35 : 0)) * caveBonus.techniqueMultiplier
      );
      const advanced = C.addExperience(state.cultivation, state.level, gained);
      state.level = advanced.level;
      if (region.damageRate > 0 && random() < chances.damage) {
        damaged = Math.round(C.expRequired(startLevel) * 0.02);
        state.cultivation.exp = Math.max(0, state.cultivation.exp - damaged);
      }
    }

    const levelsGained = Math.max(0, state.level - startLevel);
    state.stats.upgrades += levelsGained;
    Object.assign(session, {
      active: false,
      completedAt: ts,
      endedEarly,
      settledEnergy,
      gained,
      levelsGained,
      noProgress,
      epiphany,
      damaged,
      techniqueGain,
    });
    const stoppedAtBreakthrough =
      state.level < C.MAX_LEVEL &&
      C.isBreakthroughLevel(state.level) &&
      state.cultivation.exp >= C.expRequired(state.level);
    return {
      active: false,
      completed: true,
      progress: elapsedRatio,
      used: session.quantity,
      totalEnergy: session.totalEnergy,
      settledEnergy,
      endedEarly,
      gained,
      levelsGained,
      noProgress,
      epiphanies: epiphany ? 1 : 0,
      epiphany,
      damaged,
      techniqueGain,
      tier: tier.id,
      region,
      stoppedAtBreakthrough,
      dialogue: noProgress
        ? `${endedEarly ? "提前结束修炼，" : ""}${session.quantity}颗${tier.short}化作飞灰，这次毫无进展……`
        : `${endedEarly ? "提前结束修炼，" : ""}${session.quantity}颗${tier.short}炼化${endedEarly ? "了一部分" : "完成"}，修为 +${gained}${
            levelsGained ? `，晋升 ${levelsGained} 级` : ""
          }${damaged ? `，受损 ${damaged}` : ""}`,
    };
  }

  function endStoneCultivation(state, now, rng) {
    return settleStoneCultivation(state, now || Date.now(), rng, true);
  }

  function nextCultivationRealm(state) {
    const realm = C.realmStatus(state.level);
    return realm.nextRealm || null;
  }

  function purchaseCultivationItem(state, type, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const targetRealm = nextCultivationRealm(state);
    if (!targetRealm) return { ok: false, reason: "max-level" };
    const itemId = {
      breakthrough: "breakthrough_pill",
      life: "life_pill",
      thunder: "thunder_pearl",
    }[type];
    const item = SHOP_ITEMS[itemId];
    if (!item) return { ok: false, reason: "item" };
    const result = purchase(state, item, now || Date.now());
    if (!result.ok) return { ...result, cost: result.price };
    return {
      ok: true,
      cost: result.price,
      amount: result.cultivationCount,
      label: type === "breakthrough" ? C.PILL_NAMES[targetRealm.id] || "破境丹" : item.name,
    };
  }

  function takeLifePill(state) {
    state.cultivation = C.normalizeCultivation(state.cultivation, Date.now());
    if (!state.cultivation.pills || state.cultivation.pills.life <= 0) {
      return { ok: false, reason: "item" };
    }
    state.cultivation.pills.life -= 1;
    state.cultivation.bonusLifespan += 100;
    return {
      ok: true,
      gained: 100,
      max: C.lifesStatus(state.cultivation, state.level).max,
    };
  }

  function takeCultivationPill(state, pillId, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    const id = ["technique", "cultivation", "heart", "bigu"].includes(pillId) ? pillId : "";
    if (!id || (Number(state.cultivation.pills[id]) || 0) <= 0) {
      return { ok: false, reason: "item" };
    }
    if (id === "bigu" && state.level >= 41) {
      return { ok: false, reason: "nascent", dialogue: "元婴期已无需辟谷丹" };
    }
    if (id === "technique") {
      const known = state.cultivation.techniquesKnown
        .map((techniqueId) => C.techniqueById(techniqueId))
        .filter(Boolean);
      if (!known.length) return { ok: false, reason: "technique" };
      const target = known[Math.floor(random() * known.length) % known.length];
      const gained = Math.round((8 + random() * 10) * 10) / 10;
      C.addTechniqueProgress(state.cultivation, target.id, gained);
      state.cultivation.pills.technique -= 1;
      return {
        ok: true,
        type: id,
        pill: C.CULTIVATION_PILLS.technique,
        technique: target,
        gained,
        progress: C.techniqueProgress(state.cultivation, target.id),
        dialogue: `服下悟道丹，${target.name}修炼进度 +${gained}`,
      };
    }
    if (id === "cultivation") {
      const use = state.cultivation.cultivationPillUse || { level: state.level, count: 0 };
      if (Number(use.level) !== state.level) {
        use.level = state.level;
        use.count = 0;
      }
      if (Number(use.count) >= 2) {
        return {
          ok: false,
          reason: "stage-limit",
          limit: 2,
          used: Number(use.count),
          level: state.level,
          dialogue: "当前小阶段已经服用过 2 颗培元丹",
        };
      }
      const ratio = 0.08 + random() * 0.08;
      const gained = Math.round(C.expRequired(state.level) * ratio);
      const advanced = C.addExperience(state.cultivation, state.level, gained);
      state.level = advanced.level;
      state.cultivation.pills.cultivation -= 1;
      use.count += 1;
      state.cultivation.cultivationPillUse = use;
      return {
        ok: true,
        type: id,
        pill: C.CULTIVATION_PILLS.cultivation,
        gained,
        levelsGained: advanced.levelsGained,
        used: use.count,
        limit: 2,
        dialogue: `服下培元丹，修为 +${Math.round(gained)}`,
      };
    }
    if (id === "bigu") {
      const before = Math.max(startedAt, Number(state.cultivation.biguUntil) || 0);
      state.cultivation.biguUntil = before + C.DAY_MS;
      state.cultivation.pills.bigu -= 1;
      return {
        ok: true,
        type: id,
        pill: C.CULTIVATION_PILLS.bigu,
        gainedMs: C.DAY_MS,
        until: state.cultivation.biguUntil,
        dialogue: "服下辟谷丹，一日之内无需进食",
      };
    }
    const gained = 2 + Math.floor(random() * 4);
    state.cultivation.attributes.daoHeart = Math.min(
      C.MAX_ATTRIBUTE,
      (Number(state.cultivation.attributes.daoHeart) || 0) + gained
    );
    state.cultivation.pills.heart -= 1;
    return {
      ok: true,
      type: id,
      pill: C.CULTIVATION_PILLS.heart,
      gained,
      dialogue: `服下静心丹，道心 +${gained}`,
    };
  }

  function attemptBreakthrough(state, route, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    const status = C.breakthroughStatus(state.cultivation, state.level, route, startedAt);
    if (!status.ok) {
      return {
        ok: false,
        reason: status.reason || "requirements",
        missing: status.missing || [],
        status,
        dialogue: (status.missing && status.missing[0]) || "当前无法突破",
      };
    }
    const previousLevel = state.level;
    if (status.route === "pill") {
      state.cultivation.pills.breakthrough -= 1;
    }
    if (status.tribulation.event === "tribulation" && state.cultivation.thunderPearls > 0) {
      state.cultivation.thunderPearls -= 1;
    }
    const roll = random();
    if (roll <= status.chance) {
      state.level = status.targetLevel;
      state.cultivation.exp = 0;
      state.cultivation.technique = Math.min(
        C.MAX_TECHNIQUE_MASTERY,
        state.cultivation.technique + 0.5
      );
      state.cultivation.cooldownUntil = 0;
      state.cultivation.lastBreakthrough = {
        level: state.level,
        at: startedAt,
        chance: status.chance,
        route: status.route,
      };
      state.lastTick = startedAt;
      return {
        ok: true,
        previousLevel,
        level: state.level,
        chance: status.chance,
        event: status.tribulation.event,
        title: C.realmStatus(state.level).fullName,
        dialogue: `破境成功！踏入${C.realmStatus(state.level).fullName}`,
      };
    }
    const fortuneRelief = Math.floor(status.attributes.fortune / 22);
    const damage =
      8 +
      (status.route === "mind" ? 7 : 0) +
      (status.tribulation.event === "tribulation" ? 3 : 0) -
      fortuneRelief;
    state.cultivation.attributes.daoHeart = Math.max(
      0,
      state.cultivation.attributes.daoHeart - Math.max(2, damage)
    );
    state.cultivation.exp = Math.floor(state.cultivation.exp * 0.5);
    state.cultivation.technique = Math.max(0, state.cultivation.technique - 1);
    state.cultivation.cooldownUntil = startedAt + C.MAJOR_BREAKTHROUGH_COOLDOWN_MS;
    state.cultivation.karma += status.tribulation.event === "tribulation" ? 1 : 0;
    const becameDemon = state.cultivation.attributes.daoHeart <= 0;
    if (becameDemon) state.cultivation.demonized = true;
    state.lastTick = startedAt;
    return {
      ok: false,
      reason: "failed",
      chance: status.chance,
      level: state.level,
      lostExperience: true,
      cooldownUntil: state.cultivation.cooldownUntil,
      becameDemon,
      dialogue: becameDemon
        ? "道心崩坏，魔念入体……你踏入了魔修分支"
        : "突破失败，修为倒退，道心受创，需调息后再试",
    };
  }

  function collectHerbs(state, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    if (state.level < 11) return { ok: false, reason: "realm", requiredLevel: 11 };
    if (state.cultivation.herbReadyAt > startedAt) {
      return { ok: false, reason: "cooldown", readyAt: state.cultivation.herbReadyAt };
    }
    const fortune = state.cultivation.attributes.fortune;
    const region = C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0];
    const amount = Math.max(1, Math.round((1 + fortune / 45 + random() * 2) * (1 + region.herbBonus)));
    state.cultivation.herbs += amount;
    state.cultivation.herbReadyAt = startedAt + 5 * 60000;
    let pill = "";
    if (random() < 0.025 + fortune * 0.001 + Math.max(0, region.stoneBonus) * 0.05) {
      state.cultivation.pills.breakthrough += 1;
      pill = nextCultivationRealm(state)
        ? C.PILL_NAMES[nextCultivationRealm(state).id] || "破境丹"
        : "破境丹";
    }
    return {
      ok: true,
      herbs: amount,
      pill,
      readyAt: state.cultivation.herbReadyAt,
      region: region.id,
      dialogue: pill
        ? `在${region.name}采到 ${amount} 株灵药，还发现了${pill}`
        : `在${region.name}采到 ${amount} 株灵药`,
    };
  }

  function comprehendTechnique(state, now, rng, techniqueId) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    if (state.level < 11) {
      return { ok: false, reason: "realm", requiredLevel: 11 };
    }
    const request = C.techniqueById(techniqueId);
    const target =
      request && state.cultivation.techniquesKnown.includes(request.id)
        ? request
        : C.activeTechniques(state.cultivation)
            .map((technique) => ({
              technique,
              progress: C.techniqueProgress(state.cultivation, technique.id),
            }))
            .sort((left, right) => left.progress - right.progress)[0]?.technique ||
          C.techniqueById(state.cultivation.techniquesKnown[0]);
    if (!target) return { ok: false, reason: "missing" };
    if (state.cultivation.techniqueReadyAt > startedAt) {
      return {
        ok: false,
        reason: "cooldown",
        readyAt: state.cultivation.techniqueReadyAt,
      };
    }
    state.cultivation.techniqueReadyAt = startedAt + 5 * 60000;
    const attrs = state.cultivation.attributes;
    const formation = C.formationById(state.cultivation.formationId);
    const region = C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0];
    const successChance = Math.max(
      0.45,
      Math.min(0.95, 0.55 + attrs.insight * 0.003 + attrs.fortune * 0.0008)
    );
    if (random() > successChance) {
      return {
        ok: false,
        reason: "failed",
        chance: successChance,
        dialogue: "功法运转晦涩，这次参悟没有收获",
      };
    }
    const epiphany =
      random() < Math.max(0.02, Math.min(0.2, 0.03 + attrs.insight * 0.001 + attrs.fortune * 0.0005));
    let gained = Math.max(
      0.1,
      Math.round(
        (1 + attrs.insight / 20) *
          (1 + Math.max(0, formation.multiplier - 1) * 0.12) *
          Math.sqrt(region.qi) *
          (0.8 + random() * 0.4) *
          (epiphany ? 2 : 1) *
          10
      ) / 10
    );
    gained = Math.min(gained, Math.max(0, C.MAX_TECHNIQUE_MASTERY - state.cultivation.technique));
    state.cultivation.technique += gained;
    const gainedProgress = Math.max(0.5, Math.round(Math.max(1, gained * 0.8) * 10) / 10);
    C.addTechniqueProgress(state.cultivation, target.id, gainedProgress);
    return {
      ok: true,
      gained,
      gainedProgress,
      epiphany,
      successChance,
      technique: state.cultivation.technique,
      techniqueItem: target,
      techniqueProgress: C.techniqueProgress(state.cultivation, target.id),
      readyAt: state.cultivation.techniqueReadyAt,
      dialogue: epiphany
        ? `顿悟${target.name}真意，修炼进度 +${gainedProgress}`
        : `${target.name}参悟完成，修炼进度 +${gainedProgress}`,
    };
  }

  function mineSpiritStones(state, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    if (state.level < 11) return { ok: false, reason: "realm", requiredLevel: 11 };
    if (state.cultivation.mineReadyAt > startedAt) {
      return { ok: false, reason: "cooldown", readyAt: state.cultivation.mineReadyAt };
    }
    const region = C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0];
    const fortune = state.cultivation.attributes.fortune;
    const amount = Math.max(1, Math.round(1 + fortune / 45 + region.stoneBonus * 2 + random() * 2));
    const tierRoll = random() + region.stoneBonus + Math.min(0.2, state.level / 500);
    const tier = tierRoll >= 1.05 ? "supreme" : tierRoll >= 0.75 ? "high" : tierRoll >= 0.4 ? "mid" : "low";
    state.cultivation.stones[tier] += amount;
    state.cultivation.spiritStones = state.cultivation.stones.low;
    state.cultivation.mineReadyAt = startedAt + 5 * 60000;
    return {
      ok: true,
      amount,
      tier,
      tierName: C.STONE_TIERS[tier].name,
      region,
      readyAt: state.cultivation.mineReadyAt,
      dialogue: `在${region.name}采得 ${amount} 枚${C.STONE_TIERS[tier].name}`,
    };
  }

  function craftPill(state, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    if (state.level < 21) return { ok: false, reason: "realm", requiredLevel: 21 };
    if (state.cultivation.alchemyReadyAt > startedAt) {
      return { ok: false, reason: "cooldown", readyAt: state.cultivation.alchemyReadyAt };
    }
    if (state.cultivation.herbs < 3) return { ok: false, reason: "herbs", required: 3 };
    state.cultivation.herbs -= 3;
    state.cultivation.alchemyReadyAt = startedAt + 10 * 60000;
    const chance = Math.min(
      0.92,
      0.45 + state.cultivation.attributes.insight * 0.0025 + state.cultivation.attributes.fortune * 0.0012
    );
    if (random() > chance) {
      return { ok: false, reason: "failed", chance, dialogue: "丹炉炸响，三株灵药化为灰烬" };
    }
    const life = random() < 0.24;
    if (life) state.cultivation.pills.life += 1;
    else state.cultivation.pills.breakthrough += 1;
    return {
      ok: true,
      item: life ? "life" : "breakthrough",
      label: life ? "延寿丹" : "破境丹",
      chance,
      dialogue: life ? "丹成！炼出一枚延寿丹" : "丹成！炼出一枚破境丹",
    };
  }

  function rollTechniqueReward(state, region, rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const tierRoll = random() + Math.min(0.25, state.level / 1000) + Math.max(0, region.stoneBonus) * 0.25;
    const tier =
      tierRoll >= 1.08
        ? C.TECHNIQUE_TIERS[3]
        : tierRoll >= 0.82
          ? C.TECHNIQUE_TIERS[2]
          : tierRoll >= 0.5
            ? C.TECHNIQUE_TIERS[1]
            : C.TECHNIQUE_TIERS[0];
    const gradeRoll = random();
    const grade =
      gradeRoll >= 0.82
        ? C.TECHNIQUE_GRADES[2]
        : gradeRoll >= 0.45
          ? C.TECHNIQUE_GRADES[1]
          : C.TECHNIQUE_GRADES[0];
    const technique = C.TECHNIQUES[`tech_${state.cultivation.attributes.root}_${tier.id}_${grade.id}`];
    if (!technique) return null;
    addTechniqueScroll(state, technique.id, 1);
    return technique;
  }

  function exploreSecretRealm(state, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    if (state.level < 31) return { ok: false, reason: "realm", requiredLevel: 31 };
    if (state.cultivation.secretReadyAt > startedAt) {
      return { ok: false, reason: "cooldown", readyAt: state.cultivation.secretReadyAt };
    }
    if (state.cultivation.stones.low < 1) return { ok: false, reason: "stones" };
    state.cultivation.stones.low -= 1;
    state.cultivation.spiritStones = state.cultivation.stones.low;
    state.cultivation.secretReadyAt = startedAt + 30 * 60000;
    const fortune = state.cultivation.attributes.fortune;
    const region = C.regionById(state.cultivation.regionId) || C.ORANGE_REGIONS[0];
    const trapChance = Math.max(0.05, Math.min(0.35, 0.3 - fortune * 0.0018 + region.damageRate));
    if (random() < trapChance) {
      state.cultivation.karma += 1;
      return { ok: false, reason: "trap", karma: state.cultivation.karma, dialogue: "误触禁制，沾上因果" };
    }
    const gained = C.cultivateOnce(state.cultivation, state.level, random, "low").gained * 3 * region.qi;
    const advanced = C.addExperience(state.cultivation, state.level, gained);
    state.level = advanced.level;
    let pill = "";
    if (random() < 0.12 + fortune * 0.0015 + Math.max(0, region.stoneBonus) * 0.1) {
      state.cultivation.pills.breakthrough += 1;
      pill = nextCultivationRealm(state)
        ? C.PILL_NAMES[nextCultivationRealm(state).id] || "破境丹"
        : "破境丹";
    }
    let technique = null;
    const techniqueChance = Math.min(0.55, 0.15 + fortune * 0.0015 + Math.max(0, region.stoneBonus) * 0.1);
    if (random() < techniqueChance) {
      technique = rollTechniqueReward(state, region, random);
    }
    return {
      ok: true,
      gained,
      levelsGained: advanced.levelsGained,
      pill,
      technique,
      region: region.id,
      dialogue: `在${region.name}秘境探索，修为 +${Math.round(gained)}${
        pill ? `，并寻得${pill}` : ""
      }${technique ? `，发现功法「${technique.name}」` : ""}`,
    };
  }

  const CAVE_REFRESH_MS = 2 * 60 * 60 * 1000;
  const CAVE_DURATION_MS = 30 * 60 * 1000;

  function generateCaveSpots(random) {
    const largeCount = 1 + Math.floor(random() * 3);
    const shuffled = C.CAVE_HEAVENS.map((_, index) => index);
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    const largeIds = new Set(shuffled.slice(0, largeCount).map((index) => C.CAVE_HEAVENS[index].id));
    return C.CAVE_HEAVENS.map((cave) => {
      const large = largeIds.has(cave.id);
      const effectIds = Object.keys(C.CAVE_EFFECTS);
      const effectType = effectIds[Math.floor(random() * effectIds.length) % effectIds.length];
      const effectValue =
        effectType === "breakthrough"
          ? Math.round((large ? 0.05 + random() * 0.07 : 0.02 + random() * 0.03) * 1000) / 1000
          : Math.round((large ? 0.45 + random() * 0.8 : 0.15 + random() * 0.35) * 100) / 100;
      return {
        id: cave.id,
        name: cave.name,
        icon: cave.icon,
        desc: cave.desc,
        size: large ? "large" : "small",
        qiMultiplier: Math.round((large ? 1.8 + random() * 1.2 : 1.15 + random() * 0.6) * 100) / 100,
        effectType,
        effectName: C.CAVE_EFFECTS[effectType].name,
        effectValue,
      };
    });
  }

  function ensureCaveHeavens(state, now, rng) {
    const ts = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, random);
    const cave = state.cultivation.cave;
    if (cave.active && cave.active.expiresAt <= ts) cave.active = null;
    if (!cave.spots || cave.spots.length !== C.CAVE_HEAVENS.length || cave.refreshAt <= ts) {
      cave.spots = generateCaveSpots(random);
      cave.refreshAt = ts + CAVE_REFRESH_MS;
    }
    return cave;
  }

  function caveHeavenStatus(state, now, rng) {
    const ts = now || Date.now();
    const cave = ensureCaveHeavens(state, ts, rng);
    return {
      spots: cave.spots.map((spot) => {
        const base = C.CAVE_HEAVENS.find((item) => item.id === spot.id);
        return {
          ...spot,
          ...base,
          effectName: C.CAVE_EFFECTS[spot.effectType].name,
        };
      }),
      active: cave.active
        ? {
            ...cave.active,
            ...C.CAVE_HEAVENS.find((item) => item.id === cave.active.id),
            effectName: C.CAVE_EFFECTS[cave.active.effectType].name,
            remainingMs: Math.max(0, cave.active.expiresAt - ts),
          }
        : null,
      challenge: cave.challenge
        ? {
            ...cave.challenge,
            ...C.CAVE_HEAVENS.find((item) => item.id === cave.challenge.id),
            effectName: C.CAVE_EFFECTS[cave.challenge.effectType].name,
          }
        : null,
      refreshAt: cave.refreshAt,
      visits: cave.visits,
      lastLoot: cave.lastLoot,
      largeCount: cave.spots.filter((spot) => spot.size === "large").length,
    };
  }

  function activateCaveSpot(cave, spot, ts) {
    cave.active = {
      id: spot.id,
      size: spot.size,
      qiMultiplier: spot.qiMultiplier,
      effectType: spot.effectType,
      effectValue: spot.effectValue,
      enteredAt: ts,
      expiresAt: ts + CAVE_DURATION_MS,
    };
    cave.visits += 1;
    return cave.active;
  }

  function caveEntryCost(spot) {
    const tier = spot && spot.size === "large" ? "supreme" : "low";
    return {
      tier,
      amount: tier === "supreme" ? 3 : 10,
      stone: C.STONE_TIERS[tier],
    };
  }

  function grantCaveLoot(state, spot, random, lootMultiplier) {
    const rewards = [];
    const techniqueChance = Math.min(1, 0.8 * lootMultiplier);
    const pillChance = Math.min(1, 0.8 * lootMultiplier);
    if (spot.size === "large") {
      if (random() < techniqueChance) {
        const candidates = Object.values(C.TECHNIQUES).filter((technique) =>
          C.techniqueCompatible(state.cultivation, technique.id)
        );
        const technique = candidates[Math.floor(random() * candidates.length) % candidates.length];
        if (technique) {
          state.cultivation.techniqueScrolls[technique.id] =
            (Number(state.cultivation.techniqueScrolls[technique.id]) || 0) + 1;
          rewards.push({ type: "technique", item: technique });
        }
      }
      if (random() < pillChance) {
        const pillIds = Object.keys(C.CULTIVATION_PILLS);
        const pillId = pillIds[Math.floor(random() * pillIds.length) % pillIds.length];
        state.cultivation.pills[pillId] = (Number(state.cultivation.pills[pillId]) || 0) + 1;
        rewards.push({ type: "pill", item: C.CULTIVATION_PILLS[pillId] });
      }
    } else if (random() < Math.min(1, 1.2 * lootMultiplier)) {
      if (random() < 0.5) {
        const candidates = Object.values(C.TECHNIQUES).filter((technique) =>
          C.techniqueCompatible(state.cultivation, technique.id)
        );
        const technique = candidates[Math.floor(random() * candidates.length) % candidates.length];
        if (technique) {
          state.cultivation.techniqueScrolls[technique.id] =
            (Number(state.cultivation.techniqueScrolls[technique.id]) || 0) + 1;
          rewards.push({ type: "technique", item: technique });
        }
      } else {
        const pillIds = Object.keys(C.CULTIVATION_PILLS);
        const pillId = pillIds[Math.floor(random() * pillIds.length) % pillIds.length];
        state.cultivation.pills[pillId] = (Number(state.cultivation.pills[pillId]) || 0) + 1;
        rewards.push({ type: "pill", item: C.CULTIVATION_PILLS[pillId] });
      }
    }
    if (!rewards.length) rewards.push({ type: "none", item: { name: "空手而归" } });
    return rewards;
  }

  function enterCaveHeaven(state, spotId, now, rng) {
    const ts = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, random);
    if (state.level < 11) return { ok: false, reason: "realm", requiredLevel: 11 };
    const cave = ensureCaveHeavens(state, ts, random);
    if (cave.active && cave.active.expiresAt > ts) {
      return { ok: false, reason: "active", active: cave.active };
    }
    if (cave.challenge) return { ok: false, reason: "challenge", challenge: cave.challenge };
    const spot = cave.spots.find((item) => item.id === spotId);
    if (!spot) return { ok: false, reason: "spot" };
    const entryCost = caveEntryCost(spot);
    const available = Number(state.cultivation.stones[entryCost.tier]) || 0;
    if (available < entryCost.amount) {
      return {
        ok: false,
        reason: "stones",
        tier: entryCost.tier,
        required: entryCost.amount,
        available,
        stone: entryCost.stone,
      };
    }
    state.cultivation.stones[entryCost.tier] -= entryCost.amount;
    if (entryCost.tier === "low") {
      state.cultivation.spiritStones = state.cultivation.stones.low;
    }
    const base = C.CAVE_HEAVENS.find((item) => item.id === spot.id);
    // 大型福地有 75% 概率遭遇守灵，必须先做选择。
    if (spot.size === "large" && random() < 0.75) {
      const guardian =
        C.CAVE_GUARDIANS[Math.floor(random() * C.CAVE_GUARDIANS.length) % C.CAVE_GUARDIANS.length];
      cave.challenge = {
        id: spot.id,
        size: "large",
        qiMultiplier: spot.qiMultiplier,
        effectType: spot.effectType,
        effectValue: spot.effectValue,
        guardian,
        createdAt: ts,
      };
      return {
        ok: true,
        challenge: true,
        entryCost,
        spot: { ...spot, ...base },
        event: {
          title: `${base.name}的守灵`,
          text: `大型福地深处盘踞着${guardian}。它的气息与这片天地相连，似乎正等你作出回应。`,
        },
        dialogue: `进入${base.name}时遭遇${guardian}`,
      };
    }
    const active = activateCaveSpot(cave, spot, ts);
    const rewards = grantCaveLoot(state, spot, random, 1);
    cave.lastLoot = {
      techniqueName: rewards.find((reward) => reward.type === "technique")?.item.name || "",
      pillName: rewards.find((reward) => reward.type === "pill")?.item.name || "",
      at: ts,
    };
    return {
      ok: true,
      challenge: false,
      entryCost,
      spot: { ...spot, ...base },
      active,
      rewards,
      dialogue: `进入${base.name}（${spot.size === "large" ? "大型福地" : "小型福地"}）`,
    };
  }

  function resolveCaveChallenge(state, choice, now, rng) {
    const ts = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, ts, random);
    const cave = state.cultivation.cave;
    const challenge = cave.challenge;
    if (!challenge) return { ok: false, reason: "no-challenge" };
    const type = ["avoid", "observe", "fight"].includes(choice) ? choice : "";
    if (!type) return { ok: false, reason: "choice" };
    const lootMultiplier = type === "avoid" ? 0.2 : type === "observe" ? 0.5 : 1.2;
    const spot = challenge;
    const active = activateCaveSpot(cave, spot, ts);
    cave.challenge = null;
    let combat = null;
    if (type === "fight") {
      const combatTechniques = C.activeTechniques(state.cultivation).filter(
        (technique) => technique.category === "combat"
      );
      const combatProgress = combatTechniques.reduce(
        (sum, technique) => sum + C.techniqueProgress(state.cultivation, technique.id),
        0
      );
      const chance = Math.max(
        0.35,
        Math.min(
          0.9,
          0.55 +
            state.cultivation.attributes.insight * 0.001 +
            state.cultivation.attributes.fortune * 0.0005 +
            combatProgress * 0.0025
        )
      );
      const won = random() < chance;
      if (won) {
        const gainedRatio = 0.25 + random() * 0.35;
        const gained = Math.round(C.expRequired(state.level) * gainedRatio);
        const advanced = C.addExperience(state.cultivation, state.level, gained);
        state.level = advanced.level;
        combat = {
          outcome: "win",
          chance,
          gained,
          levelsGained: advanced.levelsGained,
          text: `激战之后击杀守灵，暴涨 ${Math.round(gained)} 修为。`,
        };
      } else {
        const lossRatio = 0.12 + random() * 0.18;
        const lost = Math.min(state.cultivation.exp, Math.round(C.expRequired(state.level) * lossRatio));
        state.cultivation.exp = Math.max(0, state.cultivation.exp - lost);
        combat = {
          outcome: "loss",
          chance,
          lost,
          text: `守灵反扑，损失 ${lost} 修为后狼狈退开。`,
        };
      }
    }
    const rewards = grantCaveLoot(state, spot, random, lootMultiplier);
    cave.lastLoot = {
      techniqueName: rewards.find((reward) => reward.type === "technique")?.item.name || "",
      pillName: rewards.find((reward) => reward.type === "pill")?.item.name || "",
      at: ts,
    };
    return {
      ok: true,
      choice: type,
      active,
      rewards,
      combat,
      lootMultiplier,
      dialogue:
        type === "avoid"
          ? `避开守灵，进入可探索区域；爆率降低 80%`
          : type === "observe"
            ? `远远观察守灵；爆率降低 50%`
            : `${combat.text}；爆率提高 20%`,
    };
  }

  function leaveCaveHeaven(state, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const cave = state.cultivation.cave;
    if (!cave.active && !cave.challenge) return { ok: false, reason: "not-in-cave" };
    const leavingId = (cave.active && cave.active.id) || (cave.challenge && cave.challenge.id);
    const base = C.CAVE_HEAVENS.find((item) => item.id === leavingId);
    const wasChallenge = Boolean(cave.challenge);
    cave.active = null;
    cave.challenge = null;
    return {
      ok: true,
      name: base ? base.name : "洞天福地",
      wasChallenge,
      dialogue: `主动离开${base ? base.name : "洞天福地"}${wasChallenge ? "，守灵也归于沉寂" : ""}`,
    };
  }

  function opportunityStatus(state, now) {
    state.opportunities = O.normalizeState(state.opportunities, now || Date.now());
    return O.status(state, now || Date.now());
  }

  function drawOpportunity(state, now, rng) {
    return O.draw(state, now || Date.now(), rng);
  }

  function resolveOpportunityChoice(state, choiceId, now, rng) {
    return O.resolveChoice(state, choiceId, now || Date.now(), rng);
  }

  function setSpiritStoneTier(state, tierId, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    if (!C.STONE_TIERS[tierId]) return { ok: false, reason: "tier" };
    state.cultivation.selectedStoneTier = tierId;
    return { ok: true, tier: C.STONE_TIERS[tierId] };
  }

  function setStoneQuantities(state, buyQuantity, consumeQuantity, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    state.cultivation.buyQuantity = Math.max(
      1,
      Math.min(9999, Math.round(Number(buyQuantity) || state.cultivation.buyQuantity || 10))
    );
    state.cultivation.consumeQuantity = Math.max(
      1,
      Math.min(9999, Math.round(Number(consumeQuantity) || state.cultivation.consumeQuantity || 1))
    );
    return {
      ok: true,
      buyQuantity: state.cultivation.buyQuantity,
      consumeQuantity: state.cultivation.consumeQuantity,
    };
  }

  function settleMeditation(state, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const meditation = state.cultivation.meditation;
    if (!meditation || !meditation.active) {
      if (meditation) meditation.lastAt = now || Date.now();
      return { active: false, gained: 0, seconds: 0 };
    }
    const ts = now || Date.now();
    const elapsedMs = Math.max(0, ts - (Number(meditation.lastAt) || ts));
    const cappedMs = Math.min(elapsedMs, C.MEDITATION_OFFLINE_CAP_HOURS * 3600 * 1000);
    const seconds = cappedMs / 1000;
    let gained = 0;
    let techniqueGained = 0;
    if (seconds > 0 && state.level < C.MAX_LEVEL) {
      const rate = C.meditationRate(state.cultivation, state.level);
      gained = rate.perSecond * seconds;
      const advanced = C.addExperience(state.cultivation, state.level, gained);
      state.level = advanced.level;
      techniqueGained =
        (seconds / 3600) *
        (0.25 + state.cultivation.attributes.insight * 0.012) *
        rate.formation.multiplier *
        Math.sqrt(rate.region.qi);
      state.cultivation.technique = Math.min(
        C.MAX_TECHNIQUE_MASTERY,
        (Number(state.cultivation.technique) || 0) + techniqueGained
      );
      C.advanceEquippedTechniques(state.cultivation, techniqueGained * 0.6);
      meditation.totalSeconds = (Number(meditation.totalSeconds) || 0) + seconds;
    }
    meditation.lastAt = ts;
    const atCap =
      state.level >= C.MAX_LEVEL ||
      (C.isBreakthroughLevel(state.level) && state.cultivation.exp >= C.expRequired(state.level));
    if (atCap) meditation.active = false;
    return {
      active: meditation.active,
      gained,
      techniqueGained,
      seconds,
      atCap,
      level: state.level,
    };
  }

  function setMeditation(state, active, now) {
    const ts = now || Date.now();
    state.cultivation = C.normalizeCultivation(state.cultivation, ts);
    settleMeditation(state, ts);
    if (active && state.level >= C.MAX_LEVEL) {
      return { ok: false, reason: "max-level" };
    }
    if (active && state.cultivation.stoneSession.active) {
      return { ok: false, reason: "stone-session" };
    }
    if (active && C.isBreakthroughLevel(state.level) && state.cultivation.exp >= C.expRequired(state.level)) {
      return { ok: false, reason: "breakthrough" };
    }
    state.cultivation.meditation.active = Boolean(active);
    state.cultivation.meditation.lastAt = ts;
    return {
      ok: true,
      active: state.cultivation.meditation.active,
      rate: C.meditationRate(state.cultivation, state.level),
    };
  }

  function setFormation(state, formationId, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const formation = C.FORMATIONS[formationId];
    if (!formation) return { ok: false, reason: "formation" };
    if (state.level < formation.minLevel) {
      return {
        ok: false,
        reason: "locked",
        requiredLevel: formation.minLevel,
        formation,
      };
    }
    if (state.cultivation.stoneSession.active) return { ok: false, reason: "stone-session", formation };
    settleMeditation(state, now || Date.now());
    state.cultivation.formationId = formation.id;
    return { ok: true, formation };
  }

  function travelToRegion(state, regionId, now) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now());
    const region = C.regionById(regionId);
    if (!region) return { ok: false, reason: "region" };
    if (state.level < region.minLevel) {
      return {
        ok: false,
        reason: "locked",
        requiredLevel: region.minLevel,
        region,
      };
    }
    if (state.cultivation.stoneSession.active) return { ok: false, reason: "stone-session", region };
    settleMeditation(state, now || Date.now());
    state.cultivation.regionId = region.id;
    state.lastTick = now || Date.now();
    return { ok: true, region };
  }

  function advanceLifespan(state, now, rng) {
    state.cultivation = C.normalizeCultivation(state.cultivation, now || Date.now(), rng);
    const previousLevel = state.level;
    const previousCycle = state.cultivation.cycle || 0;
    const aging = C.advanceAge(state.cultivation, now || Date.now(), state.level);
    if (!aging.died) return { died: false, years: aging.years };
    const oldAge = state.cultivation.age;
    resetForNewLife(state, now || Date.now(), rng, {
      type: "lifespan",
      at: now || Date.now(),
      age: oldAge,
      level: previousLevel,
      carried: "",
      cycle: previousCycle + 1,
    });
    return {
      died: true,
      years: aging.years,
      age: oldAge,
      level: previousLevel,
      dialogue: `寿元耗尽，${realmLabelForLevel(previousLevel)}的肉身化作尘烟；新的命格已经生成`,
    };
  }

  function resetForNewLife(state, now, rng, event) {
    const settings = JSON.parse(JSON.stringify(state.settings || DEFAULT_STATE.settings));
    const window = JSON.parse(JSON.stringify(state.window || DEFAULT_STATE.window));
    const next = freshState(now, rng);
    next.settings = settings;
    next.window = window;
    next.createdAt = now;
    next.cultivation.cycle = Math.max(0, Number(event && event.cycle) || 0);
    next.cultivation.lastLifeEvent = {
      type: event && event.type === "rebirth" ? "rebirth" : "lifespan",
      at: now,
      age: Math.max(0, Number(event && event.age) || 0),
      level: Math.max(1, Math.min(C.MAX_LEVEL, Number(event && event.level) || 1)),
      carried: C.ATTRIBUTE_KEYS.includes(event && event.carried) ? event.carried : "",
    };
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, next);
    return state;
  }

  function soulAttributeBonus(level, rootId, count) {
    const root = C.ROOTS[rootId] || C.ROOTS.mixed;
    return Math.max(
      0,
      Math.min(
        250,
        Math.round(Math.max(0, Number(level) || 0) * 0.1 * (root.soulPower || 1)) +
          Math.max(0, Number(count) || 0) * 2
      )
    );
  }

  function rebirthStatus(state) {
    const attributes = C.talentSummary(state.cultivation && state.cultivation.attributes);
    const soul = (state.cultivation && state.cultivation.soul) || {
      level: 0,
      count: 0,
      root: "",
      attributeBonus: 0,
    };
    const immortal = state.level >= 101;
    const nextSoulLevel = immortal ? Math.max(soul.level, state.level) : soul.level;
    const nextSoulRoot = immortal ? attributes.root : soul.root;
    const nextAttributeBonus = immortal
      ? soulAttributeBonus(nextSoulLevel, nextSoulRoot, soul.count + 1)
      : soul.attributeBonus;
    return {
      requiredLevel: 41,
      level: state.level,
      eligible: state.level >= 41,
      immortal,
      realm: realmLabelForLevel(state.level),
      realmName: C.realmStatus(state.level).major.name,
      cycle: Number(state.cultivation && state.cultivation.cycle) || 0,
      attributes,
      soul: {
        level: soul.level,
        count: soul.count,
        root: soul.root,
        rootName: soul.root ? C.ROOTS[soul.root].name : "",
        attributeBonus: soul.attributeBonus,
        nextLevel: nextSoulLevel,
        nextRoot: nextSoulRoot,
        nextRootName: nextSoulRoot ? C.ROOTS[nextSoulRoot].name : "",
        nextAttributeBonus,
      },
      choices: C.ATTRIBUTE_KEYS.map((key) => ({
        key,
        label: C.ATTRIBUTE_META[key].label,
        value: key === "root" ? C.ROOTS[attributes.root].name : attributes[key],
      })),
    };
  }

  function soulRebirth(state, previous, startedAt, nextRng) {
    const oldSoul = state.cultivation.soul;
    const soulLevel = Math.max(oldSoul.level || 0, previous.level);
    const soulCount = (oldSoul.count || 0) + 1;
    const soulRoot = previous.attributes.root;
    const attributeBonus = soulAttributeBonus(soulLevel, soulRoot, soulCount);
    resetForNewLife(state, startedAt, nextRng, {
      type: "rebirth",
      age: previous.age,
      level: previous.level,
      carried: "root",
      cycle: previous.cycle + 1,
    });
    const generatedRoot = state.cultivation.attributes.root;
    const rootUpgraded = C.rootsAreSymbiotic(soulRoot, generatedRoot);
    state.cultivation.attributes.root = soulRoot;
    state.cultivation.attributes.rootLineage = Math.min(
      100,
      (Number(previous.attributes.rootLineage) || 0) + (rootUpgraded ? 1 : 0)
    );
    state.cultivation.attributes.insight = Math.min(
      C.MAX_ATTRIBUTE,
      state.cultivation.attributes.insight + attributeBonus
    );
    state.cultivation.attributes.fortune = Math.min(
      C.MAX_ATTRIBUTE,
      state.cultivation.attributes.fortune + attributeBonus
    );
    state.cultivation.attributes.daoHeart = Math.min(
      C.MAX_ATTRIBUTE,
      state.cultivation.attributes.daoHeart + attributeBonus
    );
    state.cultivation.attributes.lifespan = Math.min(
      C.MAX_ATTRIBUTE,
      state.cultivation.attributes.lifespan + attributeBonus
    );
    state.cultivation.technique = Math.min(
      C.MAX_TECHNIQUE_MASTERY,
      (Number(state.cultivation.technique) || 0) + Math.floor(attributeBonus / 2)
    );
    state.cultivation.soul = {
      level: soulLevel,
      count: soulCount,
      root: soulRoot,
      attributeBonus,
    };
    state.cultivation.cycle = previous.cycle + 1;
    return {
      ok: true,
      immortal: true,
      previousLevel: previous.level,
      soulLevel,
      soulCount,
      soulRoot,
      soulRootName: C.ROOTS[soulRoot].name,
      generatedRoot,
      generatedRootName: C.ROOTS[generatedRoot].name,
      attributeBonus,
      rootUpgraded,
      rootLineage: state.cultivation.attributes.rootLineage,
      cycle: state.cultivation.cycle,
      attributes: C.talentSummary(state.cultivation.attributes),
      root: C.ROOTS[state.cultivation.attributes.root],
      dialogue: `仙人神魂转世：保留Lv.${soulLevel}${C.ROOTS[soulRoot].name}神魂，全属性 +${attributeBonus}；${
        rootUpgraded
          ? `今生随机为${C.ROOTS[generatedRoot].name}，与前世灵根共生，根骨等阶 +1`
          : `今生随机为${C.ROOTS[generatedRoot].name}，未能共生，保留原有根骨等阶`
      }`,
    };
  }

  function rebirth(state, attributeKey, now, rng) {
    const startedAt = now || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.cultivation = C.normalizeCultivation(state.cultivation, startedAt, random);
    if (state.level < 41) {
      return { ok: false, reason: "level", requiredLevel: 41 };
    }
    if (!C.ATTRIBUTE_KEYS.includes(attributeKey)) {
      return { ok: false, reason: "attribute" };
    }
    const previous = {
      level: state.level,
      age: state.cultivation.age,
      cycle: state.cultivation.cycle || 0,
      realmName: C.realmStatus(state.level).major.name,
      attributes: JSON.parse(JSON.stringify(state.cultivation.attributes)),
    };
    const nextRng = () => random();
    if (previous.level >= 101) {
      return soulRebirth(state, previous, startedAt, nextRng);
    }
    resetForNewLife(state, startedAt, nextRng, {
      type: "rebirth",
      age: previous.age,
      level: previous.level,
      carried: attributeKey,
      cycle: previous.cycle + 1,
    });
    const carried = {
      root: previous.attributes.root,
      insight: previous.attributes.insight,
      fortune: previous.attributes.fortune,
      daoHeart: previous.attributes.daoHeart,
      lifespan: previous.attributes.lifespan,
      rootLineage: previous.attributes.rootLineage,
    };
    const merged = C.mergeCarriedAttribute(state.cultivation.attributes, carried, attributeKey, nextRng);
    state.cultivation.attributes = merged.attributes;
    state.cultivation.cycle = previous.cycle + 1;
    return {
      ok: true,
      previousLevel: previous.level,
      previousRealmName: previous.realmName,
      carried: attributeKey,
      mergeMode: merged.mode,
      cycle: state.cultivation.cycle,
      attributes: C.talentSummary(state.cultivation.attributes),
      root: C.ROOTS[state.cultivation.attributes.root],
      dialogue:
        merged.mode === "merge"
          ? `${previous.realmName}转世成功，${C.ATTRIBUTE_META[attributeKey].label}与新生命格叠加`
          : `${previous.realmName}转世成功，新生命格覆盖了${C.ATTRIBUTE_META[attributeKey].label}`,
    };
  }

  function realmLabelForLevel(level) {
    const status = C.realmStatus(level);
    return status.fullName;
  }

  function titleForState(state) {
    return realmLabelForLevel(state.level);
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
    const intimacy = addIntimacy(state, 1, now);
    state.lastTick = now || Date.now();
    return { bonus, dialogue: pick(DIALOGUE.happy, random), training, intimacy };
  }

  function pick(list, rng) {
    const random = rng || Math.random;
    return list[Math.floor(random() * list.length) % list.length];
  }

  function moodFace(state) {
    if (!fastingStatus(state).active && state.satiety <= BALANCE.emptyThreshold) return "sad";
    if (!fastingStatus(state).active && state.satiety < BALANCE.hungryThreshold) return "sad";
    if (state.mood < 30) return "sad";
    if (state.mood > 80) return "happy";
    return "idle";
  }

  function dialogueFor(kind, state, rng) {
    if (kind === "coin") return pick(DIALOGUE.coin, rng);
    if (kind === "eat") return pick(DIALOGUE.eat, rng);
    if (kind === "play") return pick(DIALOGUE.play, rng);
    if (kind === "offline") return pick(DIALOGUE.offline, rng);
    if ((kind === "auto" || kind === "idle") && intimacyStatus(state).level >= 3) {
      const random = rng || Math.random;
      if (random() < 0.35) return pick(INTIMACY_DIALOGUE, random);
    }
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
  function isUnlocked(state, action, now) {
    if (!action) return false;
    if (action.category === "dress") {
      return (state.unlocked || []).includes(action.name) || rentalActive(state, "dress", action.name, now);
    }
    if (intimacyActionUnlocked(state, action.name)) return true;
    return isActionLearned(state, action);
  }

  function isStickerAction(action) {
    return Boolean(action && action.group === "表情包");
  }

  function isStickerHidden(state, action) {
    return Boolean(action && state.stickerHidden && state.stickerHidden.includes(action.name));
  }

  function hideBuiltInSticker(state, action) {
    if (!action || !action.name || action.user) return { ok: false, reason: "not-built-in" };
    if (!state.stickerHidden) state.stickerHidden = [];
    if (!state.stickerHidden.includes(action.name)) state.stickerHidden.push(action.name);
    return { ok: true, name: action.name };
  }

  function restoreBuiltInStickers(state, actions) {
    const builtInNames = new Set(
      (Array.isArray(actions) ? actions : [])
        .filter((action) => action && !action.user)
        .map((action) => action.name)
    );
    const previous = state.stickerHidden ? state.stickerHidden.length : 0;
    state.stickerHidden = (state.stickerHidden || []).filter((name) => !builtInNames.has(name));
    return { ok: true, restored: previous - state.stickerHidden.length };
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
    if (isStickerHidden(state, action)) return false;
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

  function dressPrice(index, name) {
    const override = name && DRESS_PRICE_OVERRIDES[name];
    return Number.isFinite(Number(override))
      ? Math.max(1, Math.round(Number(override)))
      : DRESS_BASE_PRICE + index * DRESS_PRICE_STEP;
  }

  function rentalPrice(basePrice, duration) {
    const base = Math.max(1, Math.round(Number(basePrice) || 0));
    if (duration === "permanent") return base * PERMANENT_PRICE_MULTIPLIER;
    const days = Math.max(1, Math.min(30, Math.round(Number(duration) || 1)));
    return base * days;
  }

  function rentalExpiresAt(state, kind, id) {
    const key = kind === "dress" ? "dress" : "furniture";
    return Number((state.rentals && state.rentals[key] && state.rentals[key][id]) || 0);
  }

  function rentalActive(state, kind, id, now) {
    return rentalExpiresAt(state, kind, id) > (now || Date.now());
  }

  function isFashionActive(state, item, now) {
    if (!item || item.type !== "fashion") return false;
    return (state.unlocked || []).includes(item.id) || rentalActive(state, "dress", item.id, now);
  }

  function toggleFashion(state, id, now) {
    const item = SHOP_ITEMS[String(id || "")];
    if (!isFashionActive(state, item, now)) {
      return { ok: false, reason: "not-owned" };
    }
    state.settings.equippedFashion = state.settings.equippedFashion === item.id ? "" : item.id;
    return { ok: true, equipped: state.settings.equippedFashion === item.id, item };
  }

  function ownsFurniture(state, id, now) {
    return Boolean(
      (state.room && state.room.furniture.includes(id)) ||
      (id === "companion" && state.companion && state.companion.adopted) ||
      rentalActive(state, "furniture", id, now)
    );
  }

  function activeFurnitureIds(state, now) {
    const ids = new Set((state.room && state.room.furniture) || []);
    if (state.companion && state.companion.adopted) ids.add("companion");
    Object.entries((state.rentals && state.rentals.furniture) || {}).forEach(([id, expiresAt]) => {
      if (Number(expiresAt) > (now || Date.now())) ids.add(id);
    });
    return [...ids].filter((id) => FURNITURE[id]);
  }

  function furnitureScore(state, now) {
    return activeFurnitureIds(state, now).reduce((sum, id) => sum + (FURNITURE[id].score || 0), 0);
  }

  function dressScore(index, name) {
    const override = name && DRESS_SCORE_OVERRIDES[name];
    return Number.isFinite(Number(override))
      ? Math.max(0, Math.round(Number(override)))
      : 20 + Math.max(0, Math.round(Number(index) || 0)) * 5;
  }

  function dressListed(name) {
    return DRESS_LISTED_OVERRIDES[name] !== false;
  }

  function fashionScore(state, actions, now) {
    const dresses = (Array.isArray(actions) ? actions : []).filter(
      (action) => action && action.category === "dress"
    );
    const scoreByName = new Map(
      dresses.map((action, index) => [action.name, dressScore(index, action.name)])
    );
    const ids = new Set(state.unlocked || []);
    Object.entries((state.rentals && state.rentals.dress) || {}).forEach(([id, expiresAt]) => {
      if (Number(expiresAt) > (now || Date.now())) ids.add(id);
    });
    const dressScoreValue = [...ids].reduce((sum, name) => sum + (scoreByName.get(name) || 0), 0);
    const fashionScoreValue = Object.values(SHOP_ITEMS)
      .filter((item) => item.type === "fashion" && isFashionActive(state, item, now))
      .reduce((sum, item) => sum + (Number(item.score) || 0), 0);
    return dressScoreValue + fashionScoreValue;
  }

  function collectionScore(state) {
    return Object.values(SHOP_ITEMS)
      .filter((item) => ["luxury", "champion"].includes(item.type) && state.perks[item.id])
      .reduce((sum, item) => sum + (item.score || 0), 0);
  }

  function leaderboardScores(state, actions, now) {
    return {
      level: Math.max(1, Number(state.level) || 1),
      furniture: furnitureScore(state, now),
      fashion: fashionScore(state, actions, now),
      collection: collectionScore(state),
    };
  }

  function applyChampionAwards(state, awards) {
    const changed = [];
    const valid = new Set(CHAMPION_ITEM_IDS);
    (Array.isArray(awards) ? awards : []).forEach((award) => {
      const id = typeof award === "string" ? award : award && award.id;
      if (!valid.has(id) || !state.perks || state.perks[id]) return;
      state.perks[id] = true;
      changed.push(id);
    });
    return { ok: changed.length > 0, changed };
  }

  function applyLeaderboardPrivileges(state, payload) {
    const awards = applyChampionAwards(state, payload && payload.awards);
    let boostChanged = false;
    const input = payload && payload.activeBoosts;
    if (input && typeof input === "object") {
      const next = {
        period: /^\d{4}-\d{2}-\d{2}$/.test(String(input.period || "")) ? String(input.period) : "",
        activeUntil: Math.max(0, Number(input.activeUntil) || 0),
        boards: [
          ...new Set(
            (Array.isArray(input.boards) ? input.boards : []).filter((board) =>
              LEADERBOARD_BOARD_IDS.includes(board)
            )
          ),
        ],
      };
      if (JSON.stringify(next) !== JSON.stringify(state.leaderboardBoosts)) {
        state.leaderboardBoosts = next;
        boostChanged = true;
      }
    }
    return {
      ok: awards.ok || boostChanged,
      changed: awards.changed,
      boostChanged,
      boards: activeChampionBoards(state),
    };
  }

  function activeBuff(state, key, now) {
    const until = state.buffs && state.buffs[key];
    return until && until > (now || Date.now()) ? until : 0;
  }

  function shopItemPrice(state, item) {
    if (!item) return 0;
    if (item.type !== "cultivation") return Number(item.price) || 0;
    if (item.cultivationType === "breakthrough") return C.breakthroughCost(state.level);
    if (item.cultivationType === "life") return C.lifePillCost(state.level);
    if (item.cultivationType === "thunder") return C.thunderPearlCost(state.level);
    if (item.cultivationType === "technique") return Math.max(600, 500 + state.level * 16);
    if (item.cultivationType === "cultivation") return Math.max(700, 600 + state.level * 12);
    if (item.cultivationType === "heart") return Math.max(400, 300 + state.level * 9);
    if (item.cultivationType === "bigu") return Math.max(900, 800 + state.level * 10);
    if (item.cultivationType === "stone" && C.STONE_TIERS[item.stoneTier]) {
      return Number(item.price) || C.STONE_TIERS[item.stoneTier].price;
    }
    return Number(item.price) || 0;
  }

  function cultivationItemCount(state, item) {
    if (!item || item.type !== "cultivation" || !state.cultivation) return 0;
    if (item.cultivationType === "stone") {
      return Number(state.cultivation.stones && state.cultivation.stones[item.stoneTier]) || 0;
    }
    if (item.cultivationType === "breakthrough") {
      return Number(state.cultivation.pills && state.cultivation.pills.breakthrough) || 0;
    }
    if (item.cultivationType === "life") {
      return Number(state.cultivation.pills && state.cultivation.pills.life) || 0;
    }
    if (item.cultivationType === "thunder") {
      return Number(state.cultivation.thunderPearls) || 0;
    }
    if (["technique", "cultivation", "heart", "bigu"].includes(item.cultivationType)) {
      return Number(state.cultivation.pills && state.cultivation.pills[item.cultivationType]) || 0;
    }
    return 0;
  }

  function purchase(state, item, now) {
    if (!item || !item.id) return { ok: false, reason: "bad-item" };
    if (item.type === "champion") return { ok: false, reason: "not-sale" };
    if (
      item.type === "technique" &&
      (!state.cultivation || item.root !== state.cultivation.attributes.root)
    ) {
      return { ok: false, reason: "root" };
    }
    if (!state.rentals || typeof state.rentals !== "object") {
      state.rentals = { furniture: {}, dress: {} };
    }
    if (!state.rentals.furniture || typeof state.rentals.furniture !== "object") {
      state.rentals.furniture = {};
    }
    if (!state.rentals.dress || typeof state.rentals.dress !== "object") {
      state.rentals.dress = {};
    }
    const ts = now || Date.now();
    const requestedDuration =
      item.rentalDuration === "permanent" || RENTAL_DAYS.includes(Number(item.rentalDuration))
        ? item.rentalDuration === "permanent"
          ? "permanent"
          : Number(item.rentalDuration)
        : "permanent";
    const isPurchasableRental = ["dress", "fashion", "furniture", "companion"].includes(item.type);
    const isTimed = isPurchasableRental && requestedDuration !== "permanent";
    if (item.type === "dress" && (state.unlocked || []).includes(item.action)) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "fashion" && (state.unlocked || []).includes(item.id)) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "permanent" && state.perks[item.id]) return { ok: false, reason: "owned" };
    if (item.type === "theme" && state.perks[`theme_${item.theme}`]) return { ok: false, reason: "owned" };
    if (
      (item.type === "furniture" && state.room && state.room.furniture.includes(item.furnitureId)) ||
      (item.furnitureId === "companion" && state.companion && state.companion.adopted)
    ) {
      return { ok: false, reason: "owned" };
    }
    if (
      item.type === "companion" &&
      ((state.room && state.room.furniture.includes("companion")) ||
        (state.companion && state.companion.adopted))
    ) {
      return { ok: false, reason: "owned" };
    }
    if (item.type === "luxury" && state.perks[item.id]) return { ok: false, reason: "owned" };
    const price = ["dress", "fashion", "furniture", "companion"].includes(item.type)
      ? rentalPrice(item.price, requestedDuration)
      : shopItemPrice(state, item);
    if (!canAfford(state, price)) return { ok: false, reason: "coin", price };

    state.coins -= price;
    state.shopStats.purchases += 1;
    state.shopStats.spent += price;
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
      if (isTimed) {
        if (!state.rentals) state.rentals = { furniture: {}, dress: {} };
        const current = rentalExpiresAt(state, "furniture", item.furnitureId);
        state.rentals.furniture[item.furnitureId] =
          Math.max(ts, current) + Number(requestedDuration) * 86400000;
      } else {
        if (!state.room) state.room = { furniture: [] };
        if (!state.room.furniture.includes(item.furnitureId)) state.room.furniture.push(item.furnitureId);
        delete state.rentals.furniture[item.furnitureId];
      }
    } else if (item.type === "companion") {
      if (isTimed) {
        if (!state.rentals) state.rentals = { furniture: {}, dress: {} };
        const current = rentalExpiresAt(state, "furniture", "companion");
        state.rentals.furniture.companion = Math.max(ts, current) + Number(requestedDuration) * 86400000;
      } else {
        if (!state.companion) state.companion = { adopted: false };
        state.companion.adopted = true;
        if (!state.room.furniture.includes("companion")) state.room.furniture.push("companion");
        delete state.rentals.furniture.companion;
      }
    } else if (item.type === "dress") {
      if (isTimed) {
        if (!state.rentals) state.rentals = { furniture: {}, dress: {} };
        const current = rentalExpiresAt(state, "dress", item.action);
        state.rentals.dress[item.action] = Math.max(ts, current) + Number(requestedDuration) * 86400000;
      } else if (!state.unlocked.includes(item.action)) {
        state.unlocked.push(item.action);
        delete state.rentals.dress[item.action];
      }
    } else if (item.type === "fashion") {
      if (isTimed) {
        if (!state.rentals) state.rentals = { furniture: {}, dress: {} };
        const current = rentalExpiresAt(state, "dress", item.id);
        state.rentals.dress[item.id] = Math.max(ts, current) + Number(requestedDuration) * 86400000;
      } else if (!state.unlocked.includes(item.id)) {
        state.unlocked.push(item.id);
        delete state.rentals.dress[item.id];
      }
      state.settings.equippedFashion = item.id;
    } else if (item.type === "luxury") {
      state.perks[item.id] = true;
    } else if (item.type === "profile") {
      reshapeProfile(state, item.profileAction);
    } else if (item.type === "cultivation") {
      if (!state.cultivation) state.cultivation = C.createCultivation(ts);
      if (item.cultivationType === "stone" && C.STONE_TIERS[item.stoneTier]) {
        state.cultivation.stones[item.stoneTier] += 1;
        state.cultivation.spiritStones = state.cultivation.stones.low;
      } else if (item.cultivationType === "breakthrough") {
        state.cultivation.pills.breakthrough += 1;
      } else if (item.cultivationType === "life") {
        state.cultivation.pills.life += 1;
      } else if (
        item.cultivationType === "technique" ||
        item.cultivationType === "cultivation" ||
        item.cultivationType === "heart" ||
        item.cultivationType === "bigu"
      ) {
        state.cultivation.pills[item.cultivationType] += 1;
      } else if (item.cultivationType === "thunder") {
        state.cultivation.thunderPearls += 1;
      }
    } else if (item.type === "technique") {
      state.cultivation.techniqueScrolls[item.id] =
        (Number(state.cultivation.techniqueScrolls[item.id]) || 0) + 1;
    }
    state.lastTick = ts;
    return {
      ok: true,
      item,
      price,
      rentalDuration: isPurchasableRental ? (isTimed ? requestedDuration : "permanent") : undefined,
      profile: item.type === "profile" ? profileDetails(state) : undefined,
      cultivationCount: item.type === "cultivation" ? cultivationItemCount(state, item) : undefined,
    };
  }

  function purchaseMany(state, item, quantity, now) {
    const amount = Math.max(1, Math.min(9999, Math.floor(Number(quantity) || 1)));
    if (!item) return { ok: false, reason: "bad-item" };
    const unitPrice = shopItemPrice(state, item);
    const total = unitPrice * amount;
    if (!canAfford(state, total)) {
      return { ok: false, reason: "coin", price: unitPrice, total, amount };
    }
    let purchased = 0;
    for (; purchased < amount; purchased += 1) {
      const result = purchase(state, item, now);
      if (!result.ok) {
        return {
          ok: purchased > 0,
          reason: result.reason,
          price: unitPrice,
          total: purchased * unitPrice,
          amount: purchased,
          item,
        };
      }
    }
    return {
      ok: true,
      price: unitPrice,
      total,
      amount,
      item,
      cultivationCount: item.type === "cultivation" ? cultivationItemCount(state, item) : undefined,
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

  function intimacyLevelForPoints(points) {
    return (
      INTIMACY_LEVELS.find((entry) => points >= entry.min) || INTIMACY_LEVELS[INTIMACY_LEVELS.length - 1]
    );
  }

  function intimacyStatus(state) {
    const points = Math.max(0, Number(state.intimacy && state.intimacy.points) || 0);
    const level = intimacyLevelForPoints(points);
    const next = INTIMACY_LEVELS.slice()
      .sort((a, b) => a.min - b.min)
      .find((entry) => entry.min > points);
    return {
      points,
      level: level.level,
      name: level.name,
      nextAt: next ? next.min : null,
      progress: next ? (points - level.min) / Math.max(1, next.min - level.min) : 1,
    };
  }

  function addIntimacy(state, amount, now) {
    const ts = now || Date.now();
    const key = dayKey(ts);
    if (!state.intimacy) state.intimacy = { points: 0, dailyDate: key, dailyPoints: 0 };
    if (state.intimacy.dailyDate !== key) {
      state.intimacy.dailyDate = key;
      state.intimacy.dailyPoints = 0;
    }
    const gain = Math.max(0, Math.min(35 - state.intimacy.dailyPoints, Math.round(Number(amount) || 0)));
    state.intimacy.points += gain;
    state.intimacy.dailyPoints += gain;
    const status = intimacyStatus(state);
    if (status.level >= 5 && !state.unlocked.includes("dress_bow")) state.unlocked.push("dress_bow");
    return { gain, ...status };
  }

  function intimacyActionUnlocked(state, name) {
    const level = intimacyStatus(state).level;
    return Object.entries(INTIMACY_ACTIONS).some(
      ([required, actionName]) => actionName === name && level >= Number(required)
    );
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
      const previous = state.daily;
      if (previous && previous.date && previous.progress && state.diary) {
        const exists = state.diary.entries.some((entry) => entry.date === previous.date);
        if (!exists) {
          const progress = previous.progress;
          const lines = [
            `今天赚了 ${formatCoins(progress.coinsEarned || 0)} 金币`,
            `看了 ${progress.actionsViewed || 0} 个动作`,
            `接待了 ${progress.visitors || 0} 位访客`,
            `被摸了 ${progress.pets || 0} 次`,
            `吃了 ${progress.feeds || 0} 顿饭`,
          ];
          state.diary.entries.push({ date: previous.date, text: `${lines.join("，")}。` });
          state.diary.entries = state.diary.entries.slice(-30);
        }
      }
      state.daily = {
        date: key,
        progress: { pets: 0, feeds: 0, plays: 0, actionsViewed: 0, coinsEarned: 0, visitors: 0 },
        claimed: [],
      };
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
    addIntimacy(state, 12, now);
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

  function randomEntry(list, rng) {
    if (!Array.isArray(list) || !list.length) return null;
    const roll = clamp(Number(rng()) || 0, 0, 0.999999999);
    return list[Math.floor(roll * list.length)];
  }

  function gachaPriceWeight(price) {
    return 1 / Math.sqrt(Math.max(1, Number(price) || 1));
  }

  function gachaWeightedEntry(list, rng, weightOf) {
    if (!Array.isArray(list) || !list.length) return null;
    const weighted = list
      .map((value) => ({ value, weight: Math.max(0, Number(weightOf(value)) || 0) }))
      .filter((entry) => entry.weight > 0);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (!weighted.length || total <= 0) return null;
    let roll = clamp(Number(rng()) || 0, 0, 0.999999999) * total;
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll < 0) return entry.value;
    }
    return weighted[weighted.length - 1].value;
  }

  function gachaLimitedDays(rng) {
    return GACHA_LIMITED_DAYS[
      Math.floor(clamp(Number(rng()) || 0, 0, 0.999999999) * GACHA_LIMITED_DAYS.length)
    ];
  }

  function addGachaRental(state, kind, id, days, now) {
    const key = kind === "dress" ? "dress" : "furniture";
    if (!state.rentals || typeof state.rentals !== "object") {
      state.rentals = { furniture: {}, dress: {} };
    }
    if (!state.rentals[key] || typeof state.rentals[key] !== "object") state.rentals[key] = {};
    const current = rentalExpiresAt(state, key, id);
    const expiresAt = Math.max(Number(now) || Date.now(), current) + days * DAY_MS;
    state.rentals[key][id] = expiresAt;
    return expiresAt;
  }

  function grantGachaFurniture(state, item, rng, now) {
    const days = gachaLimitedDays(rng);
    const expiresAt = addGachaRental(state, "furniture", item.id, days, now);
    return {
      ok: true,
      type: "furniture",
      rewardCategory: "furniture",
      label: `${item.icon} ${item.name}（限时 ${days} 天）`,
      furnitureId: item.id,
      durationDays: days,
      expiresAt,
      temporary: true,
      tier: "rare",
    };
  }

  function grantGachaOutfit(state, source, rng, now) {
    const days = gachaLimitedDays(rng);
    const item = source.item;
    const kind = source.kind;
    const id = kind === "fashion" ? item.id : item.name;
    const expiresAt = addGachaRental(state, "dress", id, days, now);
    if (kind === "fashion") state.settings.equippedFashion = item.id;
    return {
      ok: true,
      type: kind === "fashion" ? "fashion" : "dress",
      rewardCategory: "outfit",
      label: `${item.icon || "👗"} ${item.label || item.name}（限时 ${days} 天）`,
      action: kind === "dress" ? item.name : undefined,
      itemId: kind === "fashion" ? item.id : undefined,
      durationDays: days,
      expiresAt,
      temporary: true,
      tier: "rare",
    };
  }

  function gachaCommonCoinAmount(rng) {
    const lowBand = rng() < GACHA_COMMON_COIN_LOW_RATE;
    const min = lowBand ? GACHA_COMMON_COIN_LOW_MIN : GACHA_COMMON_COIN_HIGH_MIN;
    const max = lowBand ? GACHA_COMMON_COIN_LOW_MAX : GACHA_COMMON_COIN_HIGH_MAX;
    return min + Math.floor(rng() * (max - min + 1));
  }

  function grantGachaBuff(state, item, now) {
    const start = Math.max(Number(now) || Date.now(), activeBuff(state, item.buff, now));
    state.buffs[item.buff] = start + item.minutes * 60000;
    return {
      ok: true,
      type: "buff",
      rewardCategory: "buff",
      label: `${item.icon} ${item.name}（${item.minutes} 分钟）`,
      itemId: item.id,
      durationMinutes: item.minutes,
      tier: "rare",
    };
  }

  function recordGachaHistory(state, result, now, pool) {
    if (!state.gacha || typeof state.gacha !== "object") state.gacha = { pulls: 0, history: [] };
    const history = Array.isArray(state.gacha.history) ? state.gacha.history : [];
    const entry = {
      at: Number(now) || Date.now(),
      type: String(result.type || "reward").slice(0, 20),
      label: String(result.label || "扭蛋奖励").slice(0, 100),
      tier: result.tier || "common",
      amount: Math.max(0, Number(result.amount) || 0),
      durationDays: Math.max(0, Math.min(7, Number(result.durationDays) || 0)),
      itemId: String(result.itemId || result.furnitureId || result.action || result.theme || "").slice(0, 50),
      pool: pool === "up" ? "up" : "standard",
      guaranteed: result.guaranteed === true,
    };
    state.gacha.history = [entry, ...history].slice(0, 50);
    return result;
  }

  function rollGachaReward(state, actions, random, now) {
    const rng = typeof random === "function" ? random : Math.random;
    const pullNumber = (state.gacha.pulls || 0) + 1;
    state.gacha.pulls = pullNumber;
    const pity = pullNumber % GACHA_PITY_PULLS === 0;
    let top;
    if (pity) {
      top = randomEntry(GACHA_PITY_PRIZES, rng);
    } else {
      const topRoll = Math.floor(rng() * 1000000);
      top = GACHA_TOP_PRIZES.find((entry) => topRoll < entry.until);
    }
    if (top) {
      state.coins += top.amount;
      state.totalEarned += top.amount;
      return recordGachaHistory(
        state,
        {
          ok: true,
          type: "coins",
          label: `${top.tierLabel} · 金币 +${top.amount.toLocaleString("zh-CN")}`,
          amount: top.amount,
          tier: top.tier,
          tierLabel: top.tierLabel,
          guaranteed: pity,
        },
        now
      );
    }

    const roll = rng();
    const items = Object.values(SHOP_ITEMS).filter((item) => item.type === "food" || item.type === "toy");
    const buffItems = Object.values(SHOP_ITEMS).filter(
      (item) => item.type === "buff" && item.listed !== false
    );
    const dressActions = (Array.isArray(actions) ? actions : []).filter(
      (action) => action && action.category === "dress"
    );
    const lockedDress = dressActions
      .map((action, index) => ({
        kind: "dress",
        id: action.name,
        item: action,
        price: dressPrice(index, action.name),
      }))
      .filter((source) => source.id && dressListed(source.id) && !state.unlocked.includes(source.id));
    const permanentFurniture = new Set((state.room && state.room.furniture) || []);
    const timedFurniture = Object.values(FURNITURE).filter(
      (item) => item.id !== "companion" && item.listed !== false && !permanentFurniture.has(item.id)
    );
    const timedOutfits = [
      ...lockedDress,
      ...Object.values(SHOP_ITEMS)
        .filter(
          (item) => item.type === "fashion" && item.listed !== false && !state.unlocked.includes(item.id)
        )
        .map((item) => ({ kind: "fashion", id: item.id, item, price: item.price })),
    ];
    const themes = Object.values(SHOP_ITEMS).filter(
      (item) => item.type === "theme" && !state.perks[`theme_${item.theme}`]
    );

    if (roll < GACHA_BRANCH_ENDS.commonCoins) {
      const amount = gachaCommonCoinAmount(rng);
      state.coins += amount;
      state.totalEarned += amount;
      return recordGachaHistory(
        state,
        { ok: true, type: "coins", label: `金币 +${amount}`, amount, tier: "common" },
        now
      );
    }
    if (roll < GACHA_BRANCH_ENDS.consumable && items.length) {
      const item = randomEntry(items, rng);
      state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
      return recordGachaHistory(
        state,
        { ok: true, type: "item", label: `${item.icon} ${item.name}`, tier: "common" },
        now
      );
    }
    if (roll < GACHA_BRANCH_ENDS.timedFurniture && timedFurniture.length) {
      return recordGachaHistory(
        state,
        grantGachaFurniture(
          state,
          gachaWeightedEntry(timedFurniture, rng, (item) => gachaPriceWeight(item.price)),
          rng,
          now
        ),
        now
      );
    }
    if (roll < GACHA_BRANCH_ENDS.buff && buffItems.length) {
      const item = randomEntry(buffItems, rng);
      return recordGachaHistory(state, grantGachaBuff(state, item, now), now);
    }
    if (roll < GACHA_BRANCH_ENDS.timedOutfit && timedOutfits.length) {
      return recordGachaHistory(
        state,
        grantGachaOutfit(
          state,
          gachaWeightedEntry(timedOutfits, rng, (source) => gachaPriceWeight(source.price)),
          rng,
          now
        ),
        now
      );
    }
    if (roll < GACHA_BRANCH_ENDS.legacyOutfitUnlock && lockedDress.length) {
      const source = gachaWeightedEntry(lockedDress, rng, (entry) => gachaPriceWeight(entry.price));
      const action = source.item;
      state.unlocked.push(action.name);
      return recordGachaHistory(
        state,
        {
          ok: true,
          type: "dress",
          label: `解锁「${action.label}」`,
          action: action.name,
          tier: "rare",
        },
        now
      );
    }
    if (themes.length) {
      const theme = randomEntry(themes, rng);
      state.perks[`theme_${theme.theme}`] = true;
      state.settings.theme = theme.theme;
      return recordGachaHistory(
        state,
        {
          ok: true,
          type: "theme",
          label: `${theme.icon} ${theme.name}`,
          theme: theme.theme,
          tier: "rare",
        },
        now
      );
    }
    const amount = 300;
    state.coins += amount;
    state.totalEarned += amount;
    return recordGachaHistory(
      state,
      { ok: true, type: "coins", label: `金币 +${amount}`, amount, tier: "common" },
      now
    );
  }

  /** 扭蛋：普通奖 + 四档金币大奖；每 80 抽从 50万 / 5万 / 5000 金币中随机保底。 */
  function pullGacha(state, actions, now, random) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (state.coins < GACHA_PRICE) return { ok: false, reason: "coin" };
    state.coins -= GACHA_PRICE;
    return rollGachaReward(state, actions, random, ts);
  }

  function pullGachaMany(state, actions, count, now, random) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const draws = Math.max(1, Math.min(10, Math.round(Number(count) || 1)));
    const cost = draws === 10 ? GACHA_TEN_PRICE : draws * GACHA_PRICE;
    if (state.coins < cost) return { ok: false, reason: "coin", cost };
    state.coins -= cost;
    const results = [];
    for (let index = 0; index < draws; index += 1) {
      results.push(rollGachaReward(state, actions, random, ts));
    }
    return { ok: true, cost, count: draws, results };
  }

  function gachaUpActive(now) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return ts >= GACHA_UP_START && ts < GACHA_UP_END;
  }

  function grantUpCollection(state, item, duplicateCoins, now, guaranteed) {
    if (state.perks[item.id]) {
      state.coins += duplicateCoins;
      state.totalEarned += duplicateCoins;
      return recordGachaHistory(
        state,
        {
          ok: true,
          type: "coins",
          label: `${item.icon} ${item.name}（重复）折算 +${duplicateCoins.toLocaleString("zh-CN")} 金币`,
          amount: duplicateCoins,
          itemId: item.id,
          tier: item.id === GACHA_UP_BIG_ID ? "mythic" : "legendary",
          guaranteed,
        },
        now,
        "up"
      );
    }
    state.perks[item.id] = true;
    return recordGachaHistory(
      state,
      {
        ok: true,
        type: "luxury",
        rewardCategory: "collection",
        label: `${item.icon} 典藏道具「${item.name}」`,
        itemId: item.id,
        tier: item.id === GACHA_UP_BIG_ID ? "mythic" : "legendary",
        guaranteed,
      },
      now,
      "up"
    );
  }

  function rollUpGachaReward(state, actions, random, now) {
    const rng = typeof random === "function" ? random : Math.random;
    state.gacha.upPulls = (state.gacha.upPulls || 0) + 1;
    state.gacha.upPity = Math.max(0, Number(state.gacha.upPity) || 0) + 1;
    const guaranteed = state.gacha.upPity >= GACHA_UP_PITY_PULLS;
    const bigItem = SHOP_ITEMS[GACHA_UP_BIG_ID];
    if (guaranteed || Math.floor(rng() * 1000000) < GACHA_UP_BRANCH_ENDS.bigCollection) {
      state.gacha.upPity = 0;
      return grantUpCollection(state, bigItem, GACHA_UP_BIG_DUPLICATE_COINS, now, guaranteed);
    }

    const roll = Math.floor(rng() * 1000000);
    if (roll < GACHA_UP_BRANCH_ENDS.officeCollection) {
      return grantUpCollection(
        state,
        SHOP_ITEMS[GACHA_UP_OFFICE_ID],
        GACHA_UP_OFFICE_DUPLICATE_COINS,
        now,
        false
      );
    }

    const items = Object.values(SHOP_ITEMS).filter((item) => item.type === "food" || item.type === "toy");
    const buffItems = Object.values(SHOP_ITEMS).filter(
      (item) => item.type === "buff" && item.listed !== false
    );
    const dressActions = (Array.isArray(actions) ? actions : []).filter(
      (action) => action && action.category === "dress"
    );
    const lockedDress = dressActions
      .map((action, index) => ({
        kind: "dress",
        id: action.name,
        item: action,
        price: dressPrice(index, action.name),
      }))
      .filter((source) => source.id && dressListed(source.id) && !state.unlocked.includes(source.id));
    const permanentFurniture = new Set((state.room && state.room.furniture) || []);
    const timedFurniture = Object.values(FURNITURE).filter(
      (item) => item.id !== "companion" && item.listed !== false && !permanentFurniture.has(item.id)
    );
    const timedOutfits = [
      ...lockedDress,
      ...Object.values(SHOP_ITEMS)
        .filter(
          (item) => item.type === "fashion" && item.listed !== false && !state.unlocked.includes(item.id)
        )
        .map((item) => ({ kind: "fashion", id: item.id, item, price: item.price })),
    ];

    if (roll < GACHA_UP_BRANCH_ENDS.commonCoins) {
      const amount = gachaCommonCoinAmount(rng);
      state.coins += amount;
      state.totalEarned += amount;
      return recordGachaHistory(
        state,
        { ok: true, type: "coins", label: `金币 +${amount}`, amount, tier: "common" },
        now,
        "up"
      );
    }
    if (roll < GACHA_UP_BRANCH_ENDS.consumable && items.length) {
      const item = randomEntry(items, rng);
      state.inventory[item.id] = (state.inventory[item.id] || 0) + 1;
      return recordGachaHistory(
        state,
        { ok: true, type: "item", label: `${item.icon} ${item.name}`, itemId: item.id, tier: "common" },
        now,
        "up"
      );
    }
    if (roll < GACHA_UP_BRANCH_ENDS.timedFurniture && timedFurniture.length) {
      return recordGachaHistory(
        state,
        grantGachaFurniture(
          state,
          gachaWeightedEntry(timedFurniture, rng, (item) => gachaPriceWeight(item.price)),
          rng,
          now
        ),
        now,
        "up"
      );
    }
    if (roll < GACHA_UP_BRANCH_ENDS.buff && buffItems.length) {
      return recordGachaHistory(state, grantGachaBuff(state, randomEntry(buffItems, rng), now), now, "up");
    }
    if (roll < GACHA_UP_BRANCH_ENDS.timedOutfit && timedOutfits.length) {
      return recordGachaHistory(
        state,
        grantGachaOutfit(
          state,
          gachaWeightedEntry(timedOutfits, rng, (source) => gachaPriceWeight(source.price)),
          rng,
          now
        ),
        now,
        "up"
      );
    }
    if (roll < GACHA_UP_BRANCH_ENDS.legacyOutfitUnlock && lockedDress.length) {
      const source = gachaWeightedEntry(lockedDress, rng, (entry) => gachaPriceWeight(entry.price));
      state.unlocked.push(source.item.name);
      return recordGachaHistory(
        state,
        {
          ok: true,
          type: "dress",
          label: `解锁「${source.item.label || source.item.name}」`,
          action: source.item.name,
          tier: "rare",
        },
        now,
        "up"
      );
    }

    const amount = 100 + Math.floor(rng() * 401);
    state.coins += amount;
    state.totalEarned += amount;
    return recordGachaHistory(
      state,
      { ok: true, type: "coins", label: `金币 +${amount}`, amount, tier: "common" },
      now,
      "up"
    );
  }

  function pullUpGacha(state, actions, now, random) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    if (!gachaUpActive(ts)) return { ok: false, reason: "up-ended" };
    if (state.coins < GACHA_UP_PRICE) return { ok: false, reason: "coin", cost: GACHA_UP_PRICE };
    state.coins -= GACHA_UP_PRICE;
    return rollUpGachaReward(state, actions, random, ts);
  }

  function pullUpGachaMany(state, actions, count, now, random) {
    const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const draws = Math.max(1, Math.min(10, Math.round(Number(count) || 1)));
    const cost = draws === 10 ? GACHA_UP_TEN_PRICE : draws * GACHA_UP_PRICE;
    if (!gachaUpActive(ts)) return { ok: false, reason: "up-ended", cost };
    if (state.coins < cost) return { ok: false, reason: "coin", cost };
    state.coins -= cost;
    const results = [];
    for (let index = 0; index < draws; index += 1) {
      results.push(rollUpGachaReward(state, actions, random, ts));
    }
    return { ok: true, cost, count: draws, results };
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
    const collected = Math.max(0, Math.round(Number(score) || 0));
    const reward = collected * MINIGAME_COIN_VALUE;
    state.coins += reward;
    state.totalEarned += reward;
    state.minigame = { lastPlayedAt: ts };
    awardTrainingPoints(state, minigameTrainingGain(collected), "minigame");
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
    ensureDaily(state, now).progress.visitors += 1;
    addIntimacy(state, 8, now);
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
      if (!ownsFurniture(state, "companion", now)) return { ok: false, reason: "missing" };
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
    const owned = activeFurnitureIds(state);
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
    applyCatalog,
    extractShopEntitlements,
    mergeShopEntitlements,
    actionKind,
    SHOP_ITEMS,
    BLACK_TOWER_FLOORS,
    CHAMPION_BY_BOARD,
    CHAMPION_ITEM_IDS,
    LEADERBOARD_BOARD_IDS,
    CHAMPION_SCORE_MULTIPLIER,
    CHAMPION_INCOME_BONUS,
    PREFERENCE_ITEM_IDS,
    DAILY_TASKS,
    ACHIEVEMENTS,
    WISH_CATEGORIES,
    INTIMACY_LEVELS,
    INTIMACY_ACTIONS,
    GACHA_PRICE,
    GACHA_TEN_PRICE,
    GACHA_PITY_PULLS,
    GACHA_UP_ID,
    GACHA_UP_VERSION,
    GACHA_UP_START,
    GACHA_UP_END,
    GACHA_UP_PRICE,
    GACHA_UP_TEN_PRICE,
    GACHA_UP_PITY_PULLS,
    GACHA_UP_BIG_ID,
    GACHA_UP_OFFICE_ID,
    GACHA_UP_BIG_DUPLICATE_COINS,
    GACHA_UP_OFFICE_DUPLICATE_COINS,
    GACHA_UP_RATES,
    GACHA_POOLS,
    GACHA_COMMON_COIN_LOW_RATE,
    GACHA_COMMON_COIN_LOW_MIN,
    GACHA_COMMON_COIN_LOW_MAX,
    GACHA_COMMON_COIN_HIGH_MIN,
    GACHA_COMMON_COIN_HIGH_MAX,
    GACHA_PITY_PRIZES,
    GACHA_RATES,
    GACHA_LIMITED_DAYS,
    GACHA_TOP_PRIZES,
    gachaPriceWeight,
    gachaUpActive,
    BANK_HOURS,
    BANK_RATE,
    MINIGAME_COOLDOWN_MS,
    MINIGAME_COIN_VALUE,
    FURNITURE,
    DRESS_BASE_PRICE,
    DRESS_PRICE_STEP,
    RENTAL_DAYS,
    PERMANENT_PRICE_MULTIPLIER,
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
    isStickerHidden,
    hideBuiltInSticker,
    restoreBuiltInStickers,
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
    dressScore,
    dressListed,
    rentalPrice,
    rentalExpiresAt,
    rentalActive,
    isFashionActive,
    toggleFashion,
    ownsFurniture,
    activeFurnitureIds,
    furnitureScore,
    fashionScore,
    collectionScore,
    leaderboardScores,
    applyChampionAwards,
    applyLeaderboardPrivileges,
    activeChampionBoards,
    championPermanentIncomeBonus,
    championIncomeBonus,
    activeBuff,
    activeIncomeBuffMultiplier,
    shopItemPrice,
    cultivationItemCount,
    purchase,
    purchaseMany,
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
    titleForState,
    intimacyLevelForPoints,
    intimacyStatus,
    addIntimacy,
    intimacyActionUnlocked,
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
    pullGachaMany,
    pullUpGacha,
    pullUpGachaMany,
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
    fastingStatus,
    luxuryIncomeBonus,
    permanentIncomeBonus,
    tick,
    settleOffline,
    feed,
    play,
    cultivationStatus,
    totalCultivationAmount,
    spiritualPowerCapacity,
    recoverSpiritualPower,
    combatStats,
    combatRecoveryRate,
    blackTowerStatus,
    setBlackTowerFloor,
    challengeBlackTower,
    startBlackTowerBattle,
    advanceBlackTowerBattle,
    setBlackTowerAutomation,
    toggleBlackTowerPause,
    nextBlackTowerFloor,
    buySpiritStones,
    setSpiritStoneTier,
    setStoneQuantities,
    techniqueStatus,
    addTechniqueScroll,
    studyTechnique,
    equipTechnique,
    unequipTechnique,
    rollTechniqueReward,
    setMeditation,
    settleMeditation,
    setFormation,
    travelToRegion,
    cultivate,
    settleStoneCultivation,
    endStoneCultivation,
    purchaseCultivationItem,
    takeLifePill,
    takeCultivationPill,
    attemptBreakthrough,
    collectHerbs,
    comprehendTechnique,
    mineSpiritStones,
    craftPill,
    exploreSecretRealm,
    caveHeavenStatus,
    caveEntryCost,
    enterCaveHeaven,
    resolveCaveChallenge,
    leaveCaveHeaven,
    opportunityStatus,
    drawOpportunity,
    resolveOpportunityChoice,
    OPPORTUNITIES: O,
    advanceLifespan,
    rebirthStatus,
    rebirth,
    realmLabelForLevel,
    CULTIVATION: C,
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
