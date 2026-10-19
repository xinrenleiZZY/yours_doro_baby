/*
 * 跨平台调用 Python 资源脚本：优先用 DORO_PYTHON 指定的解释器，
 * 然后依次尝试 `py -3` / `python` / `python3`，避免 npm run assets 在别的机器上直接失败。
 */
const { spawnSync } = require("child_process");
const path = require("path");

const mode = process.argv.includes("--library")
  ? "build_library.py"
  : process.argv.includes("--thumbs")
    ? "make_thumbs.py"
    : "prepare_assets.py";
const script = path.join(__dirname, mode);
const candidates = [
  process.env.DORO_PYTHON ? { cmd: process.env.DORO_PYTHON, args: [] } : null,
  { cmd: "py", args: ["-3"] },
  { cmd: "python", args: [] },
  { cmd: "python3", args: [] },
].filter(Boolean);

function probe(candidate) {
  // 不用 shell：-c "import PIL; print(...)" 里的引号在不同 shell 下容易被吃掉
  const result = spawnSync(candidate.cmd, [...candidate.args, "-c", "import PIL; print(PIL.__version__)"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

let chosen = null;
for (const candidate of candidates) {
  const version = probe(candidate);
  if (version) {
    chosen = { ...candidate, pillow: version };
    break;
  }
}

if (!chosen) {
  console.error("找不到可用的 Python（需要 Pillow）。");
  console.error(
    "请安装 Python 3 + Pillow（pip install -r requirements.txt），或用 DORO_PYTHON 指定解释器路径。"
  );
  process.exit(1);
}

console.log(`使用 ${chosen.cmd} ${chosen.args.join(" ")}（Pillow ${chosen.pillow}）`);
const run = spawnSync(chosen.cmd, [...chosen.args, script], {
  stdio: "inherit",
  windowsHide: true,
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});
process.exit(run.status === null ? 1 : run.status);
