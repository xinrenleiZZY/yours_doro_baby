/*
 * 题库服务（只在主进程运行）。
 *
 * 设计要点：
 * 1. 渲染进程的 CSP 是 default-src 'none'，不能直接联网，所以所有请求都走主进程；
 * 2. 答案只留在主进程，渲染进程拿到的是"无答案题面"，提交后由这里判卷，
 *    避免答案出现在页面上被随手改分；
 * 3. 拉到的整库题目会按科目缓存到 userData，接口临时不可用时仍可继续答题；
 * 4. 模拟考试会话落盘，应用重启后可以续考。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");

const DEFAULT_BASE_URL = "http://192.168.0.193:9300";
const DEFAULT_EXAM_CODE = "architect";
const REQUEST_TIMEOUT_MS = 10000;
const EXAMS_TTL_MS = 10 * 60 * 1000;
const POOL_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 40;
const MAX_CACHE_QUESTIONS = 800;
const MAX_STEM = 4000;
const MAX_EXPLANATION = 4000;
const EXAM_DURATION_MINUTES = 150;
const EXAM_QUESTION_COUNT = 75;
const EXAM_TOTAL_SCORE = 75;
const EXAM_PASS_SCORE = 45;

const EXAM_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const MODES = new Set(["daily", "quiz", "random", "event", "exam"]);

function errorWithCode(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string") return DEFAULT_BASE_URL;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) return DEFAULT_BASE_URL;
  return trimmed.slice(0, 200);
}

function normalizeExamCode(value) {
  const code = typeof value === "string" ? value.trim() : "";
  return EXAM_CODE_RE.test(code) ? code : DEFAULT_EXAM_CODE;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeOption(raw) {
  if (!raw || typeof raw !== "object") return null;
  const key = text(raw.key, 4).toUpperCase();
  const label = text(raw.text, 500);
  if (!key || !label) return null;
  return { key, text: label };
}

function normalizeChoice(value, optionKeys) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  const keys = [];
  for (const item of list) {
    const key = text(item, 4).toUpperCase();
    if (key && optionKeys.has(key) && !keys.includes(key)) keys.push(key);
  }
  return keys.sort();
}

/** 把接口返回的原始题目变成内部结构；客观题之外（案例题等）直接丢弃。 */
function normalizeQuestion(raw, fallbackExamCode) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "case") return null;

  const id = text(raw.id, 64);
  const stem = text(raw.stem, MAX_STEM);
  if (!id || !stem) return null;

  const options = Array.isArray(raw.options)
    ? raw.options.map(normalizeOption).filter(Boolean).slice(0, 10)
    : [];
  if (options.length < 2) return null;

  const optionKeys = new Set(options.map((item) => item.key));
  const answer = normalizeChoice(raw.answer, optionKeys);
  if (!answer.length) return null;

  const type = raw.type === "multiple" ? "multiple" : "single";
  const examCode = normalizeExamCode(raw.examCode || fallbackExamCode);
  const score = Number.isFinite(Number(raw.score)) ? Math.min(5, Math.max(1, Number(raw.score))) : 1;

  return {
    id,
    examCode,
    chapterId: text(raw.chapterId, 64),
    chapterName: text(raw.chapterName, 80),
    type,
    stem,
    options,
    difficulty: clampInt(raw.difficulty, 1, 5, 2),
    score,
    answer,
    explanation: text(raw.explanation, MAX_EXPLANATION),
  };
}

function publicQuestion(question) {
  return {
    id: question.id,
    examCode: question.examCode,
    chapterName: question.chapterName,
    type: question.type,
    stem: question.stem,
    options: question.options.map((item) => ({ key: item.key, text: item.text })),
    difficulty: question.difficulty,
    score: question.score,
  };
}

function normalizeExam(raw) {
  if (!raw || typeof raw !== "object") return null;
  const code = text(raw.code, 40);
  if (!EXAM_CODE_RE.test(code)) return null;
  const config = raw.examConfig && typeof raw.examConfig === "object" ? raw.examConfig : {};
  return {
    code,
    name: text(raw.name, 60) || code,
    shortName: text(raw.shortName, 30) || text(raw.name, 30) || code,
    category: text(raw.category, 30),
    description: text(raw.description, 160),
    questionCount: clampInt(raw.questionCount, 0, 100000, 0),
    examConfig: {
      durationMinutes: clampInt(config.durationMinutes, 1, 600, EXAM_DURATION_MINUTES),
      questionCount: clampInt(config.questionCount, 1, 300, EXAM_QUESTION_COUNT),
      totalScore: clampInt(config.totalScore, 1, 300, EXAM_TOTAL_SCORE),
      passScore: clampInt(config.passScore, 1, 300, EXAM_PASS_SCORE),
    },
  };
}

function requestJson(baseUrl, pathname, { apiKey, timeout = REQUEST_TIMEOUT_MS } = {}) {
  let url;
  try {
    url = new URL(baseUrl + pathname);
  } catch (err) {
    return Promise.reject(errorWithCode("INVALID_URL", "题库地址不合法"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(errorWithCode("INVALID_URL", "题库地址只支持 http/https"));
  }

  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json" };
    if (apiKey) headers["X-API-Key"] = apiKey;
    const req = lib.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        reject(errorWithCode("OFFLINE", "题库接口发生了重定向"));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(errorWithCode("OFFLINE", `题库接口返回 HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 16 * 1024 * 1024) {
          req.destroy();
          reject(errorWithCode("OFFLINE", "题库响应过大"));
        }
      });
      res.on("end", () => {
        try {
          const payload = JSON.parse(body);
          if (payload && payload.success === false) {
            reject(errorWithCode("OFFLINE", text(payload.message, 120) || "题库接口返回失败"));
            return;
          }
          resolve(payload);
        } catch (err) {
          reject(errorWithCode("OFFLINE", "题库响应不是合法 JSON"));
        }
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(errorWithCode("OFFLINE", "题库接口超时"));
    });
    req.on("error", (err) => {
      reject(errorWithCode("OFFLINE", err && err.message ? err.message : "题库接口连接失败"));
    });
  });
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sameChoice(a, b) {
  if (a.length !== b.length) return false;
  return a.every((key, index) => key === b[index]);
}

class QuizService {
  constructor({ cacheFile, examFile, log } = {}) {
    this.cacheFile = cacheFile;
    this.examFile = examFile;
    this.log = typeof log === "function" ? log : () => {};
    this.baseUrl = DEFAULT_BASE_URL;
    this.apiKey = "";
    this.cache = { version: 1, baseUrl: "", examsAt: 0, exams: [], pools: {} };
    this.sessions = new Map();
    this.loadCache();
    this.loadExamSession();
  }

  configure({ baseUrl, apiKey } = {}) {
    const next = normalizeBaseUrl(baseUrl);
    const changed = next !== this.baseUrl;
    this.baseUrl = next;
    this.apiKey = typeof apiKey === "string" ? apiKey.slice(0, 200) : "";
    if (changed) {
      this.cache.examsAt = 0;
      for (const pool of Object.values(this.cache.pools)) pool.at = 0;
    }
    return this.status();
  }

  status() {
    return {
      baseUrl: this.baseUrl,
      examsCached: this.cache.exams.length,
      poolSize: Object.values(this.cache.pools).reduce((sum, item) => sum + (item.questions || []).length, 0),
    };
  }

  loadCache() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.cacheFile, "utf8"));
      if (!raw || typeof raw !== "object") return;
      this.cache = {
        version: 1,
        baseUrl: normalizeBaseUrl(raw.baseUrl || DEFAULT_BASE_URL),
        examsAt: Number(raw.examsAt) || 0,
        exams: Array.isArray(raw.exams) ? raw.exams.map(normalizeExam).filter(Boolean) : [],
        pools: {},
      };
      if (raw.pools && typeof raw.pools === "object") {
        for (const [code, pool] of Object.entries(raw.pools)) {
          if (!EXAM_CODE_RE.test(code) || !pool || !Array.isArray(pool.questions)) continue;
          this.cache.pools[code] = {
            at: Number(pool.at) || 0,
            questions: pool.questions
              .map((item) => normalizeQuestion(item, code))
              .filter(Boolean)
              .slice(0, MAX_CACHE_QUESTIONS),
          };
        }
      }
      this.baseUrl = this.cache.baseUrl || this.baseUrl;
    } catch (err) {
      if (err.code !== "ENOENT") this.log("warn", "读取题库缓存失败", err.message);
    }
  }

  saveCache() {
    const payload = JSON.stringify({
      version: 1,
      baseUrl: this.baseUrl,
      examsAt: this.cache.examsAt,
      exams: this.cache.exams,
      pools: this.cache.pools,
    });
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmp = `${this.cacheFile}.tmp`;
      fs.writeFileSync(tmp, payload, "utf8");
      fs.renameSync(tmp, this.cacheFile);
    } catch (err) {
      this.log("warn", "写入题库缓存失败", err.message);
    }
  }

  loadExamSession() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.examFile, "utf8"));
      if (!raw || !raw.token || !Array.isArray(raw.questions)) return;
      const questions = raw.questions.map((item) => normalizeQuestion(item, raw.examCode)).filter(Boolean);
      if (!questions.length) return;
      this.sessions.set(raw.token, {
        token: raw.token,
        mode: "exam",
        examCode: normalizeExamCode(raw.examCode),
        createdAt: Number(raw.createdAt) || Date.now(),
        expiresAt: Number(raw.expiresAt) || 0,
        endsAt: Number(raw.endsAt) || 0,
        questions,
        graded: false,
        answered: new Set(),
      });
      this.activeExamToken = raw.token;
    } catch (err) {
      if (err.code !== "ENOENT") this.log("warn", "读取模拟考试进度失败", err.message);
    }
  }

  saveExamSession(session) {
    try {
      if (!session) {
        if (fs.existsSync(this.examFile)) fs.unlinkSync(this.examFile);
        return;
      }
      fs.mkdirSync(path.dirname(this.examFile), { recursive: true });
      const tmp = `${this.examFile}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          token: session.token,
          examCode: session.examCode,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          endsAt: session.endsAt,
          questions: session.questions,
        }),
        "utf8"
      );
      fs.renameSync(tmp, this.examFile);
    } catch (err) {
      this.log("warn", "写入模拟考试进度失败", err.message);
    }
  }

  async listExams({ force = false } = {}) {
    const fresh = Date.now() - this.cache.examsAt < EXAMS_TTL_MS;
    if (!force && fresh && this.cache.exams.length) {
      return { exams: this.cache.exams, cached: true, baseUrl: this.baseUrl };
    }
    try {
      const payload = await requestJson(this.baseUrl, "/api/v1/exams", { apiKey: this.apiKey });
      const rows = Array.isArray(payload.data)
        ? payload.data
        : payload.data && Array.isArray(payload.data.exams)
          ? payload.data.exams
          : [];
      const exams = rows.map(normalizeExam).filter(Boolean);
      if (!exams.length) throw errorWithCode("OFFLINE", "题库没有返回科目");
      this.cache.exams = exams;
      this.cache.examsAt = Date.now();
      this.saveCache();
      return { exams, cached: false, baseUrl: this.baseUrl };
    } catch (err) {
      if (this.cache.exams.length) {
        this.log("warn", "题库科目接口不可用，使用缓存", err.message);
        return { exams: this.cache.exams, cached: true, baseUrl: this.baseUrl, error: err.code || "OFFLINE" };
      }
      throw err;
    }
  }

  async syncPool(examCode, { force = false } = {}) {
    const code = normalizeExamCode(examCode);
    const cached = this.cache.pools[code];
    const fresh = cached && Date.now() - cached.at < POOL_TTL_MS;
    if (!force && fresh && cached.questions.length) {
      return { questions: cached.questions, cached: true };
    }
    try {
      const payload = await requestJson(
        this.baseUrl,
        `/api/v1/exams/${encodeURIComponent(code)}/questions/all`,
        { apiKey: this.apiKey, timeout: 20000 }
      );
      const rows = Array.isArray(payload.data)
        ? payload.data
        : payload.data && Array.isArray(payload.data.questions)
          ? payload.data.questions
          : [];
      const questions = rows
        .map((item) => normalizeQuestion(item, code))
        .filter(Boolean)
        .slice(0, MAX_CACHE_QUESTIONS);
      if (!questions.length) throw errorWithCode("OFFLINE", "题库没有返回可用题目");
      this.cache.pools[code] = { at: Date.now(), questions };
      this.saveCache();
      return { questions, cached: false };
    } catch (err) {
      if (cached && cached.questions.length) {
        this.log("warn", "题库题目接口不可用，使用缓存", err.message);
        return { questions: cached.questions, cached: true, error: err.code || "OFFLINE" };
      }
      throw err;
    }
  }

  examConfig(examCode) {
    const code = normalizeExamCode(examCode);
    const exam = this.cache.exams.find((item) => item.code === code);
    return exam
      ? exam.examConfig
      : {
          durationMinutes: EXAM_DURATION_MINUTES,
          questionCount: EXAM_QUESTION_COUNT,
          totalScore: EXAM_TOTAL_SCORE,
          passScore: EXAM_PASS_SCORE,
        };
  }

  /** 清理过期会话，避免内存与 tokens 无限增长。 */
  pruneSessions() {
    const now = Date.now();
    for (const [token, session] of this.sessions) {
      const expired =
        session.mode === "exam"
          ? session.expiresAt > 0 && now > session.expiresAt
          : now - session.createdAt > SESSION_TTL_MS;
      if (expired && !this.activeExamToken) this.sessions.delete(token);
    }
    if (this.sessions.size > MAX_SESSIONS) {
      const sorted = [...this.sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
      while (sorted.length > MAX_SESSIONS) {
        const [token] = sorted.shift();
        this.sessions.delete(token);
      }
    }
  }

  async createSession({ mode, examCode, count } = {}) {
    const normalizedMode = MODES.has(mode) ? mode : "random";
    const code = normalizeExamCode(examCode);
    const config = this.examConfig(code);
    if (normalizedMode === "exam") this.pruneSessions();

    const amount =
      normalizedMode === "exam"
        ? config.questionCount
        : clampInt(count, 1, normalizedMode === "quiz" ? 10 : 1, 1);

    const pool = await this.syncPool(code);
    if (pool.questions.length < amount) {
      throw errorWithCode(
        "INSUFFICIENT",
        `题库里只有 ${pool.questions.length} 道可用题目，凑不够 ${amount} 道`
      );
    }

    const picked = shuffle(pool.questions).slice(0, amount);
    const token = crypto.randomUUID();
    const now = Date.now();
    const session = {
      token,
      mode: normalizedMode,
      examCode: code,
      createdAt: now,
      expiresAt:
        normalizedMode === "exam" ? now + (config.durationMinutes + 30) * 60 * 1000 : now + SESSION_TTL_MS,
      endsAt: normalizedMode === "exam" ? now + config.durationMinutes * 60 * 1000 : 0,
      questions: picked,
      graded: false,
      answered: new Set(),
    };
    this.sessions.set(token, session);
    this.pruneSessions();

    if (normalizedMode === "exam") {
      this.activeExamToken = token;
      this.saveExamSession(session);
    }

    this.log("info", "创建答题会话", `${normalizedMode}/${code}/${amount}`);

    return {
      token,
      mode: normalizedMode,
      examCode: code,
      questions: picked.map(publicQuestion),
      startedAt: now,
      endsAt: session.endsAt,
      durationMinutes: normalizedMode === "exam" ? config.durationMinutes : 0,
      questionCount: picked.length,
      totalScore: picked.reduce((sum, item) => sum + item.score, 0),
      passScore: config.passScore,
      cached: Boolean(pool.cached),
    };
  }

  grade(token, answers) {
    const session = this.sessions.get(String(token || ""));
    if (!session) throw errorWithCode("NO_SESSION", "答题会话已失效，请重新开始");
    if (session.graded) throw errorWithCode("ALREADY_GRADED", "这份答卷已经判过了");

    const submitted = answers && typeof answers === "object" ? answers : {};
    const results = [];
    let correct = 0;
    let score = 0;
    let totalScore = 0;

    for (const question of session.questions) {
      const optionKeys = new Set(question.options.map((item) => item.key));
      const chosen = normalizeChoice(submitted[question.id], optionKeys);
      const isCorrect = sameChoice(chosen, question.answer);
      totalScore += question.score;
      if (isCorrect) {
        correct += 1;
        score += question.score;
      }
      results.push({
        id: question.id,
        correct: isCorrect,
        chosen,
        answer: question.answer,
        explanation: question.explanation,
      });
    }

    const expired = session.mode === "exam" && Date.now() > session.endsAt;
    const config = this.examConfig(session.examCode);
    const result = {
      token: session.token,
      mode: session.mode,
      examCode: session.examCode,
      total: session.questions.length,
      correct,
      wrong: session.questions.length - correct,
      score,
      totalScore: session.mode === "exam" ? Math.max(config.totalScore, totalScore) : totalScore,
      passScore: config.passScore,
      passed: session.mode === "exam" ? score >= config.passScore : correct === session.questions.length,
      expired,
      results,
    };

    session.graded = true;
    session.result = result;
    if (session.mode === "exam") {
      this.activeExamToken = null;
      this.saveExamSession(null);
    }
    this.log("info", "答题判卷", `${result.mode}/${correct}/${result.total}`);
    return result;
  }

  /** 练习模式单题判卷：不结束会话，便于随堂小测逐题作答。 */
  gradeAnswer(token, questionId, value) {
    const session = this.sessions.get(String(token || ""));
    if (!session) throw errorWithCode("NO_SESSION", "答题会话已失效，请重新开始");
    if (session.mode === "exam") throw errorWithCode("EXAM_ONLY", "模拟考试请整卷提交");
    const question = session.questions.find((item) => item.id === String(questionId || ""));
    if (!question) throw errorWithCode("NO_QUESTION", "这道题不属于当前会话");
    if (session.answered.has(question.id)) throw errorWithCode("ALREADY_GRADED", "这道题已经答过了");
    session.answered.add(question.id);
    const optionKeys = new Set(question.options.map((item) => item.key));
    const chosen = normalizeChoice(value, optionKeys);
    return {
      id: question.id,
      correct: sameChoice(chosen, question.answer),
      chosen,
      answer: question.answer,
      explanation: question.explanation,
    };
  }

  activeExam() {
    if (!this.activeExamToken) return null;
    const session = this.sessions.get(this.activeExamToken);
    if (!session || session.graded) return null;
    // 考试结束 30 分钟后仍未提交，视为作废，避免永远卡在续考里
    if (session.expiresAt > 0 && Date.now() > session.expiresAt) {
      this.sessions.delete(session.token);
      this.activeExamToken = null;
      this.saveExamSession(null);
      return null;
    }
    return session;
  }

  examStatus() {
    const session = this.activeExam();
    if (!session) return { active: false };
    return {
      active: true,
      token: session.token,
      examCode: session.examCode,
      startedAt: session.createdAt,
      endsAt: session.endsAt,
      remainingMs: Math.max(0, session.endsAt - Date.now()),
      questionCount: session.questions.length,
      answeredCount: 0,
    };
  }

  resumeExam() {
    const session = this.activeExam();
    if (!session) throw errorWithCode("NO_EXAM", "没有进行中的模拟考试");
    return {
      token: session.token,
      mode: "exam",
      examCode: session.examCode,
      questions: session.questions.map(publicQuestion),
      startedAt: session.createdAt,
      endsAt: session.endsAt,
      durationMinutes: this.examConfig(session.examCode).durationMinutes,
      questionCount: session.questions.length,
      totalScore: this.examConfig(session.examCode).totalScore,
      passScore: this.examConfig(session.examCode).passScore,
      cached: true,
    };
  }

  abandonExam() {
    const session = this.activeExam();
    if (!session) return false;
    this.sessions.delete(session.token);
    this.activeExamToken = null;
    this.saveExamSession(null);
    this.log("info", "放弃模拟考试");
    return true;
  }
}

module.exports = {
  QuizService,
  DEFAULT_BASE_URL,
  DEFAULT_EXAM_CODE,
  EXAM_DURATION_MINUTES,
  EXAM_QUESTION_COUNT,
  normalizeBaseUrl,
  normalizeExamCode,
  normalizeQuestion,
  publicQuestion,
  sameChoice,
  normalizeChoice,
  shuffle,
};
