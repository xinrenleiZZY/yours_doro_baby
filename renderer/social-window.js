(function () {
  "use strict";

  const api = window.petAPI;
  const $ = (id) => document.getElementById(id);
  let social = null;
  let toastTimer = null;

  function toast(text) {
    const node = $("toast");
    node.textContent = text;
    node.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 2200);
  }

  function errorText(error) {
    return (
      {
        network: "无法连接好友服务，请确认 Docker 服务和局域网地址",
        timeout: "好友服务响应超时",
        unauthorized: "身份令牌已失效，请重新创建身份",
        "invalid-url": "服务器地址需要 http(s) 地址",
        "already-friends": "你们已经是好友",
        pending: "已有待处理的好友申请",
        self: "不能添加自己",
        "not-found": "没有找到这位玩家或申请",
      }[error] || "操作失败，请稍后重试"
    );
  }

  function setOnline(online) {
    $("connection-status").classList.toggle("online", online);
    $("connection-text").textContent = online ? "局域网好友服务已连接" : "好友服务未连接";
  }

  function personRow(person, actions) {
    const row = document.createElement("div");
    row.className = "person-row";
    const avatar = document.createElement("span");
    avatar.className = "person-avatar";
    avatar.textContent = person.avatar || "🐣";
    const info = document.createElement("div");
    const name = document.createElement("b");
    name.textContent = person.nickname || "doro 玩家";
    const detail = document.createElement("small");
    const dot = document.createElement("i");
    dot.className = `online-dot${person.online ? " on" : ""}`;
    detail.append(dot, document.createTextNode(person.online ? "在线" : "离线"));
    if (person.bio) detail.append(document.createTextNode(` · ${person.bio}`));
    info.append(name, detail);
    row.append(avatar, info);
    const controls = document.createElement("div");
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.textContent = action.label;
      if (action.secondary) button.className = "secondary";
      button.addEventListener("click", action.run);
      controls.appendChild(button);
    });
    row.appendChild(controls);
    return row;
  }

  function empty(text) {
    const node = document.createElement("div");
    node.className = "empty";
    node.textContent = text;
    return node;
  }

  async function refresh() {
    const result = await api.socialGet();
    if (!result || !result.ok) {
      setOnline(false);
      toast(errorText(result && result.error));
      return;
    }
    social = result;
    setOnline(true);
    render();
  }

  async function mutate(promise, successText) {
    const result = await promise;
    if (!result || !result.ok) {
      toast(errorText(result && result.error));
      return null;
    }
    if (successText) toast(successText);
    await refresh();
    return result;
  }

  function render() {
    if (!social) return;
    const profile = social.profile;
    $("profile-avatar").textContent = profile.avatar || "🐣";
    $("profile-nickname").textContent = profile.nickname;
    $("profile-bio").textContent = profile.bio || "还没有写简介";
    $("copy-id").textContent = `游戏 ID：${profile.gameId} · 点击复制`;
    $("profile-meta").textContent =
      `Lv.${profile.level} · ${profile.personality} · 亲密度 ${profile.intimacyName}`;
    $("edit-nickname").value = profile.nickname;
    $("edit-bio").value = profile.bio || "";

    const incoming = social.incoming || [];
    $("request-count").textContent = incoming.length ? `${incoming.length} 条待处理` : "暂无申请";
    const requests = $("requests");
    requests.innerHTML = "";
    if (!incoming.length) requests.appendChild(empty("暂时没有新的好友申请"));
    incoming.forEach((request) => {
      const person = request.from || {};
      requests.appendChild(
        personRow(person, [
          {
            label: "接受",
            run: () => mutate(api.socialRespond({ requestId: request.id, accept: true }), "已添加好友"),
          },
          {
            label: "拒绝",
            secondary: true,
            run: () => mutate(api.socialRespond({ requestId: request.id, accept: false }), "已拒绝申请"),
          },
        ])
      );
    });

    const friends = social.friends || [];
    $("friend-count").textContent = `${friends.length} 位好友`;
    const list = $("friends");
    list.innerHTML = "";
    if (!friends.length) list.appendChild(empty("还没有好友，搜索游戏 ID 添加吧"));
    friends.forEach((friend) => {
      list.appendChild(
        personRow(friend, [
          {
            label: "删除",
            secondary: true,
            run: () => mutate(api.socialRemove(friend.gameId), "已删除好友"),
          },
        ])
      );
    });
  }

  async function search() {
    const query = $("search-input").value.trim();
    const output = $("search-results");
    output.innerHTML = "";
    if (!query) return;
    const result = await api.socialSearch(query);
    if (!result || !result.ok) {
      output.appendChild(empty(errorText(result && result.error)));
      return;
    }
    if (!result.users || !result.users.length) {
      output.appendChild(empty("没有找到匹配的玩家"));
      return;
    }
    result.users.forEach((person) => {
      if (person.gameId === social.profile.gameId) return;
      output.appendChild(
        personRow(person, [
          {
            label: "加好友",
            run: () => mutate(api.socialRequest({ targetId: person.gameId }), "好友申请已发送"),
          },
        ])
      );
    });
  }

  async function boot() {
    const snapshot = await api.socialSnapshot();
    $("setup-server").value = snapshot.serverUrl || "http://192.168.0.193:9500";
    if (!snapshot.configured) {
      $("setup").hidden = false;
      $("app").hidden = true;
      setOnline(false);
      return;
    }
    $("setup").hidden = true;
    $("app").hidden = false;
    await refresh();
    await api.socialPresence(true);
    document.documentElement.dataset.socialReady = "1";
  }

  $("close").addEventListener("click", () => api.socialClose());
  $("register").addEventListener("click", async () => {
    const result = await api.socialSetup({
      serverUrl: $("setup-server").value,
      nickname: $("setup-nickname").value,
      bio: $("setup-bio").value,
      avatar: "🐣",
    });
    if (!result || !result.ok) {
      toast(errorText(result && result.error));
      return;
    }
    $("setup").hidden = true;
    $("app").hidden = false;
    toast(`身份创建成功：${result.profile.gameId}`);
    await refresh();
    document.documentElement.dataset.socialReady = "1";
  });
  $("copy-id").addEventListener("click", async () => {
    await api.socialCopy(social.profile.gameId);
    toast("游戏 ID 已复制");
  });
  $("save-profile").addEventListener("click", async () => {
    const result = await api.socialUpdate({
      nickname: $("edit-nickname").value,
      bio: $("edit-bio").value,
      avatar: social.profile.avatar,
    });
    if (!result || !result.ok) {
      toast(errorText(result && result.error));
      return;
    }
    toast("个人资料已保存");
    await refresh();
  });
  $("search-button").addEventListener("click", search);
  $("search-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") search();
  });
  setInterval(() => api.socialPresence(true), 60 * 1000);
  window.addEventListener("beforeunload", () => api.socialPresence(false));

  boot().catch((err) => {
    setOnline(false);
    toast("好友窗口初始化失败");
    api.log("error", "好友窗口初始化失败", err && (err.stack || String(err)));
  });
})();
