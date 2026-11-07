/* global module, self */
/*
 * 修仙成长系统的纯规则层。
 * 不依赖 DOM / Electron，主进程、渲染进程和单元测试共用同一套数值。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DoroCultivation = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = 2;
  const MAX_LEVEL = 999;
  const MAX_ATTRIBUTE = 99999;
  const MAX_TECHNIQUE_MASTERY = 99999;
  const DAY_MS = 86400000;
  const SPIRIT_STONE_PRICE = 50;
  const MAJOR_BREAKTHROUGH_COOLDOWN_MS = 10 * 60000;
  const EXP_BASE = 100;
  const REALM_EXP_FACTOR = 6;
  const LAYER_EXP_FACTOR = 1.3;
  const BREAKTHROUGH_EXP_FACTOR = 4;

  const STONE_TIERS = Object.freeze({
    low: { id: "low", name: "下品灵石", short: "下品", energy: 10, price: 50 },
    mid: { id: "mid", name: "中品灵石", short: "中品", energy: 100, price: 300 },
    high: { id: "high", name: "上品灵石", short: "上品", energy: 1000, price: 1800 },
    supreme: { id: "supreme", name: "极品灵石", short: "极品", energy: 10000, price: 10800 },
  });

  const FORMATIONS = Object.freeze({
    none: { id: "none", name: "无阵法", multiplier: 1, minLevel: 1 },
    gathering: { id: "gathering", name: "聚气阵", multiplier: 1.2, minLevel: 1 },
    minor: { id: "minor", name: "小聚灵阵", multiplier: 1.5, minLevel: 21 },
    five_elements: { id: "five_elements", name: "五行聚灵阵", multiplier: 2, minLevel: 41 },
    stars: { id: "stars", name: "周天星斗阵", multiplier: 3, minLevel: 61 },
  });

  const TECHNIQUE_TIERS = Object.freeze([
    { id: "yellow", name: "黄阶", rank: 1, price: 600 },
    { id: "mystic", name: "玄阶", rank: 2, price: 3000 },
    { id: "earth", name: "地阶", rank: 3, price: 15000 },
    { id: "heaven", name: "天阶", rank: 4, price: 80000 },
  ]);
  const TECHNIQUE_GRADES = Object.freeze([
    { id: "lower", name: "下品", rank: 1, priceMultiplier: 1 },
    { id: "middle", name: "中品", rank: 2, priceMultiplier: 1.8 },
    { id: "upper", name: "上品", rank: 3, priceMultiplier: 3 },
  ]);
  const TECHNIQUE_CATEGORIES = Object.freeze({
    heart: Object.freeze({
      id: "heart",
      name: "心法",
      icon: "☯",
      desc: "凝练道基，主要提升修炼效率与突破稳定性。",
      gainWeight: 1,
      breakthroughWeight: 1.2,
    }),
    spell: Object.freeze({
      id: "spell",
      name: "法术",
      icon: "✦",
      desc: "运转灵气，兼顾修炼速度与功法领悟。",
      gainWeight: 0.8,
      breakthroughWeight: 0.85,
    }),
    combat: Object.freeze({
      id: "combat",
      name: "战技",
      icon: "⚔",
      desc: "淬炼攻伐之意，偏重突破与功法领悟。",
      gainWeight: 0.5,
      breakthroughWeight: 1,
    }),
    movement: Object.freeze({
      id: "movement",
      name: "身法",
      icon: "🌀",
      desc: "调和身与气，提供较均衡的修炼加成。",
      gainWeight: 0.6,
      breakthroughWeight: 0.75,
    }),
    body: Object.freeze({
      id: "body",
      name: "体术",
      icon: "🛡",
      desc: "以肉身承载灵力，增强突破时的根基。",
      gainWeight: 0.65,
      breakthroughWeight: 1.1,
    }),
  });
  const TECHNIQUE_CATEGORY_MATRIX = Object.freeze([
    Object.freeze(["body", "movement", "spell"]),
    Object.freeze(["combat", "movement", "spell"]),
    Object.freeze(["combat", "spell", "heart"]),
    Object.freeze(["combat", "spell", "heart"]),
  ]);
  const MEDITATION_HOURLY_RATE = 0.02;
  const MEDITATION_OFFLINE_CAP_HOURS = 12;

  const ORANGE_CONTINENT = Object.freeze({
    id: "orange_continent",
    name: "橘子大陆",
    desc: "所有修士第一次降生的大陆，当前只开放部分区域",
  });

  const ORANGE_REGIONS = Object.freeze([
    {
      id: "qingju_plain",
      name: "青橘原",
      minLevel: 1,
      qi: 1,
      trait: "灵气平稳，适合初次引气入体",
      herbBonus: 0,
      stoneBonus: 0,
      damageRate: 0,
    },
    {
      id: "luoxia_slope",
      name: "落霞坡",
      minLevel: 1,
      qi: 0.9,
      trait: "晚霞润物，灵药更容易长成",
      herbBonus: 0.35,
      stoneBonus: 0,
      damageRate: 0,
    },
    {
      id: "chenghu_marsh",
      name: "澄湖泽",
      minLevel: 1,
      qi: 1.08,
      trait: "水脉丰沛，更容易采到中品灵石",
      herbBonus: 0.1,
      stoneBonus: 0.12,
      damageRate: 0,
    },
    {
      id: "qingmu_forest",
      name: "青木林",
      minLevel: 11,
      qi: 1.15,
      trait: "木灵旺盛，灵药产出增加",
      herbBonus: 0.5,
      stoneBonus: 0.02,
      damageRate: 0.01,
    },
    {
      id: "redflame_valley",
      name: "赤焰谷",
      minLevel: 21,
      qi: 1.3,
      trait: "火灵气狂暴，修炼快但偶尔灼伤修为",
      herbBonus: -0.2,
      stoneBonus: 0.06,
      damageRate: 0.04,
    },
    {
      id: "xuanshui_ravine",
      name: "玄水涧",
      minLevel: 31,
      qi: 1.22,
      trait: "水灵矿脉密集，高品质灵石概率提升",
      herbBonus: 0.1,
      stoneBonus: 0.24,
      damageRate: 0.01,
    },
    {
      id: "ghost_realm",
      name: "幽冥鬼蜮",
      minLevel: 41,
      qi: 1.55,
      trait: "阴气浓郁，修炼极快但鬼物会侵蚀修为",
      herbBonus: -0.4,
      stoneBonus: 0.12,
      damageRate: 0.08,
    },
    {
      id: "herb_valley",
      name: "百草灵谷",
      minLevel: 51,
      qi: 1.25,
      trait: "药香凝而不散，灵药和延寿材料丰厚",
      herbBonus: 0.8,
      stoneBonus: 0.08,
      damageRate: 0.01,
    },
    {
      id: "windthunder_plateau",
      name: "风雷台",
      minLevel: 61,
      qi: 1.4,
      trait: "雷灵气淬体，修炼快但劫雷更活跃",
      herbBonus: -0.25,
      stoneBonus: 0.16,
      damageRate: 0.05,
    },
    {
      id: "glaze_mine",
      name: "琉璃矿脉",
      minLevel: 71,
      qi: 1.12,
      trait: "灵石矿富集，灵石品质显著提升",
      herbBonus: -0.4,
      stoneBonus: 0.45,
      damageRate: 0.02,
    },
    {
      id: "cloudsea_peak",
      name: "云海峰",
      minLevel: 81,
      qi: 1.65,
      trait: "云海灵气纯净，顿悟概率提高",
      herbBonus: 0.2,
      stoneBonus: 0.15,
      damageRate: 0.015,
    },
    {
      id: "ancient_citadel",
      name: "古橘仙城",
      minLevel: 91,
      qi: 1.8,
      trait: "古城遗迹灵气充盈，奇遇与危险并存",
      herbBonus: 0.25,
      stoneBonus: 0.3,
      damageRate: 0.06,
    },
  ]);

  const CAVE_HEAVENS = Object.freeze([
    {
      id: "primordial_spring",
      name: "太初灵泉",
      icon: "💧",
      desc: "灵泉自地脉深处涌出，水声与呼吸同频。",
    },
    {
      id: "nine_stars_palace",
      name: "九曜星宫",
      icon: "✨",
      desc: "九道星光垂落成阶，尽头悬着一座无门星宫。",
    },
    {
      id: "verdant_realm",
      name: "青木长生界",
      icon: "🌿",
      desc: "古木参天，落叶落地便化为新芽。",
    },
    {
      id: "red_cloud_fire_palace",
      name: "赤霄火府",
      icon: "🔥",
      desc: "云霞被地火染红，石缝中流淌着熔金。",
    },
    {
      id: "ice_jade_court",
      name: "玄冰玉阙",
      icon: "❄",
      desc: "万载寒冰雕成宫阙，连时间都像被冻结。",
    },
    {
      id: "thunder_pool",
      name: "雷泽天池",
      icon: "⚡",
      desc: "雷光在池底盘旋，水面却没有一丝波纹。",
    },
    {
      id: "golden_sword_tomb",
      name: "金阙剑冢",
      icon: "⚔",
      desc: "无数断剑插满山谷，风过时齐声低鸣。",
    },
    {
      id: "returning_sea_mirage",
      name: "归墟幻海",
      icon: "🌊",
      desc: "海面倒映着尚未发生的明日，潮声忽远忽近。",
    },
    {
      id: "myriad_beast_cloud",
      name: "万兽云庭",
      icon: "🦌",
      desc: "云上草原有灵兽踏风而行，留下发光蹄印。",
    },
    {
      id: "chaos_relic",
      name: "混沌遗境",
      icon: "🌌",
      desc: "天地尚未分开的遗迹，五行灵气在此混作一团。",
    },
  ]);

  const CAVE_EFFECTS = Object.freeze({
    cultivation: Object.freeze({ id: "cultivation", name: "灵气灌体", desc: "修为获取提高" }),
    technique: Object.freeze({ id: "technique", name: "万法回响", desc: "功法修炼进度加快" }),
    breakthrough: Object.freeze({ id: "breakthrough", name: "道基共鸣", desc: "破境成功率提高" }),
  });
  const CAVE_GUARDIANS = Object.freeze([
    "赤甲妖獒",
    "吞星蟒",
    "石魄傀儡",
    "雷羽妖禽",
    "冰甲巨犀",
    "古剑残灵",
    "梦魇幻兽",
  ]);

  const CULTIVATION_PILLS = Object.freeze({
    breakthrough: Object.freeze({ id: "breakthrough", name: "破境丹", icon: "🧪" }),
    life: Object.freeze({ id: "life", name: "延寿丹", icon: "🍥" }),
    technique: Object.freeze({ id: "technique", name: "悟道丹", icon: "📖" }),
    cultivation: Object.freeze({ id: "cultivation", name: "培元丹", icon: "🌀" }),
    heart: Object.freeze({ id: "heart", name: "静心丹", icon: "🪷" }),
    bigu: Object.freeze({ id: "bigu", name: "辟谷丹", icon: "🌙" }),
  });
  const DEFAULT_SHORTCUTS = Object.freeze({
    toggle: "CommandOrControl+Alt+D",
    summon: "CommandOrControl+Alt+R",
    chat: "CommandOrControl+Alt+C",
  });

  const ATTRIBUTE_KEYS = Object.freeze(["root", "insight", "fortune", "daoHeart", "lifespan"]);
  const ATTRIBUTE_META = Object.freeze({
    root: { label: "灵根", icon: "☯", desc: "决定修炼速度与突破稳定度" },
    insight: { label: "悟性", icon: "✦", desc: "影响功法领悟、突破成功率和顿悟" },
    fortune: { label: "福缘", icon: "🍀", desc: "影响奇遇、丹药掉落和天劫强度" },
    daoHeart: { label: "道心", icon: "🪷", desc: "抵抗心魔；归零后进入魔修分支" },
    lifespan: { label: "寿元", icon: "⌛", desc: "寿元耗尽会陨落并重新投胎" },
  });

  const ELEMENT_ORDER = Object.freeze(["metal", "wood", "water", "fire", "earth"]);
  const ELEMENTS = Object.freeze({
    metal: Object.freeze({ id: "metal", name: "金", icon: "⚔" }),
    wood: Object.freeze({ id: "wood", name: "木", icon: "🌿" }),
    water: Object.freeze({ id: "water", name: "水", icon: "💧" }),
    fire: Object.freeze({ id: "fire", name: "火", icon: "🔥" }),
    earth: Object.freeze({ id: "earth", name: "土", icon: "⛰" }),
  });
  const GENERATING_PAIRS = new Set(["metal_water", "wood_water", "wood_fire", "fire_earth", "metal_earth"]);
  const SINGLE_ROOT_BONUSES = Object.freeze({
    metal: Object.freeze({
      icon: "⚔",
      breakthrough: 0.035,
      noProgress: 0.06,
      desc: "锋锐进取，攻守兼备，适合剑修与体修。",
      flagship: "白虹贯日剑诀",
    }),
    wood: Object.freeze({
      icon: "🌿",
      breakthrough: 0.055,
      noProgress: 0.055,
      lifespanBonus: 12,
      desc: "生机绵长，恢复与阵法见长，突破最稳。",
      flagship: "太清木灵功",
    }),
    water: Object.freeze({
      icon: "💧",
      breakthrough: 0.065,
      noProgress: 0.05,
      desc: "心念澄澈，变化与辅助能力最丰富。",
      flagship: "万变流水诀",
    }),
    fire: Object.freeze({
      icon: "🔥",
      breakthrough: 0.015,
      noProgress: 0.075,
      desc: "灵力炽烈，攻击爆发最强，突破波动较大。",
      flagship: "烈阳真火诀",
    }),
    earth: Object.freeze({
      icon: "⛰",
      breakthrough: 0.08,
      noProgress: 0.05,
      desc: "厚土承载，根基与防御最稳。",
      flagship: "磐石金身诀",
    }),
  });

  function comboElements(size) {
    const combinations = [];
    const pick = (start, picked) => {
      if (picked.length === size) {
        combinations.push(picked.slice());
        return;
      }
      for (let index = start; index < ELEMENT_ORDER.length; index += 1) {
        picked.push(ELEMENT_ORDER[index]);
        pick(index + 1, picked);
        picked.pop();
      }
    };
    pick(0, []);
    return combinations;
  }

  function pairKey(elements) {
    return [...elements]
      .sort((left, right) => ELEMENT_ORDER.indexOf(left) - ELEMENT_ORDER.indexOf(right))
      .join("_");
  }

  const singleRoots = Object.fromEntries(
    ELEMENT_ORDER.map((elementId) => {
      const element = ELEMENTS[elementId];
      const bonus = SINGLE_ROOT_BONUSES[elementId];
      return [
        elementId,
        Object.freeze({
          id: elementId,
          name: `${element.name}灵根`,
          shortName: `${element.name}灵根`,
          icon: bonus.icon,
          kind: "single",
          tierRank: 2,
          tierLabel: "单灵根",
          elements: Object.freeze([elementId]),
          gain: 1,
          speedLabel: "1 倍",
          breakthrough: bonus.breakthrough,
          noProgress: bonus.noProgress,
          soulPower: 1,
          lifespanBonus: bonus.lifespanBonus || 0,
          tribulationRelief: 0.03,
          techniqueScope: "单属性高阶功法",
          talentCap: "渡劫期",
          desc: bonus.desc,
          flagship: bonus.flagship,
          priceFactor: 1.2,
        }),
      ];
    })
  );

  const multiRootSpecs = [
    {
      prefix: "dual",
      size: 2,
      tierRank: 3,
      tierLabel: "双灵根",
      suffix: "双灵根",
      gainCoherent: 0.7,
      gainConflicting: 0.6,
      breakthroughCoherent: 0.015,
      breakthroughConflicting: -0.055,
      noProgress: 0.1,
      soulPower: 0.92,
      techniqueScope: "双属性配合功法",
      talentCap: "大乘期",
      priceFactor: 1.08,
    },
    {
      prefix: "triple",
      size: 3,
      tierRank: 4,
      tierLabel: "三灵根",
      suffix: "三灵根",
      gain: 0.4,
      breakthrough: -0.08,
      noProgress: 0.14,
      soulPower: 0.82,
      techniqueScope: "通用中阶功法",
      talentCap: "合体期",
      priceFactor: 0.96,
    },
    {
      prefix: "quad",
      size: 4,
      tierRank: 5,
      tierLabel: "四灵根",
      suffix: "四灵根",
      gain: 0.25,
      breakthrough: -0.14,
      noProgress: 0.18,
      soulPower: 0.72,
      techniqueScope: "通用低阶功法",
      talentCap: "化神期（极难）",
      priceFactor: 0.86,
    },
  ];

  const multiRoots = Object.fromEntries(
    multiRootSpecs.flatMap((spec) =>
      comboElements(spec.size).map((elements) => {
        const coherent = spec.size === 2 && GENERATING_PAIRS.has(pairKey(elements));
        const id = `${spec.prefix}_${elements.join("_")}`;
        const name = `${elements.map((elementId) => ELEMENTS[elementId].name).join("")}${spec.suffix}`;
        const gain =
          spec.gain === undefined ? (coherent ? spec.gainCoherent : spec.gainConflicting) : spec.gain;
        const breakthrough =
          spec.breakthrough === undefined
            ? coherent
              ? spec.breakthroughCoherent
              : spec.breakthroughConflicting
            : spec.breakthrough;
        return [
          id,
          Object.freeze({
            id,
            name,
            shortName: name,
            icon: elements.map((elementId) => ELEMENTS[elementId].icon).join(""),
            kind: spec.prefix,
            tierRank: spec.tierRank,
            tierLabel: spec.tierLabel,
            elements: Object.freeze(elements),
            gain,
            speedLabel: spec.size === 2 ? (coherent ? "0.7 倍（相生）" : "0.6 倍（相克）") : `${gain} 倍`,
            breakthrough,
            noProgress: spec.noProgress,
            soulPower: spec.soulPower,
            lifespanBonus: elements.includes("wood") ? 5 : 0,
            tribulationRelief: spec.size === 2 ? (coherent ? 0.015 : -0.035) : -0.05 * (spec.size - 2),
            techniqueScope: spec.techniqueScope,
            talentCap: spec.talentCap,
            desc:
              spec.size === 2
                ? coherent
                  ? "双属性相生，灵力流转协调，适合双属性配合功法。"
                  : "双属性彼此争夺丹田，需要特殊功法调和经脉。"
                : `${elements.length} 种灵气同驻丹田，协调困难，适合通用型功法。`,
            flagship: spec.size === 2 && coherent ? `${name}·双炼诀` : "太极混元功",
            priceFactor: spec.priceFactor,
          }),
        ];
      })
    )
  );

  const ROOTS = Object.freeze({
    ...singleRoots,
    ...multiRoots,
    mixed: Object.freeze({
      id: "mixed",
      name: "五灵根（杂灵根）",
      shortName: "五灵根",
      icon: "🌀",
      kind: "mixed",
      tierRank: 6,
      tierLabel: "五灵根",
      elements: ELEMENT_ORDER,
      gain: 0.1,
      speedLabel: "0.1 倍",
      breakthrough: -0.2,
      noProgress: 0.24,
      soulPower: 0.6,
      lifespanBonus: 3,
      tribulationRelief: -0.08,
      techniqueScope: "五行平衡特殊功法",
      talentCap: "金丹期（稀有例外）",
      desc: "五气驳杂、修炼极慢，但寻得五行归一功法后爆发力惊人。",
      flagship: "太极混元功",
      priceFactor: 0.72,
    }),
    ice: Object.freeze({
      id: "ice",
      name: "冰灵根",
      shortName: "冰灵根",
      icon: "❄",
      kind: "variant",
      tierRank: 1,
      tierLabel: "变异灵根",
      elements: Object.freeze(["water"]),
      gain: 5,
      speedLabel: "5 倍",
      breakthrough: 0.14,
      noProgress: 0.035,
      soulPower: 1.55,
      lifespanBonus: 15,
      tribulationRelief: 0.25,
      techniqueScope: "冰系极品功法",
      talentCap: "飞升仙界",
      desc: "水系变异，寒气压过同阶灵力，可修冰魄一脉的顶级秘法。",
      flagship: "极北冰魄功",
      priceFactor: 2.4,
    }),
    thunder: Object.freeze({
      id: "thunder",
      name: "雷灵根",
      shortName: "雷灵根",
      icon: "⚡",
      kind: "variant",
      tierRank: 1,
      tierLabel: "变异灵根",
      elements: Object.freeze(["metal"]),
      gain: 7,
      speedLabel: "7 倍",
      breakthrough: 0.12,
      noProgress: 0.03,
      soulPower: 1.7,
      lifespanBonus: 8,
      tribulationRelief: 0.28,
      techniqueScope: "雷系顶级秘法",
      talentCap: "飞升仙界",
      desc: "金系变异，雷法爆发惊人，渡劫时更容易借雷淬体。",
      flagship: "九天雷霆诀",
      priceFactor: 2.6,
    }),
    light: Object.freeze({
      id: "light",
      name: "光灵根",
      shortName: "光灵根",
      icon: "☀",
      kind: "variant",
      tierRank: 1,
      tierLabel: "变异灵根",
      elements: Object.freeze(["light"]),
      gain: 5.5,
      speedLabel: "5.5 倍",
      breakthrough: 0.22,
      noProgress: 0.025,
      soulPower: 1.6,
      lifespanBonus: 25,
      tribulationRelief: 0.32,
      techniqueScope: "光系恢复与辅助功法",
      talentCap: "飞升仙界",
      desc: "超越五行的光明灵根，疗愈与护持类功法有天然优势。",
      flagship: "大日无量经",
      priceFactor: 2.5,
    }),
    dark: Object.freeze({
      id: "dark",
      name: "暗灵根",
      shortName: "阴冥灵根",
      icon: "☾",
      kind: "variant",
      tierRank: 1,
      tierLabel: "变异灵根",
      elements: Object.freeze(["dark"]),
      gain: 6,
      speedLabel: "6 倍",
      breakthrough: 0.16,
      noProgress: 0.03,
      soulPower: 1.75,
      lifespanBonus: 18,
      tribulationRelief: 0.24,
      techniqueScope: "鬼道与魔道秘典",
      talentCap: "飞升仙界",
      desc: "阴冥灵根，适合鬼道、魔道和神魂类功法。",
      flagship: "九幽阴冥录",
      priceFactor: 2.5,
    }),
    chaos: Object.freeze({
      id: "chaos",
      name: "混沌灵根",
      shortName: "混沌灵根",
      icon: "🌀",
      kind: "variant",
      tierRank: 1,
      tierLabel: "变异灵根",
      elements: ELEMENT_ORDER,
      gain: 10,
      speedLabel: "10 倍",
      breakthrough: 0.26,
      noProgress: 0.015,
      soulPower: 2,
      lifespanBonus: 40,
      tribulationRelief: 0.4,
      techniqueScope: "所有属性功法",
      talentCap: "飞升仙界",
      desc: "极度罕见，混沌之气兼容五行，理论上可修所有属性功法。",
      flagship: "鸿蒙混沌经",
      priceFactor: 4,
    }),
    innate: Object.freeze({
      id: "innate",
      name: "先天道体",
      shortName: "先天道体",
      icon: "🌌",
      kind: "innate",
      tierRank: 0,
      tierLabel: "先天道体",
      elements: ELEMENT_ORDER,
      gain: 10,
      speedLabel: "10 倍",
      breakthrough: 0.35,
      noProgress: 0.01,
      soulPower: 2.2,
      lifespanBonus: 25,
      tribulationRelief: 0.5,
      techniqueScope: "万法皆通",
      talentCap: "飞升仙界",
      desc: "亿万中无一的先天道体，万法亲近，修炼与渡劫都远超同阶。",
      flagship: "无极真气诀",
      priceFactor: 4.5,
    }),
  });

  const ROOT_DISTRIBUTION = Object.freeze([
    { kind: "innate", rate: 0.00000001, ids: Object.freeze(["innate"]) },
    { kind: "variant", rate: 0.000001, ids: Object.freeze(["ice", "thunder", "light", "dark", "chaos"]) },
    { kind: "single", rate: 0.00015, ids: Object.freeze(ELEMENT_ORDER) },
    {
      kind: "dual",
      rate: 0.001,
      ids: Object.freeze(Object.keys(multiRoots).filter((id) => id.startsWith("dual_"))),
    },
    {
      kind: "triple",
      rate: 0.01,
      ids: Object.freeze(Object.keys(multiRoots).filter((id) => id.startsWith("triple_"))),
    },
    {
      kind: "quad",
      rate: 0.1,
      ids: Object.freeze(Object.keys(multiRoots).filter((id) => id.startsWith("quad_"))),
    },
  ]);

  function techniqueCompatible(cultivation, techniqueId) {
    const root = ROOTS[cultivation && cultivation.attributes && cultivation.attributes.root];
    const technique = techniqueById(techniqueId);
    if (!root || !technique) return false;
    if (root.id === "chaos" || root.kind === "innate") return true;
    return technique.root === root.id;
  }

  const TECHNIQUES = Object.freeze(
    Object.fromEntries(
      Object.values(ROOTS).flatMap((root) =>
        TECHNIQUE_TIERS.flatMap((tier) =>
          TECHNIQUE_GRADES.map((grade) => {
            const id = `tech_${root.id}_${tier.id}_${grade.id}`;
            const category = TECHNIQUE_CATEGORIES[TECHNIQUE_CATEGORY_MATRIX[tier.rank - 1][grade.rank - 1]];
            return [
              id,
              Object.freeze({
                id,
                name:
                  tier.rank === 4 && grade.rank === 3
                    ? `${root.icon} ${root.flagship}`
                    : `${root.icon} ${root.shortName}·${tier.name}${grade.name}`,
                type: "technique",
                root: root.id,
                tier: tier.id,
                tierName: tier.name,
                tierRank: tier.rank,
                grade: grade.id,
                gradeName: grade.name,
                gradeRank: grade.rank,
                category: category.id,
                categoryName: category.name,
                categoryIcon: category.icon,
                price: Math.round(tier.price * grade.priceMultiplier * root.priceFactor),
                cultivationMultiplier: 1 + tier.rank * 0.06 + grade.rank * 0.02,
                breakthroughBonus: tier.rank * 0.012 + grade.rank * 0.005,
                masteryBonus: tier.rank * 5 + grade.rank * 2,
                desc: `${category.name} · 适合${root.name}·${root.techniqueScope}，修炼效率 +${Math.round(
                  (tier.rank * 0.06 + grade.rank * 0.02) * 100
                )}%，突破成功率 +${(tier.rank * 1.2 + grade.rank * 0.5).toFixed(1)}%`,
              }),
            ];
          })
        )
      )
    )
  );

  function rollRoot(rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const gate = random();
    let cumulative = 0;
    for (const group of ROOT_DISTRIBUTION) {
      cumulative += group.rate;
      if (gate < cumulative) {
        const index = Math.min(group.ids.length - 1, Math.floor(random() * group.ids.length));
        return group.ids[Math.max(0, index)];
      }
    }
    return "mixed";
  }

  /**
   * 判断新世随机灵根是否能与前世人灵根共生。
   * 相同灵根直接成立；多灵根只要包含前世灵根的任一属性，就视为可共生。
   */
  function rootsAreSymbiotic(previousRootId, generatedRootId) {
    const previous = ROOTS[previousRootId];
    const generated = ROOTS[generatedRootId];
    if (!previous || !generated) return false;
    if (previous.id === generated.id) return true;
    const multiKinds = new Set(["dual", "triple", "quad", "mixed"]);
    if (!multiKinds.has(generated.kind)) return false;
    return generated.elements.some((element) => previous.elements.includes(element));
  }

  const REALMS = Object.freeze([
    {
      id: "mortal",
      name: "凡人",
      start: 1,
      end: 10,
      lifespan: 0,
      permissions: ["引气入体", "打坐蓄气"],
    },
    {
      id: "qi",
      name: "炼气",
      start: 11,
      end: 20,
      lifespan: 50,
      permissions: ["打坐", "采集灵药"],
    },
    {
      id: "foundation",
      name: "筑基",
      start: 21,
      end: 30,
      lifespan: 220,
      permissions: ["御剑", "炼制丹药", "加入宗门"],
    },
    {
      id: "golden_core",
      name: "金丹",
      start: 31,
      end: 40,
      lifespan: 500,
      permissions: ["御器飞行", "中层秘境", "本命法宝"],
    },
    {
      id: "nascent",
      name: "元婴",
      start: 41,
      end: 50,
      lifespan: 1000,
      permissions: ["元婴转世", "神魂探查", "收弟子"],
    },
    {
      id: "spirit",
      name: "化神",
      start: 51,
      end: 60,
      lifespan: 1500,
      permissions: ["远距神游", "跨图瞬移", "参悟法则神通"],
    },
    {
      id: "void",
      name: "炼虚",
      start: 61,
      end: 70,
      lifespan: 2200,
      permissions: ["触摸天地法则", "虚空遁行"],
    },
    {
      id: "fusion",
      name: "合体",
      start: 71,
      end: 80,
      lifespan: 3200,
      permissions: ["肉身元神相合", "开辟洞天"],
    },
    {
      id: "mahayana",
      name: "大乘",
      start: 81,
      end: 90,
      lifespan: 5000,
      permissions: ["凡界顶点", "感悟飞升契机"],
    },
    {
      id: "tribulation",
      name: "渡劫",
      start: 91,
      end: 100,
      lifespan: 8000,
      permissions: ["飞升雷劫", "凡界法则豁免"],
    },
    {
      id: "true_immortal",
      name: "真仙",
      start: 101,
      end: 200,
      lifespan: 12000,
      permissions: ["仙界修炼", "仙灵之气"],
    },
    {
      id: "golden_immortal",
      name: "金仙",
      start: 201,
      end: 300,
      lifespan: 20000,
      permissions: ["仙体不灭", "仙界秘境"],
    },
    {
      id: "taiyi",
      name: "太乙金仙",
      start: 301,
      end: 400,
      lifespan: 35000,
      permissions: ["太乙道果", "仙界飞遁"],
    },
    {
      id: "daluo",
      name: "大罗金仙",
      start: 401,
      end: 500,
      lifespan: 60000,
      permissions: ["大罗自在", "诸天投影"],
    },
    {
      id: "immortal_lord",
      name: "仙尊",
      start: 501,
      end: 600,
      lifespan: 100000,
      permissions: ["仙界尊位", "统御一方"],
    },
    {
      id: "immortal_emperor",
      name: "仙帝",
      start: 601,
      end: MAX_LEVEL,
      lifespan: 200000,
      permissions: ["仙帝道果", "万界留名"],
    },
  ]);

  function regionById(id) {
    return ORANGE_REGIONS.find((region) => region.id === id) || null;
  }

  function chooseStartingRegion(rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const starters = ORANGE_REGIONS.filter((region) => region.minLevel <= 1);
    return starters[Math.floor(random() * starters.length) % starters.length].id;
  }

  function formationById(id) {
    return FORMATIONS[id] || FORMATIONS.none;
  }

  function techniqueById(id) {
    return TECHNIQUES[id] || null;
  }

  function activeTechnique(cultivation) {
    return activeTechniques(cultivation)[0] || null;
  }

  function techniqueProgress(cultivation, techniqueId) {
    return clamp(
      Number(cultivation && cultivation.techniqueProgress && cultivation.techniqueProgress[techniqueId]) || 0,
      0,
      100
    );
  }

  function activeTechniques(cultivation) {
    if (!cultivation) return [];
    const ids =
      Array.isArray(cultivation.equippedTechniques) && cultivation.equippedTechniques.length
        ? cultivation.equippedTechniques
        : cultivation.equippedTechnique
          ? [cultivation.equippedTechnique]
          : [];
    return ids
      .map((id) => techniqueById(id))
      .filter((technique) => technique && techniqueCompatible(cultivation, technique.id));
  }

  function techniqueBonuses(cultivation) {
    const techniques = activeTechniques(cultivation);
    let gain = 0;
    let breakthrough = 0;
    let mastery = 0;
    techniques.forEach((technique) => {
      const category = TECHNIQUE_CATEGORIES[technique.category] || TECHNIQUE_CATEGORIES.spell;
      const progress = techniqueProgress(cultivation, technique.id);
      const masteryFactor = 0.15 + (progress / 100) * 0.85;
      gain += (technique.cultivationMultiplier - 1) * masteryFactor * category.gainWeight;
      breakthrough += technique.breakthroughBonus * masteryFactor * category.breakthroughWeight;
      mastery += technique.masteryBonus * masteryFactor;
    });
    return {
      techniques,
      cultivationMultiplier: 1 + gain,
      breakthroughBonus: breakthrough,
      masteryBonus: mastery,
    };
  }

  function caveBonuses(cultivation) {
    const active = cultivation && cultivation.cave && cultivation.cave.active;
    if (!active) {
      return {
        active: null,
        qiMultiplier: 1,
        expMultiplier: 1,
        techniqueMultiplier: 1,
        breakthroughBonus: 0,
      };
    }
    return {
      active,
      qiMultiplier: active.qiMultiplier,
      expMultiplier: active.qiMultiplier * (active.effectType === "cultivation" ? 1 + active.effectValue : 1),
      techniqueMultiplier: active.effectType === "technique" ? 1 + active.effectValue : 1,
      breakthroughBonus: active.effectType === "breakthrough" ? active.effectValue : 0,
    };
  }

  function addTechniqueProgress(cultivation, techniqueId, amount) {
    if (!techniqueById(techniqueId)) return 0;
    if (!cultivation.techniqueProgress || typeof cultivation.techniqueProgress !== "object") {
      cultivation.techniqueProgress = {};
    }
    const before = techniqueProgress(cultivation, techniqueId);
    const after = clamp(before + Math.max(0, Number(amount) || 0), 0, 100);
    cultivation.techniqueProgress[techniqueId] = after;
    return after - before;
  }

  function advanceEquippedTechniques(cultivation, amount) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return 0;
    let total = 0;
    activeTechniques(cultivation).forEach((technique) => {
      total += addTechniqueProgress(cultivation, technique.id, amount);
    });
    return total;
  }

  const STAGE_NAMES = Object.freeze(["初期", "中期", "后期", "圆满"]);
  const PILL_NAMES = Object.freeze({
    mortal: "铸体丹",
    qi: "引气丹",
    foundation: "筑基丹",
    golden_core: "结金丹",
    nascent: "元婴丹",
    spirit: "化神丹",
    void: "炼虚丹",
    fusion: "合体丹",
    mahayana: "大乘丹",
    tribulation: "渡劫丹",
    true_immortal: "飞升丹",
    golden_immortal: "真仙丹",
    taiyi: "金仙丹",
    daluo: "太乙丹",
    immortal_lord: "大罗丹",
    immortal_emperor: "仙尊丹",
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function integer(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(clamp(parsed, min, max));
  }

  function randomInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function rollTalents(rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const rootId = rollRoot(random);
    return {
      root: rootId,
      insight: randomInt(random, 22, 96),
      fortune: randomInt(random, 18, 96),
      daoHeart: randomInt(random, 28, 98),
      lifespan: randomInt(random, 70, 120),
      rootLineage: 0,
    };
  }

  function talentSummary(attributes) {
    const root = ROOTS[attributes && attributes.root] || ROOTS.mixed;
    const value = (key, fallback) => {
      const parsed = Number(attributes && attributes[key]);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      root: root.id,
      insight: value("insight", 50),
      fortune: value("fortune", 50),
      daoHeart: value("daoHeart", 50),
      lifespan: value("lifespan", 90),
      rootLineage: value("rootLineage", 0),
    };
  }

  function emptyCultivation(now) {
    return {
      version: VERSION,
      attributes: {
        root: "mixed",
        insight: 50,
        fortune: 50,
        daoHeart: 60,
        lifespan: 90,
        rootLineage: 0,
      },
      exp: 0,
      age: 0,
      lastAgedAt: Number(now) || 0,
      bonusLifespan: 0,
      technique: 0,
      hp: 100,
      spiritStones: 3,
      stones: { low: 3, mid: 0, high: 0, supreme: 0 },
      selectedStoneTier: "low",
      buyQuantity: 10,
      consumeQuantity: 1,
      cultivationPillUse: { level: 0, count: 0 },
      stoneSession: {
        active: false,
        startedAt: 0,
        endsAt: 0,
        completedAt: 0,
        quantity: 0,
        tier: "low",
        totalEnergy: 0,
        energyPerSecond: 0,
        durationMs: 0,
        gained: 0,
        levelsGained: 0,
        noProgress: false,
        epiphany: false,
        damaged: 0,
        techniqueGain: 0,
      },
      regionId: "qingju_plain",
      formationId: "gathering",
      meditation: { active: false, lastAt: 0, totalSeconds: 0 },
      biguUntil: 0,
      spiritualPower: 100,
      spiritualPowerMax: 100,
      spiritualPowerUpdatedAt: Number(now) || 0,
      blackTower: {
        selectedFloor: 1,
        bestFloor: 0,
        attempts: 0,
        wins: 0,
        lastResult: null,
      },
      cave: {
        refreshAt: 0,
        spots: [],
        active: null,
        challenge: null,
        readyAt: 0,
        visits: 0,
        lastLoot: null,
      },
      soul: { level: 0, count: 0, root: "", attributeBonus: 0 },
      techniqueScrolls: {},
      techniquesKnown: [],
      techniqueProgress: {},
      equippedTechniques: [],
      equippedTechnique: "",
      herbs: 0,
      pills: { breakthrough: 0, life: 0, technique: 0, cultivation: 0, heart: 0, bigu: 0 },
      thunderPearls: 0,
      cooldownUntil: 0,
      herbReadyAt: 0,
      mineReadyAt: 0,
      techniqueReadyAt: 0,
      alchemyReadyAt: 0,
      secretReadyAt: 0,
      karma: 0,
      demonized: false,
      cycle: 0,
      epiphanyCount: 0,
      lastBreakthrough: null,
      lastLifeEvent: null,
    };
  }

  function createCultivation(now, rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    const state = emptyCultivation(now);
    state.attributes = rollTalents(random);
    state.age = randomInt(random, 16, 28);
    state.lastAgedAt = Number(now) || Date.now();
    state.regionId = chooseStartingRegion(random);
    state.meditation.lastAt = state.lastAgedAt;
    return state;
  }

  function normalizeCultivation(raw, now, rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    if (!raw || typeof raw !== "object") return createCultivation(now, random);
    // 已有存档只补默认值，不用随机天赋覆盖缺失字段，也避免每次归一化消耗随机序列。
    const fallback = emptyCultivation(now);
    const attrs = raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {};
    const pills = raw.pills && typeof raw.pills === "object" ? raw.pills : {};
    const rawStones = raw.stones && typeof raw.stones === "object" ? raw.stones : {};
    const legacyStones = integer(raw.spiritStones, 3, 0, 1e9);
    const stones = {
      low: integer(rawStones.low, legacyStones, 0, 1e9),
      mid: integer(rawStones.mid, 0, 0, 1e9),
      high: integer(rawStones.high, 0, 0, 1e9),
      supreme: integer(rawStones.supreme, 0, 0, 1e9),
    };
    const root = Object.prototype.hasOwnProperty.call(ROOTS, attrs.root)
      ? attrs.root
      : fallback.attributes.root;
    const regionId = regionById(raw.regionId) ? raw.regionId : fallback.regionId;
    const selectedStoneTier = Object.prototype.hasOwnProperty.call(STONE_TIERS, raw.selectedStoneTier)
      ? raw.selectedStoneTier
      : "low";
    const formationId = FORMATIONS[raw.formationId] ? raw.formationId : "gathering";
    const rawMeditation = raw.meditation && typeof raw.meditation === "object" ? raw.meditation : {};
    const rawStoneSession = raw.stoneSession && typeof raw.stoneSession === "object" ? raw.stoneSession : {};
    const rawCave = raw.cave && typeof raw.cave === "object" ? raw.cave : {};
    const rawPillUse =
      raw.cultivationPillUse && typeof raw.cultivationPillUse === "object"
        ? raw.cultivationPillUse
        : {};
    const rawTower = raw.blackTower && typeof raw.blackTower === "object" ? raw.blackTower : {};
    const rawTowerResult =
      rawTower.lastResult && typeof rawTower.lastResult === "object" ? rawTower.lastResult : null;
    const rawBattle = rawTower.battle && typeof rawTower.battle === "object" ? rawTower.battle : null;
    const battleLog = rawBattle && Array.isArray(rawBattle.log)
      ? rawBattle.log
          .filter((entry) => entry && typeof entry === "object")
          .slice(-20)
          .map((entry) => ({
            at: Math.max(0, Number(entry.at) || 0),
            type: String(entry.type || "info").slice(0, 20),
            text: String(entry.text || "").slice(0, 160),
          }))
      : [];
    const rawSoul = raw.soul && typeof raw.soul === "object" ? raw.soul : {};
    const rawTechniqueScrolls =
      raw.techniqueScrolls && typeof raw.techniqueScrolls === "object" ? raw.techniqueScrolls : {};
    const techniqueScrolls = Object.fromEntries(
      Object.entries(rawTechniqueScrolls)
        .filter(([id, count]) => techniqueById(id) && Number.isFinite(Number(count)))
        .slice(0, 600)
        .map(([id, count]) => [id, integer(count, 0, 0, 999)])
        .filter(([, count]) => count > 0)
    );
    const techniquesKnown = Array.isArray(raw.techniquesKnown)
      ? [...new Set(raw.techniquesKnown.filter((id) => typeof id === "string" && techniqueById(id)))].slice(
          0,
          600
        )
      : [];
    const rawTechniqueProgress =
      raw.techniqueProgress && typeof raw.techniqueProgress === "object" ? raw.techniqueProgress : {};
    const normalizedTechniqueProgress = Object.fromEntries(
      techniquesKnown
        .filter((id) => Number.isFinite(Number(rawTechniqueProgress[id])))
        .map((id) => [id, Math.round(clamp(Number(rawTechniqueProgress[id]), 0, 100) * 10) / 10])
    );
    const rawEquipped = Array.isArray(raw.equippedTechniques)
      ? raw.equippedTechniques
      : raw.equippedTechnique
        ? [raw.equippedTechnique]
        : [];
    const categoriesUsed = new Set();
    const equippedTechniques = rawEquipped
      .filter((id) => techniquesKnown.includes(id) && techniqueCompatible({ attributes: { root } }, id))
      .filter((id) => {
        const technique = techniqueById(id);
        if (!technique || categoriesUsed.has(technique.category)) return false;
        categoriesUsed.add(technique.category);
        return true;
      })
      .slice(0, 5);
    const equippedTechnique = equippedTechniques[0] || "";
    const timestamp = Number(now) || Date.now();
    const rawSpots = Array.isArray(rawCave.spots) ? rawCave.spots : [];
    const spots = rawSpots
      .filter(
        (spot) =>
          spot && CAVE_HEAVENS.some((cave) => cave.id === spot.id) && ["small", "large"].includes(spot.size)
      )
      .slice(0, 10)
      .map((spot) => ({
        id: spot.id,
        size: spot.size,
        qiMultiplier: Math.round(clamp(Number(spot.qiMultiplier) || 1, 1, 3) * 100) / 100,
        effectType: CAVE_EFFECTS[spot.effectType] ? spot.effectType : "cultivation",
        effectValue: Math.round(clamp(Number(spot.effectValue) || 0, 0, 2) * 1000) / 1000,
      }));
    const rawActive = rawCave.active && typeof rawCave.active === "object" ? rawCave.active : null;
    const active =
      rawActive &&
      CAVE_HEAVENS.some((cave) => cave.id === rawActive.id) &&
      Number(rawActive.expiresAt) > timestamp
        ? {
            id: rawActive.id,
            size: rawActive.size === "large" ? "large" : "small",
            qiMultiplier: Math.round(clamp(Number(rawActive.qiMultiplier) || 1, 1, 3) * 100) / 100,
            effectType: CAVE_EFFECTS[rawActive.effectType] ? rawActive.effectType : "cultivation",
            effectValue: Math.round(clamp(Number(rawActive.effectValue) || 0, 0, 2) * 1000) / 1000,
            enteredAt: Math.max(0, Number(rawActive.enteredAt) || 0),
            expiresAt: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(rawActive.expiresAt) || 0)),
          }
        : null;
    const rawChallenge =
      rawCave.challenge && typeof rawCave.challenge === "object" ? rawCave.challenge : null;
    const challenge =
      rawChallenge && CAVE_HEAVENS.some((cave) => cave.id === rawChallenge.id)
        ? {
            id: rawChallenge.id,
            size: "large",
            qiMultiplier: Math.round(clamp(Number(rawChallenge.qiMultiplier) || 1.8, 1, 3) * 100) / 100,
            effectType: CAVE_EFFECTS[rawChallenge.effectType] ? rawChallenge.effectType : "cultivation",
            effectValue: Math.round(clamp(Number(rawChallenge.effectValue) || 0, 0, 2) * 1000) / 1000,
            guardian: String(rawChallenge.guardian || "洞天守灵").slice(0, 40),
            createdAt: Math.max(0, Number(rawChallenge.createdAt) || 0),
          }
        : null;
    const rawLoot = rawCave.lastLoot && typeof rawCave.lastLoot === "object" ? rawCave.lastLoot : {};
    return {
      version: VERSION,
      attributes: {
        root,
        insight: integer(attrs.insight, fallback.attributes.insight, 1, MAX_ATTRIBUTE),
        fortune: integer(attrs.fortune, fallback.attributes.fortune, 1, MAX_ATTRIBUTE),
        daoHeart: integer(attrs.daoHeart, fallback.attributes.daoHeart, 0, MAX_ATTRIBUTE),
        lifespan: integer(attrs.lifespan, fallback.attributes.lifespan, 20, MAX_ATTRIBUTE),
        rootLineage: integer(attrs.rootLineage, 0, 0, 100),
      },
      exp: Math.max(0, Number(raw.exp) || 0),
      age: Math.max(0, Math.min(10000000, Number(raw.age) || fallback.age)),
      lastAgedAt: clamp(Number(raw.lastAgedAt) || timestamp, 0, Number.MAX_SAFE_INTEGER),
      bonusLifespan: integer(raw.bonusLifespan, 0, 0, 1e7),
      technique: clamp(Number(raw.technique) || 0, 0, MAX_TECHNIQUE_MASTERY),
      hp: Math.max(0, Number(raw.hp) || 0),
      spiritStones: stones.low,
      stones,
      selectedStoneTier,
      buyQuantity: integer(raw.buyQuantity, 10, 1, 9999),
      consumeQuantity: integer(raw.consumeQuantity, 1, 1, 9999),
      cultivationPillUse: {
        level: integer(rawPillUse.level, 0, 0, MAX_LEVEL),
        count: integer(rawPillUse.count, 0, 0, 2),
      },
      stoneSession: {
        active: rawStoneSession.active === true,
        startedAt: Math.max(0, Number(rawStoneSession.startedAt) || 0),
        endsAt: Math.max(0, Number(rawStoneSession.endsAt) || 0),
        completedAt: Math.max(0, Number(rawStoneSession.completedAt) || 0),
        quantity: integer(rawStoneSession.quantity, 0, 0, 9999),
        tier: Object.prototype.hasOwnProperty.call(STONE_TIERS, rawStoneSession.tier)
          ? rawStoneSession.tier
          : "low",
        totalEnergy: Math.max(0, Number(rawStoneSession.totalEnergy) || 0),
        energyPerSecond: Math.max(0, Number(rawStoneSession.energyPerSecond) || 0),
        durationMs: Math.max(0, Number(rawStoneSession.durationMs) || 0),
        settledEnergy: Math.max(0, Number(rawStoneSession.settledEnergy) || 0),
        endedEarly: rawStoneSession.endedEarly === true,
        gained: Math.max(0, Number(rawStoneSession.gained) || 0),
        levelsGained: integer(rawStoneSession.levelsGained, 0, 0, MAX_LEVEL),
        noProgress: rawStoneSession.noProgress === true,
        epiphany: rawStoneSession.epiphany === true,
        damaged: Math.max(0, Number(rawStoneSession.damaged) || 0),
        techniqueGain: Math.max(0, Number(rawStoneSession.techniqueGain) || 0),
      },
      regionId,
      formationId,
      meditation: {
        active: rawMeditation.active === true,
        lastAt: Math.max(0, Number(rawMeditation.lastAt) || timestamp),
        totalSeconds: Math.max(0, Number(rawMeditation.totalSeconds) || 0),
      },
      biguUntil: Math.max(0, Number(raw.biguUntil) || 0),
      spiritualPower:
        raw.spiritualPower === undefined
          ? fallback.spiritualPower
          : Math.max(0, Number(raw.spiritualPower) || 0),
      spiritualPowerMax: Math.max(100, Number(raw.spiritualPowerMax) || fallback.spiritualPowerMax),
      spiritualPowerUpdatedAt: Math.max(0, Number(raw.spiritualPowerUpdatedAt) || timestamp),
      blackTower: {
        selectedFloor: integer(rawTower.selectedFloor, 1, 1, 10),
        bestFloor: integer(rawTower.bestFloor, 0, 0, 10),
        attempts: integer(rawTower.attempts, 0, 0, 1e9),
        wins: integer(rawTower.wins, 0, 0, 1e9),
        autoAdvance: rawTower.autoAdvance === true,
        loop: rawTower.loop === true,
        nextBattleAt: Math.max(0, Number(rawTower.nextBattleAt) || 0),
        battle: rawBattle
          ? {
              active: rawBattle.active === true,
              paused: rawBattle.paused === true,
              phase: ["mobs", "guardian", "cleared", "failed", "retreated"].includes(rawBattle.phase)
                ? rawBattle.phase
                : "mobs",
              floor: integer(rawBattle.floor, 1, 1, 10),
              entryCost: Math.max(0, Number(rawBattle.entryCost) || 0),
              kills: integer(rawBattle.kills, 0, 0, 100),
              total: 100,
              mobHp: Math.max(0, Number(rawBattle.mobHp) || 0),
              mobMaxHp: Math.max(1, Number(rawBattle.mobMaxHp) || 1),
              mobAttack: Math.max(0, Number(rawBattle.mobAttack) || 0),
              guardianHp: Math.max(0, Number(rawBattle.guardianHp) || 0),
              guardianMaxHp: Math.max(0, Number(rawBattle.guardianMaxHp) || 0),
              guardianAttack: Math.max(0, Number(rawBattle.guardianAttack) || 0),
              guardianSpawned: rawBattle.guardianSpawned === true,
              guardianDefeated: rawBattle.guardianDefeated === true,
              startedAt: Math.max(0, Number(rawBattle.startedAt) || 0),
              lastAttackAt: Math.max(0, Number(rawBattle.lastAttackAt) || 0),
              clearedAt: Math.max(0, Number(rawBattle.clearedAt) || 0),
              failedAt: Math.max(0, Number(rawBattle.failedAt) || 0),
              rewardGained: Math.max(0, Number(rawBattle.rewardGained) || 0),
              log: battleLog,
            }
          : null,
        lastResult: rawTowerResult
          ? {
              floor: integer(rawTowerResult.floor, 0, 0, 10),
              enemy: String(rawTowerResult.enemy || "").slice(0, 40),
              outcome: ["win", "loss", "retreat"].includes(rawTowerResult.outcome)
                ? rawTowerResult.outcome
                : "loss",
              gained: Math.max(0, Number(rawTowerResult.gained) || 0),
              spent: Math.max(0, Number(rawTowerResult.spent) || 0),
              at: Math.max(0, Number(rawTowerResult.at) || 0),
            }
          : null,
      },
      cave: {
        refreshAt: Math.max(0, Number(rawCave.refreshAt) || 0),
        spots,
        active,
        challenge,
        readyAt: Math.max(0, Number(rawCave.readyAt) || 0),
        visits: integer(rawCave.visits, 0, 0, 1e9),
        lastLoot: {
          techniqueName: String(rawLoot.techniqueName || "").slice(0, 100),
          pillName: String(rawLoot.pillName || "").slice(0, 40),
          at: Math.max(0, Number(rawLoot.at) || 0),
        },
      },
      soul: {
        level: integer(rawSoul.level, 0, 0, MAX_LEVEL),
        count: integer(rawSoul.count, 0, 0, 1e9),
        root: Object.prototype.hasOwnProperty.call(ROOTS, rawSoul.root) ? rawSoul.root : "",
        attributeBonus: integer(rawSoul.attributeBonus, 0, 0, 999),
      },
      techniqueScrolls,
      techniquesKnown,
      techniqueProgress: normalizedTechniqueProgress,
      equippedTechniques,
      equippedTechnique,
      herbs: integer(raw.herbs, 0, 0, 1e9),
      pills: {
        breakthrough: integer(pills.breakthrough, 0, 0, 1e6),
        life: integer(pills.life, 0, 0, 1e6),
        technique: integer(pills.technique, 0, 0, 1e6),
        cultivation: integer(pills.cultivation, 0, 0, 1e6),
        heart: integer(pills.heart, 0, 0, 1e6),
        bigu: integer(pills.bigu, 0, 0, 1e6),
      },
      thunderPearls: integer(raw.thunderPearls, 0, 0, 1e6),
      cooldownUntil: Math.max(0, Number(raw.cooldownUntil) || 0),
      herbReadyAt: Math.max(0, Number(raw.herbReadyAt) || 0),
      mineReadyAt: Math.max(0, Number(raw.mineReadyAt) || 0),
      techniqueReadyAt: Math.max(0, Number(raw.techniqueReadyAt) || 0),
      alchemyReadyAt: Math.max(0, Number(raw.alchemyReadyAt) || 0),
      secretReadyAt: Math.max(0, Number(raw.secretReadyAt) || 0),
      karma: integer(raw.karma, 0, 0, 1e9),
      demonized: raw.demonized === true,
      cycle: integer(raw.cycle, 0, 0, 1e9),
      epiphanyCount: integer(raw.epiphanyCount, 0, 0, 1e9),
      lastBreakthrough:
        raw.lastBreakthrough && typeof raw.lastBreakthrough === "object"
          ? {
              level: integer(raw.lastBreakthrough.level, 1, 1, MAX_LEVEL),
              at: Math.max(0, Number(raw.lastBreakthrough.at) || 0),
              chance: clamp(Number(raw.lastBreakthrough.chance) || 0, 0, 1),
              route: raw.lastBreakthrough.route === "mind" ? "mind" : "pill",
            }
          : null,
      lastLifeEvent:
        raw.lastLifeEvent && typeof raw.lastLifeEvent === "object"
          ? {
              type: raw.lastLifeEvent.type === "rebirth" ? "rebirth" : "lifespan",
              at: Math.max(0, Number(raw.lastLifeEvent.at) || 0),
              age: Math.max(0, Number(raw.lastLifeEvent.age) || 0),
              level: integer(raw.lastLifeEvent.level, 1, 1, MAX_LEVEL),
              carried: ATTRIBUTE_KEYS.includes(raw.lastLifeEvent.carried) ? raw.lastLifeEvent.carried : "",
            }
          : null,
    };
  }

  function majorRealm(level) {
    const value = integer(level, 1, 1, MAX_LEVEL);
    return REALMS.find((realm) => value >= realm.start && value <= realm.end) || REALMS[REALMS.length - 1];
  }

  function realmStatus(level) {
    const value = integer(level, 1, 1, MAX_LEVEL);
    const major = majorRealm(value);
    const majorIndex = REALMS.indexOf(major);
    const offset = value - major.start;
    const span = major.end - major.start + 1;
    const stageIndex = Math.min(3, Math.floor((offset * 4) / span));
    return {
      level: value,
      major,
      majorIndex,
      stageIndex,
      stage: STAGE_NAMES[stageIndex],
      fullName: `${major.name}${STAGE_NAMES[stageIndex]}`,
      nextRealm: REALMS[majorIndex + 1] || null,
      maxLevel: MAX_LEVEL,
    };
  }

  function isBreakthroughLevel(level) {
    const value = integer(level, 1, 1, MAX_LEVEL);
    if (value >= MAX_LEVEL) return false;
    if (value <= 100) return value % 10 === 0;
    if (value <= 600) return value % 100 === 0;
    return false;
  }

  function expRequired(level) {
    const value = integer(level, 1, 1, MAX_LEVEL);
    if (value >= MAX_LEVEL) return 0;
    const realm = realmStatus(value);
    const realmPower = Math.max(0, realm.majorIndex - 1);
    const span = realm.major.end - realm.major.start + 1;
    const offset = value - realm.major.start;
    const layerPower = isBreakthroughLevel(value) ? Math.max(0, span - 2) : offset;
    const base = EXP_BASE * Math.pow(REALM_EXP_FACTOR, realmPower) * Math.pow(LAYER_EXP_FACTOR, layerPower);
    return Math.max(1, Math.round(base * (isBreakthroughLevel(value) ? BREAKTHROUGH_EXP_FACTOR : 1)));
  }

  function stoneBaseExperience(_level, tierId) {
    const tier = STONE_TIERS[tierId] || STONE_TIERS.low;
    return tier.energy;
  }

  /**
   * 灵石不是逐颗结算，而是一批灵石同时投入吸收。
   * 每秒吞吐由当前等级和悟性提供基础值，再受灵根、区域、阵法、功法和洞天影响。
   */
  function stoneAbsorptionRate(cultivation, level) {
    const attrs = talentSummary(cultivation && cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    const region = regionById(cultivation && cultivation.regionId) || ORANGE_REGIONS[0];
    const formation = formationById(cultivation && cultivation.formationId);
    const techniqueBonus = techniqueBonuses(cultivation);
    const caveBonus = caveBonuses(cultivation);
    const levelValue = integer(level, 1, 1, MAX_LEVEL);
    const base = 3 + levelValue * (1.8 + levelValue / 100) + attrs.insight * 0.8;
    const rootFactor = 0.6 + Math.min(10, Math.max(0.1, Number(root.gain) || 0.1)) * 0.08;
    const regionFactor = Math.sqrt(region.qi);
    const demonFactor = cultivation && cultivation.demonized ? 1.12 : 1;
    const perSecond =
      base *
      rootFactor *
      regionFactor *
      formation.multiplier *
      techniqueBonus.cultivationMultiplier *
      caveBonus.expMultiplier *
      demonFactor;
    return {
      perSecond: Math.max(0.1, perSecond),
      base,
      rootFactor,
      regionFactor,
      formation,
      region,
      techniqueBonus,
      caveBonus,
      demonFactor,
    };
  }

  function stoneBatchChances(cultivation) {
    const attrs = talentSummary(cultivation && cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    return {
      // 一批灵石只判断一次，上限 2.5%，不再按灵石颗数反复触发。
      noProgress: clamp(root.noProgress * 0.12 - attrs.insight * 0.0001, 0.002, 0.025),
      epiphany: clamp(
        0.008 + attrs.insight * 0.0002 + attrs.fortune * 0.0001 - (cultivation.demonized ? 0.006 : 0),
        0.005,
        0.05
      ),
      damage: clamp(
        Number((regionById(cultivation && cultivation.regionId) || ORANGE_REGIONS[0]).damageRate) || 0,
        0,
        1
      ),
    };
  }

  function meditationRate(cultivation, level) {
    const attrs = talentSummary(cultivation && cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    const region = regionById(cultivation && cultivation.regionId) || ORANGE_REGIONS[0];
    const formation = formationById(cultivation && cultivation.formationId);
    const technique = activeTechnique(cultivation);
    const techniqueBonus = techniqueBonuses(cultivation);
    const caveBonus = caveBonuses(cultivation);
    const insightFactor = 0.65 + attrs.insight * 0.0085;
    const lineageFactor = 1 + attrs.rootLineage * 0.15;
    const demonFactor = cultivation && cultivation.demonized ? 1.1 : 1;
    const required = expRequired(level);
    const perHour =
      required *
      MEDITATION_HOURLY_RATE *
      root.gain *
      insightFactor *
      lineageFactor *
      region.qi *
      formation.multiplier *
      techniqueBonus.cultivationMultiplier *
      caveBonus.expMultiplier *
      demonFactor;
    return {
      perSecond: perHour / 3600,
      perHour,
      basePerHour: required * MEDITATION_HOURLY_RATE,
      rootFactor: root.gain,
      insightFactor,
      lineageFactor,
      region,
      formation,
      technique,
      techniques: techniqueBonus.techniques,
      techniqueBonus,
      caveBonus,
      demonFactor,
    };
  }

  function realmLifespanBonus(level) {
    return majorRealm(level).lifespan;
  }

  function realmPowerMultiplier(level) {
    return 1 + realmStatus(level).majorIndex * 0.12;
  }

  function maxLifespan(cultivation, level) {
    const attrs = talentSummary(cultivation && cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    const rootBonus = Number(root.lifespanBonus) || 0;
    const bonus = Math.max(0, Number(cultivation && cultivation.bonusLifespan) || 0);
    return Math.max(1, Math.round(attrs.lifespan + rootBonus + realmLifespanBonus(level) + bonus));
  }

  function lifesStatus(cultivation, level) {
    const attrs = talentSummary(cultivation && cultivation.attributes);
    const max = maxLifespan(cultivation, level);
    const age = Math.max(0, Number(cultivation && cultivation.age) || 0);
    const remaining = Math.max(0, max - age);
    return {
      age,
      max,
      remaining,
      years: Math.max(0, remaining),
      danger: remaining <= 10,
      base: attrs.lifespan,
    };
  }

  /**
   * 真实时间一天折算修仙界一年。
   * 返回 died=true 时由游戏层统一执行投胎重置。
   */
  function advanceAge(cultivation, now, level) {
    const ts = Number(now) || Date.now();
    const last = Math.max(0, Math.min(ts, Number(cultivation.lastAgedAt) || ts));
    const years = Math.max(0, (ts - last) / DAY_MS);
    if (years > 0) {
      cultivation.age = Math.max(0, Number(cultivation.age) || 0) + years;
    }
    cultivation.lastAgedAt = ts;
    return { years, died: Number(cultivation.age) >= maxLifespan(cultivation, level) };
  }

  function cultivateOnce(cultivation, level, rng, tierId) {
    const random = typeof rng === "function" ? rng : Math.random;
    const attrs = talentSummary(cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    const tier = STONE_TIERS[tierId || cultivation.selectedStoneTier] || STONE_TIERS.low;
    const region = regionById(cultivation.regionId) || ORANGE_REGIONS[0];
    const technique = activeTechnique(cultivation);
    const techniqueBonus = techniqueBonuses(cultivation);
    const caveBonus = caveBonuses(cultivation);
    const noProgressChance = clamp(root.noProgress - attrs.insight * 0.0007, 0.01, 0.35);
    if (random() < noProgressChance) {
      return { gained: 0, noProgress: true, epiphany: false, damaged: 0, tier: tier.id };
    }
    const insightFactor = 0.65 + attrs.insight * 0.0085;
    const demonFactor = cultivation.demonized ? 1.25 : 1;
    const qualityFactor = 0.6 + random() * 0.4;
    const randomFactor = 0.8 + random() * 0.55;
    const lineageFactor = 1 + attrs.rootLineage * 0.15;
    const stoneBase = stoneBaseExperience(level, tier.id);
    const epiphanyChance = clamp(
      0.012 + attrs.insight * 0.0008 + attrs.fortune * 0.0005 - (cultivation.demonized ? 0.02 : 0),
      0.01,
      0.2
    );
    const epiphany = random() < epiphanyChance;
    const absorptionRate = epiphany
      ? 1
      : clamp(
          qualityFactor *
            root.gain *
            insightFactor *
            demonFactor *
            randomFactor *
            lineageFactor *
            region.qi *
            techniqueBonus.cultivationMultiplier *
            caveBonus.expMultiplier,
          0,
          1
        );
    const gained = Math.max(0, Math.round(stoneBase * absorptionRate));
    if (epiphany) {
      cultivation.epiphanyCount = (cultivation.epiphanyCount || 0) + 1;
    }
    cultivation.technique = Math.min(
      MAX_TECHNIQUE_MASTERY,
      (Number(cultivation.technique) || 0) +
        0.12 +
        attrs.insight * 0.0015 +
        techniqueBonus.masteryBonus * 0.03 +
        (epiphany ? 0.8 : 0)
    );
    advanceEquippedTechniques(
      cultivation,
      (0.04 + attrs.insight * 0.00055 + (epiphany ? 0.25 : 0)) * caveBonus.techniqueMultiplier
    );
    const damaged =
      region.damageRate > 0 && random() < region.damageRate ? Math.round(expRequired(level) * 0.02) : 0;
    return {
      gained,
      noProgress: false,
      epiphany,
      damaged,
      tier: tier.id,
      region: region.id,
      cave: caveBonus.active ? caveBonus.active.id : "",
      techniqueId: technique ? technique.id : "",
    };
  }

  function addExperience(cultivation, level, amount) {
    let nextLevel = level;
    cultivation.exp = Math.max(0, Number(cultivation.exp) || 0) + Math.max(0, Number(amount) || 0);
    let levelsGained = 0;
    while (nextLevel < MAX_LEVEL) {
      const required = expRequired(nextLevel);
      if (cultivation.exp < required) break;
      if (isBreakthroughLevel(nextLevel)) {
        cultivation.exp = required;
        break;
      }
      cultivation.exp -= required;
      nextLevel += 1;
      levelsGained += 1;
    }
    if (nextLevel >= MAX_LEVEL) {
      nextLevel = MAX_LEVEL;
      cultivation.exp = 0;
    }
    return { level: nextLevel, levelsGained };
  }

  function techniqueRequirement(targetRealm) {
    const index = REALMS.indexOf(targetRealm);
    return Math.max(0, Math.floor(index * 7.5));
  }

  function insightRequirement(targetRealm) {
    const index = REALMS.indexOf(targetRealm);
    return Math.min(92, 18 + index * 4);
  }

  function daoHeartRequirement(targetRealm) {
    const index = REALMS.indexOf(targetRealm);
    return Math.min(90, 24 + index * 4);
  }

  function eventType(level) {
    const value = integer(level, 1, 1, MAX_LEVEL);
    if (value === 100 || (value > 100 && value % 100 === 0)) return "tribulation";
    if (value % 50 === 0) return "heart";
    return "trial";
  }

  function tribulationProfile(cultivation, level) {
    const attrs = talentSummary(cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    const rootAdjustment = Math.floor(root.tribulationRelief * 4);
    const strength = Math.max(
      1,
      1 +
        Math.floor(level / 20) +
        Math.floor((Number(cultivation.karma) || 0) / 3) -
        Math.floor(attrs.fortune / 28) -
        rootAdjustment
    );
    const steps =
      eventType(level) !== "tribulation"
        ? []
        : level === 100 || level >= 200
          ? ["一重雷", "二重雷", "心魔劫", "法则劫"]
          : strength >= 4
            ? ["一重雷", "二重雷", "心魔劫"]
            : ["一重雷", "二重雷"];
    return {
      event: eventType(level),
      strength,
      steps,
      fortuneRelief: Math.round(attrs.fortune * 0.08),
      rootRelief: Math.round(root.tribulationRelief * 100),
      pearls: integer(cultivation.thunderPearls, 0, 0, 1e6),
    };
  }

  function breakthroughTarget(level) {
    return isBreakthroughLevel(level) ? integer(level, 1, 1, MAX_LEVEL) + 1 : null;
  }

  function breakthroughStatus(cultivation, level, route, now) {
    const targetLevel = breakthroughTarget(level);
    if (!targetLevel) {
      return { ok: false, reason: "minor", targetLevel: null };
    }
    const required = expRequired(level);
    const target = realmStatus(targetLevel).major;
    const attrs = talentSummary(cultivation.attributes);
    const root = ROOTS[attrs.root] || ROOTS.mixed;
    const technique = activeTechnique(cultivation);
    const techniqueBonus = techniqueBonuses(cultivation);
    const caveBonus = caveBonuses(cultivation);
    const routeKey = route === "mind" ? "mind" : "pill";
    const neededTechnique = techniqueRequirement(target);
    const neededInsight = insightRequirement(target);
    const neededDaoHeart = daoHeartRequirement(target);
    const tribulation = tribulationProfile(cultivation, level);
    const hasPill = (cultivation.pills && cultivation.pills.breakthrough) > 0;
    const cooldown = Math.max(0, Number(cultivation.cooldownUntil) || 0) - (Number(now) || Date.now());
    const checks = {
      experience: Number(cultivation.exp) >= required,
      pill: routeKey === "mind" || hasPill,
      technique: Number(cultivation.technique) >= neededTechnique,
      insight: attrs.insight >= neededInsight,
      daoHeart: cultivation.demonized || attrs.daoHeart >= neededDaoHeart,
      cooldown: cooldown <= 0,
    };
    let chance =
      0.62 +
      attrs.insight * 0.0018 +
      attrs.fortune * 0.0008 +
      attrs.daoHeart * 0.0007 +
      root.breakthrough +
      techniqueBonus.breakthroughBonus +
      caveBonus.breakthroughBonus +
      attrs.rootLineage * 0.015 -
      (Number(cultivation.karma) || 0) * 0.002 -
      (routeKey === "mind" ? 0.12 : 0) -
      (cultivation.demonized ? 0.15 : 0);
    if (tribulation.event === "tribulation") {
      chance -= Math.max(0, tribulation.strength - 1) * 0.045;
      chance += Math.min(0.15, (Number(cultivation.thunderPearls) || 0) * 0.03);
    }
    chance = clamp(chance, 0.08, 0.96);
    const missing = [];
    if (!checks.experience) missing.push("修为未满");
    if (!checks.pill) missing.push(`缺少${PILL_NAMES[target.id] || "破境丹"}`);
    if (!checks.technique) missing.push(`功法领悟 ${neededTechnique}`);
    if (!checks.insight) missing.push(`悟性 ${neededInsight}`);
    if (!checks.daoHeart) missing.push(`道心 ${neededDaoHeart}`);
    if (!checks.cooldown) missing.push(`冷却 ${Math.ceil(cooldown / 1000)} 秒`);
    return {
      ok: missing.length === 0,
      reason: missing.length ? "requirements" : "",
      targetLevel,
      target,
      targetName: realmStatus(targetLevel).fullName,
      pillName: PILL_NAMES[target.id] || "破境丹",
      route: routeKey,
      required,
      progress: clamp((Number(cultivation.exp) || 0) / Math.max(1, required), 0, 1),
      chance,
      checks,
      missing,
      cooldown,
      tribulation,
      requirements: {
        technique: neededTechnique,
        insight: neededInsight,
        daoHeart: neededDaoHeart,
      },
      attributes: attrs,
      technique,
      techniques: techniqueBonus.techniques,
      caveBonus,
    };
  }

  function breakthroughCost(level) {
    return Math.max(240, Math.round(260 + integer(level, 1, 1, MAX_LEVEL) * 18));
  }

  function lifePillCost(level) {
    return Math.max(900, Math.round(700 + integer(level, 1, 1, MAX_LEVEL) * 28));
  }

  function thunderPearlCost(level) {
    return Math.max(360, Math.round(500 + integer(level, 1, 1, MAX_LEVEL) * 20));
  }

  function permissionsFor(level) {
    return realmStatus(level).major.permissions.slice();
  }

  function mergeCarriedAttribute(attributes, carried, key, rng) {
    const random = typeof rng === "function" ? rng : Math.random;
    if (!ATTRIBUTE_KEYS.includes(key) || !carried || typeof carried !== "object") {
      return { mode: "none", attributes };
    }
    const next = { ...attributes };
    if (random() < 0.5) {
      if (key === "root") {
        const oldRoot = ROOTS[carried.root];
        if (oldRoot && oldRoot.id === next.root) {
          next.rootLineage = clamp((Number(next.rootLineage) || 0) + 1, 0, 100);
        } else if (oldRoot) {
          next.root = oldRoot.id;
          next.rootLineage = clamp((Number(next.rootLineage) || 0) + 1, 0, 100);
        }
      } else if (key === "lifespan") {
        next.lifespan = clamp(
          integer(next.lifespan, 90, 20, MAX_ATTRIBUTE) +
            Math.round(integer(carried.lifespan, 90, 20, MAX_ATTRIBUTE) * 0.25),
          20,
          MAX_ATTRIBUTE
        );
      } else {
        next[key] = clamp(
          integer(next[key], 50, 1, MAX_ATTRIBUTE) +
            Math.round(integer(carried[key], 50, 1, MAX_ATTRIBUTE) * 0.25),
          1,
          MAX_ATTRIBUTE
        );
      }
      return { mode: "merge", attributes: next };
    }
    return { mode: "overwrite", attributes: next };
  }

  return {
    VERSION,
    MAX_LEVEL,
    MAX_ATTRIBUTE,
    MAX_TECHNIQUE_MASTERY,
    DAY_MS,
    SPIRIT_STONE_PRICE,
    MAJOR_BREAKTHROUGH_COOLDOWN_MS,
    EXP_BASE,
    REALM_EXP_FACTOR,
    LAYER_EXP_FACTOR,
    BREAKTHROUGH_EXP_FACTOR,
    STONE_TIERS,
    FORMATIONS,
    TECHNIQUE_TIERS,
    TECHNIQUE_GRADES,
    TECHNIQUE_CATEGORIES,
    TECHNIQUES,
    MEDITATION_HOURLY_RATE,
    MEDITATION_OFFLINE_CAP_HOURS,
    ORANGE_CONTINENT,
    ORANGE_REGIONS,
    CAVE_HEAVENS,
    CAVE_EFFECTS,
    CAVE_GUARDIANS,
    CULTIVATION_PILLS,
    DEFAULT_SHORTCUTS,
    ATTRIBUTE_KEYS,
    ATTRIBUTE_META,
    ELEMENTS,
    ELEMENT_ORDER,
    ROOTS,
    ROOT_DISTRIBUTION,
    REALMS,
    PILL_NAMES,
    emptyCultivation,
    createCultivation,
    normalizeCultivation,
    rollRoot,
    rootsAreSymbiotic,
    rollTalents,
    talentSummary,
    majorRealm,
    realmStatus,
    isBreakthroughLevel,
    breakthroughTarget,
    expRequired,
    stoneBaseExperience,
    stoneAbsorptionRate,
    stoneBatchChances,
    meditationRate,
    formationById,
    techniqueById,
    techniqueCompatible,
    activeTechnique,
    activeTechniques,
    techniqueProgress,
    techniqueBonuses,
    caveBonuses,
    addTechniqueProgress,
    advanceEquippedTechniques,
    regionById,
    chooseStartingRegion,
    realmPowerMultiplier,
    maxLifespan,
    lifesStatus,
    advanceAge,
    cultivateOnce,
    addExperience,
    breakthroughStatus,
    tribulationProfile,
    breakthroughCost,
    lifePillCost,
    thunderPearlCost,
    permissionsFor,
    mergeCarriedAttribute,
    eventType,
  };
});
