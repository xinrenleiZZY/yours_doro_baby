/* 局域网好友服务集成测试：node tools/test-social-server.js */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SocialStore,
  createServer,
  shanghaiDayKey,
  nextShanghaiMidnight,
} = require("../social-server/server.js");
const { SocialClient } = require("../lib/social-client.js");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doro-social-test-"));
  const file = path.join(dir, "social.json");
  const store = new SocialStore(file);
  const server = createServer(store);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let passed = 0;
  const check = (name, ok, detail) => {
    assert.ok(ok, `${name}${detail ? `: ${detail}` : ""}`);
    passed += 1;
    console.log(`  ok  ${name}`);
  };
  const request = async (route, options = {}) => {
    const response = await fetch(`${base}${route}`, options);
    return { status: response.status, body: await response.json() };
  };

  try {
    const alice = await request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "小鱼", bio: "喜欢晒太阳" }),
    });
    const bob = await request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "阿泡", bio: "在写代码" }),
    });
    check(
      "注册会生成唯一游戏 ID 和访问令牌",
      /^doro_[a-f0-9]{8}$/.test(alice.body.gameId) && alice.body.token
    );
    check("游戏 ID 不会重复", alice.body.gameId !== bob.body.gameId);

    const found = await request(`/api/directory?q=${encodeURIComponent("阿泡")}`);
    check(
      "可以按昵称搜索局域网玩家",
      found.body.users.some((user) => user.gameId === bob.body.gameId)
    );
    const charlie = await request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "路人丙", bio: "还没有加好友" }),
    });

    const sent = await request("/api/friends/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({ targetId: bob.body.gameId, message: "一起摸鱼" }),
    });
    check("可以发送好友申请", sent.body.request && sent.body.request.status === "pending");

    const bobSocial = await request("/api/social", {
      headers: { "X-Doro-Token": bob.body.token },
    });
    check("对方能收到好友申请", bobSocial.body.incoming.length === 1);

    await request("/api/friends/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": bob.body.token },
      body: JSON.stringify({ requestId: sent.body.request.id, accept: true }),
    });
    const aliceSocial = await request("/api/social", {
      headers: { "X-Doro-Token": alice.body.token },
    });
    check(
      "接受后双方进入好友列表",
      aliceSocial.body.friends.some((user) => user.gameId === bob.body.gameId)
    );

    const updated = await request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({ nickname: "小鱼干", bio: "今天也在摸鱼" }),
    });
    check("个人资料可以修改", updated.body.profile.nickname === "小鱼干");

    const directSent = await request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({
        kind: "direct",
        peerId: bob.body.gameId,
        text: "今晚一起摸鱼吗？",
      }),
    });
    check("好友之间可以发送私聊消息", directSent.status === 201 && directSent.body.message.mine);

    const bobConversations = await request("/api/conversations", {
      headers: { "X-Doro-Token": bob.body.token },
    });
    const bobDirectConversation = bobConversations.body.conversations.find(
      (conversation) => conversation.kind === "direct" && conversation.id === alice.body.gameId
    );
    check("好友私聊会出现在对方会话列表并计入未读", bobDirectConversation.unread === 1);

    const bobMessages = await request(
      `/api/messages?kind=direct&targetId=${encodeURIComponent(alice.body.gameId)}`,
      { headers: { "X-Doro-Token": bob.body.token } }
    );
    check(
      "加载私聊记录后返回消息并清除未读",
      bobMessages.status === 200 &&
        bobMessages.body.messages.length === 1 &&
        bobMessages.body.messages[0].text === "今晚一起摸鱼吗？" &&
        (
          await request("/api/conversations", {
            headers: { "X-Doro-Token": bob.body.token },
          })
        ).body.conversations.find(
          (conversation) => conversation.kind === "direct" && conversation.id === alice.body.gameId
        ).unread === 0
    );

    const strangerMessage = await request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": charlie.body.token },
      body: JSON.stringify({
        kind: "direct",
        peerId: alice.body.gameId,
        text: "陌生人消息不应送达",
      }),
    });
    check("非好友不能发送私聊消息", strangerMessage.status === 403);

    const createdGroup = await request("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({ name: "摸鱼小队", memberIds: [bob.body.gameId] }),
    });
    const groupId = createdGroup.body.group && createdGroup.body.group.id;
    check(
      "可以创建群组并邀请好友",
      createdGroup.status === 201 &&
        /^grp_[a-f0-9]{12}$/.test(groupId) &&
        createdGroup.body.group.memberIds.includes(bob.body.gameId) &&
        createdGroup.body.group.ownerId === alice.body.gameId
    );

    const groupSent = await request("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": bob.body.token },
      body: JSON.stringify({ kind: "group", groupId, text: "收到，马上到。" }),
    });
    const aliceConversations = await request("/api/conversations", {
      headers: { "X-Doro-Token": alice.body.token },
    });
    const aliceGroupConversation = aliceConversations.body.conversations.find(
      (conversation) => conversation.kind === "group" && conversation.id === groupId
    );
    check(
      "群成员可以发送群聊消息并产生未读",
      groupSent.status === 201 && aliceGroupConversation.unread === 1
    );

    const outsiderGroupMessages = await request(
      `/api/messages?kind=group&targetId=${encodeURIComponent(groupId)}`,
      { headers: { "X-Doro-Token": charlie.body.token } }
    );
    check("非群成员不能读取群聊记录", outsiderGroupMessages.status === 404);

    const bobRename = await request(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Doro-Token": bob.body.token },
      body: JSON.stringify({ name: "越权改名" }),
    });
    const aliceRename = await request(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({ name: "认真摸鱼小队" }),
    });
    check(
      "只有群主可以修改群名称",
      bobRename.status === 403 && aliceRename.status === 200 && aliceRename.body.group.name === "认真摸鱼小队"
    );

    const inviteStranger = await request(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({ memberId: charlie.body.gameId }),
    });
    check("群主只能邀请自己的好友入群", inviteStranger.status === 400);

    const removedBob = await request(
      `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(bob.body.gameId)}`,
      { method: "DELETE", headers: { "X-Doro-Token": alice.body.token } }
    );
    const removedBobAccess = await request(
      `/api/messages?kind=group&targetId=${encodeURIComponent(groupId)}`,
      { headers: { "X-Doro-Token": bob.body.token } }
    );
    check(
      "群主可以移出成员且被移出者立即失去群聊权限",
      removedBob.status === 200 && removedBobAccess.status === 404
    );

    const reloadedChat = new SocialStore(file);
    check(
      "群组、群消息、私聊与已读状态会持久化",
      Boolean(reloadedChat.data.groups[groupId]) &&
        reloadedChat.data.messages.some(
          (message) => message.kind === "direct" && message.text === "今晚一起摸鱼吗？"
        ) &&
        reloadedChat.data.messages.some(
          (message) => message.kind === "group" && message.groupId === groupId
        ) &&
        reloadedChat.data.reads[bob.body.gameId].direct[alice.body.gameId] > 0
    );

    await request(`/api/groups/${encodeURIComponent(groupId)}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({ memberId: bob.body.gameId }),
    });
    const aliceLeave = await request(`/api/groups/${encodeURIComponent(groupId)}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: "{}",
    });
    const aliceAfterLeave = await request(
      `/api/messages?kind=group&targetId=${encodeURIComponent(groupId)}`,
      { headers: { "X-Doro-Token": alice.body.token } }
    );
    const afterLeave = new SocialStore(file);
    const bobAfterTransfer = await request(
      `/api/messages?kind=group&targetId=${encodeURIComponent(groupId)}`,
      { headers: { "X-Doro-Token": bob.body.token } }
    );
    check(
      "群主退出后立即失去权限并自动转让群主",
      aliceLeave.status === 200 &&
        aliceAfterLeave.status === 404 &&
        bobAfterTransfer.status === 200 &&
        bobAfterTransfer.body.conversation.group.isOwner &&
        afterLeave.data.groups[groupId].ownerId === bob.body.gameId
    );

    const bobDisband = await request(`/api/groups/${encodeURIComponent(groupId)}`, {
      method: "DELETE",
      headers: { "X-Doro-Token": bob.body.token },
    });
    const afterDisband = new SocialStore(file);
    check(
      "群主可以解散群组并清理群聊数据",
      bobDisband.status === 200 &&
        !afterDisband.data.groups[groupId] &&
        !afterDisband.data.messages.some((message) => message.groupId === groupId)
    );

    const reloaded = new SocialStore(file);
    check("Docker 数据文件可持久化重载", Boolean(reloaded.data.users[alice.body.gameId]));
    const unauthorized = await request("/api/social");
    check("无令牌不能读取好友资料", unauthorized.status === 401);

    await request("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": bob.body.token },
      body: JSON.stringify({ online: false }),
    });
    const offlineSearch = await request(`/api/directory?q=${bob.body.gameId}`);
    check("主动下线后好友状态立即变为离线", offlineSearch.body.users[0].online === false);

    const client = new SocialClient({
      profileFile: path.join(dir, "client-profile.json"),
      baseUrl: base,
      log: () => {},
    });
    const registered = await client.register({ nickname: "客户端测试" });
    check("客户端注册后会安全保存游戏 ID 与令牌", registered.ok && client.snapshot().configured);
    const clientSocial = await client.social();
    check(
      "客户端可以读取自己的好友与资料",
      clientSocial.ok && clientSocial.profile.gameId === registered.profile.gameId
    );
    const recoveryInfo = await client.issueRecovery();
    const recoveredClient = new SocialClient({
      profileFile: path.join(dir, "recovered-client-profile.json"),
      baseUrl: base,
      log: () => {},
    });
    const recoveredByClient = await recoveredClient.recover(
      registered.profile.gameId,
      recoveryInfo.recoveryCode
    );
    check(
      "客户端可保存恢复码并在新 profile 恢复同一身份",
      client.snapshot().recoveryAvailable &&
        recoveredByClient.ok &&
        recoveredClient.snapshot().gameId === registered.profile.gameId &&
        recoveredClient.snapshot().recoveryAvailable
    );

    await request("/api/leaderboard/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({
        scores: { level: 88, furniture: 230, fashion: 150, collection: 900 },
      }),
    });
    await request("/api/leaderboard/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": bob.body.token },
      body: JSON.stringify({
        scores: { level: 70, furniture: 400, fashion: 100, collection: 200 },
      }),
    });
    const ranking = await request("/api/leaderboards", {
      headers: { "X-Doro-Token": alice.body.token },
    });
    check(
      "排行榜按四类分数返回并标出自己的名次",
      ranking.body.boards.level.entries[0].gameId === alice.body.gameId &&
        ranking.body.boards.furniture.entries[0].gameId === bob.body.gameId &&
        ranking.body.boards.level.self.rank >= 1
    );
    const catalog = await request("/api/shop/catalog");
    check(
      "Docker 商城目录可公开读取并包含新家具和典藏",
      catalog.status === 200 &&
        catalog.body.catalog.furniture.bookshelf &&
        catalog.body.catalog.furniture.doro_throne &&
        catalog.body.catalog.items.luxury_aurora &&
        catalog.body.catalog.items.luxury_infinite_lounge &&
        catalog.body.catalog.items.fashion_starlight_hat
    );
    check(
      "Docker 目录已同步第二批各 10 款家具、服装和典藏",
      Object.keys(catalog.body.catalog.furniture).length === 26 &&
        catalog.body.catalog.furniture.forest_wish_pool?.score === 230000 &&
        Object.values(catalog.body.catalog.items).filter((item) => item.type === "fashion").length === 20 &&
        catalog.body.catalog.items.fashion_lunar_veil?.overlay === "fashion/lunar_veil.svg" &&
        Object.values(catalog.body.catalog.items).filter((item) => item.type === "luxury").length === 24 &&
        catalog.body.catalog.items.luxury_doro_universe?.bonus === 11.5
    );
    const entitlements = await request("/api/shop/entitlements", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Doro-Token": alice.body.token },
      body: JSON.stringify({
        entitlements: {
          items: { luxury_aurora: { permanent: true, expiresAt: 0 } },
          furniture: { bookshelf: { permanent: true, expiresAt: 0 } },
          dress: { dress_santa: { permanent: false, expiresAt: Date.now() + 86400000 } },
        },
      }),
    });
    check(
      "永久购买和租赁到期时间会写入 Docker 用户权益",
      entitlements.body.entitlements.items.luxury_aurora.permanent === true &&
        entitlements.body.entitlements.furniture.bookshelf.permanent === true &&
        entitlements.body.entitlements.dress.dress_santa.expiresAt > Date.now()
    );
    const reloadedEntitlements = new SocialStore(file);
    check(
      "商城永久与租赁权益会持久化到 Docker 数据文件",
      reloadedEntitlements.data.users[alice.body.gameId].entitlements.items.luxury_aurora.permanent ===
        true &&
        reloadedEntitlements.data.users[alice.body.gameId].entitlements.furniture.bookshelf.permanent === true
    );

    let fakeNow = Date.parse("2026-10-22T23:59:50+08:00");
    const rolloverFile = path.join(dir, "rollover.json");
    const rolloverStore = new SocialStore(rolloverFile, { now: () => fakeNow });
    const first = rolloverStore.register({ nickname: "榜首甲", level: 10 });
    const second = rolloverStore.register({ nickname: "榜首乙", level: 9 });
    rolloverStore.syncLeaderboard(
      rolloverStore.data.users[first.gameId],
      { level: 120, furniture: 300, fashion: 90, collection: 500 },
      fakeNow
    );
    rolloverStore.syncLeaderboard(
      rolloverStore.data.users[second.gameId],
      { level: 90, furniture: 500, fashion: 80, collection: 400 },
      fakeNow
    );
    fakeNow = nextShanghaiMidnight(fakeNow) + 1;
    const settled = rolloverStore.leaderboard(rolloverStore.data.users[first.gameId], fakeNow);
    check(
      "北京时间零点定榜并为各榜榜一发放限定典藏",
      settled.period.day === shanghaiDayKey(fakeNow) &&
        settled.winners.level.gameId === first.gameId &&
        settled.winners.furniture.gameId === second.gameId &&
        settled.awards.some((award) => award.id === "rank_level_crown") &&
        settled.activeBoosts.boards.includes("level") &&
        settled.activeBoosts.activeUntil > fakeNow
    );
    const boosted = rolloverStore.syncLeaderboard(
      rolloverStore.data.users[first.gameId],
      { level: 100, furniture: 10, fashion: 10, collection: 10 },
      fakeNow
    );
    rolloverStore.syncLeaderboard(
      rolloverStore.data.users[second.gameId],
      { level: 100, furniture: 900, fashion: 10, collection: 10 },
      fakeNow
    );
    const boostedView = rolloverStore.leaderboard(rolloverStore.data.users[first.gameId], fakeNow);
    check(
      "永耀会让榜一对应榜单当日分数提升 20%",
      boosted.boards.level.self.score === 120 &&
        boostedView.boards.level.self.score === 120 &&
        boostedView.boards.level.entries[0].gameId === first.gameId &&
        boostedView.activeBoosts.dailyIncomeBonuses.level === 1 &&
        boostedView.activeBoosts.permanentIncomeBonuses.level === 0.05
    );
    check(
      "上海时区日期与次日零点跨越正确",
      shanghaiDayKey(Date.parse("2026-10-22T23:59:59+08:00")) === "2026-10-22" &&
        shanghaiDayKey(Date.parse("2026-10-23T00:00:00+08:00")) === "2026-10-23"
    );
    const reloadedRollover = new SocialStore(rolloverFile, { now: () => fakeNow });
    check(
      "排行榜与榜一奖励会持久化到 Docker 数据文件",
      Boolean(
        reloadedRollover.data.awards[first.gameId] &&
        reloadedRollover.data.awards[first.gameId].rank_level_crown
      )
    );
    const recovered = await request("/api/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameId: alice.body.gameId,
        recoveryCode: alice.body.recoveryCode,
      }),
    });
    const recoveredSocial = await request("/api/social", {
      headers: { "X-Doro-Token": recovered.body.token },
    });
    check(
      "账号恢复码可在新设备换回身份并取回商城权益",
      recovered.status === 200 &&
        recovered.body.gameId === alice.body.gameId &&
        recovered.body.entitlements.items.luxury_aurora.permanent === true &&
        recoveredSocial.body.profile.gameId === alice.body.gameId
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n通过 ${passed} / ${passed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
