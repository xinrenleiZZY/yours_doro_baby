/* 局域网好友服务集成测试：node tools/test-social-server.js */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { SocialStore, createServer } = require("../social-server/server.js");
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n通过 ${passed} / 12`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
