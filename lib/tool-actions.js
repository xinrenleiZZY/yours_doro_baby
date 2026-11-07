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
  if (ref.kind === "technique") {
    return G.CULTIVATION.techniqueById(String(ref.id || ""));
  }
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
    const quantity =
      item.type === "cultivation"
        ? Math.max(1, Math.min(9999, Math.round(Number(command.quantity) || 1)))
        : 1;
    if (item.type === "cultivation" && next.cultivation) {
      next.cultivation.buyQuantity = quantity;
    }
    const result = quantity > 1 ? G.purchaseMany(next, item, quantity, ts) : G.purchase(next, item, ts);
    if (!result.ok) {
      return fail(
        result.reason,
        result.reason === "coin"
          ? "金币不够"
          : result.reason === "root"
            ? "灵根不匹配"
            : result.reason === "owned"
              ? "这个已经拥有了"
              : "暂时无法购买"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message:
        result.rentalDuration && result.rentalDuration !== "permanent"
          ? `租到了：${item.name}（${result.rentalDuration} 日）`
          : quantity > 1
            ? `买到了：${item.name} ×${quantity}`
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
                : item.type === "cultivation"
                  ? `${item.name} 已收入修炼储物袋`
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

  if ((tool === "shop" || tool === "inventory") && command.type === "study-technique") {
    const result = G.studyTechnique(next, String(command.id || ""), ts);
    if (!result.ok) {
      return fail(
        result.reason,
        result.reason === "root"
          ? "灵根不匹配，无法研习"
          : result.reason === "missing"
            ? "背包里没有这部功法"
            : "功法不存在"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: result.dialogue,
      speech: result.dialogue,
    };
  }

  if (tool === "inventory" && command.type === "equip-technique") {
    const result = G.equipTechnique(next, String(command.id || ""), ts);
    if (!result.ok) {
      return fail(
        result.reason,
        result.reason === "root"
          ? "灵根不匹配，无法装备"
          : result.reason === "missing"
            ? "尚未学会这部功法"
            : "功法不存在"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: `已开始修炼「${result.technique.name}」`,
      speech: `现在同时修炼${result.equippedIds.length}部功法`,
    };
  }

  if (tool === "inventory" && command.type === "unequip-technique") {
    const result = G.unequipTechnique(next, String(command.id || ""), ts);
    if (!result.ok) return fail(result.reason, "这部功法尚未习得");
    return {
      ok: true,
      state: next,
      result,
      message: "已暂停这部功法的修炼",
      speech: "先歇一歇，再决定修炼哪几部",
    };
  }

  if (tool === "inventory" && command.type === "comprehend-technique") {
    const result = G.comprehendTechnique(next, ts, Math.random, String(command.id || ""));
    if (!result.ok) {
      return fail(
        result.reason,
        result.reason === "cooldown"
          ? `参悟还需等待 ${Math.ceil((result.readyAt - ts) / 1000)} 秒`
          : result.reason === "missing"
            ? "尚未习得这部功法"
            : "当前无法参悟"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: result.dialogue,
      speech: result.dialogue,
    };
  }

  if (tool === "inventory" && command.type === "use-life-pill") {
    const result = G.takeLifePill(next);
    if (!result.ok) return fail(result.reason, "背包里没有延寿丹");
    return {
      ok: true,
      state: next,
      result,
      message: `服下延寿丹，寿元上限 +${result.gained} 年`,
      speech: "寿元又增加了，今天也要好好修炼",
    };
  }

  if (tool === "inventory" && command.type === "use-cultivation-pill") {
    const result = G.takeCultivationPill(next, String(command.pill || ""), ts);
    if (!result.ok) {
      return fail(
        result.reason,
        result.reason === "technique"
          ? "尚未习得可提升的功法"
          : result.reason === "stage-limit"
            ? "当前小阶段最多服用 2 颗培元丹"
            : result.reason === "nascent"
              ? "元婴期已无需辟谷丹"
            : "背包里没有这种丹药"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: result.dialogue,
      speech: result.dialogue,
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

  if (tool === "opportunity" && command.type === "draw") {
    const result = G.drawOpportunity(next, ts);
    if (!result.ok) {
      return {
        ...fail(result.reason, `下一次机缘还需等待 ${Math.ceil((result.readyAt - ts) / 60000)} 分钟`),
        readyAt: result.readyAt,
      };
    }
    return {
      ok: true,
      state: next,
      result,
      message: result.alreadyActive ? `当前机缘：${result.event.title}` : `遇见机缘：${result.event.title}`,
      speech: result.alreadyActive ? "这件事还没做决定呢" : "咦，前面好像有什么",
    };
  }

  if (tool === "opportunity" && command.type === "choose") {
    const result = G.resolveOpportunityChoice(next, String(command.choiceId || ""), ts);
    if (!result.ok) {
      return fail(
        result.reason,
        result.reason === "requirements"
          ? `条件未满足：${(result.missing || []).join("、")}`
          : result.reason === "no-active"
            ? "当前没有待选择的机缘"
            : "这个选项无法选择"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: `${result.narrative}${result.effectsText ? `（${result.effectsText}）` : ""}`,
      speech:
        result.outcome === "failure"
          ? "这次不太顺利……"
          : result.outcome === "success"
            ? "机缘落在我们这边了"
            : "又记下了一段修行",
    };
  }

  if (tool === "gacha" && command.type === "pull") {
    const pool = command.pool === "up" ? "up" : "standard";
    const result = pool === "up" ? G.pullUpGacha(next, actions, ts) : G.pullGacha(next, actions, ts);
    if (!result.ok) {
      return fail(
        result.reason === "up-ended" ? "up-ended" : "coin",
        result.reason === "up-ended" ? "UP 奖池已结束" : "金币不够，先搬会儿砖吧"
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: `${pool === "up" ? "UP 扭蛋" : "常驻扭蛋"}：${result.label}`,
      speech: result.label,
    };
  }

  if (tool === "gacha" && command.type === "pull-ten") {
    const pool = command.pool === "up" ? "up" : "standard";
    const result =
      pool === "up" ? G.pullUpGachaMany(next, actions, 10, ts) : G.pullGachaMany(next, actions, 10, ts);
    if (!result.ok) {
      return fail(
        result.reason === "up-ended" ? "up-ended" : "coin",
        result.reason === "up-ended" ? "UP 奖池已结束" : `十连抽需要 ${result.cost} 金币`
      );
    }
    return {
      ok: true,
      state: next,
      result,
      message: `${pool === "up" ? "UP " : ""}十连完成，共抽到 ${result.results.length} 份奖励`,
      speech: "十连抽完成，快看看有没有大奖！",
    };
  }

  if (tool === "gacha" && command.type === "clear-history") {
    const pool = command.pool === "up" ? "up" : "standard";
    next.gacha.history = (next.gacha.history || []).filter(
      (entry) => (entry.pool === "up" ? "up" : "standard") !== pool
    );
    return { ok: true, state: next, message: `${pool === "up" ? "UP 池" : "常驻池"}记录已清空` };
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
