/* 独立工具窗口的交易命令测试。 */
const assert = require("assert");
const G = require("../renderer/game.js");
const { applyToolCommand } = require("../lib/tool-actions.js");

const NOW = 1_700_000_000_000;
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

test("装扮按动作清单价格解锁", () => {
  const state = G.hydrate({ coins: 10000 }, NOW);
  const result = applyToolCommand(
    state,
    actions,
    "shop",
    { type: "buy", item: { kind: "dress", action: "dress_one" } },
    NOW
  );
  assert.strictEqual(result.ok, true);
  assert.ok(result.state.unlocked.includes("dress_one"));
  assert.strictEqual(result.state.coins, 10000 - G.dressPrice(0));
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

test("小游戏结算有冷却和分数上限", () => {
  const state = G.hydrate({ coins: 0 }, NOW);
  const result = applyToolCommand(state, actions, "minigame", { type: "finish", score: 9999 }, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.result.score, 500);
  assert.strictEqual(result.result.reward, 1000);
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

console.log(`\n通过 ${passed} / ${passed + failures.length}`);
if (failures.length) process.exit(1);
