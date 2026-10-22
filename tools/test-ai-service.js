/* AI 对话服务测试：node tools/test-ai-service.js */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  AiService,
  completionUrl,
  normalizeBaseUrl,
  parseIntent,
  requiresApiKey,
} = require("../lib/ai-service.js");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doro-ai-test-"));
const configFile = path.join(tempDir, "ai-config.json");
const historyFile = path.join(tempDir, "ai-history.json");
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

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.log(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`, "utf8"),
    decryptString: (buffer) => Buffer.from(buffer).toString("utf8").replace(/^enc:/, ""),
  };
}

function makeService(fetchImpl) {
  return new AiService({
    configFile,
    historyFile,
    safeStorage: fakeSafeStorage(),
    log: () => {},
    fetchImpl,
    now: () => 1_700_000_000_000,
    env: {},
  });
}

async function main() {
  console.log("doro AI 服务测试");

  test("兼容接口地址不会被重复拼接", () => {
    assert.strictEqual(
      completionUrl("https://api.deepseek.com/v1"),
      "https://api.deepseek.com/v1/chat/completions"
    );
    assert.strictEqual(
      completionUrl("https://example.com/v1/chat/completions"),
      "https://example.com/v1/chat/completions"
    );
    assert.strictEqual(normalizeBaseUrl("file:///etc/passwd"), "");
    assert.strictEqual(normalizeBaseUrl("https://user:pass@example.com/v1"), "");
    assert.strictEqual(requiresApiKey("http://127.0.0.1:11434/v1"), false);
    assert.strictEqual(requiresApiKey("https://api.example.com/v1"), true);
  });

  test("模型回复会收敛为有限意图", () => {
    assert.deepStrictEqual(parseIntent('```json\n{"reply":"抱抱你","emotion":"shy","gesture":"hide"}\n```'), {
      reply: "抱抱你",
      emotion: "shy",
      gesture: "hide",
    });
    const fallback = parseIntent("普通文本也可以");
    assert.strictEqual(fallback.reply, "普通文本也可以");
    assert.strictEqual(fallback.emotion, "gentle");
    assert.strictEqual(fallback.gesture, "none");
  });

  test("API Key 加密保存且不会出现在公开配置里", () => {
    const service = makeService();
    const result = service.updateConfig({
      baseUrl: "https://api.example.com/v1/",
      model: "example-chat",
      apiKey: "secret-key",
      persona: "测试人格",
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.config.hasApiKey, true);
    assert.strictEqual(result.config.apiKey, undefined);
    assert.strictEqual(service.getApiKey(), "secret-key");
    const raw = fs.readFileSync(configFile, "utf8");
    assert.ok(!raw.includes("secret-key"));
    assert.ok(raw.includes(service.loadConfig().encryptedApiKey));
  });

  await testAsync("聊天请求带宠物上下文，并持久化短期历史", async () => {
    let request = null;
    const service = makeService(async (url, options) => {
      request = { url, options };
      return new globalThis.Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"reply":"知道啦，先休息十分钟吧","emotion":"gentle","gesture":"stretch"}',
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const result = await service.chat({
      message: "写代码写累了",
      context: { mood: 72, satiety: 55, localTime: "22:30" },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.intent.gesture, "stretch");
    assert.strictEqual(request.url, "https://api.example.com/v1/chat/completions");
    assert.strictEqual(request.options.headers.Authorization, "Bearer secret-key");
    const body = JSON.parse(request.options.body);
    assert.ok(body.messages.some((item) => item.content.includes('"mood":72')));
    assert.strictEqual(body.messages[body.messages.length - 1].content, "写代码写累了");
    assert.strictEqual(result.history.length, 2);
    assert.strictEqual(result.history[0].role, "user");
    assert.strictEqual(result.history[1].role, "assistant");

    const reloaded = makeService();
    assert.strictEqual(reloaded.publicHistory().length, 2);
    reloaded.clearHistory();
    assert.strictEqual(reloaded.publicHistory().length, 0);
  });

  await testAsync("异常超大的上游响应会被拒绝", async () => {
    const service = makeService(
      async () =>
        new globalThis.Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(600 * 1024),
          },
        })
    );
    const result = await service.chat({ message: "测试大响应", context: {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "response-too-large");
  });

  await testAsync("未配置密钥时不会发起网络请求", async () => {
    fs.rmSync(configFile, { force: true });
    fs.rmSync(historyFile, { force: true });
    let called = false;
    const service = makeService(async () => {
      called = true;
      return new globalThis.Response("{}");
    });
    const result = await service.chat({ message: "你好", context: {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "missing-api-key");
    assert.strictEqual(called, false);
  });

  await testAsync("本地回环服务可以免 API Key 使用", async () => {
    let headers = null;
    const service = makeService(async (_url, options) => {
      headers = options.headers;
      return new globalThis.Response(
        JSON.stringify({
          choices: [{ message: { content: '{"reply":"本地也能聊","emotion":"happy","gesture":"nod"}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    const saved = service.updateConfig({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen-local",
      persona: "测试人格",
      clearApiKey: true,
    });
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.status.configured, true);
    const result = await service.chat({ message: "你好", context: {} });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(headers.Authorization, undefined);
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`\n${passed} 项通过${process.exitCode ? "，存在失败" : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
