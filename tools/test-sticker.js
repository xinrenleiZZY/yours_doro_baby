/* 用户表情包仓库（增 / 删 / 查）的单元测试：node tools/test-sticker.js */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { StickerStore } = require("../lib/sticker-store.js");

const root = path.join(__dirname, "..", ".tmp-sticker-test");
const inputDir = path.join(root, "input");
const store = new StickerStore({
  dir: path.join(root, "user-stickers"),
  manifestFile: path.join(root, "user-stickers.json"),
  probeSize: (file) => (fs.readFileSync(file).equals(png) ? { width: 64, height: 64 } : null),
});

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(inputDir, { recursive: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3sAAAAAElFTkSuQmCC",
  "base64"
);
const cute = path.join(inputDir, "可爱表情.png");
fs.writeFileSync(cute, png);
const note = path.join(inputDir, "note.txt");
fs.writeFileSync(note, "not an image", "utf8");
const broken = path.join(inputDir, "损坏图片.png");
fs.writeFileSync(broken, "not an image", "utf8");

let imported = null;

test("导入表情包会复制文件并生成动作", () => {
  const result = store.importFiles([cute]);
  assert.strictEqual(result.added.length, 1);
  imported = result.added[0];
  assert.ok(/^user_[a-f0-9]{10}$/.test(imported.name));
  assert.strictEqual(imported.label, "可爱表情");
  assert.strictEqual(imported.group, "表情包");
  assert.strictEqual(imported.user, true);
  assert.deepStrictEqual(imported.size, [64, 64]);
  assert.ok(imported.url.startsWith("file://"));
  assert.strictEqual(fs.readdirSync(path.join(root, "user-stickers")).length, 1);
});

test("重复导入会被识别为 duplicate", () => {
  const result = store.importFiles([cute]);
  assert.strictEqual(result.added.length, 0);
  assert.strictEqual(result.skipped[0].reason, "duplicate");
});

test("不支持的扩展名会被拒绝", () => {
  const result = store.importFiles([note]);
  assert.strictEqual(result.added.length, 0);
  assert.strictEqual(result.skipped[0].reason, "unsupported");
});

test("损坏图片不会被写入表情包目录", () => {
  const result = store.importFiles([broken]);
  assert.strictEqual(result.added.length, 0);
  assert.strictEqual(result.skipped[0].reason, "invalid-image");
  assert.strictEqual(fs.readdirSync(path.join(root, "user-stickers")).length, 1);
});

test("清单持久化后重新加载仍能看到表情包", () => {
  const fresh = new StickerStore({
    dir: path.join(root, "user-stickers"),
    manifestFile: path.join(root, "user-stickers.json"),
    probeSize: () => null,
  });
  const list = fresh.listActions();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, imported.name);
});

test("删除表情包会同时删文件和清单项", () => {
  const removed = store.remove(imported.name);
  assert.strictEqual(removed, true);
  assert.strictEqual(store.listActions().length, 0);
});

test("非法名称不能删除", () => {
  assert.strictEqual(store.remove("../etc"), false);
  assert.strictEqual(store.remove("builtin_idle"), false);
});

test("清单里的目录穿越路径会被忽略", () => {
  const manifest = path.join(root, "user-stickers.json");
  fs.writeFileSync(
    manifest,
    JSON.stringify([
      {
        name: "user_aaaaaaaaaa",
        label: "越界文件",
        file: "../../outside.png",
        size: [64, 64],
      },
    ]),
    "utf8"
  );
  const hostile = new StickerStore({
    dir: path.join(root, "user-stickers"),
    manifestFile: manifest,
    probeSize: () => null,
  });
  assert.strictEqual(hostile.listActions().length, 0);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n通过 ${passed} / 8`);
