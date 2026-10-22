"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT) || 9500;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "social.json");
const MAX_BODY_BYTES = 32 * 1024;
const ONLINE_WINDOW_MS = 90 * 1000;
const MAX_USERS = 5000;
const MAX_FRIENDS = 200;

function emptyData() {
  return { version: 1, users: {}, requests: {}, friendships: {} };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function clean(value, max) {
  return String(value || "")
    .replace(/[\u0000-\u001f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function newGameId(users) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `doro_${crypto.randomBytes(4).toString("hex")}`;
    if (!users[id]) return id;
  }
  return `doro_${crypto.randomBytes(6).toString("hex")}`;
}

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

class SocialStore {
  constructor(file) {
    this.file = file;
    this.data = emptyData();
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object") {
        this.data = {
          version: 1,
          users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
          requests: parsed.requests && typeof parsed.requests === "object" ? parsed.requests : {},
          friendships: parsed.friendships && typeof parsed.friendships === "object" ? parsed.friendships : {},
        };
      }
    } catch (err) {
      this.data = emptyData();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  publicProfile(user, viewerId) {
    if (!user) return null;
    return {
      gameId: user.gameId,
      nickname: user.nickname,
      bio: user.bio,
      avatar: user.avatar || "🐣",
      level: user.level || 1,
      personality: user.personality || "温柔",
      intimacyName: user.intimacyName || "初次见面",
      online: user.manualOnline !== false && Date.now() - (user.lastSeen || 0) < ONLINE_WINDOW_MS,
      lastSeen: user.lastSeen || 0,
      isSelf: user.gameId === viewerId,
      createdAt: user.createdAt,
    };
  }

  register(input) {
    if (Object.keys(this.data.users).length >= MAX_USERS) return { error: "server-full" };
    const gameId = newGameId(this.data.users);
    const token = crypto.randomBytes(24).toString("base64url");
    const nickname = clean(input.nickname, 20) || `doro玩家-${gameId.slice(-4)}`;
    const now = Date.now();
    const user = {
      gameId,
      tokenHash: sha256(token),
      nickname,
      bio: clean(input.bio, 120),
      avatar: clean(input.avatar, 8) || "🐣",
      level: Math.max(1, Math.round(Number(input.level) || 1)),
      personality: clean(input.personality, 20) || "温柔",
      intimacyName: clean(input.intimacyName, 20) || "初次见面",
      lastSeen: now,
      manualOnline: true,
      createdAt: now,
      updatedAt: now,
    };
    this.data.users[gameId] = user;
    this.save();
    return { gameId, token, profile: this.publicProfile(user, gameId) };
  }

  authenticate(token) {
    if (!token) return null;
    const hash = sha256(token);
    return Object.values(this.data.users).find((user) => user.tokenHash === hash) || null;
  }

  updateProfile(user, input) {
    if (typeof input.nickname === "string" && clean(input.nickname, 20)) {
      user.nickname = clean(input.nickname, 20);
    }
    if (typeof input.bio === "string") user.bio = clean(input.bio, 120);
    if (typeof input.avatar === "string") user.avatar = clean(input.avatar, 8) || "🐣";
    if (Number.isFinite(Number(input.level))) user.level = Math.max(1, Math.round(Number(input.level)));
    if (typeof input.personality === "string") user.personality = clean(input.personality, 20);
    if (typeof input.intimacyName === "string") user.intimacyName = clean(input.intimacyName, 20);
    user.updatedAt = Date.now();
    this.save();
    return this.publicProfile(user, user.gameId);
  }

  touch(user, online) {
    user.lastSeen = Date.now();
    user.manualOnline = online === true;
    this.save();
  }

  search(query) {
    const text = clean(query, 40).toLowerCase();
    if (!text) return [];
    return Object.values(this.data.users)
      .filter(
        (user) =>
          user.gameId.toLowerCase() === text ||
          user.nickname.toLowerCase().includes(text) ||
          user.gameId.toLowerCase().includes(text)
      )
      .slice(0, 20)
      .map((user) => this.publicProfile(user, ""));
  }

  requestFriend(from, targetId, message) {
    if (from.gameId === targetId) return { error: "self" };
    const target = this.data.users[targetId];
    if (!target) return { error: "not-found" };
    if (this.areFriends(from.gameId, targetId)) return { error: "already-friends" };
    const duplicate = Object.values(this.data.requests).find(
      (request) =>
        request.status === "pending" &&
        ((request.fromId === from.gameId && request.toId === targetId) ||
          (request.fromId === targetId && request.toId === from.gameId))
    );
    if (duplicate) return { error: "pending" };
    const id = crypto.randomBytes(8).toString("hex");
    this.data.requests[id] = {
      id,
      fromId: from.gameId,
      toId: targetId,
      message: clean(message, 80),
      status: "pending",
      createdAt: Date.now(),
      respondedAt: 0,
    };
    this.save();
    return { request: this.data.requests[id] };
  }

  areFriends(a, b) {
    return Boolean(this.data.friendships[pairKey(a, b)]);
  }

  respondFriend(user, requestId, accept) {
    const request = this.data.requests[requestId];
    if (!request || request.toId !== user.gameId || request.status !== "pending") {
      return { error: "not-found" };
    }
    request.status = accept ? "accepted" : "rejected";
    request.respondedAt = Date.now();
    if (accept) {
      const key = pairKey(request.fromId, request.toId);
      this.data.friendships[key] = { users: [request.fromId, request.toId], createdAt: Date.now() };
    }
    this.save();
    return { request };
  }

  removeFriend(user, friendId) {
    const key = pairKey(user.gameId, friendId);
    if (!this.data.friendships[key]) return false;
    delete this.data.friendships[key];
    this.save();
    return true;
  }

  social(user) {
    const friends = Object.values(this.data.friendships)
      .filter((friendship) => friendship.users.includes(user.gameId))
      .map((friendship) => friendship.users.find((id) => id !== user.gameId))
      .map((id) => this.publicProfile(this.data.users[id], user.gameId))
      .filter(Boolean)
      .sort((a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname))
      .slice(0, MAX_FRIENDS);
    const incoming = Object.values(this.data.requests)
      .filter((request) => request.toId === user.gameId && request.status === "pending")
      .map((request) => ({
        ...request,
        from: this.publicProfile(this.data.users[request.fromId], user.gameId),
      }));
    const outgoing = Object.values(this.data.requests)
      .filter((request) => request.fromId === user.gameId && request.status === "pending")
      .map((request) => ({ ...request, to: this.publicProfile(this.data.users[request.toId], user.gameId) }));
    return {
      profile: this.publicProfile(user, user.gameId),
      friends,
      incoming,
      outgoing,
    };
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Doro-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too-large"));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (err) {
        reject(new Error("invalid-json"));
      }
    });
    req.on("error", reject);
  });
}

function createServer(store) {
  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      json(res, 204, {});
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, service: "doro-social", users: Object.keys(store.data.users).length });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/register") {
      try {
        const result = store.register(await readBody(req));
        json(res, result.error ? 400 : 201, result);
      } catch (err) {
        json(res, 400, { error: err.message });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/directory") {
      json(res, 200, { users: store.search(url.searchParams.get("q")) });
      return;
    }
    const token = req.headers["x-doro-token"];
    const user = store.authenticate(token);
    if (!user) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    try {
      if (req.method === "GET" && url.pathname === "/api/social") {
        store.touch(user, true);
        json(res, 200, store.social(user));
        return;
      }
      if (req.method === "PUT" && url.pathname === "/api/profile") {
        json(res, 200, { profile: store.updateProfile(user, await readBody(req)) });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/presence") {
        const body = await readBody(req);
        store.touch(user, body.online !== false);
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/friends/request") {
        const body = await readBody(req);
        const result = store.requestFriend(user, clean(body.targetId, 40), body.message);
        json(res, result.error ? 400 : 200, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/friends/respond") {
        const body = await readBody(req);
        const result = store.respondFriend(user, clean(body.requestId, 40), Boolean(body.accept));
        json(res, result.error ? 400 : 200, result);
        return;
      }
      if (req.method === "DELETE" && url.pathname.startsWith("/api/friends/")) {
        const friendId = decodeURIComponent(url.pathname.slice("/api/friends/".length));
        json(res, 200, { ok: store.removeFriend(user, friendId) });
        return;
      }
      json(res, 404, { error: "not-found" });
    } catch (err) {
      json(res, 400, { error: err.message || "bad-request" });
    }
  });
}

if (require.main === module) {
  const store = new SocialStore(DATA_FILE);
  const server = createServer(store);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[doro-social] listening on :${PORT}, data=${DATA_FILE}`);
  });
}

module.exports = { SocialStore, createServer, clean, pairKey };
