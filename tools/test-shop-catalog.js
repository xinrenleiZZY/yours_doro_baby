/* Docker 商城目录、缓存和动态商品测试。 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const G = require("../renderer/game.js");
const { sanitizeCatalog, readCatalogFile, ShopCatalogService } = require("../lib/shop-catalog.js");

async function main() {
  let passed = 0;
  const check = (name, condition) => {
    assert.ok(condition, name);
    passed += 1;
    console.log(`  ok  ${name}`);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doro-shop-catalog-test-"));
  try {
    const remote = {
      version: "cloud-1",
      updatedAt: "2026-10-22T08:00:00.000Z",
      furniture: {
        cloud_chair: {
          id: "cloud_chair",
          name: "云端椅子",
          icon: "🪑",
          price: 999,
          score: 123,
          bonus: 0.1,
          desc: "云端测试家具",
          listed: true,
        },
      },
      items: {
        cloud_luxury: {
          id: "cloud_luxury",
          name: "云端典藏",
          type: "luxury",
          price: 9999,
          score: 456,
          bonus: 0.2,
          icon: "☁️",
          desc: "云端测试典藏",
          listed: true,
        },
        cloud_fashion: {
          id: "cloud_fashion",
          name: "云端帽",
          type: "fashion",
          price: 300,
          score: 90,
          icon: "🎩",
          overlay: "fashion/starlight_hat.svg",
          overlayTop: 4,
          overlayLeft: 50,
          overlayWidth: 40,
          desc: "云端服装",
          listed: true,
        },
        bad_champion: {
          id: "bad_champion",
          name: "不应由目录注入",
          type: "champion",
          price: 1,
          icon: "!",
        },
      },
      dresses: {
        basePrice: 100,
        priceStep: 10,
        overrides: {
          dress_test: { price: 500, score: 88 },
        },
      },
    };
    const clean = sanitizeCatalog(remote);
    check(
      "目录清洗保留新家具、典藏和时装覆盖",
      clean.version === "cloud-1" &&
        clean.furniture.cloud_chair.score === 123 &&
        clean.items.cloud_luxury.price === 9999 &&
        clean.items.cloud_fashion.overlay === "fashion/starlight_hat.svg" &&
        clean.dresses.overrides.dress_test.score === 88
    );
    check(
      "目录不会注入榜一限定藏品或危险 ID",
      !clean.items.bad_champion && !Object.prototype.hasOwnProperty.call(clean.items, "__proto__")
    );

    const cacheFile = path.join(dir, "catalog-cache.json");
    const service = new ShopCatalogService({
      cacheFile,
      client: { shopCatalog: async () => ({ ok: true, catalog: remote }) },
      game: G,
      log: () => {},
    });
    await service.refresh();
    check(
      "云端目录会应用到游戏商品表并写入本地缓存",
      G.FURNITURE.cloud_chair &&
        G.SHOP_ITEMS.cloud_luxury &&
        G.dressPrice(0, "dress_test") === 500 &&
        G.dressScore(0, "dress_test") === 88 &&
        Boolean(readCatalogFile(cacheFile))
    );

    const offline = new ShopCatalogService({
      cacheFile,
      client: { shopCatalog: async () => ({ ok: false, error: "network" }) },
      game: G,
      log: () => {},
    });
    offline.init();
    await offline.refresh();
    check(
      "Docker 不可达时继续使用缓存目录",
      offline.snapshot().catalog.version === "cloud-1" && G.FURNITURE.cloud_chair
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n通过 ${passed} / ${passed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
