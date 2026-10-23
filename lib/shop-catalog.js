/* Docker 商城目录：远程更新、本地缓存、断网回退。 */
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_CATALOG_BYTES = 512 * 1024;
const ITEM_TYPES = new Set(["food", "toy", "buff", "permanent", "theme", "luxury", "profile", "fashion"]);

function safeId(value) {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9_]{0,39}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function numeric(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function sanitizeShopItem(id, input) {
  if (!safeId(id) || !input || typeof input !== "object" || !ITEM_TYPES.has(input.type)) {
    return null;
  }
  const item = {
    id,
    name: text(input.name, 40),
    type: input.type,
    price: Math.round(numeric(input.price, 0, 1, 1e15)),
    icon: text(input.icon, 8),
    desc: text(input.desc, 200),
    listed: input.listed !== false,
  };
  if (!item.name || !item.icon) return null;
  ["score", "satiety", "mood", "minutes"].forEach((key) => {
    if (Number.isFinite(Number(input[key]))) {
      item[key] = Math.round(numeric(input[key], 0, -10000, 1000000000));
    }
  });
  ["bonus", "permanentBonus", "dailyIncomeBonus"].forEach((key) => {
    if (Number.isFinite(Number(input[key]))) {
      item[key] = numeric(input[key], 0, 0, 100);
    }
  });
  ["buff", "theme", "profileAction"].forEach((key) => {
    if (typeof input[key] === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(input[key])) {
      item[key] = input[key];
    }
  });
  if (input.type === "fashion") {
    if (!/^fashion\/[a-z0-9_]{1,50}\.svg$/.test(String(input.overlay || ""))) return null;
    item.overlay = input.overlay;
    item.overlayTop = numeric(input.overlayTop, 0, -20, 100);
    item.overlayLeft = numeric(input.overlayLeft, 50, 0, 100);
    item.overlayWidth = numeric(input.overlayWidth, 50, 5, 150);
  }
  return item;
}

function sanitizeFurniture(id, input) {
  if (!safeId(id) || !input || typeof input !== "object") return null;
  const item = {
    id,
    name: text(input.name, 40),
    icon: text(input.icon, 8),
    price: Math.round(numeric(input.price, 0, 1, 1e15)),
    score: Math.round(numeric(input.score, 0, 0, 1e12)),
    bonus: numeric(input.bonus, 0, 0, 100),
    desc: text(input.desc, 200),
    listed: input.listed !== false,
  };
  return item.name && item.icon ? item : null;
}

function sanitizeCatalog(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const encoded = JSON.stringify(input);
  if (Buffer.byteLength(encoded, "utf8") > MAX_CATALOG_BYTES) return null;
  const raw = input.catalog && typeof input.catalog === "object" ? input.catalog : input;
  const items = {};
  Object.entries(raw.items && typeof raw.items === "object" ? raw.items : {})
    .slice(0, 300)
    .forEach(([id, value]) => {
      const item = sanitizeShopItem(id, value);
      if (item) items[id] = item;
    });
  const furniture = {};
  Object.entries(raw.furniture && typeof raw.furniture === "object" ? raw.furniture : {})
    .slice(0, 300)
    .forEach(([id, value]) => {
      const item = sanitizeFurniture(id, value);
      if (item && id !== "companion") furniture[id] = item;
    });
  const rawDresses = raw.dresses && typeof raw.dresses === "object" ? raw.dresses : {};
  const overrides = {};
  Object.entries(rawDresses.overrides && typeof rawDresses.overrides === "object" ? rawDresses.overrides : {})
    .slice(0, 500)
    .forEach(([name, value]) => {
      if (!safeId(name) || !value || typeof value !== "object") return;
      const entry = {};
      if (Number.isFinite(Number(value.price))) entry.price = Math.round(numeric(value.price, 1, 1, 1e12));
      if (Number.isFinite(Number(value.score))) entry.score = Math.round(numeric(value.score, 0, 0, 1e12));
      if (value.listed === false) entry.listed = false;
      if (Object.keys(entry).length) overrides[name] = entry;
    });
  return {
    version: text(raw.version, 40) || "1",
    updatedAt: text(raw.updatedAt, 40),
    items,
    furniture,
    dresses: {
      basePrice: Math.round(numeric(rawDresses.basePrice, 80, 1, 1000000)),
      priceStep: Math.round(numeric(rawDresses.priceStep, 20, 0, 100000)),
      overrides,
    },
  };
}

function readCatalogFile(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_CATALOG_BYTES) return null;
    return sanitizeCatalog(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

class ShopCatalogService {
  constructor({ cacheFile, client, game, log, onUpdate } = {}) {
    this.cacheFile = cacheFile;
    this.client = client;
    this.game = game;
    this.log = typeof log === "function" ? log : () => {};
    this.onUpdate = typeof onUpdate === "function" ? onUpdate : () => {};
    this.catalog = sanitizeCatalog({ version: "builtin", items: {}, furniture: {} });
    this.status = { state: "idle", version: "builtin", source: "builtin", updatedAt: "" };
    this.refreshing = null;
  }

  apply(catalog, source) {
    if (!catalog) return false;
    this.catalog = catalog;
    this.game.applyCatalog(catalog);
    this.status = {
      state: "ready",
      version: catalog.version,
      source,
      updatedAt: catalog.updatedAt || new Date().toISOString(),
    };
    this.onUpdate(this.snapshot());
    return true;
  }

  init() {
    const cached = this.cacheFile ? readCatalogFile(this.cacheFile) : null;
    if (cached) this.apply(cached, "cache");
    this.refresh().catch(() => {});
    return this.snapshot();
  }

  async refresh() {
    if (!this.client || typeof this.client.shopCatalog !== "function") return this.snapshot();
    if (this.refreshing) return this.refreshing;
    this.status = { ...this.status, state: "refreshing" };
    this.refreshing = (async () => {
      try {
        const result = await this.client.shopCatalog();
        if (!result || !result.ok || !result.catalog) {
          this.status = {
            ...this.status,
            state: result && result.error ? "offline" : "cache",
            error: (result && result.error) || "invalid-catalog",
          };
          return this.snapshot();
        }
        const catalog = sanitizeCatalog(result.catalog);
        if (!catalog) {
          this.status = { ...this.status, state: "error", error: "invalid-catalog" };
          return this.snapshot();
        }
        if (this.cacheFile) {
          fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
          const tmp = `${this.cacheFile}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2), "utf8");
          fs.renameSync(tmp, this.cacheFile);
        }
        this.apply(catalog, "docker");
      } catch (err) {
        this.status = { ...this.status, state: "offline", error: err.message || String(err) };
        this.log("warn", "商城目录更新失败，继续使用本地缓存", err.message || String(err));
      } finally {
        this.refreshing = null;
      }
      return this.snapshot();
    })();
    return this.refreshing;
  }

  snapshot() {
    return {
      version: this.status.version,
      updatedAt: this.status.updatedAt,
      state: this.status.state,
      source: this.status.source,
      error: this.status.error || "",
      catalog: this.catalog,
    };
  }
}

module.exports = {
  MAX_CATALOG_BYTES,
  sanitizeCatalog,
  readCatalogFile,
  ShopCatalogService,
};
