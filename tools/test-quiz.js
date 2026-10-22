/* 题库答题规则与存档兼容的单元测试：node tools/test-quiz.js */
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
const DAY = 24 * 3600 * 1000;

function fresh(extra) {
  return G.hydrate(Object.assign({ coins: 0 }, extra || {}), NOW);
}

console.log("doro 题库规则测试");

test("新档自带题库默认配置", () => {
  const state = fresh();
  assert.strictEqual(state.quiz.examCode, "architect");
  assert.strictEqual(state.quiz.dailyDone, false);
  assert.ok(state.quiz.eventReadyAt > NOW);
  assert.deepStrictEqual(state.quiz.totals, { answered: 0, correct: 0, wrong: 0, earned: 0, spent: 0 });
});

test("每日一题：答对 +100，答错不扣", () => {
  const state = fresh();
  const ok = G.completeQuiz(state, { mode: "daily", correct: 1, wrong: 0, now: NOW });
  assert.strictEqual(ok.delta, 100);
  assert.strictEqual(state.coins, 100);
  assert.strictEqual(state.quiz.dailyDone, true);
  assert.strictEqual(G.quizDailyStatus(state, NOW).available, false);

  const bad = fresh({ coins: 50 });
  const res = G.completeQuiz(bad, { mode: "daily", correct: 0, wrong: 1, now: NOW });
  assert.strictEqual(res.delta, 0);
  assert.strictEqual(bad.coins, 50);
});

test("随堂小测：答对 +100 / 答错 -10", () => {
  const state = fresh({ coins: 200 });
  const res = G.completeQuiz(state, { mode: "quiz", correct: 7, wrong: 3, now: NOW });
  assert.strictEqual(res.delta, 7 * 100 - 3 * 10);
  assert.strictEqual(state.coins, 200 + 670);
  assert.strictEqual(state.quiz.totals.answered, 10);
  assert.strictEqual(state.quiz.totals.correct, 7);
});

test("随机刷题：答对 +100 / 答错 -10，且不会把金币扣成负数", () => {
  const state = fresh({ coins: 5 });
  const res = G.completeQuiz(state, { mode: "random", correct: 0, wrong: 1, now: NOW });
  assert.strictEqual(res.delta, -5);
  assert.strictEqual(state.coins, 0);
});

test("答题事件：答对 +100 / 答错不扣，并进入冷却", () => {
  const state = fresh();
  state.quiz.eventReadyAt = NOW;
  const res = G.completeQuiz(state, { mode: "event", correct: 1, wrong: 0, now: NOW });
  assert.strictEqual(res.delta, 100);
  assert.ok(state.quiz.eventReadyAt > NOW);
  assert.strictEqual(G.quizEventStatus(state, NOW).available, false);
  assert.strictEqual(G.quizEventStatus(state, state.quiz.eventReadyAt).available, true);
});

test("模拟考试只记录成绩，不发金币", () => {
  const state = fresh({ coins: 10 });
  const res = G.completeQuiz(state, {
    mode: "exam",
    correct: 60,
    wrong: 15,
    now: NOW,
    exam: { score: 60, passed: true },
  });
  assert.strictEqual(res.delta, 0);
  assert.strictEqual(state.coins, 10);
  assert.strictEqual(state.quiz.exam.taken, 1);
  assert.strictEqual(state.quiz.exam.lastScore, 60);
  assert.strictEqual(state.quiz.exam.bestScore, 60);
  assert.strictEqual(state.quiz.exam.lastPassed, true);
});

test("跨天后每日一题自动重置", () => {
  const state = fresh();
  G.completeQuiz(state, { mode: "daily", correct: 1, wrong: 0, now: NOW });
  assert.strictEqual(state.quiz.dailyDone, true);
  const nextDay = G.quizDailyStatus(state, NOW + DAY);
  assert.strictEqual(nextDay.available, true);
  assert.strictEqual(nextDay.done, false);
});

test("答题历史最多保留 20 条", () => {
  const state = fresh();
  for (let i = 0; i < 25; i += 1) {
    G.completeQuiz(state, { mode: "random", correct: 1, wrong: 0, now: NOW + i });
  }
  assert.strictEqual(state.quiz.history.length, 20);
  assert.strictEqual(state.quiz.history[19].at, NOW + 24);
});

test("存档清洗保留题库字段并纠正非法值", () => {
  const clean = sanitizeSave({
    coins: 30,
    quiz: {
      examCode: "../../etc/passwd",
      dailyDate: "2026-10-21",
      dailyDone: true,
      eventReadyAt: NOW,
      totals: { answered: 12, correct: 9, wrong: 3, earned: 900, spent: 30 },
      exam: { taken: 2, bestScore: 66, lastScore: 60, lastPassed: true },
      history: [{ at: NOW, mode: "exam", correct: 60, total: 75, delta: 0 }],
    },
    settings: {
      quizApiBase: "http://192.168.0.193:9300",
      updateFeedUrl: "http://192.168.0.193:9400/updates",
      updateAutoCheck: false,
    },
  });
  assert.strictEqual(clean.quiz.examCode, "architect");
  assert.strictEqual(clean.quiz.dailyDone, true);
  assert.strictEqual(clean.quiz.totals.answered, 12);
  assert.strictEqual(clean.quiz.exam.bestScore, 66);
  assert.strictEqual(clean.quiz.history.length, 1);
  assert.strictEqual(clean.settings.quizApiBase, "http://192.168.0.193:9300");
  assert.strictEqual(clean.settings.updateAutoCheck, false);
});

test("非法题库地址会回落到默认值", () => {
  const clean = sanitizeSave({ coins: 0, settings: { quizApiBase: "ftp://x", updateFeedUrl: "not-a-url" } });
  assert.strictEqual(clean.settings.quizApiBase, "http://192.168.0.193:9300");
  assert.strictEqual(clean.settings.updateFeedUrl, "http://192.168.0.193:9400/updates");
});

console.log(`\n通过 ${passed} / ${passed + failures.length}`);
if (failures.length) {
  for (const item of failures) console.error(item.err && item.err.stack);
  process.exit(1);
}
