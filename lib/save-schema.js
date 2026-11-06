/* 存档白名单与校验：主进程写入前统一过一遍，单元测试也直接用它。 */

const SAVE_MAX_BYTES = 128 * 1024;
const SAVE_VERSION = 28;
const MAX_ATTRIBUTE = 99999;
const MAX_TECHNIQUE_MASTERY = 99999;
const ELEMENT_ORDER = ["metal", "wood", "water", "fire", "earth"];

function isRootId(value) {
  if (
    [
      "metal",
      "wood",
      "water",
      "fire",
      "earth",
      "mixed",
      "innate",
      "ice",
      "thunder",
      "light",
      "dark",
      "chaos",
    ].includes(value)
  ) {
    return true;
  }
  if (typeof value !== "string") return false;
  const parts = value.split("_");
  const prefix = parts.shift();
  const expected = { dual: 2, triple: 3, quad: 4 }[prefix];
  if (!expected || parts.length !== expected) return false;
  let previous = -1;
  return parts.every((part) => {
    const index = ELEMENT_ORDER.indexOf(part);
    if (index <= previous) return false;
    previous = index;
    return true;
  });
}

function isTechniqueId(value) {
  return typeof value === "string" && /^tech_[a-z][a-z0-9_]{2,120}$/.test(value);
}

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
  const rawWork = raw.work && typeof raw.work === "object" ? raw.work : {};
  const rawPrestige = raw.prestige && typeof raw.prestige === "object" ? raw.prestige : {};
  const rawCultivation = raw.cultivation && typeof raw.cultivation === "object" ? raw.cultivation : {};
  const rawCultAttributes =
    rawCultivation.attributes && typeof rawCultivation.attributes === "object"
      ? rawCultivation.attributes
      : {};
  const rawCultPills =
    rawCultivation.pills && typeof rawCultivation.pills === "object" ? rawCultivation.pills : {};
  const rawStones =
    rawCultivation.stones && typeof rawCultivation.stones === "object" ? rawCultivation.stones : {};
  const rawMeditation =
    rawCultivation.meditation && typeof rawCultivation.meditation === "object"
      ? rawCultivation.meditation
      : {};
  const rawStoneSession =
    rawCultivation.stoneSession && typeof rawCultivation.stoneSession === "object"
      ? rawCultivation.stoneSession
      : {};
  const rawCave = rawCultivation.cave && typeof rawCultivation.cave === "object" ? rawCultivation.cave : {};
  const rawPillUse =
    rawCultivation.cultivationPillUse && typeof rawCultivation.cultivationPillUse === "object"
      ? rawCultivation.cultivationPillUse
      : {};
  const rawTower =
    rawCultivation.blackTower && typeof rawCultivation.blackTower === "object"
      ? rawCultivation.blackTower
      : {};
  const rawTowerResult =
    rawTower.lastResult && typeof rawTower.lastResult === "object" ? rawTower.lastResult : null;
  const rawSoul = rawCultivation.soul && typeof rawCultivation.soul === "object" ? rawCultivation.soul : {};
  const rawTechniqueScrolls =
    rawCultivation.techniqueScrolls && typeof rawCultivation.techniqueScrolls === "object"
      ? rawCultivation.techniqueScrolls
      : {};
  const rawIntimacy = raw.intimacy && typeof raw.intimacy === "object" ? raw.intimacy : {};
  const rawDiary = raw.diary && typeof raw.diary === "object" ? raw.diary : {};
  const rawQuiz = raw.quiz && typeof raw.quiz === "object" ? raw.quiz : {};
  const rawQuizTotals = rawQuiz.totals && typeof rawQuiz.totals === "object" ? rawQuiz.totals : {};
  const rawQuizExam = rawQuiz.exam && typeof rawQuiz.exam === "object" ? rawQuiz.exam : {};
  const rawOpportunities =
    raw.opportunities && typeof raw.opportunities === "object" ? raw.opportunities : {};
  const baseAction =
    typeof settings.baseAction === "string" && /^[a-z0-9_]{1,40}$/.test(settings.baseAction)
      ? settings.baseAction
      : undefined;

  const clean = {
    version: SAVE_VERSION,
    coins: toNumber(raw.coins, 0, 0, 1e15),
    totalEarned: toNumber(raw.totalEarned, 0, 0, 1e15),
    level: Math.round(toNumber(raw.level, 1, 1, 999)),
    cultivation: {
      version: 1,
      attributes: {
        root: isRootId(rawCultAttributes.root) ? rawCultAttributes.root : "mixed",
        insight: Math.round(toNumber(rawCultAttributes.insight, 50, 1, MAX_ATTRIBUTE)),
        fortune: Math.round(toNumber(rawCultAttributes.fortune, 50, 1, MAX_ATTRIBUTE)),
        daoHeart: Math.round(toNumber(rawCultAttributes.daoHeart, 60, 0, MAX_ATTRIBUTE)),
        lifespan: Math.round(toNumber(rawCultAttributes.lifespan, 90, 20, MAX_ATTRIBUTE)),
        rootLineage: Math.round(toNumber(rawCultAttributes.rootLineage, 0, 0, 100)),
      },
      exp: toNumber(rawCultivation.exp, 0, 0, 1e100),
      age: toNumber(rawCultivation.age, 0, 0, 1e7),
      lastAgedAt: toNumber(rawCultivation.lastAgedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      bonusLifespan: toNumber(rawCultivation.bonusLifespan, 0, 0, 1e7),
      technique: toNumber(rawCultivation.technique, 0, 0, MAX_TECHNIQUE_MASTERY),
      techniqueReadyAt: toNumber(rawCultivation.techniqueReadyAt, 0, 0, Number.MAX_SAFE_INTEGER),
      spiritStones: Math.round(toNumber(rawStones.low, rawCultivation.spiritStones, 0, 1e9)),
      stones: {
        low: Math.round(toNumber(rawStones.low, rawCultivation.spiritStones, 0, 1e9)),
        mid: Math.round(toNumber(rawStones.mid, 0, 0, 1e9)),
        high: Math.round(toNumber(rawStones.high, 0, 0, 1e9)),
        supreme: Math.round(toNumber(rawStones.supreme, 0, 0, 1e9)),
      },
      selectedStoneTier: ["low", "mid", "high", "supreme"].includes(rawCultivation.selectedStoneTier)
        ? rawCultivation.selectedStoneTier
        : "low",
      buyQuantity: Math.round(toNumber(rawCultivation.buyQuantity, 10, 1, 9999)),
      consumeQuantity: Math.round(toNumber(rawCultivation.consumeQuantity, 1, 1, 9999)),
      cultivationPillUse: {
        level: Math.round(toNumber(rawPillUse.level, 0, 0, 999)),
        count: Math.round(toNumber(rawPillUse.count, 0, 0, 2)),
      },
      stoneSession: {
        active: rawStoneSession.active === true,
        startedAt: toNumber(rawStoneSession.startedAt, 0, 0, Number.MAX_SAFE_INTEGER),
        endsAt: toNumber(rawStoneSession.endsAt, 0, 0, Number.MAX_SAFE_INTEGER),
        completedAt: toNumber(rawStoneSession.completedAt, 0, 0, Number.MAX_SAFE_INTEGER),
        quantity: Math.round(toNumber(rawStoneSession.quantity, 0, 0, 9999)),
        tier: ["low", "mid", "high", "supreme"].includes(rawStoneSession.tier) ? rawStoneSession.tier : "low",
        totalEnergy: toNumber(rawStoneSession.totalEnergy, 0, 0, 1e12),
        energyPerSecond: toNumber(rawStoneSession.energyPerSecond, 0, 0, 1e12),
        durationMs: toNumber(rawStoneSession.durationMs, 0, 0, Number.MAX_SAFE_INTEGER),
        settledEnergy: toNumber(rawStoneSession.settledEnergy, 0, 0, 1e12),
        endedEarly: rawStoneSession.endedEarly === true,
        gained: toNumber(rawStoneSession.gained, 0, 0, 1e100),
        levelsGained: Math.round(toNumber(rawStoneSession.levelsGained, 0, 0, 999)),
        noProgress: rawStoneSession.noProgress === true,
        epiphany: rawStoneSession.epiphany === true,
        damaged: toNumber(rawStoneSession.damaged, 0, 0, 1e100),
        techniqueGain: toNumber(rawStoneSession.techniqueGain, 0, 0, 1000),
      },
      regionId: [
        "qingju_plain",
        "luoxia_slope",
        "chenghu_marsh",
        "qingmu_forest",
        "redflame_valley",
        "xuanshui_ravine",
        "ghost_realm",
        "herb_valley",
        "windthunder_plateau",
        "glaze_mine",
        "cloudsea_peak",
        "ancient_citadel",
      ].includes(rawCultivation.regionId)
        ? rawCultivation.regionId
        : "qingju_plain",
      formationId: ["none", "gathering", "minor", "five_elements", "stars"].includes(
        rawCultivation.formationId
      )
        ? rawCultivation.formationId
        : "gathering",
      meditation: {
        active: rawMeditation.active === true,
        lastAt: toNumber(rawMeditation.lastAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
        totalSeconds: toNumber(rawMeditation.totalSeconds, 0, 0, 1e12),
      },
      spiritualPower: toNumber(rawCultivation.spiritualPower, 100, 0, 1e100),
      spiritualPowerMax: toNumber(rawCultivation.spiritualPowerMax, 100, 100, 1e100),
      spiritualPowerUpdatedAt: toNumber(
        rawCultivation.spiritualPowerUpdatedAt,
        Date.now(),
        0,
        Number.MAX_SAFE_INTEGER
      ),
      blackTower: {
        selectedFloor: Math.round(toNumber(rawTower.selectedFloor, 1, 1, 10)),
        bestFloor: Math.round(toNumber(rawTower.bestFloor, 0, 0, 10)),
        attempts: toCount(rawTower.attempts),
        wins: toCount(rawTower.wins),
        lastResult: rawTowerResult
          ? {
              floor: Math.round(toNumber(rawTowerResult.floor, 0, 0, 10)),
              enemy: String(rawTowerResult.enemy || "").slice(0, 40),
              outcome: rawTowerResult.outcome === "win" ? "win" : "loss",
              gained: toNumber(rawTowerResult.gained, 0, 0, 1e100),
              spent: toNumber(rawTowerResult.spent, 0, 0, 1e100),
              at: toNumber(rawTowerResult.at, 0, 0, Number.MAX_SAFE_INTEGER),
            }
          : null,
      },
      cave: {
        refreshAt: toNumber(rawCave.refreshAt, 0, 0, Number.MAX_SAFE_INTEGER),
        spots: Array.isArray(rawCave.spots)
          ? rawCave.spots
              .filter((spot) => spot && typeof spot === "object")
              .slice(0, 10)
              .map((spot) => ({
                id: String(spot.id || "").slice(0, 40),
                size: spot.size === "large" ? "large" : "small",
                qiMultiplier: toNumber(spot.qiMultiplier, 1, 1, 3),
                effectType: ["cultivation", "technique", "breakthrough"].includes(spot.effectType)
                  ? spot.effectType
                  : "cultivation",
                effectValue: toNumber(spot.effectValue, 0, 0, 2),
              }))
              .filter((spot) => /^[a-z][a-z0-9_]{1,40}$/.test(spot.id))
          : [],
        active:
          rawCave.active && typeof rawCave.active === "object"
            ? {
                id: String(rawCave.active.id || "").slice(0, 40),
                size: rawCave.active.size === "large" ? "large" : "small",
                qiMultiplier: toNumber(rawCave.active.qiMultiplier, 1, 1, 3),
                effectType: ["cultivation", "technique", "breakthrough"].includes(rawCave.active.effectType)
                  ? rawCave.active.effectType
                  : "cultivation",
                effectValue: toNumber(rawCave.active.effectValue, 0, 0, 2),
                enteredAt: toNumber(rawCave.active.enteredAt, 0, 0, Number.MAX_SAFE_INTEGER),
                expiresAt: toNumber(rawCave.active.expiresAt, 0, 0, Number.MAX_SAFE_INTEGER),
              }
            : null,
        challenge:
          rawCave.challenge && typeof rawCave.challenge === "object"
            ? {
                id: String(rawCave.challenge.id || "").slice(0, 40),
                size: "large",
                qiMultiplier: toNumber(rawCave.challenge.qiMultiplier, 1.8, 1, 3),
                effectType: ["cultivation", "technique", "breakthrough"].includes(
                  rawCave.challenge.effectType
                )
                  ? rawCave.challenge.effectType
                  : "cultivation",
                effectValue: toNumber(rawCave.challenge.effectValue, 0, 0, 2),
                guardian: String(rawCave.challenge.guardian || "洞天守灵").slice(0, 40),
                createdAt: toNumber(rawCave.challenge.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
              }
            : null,
        readyAt: toNumber(rawCave.readyAt, 0, 0, Number.MAX_SAFE_INTEGER),
        visits: Math.round(toNumber(rawCave.visits, 0, 0, 1e9)),
        lastLoot:
          rawCave.lastLoot && typeof rawCave.lastLoot === "object"
            ? {
                techniqueName: String(rawCave.lastLoot.techniqueName || "").slice(0, 100),
                pillName: String(rawCave.lastLoot.pillName || "").slice(0, 40),
                at: toNumber(rawCave.lastLoot.at, 0, 0, Number.MAX_SAFE_INTEGER),
              }
            : null,
      },
      soul: {
        level: Math.round(toNumber(rawSoul.level, 0, 0, 999)),
        count: Math.round(toNumber(rawSoul.count, 0, 0, 1e9)),
        root: isRootId(rawSoul.root) ? rawSoul.root : "",
        attributeBonus: Math.round(toNumber(rawSoul.attributeBonus, 0, 0, MAX_ATTRIBUTE)),
      },
      techniqueScrolls: Object.fromEntries(
        Object.entries(rawTechniqueScrolls)
          .filter(([id, count]) => isTechniqueId(id) && Number.isFinite(Number(count)))
          .slice(0, 600)
          .map(([id, count]) => [id, Math.round(toNumber(count, 0, 0, 999))])
          .filter(([, count]) => count > 0)
      ),
      techniquesKnown: Array.isArray(rawCultivation.techniquesKnown)
        ? [...new Set(rawCultivation.techniquesKnown.filter((id) => isTechniqueId(id)))].slice(0, 600)
        : [],
      techniqueProgress: Object.fromEntries(
        Object.entries(
          rawCultivation.techniqueProgress && typeof rawCultivation.techniqueProgress === "object"
            ? rawCultivation.techniqueProgress
            : {}
        )
          .filter(([id, value]) => isTechniqueId(id) && Number.isFinite(Number(value)))
          .slice(0, 600)
          .map(([id, value]) => [id, toNumber(value, 0, 0, 100)])
      ),
      equippedTechniques: Array.isArray(rawCultivation.equippedTechniques)
        ? [
            ...new Set(
              rawCultivation.equippedTechniques.filter((id) => typeof id === "string" && isTechniqueId(id))
            ),
          ].slice(0, 5)
        : [],
      equippedTechnique: isTechniqueId(rawCultivation.equippedTechnique)
        ? rawCultivation.equippedTechnique
        : "",
      herbs: Math.round(toNumber(rawCultivation.herbs, 0, 0, 1e9)),
      pills: {
        breakthrough: Math.round(toNumber(rawCultPills.breakthrough, 0, 0, 1e6)),
        life: Math.round(toNumber(rawCultPills.life, 0, 0, 1e6)),
        technique: Math.round(toNumber(rawCultPills.technique, 0, 0, 1e6)),
        cultivation: Math.round(toNumber(rawCultPills.cultivation, 0, 0, 1e6)),
        heart: Math.round(toNumber(rawCultPills.heart, 0, 0, 1e6)),
      },
      thunderPearls: Math.round(toNumber(rawCultivation.thunderPearls, 0, 0, 1e6)),
      cooldownUntil: toNumber(rawCultivation.cooldownUntil, 0, 0, Number.MAX_SAFE_INTEGER),
      herbReadyAt: toNumber(rawCultivation.herbReadyAt, 0, 0, Number.MAX_SAFE_INTEGER),
      mineReadyAt: toNumber(rawCultivation.mineReadyAt, 0, 0, Number.MAX_SAFE_INTEGER),
      alchemyReadyAt: toNumber(rawCultivation.alchemyReadyAt, 0, 0, Number.MAX_SAFE_INTEGER),
      secretReadyAt: toNumber(rawCultivation.secretReadyAt, 0, 0, Number.MAX_SAFE_INTEGER),
      karma: Math.round(toNumber(rawCultivation.karma, 0, 0, 1e9)),
      demonized: rawCultivation.demonized === true,
      cycle: Math.round(toNumber(rawCultivation.cycle, 0, 0, 1e9)),
      epiphanyCount: Math.round(toNumber(rawCultivation.epiphanyCount, 0, 0, 1e9)),
      lastBreakthrough:
        rawCultivation.lastBreakthrough && typeof rawCultivation.lastBreakthrough === "object"
          ? {
              level: Math.round(toNumber(rawCultivation.lastBreakthrough.level, 1, 1, 999)),
              at: toNumber(rawCultivation.lastBreakthrough.at, 0, 0, Number.MAX_SAFE_INTEGER),
              chance: toNumber(rawCultivation.lastBreakthrough.chance, 0, 0, 1),
              route: rawCultivation.lastBreakthrough.route === "mind" ? "mind" : "pill",
            }
          : null,
      lastLifeEvent:
        rawCultivation.lastLifeEvent && typeof rawCultivation.lastLifeEvent === "object"
          ? {
              type: rawCultivation.lastLifeEvent.type === "rebirth" ? "rebirth" : "lifespan",
              at: toNumber(rawCultivation.lastLifeEvent.at, 0, 0, Number.MAX_SAFE_INTEGER),
              age: toNumber(rawCultivation.lastLifeEvent.age, 0, 0, 1e7),
              level: Math.round(toNumber(rawCultivation.lastLifeEvent.level, 1, 1, 999)),
              carried: ["root", "insight", "fortune", "daoHeart", "lifespan"].includes(
                rawCultivation.lastLifeEvent.carried
              )
                ? rawCultivation.lastLifeEvent.carried
                : "",
            }
          : null,
    },
    opportunities: {
      version: 1,
      activeId:
        typeof rawOpportunities.activeId === "string" &&
        /^[a-z][a-z0-9_]{1,60}$/.test(rawOpportunities.activeId)
          ? rawOpportunities.activeId
          : "",
      readyAt: toNumber(rawOpportunities.readyAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
      draws: Math.round(toNumber(rawOpportunities.draws, 0, 0, 1e7)),
      seen: Object.fromEntries(
        Object.entries(
          rawOpportunities.seen && typeof rawOpportunities.seen === "object" ? rawOpportunities.seen : {}
        )
          .filter(([id]) => /^[a-z][a-z0-9_]{1,60}$/.test(id))
          .slice(0, 60)
          .map(([id, count]) => [id, Math.round(toNumber(count, 0, 0, 10000))])
      ),
      flags: Object.fromEntries(
        Object.entries(
          rawOpportunities.flags && typeof rawOpportunities.flags === "object" ? rawOpportunities.flags : {}
        )
          .filter(([key, value]) => /^[a-z0-9_]{1,60}$/.test(key) && typeof value === "boolean")
          .slice(0, 120)
      ),
      history: Array.isArray(rawOpportunities.history)
        ? rawOpportunities.history
            .filter((entry) => entry && typeof entry === "object")
            .slice(-50)
            .map((entry) => ({
              eventId:
                typeof entry.eventId === "string" && /^[a-z][a-z0-9_]{1,60}$/.test(entry.eventId)
                  ? entry.eventId
                  : "",
              eventTitle: String(entry.eventTitle || "").slice(0, 80),
              choiceId: String(entry.choiceId || "").slice(0, 60),
              choiceText: String(entry.choiceText || "").slice(0, 160),
              outcome: ["success", "failure", "resolved"].includes(entry.outcome)
                ? entry.outcome
                : "resolved",
              text: String(entry.text || "").slice(0, 500),
              effectsText: String(entry.effectsText || "").slice(0, 300),
              at: toNumber(entry.at, 0, 0, Number.MAX_SAFE_INTEGER),
              draw: Math.round(toNumber(entry.draw, 0, 0, 1e7)),
            }))
            .filter((entry) => entry.eventId)
        : [],
      lastOutcome:
        rawOpportunities.lastOutcome && typeof rawOpportunities.lastOutcome === "object"
          ? {
              eventId: String(rawOpportunities.lastOutcome.eventId || "").slice(0, 60),
              eventTitle: String(rawOpportunities.lastOutcome.eventTitle || "").slice(0, 80),
              outcome: ["success", "failure", "resolved"].includes(rawOpportunities.lastOutcome.outcome)
                ? rawOpportunities.lastOutcome.outcome
                : "resolved",
              text: String(rawOpportunities.lastOutcome.text || "").slice(0, 500),
              effectsText: String(rawOpportunities.lastOutcome.effectsText || "").slice(0, 300),
              at: toNumber(rawOpportunities.lastOutcome.at, 0, 0, Number.MAX_SAFE_INTEGER),
            }
          : null,
    },
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
    buffs: Object.fromEntries(
      Object.entries(rawBuffs)
        .filter(
          ([key]) =>
            /^[a-z][a-z0-9_]{0,39}$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key)
        )
        .slice(0, 50)
        .map(([key, value]) => [key, toNumber(value, 0, 0, Number.MAX_SAFE_INTEGER)])
    ),
    perks: Object.fromEntries(
      Object.entries(rawPerks)
        .filter(
          ([id, enabled]) =>
            enabled === true &&
            /^[a-z][a-z0-9_]{0,39}$/.test(id) &&
            !["__proto__", "constructor", "prototype"].includes(id)
        )
        .slice(0, 300)
        .map(([id]) => [id, true])
    ),
    unlocked: Array.isArray(raw.unlocked)
      ? raw.unlocked
          .filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name))
          .slice(0, 500)
      : [],
    rentals: {
      furniture: Object.fromEntries(
        Object.entries((raw.rentals && raw.rentals.furniture) || {})
          .filter(
            ([id, expiresAt]) =>
              /^[a-z0-9_]{1,40}$/.test(id) && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0
          )
          .slice(0, 100)
          .map(([id, expiresAt]) => [id, Number(expiresAt)])
      ),
      dress: Object.fromEntries(
        Object.entries((raw.rentals && raw.rentals.dress) || {})
          .filter(
            ([id, expiresAt]) =>
              /^[a-z0-9_]{1,40}$/.test(id) && Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0
          )
          .slice(0, 200)
          .map(([id, expiresAt]) => [id, Number(expiresAt)])
      ),
    },
    leaderboardBoosts: {
      period: /^\d{4}-\d{2}-\d{2}$/.test(
        String((raw.leaderboardBoosts && raw.leaderboardBoosts.period) || "")
      )
        ? String(raw.leaderboardBoosts.period)
        : "",
      activeUntil: toNumber(
        raw.leaderboardBoosts && raw.leaderboardBoosts.activeUntil,
        0,
        0,
        Number.MAX_SAFE_INTEGER
      ),
      boards: Array.isArray(raw.leaderboardBoosts && raw.leaderboardBoosts.boards)
        ? [
            ...new Set(
              raw.leaderboardBoosts.boards.filter((board) =>
                ["level", "furniture", "fashion", "collection"].includes(board)
              )
            ),
          ].slice(0, 4)
        : [],
    },
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
    stickerHidden: Array.isArray(raw.stickerHidden)
      ? raw.stickerHidden
          .filter((name) => typeof name === "string" && /^[a-z0-9_]{1,40}$/.test(name))
          .slice(0, 400)
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
        coinsEarned: toNumber(raw.daily && raw.daily.progress && raw.daily.progress.coinsEarned, 0, 0, 1e15),
        visitors: toCount(raw.daily && raw.daily.progress && raw.daily.progress.visitors),
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
    gacha: {
      pulls: toCount(raw.gacha && raw.gacha.pulls),
      upPulls: toCount(raw.gacha && raw.gacha.upPulls),
      upPity: toNumber(raw.gacha && raw.gacha.upPity, 0, 0, 300),
      history: Array.isArray(raw.gacha && raw.gacha.history)
        ? raw.gacha.history
            .filter((entry) => entry && typeof entry === "object" && typeof entry.label === "string")
            .slice(0, 50)
            .map((entry) => ({
              at: toNumber(entry.at, 0, 0, Number.MAX_SAFE_INTEGER),
              type: String(entry.type || "").slice(0, 20),
              label: String(entry.label).slice(0, 100),
              tier: ["common", "rare", "jackpot", "super", "legendary", "mythic"].includes(entry.tier)
                ? entry.tier
                : "common",
              amount: toNumber(entry.amount, 0, 0, 100000000),
              durationDays: toNumber(entry.durationDays, 0, 0, 7),
              itemId: String(entry.itemId || "").slice(0, 50),
              pool: entry.pool === "up" ? "up" : "standard",
              guaranteed: entry.guaranteed === true,
            }))
        : [],
    },
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
        ? raw.room.furniture.filter((id) => typeof id === "string").slice(0, 100)
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
    work: {
      jobs: Array.isArray(rawWork.jobs)
        ? rawWork.jobs
            .filter(
              (job) =>
                job &&
                ["visitor", "companion"].includes(job.worker) &&
                ["coins", "food", "fragments"].includes(job.reward && job.reward.type)
            )
            .slice(0, 2)
            .map((job) => ({
              id: String(job.id || "").slice(0, 30),
              worker: job.worker,
              label: String(job.label || "打工者").slice(0, 30),
              icon: String(job.icon || "💼").slice(0, 4),
              hours: [2, 4, 8].includes(Number(job.hours)) ? Number(job.hours) : 2,
              startedAt: toNumber(job.startedAt, 0, 0, Number.MAX_SAFE_INTEGER),
              endsAt: toNumber(job.endsAt, 0, 0, Number.MAX_SAFE_INTEGER),
              reward: {
                type: job.reward.type,
                amount: toNumber(job.reward.amount, 0, 0, 1e12),
                itemId: typeof job.reward.itemId === "string" ? job.reward.itemId.slice(0, 24) : "",
              },
            }))
        : [],
      fragments: toCount(rawWork.fragments),
      completed: toCount(rawWork.completed),
    },
    prestige: {
      count: toCount(rawPrestige.count),
      legacyLevel: toNumber(rawPrestige.legacyLevel, 0, 0, 1e9),
    },
    intimacy: {
      points: toCount(rawIntimacy.points),
      dailyDate: String(rawIntimacy.dailyDate || "").slice(0, 10),
      dailyPoints: toCount(rawIntimacy.dailyPoints),
    },
    diary: {
      entries: Array.isArray(rawDiary.entries)
        ? rawDiary.entries
            .filter((entry) => entry && typeof entry.text === "string")
            .slice(-30)
            .map((entry) => ({
              date: String(entry.date || "").slice(0, 10),
              text: entry.text.slice(0, 500),
            }))
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
      equippedFashion:
        typeof settings.equippedFashion === "string" &&
        /^fashion_[a-z0-9_]{1,32}$/.test(settings.equippedFashion)
          ? settings.equippedFashion
          : "",
      quizApiBase: /^https?:\/\/[^\s/]+/i.test(String(settings.quizApiBase || ""))
        ? String(settings.quizApiBase).slice(0, 200)
        : "http://192.168.0.193:9300",
      updateFeedUrl: /^https?:\/\/[^\s/]+/i.test(String(settings.updateFeedUrl || ""))
        ? String(settings.updateFeedUrl).slice(0, 200)
        : "http://192.168.0.193:9400/updates",
      updateAutoCheck: settings.updateAutoCheck !== false,
      autoFeed: settings.autoFeed === true,
      shortcuts: Object.fromEntries(
        ["toggle", "summon", "chat"].map((key) => [
          key,
          typeof (settings.shortcuts && settings.shortcuts[key]) === "string" &&
          /^[A-Za-z0-9+_-]{1,64}$/.test(settings.shortcuts[key].trim())
            ? settings.shortcuts[key].trim()
            : { toggle: "CommandOrControl+Alt+D", summon: "CommandOrControl+Alt+R", chat: "CommandOrControl+Alt+C" }[
                key
              ],
        ])
      ),
    },
  };
  if (baseAction) clean.settings.baseAction = baseAction;
  return clean;
}

module.exports = { SAVE_MAX_BYTES, SAVE_VERSION, sanitizeSave, toNumber, toCount, byteLength };
