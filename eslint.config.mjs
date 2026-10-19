/* ESLint 9 扁平配置：渲染进程按浏览器环境，其余按 Node 环境。 */
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  location: "readonly",
  navigator: "readonly",
  Image: "readonly",
  MouseEvent: "readonly",
  PointerEvent: "readonly",
  Event: "readonly",
  URLSearchParams: "readonly",
  performance: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  console: "readonly",
};

const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  process: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  console: "readonly",
};

export default [
  {
    ignores: ["node_modules/**", "assets/**", "doro_dz/**", "dist/**", "out/**", "release/**", ".tmp-*/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-undef": "error",
      "no-redeclare": "error",
      "no-shadow": "warn",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "warn",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["renderer/**/*.js"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    // game.js 是 UMD：浏览器挂 window.DoroGame，Node 里走 module.exports
    files: ["renderer/game.js"],
    languageOptions: {
      globals: {
        module: "readonly",
        self: "readonly",
      },
    },
  },
  {
    files: ["main.js", "preload.js", "lib/**/*.js", "tools/**/*.js"],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
  {
    files: ["tools/*.js"],
    rules: {
      "no-console": "off",
    },
  },
];
