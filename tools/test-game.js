/* 经济 / 状态逻辑的单元测试：node tools/test-game.js */
const assert = require("assert");
const G = require("../renderer/game.js");
const { sanitizeSave } = require("../lib/save-schema.js");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

const NOW = 1_700_000_000_000;
const UP_NOW = Date.parse("2026-11-01T12:00:00+08:00");

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function finishStoneSession(state, rng) {
  const started = G.cultivate(state, state.cultivation.consumeQuantity || 1, NOW, rng);
  const finished = G.settleStoneCultivation(state, started.endsAt + 1, rng);
  return { started, finished };
}

console.log("doro 经济逻辑测试");

test("损坏的存档会被兜底成新档", () => {
  const state = G.hydrate({ coins: "x", level: -8, mood: 1e9 }, NOW);
  assert.strictEqual(state.coins, 0);
  assert.strictEqual(state.level, 1);
  assert.ok(state.mood <= 100);
  assert.strictEqual(state.lastTick, NOW);
});

test("正常情况下每秒产出 = 等级 × 心情系数", () => {
  const state = G.hydrate({ level: 2, mood: 100, satiety: 80 }, NOW);
  assert.strictEqual(G.incomePerSecond(state), 2 * 1.5);
  state.mood = 0;
  assert.strictEqual(G.incomePerSecond(state), 2 * 1);
});

test("饿了产出打折，但不会完全停产", () => {
  const state = G.hydrate({ level: 4, mood: 0, satiety: 20 }, NOW);
  assert.ok(Math.abs(G.incomePerSecond(state) - 4 * 1 * G.BALANCE.hungryMultiplier) < 1e-9);
  state.satiety = 0;
  assert.ok(Math.abs(G.incomePerSecond(state) - 4 * 1 * G.BALANCE.starvingMultiplier) < 1e-9);
  assert.ok(G.incomePerSecond(state) > 0);
});

test("tick 按毫秒结算金币并消耗饱食度/心情", () => {
  const state = G.hydrate({ level: 1, mood: 100, satiety: 100 }, NOW);
  const before = state.coins;
  G.tick(state, 60_000); // 1 分钟
  assert.ok(Math.abs(state.coins - before - 1.5 * 60) < 1e-6);
  assert.ok(Math.abs(state.satiety - (100 - G.BALANCE.satietyDecayPerMinute)) < 1e-6);
  assert.ok(state.mood < 100);
});

test("离线收益打折且有 8 小时上限", () => {
  const state = G.hydrate({ level: 10, mood: 100, satiety: 100, lastTick: NOW - 40 * 3600 * 1000 }, NOW);
  const expect = G.incomePerSecond(state) * G.BALANCE.offlineCapHours * 3600 * G.BALANCE.offlineEfficiency;
  const result = G.settleOffline(state, NOW);
  assert.ok(Math.abs(result.earned - expect) < 1e-6);
  assert.strictEqual(result.seconds, G.BALANCE.offlineCapHours * 3600);
  assert.ok(state.satiety >= G.BALANCE.offlineSatietyFloor);
  assert.ok(state.mood >= G.BALANCE.offlineMoodFloor);
});

test("刚刚才玩过就不结算离线收益", () => {
  const state = G.hydrate({ lastTick: NOW - 10_000 }, NOW);
  const result = G.settleOffline(state, NOW);
  assert.strictEqual(result.earned, 0);
  assert.strictEqual(state.lastTick, NOW);
});

test("喂饭花钱换饱食度，钱不够会被拒绝", () => {
  const state = G.hydrate({ coins: 100, satiety: 40 }, NOW);
  const ok = G.feed(state, NOW);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(state.coins, 100 - G.BALANCE.feedCost);
  assert.strictEqual(state.satiety, 40 + G.BALANCE.feedValue);
  assert.strictEqual(state.stats.feeds, 1);

  state.coins = 1;
  const no = G.feed(state, NOW);
  assert.strictEqual(no.ok, false);
  assert.strictEqual(no.reason, "coin");
  assert.strictEqual(state.coins, 1);
});

test("吃太饱会被拒绝，但不会扣钱", () => {
  const state = G.hydrate({ coins: 100, satiety: 100 }, NOW);
  const result = G.feed(state, NOW);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(state.coins, 100);
});

test("批量修炼消耗灵石，随机获得一次修为并可能毫无进展", () => {
  const state = G.hydrate(
    {
      coins: 1000,
      cultivation: {
        attributes: { root: "metal", insight: 70, fortune: 50, daoHeart: 60, lifespan: 90 },
        spiritStones: 3,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const { started, finished } = finishStoneSession(state, () => 0.9);
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.used, 1);
  assert.ok(finished.gained > 0);
  assert.strictEqual(state.cultivation.spiritStones, 2);
  assert.ok(state.cultivation.exp > 0);

  const noProgress = G.hydrate(
    {
      cultivation: {
        attributes: { root: "mixed", insight: 20, fortune: 20, daoHeart: 40, lifespan: 90 },
        spiritStones: 1,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const { finished: none } = finishStoneSession(noProgress, () => 0);
  assert.strictEqual(none.noProgress, true);
  assert.strictEqual(noProgress.cultivation.exp, 0);
  assert.strictEqual(noProgress.cultivation.spiritStones, 0);
});

test("灵石能量固定，不随玩家等级提高", () => {
  const makeState = (level) =>
    G.hydrate(
      {
        level,
        cultivation: {
          attributes: { root: "mixed", insight: 20, fortune: 20, daoHeart: 70, lifespan: 90 },
          spiritStones: 1,
          regionId: "qingju_plain",
          lastAgedAt: NOW,
        },
      },
      NOW
    );
  const low = makeState(1);
  const high = makeState(90);
  const lowResult = finishStoneSession(low, () => 0.9).finished;
  const highResult = finishStoneSession(high, () => 0.9).finished;
  assert.strictEqual(G.CULTIVATION.STONE_TIERS.low.energy, 10);
  assert.strictEqual(G.CULTIVATION.STONE_TIERS.mid.energy, 100);
  assert.strictEqual(G.CULTIVATION.STONE_TIERS.high.energy, 1000);
  assert.strictEqual(G.CULTIVATION.STONE_TIERS.supreme.energy, 10000);
  assert.strictEqual(G.CULTIVATION.stoneBaseExperience(1, "low"), 10);
  assert.strictEqual(G.CULTIVATION.stoneBaseExperience(90, "low"), 10);
  assert.strictEqual(highResult.gained, lowResult.gained);
});

test("四档灵石经验依次提高，并受橘子大陆区域灵气影响", () => {
  const makeState = (tier, regionId) =>
    G.hydrate(
      {
        level: 11,
        cultivation: {
          attributes: { root: "mixed", insight: 20, fortune: 20, daoHeart: 70, lifespan: 90 },
          stones: { low: 1, mid: 1, high: 1, supreme: 1 },
          selectedStoneTier: tier,
          regionId,
          lastAgedAt: NOW,
        },
      },
      NOW
    );
  const run = (state, tier) => {
    const started = G.cultivate(state, 1, NOW, () => 0.9, tier);
    return G.settleStoneCultivation(state, started.endsAt + 1, () => 0.9);
  };
  const low = run(makeState("low", "qingju_plain"), "low");
  const supreme = run(makeState("supreme", "qingju_plain"), "supreme");
  const qiRich = run(makeState("supreme", "ghost_realm"), "supreme");
  assert.ok(supreme.gained > low.gained * 10);
  assert.ok(qiRich.gained > supreme.gained);
  assert.strictEqual(qiRich.region.id, "ghost_realm");
});

test("灵石购买数量和修炼消耗数量可以自定义并保存", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const quantities = G.setStoneQuantities(state, 7, 3, NOW);
  assert.strictEqual(quantities.buyQuantity, 7);
  assert.strictEqual(quantities.consumeQuantity, 3);
  state.cultivation.stones.low = 5;
  state.cultivation.spiritStones = 5;
  const result = G.cultivate(state, state.cultivation.consumeQuantity, NOW, () => 0.5);
  assert.strictEqual(result.used, 3);
  assert.strictEqual(state.cultivation.stones.low, 2);
  assert.strictEqual(state.cultivation.spiritStones, 2);
  G.settleStoneCultivation(state, result.endsAt + 1, () => 0.9);
  const insufficient = G.cultivate(state, 3, NOW, () => 0.5);
  assert.strictEqual(insufficient.reason, "stones");
  assert.strictEqual(insufficient.available, 2);
  assert.strictEqual(state.cultivation.stones.low, 2);
  const maximum = G.setStoneQuantities(state, 9999, 9999, NOW);
  assert.strictEqual(maximum.buyQuantity, 9999);
  assert.strictEqual(maximum.consumeQuantity, 9999);
});

test("1000 颗灵石只创建一次批处理，判定不随数量循环", () => {
  const state = G.hydrate(
    {
      cultivation: {
        attributes: { root: "metal", insight: 70, fortune: 50, daoHeart: 60, lifespan: 90 },
        stones: { low: 1000, mid: 0, high: 0, supreme: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  let rolls = 0;
  const rng = () => {
    rolls += 1;
    return 0.9;
  };
  const started = G.cultivate(state, 1000, NOW, rng, "low");
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.used, 1000);
  assert.strictEqual(started.totalEnergy, 10_000);
  assert.strictEqual(state.cultivation.stones.low, 0);
  assert.strictEqual(state.cultivation.exp, 0);
  assert.strictEqual(state.cultivation.stoneSession.active, true);
  assert.strictEqual(G.cultivate(state, 1000, NOW, rng, "low").reason, "session");
  const finished = G.settleStoneCultivation(state, started.endsAt + 1, rng);
  assert.strictEqual(finished.completed, true);
  assert.strictEqual(state.cultivation.stoneSession.active, false);
  assert.ok(rolls <= 5, `一次批处理应只有少量随机判定，实际 ${rolls} 次`);
  const expAfter = state.cultivation.exp;
  assert.strictEqual(G.settleStoneCultivation(state, started.endsAt + 2000, rng).completed, false);
  assert.strictEqual(state.cultivation.exp, expAfter);
  assert.ok(G.CULTIVATION.stoneBatchChances(state.cultivation).noProgress <= 0.025);
});

test("灵石总量与等级共同决定批量修炼时间", () => {
  const makeState = (level, quantity) =>
    G.hydrate(
      {
        level,
        cultivation: {
          attributes: { root: "metal", insight: 70, fortune: 50, daoHeart: 60, lifespan: 200 },
          stones: { low: quantity, mid: 0, high: 0, supreme: 0 },
          lastAgedAt: NOW,
        },
      },
      NOW
    );
  const lowLevelTen = G.cultivate(makeState(1, 10), 10, NOW, () => 0.9, "low");
  const lowLevelHundred = G.cultivate(makeState(1, 100), 100, NOW, () => 0.9, "low");
  const highLevelHundred = G.cultivate(makeState(100, 100), 100, NOW, () => 0.9, "low");
  const levelHundredRate = G.CULTIVATION.stoneAbsorptionRate(makeState(100, 1).cultivation, 100);
  assert.strictEqual(lowLevelHundred.totalEnergy, lowLevelTen.totalEnergy * 10);
  assert.ok(lowLevelHundred.durationMs > lowLevelTen.durationMs);
  assert.ok(highLevelHundred.energyPerSecond > lowLevelTen.energyPerSecond);
  assert.ok(highLevelHundred.durationMs < lowLevelHundred.durationMs);
  assert.strictEqual(levelHundredRate.base, 3 + 100 * (1.8 + 100 / 100) + 70 * 0.8);
});

test("灵石批量修炼会话可在重启存档后离线完成", () => {
  const state = G.hydrate(
    {
      cultivation: {
        attributes: { root: "metal", insight: 90, fortune: 80, daoHeart: 70, lifespan: 120 },
        stones: { low: 25, mid: 0, high: 0, supreme: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const started = G.cultivate(state, 25, NOW, () => 0.9, "low");
  const restored = G.hydrate(JSON.parse(JSON.stringify(state)), started.endsAt + 1);
  assert.strictEqual(restored.cultivation.stoneSession.active, true);
  const offline = G.settleOffline(restored, started.endsAt + 1, () => 0.9);
  assert.strictEqual(offline.stoneCultivation.completed, true);
  assert.ok(restored.cultivation.exp > 0);
  assert.strictEqual(restored.cultivation.stoneSession.active, false);
});

test("橘子大陆区域按等级解锁，初始出生只开放三个区域", () => {
  const starters = G.CULTIVATION.ORANGE_REGIONS.filter((region) => region.minLevel <= 1);
  assert.strictEqual(G.CULTIVATION.ORANGE_CONTINENT.name, "橘子大陆");
  assert.strictEqual(starters.length, 3);
  const state = G.hydrate({ level: 10 }, NOW, () => 0.4);
  assert.strictEqual(G.travelToRegion(state, "ghost_realm", NOW).reason, "locked");
  assert.strictEqual(G.travelToRegion(state, "chenghu_marsh", NOW).ok, true);
  state.level = 41;
  assert.strictEqual(G.travelToRegion(state, "ghost_realm", NOW).ok, true);
  assert.strictEqual(state.cultivation.regionId, "ghost_realm");
});

test("区域灵石开采会按灵气与特性产出不同品质", () => {
  const state = G.hydrate(
    {
      level: 11,
      cultivation: {
        attributes: { root: "water", insight: 60, fortune: 80, daoHeart: 70, lifespan: 90 },
        regionId: "xuanshui_ravine",
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const result = G.mineSpiritStones(state, NOW, () => 0.9);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.tier, "supreme");
  assert.ok(state.cultivation.stones.supreme > 0);
  assert.strictEqual(G.mineSpiritStones(state, NOW + 1000, () => 0.9).reason, "cooldown");
});

test("打坐按灵气浓度、天赋与阵法持续获得修为", () => {
  const makeState = (formationId, regionId) =>
    G.hydrate(
      {
        level: 41,
        cultivation: {
          attributes: {
            root: "wood",
            insight: 80,
            fortune: 50,
            daoHeart: 70,
            lifespan: 100,
          },
          formationId,
          regionId,
          meditation: { active: true, lastAt: NOW, totalSeconds: 0 },
          lastAgedAt: NOW,
        },
      },
      NOW
    );
  const plain = makeState("none", "qingju_plain");
  const empowered = makeState("five_elements", "ghost_realm");
  const plainRate = G.CULTIVATION.meditationRate(plain.cultivation, plain.level);
  const empoweredRate = G.CULTIVATION.meditationRate(empowered.cultivation, empowered.level);
  assert.ok(empoweredRate.perHour > plainRate.perHour * 2.5);

  const beforeTechnique = plain.cultivation.technique;
  const gained = G.settleMeditation(plain, NOW + 3600000);
  assert.ok(gained.gained > 0);
  assert.ok(gained.techniqueGained > 0);
  assert.ok(plain.cultivation.technique > beforeTechnique);
  assert.ok(plain.cultivation.exp > 0);
  assert.strictEqual(plain.cultivation.meditation.totalSeconds, 3600);
  assert.strictEqual(plain.cultivation.meditation.active, true);
});

test("参悟功法可主动提高功法领悟并进入冷却", () => {
  const state = G.hydrate(
    {
      level: 11,
      cultivation: {
        attributes: {
          root: "water",
          insight: 60,
          fortune: 44,
          daoHeart: 70,
          lifespan: 90,
        },
        formationId: "gathering",
        regionId: "cloudsea_peak",
        techniquesKnown: ["tech_water_heaven_upper"],
        equippedTechniques: ["tech_water_heaven_upper"],
        techniqueProgress: { tech_water_heaven_upper: 12 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const values = [0.1, 0.9, 0.5];
  let index = 0;
  const result = G.comprehendTechnique(state, NOW, () => values[index++] ?? 0.5);
  assert.strictEqual(result.ok, true);
  assert.ok(state.cultivation.technique > 0);
  assert.ok(state.cultivation.techniqueProgress.tech_water_heaven_upper > 12);
  assert.strictEqual(state.cultivation.techniqueReadyAt, NOW + 5 * 60000);
  assert.strictEqual(G.comprehendTechnique(state, NOW + 1000, () => 0.5).reason, "cooldown");
});

test("打坐到瓶颈自动停止，阵法按等级解锁", () => {
  const state = G.hydrate(
    {
      level: 20,
      cultivation: {
        attributes: {
          root: "innate",
          insight: 100,
          fortune: 50,
          daoHeart: 70,
          lifespan: 100,
        },
        formationId: "gathering",
        regionId: "cloudsea_peak",
        meditation: { active: true, lastAt: NOW, totalSeconds: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  state.cultivation.exp = G.CULTIVATION.expRequired(20) - 0.1;
  const settled = G.settleMeditation(state, NOW + 60000);
  assert.strictEqual(state.level, 20);
  assert.strictEqual(settled.atCap, true);
  assert.strictEqual(state.cultivation.meditation.active, false);

  state.level = 21;
  assert.strictEqual(G.setFormation(state, "five_elements", NOW).reason, "locked");
  state.level = 41;
  assert.strictEqual(G.setFormation(state, "five_elements", NOW).ok, true);
  assert.strictEqual(state.cultivation.formationId, "five_elements");
});

test("普通小境界修为满后自动晋升，大境界圆满后停止修炼", () => {
  const state = G.hydrate(
    {
      cultivation: {
        attributes: { root: "innate", insight: 96, fortune: 50, daoHeart: 70, lifespan: 100 },
        spiritStones: 20,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const first = G.cultivate(state, 20, NOW, () => 0.9);
  G.settleStoneCultivation(state, first.endsAt + 1, () => 0.9);
  assert.ok(state.level > 1);

  state.level = 9;
  state.cultivation.exp = G.CULTIVATION.expRequired(9) - 250;
  state.cultivation.stones.low = 100;
  state.cultivation.spiritStones = 100;
  const second = G.cultivate(state, 100, NOW, () => 0.9);
  G.settleStoneCultivation(state, second.endsAt + 1, () => 0.9);
  assert.strictEqual(state.level, 10);
  state.cultivation.exp = G.CULTIVATION.expRequired(10);
  const blocked = G.cultivate(state, 1, NOW, () => 0.5);
  assert.strictEqual(blocked.reason, "breakthrough");
  assert.strictEqual(state.level, 10);
});

test("大境界突破要求修为、丹药、功法、悟性和道心", () => {
  const state = G.hydrate(
    {
      level: 10,
      cultivation: {
        attributes: { root: "earth", insight: 40, fortune: 50, daoHeart: 30, lifespan: 90 },
        spiritStones: 1,
        exp: G.CULTIVATION.expRequired(10),
        technique: 0,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const blocked = G.attemptBreakthrough(state, "pill", NOW, () => 0);
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.missing.includes("缺少引气丹") || blocked.missing.includes("功法领悟 0"));

  state.cultivation.technique = 100;
  state.cultivation.pills.breakthrough = 1;
  const ok = G.attemptBreakthrough(state, "pill", NOW, () => 0);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(state.level, 11);
  assert.strictEqual(state.cultivation.pills.breakthrough, 0);
  assert.strictEqual(state.cultivation.exp, 0);
});

test("同源灵根等阶会同时提高修炼收益和突破成功率", () => {
  const base = {
    attributes: {
      root: "metal",
      insight: 80,
      fortune: 60,
      daoHeart: 70,
      lifespan: 100,
    },
    exp: G.CULTIVATION.expRequired(10),
    technique: 100,
    pills: { breakthrough: 1, life: 0 },
    regionId: "qingju_plain",
    lastAgedAt: NOW,
  };
  const plain = G.hydrate(
    { level: 10, cultivation: { ...base, attributes: { ...base.attributes, rootLineage: 0 } } },
    NOW
  );
  const lineage = G.hydrate(
    { level: 10, cultivation: { ...base, attributes: { ...base.attributes, rootLineage: 2 } } },
    NOW
  );
  const plainChance = G.CULTIVATION.breakthroughStatus(plain.cultivation, 10, "pill", NOW).chance;
  const lineageChance = G.CULTIVATION.breakthroughStatus(lineage.cultivation, 10, "pill", NOW).chance;
  assert.ok(lineageChance > plainChance);
  assert.ok(
    G.CULTIVATION.meditationRate(lineage.cultivation, 10).perHour >
      G.CULTIVATION.meditationRate(plain.cultivation, 10).perHour
  );
});

test("灵根体系覆盖单、双、三、四、五灵根、变异灵根与先天道体", () => {
  const roots = Object.values(G.CULTIVATION.ROOTS);
  const countKind = (kind) => roots.filter((root) => root.kind === kind).length;
  assert.strictEqual(roots.length, 37);
  assert.strictEqual(countKind("single"), 5);
  assert.strictEqual(countKind("dual"), 10);
  assert.strictEqual(countKind("triple"), 10);
  assert.strictEqual(countKind("quad"), 5);
  assert.strictEqual(countKind("mixed"), 1);
  assert.strictEqual(countKind("variant"), 5);
  assert.strictEqual(countKind("innate"), 1);
  assert.strictEqual(G.CULTIVATION.ROOTS["dual_metal_water"].gain, 0.7);
  assert.strictEqual(G.CULTIVATION.ROOTS["dual_metal_wood"].gain, 0.6);
  assert.strictEqual(G.CULTIVATION.ROOTS.mixed.gain, 0.1);
  assert.ok(G.CULTIVATION.ROOTS.chaos.gain >= G.CULTIVATION.ROOTS.ice.gain * 2);
  const tribulationCultivation = (root) => ({
    attributes: { root, insight: 80, fortune: 30, daoHeart: 80, lifespan: 100, rootLineage: 0 },
    karma: 0,
    thunderPearls: 0,
  });
  assert.ok(
    G.CULTIVATION.tribulationProfile(tribulationCultivation("thunder"), 100).strength <
      G.CULTIVATION.tribulationProfile(tribulationCultivation("metal"), 100).strength
  );

  const sequence = (values) => {
    let index = 0;
    return () => values[index++] ?? 0;
  };
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.000000005, 0.99])), "innate");
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.0000005, 0.99])), "chaos");
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.0001, 0])), "metal");
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.0005, 0])), "dual_metal_wood");
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.005, 0])), "triple_metal_wood_water");
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.05, 0])), "quad_metal_wood_water_fire");
  assert.strictEqual(G.CULTIVATION.rollRoot(sequence([0.5])), "mixed");
});

test("功法目录为每种灵根提供天地玄黄与上中下品", () => {
  const techniques = Object.values(G.CULTIVATION.TECHNIQUES);
  assert.strictEqual(techniques.length, 444);
  assert.strictEqual(new Set(techniques.map((item) => item.root)).size, 37);
  assert.strictEqual(new Set(techniques.map((item) => item.tier)).size, 4);
  assert.strictEqual(new Set(techniques.map((item) => item.grade)).size, 3);
  assert.ok(
    G.CULTIVATION.TECHNIQUES.tech_metal_heaven_upper.cultivationMultiplier >
      G.CULTIVATION.TECHNIQUES.tech_metal_yellow_lower.cultivationMultiplier
  );
  assert.ok(G.CULTIVATION.TECHNIQUES.tech_thunder_heaven_upper.name.includes("九天雷霆诀"));
  assert.ok(G.CULTIVATION.TECHNIQUES.tech_dual_metal_water_heaven_upper.name.includes("双炼诀"));
  assert.deepStrictEqual(Object.keys(G.CULTIVATION.TECHNIQUE_CATEGORIES), [
    "heart",
    "spell",
    "combat",
    "movement",
    "body",
  ]);
  assert.strictEqual(new Set(techniques.map((item) => item.category)).size, 5);
  Object.keys(G.CULTIVATION.ROOTS).forEach((rootId) => {
    assert.strictEqual(
      new Set(techniques.filter((technique) => technique.root === rootId).map((item) => item.category)).size,
      5
    );
  });
});

test("五类功法可同时修炼，每部功法独立累计并参悟进度", () => {
  const state = G.hydrate(
    {
      level: 41,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 90,
          fortune: 70,
          daoHeart: 80,
          lifespan: 100,
        },
        regionId: "qingju_plain",
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const byCategory = {};
  Object.values(G.CULTIVATION.TECHNIQUES)
    .filter((technique) => technique.root === "metal")
    .forEach((technique) => {
      if (!byCategory[technique.category]) byCategory[technique.category] = technique;
    });
  Object.values(byCategory).forEach((technique) => {
    state.cultivation.techniqueScrolls[technique.id] = 1;
    assert.strictEqual(G.studyTechnique(state, technique.id, NOW).ok, true);
  });
  assert.strictEqual(state.cultivation.equippedTechniques.length, 5);
  assert.strictEqual(
    new Set(G.CULTIVATION.activeTechniques(state.cultivation).map((technique) => technique.category)).size,
    5
  );
  assert.ok(Object.values(state.cultivation.techniqueProgress).every((progress) => progress > 0));

  const target = G.CULTIVATION.activeTechniques(state.cultivation)[0];
  const beforeTarget = state.cultivation.techniqueProgress[target.id];
  const other = Object.entries(state.cultivation.techniqueProgress).find(([id]) => id !== target.id);
  const result = G.comprehendTechnique(state, NOW, () => 0, target.id);
  assert.strictEqual(result.ok, true);
  assert.ok(state.cultivation.techniqueProgress[target.id] > beforeTarget);
  assert.strictEqual(state.cultivation.techniqueProgress[other[0]], other[1]);
  assert.ok(G.CULTIVATION.techniqueBonuses(state.cultivation).cultivationMultiplier > 1);
});

test("洞天福地固定 10 处，每轮随机 1–3 个大型并可选择前往", () => {
  const state = G.hydrate(
    {
      level: 41,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 70,
          daoHeart: 80,
          lifespan: 100,
        },
        stones: { low: 5, mid: 0, high: 0, supreme: 0 },
        regionId: "qingju_plain",
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const sequence = (values) => {
    let index = 0;
    return () => values[index++] ?? 0.25;
  };
  const status = G.caveHeavenStatus(state, NOW, sequence([0, 0.2, 0.7]));
  assert.strictEqual(status.spots.length, 10);
  assert.strictEqual(new Set(status.spots.map((spot) => spot.id)).size, 10);
  assert.ok(status.largeCount >= 1 && status.largeCount <= 3);
  const beforeRate = G.CULTIVATION.meditationRate(state.cultivation, state.level).perHour;
  const target = status.spots.find((spot) => spot.size === "small");
  const entered = G.enterCaveHeaven(state, target.id, NOW, () => 0);
  assert.strictEqual(entered.ok, true);
  assert.strictEqual(state.cultivation.cave.active.id, target.id);
  assert.strictEqual(entered.rewards.length, 1);
  assert.notStrictEqual(entered.rewards[0].type, "none");
  const afterRate = G.CULTIVATION.meditationRate(state.cultivation, state.level).perHour;
  assert.ok(afterRate > beforeRate);
  assert.strictEqual(G.enterCaveHeaven(state, status.spots[0].id, NOW + 1000, () => 0).reason, "active");
});

test("大型福地守灵支持避战、观望和战斗，分别调整爆率与修为结果", () => {
  const makeState = () =>
    G.hydrate(
      {
        level: 41,
        cultivation: {
          attributes: {
            root: "metal",
            insight: 90,
            fortune: 80,
            daoHeart: 80,
            lifespan: 100,
          },
          stones: { low: 5, mid: 0, high: 0, supreme: 0 },
          regionId: "qingju_plain",
          lastAgedAt: NOW,
        },
      },
      NOW
    );
  const prepare = () => {
    const state = makeState();
    const status = G.caveHeavenStatus(state, NOW, () => 0);
    const large = status.spots.find((spot) => spot.size === "large");
    const entered = G.enterCaveHeaven(state, large.id, NOW, () => 0);
    assert.strictEqual(entered.challenge, true);
    assert.strictEqual(state.cultivation.cave.challenge.id, large.id);
    return state;
  };

  const avoided = prepare();
  const avoid = G.resolveCaveChallenge(avoided, "avoid", NOW, () => 0.99);
  assert.strictEqual(avoid.ok, true);
  assert.strictEqual(avoid.lootMultiplier, 0.2);
  assert.strictEqual(avoid.combat, null);
  assert.strictEqual(avoid.rewards[0].type, "none");

  const observed = prepare();
  const observe = G.resolveCaveChallenge(observed, "observe", NOW, () => 0);
  assert.strictEqual(observe.lootMultiplier, 0.5);
  assert.strictEqual(observe.combat, null);

  const fought = prepare();
  const beforeExp = fought.cultivation.exp;
  const fight = G.resolveCaveChallenge(fought, "fight", NOW, () => 0);
  assert.strictEqual(fight.lootMultiplier, 1.2);
  assert.strictEqual(fight.combat.outcome, "win");
  assert.ok(fight.combat.gained > 0);
  assert.ok(fought.cultivation.exp > beforeExp);

  const lost = prepare();
  lost.cultivation.exp = Math.round(G.CULTIVATION.expRequired(lost.level) * 0.2);
  const beforeLoss = lost.cultivation.exp;
  const failure = G.resolveCaveChallenge(lost, "fight", NOW, () => 0.99);
  assert.strictEqual(failure.combat.outcome, "loss");
  assert.ok(failure.combat.lost > 0);
  assert.ok(lost.cultivation.exp < beforeLoss);
});

test("悟道丹、培元丹和静心丹会消耗并随机生效", () => {
  const state = G.hydrate(
    {
      level: 20,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 60,
          daoHeart: 60,
          lifespan: 100,
        },
        techniquesKnown: ["tech_metal_heaven_upper"],
        equippedTechniques: ["tech_metal_heaven_upper"],
        techniqueProgress: { tech_metal_heaven_upper: 10 },
        pills: { breakthrough: 0, life: 0, technique: 1, cultivation: 1, heart: 1 },
        regionId: "qingju_plain",
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const technique = G.takeCultivationPill(state, "technique", NOW, () => 0);
  assert.strictEqual(technique.ok, true);
  assert.ok(state.cultivation.techniqueProgress.tech_metal_heaven_upper > 10);
  assert.strictEqual(state.cultivation.pills.technique, 0);

  const beforeExp = state.cultivation.exp;
  const cultivation = G.takeCultivationPill(state, "cultivation", NOW, () => 0);
  assert.strictEqual(cultivation.ok, true);
  assert.ok(state.cultivation.exp > beforeExp);
  assert.strictEqual(state.cultivation.pills.cultivation, 0);

  const heart = G.takeCultivationPill(state, "heart", NOW, () => 0);
  assert.strictEqual(heart.ok, true);
  assert.strictEqual(state.cultivation.attributes.daoHeart, 62);
  assert.strictEqual(state.cultivation.pills.heart, 0);
});

test("混沌与先天道体兼容全属性功法，普通灵根仅适配本命功法", () => {
  const make = (root) => ({ attributes: { root } });
  assert.strictEqual(G.CULTIVATION.techniqueCompatible(make("chaos"), "tech_metal_heaven_upper"), true);
  assert.strictEqual(G.CULTIVATION.techniqueCompatible(make("innate"), "tech_ice_heaven_upper"), true);
  assert.strictEqual(
    G.CULTIVATION.techniqueCompatible(make("metal"), "tech_dual_metal_water_heaven_upper"),
    false
  );
  assert.strictEqual(
    G.CULTIVATION.techniqueCompatible(make("dual_metal_water"), "tech_dual_metal_water_heaven_upper"),
    true
  );
});

test("商城功法可购买、研习、装备并增强修炼与突破", () => {
  const state = G.hydrate(
    {
      level: 11,
      coins: 100000,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 70,
          fortune: 50,
          daoHeart: 70,
          lifespan: 90,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const item = G.CULTIVATION.TECHNIQUES.tech_metal_earth_middle;
  const bought = G.purchase(state, item, NOW);
  assert.strictEqual(bought.ok, true);
  assert.strictEqual(state.cultivation.techniqueScrolls[item.id], 1);
  const studied = G.studyTechnique(state, item.id, NOW);
  assert.strictEqual(studied.ok, true);
  assert.ok(state.cultivation.techniquesKnown.includes(item.id));
  assert.strictEqual(state.cultivation.equippedTechnique, item.id);
  assert.ok(G.CULTIVATION.activeTechnique(state.cultivation));

  const wrong = G.CULTIVATION.TECHNIQUES.tech_fire_yellow_lower;
  assert.strictEqual(G.purchase(state, wrong, NOW).reason, "root");

  const reward = G.rollTechniqueReward(state, G.CULTIVATION.ORANGE_REGIONS[0], () => 0.99);
  assert.strictEqual(reward.root, "metal");
  assert.ok(state.cultivation.techniqueScrolls[reward.id] >= 1);
});

test("突破失败退回一半修为、消耗丹药并进入冷却", () => {
  const state = G.hydrate(
    {
      level: 10,
      cultivation: {
        attributes: { root: "fire", insight: 100, fortune: 100, daoHeart: 80, lifespan: 90 },
        exp: G.CULTIVATION.expRequired(10),
        technique: 100,
        pills: { breakthrough: 1, life: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const beforeHeart = state.cultivation.attributes.daoHeart;
  const failed = G.attemptBreakthrough(state, "pill", NOW, () => 1);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(state.cultivation.exp, Math.floor(G.CULTIVATION.expRequired(10) * 0.5));
  assert.strictEqual(state.cultivation.pills.breakthrough, 0);
  assert.strictEqual(state.cultivation.cooldownUntil, NOW + 10 * 60000);
  assert.ok(state.cultivation.attributes.daoHeart < beforeHeart);
});

test("灵根、悟性和传承会共同放大修炼收益", () => {
  const weak = G.hydrate(
    {
      cultivation: {
        attributes: { root: "mixed", insight: 20, fortune: 20, daoHeart: 20, lifespan: 90 },
        spiritStones: 1,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const strong = G.hydrate(
    {
      cultivation: {
        attributes: {
          root: "innate",
          insight: 100,
          fortune: 100,
          daoHeart: 100,
          lifespan: 100,
          rootLineage: 2,
        },
        spiritStones: 1,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const makeRng = () => {
    const values = [0.9, 0, 0, 0.9];
    let index = 0;
    return () => values[index++] ?? 0.9;
  };
  const weakResult = G.CULTIVATION.cultivateOnce(weak.cultivation, 1, makeRng(), "low");
  const strongResult = G.CULTIVATION.cultivateOnce(strong.cultivation, 1, makeRng(), "low");
  assert.ok(strongResult.gained > weakResult.gained * 2);
});

test("最高境界锁定 Lv.999，不会再次累加修为", () => {
  const state = G.hydrate(
    {
      level: 999,
      cultivation: {
        attributes: { root: "innate", insight: 100, fortune: 100, daoHeart: 100, lifespan: 100 },
        spiritStones: 5,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const result = G.cultivate(state, 1, NOW, () => 0.5);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "max-level");
  assert.strictEqual(state.level, 999);
  assert.strictEqual(state.cultivation.spiritStones, 5);
});

test("修为需求按大境界 6 倍、小境界 1.3 倍和瓶颈 4 倍增长", () => {
  assert.strictEqual(G.CULTIVATION.expRequired(11), 100);
  assert.strictEqual(G.CULTIVATION.expRequired(12), 130);
  assert.strictEqual(G.CULTIVATION.expRequired(19), 816);
  assert.strictEqual(G.CULTIVATION.expRequired(20), 3263);
  assert.strictEqual(G.CULTIVATION.expRequired(21), 600);
  assert.strictEqual(G.CULTIVATION.expRequired(41), 21600);
  assert.ok(G.CULTIVATION.expRequired(999 - 1) > 1e50);
  assert.strictEqual(G.CULTIVATION.expRequired(999), 0);
});

test("摸头加心情并且掉 1~3 金币", () => {
  for (const roll of [0, 0.5, 0.999]) {
    const state = G.hydrate({ mood: 50 }, NOW);
    const result = G.pet(state, NOW, () => roll);
    assert.ok(result.bonus >= 1 && result.bonus <= 2);
    assert.strictEqual(state.coins, result.bonus);
    assert.strictEqual(state.mood, 51);
    assert.strictEqual(state.stats.pets, 1);
  }
});

test("心情好时更爱演开心的动作，饿的时候只演惨的", () => {
  const actions = [
    { name: "idle", kind: "idle" },
    { name: "love", kind: "happy" },
    { name: "cry", kind: "sad" },
    { name: "truck", kind: "fun" },
  ];
  const happy = G.hydrate({ mood: 95, satiety: 90 }, NOW);
  const sad = G.hydrate({ mood: 5, satiety: 5 }, NOW);

  let happyHappy = 0;
  let sadSad = 0;
  for (let i = 0; i < 1000; i += 1) {
    if (G.pickAmbientAction(actions, happy).kind === "happy") happyHappy += 1;
    if (G.pickAmbientAction(actions, sad).kind === "sad") sadSad += 1;
  }
  assert.ok(happyHappy > 450, `心情好时 happy 动作占比偏低: ${happyHappy}`);
  assert.ok(sadSad > 500, `饿的时候 sad 动作占比偏低: ${sadSad}`);
});

test("金币数字会缩写显示", () => {
  assert.strictEqual(G.formatCoins(999), "999");
  assert.strictEqual(G.formatCoins(12345), "12.3K");
  assert.strictEqual(G.formatCoins(2_500_000), "2.50M");
});

test("没有版本号的老存档会迁移到当前版本", () => {
  const migrated = G.migrate({ coins: 42, stats: { pets: 3 } });
  assert.strictEqual(migrated.version, G.SAVE_VERSION);
  assert.strictEqual(migrated.coins, 42);
  assert.strictEqual(migrated.stats.pets, 3);
  assert.strictEqual(migrated.stats.sessions, 0);
});

test("迁移后的老存档能被 hydrate 正常使用", () => {
  const state = G.hydrate({ coins: 42, level: 3, satiety: 60, mood: 70 }, NOW);
  assert.strictEqual(state.coins, 42);
  assert.strictEqual(state.level, 3);
  assert.strictEqual(state.version, G.SAVE_VERSION);
});

test("存档白名单拒绝非法输入", () => {
  assert.strictEqual(sanitizeSave(null), null);
  assert.strictEqual(sanitizeSave([]), null);
  assert.strictEqual(sanitizeSave("x"), null);
  assert.strictEqual(sanitizeSave({ coins: "abc" }), null);
  assert.strictEqual(sanitizeSave({ coins: 1, junk: "x".repeat(200 * 1024) }), null);
});

test("存档白名单会丢弃多余字段并夹住超范围数值", () => {
  const clean = sanitizeSave({
    coins: 100,
    level: 9999,
    satiety: 500,
    mood: -20,
    stats: { pets: -3, feeds: 2 },
    settings: { baseAction: "sit", scale: 99, showBubble: false },
    window: { x: 12.4, y: "abc" },
    hacked: { __proto__: { polluted: true } },
  });
  assert.strictEqual(clean.coins, 100);
  assert.strictEqual(clean.level, 999);
  assert.strictEqual(clean.satiety, 100);
  assert.strictEqual(clean.mood, 0);
  assert.strictEqual(clean.stats.pets, 0);
  assert.strictEqual(clean.stats.feeds, 2);
  assert.strictEqual(clean.settings.baseAction, "sit");
  assert.strictEqual(clean.settings.scale, 1.8);
  assert.strictEqual(clean.settings.showBubble, false);
  assert.strictEqual(clean.window.x, 12);
  assert.strictEqual(clean.window.y, null);
  assert.strictEqual(clean.hacked, undefined);
});

test("商城：买食物扣钱入背包，使用时恢复状态", () => {
  const state = G.hydrate({ coins: 100, satiety: 40, mood: 40 }, NOW);
  const fish = G.SHOP_ITEMS.fish;
  const bought = G.purchase(state, fish, NOW);
  assert.strictEqual(bought.ok, true);
  assert.strictEqual(state.coins, 85);
  assert.strictEqual(state.inventory.fish, 1);
  assert.strictEqual(state.shopStats.spent, 15);

  const used = G.useItem(state, fish, NOW);
  assert.strictEqual(used.ok, true);
  assert.strictEqual(state.satiety, 55);
  assert.strictEqual(state.inventory.fish, 0);
  assert.strictEqual(G.useItem(state, fish, NOW).reason, "empty");
});

test("商城：金币不足时买不了", () => {
  const state = G.hydrate({ coins: 5 }, NOW);
  const result = G.purchase(state, G.SHOP_ITEMS.cake, NOW);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "coin");
  assert.strictEqual(state.coins, 5);
});

test("商城：灵石、五种丹药和避雷珠可购买", () => {
  const state = G.hydrate({ level: 41, coins: 1000000 }, NOW);
  const stone = G.purchaseMany(state, G.SHOP_ITEMS.stone_high, 3, NOW);
  assert.strictEqual(stone.ok, true);
  assert.strictEqual(state.cultivation.stones.high, 3);
  assert.strictEqual(state.shopStats.purchases, 3);

  const breakthrough = G.purchase(state, G.SHOP_ITEMS.breakthrough_pill, NOW);
  const life = G.purchase(state, G.SHOP_ITEMS.life_pill, NOW);
  const technique = G.purchase(state, G.SHOP_ITEMS.technique_pill, NOW);
  const cultivation = G.purchase(state, G.SHOP_ITEMS.cultivation_pill, NOW);
  const heart = G.purchase(state, G.SHOP_ITEMS.heart_pill, NOW);
  const thunder = G.purchase(state, G.SHOP_ITEMS.thunder_pearl, NOW);
  assert.strictEqual(breakthrough.ok, true);
  assert.strictEqual(life.ok, true);
  assert.strictEqual(technique.ok, true);
  assert.strictEqual(cultivation.ok, true);
  assert.strictEqual(heart.ok, true);
  assert.strictEqual(thunder.ok, true);
  assert.strictEqual(state.cultivation.pills.breakthrough, 1);
  assert.strictEqual(state.cultivation.pills.life, 1);
  assert.strictEqual(state.cultivation.pills.technique, 1);
  assert.strictEqual(state.cultivation.pills.cultivation, 1);
  assert.strictEqual(state.cultivation.pills.heart, 1);
  assert.strictEqual(state.cultivation.thunderPearls, 1);
  assert.strictEqual(
    G.shopItemPrice(state, G.SHOP_ITEMS.breakthrough_pill),
    G.CULTIVATION.breakthroughCost(41)
  );
});

test("商城：装扮购买后解锁", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const action = { category: "dress", name: "dress_santa" };
  assert.strictEqual(G.isUnlocked(state, action), false);
  const bought = G.purchase(
    state,
    { id: "dress:dress_santa", type: "dress", price: 60, action: "dress_santa" },
    NOW
  );
  assert.strictEqual(bought.ok, true);
  assert.strictEqual(G.isUnlocked(state, action), true);
  assert.strictEqual(state.coins, 40000);
});

test("家具与装扮支持 1 / 3 / 7 / 30 日租赁，永久价为日价 1000 倍", () => {
  assert.strictEqual(G.rentalPrice(80, 1), 80);
  assert.strictEqual(G.rentalPrice(80, 3), 240);
  assert.strictEqual(G.rentalPrice(80, 7), 560);
  assert.strictEqual(G.rentalPrice(80, 30), 2400);
  assert.strictEqual(G.rentalPrice(80, "permanent"), 80000);

  const state = G.hydrate({ coins: 1000 }, NOW);
  const action = { category: "dress", name: "dress_rental" };
  const result = G.purchase(
    state,
    {
      id: "dress:dress_rental",
      type: "dress",
      price: 80,
      action: "dress_rental",
      rentalDuration: 3,
    },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.price, 240);
  assert.strictEqual(G.isUnlocked(state, action, NOW + 86399999), true);
  assert.strictEqual(G.isUnlocked(state, action, NOW + 3 * 86400000 + 1), false);
  assert.strictEqual(state.rentals.dress.dress_rental, NOW + 3 * 86400000);
});

test("新增叠穿服装可租赁、穿戴、计分并在到期后失效", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const item = G.SHOP_ITEMS.fashion_starlight_hat;
  const bought = G.purchase(state, { ...item, rentalDuration: 7 }, NOW);
  assert.strictEqual(bought.ok, true);
  assert.strictEqual(state.settings.equippedFashion, item.id);
  assert.strictEqual(G.isFashionActive(state, item, NOW + 1000), true);
  assert.strictEqual(G.fashionScore(state, [], NOW + 1000), item.score);
  assert.strictEqual(G.toggleFashion(state, item.id, NOW + 1000).equipped, false);
  assert.strictEqual(G.toggleFashion(state, item.id, NOW + 1000).equipped, true);
  assert.strictEqual(G.isFashionActive(state, item, NOW + 7 * 86400000 + 1), false);
  assert.strictEqual(G.toggleFashion(state, item.id, NOW + 7 * 86400000 + 1).ok, false);
});

test("家具榜只统计有效期内的家具，时装榜使用稳定单件积分", () => {
  const state = G.hydrate(
    {
      room: { furniture: ["rug"] },
      rentals: {
        furniture: { lamp: NOW + 1000, plant: NOW - 1 },
        dress: { dress_a: NOW + 1000, dress_b: NOW - 1 },
      },
      unlocked: ["dress_c"],
    },
    NOW
  );
  const actions = [
    { name: "dress_a", category: "dress" },
    { name: "dress_b", category: "dress" },
    { name: "dress_c", category: "dress" },
  ];
  assert.strictEqual(G.furnitureScore(state, NOW), G.FURNITURE.rug.score + G.FURNITURE.lamp.score);
  assert.strictEqual(G.fashionScore(state, actions, NOW), G.dressScore(0) + G.dressScore(2));
  assert.strictEqual(G.leaderboardScores(state, actions, NOW).fashion, G.dressScore(0) + G.dressScore(2));
});

test("旧存档中的伙伴会迁移为永久家具，租赁伙伴也计入家具榜", () => {
  const legacy = G.hydrate({ version: 12, companion: { adopted: true }, room: { furniture: [] } }, NOW);
  assert.ok(legacy.room.furniture.includes("companion"));
  assert.strictEqual(G.ownsFurniture(legacy, "companion", NOW), true);

  const rented = G.hydrate(
    { rentals: { furniture: { companion: NOW + 1000 }, dress: {} }, room: { furniture: [] } },
    NOW
  );
  assert.strictEqual(G.ownsFurniture(rented, "companion", NOW), true);
  assert.strictEqual(G.furnitureScore(rented, NOW), G.FURNITURE.companion.score);
});

test("新增家具和典藏会参与家具榜、典藏榜与产出", () => {
  const state = G.hydrate(
    {
      room: { furniture: ["bookshelf", "gaming_chair"] },
      perks: { luxury_aurora: true, luxury_eternal_office: true },
    },
    NOW
  );
  const base = G.incomePerSecond(state);
  assert.strictEqual(
    G.furnitureScore(state, NOW),
    G.FURNITURE.bookshelf.score + G.FURNITURE.gaming_chair.score
  );
  assert.strictEqual(
    G.collectionScore(state),
    G.SHOP_ITEMS.luxury_aurora.score + G.SHOP_ITEMS.luxury_eternal_office.score
  );
  assert.ok(base > G.incomePerSecond(G.hydrate({}, NOW)));

  const cleaned = sanitizeSave(state);
  assert.strictEqual(cleaned.perks.luxury_aurora, true);
  assert.strictEqual(cleaned.perks.luxury_eternal_office, true);
});

test("商城第二批家具、装扮和典藏各新增 10 款并可直接购买", () => {
  const furnitureIds = [
    "star_cat_bed",
    "sakura_swing",
    "mini_library",
    "dessert_cart",
    "whale_fountain",
    "cloud_game_pod",
    "moonlight_desk",
    "orbit_gramophone",
    "rainbow_greenhouse",
    "forest_wish_pool",
  ];
  const fashionIds = [
    "fashion_butterfly_clip",
    "fashion_cloud_earmuffs",
    "fashion_strawberry_band",
    "fashion_moon_earrings",
    "fashion_bell_collar",
    "fashion_crystal_tiara",
    "fashion_bunny_pack",
    "fashion_rainbow_cape",
    "fashion_star_eye_patch",
    "fashion_lunar_veil",
  ];
  const luxuryIds = [
    "luxury_stardust_music_box",
    "luxury_moon_castle",
    "luxury_time_garden",
    "luxury_phoenix_throne",
    "luxury_nebula_library",
    "luxury_interstellar_post",
    "luxury_dream_park",
    "luxury_sun_temple",
    "luxury_cosmic_cafe_end",
    "luxury_doro_universe",
  ];

  assert.strictEqual(Object.keys(G.FURNITURE).length, 31);
  assert.strictEqual(Object.values(G.SHOP_ITEMS).filter((item) => item.type === "fashion").length, 20);
  assert.strictEqual(Object.values(G.SHOP_ITEMS).filter((item) => item.type === "luxury").length, 32);
  furnitureIds.forEach((id) => assert.ok(G.FURNITURE[id], `缺少家具 ${id}`));
  fashionIds.forEach((id) => assert.strictEqual(G.SHOP_ITEMS[id].type, "fashion", `缺少装扮 ${id}`));
  luxuryIds.forEach((id) => assert.strictEqual(G.SHOP_ITEMS[id].type, "luxury", `缺少典藏 ${id}`));

  const state = G.hydrate({ coins: 2000000000000 }, NOW);
  assert.strictEqual(
    G.purchase(
      state,
      {
        id: "furniture:forest_wish_pool",
        type: "furniture",
        furnitureId: "forest_wish_pool",
        price: 55000000,
      },
      NOW
    ).ok,
    true
  );
  assert.strictEqual(
    G.purchase(state, { ...G.SHOP_ITEMS.fashion_lunar_veil, rentalDuration: 1 }, NOW).ok,
    true
  );
  assert.strictEqual(
    G.purchase(state, { ...G.SHOP_ITEMS.luxury_doro_universe, rentalDuration: "permanent" }, NOW).ok,
    true
  );
  assert.ok(state.room.furniture.includes("forest_wish_pool"));
  assert.ok(G.rentalActive(state, "dress", "fashion_lunar_veil", NOW));
  assert.strictEqual(state.perks.luxury_doro_universe, true);
});

test("商城权益可从本地提取并与 Docker 云端记录合并", () => {
  const state = G.hydrate(
    {
      perks: { luxury_cushion: true, theme_night: true },
      room: { furniture: ["bookshelf"] },
      rentals: { furniture: { gaming_chair: NOW + 1000 }, dress: { dress_santa: NOW + 2000 } },
      unlocked: ["dress_bow"],
    },
    NOW
  );
  const local = G.extractShopEntitlements(state);
  assert.strictEqual(local.items.luxury_cushion.permanent, true);
  assert.strictEqual(local.items.theme_night.permanent, true);
  assert.strictEqual(local.furniture.bookshelf.permanent, true);
  assert.strictEqual(local.furniture.gaming_chair.expiresAt, NOW + 1000);
  assert.strictEqual(local.dress.dress_bow.permanent, true);

  const merged = G.mergeShopEntitlements(state, {
    items: { luxury_aurora: { permanent: true, expiresAt: 0 } },
    furniture: {
      bookshelf: { permanent: true, expiresAt: 0 },
      gaming_chair: { permanent: false, expiresAt: NOW + 5000 },
    },
    dress: { dress_moon: { permanent: false, expiresAt: NOW + 3000 } },
  });
  assert.ok(merged.changed > 0);
  assert.strictEqual(state.perks.luxury_aurora, true);
  assert.strictEqual(state.rentals.furniture.gaming_chair, NOW + 5000);
  assert.strictEqual(state.rentals.dress.dress_moon, NOW + 3000);
  assert.ok(state.room.furniture.includes("bookshelf"));
});

test("榜一限定典藏永久保留，永耀提供当日分数与产出增幅", () => {
  const state = G.hydrate({ coins: 10 }, NOW);
  const baseline = G.incomePerSecond(state);
  const result = G.applyChampionAwards(state, ["rank_level_crown", "rank_level_crown", "not-a-real-award"]);
  assert.deepStrictEqual(result.changed, ["rank_level_crown"]);
  assert.strictEqual(state.perks.rank_level_crown, true);
  assert.strictEqual(G.collectionScore(state), G.SHOP_ITEMS.rank_level_crown.score);
  assert.strictEqual(G.purchase(state, G.SHOP_ITEMS.rank_level_crown, NOW).reason, "not-sale");
  assert.ok(Math.abs(G.incomePerSecond(state) - baseline * 1.05) < 1e-9);

  const boost = G.applyLeaderboardPrivileges(state, {
    awards: [],
    activeBoosts: {
      period: G.dayKey(),
      activeUntil: Date.now() + 60 * 60 * 1000,
      boards: ["level"],
    },
  });
  assert.strictEqual(boost.ok, true);
  assert.deepStrictEqual(boost.boards, ["level"]);
  assert.ok(Math.abs(G.incomePerSecond(state) - baseline * 2.05) < 1e-9);
  assert.strictEqual(G.incomeBreakdown(state).championPermanentBonus, 0.05);
  assert.strictEqual(G.incomeBreakdown(state).championBonus, 1);

  const stacked = G.applyLeaderboardPrivileges(state, {
    activeBoosts: {
      period: G.dayKey(),
      activeUntil: Date.now() + 60 * 60 * 1000,
      boards: ["level", "furniture", "level"],
    },
  });
  assert.deepStrictEqual(stacked.boards, ["level", "furniture"]);
  assert.ok(Math.abs(G.incomePerSecond(state) - baseline * 4.05) < 1e-9);

  state.leaderboardBoosts.activeUntil = Date.now() - 1;
  assert.deepStrictEqual(G.activeChampionBoards(state), []);
  assert.ok(Math.abs(G.incomePerSecond(state) - baseline * 1.05) < 1e-9);
});

test("咖啡让产出 ×1.5，招财猫永久 +10%", () => {
  const state = G.hydrate({ coins: 3000, mood: 50, satiety: 80 }, NOW);
  const base = G.incomePerSecond(state);
  G.purchase(state, G.SHOP_ITEMS.coffee, Date.now());
  assert.ok(G.incomePerSecond(state) >= base * 1.49);
  G.purchase(state, G.SHOP_ITEMS.lucky_cat, NOW);
  assert.ok(G.incomePerSecond(state) >= base * 1.5 * 1.09);
});

test("增益道具新增 10 款并按最高倍率生效、持续时间和到期状态可存档", () => {
  const ids = [
    "lemon_soda",
    "honey_bar",
    "matcha_latte",
    "energy_drink",
    "night_owl_drink",
    "lucky_clover",
    "cloud_aroma",
    "starlight_charm",
    "master_tea",
    "time_capsule",
  ];
  const buffs = Object.values(G.SHOP_ITEMS).filter((item) => item.type === "buff");
  assert.strictEqual(buffs.length, 11);
  assert.strictEqual(new Set(ids.map((id) => G.SHOP_ITEMS[id].buff)).size, 10);

  const state = G.hydrate({ coins: 100000, mood: 50, satiety: 80 }, Date.now());
  const now = Date.now();
  const base = G.incomePerSecond(state);
  assert.strictEqual(G.activeIncomeBuffMultiplier(state, now), 1);

  for (const id of ids) {
    const item = G.SHOP_ITEMS[id];
    assert.ok(item.minutes >= 10 && item.minutes <= 60, id);
    assert.ok(item.incomeMultiplier > 1, id);
    assert.strictEqual(G.purchase(state, item, now).ok, true, id);
  }
  assert.strictEqual(G.activeIncomeBuffMultiplier(state, now), 3);
  assert.ok(Math.abs(G.incomePerSecond(state) - base * 3) < 1e-9);
  assert.ok(G.activeBuff(state, "income_master_tea", now) >= now + 44 * 60000);

  G.purchase(state, G.SHOP_ITEMS.time_capsule, now + 1000);
  assert.ok(state.buffs.income_time_capsule >= now + 1000 + 30 * 60000);
  state.buffs.income_time_capsule = now - 1;
  assert.strictEqual(G.activeIncomeBuffMultiplier(state, now), 2.5);

  const cleaned = sanitizeSave(state);
  ids.forEach((id) => assert.ok(cleaned.buffs[G.SHOP_ITEMS[id].buff] > 0, id));
});

test("日程：添加、到期、提醒、完成、删除", () => {
  const state = G.hydrate({}, NOW);
  const added = G.addScheduleItem(state, { time: "09:00", text: "喝一杯水" }, NOW);
  assert.strictEqual(added.ok, true);
  assert.strictEqual(state.schedule.length, 1);
  assert.strictEqual(G.addScheduleItem(state, { time: "25:00", text: "x" }, NOW).reason, "time");
  assert.strictEqual(G.addScheduleItem(state, { time: "10:00", text: "  " }, NOW).reason, "text");

  const dueAt = G.scheduleTimestamp(state.schedule[0], NOW) + 60000;
  const due = G.dueScheduleItems(state, dueAt);
  assert.strictEqual(due.length, 1);
  G.markScheduleNotified(state, due[0].id, dueAt);
  assert.strictEqual(G.dueScheduleItems(state, dueAt + 60000).length, 0);

  assert.strictEqual(G.toggleScheduleItem(state, added.item.id, dueAt), true);
  assert.ok(state.schedule[0].doneDate);
  assert.strictEqual(G.removeScheduleItem(state, added.item.id), true);
  assert.strictEqual(state.schedule.length, 0);
});

test("v1 老存档迁移后带上商城与日程字段", () => {
  const state = G.hydrate({ version: 1, coins: 10 }, NOW);
  assert.deepStrictEqual(state.inventory, {});
  assert.deepStrictEqual(state.schedule, []);
  assert.strictEqual(state.version, G.SAVE_VERSION);
});

test("v22 老存档升级到当前版本并保留组合灵根与长 ID 功法", () => {
  const raw = {
    version: 22,
    coins: 10,
    cultivation: {
      attributes: {
        root: "dual_metal_water",
        insight: 80,
        fortune: 70,
        daoHeart: 80,
        lifespan: 100,
      },
      soul: { level: 101, count: 1, root: "quad_metal_wood_water_fire", attributeBonus: 20 },
      techniqueScrolls: { tech_dual_metal_water_heaven_upper: 2 },
      techniquesKnown: ["tech_dual_metal_water_heaven_upper"],
      techniqueProgress: { tech_dual_metal_water_heaven_upper: 37.5 },
      equippedTechnique: "tech_dual_metal_water_heaven_upper",
      lastAgedAt: NOW,
    },
  };
  const migrated = G.hydrate(raw, NOW);
  assert.strictEqual(migrated.version, G.SAVE_VERSION);
  assert.strictEqual(migrated.cultivation.attributes.root, "dual_metal_water");
  assert.strictEqual(migrated.cultivation.soul.root, "quad_metal_wood_water_fire");
  assert.strictEqual(migrated.cultivation.techniqueScrolls.tech_dual_metal_water_heaven_upper, 2);
  assert.ok(migrated.cultivation.equippedTechniques.includes("tech_dual_metal_water_heaven_upper"));
  assert.strictEqual(migrated.cultivation.techniqueProgress.tech_dual_metal_water_heaven_upper, 37.5);
  assert.deepStrictEqual(migrated.cultivation.cave.spots, []);
  assert.strictEqual(migrated.cultivation.pills.technique, 0);
  assert.strictEqual(migrated.cultivation.pills.cultivation, 0);
  assert.strictEqual(migrated.cultivation.pills.heart, 0);
  const clean = sanitizeSave(migrated);
  assert.strictEqual(clean.cultivation.attributes.root, "dual_metal_water");
  assert.strictEqual(clean.cultivation.equippedTechnique, "tech_dual_metal_water_heaven_upper");
  assert.ok(clean.cultivation.equippedTechniques.includes("tech_dual_metal_water_heaven_upper"));
  assert.strictEqual(clean.cultivation.techniqueProgress.tech_dual_metal_water_heaven_upper, 37.5);
  assert.strictEqual(clean.cultivation.techniqueScrolls.tech_dual_metal_water_heaven_upper, 2);
});

test("存档白名单保留商城 / 日程字段并过滤非法项", () => {
  const clean = sanitizeSave({
    coins: 10,
    settings: {
      baseAction: "idle_stand",
      theme: "night",
      analytics: true,
      equippedFashion: "fashion_starlight_hat",
    },
    daily: { date: "2026-10-19", progress: { feeds: 2 }, claimed: ["feed1"] },
    achievements: ["first_pet"],
    metrics: { days: { "2026-10-19": 120 } },
    stickerRandom: { meme_test: true, bad: "x" },
    stickerLabels: { meme_test: "新名称", bad: 3 },
    stickerHidden: ["closeup_soft", "bad name"],
    inventory: { fish: 2, "bad-key": 3 },
    buffs: { double_income: 12345, income_time_capsule: 23456, "bad-key": 99 },
    perks: {
      lucky_cat: true,
      luxury_hourglass: true,
      luxury_moon_observatory: true,
      rank_fashion_crown: true,
    },
    leaderboardBoosts: {
      period: "2026-10-22",
      activeUntil: NOW + 3600000,
      boards: ["level", "collection", "bad"],
    },
    profile: {
      personality: "playful",
      likes: ["cake", "gameboy"],
      dislikes: ["fish"],
      reshapes: 3,
    },
    training: {
      points: 21,
      totalEarned: 40,
      totalSpent: 19,
      learned: ["idle_stand", "scene_cat"],
    },
    work: {
      fragments: 4,
      completed: 2,
      jobs: [
        {
          id: "job_test",
          worker: "visitor",
          label: "猫猫打工",
          icon: "🐈",
          hours: 4,
          startedAt: NOW,
          endsAt: NOW + 4 * 3600000,
          reward: { type: "coins", amount: 500, itemId: "" },
        },
      ],
    },
    cultivation: {
      attributes: {
        root: "innate",
        insight: 93,
        fortune: 81,
        daoHeart: 77,
        lifespan: 105,
        rootLineage: 2,
      },
      exp: 456,
      age: 33,
      techniqueReadyAt: NOW + 60000,
      spiritStones: 8,
      stones: { low: 8, mid: 3, high: 2, supreme: 1 },
      selectedStoneTier: "high",
      regionId: "ghost_realm",
      formationId: "five_elements",
      meditation: { active: true, lastAt: NOW, totalSeconds: 3600 },
      soul: { level: 101, count: 2, root: "metal", attributeBonus: 15 },
      techniqueScrolls: { tech_metal_heaven_upper: 2 },
      techniquesKnown: ["tech_metal_earth_middle"],
      equippedTechnique: "tech_metal_earth_middle",
      herbs: 4,
      pills: { breakthrough: 2, life: 1 },
      thunderPearls: 3,
      karma: 5,
      cycle: 2,
      lastAgedAt: NOW,
    },
    prestige: { count: 2, legacyLevel: 109 },
    intimacy: { points: 130, dailyDate: "2026-10-22", dailyPoints: 12 },
    diary: { entries: [{ date: "2026-10-21", text: "昨天赚了 100 金币。" }] },
    unlocked: ["dress_santa", "dress_santa3", 5],
    favorites: ["idle_stand", "bad name"],
    recent: ["idle_stand"],
    schedule: [{ id: "a", time: "09:00", text: "喝水", doneDate: "", notifiedDate: "" }],
    shopStats: { purchases: 2, spent: 40 },
  });
  assert.strictEqual(clean.version, G.SAVE_VERSION);
  assert.strictEqual(clean.inventory.fish, 2);
  assert.strictEqual(clean.inventory["bad-key"], undefined);
  assert.strictEqual(clean.perks.lucky_cat, true);
  assert.strictEqual(clean.perks.luxury_hourglass, true);
  assert.strictEqual(clean.perks.luxury_moon_observatory, true);
  assert.strictEqual(clean.perks.rank_fashion_crown, true);
  assert.strictEqual(clean.leaderboardBoosts.period, "2026-10-22");
  assert.strictEqual(clean.leaderboardBoosts.activeUntil, NOW + 3600000);
  assert.deepStrictEqual(clean.leaderboardBoosts.boards, ["level", "collection"]);
  assert.deepStrictEqual(clean.profile.likes, ["cake", "gameboy"]);
  assert.strictEqual(clean.profile.personality, "playful");
  assert.strictEqual(clean.training.points, 21);
  assert.deepStrictEqual(clean.training.learned, ["idle_stand", "scene_cat"]);
  assert.strictEqual(clean.work.fragments, 4);
  assert.strictEqual(clean.work.jobs[0].reward.amount, 500);
  assert.strictEqual(clean.cultivation.attributes.root, "innate");
  assert.strictEqual(clean.cultivation.attributes.rootLineage, 2);
  assert.strictEqual(clean.cultivation.spiritStones, 8);
  assert.strictEqual(clean.cultivation.techniqueReadyAt, NOW + 60000);
  assert.strictEqual(clean.cultivation.stones.low, 8);
  assert.strictEqual(clean.cultivation.stones.mid, 3);
  assert.strictEqual(clean.cultivation.selectedStoneTier, "high");
  assert.strictEqual(clean.cultivation.regionId, "ghost_realm");
  assert.strictEqual(clean.cultivation.formationId, "five_elements");
  assert.strictEqual(clean.cultivation.meditation.active, true);
  assert.strictEqual(clean.cultivation.meditation.totalSeconds, 3600);
  assert.strictEqual(clean.cultivation.soul.level, 101);
  assert.strictEqual(clean.cultivation.soul.root, "metal");
  assert.strictEqual(clean.cultivation.soul.attributeBonus, 15);
  assert.strictEqual(clean.cultivation.techniqueScrolls.tech_metal_heaven_upper, 2);
  assert.deepStrictEqual(clean.cultivation.techniquesKnown, ["tech_metal_earth_middle"]);
  assert.strictEqual(clean.cultivation.equippedTechnique, "tech_metal_earth_middle");
  assert.strictEqual(clean.cultivation.pills.breakthrough, 2);
  assert.strictEqual(clean.cultivation.thunderPearls, 3);
  assert.strictEqual(clean.cultivation.cycle, 2);
  assert.strictEqual(clean.prestige.count, 2);
  assert.strictEqual(clean.prestige.legacyLevel, 109);
  assert.strictEqual(clean.intimacy.points, 130);
  assert.strictEqual(clean.diary.entries[0].date, "2026-10-21");
  assert.strictEqual(clean.buffs.double_income, 12345);
  assert.strictEqual(clean.buffs.income_time_capsule, 23456);
  assert.strictEqual(clean.buffs["bad-key"], undefined);
  assert.strictEqual(clean.unlocked.length, 2);
  assert.deepStrictEqual(clean.favorites, ["idle_stand"]);
  assert.deepStrictEqual(clean.recent, ["idle_stand"]);
  assert.strictEqual(clean.schedule.length, 1);
  assert.strictEqual(clean.shopStats.spent, 40);
  assert.strictEqual(clean.settings.baseAction, "idle_stand");
  assert.strictEqual(clean.settings.theme, "night");
  assert.strictEqual(clean.settings.analytics, true);
  assert.strictEqual(clean.settings.equippedFashion, "fashion_starlight_hat");
  assert.strictEqual(clean.daily.progress.feeds, 2);
  assert.deepStrictEqual(clean.daily.claimed, ["feed1"]);
  assert.deepStrictEqual(clean.achievements, ["first_pet"]);
  assert.strictEqual(clean.metrics.days["2026-10-19"], 120);
  assert.strictEqual(clean.stickerRandom.meme_test, true);
  assert.strictEqual(clean.stickerRandom.bad, undefined);
  assert.strictEqual(clean.stickerLabels.meme_test, "新名称");
  assert.strictEqual(clean.stickerLabels.bad, undefined);
  assert.deepStrictEqual(clean.stickerHidden, ["closeup_soft"]);
});

test("存档白名单保留进行中的灵石批量修炼会话", () => {
  const state = G.hydrate(
    {
      cultivation: {
        stones: { low: 1000, mid: 0, high: 0, supreme: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const started = G.cultivate(state, 1000, NOW, () => 0.9, "low");
  const clean = sanitizeSave(state);
  assert.strictEqual(clean.cultivation.stoneSession.active, true);
  assert.strictEqual(clean.cultivation.stoneSession.quantity, 1000);
  assert.strictEqual(clean.cultivation.stoneSession.totalEnergy, 10_000);
  assert.strictEqual(clean.cultivation.stoneSession.endsAt, started.endsAt);
});

test("动作间隔按配置秒数浮动，默认会兜底", () => {
  assert.strictEqual(
    G.nextActionDelay(() => 0, 60),
    45000
  );
  assert.strictEqual(
    G.nextActionDelay(() => 0.5, 60),
    60000
  );
  assert.strictEqual(
    G.nextActionDelay(() => 0.999, 60),
    74970
  );
  assert.strictEqual(
    G.nextActionDelay(() => 0.5, undefined),
    60000
  );
});

test("动作频率配置会被夹到合法区间", () => {
  const state = G.hydrate({ settings: { ambientIntervalSec: 9999, autoWalkIntervalSec: 1 } }, NOW);
  assert.strictEqual(state.settings.ambientIntervalSec, 600);
  assert.strictEqual(state.settings.autoWalkIntervalSec, 10);
  const fallback = G.hydrate({ settings: {} }, NOW);
  assert.strictEqual(fallback.settings.ambientIntervalSec, 60);
});

test("安全模式排除表情包和标记内容，blocked 永不随机", () => {
  const actions = [
    { name: "safe", kind: "idle", group: "日常", size: [200, 200] },
    { name: "meme", kind: "idle", group: "表情包", size: [200, 200] },
    { name: "blocked", kind: "idle", group: "日常", size: [200, 200], blocked: true },
  ];
  const state = G.hydrate({ settings: { safeMode: true } }, NOW);
  for (let i = 0; i < 60; i += 1) {
    assert.strictEqual(G.pickAmbientAction(actions, state).name, "safe");
  }
  state.settings.safeMode = false;
  const seen = new Set();
  for (let i = 0; i < 120; i += 1) seen.add(G.pickAmbientAction(actions, state).name);
  assert.ok(seen.has("meme"));
  assert.ok(!seen.has("blocked"));
});

test("仅一次的日程完成后第二天不会重复提醒", () => {
  const state = G.hydrate({}, NOW);
  G.addScheduleItem(state, { time: "09:00", text: "交报告", repeat: "once" }, NOW);
  const day1 = G.scheduleTimestamp(state.schedule[0], NOW) + 60000;
  const due1 = G.dueScheduleItems(state, day1);
  assert.strictEqual(due1.length, 1);
  G.toggleScheduleItem(state, state.schedule[0].id, day1);
  const nextDay = day1 + 86400000;
  const due2 = G.dueScheduleItems(state, G.scheduleTimestamp(state.schedule[0], nextDay) + 60000);
  assert.strictEqual(due2.length, 0);
});

test("每日任务：进度、领取、跨天重置", () => {
  const state = G.hydrate({}, NOW);
  G.bumpDaily(state, "feeds", 1, NOW);
  const feed = G.dailyTasks(state, NOW).find((task) => task.id === "feed1");
  assert.strictEqual(feed.ready, true);
  assert.strictEqual(G.claimDaily(state, "feed1", NOW).ok, true);
  assert.strictEqual(state.coins, 20);
  assert.strictEqual(G.claimDaily(state, "feed1", NOW).ok, false);
  const nextDay = NOW + 86400000;
  assert.strictEqual(G.dailyTasks(state, nextDay).find((task) => task.id === "feed1").claimed, false);
});

test("成就：达成后只能领取一次", () => {
  const state = G.hydrate({}, NOW);
  state.stats.pets = 1;
  assert.strictEqual(G.claimAchievement(state, "first_pet").ok, true);
  assert.strictEqual(state.coins, 20);
  assert.strictEqual(G.claimAchievement(state, "first_pet").ok, false);
});

test("日程支持工作日 / 周末过滤，并能延后", () => {
  const monday = new Date(2026, 9, 19, 10, 0, 0).getTime();
  const saturday = new Date(2026, 9, 17, 10, 0, 0).getTime();
  const state = G.hydrate({}, monday);
  const added = G.addScheduleItem(state, { time: "09:00", text: "上班", repeat: "weekdays" }, monday);
  assert.strictEqual(G.dueScheduleItems(state, monday).length, 1);
  state.schedule[0].notifiedDate = "";
  assert.strictEqual(G.dueScheduleItems(state, saturday).length, 0);

  assert.strictEqual(G.snoozeScheduleItem(state, added.item.id, 10, monday), true);
  assert.strictEqual(state.schedule[0].time, "10:10");
});

test("主题购买后立即应用，且不能重复购买", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  assert.strictEqual(G.purchase(state, G.SHOP_ITEMS.theme_night, NOW).ok, true);
  assert.strictEqual(state.settings.theme, "night");
  assert.strictEqual(state.perks.theme_night, true);
  assert.strictEqual(sanitizeSave(state).perks.theme_night, true);
  assert.strictEqual(G.purchase(state, G.SHOP_ITEMS.theme_night, NOW).reason, "owned");
});

test("漫游 / 跟随鼠标 / 勿扰设置会被保留并夹取", () => {
  const state = G.hydrate({ settings: { roamSpeed: 9999, followCursor: true, dnd: true } }, NOW);
  assert.strictEqual(state.settings.roamSpeed, 200);
  assert.strictEqual(state.settings.followCursor, true);
  assert.strictEqual(state.settings.dnd, true);
  const clean = sanitizeSave({
    coins: 1,
    settings: { roamSpeed: 999, followCursor: true, dnd: true },
  });
  assert.strictEqual(clean.settings.roamSpeed, 200);
  assert.strictEqual(clean.settings.followCursor, true);
  assert.strictEqual(clean.settings.dnd, true);
});

test("图鉴记录去重并按分类统计", () => {
  const state = G.hydrate({}, NOW);
  G.markSeen(state, "a");
  G.markSeen(state, "a");
  G.markSeen(state, "b");
  const actions = [
    { name: "a", group: "日常", category: "idle" },
    { name: "b", group: "情绪", category: "happy" },
    { name: "c", group: "日常", category: "idle" },
  ];
  const codex = G.codexSummary(state, actions);
  assert.strictEqual(codex.seen, 2);
  assert.strictEqual(codex.total, 3);
  assert.strictEqual(codex.groups["日常"].seen, 1);
  assert.strictEqual(codex.groups["日常"].total, 2);
});

test("心愿只认对应分类", () => {
  const state = G.hydrate({}, NOW);
  state.wish = { id: "w", category: "eat", group: "吃睡", reward: 50, expiresAt: NOW + 60000 };
  assert.strictEqual(G.completeWish(state, { category: "play" }, NOW), null);
  const done = G.completeWish(state, { category: "eat" }, NOW);
  assert.strictEqual(done.reward, 50);
  assert.strictEqual(state.coins, 50);
  assert.strictEqual(state.wish, null);
});

test("签到每天一次，连续天数累加", () => {
  const state = G.hydrate({}, NOW);
  const first = G.doCheckin(state, NOW);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.streak, 1);
  assert.strictEqual(G.doCheckin(state, NOW).ok, false);
  const second = G.doCheckin(state, NOW + 86400000);
  assert.strictEqual(second.streak, 2);
});

test("存钱罐到期才能取出并结算利息", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  assert.strictEqual(G.bankDeposit(state, 200, NOW).ok, true);
  assert.strictEqual(state.coins, 800);
  assert.strictEqual(G.bankWithdraw(state, NOW).ok, false);
  const later = NOW + G.BANK_HOURS * 3600000 + 1000;
  const result = G.bankWithdraw(state, later);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.payout, 230);
});

test("扭蛋扣 500 金币并返回结果", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const result = G.pullGacha(state, [], NOW);
  assert.strictEqual(result.ok, true);
  assert.ok(state.coins >= 400);
  assert.strictEqual(state.gacha.pulls, 1);
});

test("普通金币按 90% 的 100–500 与 10% 的 500–2500 两档随机", () => {
  const lowState = G.hydrate({ coins: 500 }, NOW);
  const low = G.pullGacha(lowState, [], NOW, sequenceRandom([0.999999, 0, 0.899999, 0]));
  assert.strictEqual(low.type, "coins");
  assert.strictEqual(low.amount, 100);

  const lowMaxState = G.hydrate({ coins: 500 }, NOW);
  const lowMax = G.pullGacha(lowMaxState, [], NOW, sequenceRandom([0.999999, 0, 0.899999, 0.999999]));
  assert.strictEqual(lowMax.amount, 500);

  const highMinState = G.hydrate({ coins: 500 }, NOW);
  const highMin = G.pullGacha(highMinState, [], NOW, sequenceRandom([0.999999, 0, 0.9, 0]));
  assert.strictEqual(highMin.amount, 500);

  const highState = G.hydrate({ coins: 500 }, NOW);
  const high = G.pullGacha(highState, [], NOW, sequenceRandom([0.999999, 0, 0.9, 0.999999]));
  assert.strictEqual(high.type, "coins");
  assert.strictEqual(high.amount, 2500);
  assert.strictEqual(G.GACHA_COMMON_COIN_LOW_RATE, 0.9);
  assert.strictEqual(G.GACHA_COMMON_COIN_LOW_MIN, 100);
  assert.strictEqual(G.GACHA_COMMON_COIN_LOW_MAX, 500);
  assert.strictEqual(G.GACHA_COMMON_COIN_HIGH_MIN, 500);
  assert.strictEqual(G.GACHA_COMMON_COIN_HIGH_MAX, 2500);
});

test("扭蛋包含四档金币大奖并在 80 抽从三档保底中随机", () => {
  const top = G.hydrate({ coins: 500 }, NOW);
  const topResult = G.pullGacha(top, [], NOW, () => 0);
  assert.strictEqual(topResult.amount, 10000000);
  assert.strictEqual(topResult.tier, "mythic");

  const guaranteedAmounts = [0, 0.34, 0.67].map((roll) => {
    const guaranteed = G.hydrate({ coins: 500, gacha: { pulls: 79 } }, NOW);
    const result = G.pullGacha(guaranteed, [], NOW, () => roll);
    assert.strictEqual(result.guaranteed, true);
    return result.amount;
  });
  assert.deepStrictEqual(guaranteedAmounts, [500000, 50000, 5000]);
  assert.deepStrictEqual(
    G.GACHA_PITY_PRIZES.map((prize) => prize.amount),
    [500000, 50000, 5000]
  );
  assert.deepStrictEqual(
    G.GACHA_TOP_PRIZES.map((prize) => prize.amount),
    [10000000, 500000, 50000, 5000]
  );
});

test("累计抽数不会改变普通抽概率，只按每 80 抽触发固定保底", () => {
  const ordinaryState = G.hydrate({ coins: 500, gacha: { pulls: 2999 } }, NOW);
  const ordinary = G.pullGacha(ordinaryState, [], NOW, () => 0.0003);
  assert.strictEqual(ordinaryState.gacha.pulls, 3000);
  assert.strictEqual(ordinary.guaranteed, false);
  assert.strictEqual(ordinary.amount, 50000);

  const pityState = G.hydrate({ coins: 500, gacha: { pulls: 3039 } }, NOW);
  const pity = G.pullGacha(pityState, [], NOW, () => 0.34);
  assert.strictEqual(pityState.gacha.pulls, 3040);
  assert.strictEqual(pity.guaranteed, true);
  assert.strictEqual(pity.amount, 50000);
});

test("扭蛋普通分支概率合计为 100%，家具降至 2% 并加入 3% 增益", () => {
  const rate = (value) => Math.round(value * 1e9) / 1e9;
  const rateSum = Object.values(G.GACHA_RATES).reduce((sum, value) => sum + value, 0);
  const topRate = G.GACHA_TOP_PRIZES[G.GACHA_TOP_PRIZES.length - 1].until / 1000000;
  assert.strictEqual(rate(rateSum), 1);
  assert.ok((1 - topRate) * G.GACHA_RATES.legacyOutfitUnlock <= 0.05);
  assert.strictEqual(rate(G.GACHA_RATES.consumable), 0.02);
  assert.strictEqual(G.GACHA_RATES.timedFurniture, 0.02);
  assert.strictEqual(G.GACHA_RATES.buff, 0.03);
  assert.strictEqual(rate(G.GACHA_RATES.timedOutfit), 0.008);
  assert.strictEqual(rate(G.GACHA_RATES.legacyOutfitUnlock), 0.005);
  assert.strictEqual(rate(G.GACHA_RATES.themeOrFallback), 0.22);
});

test("限时家具与装扮按价格加权，价格越高概率越低", () => {
  assert.ok(G.gachaPriceWeight(500) > G.gachaPriceWeight(55000000));
  assert.ok(G.gachaPriceWeight(80) > G.gachaPriceWeight(65000));

  const state = G.hydrate({ coins: 1000 }, NOW);
  const action = { name: "dress_santa", label: "圣诞装扮", category: "dress" };
  const result = G.pullGacha(state, [action], NOW, sequenceRandom([0.999999, 0.778, 0]));
  assert.strictEqual(result.type, "dress");
  assert.strictEqual(result.action, action.name);
  assert.ok(state.unlocked.includes(action.name));
  assert.strictEqual(state.rentals.dress[action.name], undefined);
});

test("扭蛋可抽出 1–7 天限时家具，重复获得会续期并在到期后失效", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const furniture = Object.values(G.FURNITURE).find((item) => item.id !== "companion");
  const first = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.73, 0, 0.5]));
  assert.deepStrictEqual(G.GACHA_LIMITED_DAYS, [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(first.type, "furniture");
  assert.strictEqual(first.durationDays, 4);
  assert.strictEqual(first.label, `${furniture.icon} ${furniture.name}（限时 4 天）`);
  assert.strictEqual(state.rentals.furniture[furniture.id], NOW + 4 * 86400000);
  assert.strictEqual(G.ownsFurniture(state, furniture.id, NOW + 1), true);
  assert.strictEqual(G.ownsFurniture(state, furniture.id, NOW + 4 * 86400000 + 1), false);

  const extended = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.73, 0, 0]));
  assert.strictEqual(extended.durationDays, 1);
  assert.strictEqual(state.rentals.furniture[furniture.id], NOW + 5 * 86400000);

  const ownedState = G.hydrate({ coins: 500, room: { furniture: [furniture.id] } }, NOW);
  const replacement = G.pullGacha(ownedState, [], NOW, sequenceRandom([0.999999, 0.73, 0, 0]));
  assert.strictEqual(replacement.type, "furniture");
  assert.notStrictEqual(replacement.furnitureId, furniture.id);
});

test("扭蛋可以抽出增益并立即激活、重复获得会续期", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const first = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.75, 0]));
  assert.strictEqual(first.type, "buff");
  assert.strictEqual(first.rewardCategory, "buff");
  assert.strictEqual(first.itemId, "coffee");
  assert.strictEqual(state.buffs.double_income, NOW + 10 * 60000);

  const extended = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.75, 0]));
  assert.ok(extended.type === "buff" && state.buffs.double_income > NOW + 10 * 60000);
});

test("扭蛋可抽出 1–7 天限时装扮，并按租赁有效期解锁和失效", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const action = { name: "dress_santa", label: "圣诞装扮", category: "dress" };
  const result = G.pullGacha(state, [action], NOW, sequenceRandom([0.999999, 0.77, 0, 0.999999]));
  assert.strictEqual(result.type, "dress");
  assert.strictEqual(result.rewardCategory, "outfit");
  assert.strictEqual(result.durationDays, 7);
  assert.strictEqual(result.action, action.name);
  assert.strictEqual(state.rentals.dress[action.name], NOW + 7 * 86400000);
  assert.strictEqual(G.isUnlocked(state, action, NOW + 1), true);
  assert.strictEqual(G.isUnlocked(state, action, NOW + 7 * 86400000 + 1), false);

  const fashion = G.SHOP_ITEMS.fashion_starlight_hat;
  const fashionResult = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.77, 0, 0]));
  assert.strictEqual(fashionResult.type, "fashion");
  assert.strictEqual(fashionResult.durationDays, 1);
  assert.strictEqual(state.rentals.dress[fashion.id], NOW + 86400000);
  assert.strictEqual(state.settings.equippedFashion, fashion.id);
});

test("十连抽按优惠价格执行十次并计入保底", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  const result = G.pullGachaMany(state, [], 10, NOW, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cost, 4500);
  assert.strictEqual(result.results.length, 10);
  assert.strictEqual(state.gacha.pulls, 10);
  assert.ok(result.results.every((entry) => entry.amount === 10000000));
});

test("扭蛋记录在最前面追加、最多保存 50 条并可通过存档白名单", () => {
  const existing = Array.from({ length: 60 }, (_, index) => ({
    at: NOW - index,
    type: "coins",
    label: `旧记录 ${index}`,
    tier: "common",
    amount: 100,
  }));
  const state = G.hydrate({ coins: 500, gacha: { pulls: 79, history: existing } }, NOW);
  assert.strictEqual(state.gacha.history.length, 50);
  const result = G.pullGacha(state, [], NOW, () => 0);
  assert.strictEqual(state.gacha.history.length, 50);
  assert.strictEqual(state.gacha.history[0].label, result.label);
  assert.strictEqual(state.gacha.history[0].guaranteed, true);
  const sanitized = sanitizeSave(state);
  assert.strictEqual(sanitized.gacha.history.length, 50);
  assert.strictEqual(sanitized.gacha.history[0].label, result.label);
});

test("UP 奖池概率合计为 100%，价格和 300 抽保底独立于常驻池", () => {
  const rateSum = Object.values(G.GACHA_UP_RATES).reduce((sum, value) => sum + value, 0);
  assert.strictEqual(Math.round(rateSum * 1e9) / 1e9, 1);
  assert.strictEqual(G.GACHA_UP_RATES.bigCollection, 0.000025);
  assert.strictEqual(G.GACHA_UP_RATES.officeCollection, 0.000075);
  assert.strictEqual(G.GACHA_UP_PRICE, 5000);
  assert.strictEqual(G.GACHA_UP_TEN_PRICE, 50000);
  assert.strictEqual(G.GACHA_UP_PITY_PULLS, 300);

  const state = G.hydrate({ coins: 100000 }, UP_NOW);
  const result = G.pullUpGachaMany(state, [], 10, UP_NOW, () => 0.5);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.cost, 50000);
  assert.strictEqual(result.results.length, 10);
  assert.strictEqual(state.gacha.upPulls, 10);
  assert.strictEqual(state.gacha.upPity, 10);
  assert.strictEqual(state.gacha.pulls, 0);
});

test("UP 大奖首次获得典藏，重复获得折算 20M 金币", () => {
  const state = G.hydrate({ coins: 10000 }, UP_NOW);
  const first = G.pullUpGacha(state, [], UP_NOW, () => 0);
  assert.strictEqual(first.type, "luxury");
  assert.strictEqual(first.itemId, G.GACHA_UP_BIG_ID || "luxury_moon_observatory");
  assert.strictEqual(state.perks.luxury_moon_observatory, true);
  assert.strictEqual(state.gacha.upPity, 0);

  const before = state.coins;
  const duplicate = G.pullUpGacha(state, [], UP_NOW, () => 0);
  assert.strictEqual(duplicate.type, "coins");
  assert.strictEqual(duplicate.amount, 20000000);
  assert.strictEqual(state.coins, before - G.GACHA_UP_PRICE + 20000000);
  assert.strictEqual(state.gacha.history[0].pool, "up");
});

test("UP 私人摸鱼办公室重复获得折算 520K 金币", () => {
  const state = G.hydrate({ coins: 10000, perks: { luxury_office: true } }, UP_NOW);
  const before = state.coins;
  const result = G.pullUpGacha(state, [], UP_NOW, sequenceRandom([0.5, 0.00005]));
  assert.strictEqual(result.type, "coins");
  assert.strictEqual(result.amount, 520000);
  assert.strictEqual(state.coins, before - G.GACHA_UP_PRICE + 520000);
});

test("UP 第 300 抽必定获得月球摸鱼台", () => {
  const state = G.hydrate({ coins: 10000, gacha: { upPity: 299 } }, UP_NOW);
  const result = G.pullUpGacha(state, [], UP_NOW, () => 0.5);
  assert.strictEqual(result.guaranteed, true);
  assert.strictEqual(result.itemId, "luxury_moon_observatory");
  assert.strictEqual(state.gacha.upPity, 0);

  assert.strictEqual(G.gachaUpActive(Date.parse("2026-10-25T00:00:00+08:00")), true);
  assert.strictEqual(G.gachaUpActive(Date.parse("2026-12-20T23:59:59+08:00")), true);
  assert.strictEqual(G.gachaUpActive(Date.parse("2026-12-21T00:00:00+08:00")), false);
});

test("小游戏结算金币并进入冷却", () => {
  const state = G.hydrate({}, NOW);
  const reward = G.finishMinigame(state, 10, NOW);
  assert.strictEqual(reward, 10 * G.MINIGAME_COIN_VALUE);
  assert.strictEqual(state.coins, 100000);
  assert.strictEqual(G.minigameStatus(state, NOW).ready, false);
  assert.strictEqual(G.minigameStatus(state, NOW + G.MINIGAME_COOLDOWN_MS + 1).ready, true);
  assert.strictEqual(G.finishMinigame(state, -5, NOW), 0);
});

test("访客能生成并接待奖励", () => {
  const state = G.hydrate({}, NOW);
  state.nextVisitorAt = NOW;
  const visitor = G.maybeVisitor(state, NOW);
  assert.ok(visitor);
  const before = state.coins;
  const accepted = G.acceptVisitor(state, NOW);
  assert.ok(accepted);
  assert.ok(state.coins > before);
});

test("家具与伙伴提升产出", () => {
  const state = G.hydrate({ coins: 10000000, mood: 100, satiety: 80 }, NOW);
  const base = G.incomePerSecond(state);
  assert.strictEqual(
    G.purchase(state, { id: "furniture:rug", type: "furniture", furnitureId: "rug", price: 500 }, NOW).ok,
    true
  );
  assert.ok(G.incomePerSecond(state) > base);
  assert.strictEqual(
    G.purchase(
      state,
      { id: "furniture:companion", type: "companion", furnitureId: "companion", price: 3000 },
      NOW
    ).ok,
    true
  );
  assert.ok(G.incomePerSecond(state) >= base * 1.1 - 1e-9);
});

test("v3 老存档迁移补齐 v4 字段", () => {
  const state = G.hydrate({ version: 3, coins: 10 }, NOW);
  assert.deepStrictEqual(state.seenActions, []);
  assert.deepStrictEqual(state.room.furniture, []);
  assert.strictEqual(state.companion.adopted, false);
  assert.strictEqual(state.version, G.SAVE_VERSION);
});

test("表情包随机规则：安全模式 / 显式开关 / blocked", () => {
  const state = G.hydrate({ settings: { safeMode: true } }, NOW);
  const meme = { name: "meme_test", group: "表情包", label: "梗", blocked: false };
  assert.strictEqual(G.stickerRandomAllowed(state, meme), false);
  G.setStickerRandom(state, meme.name, true);
  assert.strictEqual(G.stickerRandomAllowed(state, meme), true);
  G.setStickerRandom(state, meme.name, false);
  assert.strictEqual(G.stickerRandomAllowed(state, meme), false);

  const blocked = { name: "blocked_test", group: "表情包", label: "刀", blocked: true };
  state.settings.safeMode = false;
  assert.strictEqual(G.stickerRandomAllowed(state, blocked), false);
  G.setStickerRandom(state, blocked.name, true);
  assert.strictEqual(G.stickerRandomAllowed(state, blocked), true);
});

test("表情包可以改自定义名称，清空后回退原名称", () => {
  const state = G.hydrate({}, NOW);
  const action = { name: "meme_test", group: "表情包", label: "原名称" };
  assert.strictEqual(G.effectiveLabel(state, action), "原名称");
  G.setStickerLabel(state, action.name, "新名称");
  assert.strictEqual(G.effectiveLabel(state, action), "新名称");
  G.setStickerLabel(state, action.name, "   ");
  assert.strictEqual(G.effectiveLabel(state, action), "原名称");
});

test("动作库管理隐藏普通内置动作并可批量恢复", () => {
  const state = G.hydrate({ version: 12 }, NOW);
  const builtIn = { name: "bath", label: "泡澡", category: "bath", group: "吃睡" };
  const custom = { name: "user_test", label: "自定义", category: "meme", group: "表情包", user: true };
  assert.strictEqual(G.hideBuiltInSticker(state, builtIn).ok, true);
  assert.strictEqual(G.isStickerHidden(state, builtIn), true);
  assert.strictEqual(G.stickerRandomAllowed(state, builtIn), false);
  assert.strictEqual(G.hideBuiltInSticker(state, custom).ok, false);
  const restored = G.restoreBuiltInStickers(state, [builtIn, custom]);
  assert.strictEqual(restored.restored, 1);
  assert.strictEqual(G.isStickerHidden(state, builtIn), false);
});

test("心愿只会选择当前可完成且未屏蔽的动作分类", () => {
  const state = G.hydrate({ unlocked: [] }, NOW);
  const actions = [
    { name: "locked_dress", category: "dress", blocked: false },
    { name: "blocked_scene", category: "scene", blocked: true },
    { name: "usable_scene", category: "scene", blocked: false },
  ];
  for (let index = 0; index < 10; index += 1) {
    const wish = G.createWish(state, NOW + index, actions);
    assert.strictEqual(wish.category, "scene");
    state.wish = null;
  }
  assert.strictEqual(G.availableWishActions(actions, state, "dress").length, 0);
  assert.deepStrictEqual(
    G.availableWishActions(actions, state, "scene").map((action) => action.name),
    ["usable_scene"]
  );
});

test("v6 存档迁移后补齐性格与偏好", () => {
  const state = G.hydrate({ version: 6, coins: 50 }, NOW);
  assert.strictEqual(state.version, G.SAVE_VERSION);
  assert.strictEqual(state.profile.personality, "gentle");
  assert.strictEqual(state.profile.likes.length, 2);
  assert.strictEqual(state.profile.dislikes.length, 1);
});

test("性格会影响产出与互动心情", () => {
  const gentle = G.hydrate({ level: 5, mood: 50, satiety: 80 }, NOW);
  const diligent = G.hydrate({ level: 5, mood: 50, satiety: 80 }, NOW);
  diligent.profile = { personality: "diligent", likes: ["cake"], dislikes: ["fish"], reshapes: 0 };
  assert.ok(G.incomePerSecond(diligent) > G.incomePerSecond(gentle) * 1.1);

  diligent.mood = 40;
  G.pet(diligent, NOW, () => 0);
  assert.ok(Math.abs(diligent.mood - 40.7) < 1e-9);

  const gourmet = G.hydrate({ coins: 100, mood: 20, satiety: 20 }, NOW);
  gourmet.profile = { personality: "gourmet", likes: ["cake"], dislikes: ["fish"], reshapes: 0 };
  G.feed(gourmet, NOW);
  assert.ok(Math.abs(gourmet.mood - 27.2) < 1e-9);
});

test("偏好会放大喜欢物品的心情收益", () => {
  const state = G.hydrate({ mood: 20, inventory: { cake: 1 } }, NOW);
  state.profile = { personality: "gentle", likes: ["cake"], dislikes: ["fish"], reshapes: 0 };
  const result = G.useItem(state, G.SHOP_ITEMS.cake, NOW);
  assert.strictEqual(result.preference, "like");
  assert.ok(Math.abs(state.mood - 42.5) < 1e-9);
});

test("典藏商品提供永久产出加成且只能购买一次", () => {
  const state = G.hydrate({ coins: 100000, mood: 100, satiety: 80 }, NOW);
  const before = G.incomePerSecond(state);
  assert.strictEqual(G.purchase(state, G.SHOP_ITEMS.luxury_cushion, NOW).ok, true);
  assert.ok(G.incomePerSecond(state) > before);
  assert.strictEqual(G.purchase(state, G.SHOP_ITEMS.luxury_cushion, NOW).reason, "owned");
});

test("性格重塑卡会更换性格并重新抽取偏好", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const result = G.purchase(state, G.SHOP_ITEMS.profile_personality, NOW);
  assert.strictEqual(result.ok, true);
  assert.notStrictEqual(state.profile.personality, "gentle");
  assert.strictEqual(state.profile.reshapes, 1);
  assert.ok(result.profile && result.profile.personality.name);
});

test("普通动作需要训练点学习，自定义动作不受训练限制", () => {
  const state = G.hydrate({ version: 8, training: { points: 30 } }, NOW);
  const action = {
    name: "trainable_move",
    file: "pet/trainable.webp",
    category: "idle",
    group: "日常",
    durationMs: 700,
  };
  assert.strictEqual(G.isUnlocked(state, action), false);
  assert.strictEqual(G.trainingCost(action), 13);
  const learned = G.learnAction(state, action);
  assert.strictEqual(learned.ok, true);
  assert.strictEqual(state.training.points, 17);
  assert.strictEqual(G.isUnlocked(state, action), true);

  const custom = { name: "user_sticker", file: "user-stickers/a.png", category: "meme", user: true };
  assert.strictEqual(G.isUnlocked(state, custom), true);
});

test("摸头、喂饭、陪玩和小游戏都会产出训练点", () => {
  const state = G.hydrate({ coins: 100, satiety: 20, mood: 20 }, NOW);
  G.pet(state, NOW, () => 0);
  assert.strictEqual(state.training.points, 1);
  G.feed(state, NOW);
  assert.strictEqual(state.training.points, 3);
  G.play(state, NOW);
  assert.strictEqual(state.training.points, 5);
  G.finishMinigame(state, 3, NOW);
  assert.strictEqual(state.training.points, 15);
});

test("v7 老存档会把已看动作补偿为已学招式", () => {
  const state = G.hydrate(
    {
      version: 7,
      seenActions: ["scene_cat", "eat_cake"],
      favorites: ["sleep_bed"],
      recent: ["idle_stand"],
      settings: { baseAction: "walk_bag" },
    },
    NOW
  );
  assert.strictEqual(state.version, G.SAVE_VERSION);
  assert.ok(state.training.learned.includes("scene_cat"));
  assert.ok(state.training.learned.includes("eat_cake"));
  assert.ok(state.training.learned.includes("sleep_bed"));
});

test("访客可以派遣打工，离线结束后带回金币", () => {
  const state = G.hydrate(
    {
      version: 9,
      visitor: { kind: "cat", label: "猫猫来访", icon: "🐈", reward: 80, expiresAt: NOW + 60000 },
    },
    NOW
  );
  const before = state.coins;
  const result = G.dispatchWorker(state, "visitor", 2, NOW, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.visitor, null);
  assert.strictEqual(state.work.jobs.length, 1);
  assert.strictEqual(G.workerUnavailable(state, "visitor"), true);
  const settled = G.collectFinishedJobs(state, NOW + 2 * 3600000);
  assert.strictEqual(settled.length, 1);
  assert.ok(state.coins > before);
  assert.strictEqual(state.work.jobs.length, 0);
});

test("伙伴打工可以带回食物或装扮碎片", () => {
  const state = G.hydrate({ version: 9, companion: { adopted: true } }, NOW);
  const foodRolls = [0.7, 0.1];
  const foodJob = G.dispatchWorker(state, "companion", 4, NOW, () => foodRolls.shift()).job;
  assert.strictEqual(foodJob.reward.type, "food");
  G.collectFinishedJobs(state, NOW + 4 * 3600000);
  assert.ok(state.inventory[foodJob.reward.itemId] >= 4);

  const nextState = G.hydrate({ version: 9, companion: { adopted: true } }, NOW);
  const fragmentJob = G.dispatchWorker(nextState, "companion", 8, NOW, () => 0.95).job;
  assert.strictEqual(fragmentJob.reward.type, "fragments");
  G.collectFinishedJobs(nextState, NOW + 8 * 3600000);
  assert.strictEqual(nextState.work.fragments, 4);
});

test("访客可以被请走，碎片可以兑换装扮", () => {
  const state = G.hydrate(
    {
      version: 9,
      visitor: { kind: "cat", label: "猫猫来访", icon: "🐈", reward: 80, expiresAt: NOW + 60000 },
      work: { fragments: 5, completed: 0, jobs: [] },
    },
    NOW
  );
  assert.strictEqual(G.dismissVisitor(state), true);
  assert.strictEqual(state.visitor, null);
  const dress = { name: "dress_training_test", label: "测试装扮", category: "dress", group: "换装" };
  const result = G.exchangeFragments(state, [dress], NOW, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.type, "dress");
  assert.ok(state.unlocked.includes(dress.name));
  assert.strictEqual(state.work.fragments, 0);
});

test("元婴期可以转世，等级和资产重来并尝试携带一项属性", () => {
  const low = G.hydrate({ level: 40 }, NOW);
  assert.strictEqual(G.rebirth(low, "insight", NOW).ok, false);

  const state = G.hydrate(
    {
      level: 41,
      coins: 123456,
      unlocked: ["dress_santa"],
      seenActions: ["scene_cat"],
      companion: { adopted: true },
      room: { furniture: ["rug"] },
      cultivation: {
        attributes: { root: "water", insight: 100, fortune: 80, daoHeart: 90, lifespan: 110 },
        cycle: 2,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const result = G.rebirth(state, "insight", NOW, () => 0.1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.level, 1);
  assert.strictEqual(state.cultivation.cycle, 3);
  assert.strictEqual(state.coins, 0);
  assert.deepStrictEqual(state.unlocked, []);
  assert.strictEqual(state.companion.adopted, false);
  assert.strictEqual(state.cultivation.lastLifeEvent.type, "rebirth");
  assert.strictEqual(state.cultivation.lastLifeEvent.carried, "insight");
  assert.strictEqual(result.mergeMode, "merge");
});

test("主动转世按当前大境界命名，元婴只是解锁条件", () => {
  const nascent = G.hydrate({ level: 41 }, NOW);
  const tribulation = G.hydrate({ level: 100 }, NOW);
  assert.strictEqual(G.rebirthStatus(nascent).realmName, "元婴");
  assert.strictEqual(G.rebirthStatus(tribulation).realmName, "渡劫");
  const result = G.rebirth(tribulation, "fortune", NOW, () => 0.9);
  assert.strictEqual(result.previousRealmName, "渡劫");
});

test("仙人神魂转世保留前世灵根、神魂等级和全属性加成", () => {
  const state = G.hydrate(
    {
      level: 101,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 110,
          fortune: 100,
          daoHeart: 120,
          lifespan: 130,
          rootLineage: 2,
        },
        cycle: 4,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const before = G.rebirthStatus(state);
  assert.strictEqual(before.immortal, true);
  assert.strictEqual(before.soul.nextLevel, 101);
  assert.strictEqual(before.soul.nextRootName, "金灵根");
  assert.ok(before.soul.nextAttributeBonus > 0);

  const result = G.rebirth(state, "insight", NOW, () => 0.1);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.immortal, true);
  assert.strictEqual(state.level, 1);
  assert.strictEqual(state.cultivation.soul.level, 101);
  assert.strictEqual(state.cultivation.soul.root, "metal");
  assert.strictEqual(state.cultivation.soul.attributeBonus, result.attributeBonus);
  assert.strictEqual(state.cultivation.attributes.root, "metal");
  assert.strictEqual(result.rootUpgraded, true);
  assert.strictEqual(result.generatedRoot, "quad_metal_wood_water_fire");
  assert.strictEqual(state.cultivation.attributes.rootLineage, 3);
  assert.ok(state.cultivation.attributes.insight >= result.attributeBonus);
  assert.ok(state.cultivation.attributes.fortune >= result.attributeBonus);
  assert.strictEqual(state.cultivation.lastLifeEvent.carried, "root");
});

test("仙人转世仅在相同或共生多灵根时提高根骨等阶", () => {
  assert.strictEqual(G.CULTIVATION.rootsAreSymbiotic("metal", "metal"), true);
  assert.strictEqual(G.CULTIVATION.rootsAreSymbiotic("metal", "dual_metal_water"), true);
  assert.strictEqual(G.CULTIVATION.rootsAreSymbiotic("metal", "dual_fire_earth"), false);
  assert.strictEqual(G.CULTIVATION.rootsAreSymbiotic("metal", "innate"), false);

  const state = G.hydrate(
    {
      level: 101,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 100,
          fortune: 100,
          daoHeart: 100,
          lifespan: 130,
          rootLineage: 4,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const result = G.rebirth(state, "root", NOW, () => 0);
  assert.strictEqual(result.generatedRoot, "innate");
  assert.strictEqual(result.rootUpgraded, false);
  assert.strictEqual(state.cultivation.attributes.root, "metal");
  assert.strictEqual(state.cultivation.attributes.rootLineage, 4);

  const same = G.hydrate(
    {
      level: 101,
      cultivation: {
        attributes: {
          root: "innate",
          insight: 100,
          fortune: 100,
          daoHeart: 100,
          lifespan: 130,
          rootLineage: 2,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const sameResult = G.rebirth(same, "root", NOW, () => 0);
  assert.strictEqual(sameResult.generatedRoot, "innate");
  assert.strictEqual(sameResult.rootUpgraded, true);
  assert.strictEqual(same.cultivation.attributes.rootLineage, 3);
});

test("寿元耗尽会陨落、重选命格并清空本世进度", () => {
  const state = G.hydrate(
    {
      level: 20,
      coins: 8888,
      cultivation: {
        attributes: { root: "wood", insight: 50, fortune: 50, daoHeart: 50, lifespan: 90 },
        age: 100,
        lastAgedAt: NOW,
        cycle: 0,
      },
    },
    NOW,
    () => 0.12
  );
  state.cultivation.age = G.CULTIVATION.maxLifespan(state.cultivation, state.level) - 0.5;
  state.cultivation.lastAgedAt = NOW - G.CULTIVATION.DAY_MS;
  const result = G.advanceLifespan(state, NOW, () => 0.12);
  assert.strictEqual(result.died, true);
  assert.strictEqual(state.level, 1);
  assert.strictEqual(state.coins, 0);
  assert.strictEqual(state.cultivation.cycle, 1);
  assert.strictEqual(state.cultivation.lastLifeEvent.type, "lifespan");
});

test("百级飞升天劫包含多阶段，成功后进入仙界真仙", () => {
  const state = G.hydrate(
    {
      level: 100,
      cultivation: {
        attributes: { root: "innate", insight: 120, fortune: 120, daoHeart: 120, lifespan: 120 },
        exp: G.CULTIVATION.expRequired(100),
        technique: 1000,
        pills: { breakthrough: 1, life: 0 },
        thunderPearls: 3,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const status = G.CULTIVATION.breakthroughStatus(state.cultivation, 100, "pill", NOW);
  assert.ok(status.tribulation.steps.includes("心魔劫"));
  assert.ok(status.tribulation.steps.includes("法则劫"));
  const result = G.attemptBreakthrough(state, "pill", NOW, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.level, 101);
  assert.strictEqual(G.titleForState(state), "真仙初期");
});

test("v15 老存档迁移后补齐修仙属性与寿元", () => {
  const state = G.hydrate({ version: 15, level: 20 }, NOW, () => 0.2);
  assert.strictEqual(state.version, G.SAVE_VERSION);
  assert.ok(state.cultivation.attributes.root in G.CULTIVATION.ROOTS);
  assert.ok(state.cultivation.age > 0);
  assert.ok(G.CULTIVATION.maxLifespan(state.cultivation, state.level) > state.cultivation.age);
});

test("亲密度由互动、心愿和访客增长并独立于心情", () => {
  const state = G.hydrate({ version: 11, coins: 100, satiety: 20, mood: 20 }, NOW);
  G.pet(state, NOW, () => 0);
  G.feed(state, NOW);
  G.play(state, NOW);
  assert.strictEqual(state.intimacy.points, 5);
  assert.notStrictEqual(state.intimacy.points, state.mood);
  state.visitor = { kind: "cat", label: "猫猫", icon: "🐈", reward: 80, expiresAt: NOW + 60000 };
  G.acceptVisitor(state, NOW);
  assert.strictEqual(state.intimacy.points, 13);
});

test("亲密度等级解锁专属动作和装扮", () => {
  const state = G.hydrate({ version: 11, intimacy: { points: 130 } }, NOW);
  assert.strictEqual(G.intimacyStatus(state).level, 3);
  assert.strictEqual(
    G.isUnlocked(state, { name: "scene_cat", category: "scene", file: "pet/scene_cat.webp" }),
    true
  );
  state.intimacy.points = 600;
  G.addIntimacy(state, 0, NOW);
  assert.ok(state.unlocked.includes("dress_bow"));
  assert.strictEqual(G.intimacyStatus(state).level, 5);
});

test("跨天自动生成桌面日记并汇总当天数据", () => {
  const yesterday = NOW - 86400000;
  const state = G.hydrate(
    {
      version: 11,
      daily: {
        date: G.dayKey(yesterday),
        progress: { pets: 2, feeds: 1, plays: 1, actionsViewed: 7, coinsEarned: 3200, visitors: 1 },
        claimed: [],
      },
    },
    NOW
  );
  G.ensureDaily(state, NOW);
  assert.strictEqual(state.diary.entries.length, 1);
  assert.ok(state.diary.entries[0].text.includes("3200"));
  assert.ok(state.diary.entries[0].text.includes("7 个动作"));
  assert.ok(state.diary.entries[0].text.includes("1 位访客"));
});

test("v10 老存档迁移后补齐亲密度与日记", () => {
  const state = G.hydrate({ version: 10 }, NOW);
  assert.strictEqual(state.version, G.SAVE_VERSION);
  assert.strictEqual(state.intimacy.points, 0);
  assert.deepStrictEqual(state.diary.entries, []);
});

test("v13 老存档迁移后补齐永耀状态", () => {
  const state = G.hydrate({ version: 13 }, NOW);
  assert.strictEqual(state.version, G.SAVE_VERSION);
  assert.deepStrictEqual(state.leaderboardBoosts, {
    period: "",
    activeUntil: 0,
    boards: [],
  });
});

test("培元丹每个小阶段最多服用 2 颗，升级后重置额度", () => {
  const state = G.hydrate(
    {
      level: 20,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 60,
          daoHeart: 60,
          lifespan: 100,
        },
        pills: { breakthrough: 0, life: 0, technique: 0, cultivation: 3, heart: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  assert.strictEqual(G.takeCultivationPill(state, "cultivation", NOW, () => 0).ok, true);
  assert.strictEqual(G.takeCultivationPill(state, "cultivation", NOW, () => 0).ok, true);
  const limited = G.takeCultivationPill(state, "cultivation", NOW, () => 0);
  assert.strictEqual(limited.ok, false);
  assert.strictEqual(limited.reason, "stage-limit");
  assert.strictEqual(state.cultivation.pills.cultivation, 1);
  state.level += 1;
  assert.strictEqual(G.takeCultivationPill(state, "cultivation", NOW, () => 0).ok, true);
});

test("可以提前结束灵石修炼并按已吸收比例结算", () => {
  const state = G.hydrate(
    {
      cultivation: {
        stones: { low: 10, mid: 0, high: 0, supreme: 0 },
        attributes: {
          root: "metal",
          insight: 70,
          fortune: 60,
          daoHeart: 60,
          lifespan: 100,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const started = G.cultivate(state, 10, NOW, () => 0.9, "low");
  const earlyAt = NOW + Math.floor(started.durationMs / 4);
  const early = G.endStoneCultivation(state, earlyAt, () => 0.9);
  assert.strictEqual(early.completed, true);
  assert.strictEqual(early.endedEarly, true);
  assert.ok(early.settledEnergy > 0 && early.settledEnergy < early.totalEnergy);
  assert.ok(early.gained > 0);
  assert.strictEqual(state.cultivation.stoneSession.active, false);
});

test("自动购买并进食可在饱食度偏低时运行", () => {
  const state = G.hydrate({ coins: 100, satiety: 20, settings: { autoFeed: true } }, NOW);
  G.tick(state, 1000);
  assert.strictEqual(state.stats.feeds, 1);
  assert.ok(state.satiety > G.BALANCE.hungryThreshold);
  assert.ok(state.coins < 100);
});

test("属性上限提升到 99999 并由存档白名单保留", () => {
  const state = G.hydrate(
    {
      cultivation: {
        attributes: {
          root: "metal",
          insight: 120000,
          fortune: 99999,
          daoHeart: 110000,
          lifespan: 130000,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  assert.strictEqual(state.cultivation.attributes.insight, 99999);
  assert.strictEqual(state.cultivation.attributes.daoHeart, 99999);
  assert.strictEqual(state.cultivation.attributes.lifespan, 99999);
  const clean = sanitizeSave(state);
  assert.strictEqual(clean.cultivation.attributes.insight, 99999);
  assert.strictEqual(clean.cultivation.attributes.lifespan, 99999);
});

test("灵力上限累计此前修为并随环境与修为效率恢复", () => {
  const state = G.hydrate(
    {
      level: 21,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 60,
          daoHeart: 60,
          lifespan: 100,
        },
        regionId: "qingmu_forest",
        spiritualPower: 0,
        spiritualPowerUpdatedAt: NOW,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  assert.ok(G.totalCultivationAmount(state.cultivation, 21) > G.totalCultivationAmount(state.cultivation, 20));
  const recovered = G.recoverSpiritualPower(state, NOW + 60000);
  assert.ok(recovered.current > 0);
  assert.strictEqual(recovered.max, G.spiritualPowerCapacity(state.cultivation, state.level));
  assert.ok(recovered.environmentFactor > 1);
});

test("黑塔按等级挑战、扣除灵力并奖励修为", () => {
  const state = G.hydrate(
    {
      level: 21,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 60,
          daoHeart: 60,
          lifespan: 100,
        },
        spiritualPower: 100000,
        spiritualPowerUpdatedAt: NOW,
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const tower = G.blackTowerStatus(state, NOW);
  state.cultivation.spiritualPower = tower.power.max;
  state.cultivation.spiritualPowerUpdatedAt = NOW;
  const result = G.challengeBlackTower(state, 3, NOW, () => 0);
  assert.strictEqual(result.ok, true);
  assert.ok(result.cost > 0);
  assert.ok(result.gained > 0);
  assert.ok(state.cultivation.spiritualPower < tower.power.max);
  assert.strictEqual(state.cultivation.blackTower.attempts, 1);
  state.cultivation.spiritualPower = 0;
  state.cultivation.spiritualPowerUpdatedAt = NOW;
  const blocked = G.challengeBlackTower(state, 3, NOW, () => 0);
  assert.strictEqual(blocked.reason, "power");
});

test("主动离开洞天会同时清除福地与守灵挑战", () => {
  const state = G.hydrate(
    {
      level: 11,
      cultivation: {
        stones: { low: 10, mid: 0, high: 0, supreme: 0 },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const cave = G.caveHeavenStatus(state, NOW, () => 0);
  state.cultivation.cave.active = {
    id: cave.spots[0].id,
    size: cave.spots[0].size,
    qiMultiplier: cave.spots[0].qiMultiplier,
    effectType: cave.spots[0].effectType,
    effectValue: cave.spots[0].effectValue,
    enteredAt: NOW,
    expiresAt: NOW + 60000,
  };
  state.cultivation.cave.challenge = { id: cave.spots[0].id, guardian: "测试守灵" };
  const result = G.leaveCaveHeaven(state, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.cultivation.cave.active, null);
  assert.strictEqual(state.cultivation.cave.challenge, null);
});

test("快捷键配置会保存到存档白名单", () => {
  const state = G.hydrate(
    {
      settings: {
        autoFeed: true,
        shortcuts: { toggle: "Ctrl+Shift+1", summon: "Alt+X", chat: "F8" },
      },
    },
    NOW
  );
  assert.strictEqual(state.settings.autoFeed, true);
  const clean = sanitizeSave(state);
  assert.strictEqual(clean.settings.shortcuts.toggle, "Ctrl+Shift+1");
  assert.strictEqual(clean.settings.shortcuts.summon, "Alt+X");
  assert.strictEqual(clean.settings.shortcuts.chat, "F8");
});

console.log(`\n通过 ${passed} / ${passed + failures.length}`);
if (failures.length) process.exit(1);
