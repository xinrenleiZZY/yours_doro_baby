/*
 * 独立答题窗口的引导脚本。
 * quiz.js 负责界面；这里提供它需要的状态 / API，并把奖励同步回宠物窗口。
 */
(function () {
  "use strict";

  const G = window.DoroGame;
  const api = window.petAPI;
  let quizState = null;
  let ready = false;
  let pendingMode = null;
  let toastTimer = null;

  function showToast(text, ms) {
    const node = document.getElementById("quiz-toast");
    if (!node) return;
    node.textContent = String(text || "");
    node.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), ms || 1800);
  }

  let audioCtx = null;
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const now = audioCtx.currentTime;
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    } catch (err) {
      /* 音效失败不影响答题 */
    }
  }

  function startMode(mode) {
    if (!mode || mode === "home") {
      window.DoroQuiz.openHome();
      return;
    }
    window.DoroQuiz.startMode(mode);
  }

  async function boot() {
    pendingMode = new URLSearchParams(location.search).get("mode") || null;
    const snapshot = await api.quizSnapshot();
    quizState = G.hydrate(snapshot && snapshot.save, (snapshot && snapshot.now) || Date.now());
    if (quizState.settings && quizState.settings.theme) {
      document.body.dataset.theme = quizState.settings.theme;
    }

    // quiz.js 内部会调用 G.completeQuiz；这里在本地记一份的同时同步给宠物窗口。
    const originalComplete = G.completeQuiz;
    G.completeQuiz = function (state, payload) {
      const result = originalComplete(state, payload);
      api.quizApply(payload);
      return result;
    };

    window.DoroQuiz.configure({
      getState: () => quizState,
      api,
      setUiSize: (size) => api.quizResize(size),
      toast: showToast,
      speak: (text, ms) => api.quizSpeak(text, ms),
      floatText: () => {},
      playSound: beep,
      save: () => {},
      updateHud: () => {
        const node = document.getElementById("quiz-coins");
        if (node) node.textContent = `${G.formatCoins(quizState.coins)} 金币`;
      },
      updateMenu: () => {},
      closePanels: () => api.quizClose(),
    });

    document.getElementById("quiz-close").addEventListener("click", () => api.quizClose());
    api.onQuizCommand((payload) => {
      if (!payload) return;
      if (ready) startMode(payload.mode);
      else pendingMode = payload.mode;
    });

    ready = true;
    document.documentElement.dataset.quizReady = "1";
    window.DoroQuiz.openHome();
    if (pendingMode) startMode(pendingMode);
  }

  window.addEventListener("DOMContentLoaded", () => {
    boot().catch((err) => showToast(`答题窗口初始化失败：${err.message}`, 4000));
  });
})();
