/* 数据驱动机缘事件测试。 */
const assert = require("assert");
const G = require("../renderer/game.js");
const { sanitizeSave } = require("../lib/save-schema.js");

const NOW = 1_700_000_000_000;
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL  ${name}\n      ${error.message}`);
  }
}

function makeState(attributes = {}) {
  return G.hydrate(
    {
      level: 20,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 70,
          fortune: 60,
          daoHeart: 70,
          lifespan: 100,
          ...attributes,
        },
        regionId: "qingju_plain",
        lastAgedAt: NOW,
      },
    },
    NOW
  );
}

console.log("doro 数据驱动机缘测试");

test("机缘目录包含 30 个唯一事件和有效选项", () => {
  const events = G.OPPORTUNITIES.EVENTS;
  const conditionTypes = new Set([
    "level",
    "region",
    "root",
    "rootKind",
    "insight",
    "fortune",
    "daoHeart",
    "lifespan",
    "stones",
    "herbs",
    "pill",
    "techniqueMastery",
    "karma",
    "demonized",
    "flag",
    "any",
  ]);
  const effectTypes = new Set([
    "exp",
    "expPercent",
    "stone",
    "herb",
    "pill",
    "thunderPearl",
    "attribute",
    "lifespan",
    "techniqueMastery",
    "karma",
    "coins",
    "flag",
    "technique",
  ]);
  assert.strictEqual(events.length, 30);
  assert.strictEqual(new Set(events.map((event) => event.id)).size, events.length);
  assert.ok(events.every((event) => event.title && event.description && event.choices.length >= 2));
  assert.ok(
    events.every((event) => new Set(event.choices.map((choice) => choice.id)).size === event.choices.length)
  );
  const allConditions = events.flatMap((event) => [
    ...(event.conditions || []),
    ...event.choices.flatMap((choice) => choice.requirements || []),
  ]);
  const allEffects = events.flatMap((event) =>
    event.choices.flatMap((choice) => [
      ...(choice.effects || []),
      ...(choice.outcomes || []).flatMap((outcome) => [
        ...(outcome.success.effects || []),
        ...(outcome.failure.effects || []),
      ]),
    ])
  );
  assert.ok(allConditions.every((condition) => conditionTypes.has(condition.type)));
  assert.ok(allEffects.every((effect) => effectTypes.has(effect.type)));
  assert.ok(events.some((event) => event.rarity === "legendary"));
  assert.ok(events.some((event) => event.conditions && event.conditions.length > 0));
});

test("寻找机缘会进入待选择状态，抉择后写入记录并进入冷却", () => {
  const state = makeState();
  const before = state.cultivation.exp;
  const drawn = G.drawOpportunity(state, NOW, () => 0);
  assert.strictEqual(drawn.ok, true);
  assert.strictEqual(state.opportunities.activeId, "dew_before_dawn");
  const resolved = G.resolveOpportunityChoice(state, "drink", NOW, () => 0.5);
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(state.opportunities.activeId, "");
  assert.strictEqual(state.opportunities.history.length, 1);
  assert.strictEqual(state.opportunities.readyAt, NOW + G.OPPORTUNITIES.DRAW_COOLDOWN_MS);
  assert.ok(state.cultivation.exp > before);
  assert.strictEqual(G.drawOpportunity(state, NOW + 1000, () => 0).reason, "cooldown");
});

test("选项会检查境界、属性与资源前置", () => {
  const state = makeState({ insight: 20 });
  state.opportunities.activeId = "small_bell_test";
  const blocked = G.resolveOpportunityChoice(state, "ring", NOW, () => 0);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "requirements");
  assert.deepStrictEqual(blocked.missing, ["悟性 40"]);
  state.cultivation.attributes.insight = 60;
  const success = G.resolveOpportunityChoice(state, "ring", NOW, () => 0);
  assert.strictEqual(success.ok, true);
  assert.ok(state.cultivation.technique > 0);
});

test("概率选择会按结果应用成功或失败效果", () => {
  const successState = makeState();
  const stonesBefore = successState.cultivation.stones.low;
  successState.opportunities.activeId = "stone_vein_song";
  const success = G.resolveOpportunityChoice(successState, "dig", NOW, () => 0.1);
  assert.strictEqual(success.outcome, "success");
  assert.strictEqual(successState.cultivation.stones.low, stonesBefore + 3);

  const failureState = makeState();
  failureState.opportunities.activeId = "stone_vein_song";
  const failure = G.resolveOpportunityChoice(failureState, "dig", NOW, () => 0.99);
  assert.strictEqual(failure.outcome, "failure");
  assert.strictEqual(failureState.cultivation.attributes.fortune, 59);
});

test("后续机缘由前序 flag 解锁，灵根专属事件只对匹配灵根出现", () => {
  const state = makeState();
  const followUp = G.OPPORTUNITIES.eventById("paper_crane_returns");
  assert.strictEqual(G.OPPORTUNITIES.isEligible(state, followUp), false);
  state.opportunities.flags.paper_crane_mended = true;
  assert.strictEqual(G.OPPORTUNITIES.isEligible(state, followUp), true);

  const thunder = G.OPPORTUNITIES.eventById("thunder_calls_name");
  assert.strictEqual(G.OPPORTUNITIES.isEligible(state, thunder), false);
  state.cultivation.attributes.root = "thunder";
  assert.strictEqual(G.OPPORTUNITIES.isEligible(state, thunder), true);
});

test("机缘状态会通过存档白名单保存", () => {
  const state = makeState();
  state.opportunities.flags.paper_crane_mended = true;
  state.opportunities.activeId = "paper_crane_returns";
  state.opportunities.lastOutcome = {
    eventId: "dew_before_dawn",
    eventTitle: "叶尖晨露",
    outcome: "success",
    text: "晨露入腹。",
    effectsText: "修为 +8",
    at: NOW,
  };
  const clean = sanitizeSave(state);
  assert.strictEqual(clean.version, G.SAVE_VERSION);
  assert.strictEqual(clean.opportunities.activeId, "paper_crane_returns");
  assert.strictEqual(clean.opportunities.flags.paper_crane_mended, true);
  assert.strictEqual(clean.opportunities.lastOutcome.eventId, "dew_before_dawn");
  assert.strictEqual(G.hydrate(clean, NOW).opportunities.activeId, "paper_crane_returns");
});

if (failures.length) {
  console.error(`\n失败 ${failures.length} 项`);
  process.exitCode = 1;
} else {
  console.log(`\n通过 ${passed} / ${passed}`);
}
