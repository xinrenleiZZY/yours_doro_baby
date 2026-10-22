/*
 * 用户表情包仓库：负责导入 / 删除 / 清单持久化。
 * 只做文件与清单管理；尺寸探测由主进程注入（nativeImage），方便单元测试。
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ALLOWED_EXTENSIONS = new Set([".gif", ".webp", ".png", ".apng", ".jpg", ".jpeg"]);
const NAME_RE = /^user_[a-f0-9]{10}$/;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 200;

function sanitizeLabel(value) {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f<>"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return clean || "新表情包";
}

class StickerStore {
  constructor({ dir, manifestFile, probeSize, log } = {}) {
    this.dir = dir;
    this.manifestFile = manifestFile;
    this.probeSize = typeof probeSize === "function" ? probeSize : () => null;
    this.log = typeof log === "function" ? log : () => {};
    this.records = null;
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  load() {
    if (this.records) return this.records;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestFile, "utf8"));
      this.records = Array.isArray(parsed)
        ? parsed
            .map((item) => this.normalizeRecord(item))
            .filter(Boolean)
            .slice(0, MAX_ITEMS)
        : [];
    } catch (err) {
      this.records = [];
    }
    return this.records;
  }

  normalizeRecord(item) {
    if (!item || typeof item.file !== "string" || !NAME_RE.test(item.name)) return null;
    if (path.basename(item.file) !== item.file) return null;
    const ext = path.extname(item.file).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || item.file !== `${item.name}${ext}`) return null;
    const size =
      Array.isArray(item.size) &&
      item.size.length === 2 &&
      item.size.every((value) => Number.isInteger(value) && value > 0 && value <= 16384)
        ? item.size
        : [200, 200];
    return {
      name: item.name,
      label: sanitizeLabel(item.label),
      file: item.file,
      size,
      addedAt: Number.isFinite(item.addedAt) ? item.addedAt : 0,
    };
  }

  save() {
    try {
      this.ensureDir();
      const tmp = `${this.manifestFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.records || [], null, 2), "utf8");
      fs.renameSync(tmp, this.manifestFile);
    } catch (err) {
      this.log("error", "保存表情包清单失败", err.message);
    }
  }

  actionFor(record) {
    const absolute = path.join(this.dir, record.file);
    const url = pathToFileURL(absolute).href;
    const size = Array.isArray(record.size) && record.size.length === 2 ? record.size : [200, 200];
    return {
      name: record.name,
      label: record.label,
      category: "meme",
      group: "表情包",
      file: `user-stickers/${record.file}`,
      url,
      thumb: url,
      size,
      frames: 1,
      durationMs: 0,
      blocked: false,
      user: true,
    };
  }

  listActions() {
    this.ensureDir();
    return this.load()
      .filter((record) => fs.existsSync(path.join(this.dir, record.file)))
      .map((record) => this.actionFor(record));
  }

  importFiles(files) {
    this.ensureDir();
    const records = this.load();
    const added = [];
    const skipped = [];
    const list = Array.isArray(files) ? files.slice(0, 10) : [];
    for (const file of list) {
      try {
        const ext = path.extname(file).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          skipped.push({ file, reason: "unsupported" });
          continue;
        }
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
          skipped.push({ file, reason: "size" });
          continue;
        }
        if (records.length >= MAX_ITEMS) {
          skipped.push({ file, reason: "full" });
          continue;
        }
        const bytes = fs.readFileSync(file);
        const hash = crypto.createHash("sha256").update(bytes).digest("hex");
        const name = `user_${hash.slice(0, 10)}`;
        if (records.some((item) => item.name === name)) {
          skipped.push({ file, reason: "duplicate" });
          continue;
        }
        const stored = `${name}${ext}`;
        const target = path.join(this.dir, stored);
        fs.writeFileSync(target, bytes);
        const size = this.probeSize(target);
        if (
          !size ||
          !Number.isFinite(size.width) ||
          !Number.isFinite(size.height) ||
          size.width <= 0 ||
          size.height <= 0
        ) {
          fs.unlinkSync(target);
          skipped.push({ file, reason: "invalid-image" });
          continue;
        }
        const label = sanitizeLabel(path.basename(file, ext));
        const record = {
          name,
          label,
          file: stored,
          size: [size.width, size.height],
          addedAt: Date.now(),
        };
        records.push(record);
        added.push(this.actionFor(record));
      } catch (err) {
        this.log("warn", "导入表情包失败", err.message);
        skipped.push({ file, reason: "error" });
      }
    }
    if (added.length) this.save();
    return { added, skipped };
  }

  remove(name) {
    if (!NAME_RE.test(String(name || ""))) return false;
    const records = this.load();
    const index = records.findIndex((item) => item.name === name);
    if (index < 0) return false;
    const [record] = records.splice(index, 1);
    try {
      fs.unlinkSync(path.join(this.dir, record.file));
    } catch (err) {
      this.log("warn", "删除表情包文件失败", err.message);
    }
    this.save();
    return true;
  }
}

module.exports = { StickerStore, sanitizeLabel, ALLOWED_EXTENSIONS, MAX_FILE_BYTES, MAX_ITEMS };
