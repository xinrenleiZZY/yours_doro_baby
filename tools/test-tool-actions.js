/* 独立工具窗口的交易命令测试。 */
const assert = require("assert");
const G = require("../renderer/game.js");
const { applyToolCommand } = require("../lib/tool-actions.js");

const NOW = 1_700_000_000_000;
const UP_NOW = Date.parse("2026-11-01T12:00:00+08:00");
const actions = [
  { name: "dress_one", label: "测试装扮", category: "dress", group: "换装" },
  { name: "meme_one", label: "测试表情", category: "meme", group: "表情包", blocked: false },
];

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

console.log("doro 独立窗口工具测试");

test("商城购买和背包使用在存档副本上执行", () => {
  const state = G.hydrate({ coins: 100 }, NOW);
  const bought = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "catalog", id: "fish" } },
    NOW
  );
  assert.strictEqual(bought.ok, true);
  assert.strictEqual(bought.state.inventory.fish, 1);
  assert.ok(bought.state.coins < state.coins);
  const used = applyToolCommand(
    bought.state,
    actions,
    "shop",
    { type: "use", item: { kind: "catalog", id: "fish" } },
    NOW
  );
  assert.strictEqual(used.ok, true);
  assert.strictEqual(used.state.inventory.fish, 0);
});

test("商城不能伪造商品价格或购买不存在商品", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  const fake = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "catalog", id: "missing", price: 0 } },
    NOW
  );
  assert.strictEqual(fake.ok, false);
  assert.strictEqual(state.coins, 10000);
});

test("独立商城可批量购买修炼道具", () => {
  const state = G.hydrate(
    {
      level: 41,
      coins: 300000,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 60,
          daoHeart: 70,
          lifespan: 100,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const result = applyToolCommand(
    state,
    actions,
    "shop",
    {
      type: "buy",
      item: { kind: "catalog", id: "stone_mid" },
      quantity: 4,
    },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.cultivation.stones.mid, 4);
  assert.strictEqual(result.state.cultivation.buyQuantity, 4);
  assert.strictEqual(result.state.coins, 300000 - 4 * G.CULTIVATION.STONE_TIERS.mid.price);

  const pill = applyToolCommand(
    result.state,
    actions,
    "shop",
    { type: "buy", item: { kind: "catalog", id: "breakthrough_pill" } },
    NOW
  );
  assert.strictEqual(pill.ok, true);
  assert.strictEqual(pill.state.cultivation.pills.breakthrough, 1);

  const technique = applyToolCommand(
    pill.state,
    actions,
    "shop",
    {
      type: "buy",
      item: { kind: "technique", id: "tech_metal_heaven_upper" },
    },
    NOW
  );
  assert.strictEqual(technique.ok, true);
  assert.strictEqual(technique.state.cultivation.techniqueScrolls.tech_metal_heaven_upper, 1);
  const studied = applyToolCommand(
    technique.state,
    actions,
    "shop",
    { type: "study-technique", id: "tech_metal_heaven_upper" },
    NOW
  );
  assert.strictEqual(studied.ok, true);
  assert.ok(studied.state.cultivation.equippedTechniques.includes("tech_metal_heaven_upper"));
});

test("独立背包可研习、切换功法并服用延寿丹", () => {
  const state = G.hydrate(
    {
      cultivation: {
        attributes: {
          root: "metal",
          insight: 80,
          fortune: 60,
          daoHeart: 70,
          lifespan: 100,
        },
        lastAgedAt: NOW,
        techniqueScrolls: { tech_metal_heaven_upper: 1 },
        techniquesKnown: ["tech_metal_yellow_lower"],
        equippedTechnique: "tech_metal_yellow_lower",
        pills: { breakthrough: 0, life: 1 },
      },
    },
    NOW
  );
  const studied = applyToolCommand(
    state,
    actions,
    "inventory",
    { type: "study-technique", id: "tech_metal_heaven_upper" },
    NOW
  );
  assert.strictEqual(studied.ok, true);
  assert.ok(studied.state.cultivation.equippedTechniques.includes("tech_metal_heaven_upper"));

  const equipped = applyToolCommand(
    studied.state,
    actions,
    "inventory",
    { type: "equip-technique", id: "tech_metal_yellow_lower" },
    NOW
  );
  assert.strictEqual(equipped.ok, true);
  assert.ok(equipped.state.cultivation.equippedTechniques.includes("tech_metal_yellow_lower"));

  const paused = applyToolCommand(
    equipped.state,
    actions,
    "inventory",
    { type: "unequip-technique", id: "tech_metal_yellow_lower" },
    NOW
  );
  assert.strictEqual(paused.ok, true);
  assert.ok(!paused.state.cultivation.equippedTechniques.includes("tech_metal_yellow_lower"));

  paused.state.cultivation.pills.heart = 1;
  const calmed = applyToolCommand(
    paused.state,
    actions,
    "inventory",
    { type: "use-cultivation-pill", pill: "heart" },
    NOW
  );
  assert.strictEqual(calmed.ok, true);
  assert.ok(calmed.state.cultivation.attributes.daoHeart > 70);
  assert.strictEqual(calmed.state.cultivation.pills.heart, 0);

  const consumed = applyToolCommand(calmed.state, actions, "inventory", { type: "use-life-pill" }, NOW);
  assert.strictEqual(consumed.ok, true);
  assert.strictEqual(consumed.state.cultivation.pills.life, 0);
  assert.strictEqual(consumed.state.cultivation.bonusLifespan, 100);
});

test("独立机缘窗口可抽取并结算选项", () => {
  const state = G.hydrate(
    {
      level: 20,
      cultivation: {
        attributes: {
          root: "metal",
          insight: 70,
          fortune: 60,
          daoHeart: 70,
          lifespan: 100,
        },
        lastAgedAt: NOW,
      },
    },
    NOW
  );
  const drawn = applyToolCommand(state, actions, "opportunity", { type: "draw" }, NOW);
  assert.strictEqual(drawn.ok, true);
  assert.ok(drawn.result.event.id);
  const choice = G.opportunityStatus(drawn.state, NOW).choices.find((item) => item.available);
  assert.ok(choice);
  const resolved = applyToolCommand(
    drawn.state,
    actions,
    "opportunity",
    { type: "choose", choiceId: choice.id },
    NOW
  );
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.state.opportunities.history.length, 1);
});

test("装扮按动作清单价格解锁", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const result = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "dress", action: "dress_one" } },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.ok(result.state.unlocked.includes("dress_one"));
  assert.strictEqual(result.state.coins, 100000 - G.dressPrice(0) * G.PERMANENT_PRICE_MULTIPLIER);
});

test("独立商城租赁会校验时长并写入到期时间", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  const result = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "dress", action: "dress_one", rentalDuration: 7 } },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.coins, 10000 - G.dressPrice(0) * 7);
  assert.strictEqual(result.state.rentals.dress.dress_one, NOW + 7 * 86400000);
  assert.ok(!result.state.unlocked.includes("dress_one"));

  const furniture = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "furniture", id: "rug", rentalDuration: 3 } },
    NOW
  );
  assert.strictEqual(furniture.ok, true);
  assert.strictEqual(furniture.state.rentals.furniture.rug, NOW + 3 * 86400000);
  assert.ok(!furniture.state.room.furniture.includes("rug"));
});

test("独立商城可购买并穿脱叠层服装", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const bought = applyToolCommand(
    state,
    actions,
    "shop",
    {
      type: "buy",
      item: { kind: "catalog", id: "fashion_starlight_hat", rentalDuration: 3 },
    },
    NOW
  );
  assert.strictEqual(bought.ok, true);
  assert.strictEqual(bought.state.settings.equippedFashion, "fashion_starlight_hat");
  assert.strictEqual(bought.state.rentals.dress.fashion_starlight_hat, NOW + 3 * 86400000);
  const removed = applyToolCommand(
    bought.state,
    actions,
    "shop",
    { type: "equip-fashion", id: "fashion_starlight_hat" },
    NOW
  );
  assert.strictEqual(removed.ok, true);
  assert.strictEqual(removed.state.settings.equippedFashion, "");
});

test("未拥有的主题不能直接切换", () => {
  const state = G.hydrate({}, NOW);
  const result = applyToolCommand(state, actions, "shop", { type: "equip-theme", theme: "night" }, NOW);
  assert.strictEqual(result.ok, false);
});

test("扭蛋由主进程统一扣费并返回结果", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const result = applyToolCommand(state, actions, "gacha", { type: "pull" }, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.gacha.pulls, 1);
  assert.ok(result.result && result.result.label);
});

test("独立扭蛋窗支持十连抽", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  const result = applyToolCommand(state, actions, "gacha", { type: "pull-ten" }, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.result.cost, G.GACHA_TEN_PRICE);
  assert.strictEqual(result.result.results.length, 10);
  assert.strictEqual(result.state.gacha.pulls, 10);
});

test("扭蛋抽奖记录会逐条保存并可以清空", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  const pulled = applyToolCommand(state, actions, "gacha", { type: "pull-ten" }, NOW);
  assert.strictEqual(pulled.state.gacha.history.length, 10);
  assert.ok(pulled.state.gacha.history.every((entry) => entry.label && entry.at === NOW));
  const cleared = applyToolCommand(pulled.state, actions, "gacha", { type: "clear-history" }, NOW);
  assert.strictEqual(cleared.ok, true);
  assert.deepStrictEqual(cleared.state.gacha.history, []);
  assert.strictEqual(cleared.state.gacha.pulls, 10);
});

test("UP 池按独立价格抽奖并只清理自己的记录", () => {
  const state = G.hydrate({ coins: 60000 }, UP_NOW);
  const single = applyToolCommand(state, actions, "gacha", { type: "pull", pool: "up" }, UP_NOW);
  assert.strictEqual(single.ok, true);
  assert.strictEqual(60000 - single.state.coins + (single.result.amount || 0), G.GACHA_UP_PRICE);
  assert.strictEqual(single.state.gacha.upPulls, 1);

  const ten = applyToolCommand(single.state, actions, "gacha", { type: "pull-ten", pool: "up" }, UP_NOW);
  assert.strictEqual(ten.ok, true);
  assert.strictEqual(ten.result.cost, 50000);
  assert.strictEqual(ten.state.gacha.upPulls, 11);
  assert.ok(ten.state.gacha.history.every((entry) => entry.pool === "up"));

  const cleared = applyToolCommand(
    ten.state,
    actions,
    "gacha",
    { type: "clear-history", pool: "up" },
    UP_NOW
  );
  assert.strictEqual(cleared.ok, true);
  assert.strictEqual(cleared.state.gacha.history.length, 0);
  assert.strictEqual(cleared.state.gacha.upPulls, 11);
});

test("小游戏结算有冷却和分数上限", () => {
  const state = G.hydrate({ coins: 0 }, NOW);
  const result = applyToolCommand(state, actions, "minigame", { type: "finish", score: 9999 }, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.result.score, 500);
  assert.strictEqual(result.result.reward, 500 * G.MINIGAME_COIN_VALUE);
  const again = applyToolCommand(
    result.state,
    actions,
    "minigame",
    { type: "finish", score: 10 },
    NOW + 1000
  );
  assert.strictEqual(again.ok, false);
});

test("表情窗口可改随机、名称、收藏和批量策略", () => {
  const state = G.hydrate({}, NOW);
  const random = applyToolCommand(
    state,
    actions,
    "sticker",
    { type: "set-random", name: "meme_one", value: true },
    NOW
  );
  assert.strictEqual(random.ok, true);
  const label = applyToolCommand(
    random.state,
    actions,
    "sticker",
    { type: "set-label", name: "meme_one", label: "新名称" },
    NOW
  );
  assert.strictEqual(label.state.stickerLabels.meme_one, "新名称");
  const favorite = applyToolCommand(
    label.state,
    actions,
    "sticker",
    { type: "favorite", name: "meme_one" },
    NOW
  );
  assert.ok(favorite.state.favorites.includes("meme_one"));
  const batch = applyToolCommand(
    favorite.state,
    actions,
    "sticker",
    { type: "batch-random", mode: "favorites" },
    NOW
  );
  assert.strictEqual(batch.state.stickerRandom.meme_one, true);
});

test("未知工具命令被拒绝", () => {
  const state = G.hydrate({}, NOW);
  assert.strictEqual(applyToolCommand(state, actions, "shop", { type: "give-coins" }, NOW).ok, false);
});

test("独立商城可以购买高价典藏并提升产出", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const before = G.incomePerSecond(state);
  const result = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "catalog", id: "luxury_cushion" } },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.perks.luxury_cushion, true);
  assert.ok(G.incomePerSecond(result.state) > before);
});

test("独立商城可以重塑性格并返回新档案", () => {
  const state = G.hydrate({ coins: 100000 }, NOW);
  const result = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "catalog", id: "profile_personality" } },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.profile.reshapes, 1);
  assert.ok(result.speech.includes("型"));
});

test("动作库管理可以隐藏并恢复普通内置动作", () => {
  const builtInActions = [
    { name: "bath", label: "泡澡", category: "bath", group: "吃睡", file: "pet/a.webp" },
  ];
  const state = G.hydrate({ version: 12 }, NOW);
  const hidden = applyToolCommand(state, builtInActions, "sticker", { type: "hide", name: "bath" }, NOW);
  assert.strictEqual(hidden.ok, true);
  assert.deepStrictEqual(hidden.state.stickerHidden, ["bath"]);
  const restored = applyToolCommand(hidden.state, builtInActions, "sticker", { type: "restore" }, NOW);
  assert.strictEqual(restored.ok, true);
  assert.strictEqual(restored.result.restored, 1);
  assert.deepStrictEqual(restored.state.stickerHidden, []);
});

console.log(`\n通过 ${passed} / ${passed + failures.length}`);
if (failures.length) process.exit(1);
