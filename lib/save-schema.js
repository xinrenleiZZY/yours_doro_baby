/* 存档白名单与校验：主进程写入前统一过一遍，单元测试也直接用它。 */

const SAVE_MAX_BYTES = 128 * 1024;
const SAVE_VERSION = 2;

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
    },
  };
  if (baseAction) clean.settings.baseAction = baseAction;
  return clean;
}

module.exports = { SAVE_MAX_BYTES, SAVE_VERSION, sanitizeSave, toNumber, toCount, byteLength };
