/* 存档白名单与校验：主进程写入前统一过一遍，单元测试也直接用它。 */

const SAVE_MAX_BYTES = 128 * 1024;
const SAVE_VERSION = 8;

function toNumber(value, fallback, min, max) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const lo = min === undefined ? -Infinity : min;
  const hi = max === undefined ? Infinity : max;
  return Math.min(hi, Math.max(lo, parsed));
}

function toCount(value) {
  return Math.round(toNumber(value, 0, 0, 1e12));
}

function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 只保留白名单字段，并把数值夹到合理区间。
 * 返回 null 表示这份数据不能写盘（不是对象 / 序列化失败 / 体积超限 / 关键字段非法）。
 */
function sanitizeSave(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let encoded;
  try {
    encoded = JSON.stringify(raw);
  } catch (err) {
    return null;
  }
  if (!encoded || byteLength(encoded) > SAVE_MAX_BYTES) return null;
  if (!Number.isFinite(Number(raw.coins))) return null;

  const stats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
  const settings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const windowPos = raw.window && typeof raw.window === "object" ? raw.window : {};
  const rawInventory = raw.inventory && typeof raw.inventory === "object" ? raw.inventory : {};
  const rawBuffs = raw.buffs && typeof raw.buffs === "object" ? raw.buffs : {};
  const rawPerks = raw.perks && typeof raw.perks === "object" ? raw.perks : {};
  const rawShop = raw.shopStats && typeof raw.shopStats === "object" ? raw.shopStats : {};
  const rawProfile = raw.profile && typeof raw.profile === "object" ? raw.profile : {};
  const rawTraining = raw.training && typeof raw.training === "object" ? raw.training : {};
  const rawQuiz = raw.quiz && typeof raw.quiz === "object" ? raw.quiz : {};
  const rawQuizTotals = rawQuiz.totals && typeof rawQuiz.totals === "object" ? rawQuiz.totals : {};
  const rawQuizExam = rawQuiz.exam && typeof rawQuiz.exam === "object" ? rawQuiz.exam : {};
  const baseAction =
    typeof settings.baseAction === "string" && /^[a-z0-9_]{1,40}$/.test(settings.baseAction)
      ? settings.baseAction
      : undefined;

  const clean = {
    version: SAVE_VERSION,
    coins: toNumber(raw.coins, 0, 0, 1e15),
    totalEarned: toNumber(raw.totalEarned, 0, 0, 1e15),
    level: Math.round(toNumber(raw.level, 1, 1, 999)),
    satiety: toNumber(raw.satiety, 80, 0, 100),
    mood: toNumber(raw.mood, 80, 0, 100),
    lastTick: toNumber(raw.lastTick, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    createdAt: toNumber(raw.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    stats: {
      pets: toCount(stats.pets),
      feeds: toCount(stats.feeds),
      plays: toCount(stats.plays),
      upgrades: toCount(stats.upgrades),
      sessions: toCount(stats.sessions),
      scheduleAdded: toCount(stats.scheduleAdded),
    },
    inventory: Object.fromEntries(
      Object.entries(rawInventory)
        .filter(([key]) => /^[a-z_]{1,24}$/.test(key))
        .slice(0, 50)
        .map(([key, value]) => [key, toCount(value)])
    ),
    buffs: {
      double_income: toNumber(rawBuffs.double_income, 0, 0, Number.MAX_SAFE_INTEGER),
    },
    perks: {
      lucky_cat: Boolean(rawPerks.lucky_cat),
      theme_night: Boolean(rawPerks.theme_night),
      theme_mint: Boolean(rawPerks.theme_mint),
      theme_sakura: Boolean(rawPerks.theme_sakura),
      luxury_cushion: Boolean(rawPerks.luxury_cushion),
      luxury_crystal: Boolean(rawPerks.luxury_crystal),
      luxury_office: Boolean(rawPerks.luxury_office),
      luxury_estate: Boolean(rawPerks.luxury_estate),
      luxury_hourglass: Boolean(rawPerks.luxury_hourglass),
    },
    unlocked: Array.isArray(raw.unlocked)
      ? raw.unlocked
          .filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name))
          .slice(0, 500)
      : [],
    favorites: Array.isArray(raw.favorites)
      ? raw.favorites
          .filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name))
          .slice(0, 200)
      : [],
    recent: Array.isArray(raw.recent)
      ? raw.recent.filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name)).slice(0, 20)
      : [],
    stickerRandom: Object.fromEntries(
      Object.entries(raw.stickerRandom && typeof raw.stickerRandom === "object" ? raw.stickerRandom : {})
        .filter(([name, value]) => /^[a-z0-9_]{1,40}$/.test(name) && typeof value === "boolean")
        .slice(0, 400)
    ),
    stickerLabels: Object.fromEntries(
      Object.entries(raw.stickerLabels && typeof raw.stickerLabels === "object" ? raw.stickerLabels : {})
        .filter(([name, value]) => /^[a-z0-9_]{1,40}$/.test(name) && typeof value === "string")
        .slice(0, 400)
        .map(([name, value]) => [name, value.trim().slice(0, 16)])
        .filter(([, value]) => Boolean(value))
    ),
    schedule: Array.isArray(raw.schedule)
      ? raw.schedule
          .filter((item) => item && typeof item === "object")
          .slice(0, 20)
          .map((item) => ({
            id: String(item.id || "").slice(0, 24),
            time: /^([01]\d|2[0-3]):([0-5]\d)$/.test(item.time) ? item.time : "09:00",
            text: String(item.text || "").slice(0, 30),
            action: typeof item.action === "string" ? item.action.slice(0, 40) : null,
            repeat: ["once", "weekdays", "weekend"].includes(item.repeat) ? item.repeat : "daily",
            doneDate: String(item.doneDate || "").slice(0, 10),
            notifiedDate: String(item.notifiedDate || "").slice(0, 10),
          }))
      : [],
    shopStats: {
      purchases: toCount(rawShop.purchases),
      spent: toNumber(rawShop.spent, 0, 0, 1e15),
    },
    daily: {
      date: String((raw.daily && raw.daily.date) || "").slice(0, 10),
      progress: {
        pets: toCount(raw.daily && raw.daily.progress && raw.daily.progress.pets),
        feeds: toCount(raw.daily && raw.daily.progress && raw.daily.progress.feeds),
        plays: toCount(raw.daily && raw.daily.progress && raw.daily.progress.plays),
        actionsViewed: toCount(raw.daily && raw.daily.progress && raw.daily.progress.actionsViewed),
      },
      claimed: Array.isArray(raw.daily && raw.daily.claimed)
        ? raw.daily.claimed.filter((id) => typeof id === "string").slice(0, 20)
        : [],
    },
    achievements: Array.isArray(raw.achievements)
      ? raw.achievements.filter((id) => typeof id === "string").slice(0, 100)
      : [],
    seenActions: Array.isArray(raw.seenActions)
      ? raw.seenActions.filter((name) => typeof name === "string").slice(0, 500)
      : [],
    wish:
      raw.wish && typeof raw.wish === "object"
        ? {
            id: String(raw.wish.id || "").slice(0, 24),
            category: String(raw.wish.category || "").slice(0, 20),
            group: String(raw.wish.group || "").slice(0, 20),
            reward: toNumber(raw.wish.reward, 0, 0, 100000),
            expiresAt: toNumber(raw.wish.expiresAt, 0, 0, Number.MAX_SAFE_INTEGER),
          }
        : null,
    checkin: {
      lastDate: String((raw.checkin && raw.checkin.lastDate) || "").slice(0, 10),
      streak: toCount(raw.checkin && raw.checkin.streak),
    },
    bank: {
      amount: toNumber(raw.bank && raw.bank.amount, 0, 0, 1e15),
      dueAt: toNumber(raw.bank && raw.bank.dueAt, 0, 0, Number.MAX_SAFE_INTEGER),
    },
    gacha: { pulls: toCount(raw.gacha && raw.gacha.pulls) },
    minigame: {
      lastPlayedAt: toNumber(raw.minigame && raw.minigame.lastPlayedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    },
    visitor:
      raw.visitor && typeof raw.visitor === "object"
        ? {
            kind: String(raw.visitor.kind || "").slice(0, 20),
            label: String(raw.visitor.label || "").slice(0, 30),
            icon: String(raw.visitor.icon || "").slice(0, 4),
            reward: toNumber(raw.visitor.reward, 0, 0, 100000),
            expiresAt: toNumber(raw.visitor.expiresAt, 0, 0, Number.MAX_SAFE_INTEGER),
          }
        : null,
    nextVisitorAt: toNumber(raw.nextVisitorAt, 0, 0, Number.MAX_SAFE_INTEGER),
    room: {
      furniture: Array.isArray(raw.room && raw.room.furniture)
        ? raw.room.furniture.filter((id) => typeof id === "string").slice(0, 20)
        : [],
    },
    companion: { adopted: Boolean(raw.companion && raw.companion.adopted) },
    profile: {
      personality: ["gentle", "clever", "diligent", "gourmet", "playful"].includes(rawProfile.personality)
        ? rawProfile.personality
        : "gentle",
      likes: Array.isArray(rawProfile.likes)
        ? rawProfile.likes
            .filter((id) => ["fish", "milk_tea", "cake", "hotpot", "wand", "bubble", "gameboy"].includes(id))
            .slice(0, 2)
        : [],
      dislikes: Array.isArray(rawProfile.dislikes)
        ? rawProfile.dislikes
            .filter((id) => ["fish", "milk_tea", "cake", "hotpot", "wand", "bubble", "gameboy"].includes(id))
            .slice(0, 1)
        : [],
      reshapes: toCount(rawProfile.reshapes),
    },
    training: {
      points: toCount(rawTraining.points),
      totalEarned: toCount(rawTraining.totalEarned),
      totalSpent: toCount(rawTraining.totalSpent),
      learned: Array.isArray(rawTraining.learned)
        ? rawTraining.learned
            .filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name))
            .slice(0, 500)
        : [],
    },
    quiz: {
      examCode: /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(String(rawQuiz.examCode || ""))
        ? String(rawQuiz.examCode).slice(0, 40)
        : "architect",
      dailyDate: /^\d{4}-\d{2}-\d{2}$/.test(rawQuiz.dailyDate) ? rawQuiz.dailyDate : "",
      dailyDone: rawQuiz.dailyDone === true,
      dailyCorrect: rawQuiz.dailyCorrect === true,
      eventReadyAt: toNumber(rawQuiz.eventReadyAt, 0, 0, Number.MAX_SAFE_INTEGER),
      totals: {
        answered: toCount(rawQuizTotals.answered),
        correct: toCount(rawQuizTotals.correct),
        wrong: toCount(rawQuizTotals.wrong),
        earned: toNumber(rawQuizTotals.earned, 0, 0, 1e15),
        spent: toNumber(rawQuizTotals.spent, 0, 0, 1e15),
      },
      exam: {
        taken: toCount(rawQuizExam.taken),
        bestScore: toNumber(rawQuizExam.bestScore, 0, 0, 999),
        lastScore: toNumber(rawQuizExam.lastScore, 0, 0, 999),
        lastPassed: rawQuizExam.lastPassed === true,
      },
      history: Array.isArray(rawQuiz.history)
        ? rawQuiz.history
            .filter((item) => item && typeof item === "object")
            .slice(-20)
            .map((item) => ({
              at: toNumber(item.at, 0, 0, Number.MAX_SAFE_INTEGER),
              mode: ["daily", "quiz", "random", "event", "exam"].includes(item.mode) ? item.mode : "random",
              correct: toCount(item.correct),
              total: toCount(item.total),
              delta: toNumber(item.delta, 0, -100000, 100000),
            }))
        : [],
    },
    metrics: {
      days: Object.fromEntries(
        Object.entries((raw.metrics && raw.metrics.days) || {})
          .filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key))
          .slice(-60)
          .map(([key, value]) => [key, toNumber(value, 0, 0, 86400)])
      ),
    },
    window: {
      x: Number.isFinite(Number(windowPos.x)) ? Math.round(Number(windowPos.x)) : null,
      y: Number.isFinite(Number(windowPos.y)) ? Math.round(Number(windowPos.y)) : null,
    },
    settings: {
      alwaysOnTop: settings.alwaysOnTop !== false,
      clickThrough: settings.clickThrough !== false,
      autoLaunch: Boolean(settings.autoLaunch),
      showBubble: settings.showBubble !== false,
      autoWalk: Boolean(settings.autoWalk),
      scale: toNumber(settings.scale, 1, 0.6, 1.8),
      ambientIntervalSec: toNumber(settings.ambientIntervalSec, 60, 5, 600),
      autoWalkIntervalSec: toNumber(settings.autoWalkIntervalSec, 45, 10, 600),
      safeMode: settings.safeMode !== false,
      sound: settings.sound !== false,
      theme: ["default", "night", "mint", "sakura"].includes(settings.theme) ? settings.theme : "default",
      analytics: settings.analytics === true,
      followCursor: Boolean(settings.followCursor),
      dnd: Boolean(settings.dnd),
      roamSpeed: toNumber(settings.roamSpeed, 55, 20, 200),
      quizApiBase: /^https?:\/\/[^\s/]+/i.test(String(settings.quizApiBase || ""))
        ? String(settings.quizApiBase).slice(0, 200)
        : "http://192.168.0.193:9300",
      updateFeedUrl: /^https?:\/\/[^\s/]+/i.test(String(settings.updateFeedUrl || ""))
        ? String(settings.updateFeedUrl).slice(0, 200)
        : "http://192.168.0.193:9400/updates",
      updateAutoCheck: settings.updateAutoCheck !== false,
    },
  };
  if (baseAction) clean.settings.baseAction = baseAction;
  return clean;
}

module.exports = { SAVE_MAX_BYTES, SAVE_VERSION, sanitizeSave, toNumber, toCount, byteLength };
