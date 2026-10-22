/*
 * doro 的 AI 对话服务。
 * 这一层只负责：安全保存配置、维护短期对话、请求 OpenAI 兼容接口、
 * 把模型输出收敛成有限的动作意图。它不直接操作桌面。
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = process.env.DORO_AI_BASE_URL || "https://api.deepseek.com/v1";
const DEFAULT_MODEL = process.env.DORO_AI_MODEL || "deepseek-chat";
const DEFAULT_PERSONA = [
  "你是住在用户桌面上的 doro，一只粉色、软乎乎、有点懒但很在意用户的桌宠。",
  "说话自然、短、具体，像认识很久的朋友；可以撒娇，但不要愧疚绑架，不要刷屏。",
  "你只能依据提供的宠物状态和对话回答，不要声称看到了屏幕、键盘或用户的私人内容。",
  "聊天中的主动建议要克制；用户明显在忙碌时，优先给一句简短陪伴或休息提醒。",
].join("\n");

const EMOTIONS = new Set(["gentle", "happy", "sad", "angry", "shy", "curious", "sleepy"]);
const GESTURES = new Set(["none", "nod", "shake", "jump", "stretch", "hide"]);
const MAX_MESSAGE_CHARS = 2000;
const MAX_REPLY_CHARS = 280;
const MAX_HISTORY = 60;
const MAX_PROMPT_HISTORY = 16;
const MAX_RESPONSE_BYTES = 512 * 1024;

function cleanText(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);
}

function normalizeBaseUrl(value) {
  const text = cleanText(value, 300);
  if (!text) return "";
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return url.toString().replace(/\/+$/, "");
  } catch (err) {
    return "";
  }
}

function requiresApiKey(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
  } catch (err) {
    return true;
  }
}

function completionUrl(baseUrl) {
  const url = new URL(baseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    url.pathname = pathname;
  } else if (pathname) {
    url.pathname = `${pathname}/chat/completions`;
  } else {
    url.pathname = "/chat/completions";
  }
  return url.toString();
}

/**
 * 模型只需要回答角色层的结果。动作是否允许、窗口怎么移动等执行权不交给模型。
 */
function parseIntent(content) {
  const raw = cleanText(content, 6000);
  const objectText = (() => {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1].trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    return start >= 0 && end > start ? raw.slice(start, end + 1) : "";
  })();

  let parsed = null;
  if (objectText) {
    try {
      parsed = JSON.parse(objectText);
    } catch (err) {
      parsed = null;
    }
  }

  const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const reply = cleanText(candidate.reply ?? candidate.speech ?? raw, MAX_REPLY_CHARS);
  const emotion = EMOTIONS.has(candidate.emotion) ? candidate.emotion : "gentle";
  const gesture = GESTURES.has(candidate.gesture) ? candidate.gesture : "none";
  return {
    reply: reply || "我在这里。",
    emotion,
    gesture,
  };
}

function normalizeHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter(
      (item) =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .slice(-MAX_HISTORY)
    .map((item) => ({
      role: item.role,
      content: cleanText(item.content, MAX_MESSAGE_CHARS),
      at: Number.isFinite(Number(item.at)) ? Number(item.at) : 0,
    }))
    .filter((item) => item.content);
}

class AiService {
  constructor({ configFile, historyFile, safeStorage, log, fetchImpl, now, env = process.env } = {}) {
    this.configFile = configFile;
    this.historyFile = historyFile;
    this.safeStorage = safeStorage;
    this.log = typeof log === "function" ? log : () => {};
    this.fetchImpl = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    this.now = typeof now === "function" ? now : Date.now;
    this.env = env || {};
    this.config = null;
    this.history = null;
  }

  loadConfig() {
    if (this.config) return this.config;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configFile, "utf8"));
      this.config =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? {
              baseUrl: normalizeBaseUrl(parsed.baseUrl),
              model: cleanText(parsed.model, 120),
              persona: cleanText(parsed.persona, 4000),
              encryptedApiKey:
                typeof parsed.encryptedApiKey === "string" ? parsed.encryptedApiKey.slice(0, 12000) : "",
            }
          : {};
    } catch (err) {
      this.config = {};
    }
    return this.config;
  }

  saveConfigFile() {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const tmp = `${this.configFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.configFile);
  }

  getApiKey() {
    const config = this.loadConfig();
    const envKey = cleanText(this.env.DORO_AI_API_KEY, 4000);
    if (envKey) return envKey;
    if (!config.encryptedApiKey || !this.safeStorage) return "";
    try {
      if (this.safeStorage.isEncryptionAvailable && !this.safeStorage.isEncryptionAvailable()) return "";
      return this.safeStorage.decryptString(Buffer.from(config.encryptedApiKey, "base64"));
    } catch (err) {
      this.log("warn", "读取 AI API Key 失败", err.message);
      return "";
    }
  }

  publicConfig() {
    const config = this.loadConfig();
    const baseUrl = config.baseUrl || normalizeBaseUrl(this.env.DORO_AI_BASE_URL) || DEFAULT_BASE_URL;
    return {
      baseUrl,
      model: config.model || cleanText(this.env.DORO_AI_MODEL, 120) || DEFAULT_MODEL,
      persona: config.persona || DEFAULT_PERSONA,
      hasApiKey: Boolean(this.getApiKey()),
      requiresApiKey: requiresApiKey(baseUrl),
      encryptionAvailable: Boolean(
        this.safeStorage &&
        (!this.safeStorage.isEncryptionAvailable || this.safeStorage.isEncryptionAvailable())
      ),
    };
  }

  status() {
    const config = this.publicConfig();
    return {
      configured: Boolean(config.baseUrl && config.model && (!config.requiresApiKey || config.hasApiKey)),
      provider: "openai-compatible",
      model: config.model,
      hasApiKey: config.hasApiKey,
    };
  }

  updateConfig(input) {
    const source = input && typeof input === "object" ? input : {};
    const baseUrl = normalizeBaseUrl(source.baseUrl);
    const model = cleanText(source.model, 120);
    const persona = cleanText(source.persona, 4000);
    if (!baseUrl) return { ok: false, error: "invalid-base-url" };
    if (!model) return { ok: false, error: "invalid-model" };
    if (!persona) return { ok: false, error: "invalid-persona" };

    const config = this.loadConfig();
    config.baseUrl = baseUrl;
    config.model = model;
    config.persona = persona;

    const suppliedKey = cleanText(source.apiKey, 4000);
    if (suppliedKey) {
      if (
        !this.safeStorage ||
        (this.safeStorage.isEncryptionAvailable && !this.safeStorage.isEncryptionAvailable())
      ) {
        return { ok: false, error: "secure-storage-unavailable" };
      }
      config.encryptedApiKey = this.safeStorage.encryptString(suppliedKey).toString("base64");
    } else if (source.clearApiKey === true) {
      config.encryptedApiKey = "";
    }

    try {
      this.saveConfigFile();
    } catch (err) {
      this.log("error", "保存 AI 配置失败", err.message);
      return { ok: false, error: "save-failed" };
    }
    return { ok: true, config: this.publicConfig(), status: this.status() };
  }

  loadHistory() {
    if (this.history) return this.history;
    try {
      this.history = normalizeHistory(JSON.parse(fs.readFileSync(this.historyFile, "utf8")));
    } catch (err) {
      this.history = [];
    }
    return this.history;
  }

  publicHistory() {
    return this.loadHistory()
      .slice(-40)
      .map((item) => ({ ...item }));
  }

  saveHistory() {
    try {
      fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
      const tmp = `${this.historyFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.history.slice(-MAX_HISTORY), null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(tmp, this.historyFile);
    } catch (err) {
      this.log("warn", "保存 AI 对话记录失败", err.message);
    }
  }

  clearHistory() {
    this.history = [];
    this.saveHistory();
    return { ok: true };
  }

  buildMessages(message, context) {
    const config = this.loadConfig();
    const persona = config.persona || DEFAULT_PERSONA;
    const contract = [
      "本轮只输出一个 JSON 对象，不要 Markdown，不要额外解释。",
      '格式：{"reply":"给用户看的中文短句","emotion":"gentle|happy|sad|angry|shy|curious|sleepy","gesture":"none|nod|shake|jump|stretch|hide"}',
      "reply 控制在 1 到 80 个汉字，确实需要解释时最多 180 字。",
      "emotion 和 gesture 必须从枚举中选择；不确定就 gentle / none。",
    ].join("\n");
    const safeContext = context && typeof context === "object" ? context : {};
    const history = this.loadHistory()
      .slice(-MAX_PROMPT_HISTORY)
      .map((item) => ({ role: item.role, content: item.content }));
    return [
      { role: "system", content: `${persona}\n\n${contract}` },
      { role: "system", content: `当前宠物状态：${JSON.stringify(safeContext)}` },
      ...history,
      { role: "user", content: message },
    ];
  }

  async chat({ message, context } = {}) {
    const text = cleanText(message, MAX_MESSAGE_CHARS);
    if (!text) return { ok: false, error: "empty-message" };
    const config = this.publicConfig();
    if (config.requiresApiKey && !config.hasApiKey) return { ok: false, error: "missing-api-key" };
    if (!config.baseUrl || !config.model) return { ok: false, error: "missing-config" };
    if (typeof this.fetchImpl !== "function") return { ok: false, error: "fetch-unavailable" };

    const messages = this.buildMessages(text, context);

    const controller = new globalThis.AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    let response;
    try {
      response = await this.fetchImpl(completionUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.getApiKey() ? { Authorization: `Bearer ${this.getApiKey()}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.8,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      this.log("warn", "AI 请求失败", err && err.message ? err.message : String(err));
      return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "network" };
    } finally {
      clearTimeout(timeout);
    }

    if (!response || !response.ok) {
      let detail = "";
      try {
        detail = cleanText(await response.text(), 500);
      } catch (err) {
        detail = "";
      }
      this.log("warn", "AI 服务返回错误", { status: response && response.status, detail });
      return {
        ok: false,
        error: "upstream",
        status: response ? response.status : 0,
        detail,
      };
    }

    const declaredSize = Number(response.headers && response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
      return { ok: false, error: "response-too-large" };
    }
    let rawContent;
    try {
      rawContent = await response.text();
    } catch (err) {
      return { ok: false, error: "invalid-response" };
    }
    if (Buffer.byteLength(rawContent, "utf8") > MAX_RESPONSE_BYTES) {
      return { ok: false, error: "response-too-large" };
    }
    let payload;
    try {
      payload = JSON.parse(rawContent);
    } catch (err) {
      return { ok: false, error: "invalid-response" };
    }
    const content =
      payload && payload.choices && payload.choices[0] && payload.choices[0].message
        ? payload.choices[0].message.content
        : "";
    const contentText = Array.isArray(content)
      ? content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("")
      : content;
    if (!contentText) return { ok: false, error: "empty-response" };

    const intent = parseIntent(contentText);
    const history = this.loadHistory();
    history.push(
      { role: "user", content: text, at: this.now() },
      { role: "assistant", content: intent.reply, at: this.now() }
    );
    this.history = this.history.slice(-MAX_HISTORY);
    this.saveHistory();
    return { ok: true, intent, history: this.publicHistory() };
  }
}

module.exports = {
  AiService,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PERSONA,
  MAX_MESSAGE_CHARS,
  MAX_RESPONSE_BYTES,
  completionUrl,
  normalizeBaseUrl,
  requiresApiKey,
  parseIntent,
};
