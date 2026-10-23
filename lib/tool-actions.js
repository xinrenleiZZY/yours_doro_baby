/*
 * 独立工具窗口的交易入口。
 * 工具窗口只提交意图，这里基于可信的商品表和动作清单执行，避免客户端直接改金币。
 */
"use strict";

const G = require("../renderer/game.js");

const THEMES = new Set(["night", "mint", "sakura"]);

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function actionByName(actions, name) {
  return (Array.isArray(actions) ? actions : []).find((action) => action && action.name === name);
}

function rentalDurationOf(ref) {
  const value = ref && ref.rentalDuration;
  if (value === "permanent") return "permanent";
  const days = Number(value);
  return G.RENTAL_DAYS.includes(days) ? days : "permanent";
}

function resolveShopItem(actions, ref) {
  if (!ref || typeof ref !== "object") return null;
  if (ref.kind === "catalog") {
    const item = G.SHOP_ITEMS[String(ref.id || "")];
    if (!item) return null;
    return item.type === "fashion" ? { ...item, rentalDuration: rentalDurationOf(ref) } : item;
  }
  if (ref.kind === "furniture") {
    const furniture = G.FURNITURE[String(ref.id || "")];
    if (!furniture) return null;
    return {
      id: `furniture:${furniture.id}`,
      name: furniture.name,
      type: furniture.id === "companion" ? "companion" : "furniture",
      furnitureId: furniture.id,
      price: furniture.price,
      rentalDuration: rentalDurationOf(ref),
      icon: furniture.icon,
      desc: furniture.desc,
    };
  }
  if (ref.kind === "dress") {
    const dresses = (Array.isArray(actions) ? actions : []).filter((action) => action.category === "dress");
    const index = dresses.findIndex((action) => action.name === ref.action);
    if (index < 0) return null;
    const action = dresses[index];
    return {
      id: `dress:${action.name}`,
      name: action.label,
      type: "dress",
      action: action.name,
      price: G.dressPrice(index, action.name),
      rentalDuration: rentalDurationOf(ref),
      icon: "👗",
      desc: `时装积分 +${G.dressScore(index, action.name)}`,
    };
  }
  return null;
}

function fail(reason, message) {
  return { ok: false, reason: reason || "invalid", message: message || "" };
}

/**
 * 在存档副本上执行工具窗口命令。
 * @returns {{ok: boolean, state?: object, result?: object, message?: string, speech?: string, reason?: string}}
 */
function applyToolCommand(state, actions, tool, command, now) {
  if (!state || typeof state !== "object" || !command || typeof command !== "object") {
    return fail("invalid");
  }
  const next = cloneState(state);
  const ts = Number(now) || Date.now();

  if (tool === "shop" && command.type === "buy") {
    const item = resolveShopItem(actions, command.item);
    if (!item) return fail("bad-item", "商品不存在");
    const result = G.purchase(next, item, ts);
    if (!result.ok) {
      return fail(result.reason, result.reason === "coin" ? "金币不够" : "这个已经拥有了");
    }
    return {
      ok: true,
      state: next,
      result,
      message:
        result.rentalDuration && result.rentalDuration !== "permanent"
          ? `租到了：${item.name}（${result.rentalDuration} 日）`
          : `买到了：${item.name}`,
      speech:
        item.type === "dress" || item.type === "fashion"
          ? result.rentalDuration && result.rentalDuration !== "permanent"
            ? `租到了「${item.name}」，有效期内可以去动作库换上`
            : `永久解锁了「${item.name}」，去动作库换上吧`
          : item.type === "theme"
            ? `${item.name} 已启用`
            : item.type === "luxury"
              ? `${item.name} 到手，产出又提高了`
              : item.type === "profile"
                ? `现在的我是${result.profile.personality.name}型啦`
                : `${item.name} 到手～`,
    };
  }

  if (tool === "shop" && command.type === "equip-fashion") {
    const result = G.toggleFashion(next, String(command.id || ""), ts);
    if (!result.ok) return fail("not-owned", "这件服装已过期或尚未拥有");
    return {
      ok: true,
      state: next,
      result,
      message: result.equipped ? `穿上了「${result.item.name}」` : `脱下了「${result.item.name}」`,
      speech: result.equipped ? "新衣服怎么样？" : "换回原来的样子啦",
    };
  }

  if (tool === "shop" && command.type === "use") {
    const item = resolveShopItem(actions, command.item);
    if (!item) return fail("bad-item", "商品不存在");
    const result = G.useItem(next, item, ts);
    if (!result.ok) return fail(result.reason, "背包里没有啦");
    return {
      ok: true,
      state: next,
      result,
      message: `用掉了 ${item.name}`,
      speech:
        result.preference === "like"
          ? `最喜欢${item.name}了！`
          : result.preference === "dislike"
            ? `${item.name}……不太喜欢`
            : `用掉了${item.name}`,
    };
  }

  if (tool === "shop" && command.type === "equip-theme") {
    const theme = String(command.theme || "");
    if (!THEMES.has(theme) || !next.perks[`theme_${theme}`]) {
      return fail("not-owned", "还没有这个主题");
    }
    next.settings.theme = theme;
    return { ok: true, state: next, message: "主题已切换", speech: "换好主题啦" };
  }

  if (tool === "gacha" && command.type === "pull") {
    const result = G.pullGacha(next, actions, ts);
    if (!result.ok) return fail("coin", "金币不够，先搬会儿砖吧");
    return { ok: true, state: next, result, message: `扭蛋：${result.label}`, speech: result.label };
  }

  if (tool === "gacha" && command.type === "pull-ten") {
    const result = G.pullGachaMany(next, actions, 10, ts);
    if (!result.ok) return fail("coin", `十连抽需要 ${result.cost} 金币`);
    return {
      ok: true,
      state: next,
      result,
      message: `十连完成，共抽到 ${result.results.length} 份奖励`,
      speech: "十连抽完成，快看看有没有大奖！",
    };
  }

  if (tool === "gacha" && command.type === "clear-history") {
    next.gacha.history = [];
    return { ok: true, state: next, message: "抽奖记录已清空" };
  }

  if (tool === "minigame" && command.type === "finish") {
    if (!G.minigameStatus(next, ts).ready) return fail("cooldown", "小游戏还在冷却中");
    const score = Math.max(0, Math.min(500, Math.round(Number(command.score) || 0)));
    const trainingBefore = next.training.points;
    const reward = G.finishMinigame(next, score, ts);
    const trainingGain = next.training.points - trainingBefore;
    return {
      ok: true,
      state: next,
      result: { score, reward, trainingGain },
      message: `接金币得分 ${score}，+${reward} 金币 · +${trainingGain} 训练点`,
      speech: `接到 ${score} 个，赚了 ${reward} 金币和 ${trainingGain} 训练点`,
    };
  }

  if (tool === "sticker" && command.type === "set-random") {
    const action = actionByName(actions, String(command.name || ""));
    if (!action) return fail("not-found");
    G.setStickerRandom(next, action.name, Boolean(command.value));
    return { ok: true, state: next };
  }

  if (tool === "sticker" && command.type === "set-label") {
    const action = actionByName(actions, String(command.name || ""));
    if (!action) return fail("not-found");
    G.setStickerLabel(next, action.name, String(command.label || ""));
    return { ok: true, state: next };
  }

  if (tool === "sticker" && command.type === "favorite") {
    const action = actionByName(actions, String(command.name || ""));
    if (!action) return fail("not-found");
    const index = next.favorites.indexOf(action.name);
    if (index >= 0) next.favorites.splice(index, 1);
    else next.favorites.unshift(action.name);
    next.favorites = next.favorites.slice(0, 200);
    return { ok: true, state: next };
  }

  if (tool === "sticker" && command.type === "hide") {
    const action = actionByName(actions, String(command.name || ""));
    if (!action || action.user) return fail("not-built-in");
    const result = G.hideBuiltInSticker(next, action);
    return result.ok ? { ok: true, state: next } : fail(result.reason);
  }

  if (tool === "sticker" && command.type === "restore") {
    const result = G.restoreBuiltInStickers(next, actions);
    return { ok: true, state: next, result };
  }

  if (tool === "sticker" && command.type === "batch-random") {
    const mode = String(command.mode || "");
    if (!["all", "none", "favorites"].includes(mode)) return fail("bad-mode");
    (Array.isArray(actions) ? actions : [])
      .filter((action) => action && !G.isStickerHidden(next, action))
      .forEach((action) => {
        const value = mode === "all" ? true : mode === "none" ? false : next.favorites.includes(action.name);
        G.setStickerRandom(next, action.name, value);
      });
    return { ok: true, state: next };
  }

  if (tool === "sticker" && command.type === "forget") {
    const name = String(command.name || "");
    next.favorites = next.favorites.filter((item) => item !== name);
    next.recent = next.recent.filter((item) => item !== name);
    delete next.stickerRandom[name];
    delete next.stickerLabels[name];
    return { ok: true, state: next };
  }

  return fail("unsupported", "不支持的窗口操作");
}

module.exports = { applyToolCommand, resolveShopItem, THEMES };
