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

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
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

test("陪玩加心情、升等级越升越贵", () => {
  const state = G.hydrate({ coins: 1e6, mood: 10, satiety: 90 }, NOW);
  const play = G.play(state, NOW);
  assert.strictEqual(play.ok, true);
  assert.strictEqual(state.mood, 10 + G.BALANCE.playValue);

  const first = G.upgradeCost(state);
  G.upgrade(state, NOW);
  assert.strictEqual(state.level, 2);
  assert.ok(G.upgradeCost(state) > first);
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
    buffs: { double_income: 12345 },
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
    prestige: { count: 2, legacyLevel: 109 },
    intimacy: { points: 130, dailyDate: "2026-10-22", dailyPoints: 12 },
    diary: { entries: [{ date: "2026-10-21", text: "昨天赚了 100 金币。" }] },
    unlocked: ["dress_santa", "dress_santa3", 5],
    favorites: ["idle_stand", "bad name"],
    recent: ["idle_stand"],
    schedule: [{ id: "a", time: "09:00", text: "喝水", doneDate: "", notifiedDate: "" }],
    shopStats: { purchases: 2, spent: 40 },
  });
  assert.strictEqual(clean.version, 14);
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
  assert.strictEqual(clean.prestige.count, 2);
  assert.strictEqual(clean.prestige.legacyLevel, 109);
  assert.strictEqual(clean.intimacy.points, 130);
  assert.strictEqual(clean.diary.entries[0].date, "2026-10-21");
  assert.strictEqual(clean.buffs.double_income, 12345);
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

test("扭蛋永久旧装扮不超过 5%，普通分支概率合计为 100%", () => {
  const rateSum = Object.values(G.GACHA_RATES).reduce((sum, value) => sum + value, 0);
  const topRate = G.GACHA_TOP_PRIZES[G.GACHA_TOP_PRIZES.length - 1].until / 1000000;
  assert.strictEqual(Math.round(rateSum * 1e9) / 1e9, 1);
  assert.ok((1 - topRate) * G.GACHA_RATES.legacyOutfitUnlock <= 0.05);
  assert.strictEqual(G.GACHA_RATES.timedFurniture, 0.1);
  assert.strictEqual(G.GACHA_RATES.timedOutfit, 0.08);
});

test("限时家具与装扮按价格加权，价格越高概率越低", () => {
  assert.ok(G.gachaPriceWeight(500) > G.gachaPriceWeight(55000000));
  assert.ok(G.gachaPriceWeight(80) > G.gachaPriceWeight(65000));

  const state = G.hydrate({ coins: 1000 }, NOW);
  const action = { name: "dress_santa", label: "圣诞装扮", category: "dress" };
  const result = G.pullGacha(state, [action], NOW, sequenceRandom([0.999999, 0.82, 0]));
  assert.strictEqual(result.type, "dress");
  assert.strictEqual(result.action, action.name);
  assert.ok(state.unlocked.includes(action.name));
  assert.strictEqual(state.rentals.dress[action.name], undefined);
});

test("扭蛋可抽出 1–7 天限时家具，重复获得会续期并在到期后失效", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const furniture = Object.values(G.FURNITURE).find((item) => item.id !== "companion");
  const first = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.65, 0, 0.5]));
  assert.deepStrictEqual(G.GACHA_LIMITED_DAYS, [1, 2, 3, 4, 5, 6, 7]);
  assert.strictEqual(first.type, "furniture");
  assert.strictEqual(first.durationDays, 4);
  assert.strictEqual(first.label, `${furniture.icon} ${furniture.name}（限时 4 天）`);
  assert.strictEqual(state.rentals.furniture[furniture.id], NOW + 4 * 86400000);
  assert.strictEqual(G.ownsFurniture(state, furniture.id, NOW + 1), true);
  assert.strictEqual(G.ownsFurniture(state, furniture.id, NOW + 4 * 86400000 + 1), false);

  const extended = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.65, 0, 0]));
  assert.strictEqual(extended.durationDays, 1);
  assert.strictEqual(state.rentals.furniture[furniture.id], NOW + 5 * 86400000);

  const ownedState = G.hydrate({ coins: 500, room: { furniture: [furniture.id] } }, NOW);
  const replacement = G.pullGacha(ownedState, [], NOW, sequenceRandom([0.999999, 0.65, 0, 0]));
  assert.strictEqual(replacement.type, "furniture");
  assert.notStrictEqual(replacement.furnitureId, furniture.id);
});

test("扭蛋可抽出 1–7 天限时装扮，并按租赁有效期解锁和失效", () => {
  const state = G.hydrate({ coins: 1000 }, NOW);
  const action = { name: "dress_santa", label: "圣诞装扮", category: "dress" };
  const result = G.pullGacha(state, [action], NOW, sequenceRandom([0.999999, 0.75, 0, 0.999999]));
  assert.strictEqual(result.type, "dress");
  assert.strictEqual(result.rewardCategory, "outfit");
  assert.strictEqual(result.durationDays, 7);
  assert.strictEqual(result.action, action.name);
  assert.strictEqual(state.rentals.dress[action.name], NOW + 7 * 86400000);
  assert.strictEqual(G.isUnlocked(state, action, NOW + 1), true);
  assert.strictEqual(G.isUnlocked(state, action, NOW + 7 * 86400000 + 1), false);

  const fashion = G.SHOP_ITEMS.fashion_starlight_hat;
  const fashionResult = G.pullGacha(state, [], NOW, sequenceRandom([0.999999, 0.75, 0, 0]));
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

test("Lv.50 才能转生，转生后等级归一并保留长期资产", () => {
  const low = G.hydrate({ level: 49 }, NOW);
  assert.strictEqual(G.prestige(low, NOW).ok, false);

  const state = G.hydrate(
    {
      version: 10,
      level: 50,
      coins: 123456,
      unlocked: ["dress_santa"],
      seenActions: ["scene_cat"],
      companion: { adopted: true },
      room: { furniture: ["rug"] },
    },
    NOW
  );
  const result = G.prestige(state, NOW);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.level, 1);
  assert.strictEqual(state.prestige.count, 1);
  assert.strictEqual(state.prestige.legacyLevel, 50);
  assert.strictEqual(state.coins, 123456);
  assert.ok(state.unlocked.includes("dress_santa"));
  assert.ok(state.seenActions.includes("scene_cat"));
  assert.strictEqual(state.companion.adopted, true);
  assert.strictEqual(G.titleForState(state), "摸鱼新生");
});

test("转生倍率永久提升产出，并累积限定称号", () => {
  const state = G.hydrate({ level: 50, prestige: { count: 2, legacyLevel: 100 } }, NOW);
  const before = G.incomePerSecond(state);
  assert.ok(Math.abs(before - 50 * 1.4 * 1.3) < 1e-9);
  assert.strictEqual(G.titleForState(state), "摸鱼传说");
  G.prestige(state, NOW);
  assert.strictEqual(state.prestige.count, 3);
  assert.strictEqual(G.prestigeStatus(state).multiplier, 1.45);
  assert.strictEqual(G.titleForState(state), "传奇摸鱼王");
});

test("v9 老存档迁移后补齐转生字段", () => {
  const state = G.hydrate({ version: 9, level: 20 }, NOW);
  assert.strictEqual(state.version, G.SAVE_VERSION);
  assert.strictEqual(state.prestige.count, 0);
  assert.strictEqual(state.prestige.legacyLevel, 0);
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

console.log(`\n通过 ${passed} / ${passed + failures.length}`);
if (failures.length) process.exit(1);
