"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT) || 9500;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "social.json");
const SHOP_CATALOG_FILE = process.env.SHOP_CATALOG_FILE || path.join(__dirname, "shop-catalog.json");
const MAX_BODY_BYTES = 32 * 1024;
const ONLINE_WINDOW_MS = 90 * 1000;
const MAX_USERS = 5000;
const MAX_FRIENDS = 200;
const MAX_GROUPS_PER_USER = 50;
const MAX_GROUP_MEMBERS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const MAX_MESSAGES = 20000;
const MAX_MESSAGE_LENGTH = 500;
const MESSAGE_RATE_WINDOW_MS = 10 * 1000;
const MESSAGE_RATE_LIMIT = 15;
const MAX_LEADERBOARD_ENTRIES = 50;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SCORE_KEYS = ["level", "furniture", "fashion", "collection"];
const LEADERBOARD_DEFINITIONS = Object.freeze({
  level: {
    label: "等级榜",
    rewardId: "rank_level_crown",
    rewardName: "摸鱼等级王冠",
    rewardIcon: "👑",
    effectName: "永耀",
    scoreMultiplier: 1.2,
    permanentIncomeBonus: 0.05,
    dailyIncomeBonus: 1,
  },
  furniture: {
    label: "家具榜",
    rewardId: "rank_furniture_trophy",
    rewardName: "家具大师奖杯",
    rewardIcon: "🏆",
    effectName: "永耀",
    scoreMultiplier: 1.2,
    permanentIncomeBonus: 0,
    dailyIncomeBonus: 2,
  },
  fashion: {
    label: "时装榜",
    rewardId: "rank_fashion_crown",
    rewardName: "时装之星皇冠",
    rewardIcon: "💎",
    effectName: "永耀",
    scoreMultiplier: 1.2,
    permanentIncomeBonus: 0,
    dailyIncomeBonus: 2,
  },
  collection: {
    label: "典藏榜",
    rewardId: "rank_collection_obelisk",
    rewardName: "典藏守护方尖碑",
    rewardIcon: "🗿",
    effectName: "永耀",
    scoreMultiplier: 1.2,
    permanentIncomeBonus: 0,
    dailyIncomeBonus: 2,
  },
});
let catalogCache = { mtimeMs: 0, data: null };

function shanghaiDayKey(now) {
  const ts = Number(now);
  return new Date((Number.isFinite(ts) ? ts : Date.now()) + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function nextShanghaiMidnight(now) {
  const ts = Number(now);
  const shifted = new Date((Number.isFinite(ts) ? ts : Date.now()) + SHANGHAI_OFFSET_MS);
  return (
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - SHANGHAI_OFFSET_MS
  );
}

function emptyScores(level) {
  return {
    level: Math.max(1, Math.round(Number(level) || 1)),
    furniture: 0,
    fashion: 0,
    collection: 0,
    updatedAt: 0,
  };
}

function emptyEntitlements() {
  return { version: 1, items: {}, furniture: {}, dress: {} };
}

function normalizeEntitlementMap(input) {
  const result = {};
  Object.entries(input && typeof input === "object" ? input : {})
    .slice(0, 500)
    .forEach(([id, value]) => {
      if (
        !/^[a-z][a-z0-9_]{0,39}$/.test(id) ||
        ["__proto__", "constructor", "prototype"].includes(id) ||
        !value ||
        typeof value !== "object"
      ) {
        return;
      }
      const permanent = value.permanent === true;
      const expiresAt = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(value.expiresAt) || 0));
      if (!permanent && !expiresAt) return;
      result[id] = { permanent, expiresAt };
    });
  return result;
}

function normalizeEntitlements(input) {
  return {
    version: 1,
    items: normalizeEntitlementMap(input && input.items),
    furniture: normalizeEntitlementMap(input && input.furniture),
    dress: normalizeEntitlementMap(input && input.dress),
  };
}

function mergeEntitlementMaps(local, remote) {
  const merged = { ...normalizeEntitlementMap(remote) };
  Object.entries(normalizeEntitlementMap(local)).forEach(([id, value]) => {
    const current = merged[id] || { permanent: false, expiresAt: 0 };
    merged[id] = {
      permanent: current.permanent || value.permanent,
      expiresAt: Math.max(current.expiresAt, value.expiresAt),
    };
  });
  return merged;
}

function mergeEntitlements(server, local) {
  return {
    version: 1,
    items: mergeEntitlementMaps(local && local.items, server && server.items),
    furniture: mergeEntitlementMaps(local && local.furniture, server && server.furniture),
    dress: mergeEntitlementMaps(local && local.dress, server && server.dress),
  };
}

function loadShopCatalog() {
  try {
    const stat = fs.statSync(SHOP_CATALOG_FILE);
    if (catalogCache.data && catalogCache.mtimeMs === stat.mtimeMs) return catalogCache.data;
    const parsed = JSON.parse(fs.readFileSync(SHOP_CATALOG_FILE, "utf8"));
    catalogCache = {
      mtimeMs: stat.mtimeMs,
      data:
        parsed && typeof parsed === "object"
          ? {
              version: clean(parsed.version, 40) || "1",
              updatedAt: clean(parsed.updatedAt, 40),
              items: parsed.items && typeof parsed.items === "object" ? parsed.items : {},
              furniture: parsed.furniture && typeof parsed.furniture === "object" ? parsed.furniture : {},
              dresses: parsed.dresses && typeof parsed.dresses === "object" ? parsed.dresses : {},
            }
          : { version: "1", items: {}, furniture: {}, dresses: {} },
    };
    return catalogCache.data;
  } catch (err) {
    return catalogCache.data || { version: "1", items: {}, furniture: {}, dresses: {} };
  }
}

function emptyLeaderboard(now) {
  return {
    day: shanghaiDayKey(now),
    scores: {},
    winners: {},
    settledAt: 0,
    history: [],
  };
}

function emptyData(now) {
  return {
    version: 5,
    users: {},
    requests: {},
    friendships: {},
    groups: {},
    messages: [],
    reads: {},
    leaderboard: emptyLeaderboard(now),
    awards: {},
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeRecoveryCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 32);
}

function recoveryHash(value) {
  return sha256(`doro-recovery:${normalizeRecoveryCode(value)}`);
}

function newRecoveryCode() {
  return crypto.randomBytes(8).toString("hex").toUpperCase().match(/.{4}/g).join("-");
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

function normalizeReads(input, users) {
  const result = {};
  Object.entries(input && typeof input === "object" ? input : {}).forEach(([gameId, value]) => {
    if (!users[gameId] || !value || typeof value !== "object") return;
    const direct = {};
    const group = {};
    Object.entries(value.direct && typeof value.direct === "object" ? value.direct : {}).forEach(
      ([id, at]) => {
        if (id && Number.isFinite(Number(at))) direct[id] = Math.max(0, Number(at));
      }
    );
    Object.entries(value.group && typeof value.group === "object" ? value.group : {}).forEach(([id, at]) => {
      if (id && Number.isFinite(Number(at))) group[id] = Math.max(0, Number(at));
    });
    result[gameId] = { direct, group };
  });
  return result;
}

function normalizeGroups(input, users) {
  const result = {};
  Object.values(input && typeof input === "object" ? input : {})
    .slice(0, MAX_USERS * MAX_GROUPS_PER_USER)
    .forEach((value) => {
      if (!value || typeof value !== "object") return;
      const id = clean(value.id, 40);
      const ownerId = clean(value.ownerId, 40);
      if (!/^grp_[a-f0-9]{12}$/.test(id) || !users[ownerId]) return;
      const memberIds = Array.from(
        new Set(
          (Array.isArray(value.memberIds) ? value.memberIds : [])
            .map((memberId) => clean(memberId, 40))
            .filter((memberId) => users[memberId])
        )
      ).slice(0, MAX_GROUP_MEMBERS);
      if (!memberIds.includes(ownerId)) memberIds.unshift(ownerId);
      result[id] = {
        id,
        name: clean(value.name, 30) || "doro 小群",
        ownerId,
        memberIds: memberIds.slice(0, MAX_GROUP_MEMBERS),
        createdAt: Math.max(0, Number(value.createdAt) || 0),
        updatedAt: Math.max(0, Number(value.updatedAt) || 0),
      };
    });
  return result;
}

function normalizeMessages(input, users, groups) {
  return (Array.isArray(input) ? input : [])
    .map((value) => {
      if (!value || typeof value !== "object" || !users[value.senderId]) return null;
      const kind = value.kind === "group" ? "group" : value.kind === "direct" ? "direct" : "";
      if (!kind) return null;
      const targetId = clean(kind === "group" ? value.groupId : value.peerId, 40);
      if (!targetId) return null;
      if (kind === "group" && !groups[targetId]) return null;
      return {
        id: clean(value.id, 50) || `msg_${crypto.randomBytes(8).toString("hex")}`,
        kind,
        senderId: value.senderId,
        ...(kind === "group" ? { groupId: targetId } : { peerId: targetId }),
        text: clean(value.text, MAX_MESSAGE_LENGTH),
        createdAt: Math.max(0, Number(value.createdAt) || 0),
      };
    })
    .filter((message) => message && message.text && message.createdAt)
    .slice(-MAX_MESSAGES);
}

function normalizeScores(input) {
  const scores = input && typeof input === "object" ? input : {};
  return {
    level: Math.min(10000000, Math.max(1, Math.round(Number(scores.level) || 1))),
    furniture: Math.min(1000000000, Math.max(0, Math.round(Number(scores.furniture) || 0))),
    fashion: Math.min(1000000000, Math.max(0, Math.round(Number(scores.fashion) || 0))),
    collection: Math.min(1000000000, Math.max(0, Math.round(Number(scores.collection) || 0))),
  };
}

function winnerEntry(user, score) {
  return {
    gameId: user.gameId,
    nickname: user.nickname,
    avatar: user.avatar || "🐣",
    score: Number(score) || 0,
  };
}

function effectiveBoardScore(gameId, board, rawScore, winners) {
  const score = Math.max(0, Number(rawScore) || 0);
  return winners && winners[board] && winners[board].gameId === gameId
    ? Math.round(score * LEADERBOARD_DEFINITIONS[board].scoreMultiplier)
    : score;
}

function settleScores(scores, users, day, settledAt, activeWinners = {}) {
  const winners = {};
  SCORE_KEYS.forEach((key) => {
    const ranked = Object.entries(scores || {})
      .filter(([gameId]) => users[gameId])
      .map(([gameId, values]) => ({
        user: users[gameId],
        score: effectiveBoardScore(gameId, key, values && values[key], activeWinners),
        updatedAt: Math.max(0, Number(values && values.updatedAt) || 0),
      }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.updatedAt - b.updatedAt || a.user.gameId.localeCompare(b.user.gameId)
      );
    winners[key] = ranked.length
      ? {
          day,
          settledAt,
          rewardId: LEADERBOARD_DEFINITIONS[key].rewardId,
          ...winnerEntry(ranked[0].user, ranked[0].score),
        }
      : null;
  });
  return winners;
}

class SocialStore {
  constructor(file, options = {}) {
    this.file = file;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.data = emptyData(this.now());
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object") {
        const normalizedLeaderboard =
          parsed.leaderboard && typeof parsed.leaderboard === "object"
            ? parsed.leaderboard
            : emptyLeaderboard(this.now());
        const users = parsed.users && typeof parsed.users === "object" ? parsed.users : {};
        const groups = normalizeGroups(parsed.groups, users);
        this.data = {
          version: 5,
          users,
          requests: parsed.requests && typeof parsed.requests === "object" ? parsed.requests : {},
          friendships: parsed.friendships && typeof parsed.friendships === "object" ? parsed.friendships : {},
          groups,
          messages: normalizeMessages(parsed.messages, users, groups),
          reads: normalizeReads(parsed.reads, users),
          leaderboard: {
            day: /^\d{4}-\d{2}-\d{2}$/.test(normalizedLeaderboard.day)
              ? normalizedLeaderboard.day
              : shanghaiDayKey(this.now()),
            scores:
              normalizedLeaderboard.scores && typeof normalizedLeaderboard.scores === "object"
                ? normalizedLeaderboard.scores
                : {},
            winners:
              normalizedLeaderboard.winners && typeof normalizedLeaderboard.winners === "object"
                ? normalizedLeaderboard.winners
                : {},
            settledAt: Number(normalizedLeaderboard.settledAt) || 0,
            history: Array.isArray(normalizedLeaderboard.history)
              ? normalizedLeaderboard.history.slice(-60)
              : [],
          },
          awards: parsed.awards && typeof parsed.awards === "object" ? parsed.awards : {},
        };
      }
    } catch (err) {
      this.data = emptyData(this.now());
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
    const recoveryCode = newRecoveryCode();
    const nickname = clean(input.nickname, 20) || `doro玩家-${gameId.slice(-4)}`;
    const now = this.now();
    const user = {
      gameId,
      tokenHash: sha256(token),
      recoveryHash: recoveryHash(recoveryCode),
      nickname,
      bio: clean(input.bio, 120),
      avatar: clean(input.avatar, 8) || "🐣",
      level: Math.max(1, Math.round(Number(input.level) || 1)),
      personality: clean(input.personality, 20) || "温柔",
      intimacyName: clean(input.intimacyName, 20) || "初次见面",
      lastSeen: now,
      manualOnline: true,
      entitlements: emptyEntitlements(),
      createdAt: now,
      updatedAt: now,
    };
    this.data.users[gameId] = user;
    this.ensureLeaderboard(now);
    this.data.leaderboard.scores[gameId] = emptyScores(user.level);
    this.save();
    return { gameId, token, recoveryCode, profile: this.publicProfile(user, gameId) };
  }

  authenticate(token) {
    if (!token) return null;
    const hash = sha256(token);
    return Object.values(this.data.users).find((user) => user.tokenHash === hash) || null;
  }

  issueRecovery(user) {
    if (user.recoveryHash) return { error: "already-issued" };
    const recoveryCode = newRecoveryCode();
    user.recoveryHash = recoveryHash(recoveryCode);
    user.recoveryUpdatedAt = Date.now();
    this.save();
    return { ok: true, gameId: user.gameId, recoveryCode };
  }

  recover(gameId, code) {
    const user = this.data.users[clean(gameId, 40)];
    const normalized = normalizeRecoveryCode(code);
    if (!user || !user.recoveryHash || normalized.length < 16) {
      return { error: "invalid-recovery" };
    }
    const expected = Buffer.from(user.recoveryHash, "hex");
    const actual = Buffer.from(recoveryHash(normalized), "hex");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { error: "invalid-recovery" };
    }
    const token = crypto.randomBytes(24).toString("base64url");
    const recoveryCode = newRecoveryCode();
    user.tokenHash = sha256(token);
    user.recoveryHash = recoveryHash(recoveryCode);
    user.recoveryUpdatedAt = Date.now();
    user.updatedAt = Date.now();
    this.save();
    return {
      ok: true,
      gameId: user.gameId,
      token,
      recoveryCode,
      profile: this.publicProfile(user, user.gameId),
      entitlements: user.entitlements || emptyEntitlements(),
    };
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

  syncEntitlements(user, input, now) {
    user.entitlements = mergeEntitlements(user.entitlements || emptyEntitlements(), input);
    user.entitlementsUpdatedAt = Number(now) || Date.now();
    this.save();
    return { ok: true, entitlements: user.entitlements, updatedAt: user.entitlementsUpdatedAt };
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

  groupHasMember(group, gameId) {
    return Boolean(group && Array.isArray(group.memberIds) && group.memberIds.includes(gameId));
  }

  groupView(group, viewerId) {
    if (!group) return null;
    const members = group.memberIds
      .map((gameId) => this.publicProfile(this.data.users[gameId], viewerId))
      .filter(Boolean)
      .sort(
        (a, b) =>
          Number(b.gameId === group.ownerId) - Number(a.gameId === group.ownerId) ||
          Number(b.online) - Number(a.online) ||
          a.nickname.localeCompare(b.nickname)
      );
    return {
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      owner: this.publicProfile(this.data.users[group.ownerId], viewerId),
      memberIds: [...group.memberIds],
      members,
      memberCount: members.length,
      isOwner: group.ownerId === viewerId,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  readState(user, kind) {
    if (!this.data.reads[user.gameId]) this.data.reads[user.gameId] = { direct: {}, group: {} };
    const state = this.data.reads[user.gameId];
    if (!state.direct || typeof state.direct !== "object") state.direct = {};
    if (!state.group || typeof state.group !== "object") state.group = {};
    return state[kind];
  }

  conversationMessages(user, kind, targetId) {
    if (kind === "group") {
      return this.data.messages.filter((message) => message.kind === "group" && message.groupId === targetId);
    }
    const key = pairKey(user.gameId, targetId);
    return this.data.messages.filter(
      (message) => message.kind === "direct" && pairKey(message.senderId, message.peerId) === key
    );
  }

  publicMessage(message, viewerId) {
    if (!message) return null;
    return {
      ...message,
      mine: message.senderId === viewerId,
      sender: this.publicProfile(this.data.users[message.senderId], viewerId),
    };
  }

  markConversationRead(user, kind, targetId, at) {
    const reads = this.readState(user, kind);
    reads[targetId] = Math.max(Number(reads[targetId]) || 0, Number(at) || this.now());
  }

  conversations(user) {
    const conversations = [];
    Object.values(this.data.friendships)
      .filter((friendship) => friendship.users.includes(user.gameId))
      .forEach((friendship) => {
        const peerId = friendship.users.find((id) => id !== user.gameId);
        const profile = this.publicProfile(this.data.users[peerId], user.gameId);
        if (!profile) return;
        const messages = this.conversationMessages(user, "direct", peerId);
        const last = messages[messages.length - 1];
        const readAt = this.readState(user, "direct")[peerId] || 0;
        conversations.push({
          kind: "direct",
          id: peerId,
          title: profile.nickname,
          avatar: profile.avatar,
          online: profile.online,
          peer: profile,
          unread: messages.filter((message) => message.senderId !== user.gameId && message.createdAt > readAt)
            .length,
          lastMessage: this.publicMessage(last, user.gameId),
          lastAt: last ? last.createdAt : friendship.createdAt || 0,
        });
      });
    Object.values(this.data.groups)
      .filter((group) => this.groupHasMember(group, user.gameId))
      .forEach((group) => {
        const messages = this.conversationMessages(user, "group", group.id);
        const last = messages[messages.length - 1];
        const readAt = this.readState(user, "group")[group.id] || 0;
        conversations.push({
          kind: "group",
          id: group.id,
          title: group.name,
          avatar: "👥",
          online: group.memberIds.some((gameId) => {
            const member = this.data.users[gameId];
            return (
              gameId !== user.gameId &&
              member &&
              member.manualOnline !== false &&
              Date.now() - (member.lastSeen || 0) < ONLINE_WINDOW_MS
            );
          }),
          group: this.groupView(group, user.gameId),
          unread: messages.filter((message) => message.senderId !== user.gameId && message.createdAt > readAt)
            .length,
          lastMessage: this.publicMessage(last, user.gameId),
          lastAt: last ? last.createdAt : group.updatedAt || group.createdAt || 0,
        });
      });
    return conversations
      .sort((a, b) => b.lastAt - a.lastAt || Number(b.online) - Number(a.online))
      .slice(0, MAX_FRIENDS + MAX_GROUPS_PER_USER);
  }

  messages(user, kind, targetId) {
    const normalizedKind = kind === "group" ? "group" : kind === "direct" ? "direct" : "";
    const id = clean(targetId, 40);
    if (!normalizedKind || !id) return { error: "not-found" };
    let conversation;
    if (normalizedKind === "group") {
      const group = this.data.groups[id];
      if (!this.groupHasMember(group, user.gameId)) return { error: "not-found" };
      conversation = {
        kind: "group",
        id,
        title: group.name,
        avatar: "👥",
        group: this.groupView(group, user.gameId),
      };
    } else {
      const peer = this.data.users[id];
      if (!peer || !this.areFriends(user.gameId, id)) return { error: "not-found" };
      conversation = {
        kind: "direct",
        id,
        title: peer.nickname,
        avatar: peer.avatar || "🐣",
        peer: this.publicProfile(peer, user.gameId),
      };
    }
    const allMessages = this.conversationMessages(user, normalizedKind, id);
    const readAt = this.readState(user, normalizedKind)[id] || 0;
    const hasUnread = allMessages.some(
      (message) => message.senderId !== user.gameId && message.createdAt > readAt
    );
    if (hasUnread) {
      this.markConversationRead(user, normalizedKind, id, this.now());
      this.save();
    }
    const messages = allMessages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    return {
      ok: true,
      conversation,
      messages: messages.map((message) => this.publicMessage(message, user.gameId)),
    };
  }

  sendMessage(user, input) {
    const kind = input.kind === "group" ? "group" : input.kind === "direct" ? "direct" : "";
    const targetId = clean(kind === "group" ? input.groupId : input.peerId, 40);
    const text = clean(input.text, MAX_MESSAGE_LENGTH);
    if (!kind || !targetId) return { error: "not-found" };
    if (!text) return { error: "empty-message" };
    const now = this.now();
    if (
      this.data.messages.filter(
        (message) => message.senderId === user.gameId && message.createdAt > now - MESSAGE_RATE_WINDOW_MS
      ).length >= MESSAGE_RATE_LIMIT
    ) {
      return { error: "rate-limited" };
    }
    let message;
    if (kind === "group") {
      const group = this.data.groups[targetId];
      if (!this.groupHasMember(group, user.gameId)) return { error: "forbidden" };
      group.updatedAt = now;
      message = {
        id: `msg_${crypto.randomBytes(8).toString("hex")}`,
        kind,
        senderId: user.gameId,
        groupId: targetId,
        text,
        createdAt: now,
      };
    } else {
      if (targetId === user.gameId) return { error: "self" };
      if (!this.data.users[targetId]) return { error: "not-found" };
      if (!this.areFriends(user.gameId, targetId)) return { error: "forbidden" };
      message = {
        id: `msg_${crypto.randomBytes(8).toString("hex")}`,
        kind,
        senderId: user.gameId,
        peerId: targetId,
        text,
        createdAt: now,
      };
    }
    this.data.messages.push(message);
    const key = kind === "group" ? `group:${targetId}` : `direct:${pairKey(user.gameId, targetId)}`;
    const sameConversation = this.data.messages.filter((item) =>
      item.kind === "group"
        ? `group:${item.groupId}` === key
        : `direct:${pairKey(item.senderId, item.peerId)}` === key
    );
    if (sameConversation.length > MAX_MESSAGES_PER_CONVERSATION) {
      const removeIds = new Set(
        sameConversation
          .slice(0, sameConversation.length - MAX_MESSAGES_PER_CONVERSATION)
          .map((item) => item.id)
      );
      this.data.messages = this.data.messages.filter((item) => !removeIds.has(item.id));
    }
    this.data.messages = this.data.messages.slice(-MAX_MESSAGES);
    this.save();
    return { ok: true, message: this.publicMessage(message, user.gameId) };
  }

  createGroup(user, input) {
    const ownedOrJoined = Object.values(this.data.groups).filter((group) =>
      this.groupHasMember(group, user.gameId)
    ).length;
    if (ownedOrJoined >= MAX_GROUPS_PER_USER) return { error: "group-limit" };
    const name = clean(input.name, 30);
    if (!name) return { error: "empty-group-name" };
    const now = this.now();
    const memberIds = Array.from(
      new Set(
        [user.gameId, ...(Array.isArray(input.memberIds) ? input.memberIds : [])]
          .map((id) => clean(id, 40))
          .filter((id) => id === user.gameId || this.areFriends(user.gameId, id))
      )
    ).slice(0, MAX_GROUP_MEMBERS);
    const id = `grp_${crypto.randomBytes(6).toString("hex")}`;
    const group = {
      id,
      name,
      ownerId: user.gameId,
      memberIds,
      createdAt: now,
      updatedAt: now,
    };
    this.data.groups[id] = group;
    this.save();
    return { ok: true, group: this.groupView(group, user.gameId) };
  }

  renameGroup(user, groupId, name) {
    const group = this.data.groups[clean(groupId, 40)];
    if (!this.groupHasMember(group, user.gameId)) return { error: "not-found" };
    if (group.ownerId !== user.gameId) return { error: "forbidden" };
    const nextName = clean(name, 30);
    if (!nextName) return { error: "empty-group-name" };
    group.name = nextName;
    group.updatedAt = this.now();
    this.save();
    return { ok: true, group: this.groupView(group, user.gameId) };
  }

  addGroupMember(user, groupId, memberId) {
    const group = this.data.groups[clean(groupId, 40)];
    const targetId = clean(memberId, 40);
    if (!this.groupHasMember(group, user.gameId)) return { error: "not-found" };
    if (group.ownerId !== user.gameId) return { error: "forbidden" };
    if (!this.data.users[targetId]) return { error: "not-found" };
    if (!this.areFriends(user.gameId, targetId)) return { error: "friend-only" };
    if (this.groupHasMember(group, targetId)) return { error: "already-member" };
    if (group.memberIds.length >= MAX_GROUP_MEMBERS) return { error: "group-full" };
    group.memberIds.push(targetId);
    group.updatedAt = this.now();
    this.save();
    return { ok: true, group: this.groupView(group, user.gameId) };
  }

  removeGroupMember(user, groupId, memberId) {
    const group = this.data.groups[clean(groupId, 40)];
    const targetId = clean(memberId, 40);
    if (!this.groupHasMember(group, user.gameId)) return { error: "not-found" };
    if (group.ownerId !== user.gameId || targetId === group.ownerId) return { error: "forbidden" };
    if (!this.groupHasMember(group, targetId)) return { error: "not-member" };
    group.memberIds = group.memberIds.filter((id) => id !== targetId);
    group.updatedAt = this.now();
    this.save();
    return { ok: true, group: this.groupView(group, user.gameId) };
  }

  leaveGroup(user, groupId) {
    const group = this.data.groups[clean(groupId, 40)];
    if (!this.groupHasMember(group, user.gameId)) return { error: "not-found" };
    group.memberIds = group.memberIds.filter((id) => id !== user.gameId);
    group.updatedAt = this.now();
    if (!group.memberIds.length) {
      delete this.data.groups[group.id];
      this.data.messages = this.data.messages.filter((message) => message.groupId !== group.id);
      Object.values(this.data.reads).forEach((reads) => {
        if (reads.group) delete reads.group[group.id];
      });
    } else if (group.ownerId === user.gameId) {
      group.ownerId = group.memberIds[0];
    }
    this.save();
    return { ok: true };
  }

  disbandGroup(user, groupId) {
    const group = this.data.groups[clean(groupId, 40)];
    if (!this.groupHasMember(group, user.gameId)) return { error: "not-found" };
    if (group.ownerId !== user.gameId) return { error: "forbidden" };
    delete this.data.groups[group.id];
    this.data.messages = this.data.messages.filter((message) => message.groupId !== group.id);
    Object.values(this.data.reads).forEach((reads) => {
      if (reads.group) delete reads.group[group.id];
    });
    this.save();
    return { ok: true };
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

  ensureLeaderboard(now) {
    const ts = Number(now) || this.now();
    if (!this.data.leaderboard || typeof this.data.leaderboard !== "object") {
      this.data.leaderboard = emptyLeaderboard(ts);
    }
    const leaderboard = this.data.leaderboard;
    const currentDay = shanghaiDayKey(ts);
    if (!leaderboard.day) leaderboard.day = currentDay;
    if (!leaderboard.scores || typeof leaderboard.scores !== "object") leaderboard.scores = {};
    if (!leaderboard.winners || typeof leaderboard.winners !== "object") leaderboard.winners = {};
    if (!Array.isArray(leaderboard.history)) leaderboard.history = [];
    if (leaderboard.day === currentDay) {
      let changed = false;
      Object.values(this.data.users).forEach((user) => {
        if (!leaderboard.scores[user.gameId]) {
          leaderboard.scores[user.gameId] = emptyScores(user.level);
          changed = true;
        }
      });
      if (changed) this.save();
      return null;
    }
    if (leaderboard.day > currentDay) return null;

    const previousDay = leaderboard.day;
    const winners = settleScores(leaderboard.scores, this.data.users, previousDay, ts, leaderboard.winners);
    if (!this.data.awards || typeof this.data.awards !== "object") this.data.awards = {};
    SCORE_KEYS.forEach((key) => {
      const winner = winners[key];
      if (!winner) return;
      const award = LEADERBOARD_DEFINITIONS[key];
      const userAwards =
        this.data.awards[winner.gameId] && typeof this.data.awards[winner.gameId] === "object"
          ? this.data.awards[winner.gameId]
          : {};
      if (!userAwards[award.rewardId]) {
        userAwards[award.rewardId] = {
          id: award.rewardId,
          board: key,
          day: previousDay,
          awardedAt: ts,
        };
      }
      this.data.awards[winner.gameId] = userAwards;
    });
    leaderboard.winners = winners;
    leaderboard.history.push({ day: previousDay, settledAt: ts, winners });
    leaderboard.history = leaderboard.history.slice(-60);
    leaderboard.settledAt = ts;
    leaderboard.day = currentDay;
    leaderboard.scores = {};
    Object.values(this.data.users).forEach((user) => {
      leaderboard.scores[user.gameId] = emptyScores(user.level);
    });
    this.save();
    return { day: previousDay, settledAt: ts, winners };
  }

  activeChampionBoards(user) {
    const winners = (this.data.leaderboard && this.data.leaderboard.winners) || {};
    return SCORE_KEYS.filter((board) => winners[board] && winners[board].gameId === user.gameId);
  }

  activeBoosts(user, now) {
    const ts = Number(now) || this.now();
    return {
      effectName: "永耀",
      period: this.data.leaderboard.day,
      activeUntil: nextShanghaiMidnight(ts),
      scoreMultiplier: 1.2,
      permanentIncomeBonuses: Object.fromEntries(
        SCORE_KEYS.map((board) => [board, LEADERBOARD_DEFINITIONS[board].permanentIncomeBonus])
      ),
      dailyIncomeBonuses: Object.fromEntries(
        SCORE_KEYS.map((board) => [board, LEADERBOARD_DEFINITIONS[board].dailyIncomeBonus])
      ),
      boards: this.activeChampionBoards(user),
    };
  }

  championAwards(user) {
    const owned =
      this.data.awards && this.data.awards[user.gameId] && typeof this.data.awards[user.gameId] === "object"
        ? this.data.awards[user.gameId]
        : {};
    return Object.values(LEADERBOARD_DEFINITIONS)
      .filter((award) => owned[award.rewardId])
      .map((award) => ({
        id: award.rewardId,
        name: award.rewardName,
        icon: award.rewardIcon,
        effectName: award.effectName,
        scoreMultiplier: award.scoreMultiplier,
        permanentIncomeBonus: award.permanentIncomeBonus,
        dailyIncomeBonus: award.dailyIncomeBonus,
        ...owned[award.rewardId],
      }));
  }

  syncLeaderboard(user, input, now) {
    const ts = Number(now) || this.now();
    this.ensureLeaderboard(ts);
    const scores = normalizeScores(input);
    this.data.leaderboard.scores[user.gameId] = { ...scores, updatedAt: ts };
    user.updatedAt = ts;
    this.save();
    return this.leaderboard(user, ts, false);
  }

  leaderboard(user, now, ensure = true) {
    const ts = Number(now) || this.now();
    if (ensure) this.ensureLeaderboard(ts);
    const scores = this.data.leaderboard.scores || {};
    const activeWinners = this.data.leaderboard.winners || {};
    const boards = {};
    SCORE_KEYS.forEach((key) => {
      const ranked = Object.entries(scores)
        .filter(([gameId]) => this.data.users[gameId])
        .map(([gameId, values]) => ({
          user: this.data.users[gameId],
          score: effectiveBoardScore(gameId, key, values && values[key], activeWinners),
          updatedAt: Math.max(0, Number(values && values.updatedAt) || 0),
        }))
        .sort(
          (a, b) =>
            b.score - a.score || a.updatedAt - b.updatedAt || a.user.gameId.localeCompare(b.user.gameId)
        );
      const top = ranked.slice(0, MAX_LEADERBOARD_ENTRIES).map((entry, index) => ({
        rank: index + 1,
        ...winnerEntry(entry.user, entry.score),
        isSelf: entry.user.gameId === user.gameId,
      }));
      const ownIndex = ranked.findIndex((entry) => entry.user.gameId === user.gameId);
      boards[key] = {
        entries: top,
        self:
          ownIndex >= 0
            ? { rank: ownIndex + 1, ...winnerEntry(ranked[ownIndex].user, ranked[ownIndex].score) }
            : null,
      };
    });
    return {
      ok: true,
      period: {
        day: this.data.leaderboard.day,
        nextResetAt: nextShanghaiMidnight(ts),
        timezone: "Asia/Shanghai",
      },
      boards,
      winners: this.data.leaderboard.winners || {},
      definitions: LEADERBOARD_DEFINITIONS,
      awards: this.championAwards(user),
      activeBoosts: this.activeBoosts(user, ts),
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
      const catalog = loadShopCatalog();
      json(res, 200, {
        ok: true,
        service: "doro-social",
        version: 5,
        leaderboards: SCORE_KEYS,
        shopCatalog: catalog.version,
        users: Object.keys(store.data.users).length,
        messages: store.data.messages.length,
        groups: Object.keys(store.data.groups).length,
      });
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
    if (req.method === "POST" && url.pathname === "/api/recover") {
      try {
        const body = await readBody(req);
        const result = store.recover(body.gameId, body.recoveryCode);
        json(res, result.error ? 400 : 200, result);
      } catch (err) {
        json(res, 400, { error: err.message });
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/shop/catalog") {
      json(res, 200, { catalog: loadShopCatalog() });
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
      if (req.method === "POST" && url.pathname === "/api/recovery/issue") {
        json(res, 200, store.issueRecovery(user));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/presence") {
        const body = await readBody(req);
        store.touch(user, body.online !== false);
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/leaderboard/sync") {
        const body = await readBody(req);
        json(res, 200, store.syncLeaderboard(user, body && body.scores, Date.now()));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/leaderboards") {
        store.touch(user, user.manualOnline !== false);
        json(res, 200, store.leaderboard(user, Date.now()));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/shop/entitlements") {
        const body = await readBody(req);
        json(
          res,
          200,
          store.syncEntitlements(user, normalizeEntitlements(body && body.entitlements), Date.now())
        );
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/conversations") {
        const conversations = store.conversations(user);
        const groups = conversations
          .filter((conversation) => conversation.kind === "group")
          .map((conversation) => conversation.group)
          .filter(Boolean);
        json(res, 200, { ok: true, conversations, groups });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/messages") {
        const result = store.messages(user, url.searchParams.get("kind"), url.searchParams.get("targetId"));
        json(res, result.error ? 404 : 200, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/messages") {
        const result = store.sendMessage(user, await readBody(req));
        const status =
          result.error === "forbidden"
            ? 403
            : result.error === "rate-limited"
              ? 429
              : result.error
                ? 400
                : 201;
        json(res, status, result);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/groups") {
        const result = store.createGroup(user, await readBody(req));
        json(res, result.error ? 400 : 201, result);
        return;
      }
      const groupMemberMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/members(?:\/([^/]+))?$/);
      if (groupMemberMatch) {
        const groupId = decodeURIComponent(groupMemberMatch[1]);
        const memberId = groupMemberMatch[2] ? decodeURIComponent(groupMemberMatch[2]) : "";
        if (req.method === "POST" && !memberId) {
          const body = await readBody(req);
          const result = store.addGroupMember(user, groupId, body.memberId);
          json(res, result.error ? (result.error === "forbidden" ? 403 : 400) : 200, result);
          return;
        }
        if (req.method === "DELETE" && memberId) {
          const result = store.removeGroupMember(user, groupId, memberId);
          json(res, result.error ? (result.error === "forbidden" ? 403 : 400) : 200, result);
          return;
        }
      }
      const groupLeaveMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/leave$/);
      if (req.method === "POST" && groupLeaveMatch) {
        const result = store.leaveGroup(user, decodeURIComponent(groupLeaveMatch[1]));
        json(res, result.error ? 400 : 200, result);
        return;
      }
      const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
      if (groupMatch) {
        const groupId = decodeURIComponent(groupMatch[1]);
        if (req.method === "PUT") {
          const body = await readBody(req);
          const result = store.renameGroup(user, groupId, body.name);
          json(res, result.error ? (result.error === "forbidden" ? 403 : 400) : 200, result);
          return;
        }
        if (req.method === "DELETE") {
          const result = store.disbandGroup(user, groupId);
          json(res, result.error ? (result.error === "forbidden" ? 403 : 400) : 200, result);
          return;
        }
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
  store.ensureLeaderboard(Date.now());
  const settlementTimer = setInterval(() => store.ensureLeaderboard(Date.now()), 15 * 1000);
  if (settlementTimer.unref) settlementTimer.unref();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[doro-social] listening on :${PORT}, data=${DATA_FILE}`);
  });
}

module.exports = {
  SocialStore,
  createServer,
  clean,
  pairKey,
  shanghaiDayKey,
  nextShanghaiMidnight,
  settleScores,
  effectiveBoardScore,
  mergeEntitlements,
  normalizeEntitlements,
  LEADERBOARD_DEFINITIONS,
};
