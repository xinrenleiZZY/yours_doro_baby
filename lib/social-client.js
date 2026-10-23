/* 局域网好友客户端：令牌只保存在本机 userData，网络请求走主进程。 */
"use strict";

const fs = require("fs");
const path = require("path");

function normalizeServerUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    return url.toString().replace(/\/+$/, "");
  } catch (err) {
    return "";
  }
}

class SocialClient {
  constructor({ profileFile, baseUrl, fetchImpl, log } = {}) {
    this.profileFile = profileFile;
    this.baseUrl = normalizeServerUrl(baseUrl) || "http://192.168.0.193:9500";
    this.fetchImpl = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    this.log = typeof log === "function" ? log : () => {};
    this.local = null;
  }

  load() {
    if (this.local) return this.local;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.profileFile, "utf8"));
      this.local =
        parsed && typeof parsed === "object"
          ? {
              serverUrl: normalizeServerUrl(parsed.serverUrl) || this.baseUrl,
              gameId: String(parsed.gameId || "").slice(0, 40),
              token: String(parsed.token || "").slice(0, 200),
              nickname: String(parsed.nickname || "").slice(0, 20),
              recoveryCode: String(parsed.recoveryCode || "").slice(0, 40),
            }
          : {};
    } catch (err) {
      this.local = {};
    }
    this.baseUrl = this.local.serverUrl || this.baseUrl;
    return this.local;
  }

  save() {
    fs.mkdirSync(path.dirname(this.profileFile), { recursive: true });
    const tmp = `${this.profileFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.local, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.profileFile);
  }

  async request(route, options = {}, auth = true) {
    if (typeof this.fetchImpl !== "function") return { ok: false, error: "fetch-unavailable" };
    const local = this.load();
    const controller = new globalThis.AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${route}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(auth && local.token ? { "X-Doro-Token": local.token } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      let body = {};
      try {
        body = await response.json();
      } catch (err) {
        body = {};
      }
      if (!response.ok) {
        return { ok: false, status: response.status, error: body.error || "http-error" };
      }
      return { ok: true, ...body };
    } catch (err) {
      this.log("warn", "局域网好友服务请求失败", err && err.message ? err.message : String(err));
      return {
        ok: false,
        error: err && err.name === "AbortError" ? "timeout" : "network",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  snapshot() {
    const local = this.load();
    return {
      configured: Boolean(local.gameId && local.token),
      serverUrl: this.baseUrl,
      gameId: local.gameId || "",
      nickname: local.nickname || "",
      recoveryAvailable: Boolean(local.recoveryCode),
    };
  }

  async register(input = {}) {
    const local = this.load();
    if (local.gameId && local.token) return { ok: true, snapshot: this.snapshot() };
    const result = await this.request(
      "/api/register",
      {
        method: "POST",
        body: {
          nickname: input.nickname,
          bio: input.bio,
          avatar: input.avatar,
          level: input.level,
          personality: input.personality,
          intimacyName: input.intimacyName,
        },
      },
      false
    );
    if (!result.ok) return result;
    this.local = {
      serverUrl: this.baseUrl,
      gameId: result.gameId,
      token: result.token,
      nickname: result.profile ? result.profile.nickname : "",
      recoveryCode: String(result.recoveryCode || ""),
    };
    this.save();
    return {
      ok: true,
      profile: result.profile,
      recoveryCode: result.recoveryCode,
      snapshot: this.snapshot(),
    };
  }

  async issueRecovery() {
    const local = this.load();
    if (local.recoveryCode) {
      return { ok: true, gameId: local.gameId, recoveryCode: local.recoveryCode };
    }
    const result = await this.request("/api/recovery/issue", { method: "POST", body: {} });
    if (!result.ok) return result;
    this.local = {
      ...local,
      serverUrl: this.baseUrl,
      gameId: result.gameId,
      recoveryCode: String(result.recoveryCode || ""),
    };
    this.save();
    return result;
  }

  async recover(gameId, recoveryCode) {
    const result = await this.request(
      "/api/recover",
      {
        method: "POST",
        body: {
          gameId: String(gameId || "").slice(0, 40),
          recoveryCode: String(recoveryCode || "").slice(0, 40),
        },
      },
      false
    );
    if (!result.ok) return result;
    this.local = {
      serverUrl: this.baseUrl,
      gameId: result.gameId,
      token: result.token,
      nickname: result.profile ? result.profile.nickname : "",
      recoveryCode: result.recoveryCode,
    };
    this.save();
    return result;
  }

  setServerUrl(value) {
    const url = normalizeServerUrl(value);
    if (!url) return { ok: false, error: "invalid-url" };
    const local = this.load();
    if (local.gameId || local.token) {
      return { ok: false, error: "already-registered" };
    }
    this.baseUrl = url;
    this.local = { ...local, serverUrl: url };
    this.save();
    return { ok: true, snapshot: this.snapshot() };
  }

  async social() {
    const local = this.load();
    if (!local.gameId || !local.token) return { ok: false, error: "not-registered" };
    const result = await this.request("/api/social");
    if (result.ok) {
      this.local.nickname = result.profile.nickname;
      this.save();
    }
    return result;
  }

  async updateProfile(input) {
    const result = await this.request("/api/profile", { method: "PUT", body: input });
    if (result.ok && result.profile) {
      this.local.nickname = result.profile.nickname;
      this.save();
    }
    return result;
  }

  search(query) {
    return this.request(
      `/api/directory?q=${encodeURIComponent(String(query || "").slice(0, 40))}`,
      {},
      false
    );
  }

  shopCatalog() {
    return this.request("/api/shop/catalog", {}, false);
  }

  syncShopEntitlements(entitlements) {
    return this.request("/api/shop/entitlements", {
      method: "POST",
      body: { entitlements },
    });
  }

  requestFriend(targetId, message) {
    return this.request("/api/friends/request", {
      method: "POST",
      body: { targetId, message: message ? String(message).slice(0, 80) : "" },
    });
  }

  respondFriend(requestId, accept) {
    return this.request("/api/friends/respond", {
      method: "POST",
      body: { requestId, accept: Boolean(accept) },
    });
  }

  removeFriend(friendId) {
    return this.request(`/api/friends/${encodeURIComponent(friendId)}`, { method: "DELETE" });
  }

  conversations() {
    return this.request("/api/conversations");
  }

  messages(kind, targetId) {
    return this.request(
      `/api/messages?kind=${encodeURIComponent(String(kind || ""))}&targetId=${encodeURIComponent(
        String(targetId || "")
      )}`
    );
  }

  sendMessage(payload) {
    const input = payload && typeof payload === "object" ? payload : {};
    return this.request("/api/messages", {
      method: "POST",
      body: {
        kind: input.kind === "group" ? "group" : "direct",
        peerId: input.kind === "direct" ? input.peerId : undefined,
        groupId: input.kind === "group" ? input.groupId : undefined,
        text: String(input.text || "").slice(0, 500),
      },
    });
  }

  createGroup(name, memberIds) {
    return this.request("/api/groups", {
      method: "POST",
      body: {
        name: String(name || "").slice(0, 30),
        memberIds: Array.isArray(memberIds) ? memberIds.slice(0, 50) : [],
      },
    });
  }

  renameGroup(groupId, name) {
    return this.request(`/api/groups/${encodeURIComponent(String(groupId || ""))}`, {
      method: "PUT",
      body: { name: String(name || "").slice(0, 30) },
    });
  }

  addGroupMember(groupId, memberId) {
    return this.request(`/api/groups/${encodeURIComponent(String(groupId || ""))}/members`, {
      method: "POST",
      body: { memberId: String(memberId || "").slice(0, 40) },
    });
  }

  removeGroupMember(groupId, memberId) {
    return this.request(
      `/api/groups/${encodeURIComponent(String(groupId || ""))}/members/${encodeURIComponent(
        String(memberId || "")
      )}`,
      { method: "DELETE" }
    );
  }

  leaveGroup(groupId) {
    return this.request(`/api/groups/${encodeURIComponent(String(groupId || ""))}/leave`, {
      method: "POST",
      body: {},
    });
  }

  disbandGroup(groupId) {
    return this.request(`/api/groups/${encodeURIComponent(String(groupId || ""))}`, {
      method: "DELETE",
    });
  }

  presence(online) {
    return this.request("/api/presence", { method: "POST", body: { online: Boolean(online) } });
  }

  syncLeaderboard(scores) {
    return this.request("/api/leaderboard/sync", {
      method: "POST",
      body: {
        scores: {
          level: scores && scores.level,
          furniture: scores && scores.furniture,
          fashion: scores && scores.fashion,
          collection: scores && scores.collection,
        },
      },
    });
  }

  leaderboards() {
    return this.request("/api/leaderboards");
  }
}

module.exports = { SocialClient, normalizeServerUrl };
