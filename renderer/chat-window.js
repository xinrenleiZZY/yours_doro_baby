/* 独立聊天窗：只负责界面，API Key 与网络请求都在主进程。 */
(function () {
  "use strict";

  const api = window.petAPI;
  const $ = (id) => document.getElementById(id);
  const el = {
    status: $("status"),
    statusText: $("status-text"),
    settings: $("settings"),
    settingsToggle: $("settings-toggle"),
    close: $("close"),
    baseUrl: $("base-url"),
    model: $("model"),
    apiKey: $("api-key"),
    clearKey: $("clear-key"),
    persona: $("persona"),
    settingsMessage: $("settings-message"),
    saveSettings: $("save-settings"),
    history: $("history"),
    message: $("message"),
    send: $("send"),
    clearHistory: $("clear-history"),
  };

  let config = null;
  let messages = [];
  let sending = false;

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.status.className = `status${kind ? ` ${kind}` : ""}`;
  }

  function addMessage(role, content, extraClass) {
    const empty = el.history.querySelector(".empty");
    if (empty) empty.remove();
    const row = document.createElement("div");
    row.className = `message ${role}${extraClass ? ` ${extraClass}` : ""}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    row.appendChild(bubble);
    el.history.appendChild(row);
    return row;
  }

  function renderHistory() {
    el.history.innerHTML = "";
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      const visual = document.createElement("div");
      visual.className = "empty-visual";
      const avatar = document.createElement("img");
      avatar.src = "../assets/pet/closeup_soft.webp";
      avatar.alt = "";
      visual.appendChild(avatar);
      const title = document.createElement("strong");
      title.textContent = "我在这里。";
      const hint = document.createElement("span");
      hint.textContent = "可以聊今天发生了什么，也可以让我陪你歇一会儿。配置一次 AI 接口就能开始。";
      const prompts = document.createElement("div");
      prompts.className = "quick-prompts";
      ["陪我歇一会儿", "今天有点累", "讲个冷笑话"].forEach((text) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", () => {
          el.message.value = text;
          sendMessage();
        });
        prompts.appendChild(button);
      });
      empty.append(visual, title, hint, prompts);
      el.history.appendChild(empty);
      return;
    }
    messages.forEach((item) => addMessage(item.role, item.content));
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      el.history.scrollTop = el.history.scrollHeight;
    });
  }

  function fillSettings() {
    el.baseUrl.value = config.baseUrl || "";
    el.model.value = config.model || "";
    el.persona.value = config.persona || "";
    el.apiKey.value = "";
    el.apiKey.placeholder = config.hasApiKey
      ? "已保存；留空保持不变"
      : config.requiresApiKey === false
        ? "本地服务可留空"
        : "输入 API Key";
    el.clearKey.checked = false;
  }

  function applyStatus(status) {
    if (status && status.configured) {
      setStatus(`已连接 · ${status.model}`, "ready");
    } else {
      setStatus("还没配置 AI 接口", "error");
    }
  }

  async function load() {
    [config, messages] = await Promise.all([api.aiConfigGet(), api.aiHistory()]);
    if (config && config.error) throw new Error("AI 接口未授权");
    fillSettings();
    renderHistory();
    applyStatus(await api.aiStatus());
    if (config.requiresApiKey !== false && !config.hasApiKey) el.settings.hidden = false;
    el.message.focus();
    document.documentElement.dataset.chatReady = "1";
  }

  async function saveSettings() {
    el.saveSettings.disabled = true;
    el.settingsMessage.textContent = "正在保存…";
    const result = await api.aiConfigSave({
      baseUrl: el.baseUrl.value,
      model: el.model.value.trim(),
      apiKey: el.apiKey.value,
      persona: el.persona.value.trim(),
      clearApiKey: el.clearKey.checked,
    });
    el.saveSettings.disabled = false;
    if (!result || !result.ok) {
      const labels = {
        "invalid-base-url": "接口地址格式不对，需要 http(s) 地址",
        "invalid-model": "模型名称不能为空",
        "invalid-persona": "人格提示不能为空",
        "secure-storage-unavailable": "系统安全存储不可用，无法安全保存密钥",
        "save-failed": "配置写入失败",
        unauthorized: "聊天窗口未授权，请重新打开。",
      };
      el.settingsMessage.textContent = labels[result && result.error] || "保存失败";
      return;
    }
    config = result.config;
    fillSettings();
    applyStatus(result.status);
    el.settingsMessage.textContent = result.config.hasApiKey
      ? "已保存，API Key 已加密。"
      : result.config.requiresApiKey === false
        ? "已保存，本地服务无需 API Key。"
        : "连接参数已保存，还需要填写 API Key。";
    if (!result.config.requiresApiKey || result.config.hasApiKey) {
      setTimeout(() => {
        el.settings.hidden = true;
      }, 500);
    }
  }

  function errorText(error) {
    return (
      {
        "missing-api-key": "还没有配置 API Key，点右上角设置。",
        "invalid-api-key": "API Key 无效，请检查后重试。",
        timeout: "等太久了。网络或模型服务没有及时响应。",
        network: "连接失败，请检查接口地址和网络。",
        upstream: "模型服务返回了错误，请检查模型名称和额度。",
        "invalid-response": "模型返回的数据无法解析。",
        "response-too-large": "模型返回内容过大，已经停止读取。",
        "empty-response": "模型这次没有说话，再试一次吧。",
        unauthorized: "聊天窗口未授权，请重新打开。",
      }[error] || "这次没连上，再试一次吧。"
    );
  }

  async function sendMessage() {
    const text = el.message.value.trim();
    if (!text || sending) return;
    if (config.requiresApiKey !== false && !config.hasApiKey) {
      el.settings.hidden = false;
      addMessage("system", "先填好 AI 接口和 API Key，我才能认真回话。", "error");
      scrollToBottom();
      return;
    }

    sending = true;
    el.settings.hidden = true;
    el.send.disabled = true;
    el.send.querySelector("span").textContent = "发送中";
    el.message.disabled = true;
    el.message.value = "";
    addMessage("user", text);
    const typing = addMessage("assistant", "", "typing");
    scrollToBottom();
    setStatus("正在想怎么回你…");

    try {
      const result = await api.aiChat({ message: text });
      typing.remove();
      if (!result || !result.ok) {
        addMessage("system", errorText(result && result.error), "error");
      } else {
        messages = result.history || [];
        addMessage("assistant", result.intent.reply);
      }
    } catch (err) {
      typing.remove();
      addMessage("system", "聊天窗口遇到异常，请查看日志。", "error");
      api.log("error", "聊天窗口请求失败", err && (err.stack || String(err)));
    } finally {
      sending = false;
      el.send.disabled = false;
      el.send.querySelector("span").textContent = "发送";
      el.message.disabled = false;
      el.message.focus();
      if (config) applyStatus(await api.aiStatus());
      scrollToBottom();
    }
  }

  el.settingsToggle.addEventListener("click", () => {
    el.settings.hidden = !el.settings.hidden;
  });
  el.close.addEventListener("click", () => api.aiClose());
  el.saveSettings.addEventListener("click", saveSettings);
  el.send.addEventListener("click", sendMessage);
  el.message.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  el.clearHistory.addEventListener("click", async () => {
    await api.aiClearHistory();
    messages = [];
    renderHistory();
  });
  el.settings.addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset-base]");
    if (!button) return;
    el.baseUrl.value = button.dataset.presetBase;
    el.model.value = button.dataset.presetModel;
    el.apiKey.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.settings.hidden) el.settings.hidden = true;
  });

  load().catch((err) => {
    setStatus("聊天窗口加载失败", "error");
    api.log("error", "聊天窗口初始化失败", err && (err.stack || String(err)));
  });
})();
