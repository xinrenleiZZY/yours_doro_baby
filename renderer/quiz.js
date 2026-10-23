/*
 * 题库面板（渲染进程）。
 *
 * 五类玩法共用同一个会话协议：
 *   daily  每日一题（1 题，答对 +10000，答错 0）
 *   quiz   随堂小测（10 题，答对 +10000，答错 -100）
 *   random 随机刷题（1 题，答对 +10000，答错 -100）
 *   event  随机事件题（1 题，答对 +10000，答错 0）
 *   exam   模拟考试（75 题 / 150 分钟，不计金币）
 *
 * 题面来自主进程（不含答案），单题判卷与整卷判卷也都由主进程完成。
 */
(function () {
  "use strict";

  const G = window.DoroGame;
  const MODE_INFO = {
    daily: { title: "每日一题", reward: "答对 +10000 · 答错不扣" },
    quiz: { title: "随堂小测", reward: "10 题 · 答对 +10000 · 答错 -100" },
    random: { title: "随机刷题", reward: "1 题 · 答对 +10000 · 答错 -100" },
    event: { title: "答题事件", reward: "答对 +10000 · 答错不扣" },
    exam: { title: "模拟考试", reward: "75 题 · 150 分钟 · 不计金币" },
  };

  let hooks = null;
  let root = null;
  let bodyEl = null;
  let subtitleEl = null;
  let coinsEl = null;
  let exams = null;
  let examsError = "";
  let loadingExams = false;
  let loadingStart = false;
  let session = null;
  let timerId = null;
  let submitting = false;
  let confirmSubmit = false;

  function $(id) {
    return document.getElementById(id);
  }

  function h(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function state() {
    return hooks && hooks.getState ? hooks.getState() : null;
  }

  function toast(message) {
    if (hooks && hooks.toast) hooks.toast(message);
  }

  function saveSoon(delay) {
    if (hooks && hooks.save) hooks.save(delay || 800);
  }

  function updateHud() {
    if (hooks && hooks.updateHud) hooks.updateHud();
  }

  function currentExamCode() {
    const s = state();
    return (s && s.quiz && s.quiz.examCode) || "architect";
  }

  function examName(code) {
    if (!exams) return code;
    const exam = exams.find((item) => item.code === code);
    return exam ? exam.name : code;
  }

  function modeOfSession() {
    return session ? session.mode : "random";
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function setWide(wide) {
    root.classList.toggle("wide", Boolean(wide));
    if (hooks && hooks.setUiSize) {
      hooks.setUiSize(wide ? { width: 880, height: 680 } : { width: 640, height: 560 });
    }
  }

  function setHeader() {
    if (!subtitleEl || !coinsEl) return;
    const s = state();
    subtitleEl.textContent = session ? MODE_INFO[modeOfSession()].title : examName(currentExamCode());
    coinsEl.textContent = s ? `${G.formatCoins(s.coins)} 金币` : "";
  }

  function clearBody() {
    while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
    confirmSubmit = false;
  }

  // ------------------------------------------------------------------ 首页
  function renderHome() {
    if (!bodyEl) return;
    stopTimer();
    session = null;
    setWide(false);
    clearBody();
    setHeader();

    const s = state();
    if (!s) return;

    // 题库科目选择
    const bankRow = h("div", "quiz-bank-row");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "选择题库科目");
    const list = exams && exams.length ? exams : [{ code: currentExamCode(), name: currentExamCode() }];
    list.forEach((exam) => {
      const option = document.createElement("option");
      option.value = exam.code;
      option.textContent = `${exam.name}${exam.questionCount ? `（${exam.questionCount} 题）` : ""}`;
      if (exam.code === currentExamCode()) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener("change", () => {
      if (!s.quiz) return;
      s.quiz.examCode = select.value;
      saveSoon(400);
      setHeader();
      if (hooks && hooks.updateMenu) hooks.updateMenu();
    });
    const refreshBtn = h("button", "", loadingExams ? "同步中…" : "刷新");
    refreshBtn.disabled = loadingExams;
    refreshBtn.addEventListener("click", () => loadExams(true));
    bankRow.append(select, refreshBtn);
    bodyEl.appendChild(bankRow);

    if (examsError) {
      bodyEl.appendChild(h("div", "quiz-empty", examsError));
    }

    // 统计
    const totals = s.quiz.totals;
    const accuracy = totals.answered ? Math.round((totals.correct / totals.answered) * 100) : 0;
    const stats = h("div", "quiz-stats");
    [
      ["已答", String(totals.answered)],
      ["正确率", `${accuracy}%`],
      ["答题收益", G.formatCoins(totals.earned)],
    ].forEach(([label, value]) => {
      const cell = h("div", "quiz-stat");
      cell.append(h("b", "", value), h("span", "", label));
      stats.appendChild(cell);
    });
    bodyEl.appendChild(stats);

    // 五种玩法
    const daily = G.quizDailyStatus(s, Date.now());
    const event = G.quizEventStatus(s, Date.now());
    const modes = h("div", "quiz-modes");

    const modeDefs = [
      [
        "daily",
        "每日一题",
        daily.done ? (daily.correct ? "今天已答对 ✓" : "今天已答过") : "每天一次 · 答对 +10000",
        !daily.available,
      ],
      ["quiz", "随堂小测", "一次 10 题 · 答对 +10000 / 答错 -100", false],
      ["random", "随机刷题", "随机 1 题 · 答对 +10000 / 答错 -100", false],
      [
        "event",
        "答题事件",
        event.available
          ? "事件已就绪 · 答对 +10000"
          : `冷却中 · 约 ${Math.ceil(event.remainingMs / 60000)} 分钟后`,
        !event.available,
      ],
      ["exam", "模拟考试", "75 题 · 150 分钟 · 不计金币", false],
    ];
    modeDefs.forEach(([mode, title, desc, disabled]) => {
      const button = h("button", "quiz-mode");
      button.type = "button";
      button.disabled = disabled;
      const left = h("div");
      left.append(h("b", "", title), h("small", "", desc));
      const badge = h("em", "", mode === "exam" ? "75 题" : disabled ? "—" : "开始");
      button.append(left, badge);
      button.addEventListener("click", () => startMode(mode));
      modes.appendChild(button);
    });
    bodyEl.appendChild(modes);

    // 最近答题记录
    if (s.quiz.history.length) {
      const recent = h("div", "quiz-empty");
      const last = s.quiz.history.slice(-3).reverse();
      last.forEach((item) => {
        const row = h(
          "div",
          "",
          `${MODE_INFO[item.mode].title}：${item.correct}/${item.total}　${item.delta >= 0 ? "+" : ""}${item.delta} 金币`
        );
        recent.appendChild(row);
      });
      bodyEl.appendChild(recent);
    }
  }

  async function loadExams(force) {
    if (!hooks || loadingExams) return;
    loadingExams = true;
    examsError = "";
    renderHome();
    const res = await hooks.api.quizExams({ force: Boolean(force) });
    loadingExams = false;
    if (res && res.error) {
      examsError = res.message || "题库服务暂不可用，稍后会自动重试";
    } else if (res && Array.isArray(res.exams)) {
      exams = res.exams;
      if (res.cached && res.error) examsError = "题库服务暂时离线，正在使用本地缓存";
    }
    if (root.classList.contains("show") && !session) renderHome();
  }

  // -------------------------------------------------------------- 开始答题
  async function startMode(mode) {
    if (!hooks || loadingStart) return;
    const s = state();
    if (!s) return;

    if (mode === "daily" && !G.quizDailyStatus(s, Date.now()).available) {
      toast("今天的每日一题已经答过啦");
      return;
    }
    if (mode === "event" && !G.quizEventStatus(s, Date.now()).available) {
      toast("答题事件还在冷却中");
      return;
    }

    if (mode === "exam") {
      const active = await hooks.api.quizExamStatus();
      if (active && active.active) {
        await resumeExam(active);
        return;
      }
    }

    loadingStart = true;
    clearBody();
    bodyEl.appendChild(h("div", "quiz-empty", "正在从题库取题…"));
    const payload = {
      mode,
      examCode: currentExamCode(),
      count: mode === "quiz" ? 10 : mode === "exam" ? 0 : 1,
    };
    const res = await hooks.api.quizCreate(payload);
    loadingStart = false;

    if (!res || res.error) {
      clearBody();
      bodyEl.appendChild(h("div", "quiz-empty", (res && res.message) || "取题失败，请检查题库服务"));
      const back = h("button", "quiz-btn ghost", "返回");
      back.addEventListener("click", renderHome);
      bodyEl.appendChild(back);
      if (hooks.speak) hooks.speak("题库好像没连上…", 2200);
      return;
    }

    session = {
      token: res.token,
      mode: res.mode,
      examCode: res.examCode,
      questions: res.questions,
      index: 0,
      answers: {},
      results: [],
      gradedIds: {},
      delta: 0,
      startedAt: res.startedAt,
      endsAt: res.endsAt,
      totalScore: res.totalScore,
      passScore: res.passScore,
      durationMinutes: res.durationMinutes,
      submitted: false,
    };
    if (mode === "exam") {
      setWide(true);
      startTimer();
    }
    renderQuestion();
  }

  async function resumeExam(active) {
    const res = await hooks.api.quizExamResume();
    if (!res || res.error) {
      toast("没有可以继续的模拟考试");
      return;
    }
    session = {
      token: res.token,
      mode: "exam",
      examCode: res.examCode,
      questions: res.questions,
      index: 0,
      answers: {},
      results: [],
      gradedIds: {},
      delta: 0,
      startedAt: res.startedAt,
      endsAt: res.endsAt,
      totalScore: res.totalScore,
      passScore: res.passScore,
      durationMinutes: res.durationMinutes,
      submitted: false,
    };
    setWide(true);
    startTimer();
    renderQuestion();
    toast("继续上次的模拟考试");
    if (active && active.remainingMs === 0) submitExam(true);
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      if (!session || session.mode !== "exam" || session.submitted) return;
      const remaining = session.endsAt - Date.now();
      const node = $("quiz-timer-node");
      if (node) {
        node.textContent = formatTime(Math.max(0, remaining));
        node.classList.toggle("urgent", remaining <= 5 * 60 * 1000);
      }
      if (remaining <= 0) {
        stopTimer();
        submitExam(true);
      }
    }, 1000);
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  // ------------------------------------------------------------------ 答题
  function renderQuestion() {
    if (!session || !bodyEl) return;
    clearBody();
    setHeader();
    const question = session.questions[session.index];
    if (!question) {
      finishPractice();
      return;
    }
    const chosen = session.answers[question.id] || [];
    const feedback = session.feedback && session.feedback.id === question.id ? session.feedback : null;

    // 进度 / 计时
    const progress = h("div", "quiz-progress");
    const left = h(
      "span",
      "",
      `第 ${session.index + 1} / ${session.questions.length} 题 · ${question.type === "multiple" ? "多选" : "单选"}`
    );
    progress.appendChild(left);
    if (session.mode === "exam") {
      const timer = h("span", "quiz-timer", formatTime(session.endsAt - Date.now()));
      timer.id = "quiz-timer-node";
      progress.appendChild(timer);
    } else if (question.chapterName) {
      progress.appendChild(h("span", "", question.chapterName.slice(0, 16)));
    }
    bodyEl.appendChild(progress);

    // 题干
    bodyEl.appendChild(h("div", "quiz-stem", question.stem));

    // 选项
    const options = h("div", "quiz-options");
    const answerKeys = feedback ? feedback.answer : [];
    question.options.forEach((option) => {
      const button = h("button", "quiz-option");
      button.type = "button";
      const selected = chosen.includes(option.key);
      button.classList.toggle("selected", selected && !feedback);
      if (feedback) {
        if (answerKeys.includes(option.key)) button.classList.add("correct");
        else if (selected) button.classList.add("wrong");
        button.disabled = true;
      }
      button.append(h("b", "", option.key), h("span", "", option.text));
      button.addEventListener("click", () => chooseOption(question, option.key));
      options.appendChild(button);
    });
    bodyEl.appendChild(options);

    // 反馈
    if (feedback) {
      const box = h("div", `quiz-feedback ${feedback.correct ? "ok" : "bad"}`);
      box.appendChild(
        h("div", "", feedback.correct ? "回答正确 ✓" : `回答错误 ✗ 正确答案：${feedback.answer.join("")}`)
      );
      if (feedback.explanation) box.appendChild(h("div", "quiz-explain", feedback.explanation));
      bodyEl.appendChild(box);
    }

    // 操作区
    const actions = h("div", "quiz-actions");
    if (session.mode === "exam") {
      const prev = h("button", "quiz-btn ghost", "上一题");
      prev.disabled = session.index === 0;
      prev.addEventListener("click", () => {
        if (session.index > 0) {
          session.index -= 1;
          renderQuestion();
        }
      });
      const next = h("button", "quiz-btn ghost", "下一题");
      next.disabled = session.index >= session.questions.length - 1;
      next.addEventListener("click", () => {
        if (session.index < session.questions.length - 1) {
          session.index += 1;
          renderQuestion();
        }
      });
      const submit = h("button", "quiz-btn", confirmSubmit ? "再点一次确认交卷" : "交卷");
      submit.addEventListener("click", () => {
        if (!confirmSubmit) {
          confirmSubmit = true;
          renderQuestion();
          return;
        }
        submitExam(false);
      });
      actions.append(prev, next, submit);
      bodyEl.appendChild(actions);

      // 答题卡
      const palette = h("div", "quiz-palette");
      session.questions.forEach((item, index) => {
        const cell = h("button", "", String(index + 1));
        cell.classList.toggle(
          "answered",
          Boolean(session.answers[item.id] && session.answers[item.id].length)
        );
        cell.classList.toggle("current", index === session.index);
        cell.addEventListener("click", () => {
          session.index = index;
          renderQuestion();
        });
        palette.appendChild(cell);
      });
      bodyEl.appendChild(palette);
      return;
    }

    if (!feedback) {
      const submit = h("button", "quiz-btn", "提交答案");
      submit.disabled = !chosen.length;
      submit.addEventListener("click", submitPractice);
      actions.appendChild(submit);
    } else {
      const next = h(
        "button",
        "quiz-btn",
        session.index + 1 >= session.questions.length ? "查看结果" : "下一题"
      );
      next.addEventListener("click", () => {
        session.feedback = null;
        if (session.index + 1 >= session.questions.length) {
          finishPractice();
        } else {
          session.index += 1;
          renderQuestion();
        }
      });
      actions.appendChild(next);
    }
    bodyEl.appendChild(actions);
  }

  function chooseOption(question, key) {
    if (!session || session.submitted) return;
    const feedback = session.feedback && session.feedback.id === question.id;
    if (feedback) return;
    if (session.mode === "exam") {
      if (question.type === "multiple") {
        const list = new Set(session.answers[question.id] || []);
        if (list.has(key)) list.delete(key);
        else list.add(key);
        session.answers[question.id] = [...list].sort();
      } else {
        session.answers[question.id] = [key];
      }
      renderQuestion();
      return;
    }
    if (question.type === "multiple") {
      const list = new Set(session.answers[question.id] || []);
      if (list.has(key)) list.delete(key);
      else list.add(key);
      session.answers[question.id] = [...list].sort();
    } else {
      session.answers[question.id] = [key];
    }
    renderQuestion();
  }

  async function submitPractice() {
    if (!session || session.mode === "exam") return;
    const question = session.questions[session.index];
    const choice = session.answers[question.id] || [];
    if (!choice.length) return;
    if (session.gradedIds[question.id]) return;
    session.gradedIds[question.id] = true;

    const result = await hooks.api.quizAnswer({
      token: session.token,
      questionId: question.id,
      choice,
    });
    if (!result || result.error) {
      delete session.gradedIds[question.id];
      toast((result && result.message) || "判卷失败，请重试");
      return;
    }
    session.feedback = result;
    const correct = result.correct ? 1 : 0;
    const reward = G.completeQuiz(state(), {
      mode: session.mode,
      correct,
      wrong: result.correct ? 0 : 1,
      now: Date.now(),
    });
    session.delta += reward.delta;
    session.results.push(result);
    updateHud();
    saveSoon(700);
    setHeader();

    if (result.correct) {
      if (hooks.playSound) hooks.playSound("coin");
      if (hooks.floatText) hooks.floatText(`+${reward.delta}`, { x: 170, y: 170 });
      if (hooks.speak) hooks.speak("答对啦！", 1800);
    } else if (hooks.speak) {
      hooks.speak("这题有点难…", 1800);
    }
    renderQuestion();
  }

  function finishPractice() {
    if (!session) return;
    stopTimer();
    const total = session.results.length;
    const correct = session.results.filter((item) => item.correct).length;
    const delta = session.delta;
    clearBody();
    setHeader();

    const box = h("div", "quiz-result");
    box.appendChild(h("div", "score", `${correct} / ${total}`));
    box.appendChild(
      h("div", "sub", `${MODE_INFO[modeOfSession()].title} · 金币 ${delta >= 0 ? "+" : ""}${delta}`)
    );
    bodyEl.appendChild(box);

    const wrongs = session.results.filter((item) => !item.correct);
    if (wrongs.length) {
      const list = h("div", "quiz-wrong-list");
      wrongs.forEach((item) => {
        const question = session.questions.find((q) => q.id === item.id);
        const row = h("div", "quiz-wrong-item");
        row.appendChild(h("div", "", `正确答案：${item.answer.join("")}`));
        if (item.explanation) row.appendChild(h("div", "quiz-explain", item.explanation));
        if (question) row.appendChild(h("div", "quiz-explain", question.stem.slice(0, 90)));
        list.appendChild(row);
      });
      bodyEl.appendChild(list);
    }

    const actions = h("div", "quiz-actions");
    const home = h("button", "quiz-btn ghost", "返回题库");
    home.addEventListener("click", renderHome);
    const again = h("button", "quiz-btn", "再来一次");
    again.addEventListener("click", () => {
      const mode = modeOfSession();
      session = null;
      renderHome();
      startMode(mode);
    });
    if (modeOfSession() === "daily" || modeOfSession() === "event") {
      actions.appendChild(home);
    } else {
      actions.append(again, home);
    }
    bodyEl.appendChild(actions);
    if (hooks.updateMenu) hooks.updateMenu();
  }

  // -------------------------------------------------------------- 模拟考试
  async function submitExam(auto) {
    if (!session || session.mode !== "exam" || session.submitted || submitting) return;
    submitting = true;
    stopTimer();
    session.submitted = true;
    clearBody();
    bodyEl.appendChild(h("div", "quiz-empty", auto ? "时间到，正在交卷…" : "正在判卷…"));

    const res = await hooks.api.quizGrade({ token: session.token, answers: session.answers });
    submitting = false;
    if (!res || res.error) {
      session.submitted = false;
      clearBody();
      bodyEl.appendChild(h("div", "quiz-empty", (res && res.message) || "交卷失败，请重试"));
      const back = h("button", "quiz-btn ghost", "返回");
      back.addEventListener("click", renderHome);
      bodyEl.appendChild(back);
      return;
    }

    G.completeQuiz(state(), {
      mode: "exam",
      correct: res.correct,
      wrong: res.wrong,
      exam: { score: res.score, passed: res.passed },
      now: Date.now(),
    });
    saveSoon(400);
    updateHud();
    renderExamResult(res, auto);
  }

  function renderExamResult(res, auto) {
    clearBody();
    setHeader();
    const passed = res.passed === true;
    const box = h("div", "quiz-result");
    box.appendChild(h("div", "score", `${res.score} / ${res.totalScore}`));
    box.appendChild(
      h(
        "div",
        "sub",
        `${passed ? "合格" : "未合格"} · 及格线 ${res.passScore} · 答对 ${res.correct}/${res.total}${auto ? " · 超时自动交卷" : ""}`
      )
    );
    bodyEl.appendChild(box);

    const wrongs = (res.results || []).filter((item) => !item.correct);
    if (wrongs.length) {
      const list = h("div", "quiz-wrong-list");
      wrongs.forEach((item) => {
        const row = h("div", "quiz-wrong-item");
        row.appendChild(h("div", "", `正确答案：${item.answer.join("")}`));
        if (item.explanation) row.appendChild(h("div", "quiz-explain", item.explanation));
        list.appendChild(row);
      });
      bodyEl.appendChild(list);
    }

    const actions = h("div", "quiz-actions");
    const home = h("button", "quiz-btn", "返回题库");
    home.addEventListener("click", renderHome);
    actions.appendChild(home);
    bodyEl.appendChild(actions);
    if (hooks.updateMenu) hooks.updateMenu();
  }

  // -------------------------------------------------------------- 生命周期
  function configure(next) {
    hooks = next;
    root = $("quiz");
    bodyEl = $("quiz-body");
    subtitleEl = $("quiz-subtitle");
    coinsEl = $("quiz-coins");
    const closeBtn = $("quiz-close");
    if (closeBtn) closeBtn.addEventListener("click", () => hooks.closePanels && hooks.closePanels());
  }

  function openHome() {
    if (!hooks || !root) return;
    root.classList.add("show");
    renderHome();
    if (!exams && !loadingExams) loadExams(false);
  }

  function openMode(mode) {
    openHome();
    startMode(mode);
  }

  function refresh() {
    if (root && root.classList.contains("show") && !session) renderHome();
    if (root && root.classList.contains("show") && session) setHeader();
  }

  function close() {
    stopTimer();
    session = null;
    if (root) {
      root.classList.remove("show", "wide");
      clearBody();
    }
  }

  function isOpen() {
    return Boolean(root && root.classList.contains("show"));
  }

  window.DoroQuiz = {
    configure,
    openHome,
    openMode,
    refresh,
    close,
    isOpen,
    startMode,
  };
})();
