(function () {
  "use strict";

  const api = window.petAPI;
  const $ = (id) => document.getElementById(id);
  let social = null;
  let leaderboard = null;
  let conversations = [];
  let groups = [];
  let activeConversation = null;
  let chatMessages = [];
  let activeView = "friends";
  let activeBoard = "level";
  let leaderboardLoading = false;
  let conversationsLoading = false;
  let messagesLoading = false;
  let toastTimer = null;
  let countdownTimer = null;
  let chatPollTimer = null;

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
        forbidden: "当前身份无权执行这项操作",
        "friend-only": "只能邀请自己的好友加入群组",
        "already-member": "这位玩家已经在群里",
        "not-member": "这位玩家不在群里",
        "group-full": "群成员已满 50 人",
        "group-limit": "最多同时加入 50 个群组",
        "empty-message": "消息不能为空",
        "empty-group-name": "群名称不能为空",
        "rate-limited": "发送太快了，请稍后再试",
        "not-registered": "请先创建游戏身份，再参加排行榜",
        "invalid-recovery": "游戏 ID 或恢复码不正确",
        "already-issued": "恢复码已签发，请使用当前设备保存的恢复码",
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

  function scoreText(board, score) {
    return board === "level"
      ? `累计 Lv.${Math.round(score || 0)}`
      : `${Number(score || 0).toLocaleString("zh-CN")} 分`;
  }

  function boardText(board) {
    return {
      level: "等级榜",
      furniture: "家具榜",
      fashion: "时装榜",
      collection: "典藏榜",
    }[board];
  }

  function switchView(view) {
    activeView = ["friends", "chat", "groups", "ranking"].includes(view) ? view : "friends";
    document.querySelectorAll(".view-tabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === activeView);
    });
    $("friends-view").hidden = activeView !== "friends";
    $("chat-view").hidden = activeView !== "chat";
    $("groups-view").hidden = activeView !== "groups";
    $("ranking-view").hidden = activeView !== "ranking";
    if (activeView === "ranking") refreshLeaderboard();
    if (activeView === "chat" || activeView === "groups") refreshConversations();
    if (activeView === "chat" && activeConversation) loadMessages(true);
  }

  function updateCountdown() {
    if (!leaderboard || !leaderboard.period) return;
    const remaining = Math.max(0, Number(leaderboard.period.nextResetAt) - Date.now());
    const seconds = Math.floor(remaining / 1000);
    const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
    const secs = String(seconds % 60).padStart(2, "0");
    $("leaderboard-countdown").textContent = `距定榜 ${hours}:${minutes}:${secs}`;
  }

  function renderLeaderboard() {
    if (!leaderboard) return;
    const board = leaderboard.boards && leaderboard.boards[activeBoard];
    const definition = leaderboard.definitions && leaderboard.definitions[activeBoard];
    const titles = {
      level: ["等级榜", "累计等级，转生前的等级不清零"],
      furniture: ["家具榜", "仅有效租赁与永久家具计分"],
      fashion: ["时装榜", "仅有效租赁与永久时装计分"],
      collection: ["典藏榜", "永久典藏与榜一限定典藏计分"],
    };
    const [title, rule] = titles[activeBoard];
    const activeBoards = (leaderboard.activeBoosts && leaderboard.activeBoosts.boards) || [];
    $("leaderboard-status").textContent = activeBoards.length
      ? `本期 ${leaderboard.period.day} · 永耀：${activeBoards.map(boardText).join("、")}`
      : `本期 ${leaderboard.period.day} · 实时同步`;
    $("leaderboard-title").textContent = title;
    $("leaderboard-rule").textContent = rule;
    document.querySelectorAll("#leaderboard-tabs button").forEach((button) => {
      button.classList.toggle("active", button.dataset.board === activeBoard);
    });
    updateCountdown();

    const self = board && board.self;
    $("leaderboard-self").textContent = self
      ? `我的排名：第 ${self.rank} 名 · ${scoreText(activeBoard, self.score)}${
          activeBoards.includes(activeBoard) ? " · 永耀生效中" : ""
        }`
      : "我的排名：尚未上榜";

    const winner = leaderboard.winners && leaderboard.winners[activeBoard];
    $("leaderboard-winner").textContent = winner
      ? `上期榜一：${winner.avatar || "🐣"} ${winner.nickname} · ${scoreText(
          activeBoard,
          winner.score
        )} · 永耀`
      : "上期暂无达标榜一";

    const list = $("leaderboard-list");
    list.innerHTML = "";
    const entries = (board && board.entries) || [];
    if (!entries.length) {
      list.appendChild(empty("还没有玩家上榜，保持在线同步一次即可参加"));
    } else {
      entries.forEach((entry) => {
        const row = document.createElement("div");
        row.className = `rank-row${entry.isSelf ? " self" : ""}${entry.rank <= 3 ? " podium" : ""}`;
        const rank = document.createElement("b");
        rank.className = "rank-number";
        rank.textContent =
          entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : entry.rank === 3 ? "🥉" : `#${entry.rank}`;
        const avatar = document.createElement("span");
        avatar.className = "rank-avatar";
        avatar.textContent = entry.avatar || "🐣";
        const name = document.createElement("span");
        name.className = "rank-name";
        name.textContent = `${entry.nickname}${entry.isSelf ? "（我）" : ""}`;
        const score = document.createElement("strong");
        score.textContent = scoreText(activeBoard, entry.score);
        row.append(rank, avatar, name, score);
        list.appendChild(row);
      });
    }

    const reward = $("leaderboard-reward");
    reward.innerHTML = "";
    if (definition) {
      const owned = (leaderboard.awards || []).some((award) => award.id === definition.rewardId);
      const active = activeBoards.includes(activeBoard);
      const card = document.createElement("div");
      card.className = `reward-preview${owned ? " owned" : ""}${active ? " active" : ""}`;
      const icon = document.createElement("span");
      icon.textContent = definition.rewardIcon;
      const info = document.createElement("div");
      const name = document.createElement("b");
      name.textContent = definition.rewardName;
      const detail = document.createElement("small");
      const permanent = Math.round((Number(definition.permanentIncomeBonus) || 0) * 100);
      const daily = Math.round((Number(definition.dailyIncomeBonus) || 0) * 100);
      const effect = `永耀：分数 +20%，当日产出 +${daily}%`;
      const permanentText = permanent ? `藏品永久产出 +${permanent}%` : "";
      const stateText = active
        ? "今日永耀生效中"
        : owned
          ? "已拥有，重新夺冠后激活永耀"
          : "当日榜一获得，次日生效";
      detail.textContent = [permanentText, effect, stateText].filter(Boolean).join(" · ");
      info.append(name, detail);
      card.append(icon, info);
      reward.appendChild(card);
    }

    const awards = $("leaderboard-awards");
    awards.innerHTML = "";
    const earned = leaderboard.awards || [];
    if (!earned.length) {
      awards.appendChild(empty("还没有获得榜一限定典藏"));
    } else {
      earned.forEach((award) => {
        const badge = document.createElement("span");
        badge.className = "award-badge";
        badge.textContent = `${award.icon} ${award.name} · ${award.day || ""}`;
        awards.appendChild(badge);
      });
    }
  }

  async function refreshLeaderboard() {
    if (leaderboardLoading || !social) return;
    leaderboardLoading = true;
    $("leaderboard-status").textContent = "正在同步分数与榜单…";
    try {
      const result = await api.socialLeaderboard();
      if (!result || !result.ok) {
        $("leaderboard-status").textContent = errorText(result && result.error);
        setOnline(false);
        return;
      }
      leaderboard = result;
      setOnline(true);
      renderLeaderboard();
    } finally {
      leaderboardLoading = false;
    }
  }

  async function refreshShopStatus() {
    const result = await api.shopStatus();
    if (!result || !result.ok) {
      $("shop-cloud-status").textContent = errorText(result && result.error);
      return;
    }
    const catalog = result.catalog || {};
    const source =
      catalog.source === "docker" ? "Docker 已更新" : catalog.source === "cache" ? "本地缓存" : "内置目录";
    $("shop-cloud-status").textContent = `目录 ${catalog.version || "内置"} · ${source}${
      result.configured ? " · 权益可同步" : " · 请先创建身份"
    }`;
  }

  async function syncShopCloud() {
    const button = $("shop-cloud-sync");
    button.disabled = true;
    $("shop-cloud-status").textContent = "正在更新商城目录并合并权益…";
    try {
      const result = await api.shopSync();
      if (!result || !result.ok) {
        toast(errorText(result && result.entitlements && result.entitlements.error));
        await refreshShopStatus();
        return;
      }
      toast("商城目录与永久权益已同步");
      await refreshShopStatus();
    } finally {
      button.disabled = false;
    }
  }

  function conversationKey(kind, id) {
    return `${kind}:${id}`;
  }

  function activeKey() {
    return activeConversation ? conversationKey(activeConversation.kind, activeConversation.id) : "";
  }

  function conversationPreview(conversation) {
    const message = conversation.lastMessage;
    if (!message) {
      return conversation.kind === "group" ? "群聊已创建" : "打个招呼吧";
    }
    const prefix = message.mine
      ? "我："
      : conversation.kind === "group" && message.sender
        ? `${message.sender.nickname}：`
        : "";
    return `${prefix}${message.text}`;
  }

  function renderConversations() {
    const list = $("conversation-list");
    list.innerHTML = "";
    if (!conversations.length) {
      list.appendChild(empty("还没有好友或群聊"));
      return;
    }
    conversations.forEach((conversation) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `conversation-item${
        activeKey() === conversationKey(conversation.kind, conversation.id) ? " active" : ""
      }`;
      const avatar = document.createElement("span");
      avatar.className = "conversation-avatar";
      avatar.textContent = conversation.avatar || (conversation.kind === "group" ? "👥" : "🐣");
      const copy = document.createElement("span");
      copy.className = "conversation-copy";
      const name = document.createElement("b");
      name.textContent = conversation.title;
      const preview = document.createElement("small");
      preview.textContent = conversationPreview(conversation);
      copy.append(name, preview);
      row.append(avatar, copy);
      if (conversation.unread > 0) {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = conversation.unread > 99 ? "99+" : String(conversation.unread);
        row.appendChild(badge);
      }
      row.addEventListener("click", () => selectConversation(conversation));
      list.appendChild(row);
    });
  }

  function formatMessageTime(value) {
    const date = new Date(Number(value) || Date.now());
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function renderMessages(scrollBottom) {
    const list = $("message-list");
    list.innerHTML = "";
    if (!chatMessages.length) {
      list.appendChild(empty("还没有消息，发出第一句吧"));
      return;
    }
    chatMessages.forEach((message) => {
      const row = document.createElement("div");
      row.className = `message-row${message.mine ? " mine" : ""}`;
      if (!message.mine) {
        const avatar = document.createElement("span");
        avatar.className = "message-avatar";
        avatar.textContent = (message.sender && message.sender.avatar) || "🐣";
        row.appendChild(avatar);
      }
      const content = document.createElement("div");
      content.className = "message-content";
      if (!message.mine && activeConversation && activeConversation.kind === "group") {
        const sender = document.createElement("div");
        sender.className = "message-sender";
        sender.textContent = (message.sender && message.sender.nickname) || "群成员";
        content.appendChild(sender);
      }
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.textContent = message.text;
      const time = document.createElement("div");
      time.className = "message-time";
      time.textContent = formatMessageTime(message.createdAt);
      content.append(bubble, time);
      row.appendChild(content);
      list.appendChild(row);
    });
    if (scrollBottom) list.scrollTop = list.scrollHeight;
  }

  function clearConversation() {
    activeConversation = null;
    chatMessages = [];
    $("chat-empty").hidden = false;
    $("chat-thread").hidden = true;
    renderConversations();
  }

  function selectConversation(conversation) {
    if (!conversation) return;
    activeConversation = {
      kind: conversation.kind,
      id: conversation.id,
      title: conversation.title,
      avatar: conversation.avatar,
    };
    $("chat-empty").hidden = true;
    $("chat-thread").hidden = false;
    $("chat-avatar").textContent = conversation.avatar || (conversation.kind === "group" ? "👥" : "🐣");
    $("chat-title").textContent = conversation.title;
    $("chat-meta").textContent =
      conversation.kind === "group"
        ? `${(conversation.group && conversation.group.memberCount) || 0} 位成员 · ${
            conversation.group && conversation.group.isOwner ? "我是群主" : "群聊"
          }`
        : conversation.online
          ? "好友在线"
          : "好友离线";
    renderConversations();
    loadMessages(true);
  }

  async function loadMessages(scrollBottom, quiet) {
    if (!activeConversation || messagesLoading) return;
    messagesLoading = true;
    const requested = activeKey();
    try {
      const result = await api.socialMessages({
        kind: activeConversation.kind,
        targetId: activeConversation.id,
      });
      if (requested !== activeKey()) return;
      if (!result || !result.ok) {
        if (!quiet) toast(errorText(result && result.error));
        return;
      }
      const list = $("message-list");
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70;
      chatMessages = result.messages || [];
      renderMessages(Boolean(scrollBottom) || nearBottom);
      if (result.conversation) {
        if (result.conversation.title) $("chat-title").textContent = result.conversation.title;
        if (result.conversation.avatar) $("chat-avatar").textContent = result.conversation.avatar;
      }
      refreshConversations(false);
    } catch (err) {
      if (!quiet) {
        toast("聊天记录加载失败");
        api.log("warn", "聊天记录加载失败", err && (err.stack || String(err)));
      }
    } finally {
      messagesLoading = false;
    }
  }

  async function refreshConversations(showError = true) {
    if (conversationsLoading || !social) return;
    conversationsLoading = true;
    try {
      const result = await api.socialConversations();
      if (!result || !result.ok) {
        if (showError) toast(errorText(result && result.error));
        return;
      }
      conversations = result.conversations || [];
      groups = result.groups || [];
      if (activeConversation) {
        const current = conversations.find(
          (conversation) =>
            conversation.kind === activeConversation.kind && conversation.id === activeConversation.id
        );
        if (!current) {
          clearConversation();
        } else {
          selectConversation(current);
        }
      } else {
        renderConversations();
      }
      renderGroups();
    } catch (err) {
      if (showError) toast("会话列表加载失败");
      api.log("warn", "会话列表加载失败", err && (err.stack || String(err)));
    } finally {
      conversationsLoading = false;
    }
  }

  function renderGroupFriendPicker() {
    const picker = $("group-friend-picker");
    picker.innerHTML = "";
    const friends = (social && social.friends) || [];
    if (!friends.length) {
      picker.appendChild(empty("添加好友后，可以邀请好友一起进群"));
      return;
    }
    friends.forEach((friend) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = friend.gameId;
      label.append(input, document.createTextNode(`${friend.avatar || "🐣"} ${friend.nickname}`));
      picker.appendChild(label);
    });
  }

  async function runGroupAction(promise, successText) {
    const result = await promise;
    if (!result || !result.ok) {
      toast(errorText(result && result.error));
      return null;
    }
    if (successText) toast(successText);
    await refreshConversations(false);
    return result;
  }

  function renderGroups() {
    renderGroupFriendPicker();
    $("group-count").textContent = groups.length ? `${groups.length} 个群组` : "暂无群组";
    const list = $("group-list");
    list.innerHTML = "";
    if (!groups.length) {
      list.appendChild(empty("还没有群组，创建一个和好友一起聊天吧"));
      return;
    }
    groups.forEach((group) => {
      const card = document.createElement("article");
      card.className = "group-card";
      const header = document.createElement("header");
      const title = document.createElement("h4");
      title.textContent = `👥 ${group.name}`;
      const count = document.createElement("small");
      count.textContent = `${group.memberCount} 人${group.isOwner ? " · 我是群主" : ""}`;
      header.append(title, count);

      const members = document.createElement("div");
      members.className = "group-members";
      group.members.forEach((member) => {
        const chip = document.createElement("span");
        chip.className = `group-member${member.gameId === group.ownerId ? " owner" : ""}`;
        chip.textContent = `${member.avatar || "🐣"} ${member.nickname}${
          member.gameId === group.ownerId ? " · 群主" : ""
        }`;
        if (group.isOwner && member.gameId !== group.ownerId) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = " ×";
          remove.title = `移出 ${member.nickname}`;
          remove.addEventListener("click", () =>
            runGroupAction(
              api.socialRemoveGroupMember({ groupId: group.id, memberId: member.gameId }),
              "已移出群成员"
            )
          );
          chip.appendChild(remove);
        }
        members.appendChild(chip);
      });

      const tools = document.createElement("div");
      tools.className = "group-tools";
      if (group.isOwner) {
        const rename = document.createElement("input");
        rename.maxLength = 30;
        rename.value = group.name;
        rename.setAttribute("aria-label", "群名称");
        const renameButton = document.createElement("button");
        renameButton.type = "button";
        renameButton.className = "secondary";
        renameButton.textContent = "改名";
        renameButton.addEventListener("click", () =>
          runGroupAction(api.socialRenameGroup({ groupId: group.id, name: rename.value }), "群名称已更新")
        );
        tools.append(rename, renameButton);
      }

      const actions = document.createElement("div");
      actions.className = "group-actions";
      const chat = document.createElement("button");
      chat.type = "button";
      chat.className = "primary";
      chat.textContent = "进入群聊";
      chat.addEventListener("click", () => {
        switchView("chat");
        selectConversation({
          kind: "group",
          id: group.id,
          title: group.name,
          avatar: "👥",
          group,
        });
      });
      actions.appendChild(chat);
      if (group.isOwner) {
        const friends = ((social && social.friends) || []).filter(
          (friend) => !group.memberIds.includes(friend.gameId)
        );
        if (friends.length) {
          const select = document.createElement("select");
          select.setAttribute("aria-label", "选择要邀请的好友");
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "邀请好友…";
          select.appendChild(placeholder);
          friends.forEach((friend) => {
            const option = document.createElement("option");
            option.value = friend.gameId;
            option.textContent = friend.nickname;
            select.appendChild(option);
          });
          const invite = document.createElement("button");
          invite.type = "button";
          invite.className = "secondary";
          invite.textContent = "添加";
          invite.addEventListener("click", () => {
            if (!select.value) {
              toast("请选择要邀请的好友");
              return;
            }
            runGroupAction(
              api.socialAddGroupMember({ groupId: group.id, memberId: select.value }),
              "好友已加入群聊"
            );
          });
          actions.append(select, invite);
        }
      }
      const leave = document.createElement("button");
      leave.type = "button";
      leave.className = "secondary";
      leave.textContent = group.isOwner ? "解散群" : "退出群";
      leave.addEventListener("click", () => {
        if (group.isOwner) {
          if (!window.confirm(`确定解散「${group.name}」？群聊记录会一并删除。`)) return;
          runGroupAction(api.socialDisbandGroup(group.id), "群组已解散");
        } else {
          runGroupAction(api.socialLeaveGroup(group.id), "已退出群组");
        }
      });
      actions.appendChild(leave);
      card.append(header, members, tools, actions);
      list.appendChild(card);
    });
  }

  async function sendCurrentMessage(event) {
    event.preventDefault();
    if (!activeConversation) return;
    const input = $("message-input");
    const text = input.value.trim();
    if (!text) return;
    const button = $("send-message");
    button.disabled = true;
    try {
      const payload =
        activeConversation.kind === "group"
          ? { kind: "group", groupId: activeConversation.id, text }
          : { kind: "direct", peerId: activeConversation.id, text };
      const result = await api.socialSendMessage(payload);
      if (!result || !result.ok) {
        toast(errorText(result && result.error));
        return;
      }
      input.value = "";
      await loadMessages(true);
      await refreshConversations(false);
    } catch (err) {
      toast("消息发送失败");
      api.log("warn", "消息发送失败", err && (err.stack || String(err)));
    } finally {
      button.disabled = false;
      input.focus();
    }
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
            label: "聊天",
            run: () => {
              switchView("chat");
              selectConversation({
                kind: "direct",
                id: friend.gameId,
                title: friend.nickname,
                avatar: friend.avatar,
                online: friend.online,
              });
            },
          },
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
    await refreshShopStatus();
    await refreshConversations(false);
    await api.socialPresence(true);
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(updateCountdown, 1000);
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(() => {
      if (activeView === "chat" && activeConversation) loadMessages(false, true);
      if (activeView === "groups") refreshConversations(false);
    }, 4000);
    document.documentElement.dataset.socialReady = "1";
  }

  document.querySelectorAll(".view-tabs button").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  document.querySelectorAll("#leaderboard-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      activeBoard = button.dataset.board;
      renderLeaderboard();
    });
  });
  $("leaderboard-refresh").addEventListener("click", refreshLeaderboard);
  $("conversation-refresh").addEventListener("click", () => refreshConversations(true));
  $("message-form").addEventListener("submit", sendCurrentMessage);
  $("message-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      $("message-form").requestSubmit();
    }
  });
  $("create-group").addEventListener("click", async () => {
    const name = $("group-name").value.trim();
    if (!name) {
      toast("请先填写群名称");
      return;
    }
    const memberIds = Array.from(document.querySelectorAll("#group-friend-picker input:checked")).map(
      (input) => input.value
    );
    const result = await runGroupAction(api.socialCreateGroup({ name, memberIds }), "群组已创建");
    if (!result) return;
    $("group-name").value = "";
    renderGroupFriendPicker();
  });
  $("shop-cloud-sync").addEventListener("click", syncShopCloud);
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
    await refreshConversations(false);
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
  $("recover-account").addEventListener("click", async () => {
    const result = await api.socialRecover({
      serverUrl: $("setup-server").value,
      gameId: $("recovery-id").value.trim(),
      recoveryCode: $("recovery-code").value.trim(),
    });
    if (!result || !result.ok) {
      toast(errorText(result && result.error));
      return;
    }
    $("setup").hidden = true;
    $("app").hidden = false;
    toast("身份与商城权益已恢复");
    await refresh();
    await refreshShopStatus();
    await refreshConversations(false);
    await api.socialPresence(true);
    document.documentElement.dataset.socialReady = "1";
  });
  $("show-recovery").addEventListener("click", async () => {
    const result = await api.socialRecoveryGet();
    if (!result || !result.ok) {
      toast(errorText(result && result.error));
      return;
    }
    $("recovery-value").textContent = result.recoveryCode;
    $("recovery-value").hidden = false;
    $("copy-recovery").hidden = false;
    $("copy-recovery").dataset.code = result.recoveryCode;
  });
  $("copy-recovery").addEventListener("click", async () => {
    const code = $("copy-recovery").dataset.code || $("recovery-value").textContent;
    if (!code) return;
    await api.socialCopy(code);
    toast("恢复码已复制，请妥善保存");
  });
  $("search-button").addEventListener("click", search);
  $("search-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") search();
  });
  setInterval(() => api.socialPresence(true), 60 * 1000);
  window.addEventListener("beforeunload", () => {
    if (countdownTimer) clearInterval(countdownTimer);
    if (chatPollTimer) clearInterval(chatPollTimer);
    api.socialPresence(false);
  });

  boot().catch((err) => {
    setOnline(false);
    toast("好友窗口初始化失败");
    api.log("error", "好友窗口初始化失败", err && (err.stack || String(err)));
  });
})();
