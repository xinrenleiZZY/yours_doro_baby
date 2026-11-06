/* global module, require, self */
/*
 * 数据驱动的修仙机缘。事件只描述条件、选项与效果，
 * 由 main / tool window 通过同一套纯规则结算。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./cultivation"));
  } else {
    root.DoroOpportunities = factory(root.DoroCultivation);
  }
})(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const DRAW_COOLDOWN_MS = 20 * 60000;
  const HISTORY_LIMIT = 50;
  const RARITY_LABELS = Object.freeze({ common: "寻常", rare: "稀有", legendary: "传说" });
  const RARITY_WEIGHT = Object.freeze({ common: 1, rare: 0.42, legendary: 0.14 });

  const EVENTS = Object.freeze([
    {
      id: "dew_before_dawn",
      title: "叶尖晨露",
      category: "静修",
      rarity: "common",
      weight: 12,
      cooldown: 3,
      description: "天未大亮，橘叶上凝着一滴泛金的露水。灵气细弱，却干净得像刚洗过的天光。",
      choices: [
        {
          id: "drink",
          text: "以叶为盏，饮下晨露",
          effects: [
            { type: "expPercent", value: 0.08 },
            { type: "attribute", key: "insight", value: 1 },
          ],
          narrative: "清凉气息落入丹田，今日的吐纳格外顺畅。",
        },
        {
          id: "gather",
          text: "连叶采下，留作炼丹",
          effects: [{ type: "herb", value: 1 }],
          narrative: "露水入瓶，药香没有散去。",
        },
      ],
    },
    {
      id: "wandering_herb_spirit",
      title: "药圃里的小精怪",
      category: "灵植",
      rarity: "common",
      weight: 9,
      cooldown: 4,
      description: "一株何首乌拔根跑了三步，又回头看你。它似乎把你当成了偷药贼，也可能是在等你帮忙。",
      choices: [
        {
          id: "protect",
          text: "替它赶走追逐的灰鼠",
          effects: [
            { type: "attribute", key: "daoHeart", value: 2 },
            { type: "herb", value: 2 },
          ],
          narrative: "小精怪钻进土里，临走前抖落两株灵药作为谢礼。",
        },
        {
          id: "harvest",
          text: "管它成没成精，先采了",
          effects: [
            { type: "herb", value: 5 },
            { type: "karma", value: -2 },
          ],
          narrative: "药篓沉了，心口却像被细刺扎了一下。",
        },
      ],
    },
    {
      id: "stone_vein_song",
      title: "矿脉低鸣",
      category: "矿石",
      rarity: "common",
      weight: 9,
      cooldown: 4,
      description: "山壁深处传来一声极低的嗡鸣，像有人在石中拨动琴弦。",
      choices: [
        {
          id: "listen",
          text: "贴壁听音，记下灵脉走向",
          effects: [
            { type: "techniqueMastery", value: 2 },
            { type: "karma", value: 1 },
          ],
          narrative: "你把回声化成一段吐纳节拍，功法运转更圆融了。",
        },
        {
          id: "dig",
          text: "循声开挖",
          outcomes: [
            {
              chance: 0.68,
              fortuneBonus: 0.002,
              success: {
                text: "碎石下露出一小簇下品灵石。",
                effects: [{ type: "stone", tier: "low", value: 3 }],
              },
              failure: {
                text: "山壁塌了半截，只挖出一手碎石。",
                effects: [{ type: "attribute", key: "fortune", value: -1 }],
              },
            },
          ],
        },
      ],
    },
    {
      id: "lost_paper_crane",
      title: "折翼纸鹤",
      category: "奇物",
      rarity: "common",
      weight: 7,
      once: true,
      description: "一只传讯纸鹤落在脚边，翅膀有一道整齐的裂口。上面没有收信人，只有你熟悉的气息。",
      choices: [
        {
          id: "mend",
          text: "用自己的灵力补好折痕",
          effects: [
            { type: "techniqueMastery", value: 2 },
            { type: "flag", key: "paper_crane_mended", value: true },
          ],
          narrative: "纸鹤拍翼而起，在空中绕了三圈才飞远。",
        },
        {
          id: "keep",
          text: "收进储物袋，日后再查",
          effects: [
            { type: "stone", tier: "low", value: 2 },
            { type: "karma", value: -1 },
          ],
          narrative: "纸鹤没有挣扎，只是安静地失去光泽。",
        },
      ],
    },
    {
      id: "paper_crane_returns",
      title: "纸鹤衔书",
      category: "后续",
      rarity: "rare",
      weight: 18,
      once: true,
      conditions: [{ type: "flag", key: "paper_crane_mended", value: true }],
      description: "修好的纸鹤回来了，嘴里衔着一页残笺。落款被雷火灼掉，只留下一句“莫在月圆时开阵”。",
      choices: [
        {
          id: "read",
          text: "展开残笺仔细研读",
          effects: [
            { type: "expPercent", value: 0.15 },
            { type: "techniqueMastery", value: 4 },
            { type: "flag", key: "paper_crane_warning", value: true },
          ],
          narrative: "残笺化光入识海，像有人隔着岁月替你演练了一遍法诀。",
        },
        {
          id: "burn",
          text: "将警告烧给山神",
          effects: [
            { type: "attribute", key: "fortune", value: 3 },
            { type: "flag", key: "paper_crane_warning", value: true },
          ],
          narrative: "灰烬逆风升起，林间传来一声轻轻的鹤鸣。",
        },
      ],
    },
    {
      id: "old_well_reflection",
      title: "古井中的另一个你",
      category: "道心",
      rarity: "common",
      weight: 8,
      cooldown: 5,
      description: "井水纹丝不动，倒影却比你慢半拍。它抬头时，你还在低头。",
      choices: [
        {
          id: "face",
          text: "直视倒影，问它为何而来",
          outcomes: [
            {
              chance: 0.62,
              fortuneBonus: 0.0015,
              success: {
                text: "倒影笑了一下，把一段杂念从你识海中带走。",
                effects: [{ type: "attribute", key: "daoHeart", value: 3 }],
              },
              failure: {
                text: "倒影说出你压在心底的遗憾，井水随之浑浊。",
                effects: [{ type: "attribute", key: "daoHeart", value: -2 }],
              },
            },
          ],
        },
        {
          id: "leave",
          text: "覆上井盖，不与之纠缠",
          effects: [{ type: "expPercent", value: 0.03 }],
          narrative: "你转身离开，身后的水声很快停了。",
        },
      ],
    },
    {
      id: "rain_on_tiles",
      title: "檐下听雨",
      category: "静修",
      rarity: "common",
      weight: 10,
      cooldown: 3,
      description: "雨点落在青瓦上有固定的节拍，一长两短，正好合上你吐纳的节奏。",
      choices: [
        {
          id: "meditate",
          text: "依雨声打坐一轮",
          effects: [
            { type: "expPercent", value: 0.12 },
            { type: "techniqueMastery", value: 1 },
          ],
          narrative: "雨停时，经脉里还留着清亮的回音。",
        },
        {
          id: "sleep",
          text: "倚着门框小憩片刻",
          effects: [
            { type: "expPercent", value: 0.05 },
            { type: "attribute", key: "daoHeart", value: 1 },
          ],
          narrative: "你梦见自己变成了一滴雨，落回屋檐。",
        },
      ],
    },
    {
      id: "market_lost_pouch",
      title: "坊市失物",
      category: "因果",
      rarity: "common",
      weight: 8,
      cooldown: 5,
      description: "道路边躺着一只鼓囊囊的储物袋，禁制已经磨破。远处有个散修正焦急地寻找什么。",
      choices: [
        {
          id: "return",
          text: "追上失主原物奉还",
          effects: [
            { type: "coins", value: 240 },
            { type: "karma", value: 5 },
          ],
          narrative: "散修千恩万谢，硬塞来一袋谢礼。",
        },
        {
          id: "keep",
          text: "收下无人认领的灵石",
          effects: [
            { type: "stone", tier: "low", value: 5 },
            { type: "karma", value: -4 },
          ],
          narrative: "储物袋里的灵石不少，远处那道寻找的目光却一直没散。",
        },
      ],
    },
    {
      id: "small_bell_test",
      title: "山门小钟",
      category: "试炼",
      rarity: "common",
      weight: 7,
      cooldown: 6,
      description: "山门外的小钟无人自鸣。钟旁刻着两行古字：心静者一击，心乱者三声。",
      choices: [
        {
          id: "ring",
          text: "凝神一击",
          requirements: [{ type: "insight", min: 40 }],
          effects: [
            { type: "techniqueMastery", value: 4 },
            { type: "expPercent", value: 0.1 },
          ],
          narrative: "钟声只响一次，余音却在你识海里盘桓了许久。",
        },
        {
          id: "strike",
          text: "不必想太多，敲了再说",
          effects: [
            { type: "attribute", key: "daoHeart", value: 2 },
            { type: "techniqueMastery", value: 1 },
          ],
          narrative: "钟响三声，一只山雀从檐上探头看你。",
        },
      ],
    },
    {
      id: "redflame_heat",
      title: "赤焰噬脉",
      category: "区域",
      rarity: "rare",
      weight: 10,
      cooldown: 4,
      conditions: [{ type: "region", ids: ["redflame_valley"] }],
      description: "赤焰谷的火灵气突然倒灌，经脉像被烧红的细线。周围石块正一块块裂开。",
      choices: [
        {
          id: "absorb",
          text: "强纳火气，借势冲关",
          outcomes: [
            {
              chance: 0.58,
              fortuneBonus: 0.0025,
              success: {
                text: "火气被炼成本命真元，修为暴涨。",
                effects: [{ type: "expPercent", value: 0.24 }],
              },
              failure: {
                text: "心火反噬，经脉留下灼伤。",
                effects: [
                  { type: "attribute", key: "daoHeart", value: -4 },
                  { type: "expPercent", value: 0.05 },
                ],
              },
            },
          ],
        },
        {
          id: "calm",
          text: "暂避锋芒，以水意调和",
          effects: [
            { type: "expPercent", value: 0.08 },
            { type: "attribute", key: "daoHeart", value: 1 },
          ],
          narrative: "你退出谷口，热浪在身后慢慢平息。",
        },
      ],
    },
    {
      id: "xuanshui_mirror",
      title: "玄水无波",
      category: "区域",
      rarity: "rare",
      weight: 10,
      cooldown: 4,
      conditions: [{ type: "region", ids: ["xuanshui_ravine"] }],
      description: "玄水涧的水面映出三种过去：错过的人、走过的路，以及一扇尚未打开的门。",
      choices: [
        {
          id: "reflect",
          text: "观水照心",
          effects: [
            { type: "expPercent", value: 0.14 },
            { type: "techniqueMastery", value: 3 },
          ],
          narrative: "水面恢复平静时，你的脚步也轻了。",
        },
        {
          id: "dive",
          text: "潜入水底寻找矿脉",
          outcomes: [
            {
              chance: 0.6,
              fortuneBonus: 0.002,
              success: {
                text: "水底石壁嵌着一枚上品灵石。",
                effects: [{ type: "stone", tier: "high", value: 1 }],
              },
              failure: {
                text: "寒气侵体，你只得空手返回。",
                effects: [{ type: "attribute", key: "lifespan", value: -1 }],
              },
            },
          ],
        },
      ],
    },
    {
      id: "ghost_realm_whisper",
      title: "幽冥低语",
      category: "区域·心魔",
      rarity: "rare",
      weight: 11,
      cooldown: 4,
      conditions: [{ type: "region", ids: ["ghost_realm"] }],
      description: "鬼蜮深处有人用你的声音说：“不用再辛苦了。”话音很近，像贴着耳根。",
      choices: [
        {
          id: "listen",
          text: "循声追查",
          outcomes: [
            {
              chance: 0.52,
              fortuneBonus: 0.003,
              success: {
                text: "低语化作一段残缺传承，被你收入识海。",
                effects: [
                  { type: "expPercent", value: 0.25 },
                  { type: "techniqueMastery", value: 3 },
                ],
              },
              failure: {
                text: "鬼气钻入识海，心湖久久不宁。",
                effects: [{ type: "attribute", key: "daoHeart", value: -5 }],
              },
            },
          ],
        },
        {
          id: "incense",
          text: "焚一株灵药，守住心神",
          requirements: [{ type: "herbs", min: 1 }],
          effects: [
            { type: "herb", value: -1 },
            { type: "attribute", key: "daoHeart", value: 3 },
          ],
          narrative: "药香凝成薄雾，低语声渐渐远去。",
        },
      ],
    },
    {
      id: "cloudsea_epiphany",
      title: "云海一线天",
      category: "区域·顿悟",
      rarity: "rare",
      weight: 9,
      cooldown: 6,
      conditions: [{ type: "region", ids: ["cloudsea_peak"] }],
      description: "云层裂开一道细缝，日光落在你面前，恰好铺成一条可以行走的路。",
      choices: [
        {
          id: "walk",
          text: "踏入光中",
          outcomes: [
            {
              chance: 0.7,
              fortuneBonus: 0.0015,
              success: {
                text: "一步落下，像跨过了许多年的摸索。",
                effects: [
                  { type: "expPercent", value: 0.2 },
                  { type: "techniqueMastery", value: 5 },
                ],
              },
              failure: {
                text: "云路消散，你从半空跌回崖边。",
                effects: [{ type: "attribute", key: "daoHeart", value: -2 }],
              },
            },
          ],
        },
        {
          id: "watch",
          text: "不踏光路，只静观云势",
          effects: [{ type: "attribute", key: "insight", value: 1 }],
          narrative: "云海合拢，你记住了光落下的方向。",
        },
      ],
    },
    {
      id: "ancient_citadel_gate",
      title: "古橘仙城开门",
      category: "区域·秘境",
      rarity: "legendary",
      weight: 8,
      cooldown: 12,
      conditions: [
        { type: "region", ids: ["ancient_citadel"] },
        { type: "level", min: 91 },
      ],
      description: "城门在无月之夜洞开，门后没有街道，只有一片倒悬于星海中的橘林。",
      choices: [
        {
          id: "enter",
          text: "踏入倒悬橘林",
          outcomes: [
            {
              chance: 0.5,
              fortuneBonus: 0.004,
              success: {
                text: "你在林心得到一枚仙城遗印，修为与功法同时精进。",
                effects: [
                  { type: "expPercent", value: 0.32 },
                  { type: "techniqueMastery", value: 8 },
                  { type: "stone", tier: "supreme", value: 1 },
                ],
              },
              failure: {
                text: "城门骤然闭合，你被空间乱流抛回城外。",
                effects: [{ type: "expPercent", value: -0.08 }],
              },
            },
          ],
        },
        {
          id: "survey",
          text: "只在门外推演阵纹",
          effects: [
            { type: "techniqueMastery", value: 4 },
            { type: "stone", tier: "high", value: 1 },
          ],
          narrative: "门缝只露一息，你仍记下了一道完整阵纹。",
        },
      ],
    },
    {
      id: "thunder_calls_name",
      title: "雷霆唤名",
      category: "变异灵根",
      rarity: "rare",
      weight: 15,
      cooldown: 8,
      conditions: [
        {
          type: "any",
          conditions: [
            { type: "root", ids: ["thunder"] },
            { type: "region", ids: ["windthunder_plateau"] },
          ],
        },
      ],
      description: "雷声没有落在山谷，而是在你识海里炸开。它在叫一个你从未告诉过别人的名字。",
      choices: [
        {
          id: "accept",
          text: "以雷淬体，回应呼唤",
          effects: [
            { type: "expPercent", value: 0.18 },
            { type: "thunderPearl", value: 1 },
            { type: "techniqueMastery", value: 5 },
          ],
          narrative: "雷光散去，你的骨骼里留下细小的电弧。",
        },
        {
          id: "ground",
          text: "引雷入地，稳住经脉",
          effects: [
            { type: "techniqueMastery", value: 3 },
            { type: "attribute", key: "daoHeart", value: 2 },
          ],
          narrative: "雷声顺着脚底没入大地，山石轻轻震了一下。",
        },
      ],
    },
    {
      id: "wood_sprout_life",
      title: "枯枝生春",
      category: "灵根",
      rarity: "common",
      weight: 11,
      cooldown: 6,
      conditions: [{ type: "root", ids: ["wood"] }],
      description: "你随手插在土里的枯枝长出一片新叶。叶脉中流动的灵气，和你的呼吸完全一致。",
      choices: [
        {
          id: "nurture",
          text: "以灵药汁液滋养",
          requirements: [{ type: "herbs", min: 1 }],
          effects: [
            { type: "herb", value: -1 },
            { type: "expPercent", value: 0.16 },
            { type: "lifespan", value: 3 },
          ],
          narrative: "新枝抽长半尺，你的生机也随之充盈。",
        },
        {
          id: "graft",
          text: "剪下枝条移栽",
          effects: [
            { type: "herb", value: 3 },
            { type: "karma", value: 1 },
          ],
          narrative: "枝条入土即活，药圃里多了一抹新绿。",
        },
      ],
    },
    {
      id: "chaos_secret",
      title: "五彩归一",
      category: "变异灵根",
      rarity: "legendary",
      weight: 20,
      cooldown: 15,
      conditions: [{ type: "root", ids: ["chaos"] }],
      description: "五行灵气自发围着你旋转，最后坍缩成一粒看不见的混沌种子。",
      choices: [
        {
          id: "touch",
          text: "以神识触碰混沌种子",
          outcomes: [
            {
              chance: 0.76,
              fortuneBonus: 0.0015,
              success: {
                text: "种子化为一片星云，你的功法领悟骤然跃升。",
                effects: [
                  { type: "expPercent", value: 0.3 },
                  { type: "techniqueMastery", value: 10 },
                ],
              },
              failure: {
                text: "混沌之气冲撞识海，你花了很久才找回自己的念头。",
                effects: [{ type: "attribute", key: "daoHeart", value: -6 }],
              },
            },
          ],
        },
        {
          id: "seal",
          text: "以道心封住种子",
          effects: [
            { type: "techniqueMastery", value: 4 },
            { type: "karma", value: 2 },
          ],
          narrative: "种子沉入丹田，安静地等待下一次发芽。",
        },
      ],
    },
    {
      id: "five_roots_balance",
      title: "五气归炉",
      category: "五灵根",
      rarity: "rare",
      weight: 16,
      cooldown: 8,
      conditions: [{ type: "rootKind", kinds: ["mixed"] }],
      description: "五股相冲的灵气在丹田里吵成一团。最弱的那一缕忽然停住，像在等你做决定。",
      choices: [
        {
          id: "balance",
          text: "放弃压制，让五气轮流运转",
          effects: [
            { type: "expPercent", value: 0.2 },
            { type: "attribute", key: "daoHeart", value: 3 },
          ],
          narrative: "五气不再争抢，丹田第一次安静得像一口深井。",
        },
        {
          id: "force",
          text: "强行以最强灵根统御其余四气",
          effects: [
            { type: "expPercent", value: 0.13 },
            { type: "attribute", key: "daoHeart", value: -2 },
          ],
          narrative: "修为涨得快了，经脉却留下几道不协调的乱纹。",
        },
      ],
    },
    {
      id: "dual_root_conflict",
      title: "双气争脉",
      category: "双灵根",
      rarity: "rare",
      weight: 14,
      cooldown: 7,
      conditions: [{ type: "rootKind", kinds: ["dual"] }],
      description: "两种灵气同时奔向丹田，在经脉里撞出一串细小的火花。",
      choices: [
        {
          id: "harmonize",
          text: "以功法引导二气依次流转",
          requirements: [{ type: "techniqueMastery", min: 20 }],
          effects: [
            { type: "expPercent", value: 0.19 },
            { type: "attribute", key: "daoHeart", value: 3 },
          ],
          narrative: "二气不再相争，首尾相接，运转得像一个小周天。",
        },
        {
          id: "choose",
          text: "暂时压下一气，专修另一气",
          effects: [
            { type: "expPercent", value: 0.12 },
            { type: "techniqueMastery", value: 3 },
          ],
          narrative: "修为暂且稳住，另一股灵气沉入丹田深处蛰伏。",
        },
      ],
    },
    {
      id: "single_root_pride",
      title: "一剑一意",
      category: "单灵根",
      rarity: "common",
      weight: 12,
      cooldown: 7,
      conditions: [{ type: "rootKind", kinds: ["single"] }],
      description: "你抬手引气，只一种颜色便填满整片视野。旁边的杂草被灵气压得整齐伏下。",
      choices: [
        {
          id: "purify",
          text: "守住这一缕纯粹",
          effects: [
            { type: "expPercent", value: 0.16 },
            { type: "techniqueMastery", value: 3 },
          ],
          narrative: "灵气越纯，经脉越发清晰。",
        },
        {
          id: "broaden",
          text: "观摩周围其他灵气，补足短板",
          effects: [
            { type: "attribute", key: "insight", value: 1 },
            { type: "expPercent", value: 0.08 },
          ],
          narrative: "你没有改变本命属性，却记住了它们各自的模样。",
        },
      ],
    },
    {
      id: "light_feather",
      title: "一羽晨光",
      category: "变异灵根",
      rarity: "rare",
      weight: 14,
      cooldown: 8,
      conditions: [{ type: "root", ids: ["light"] }],
      description: "一根半透明的羽毛落在掌心，羽毛里封着一小段没有阴影的清晨。",
      choices: [
        {
          id: "pray",
          text: "以光羽温养道心",
          effects: [
            { type: "attribute", key: "daoHeart", value: 5 },
            { type: "lifespan", value: 2 },
          ],
          narrative: "心湖被照亮，旧伤似乎也浅了一分。",
        },
        {
          id: "absorb",
          text: "将光羽引入丹田",
          effects: [
            { type: "expPercent", value: 0.13 },
            { type: "techniqueMastery", value: 4 },
          ],
          narrative: "光羽散成细屑，沿着经脉融入真元。",
        },
      ],
    },
    {
      id: "blood_moon",
      title: "血月照骨",
      category: "变异灵根",
      rarity: "rare",
      weight: 14,
      cooldown: 9,
      conditions: [{ type: "root", ids: ["dark"] }],
      description: "血月升起时，你的影子先一步抬头。远处传来许多人同时低声念咒的声音。",
      choices: [
        {
          id: "absorb",
          text: "借血月修炼阴冥之术",
          outcomes: [
            {
              chance: 0.62,
              fortuneBonus: 0.002,
              success: {
                text: "月华灌入识海，阴冥真意变得清晰。",
                effects: [
                  { type: "expPercent", value: 0.23 },
                  { type: "techniqueMastery", value: 6 },
                ],
              },
              failure: {
                text: "影子反客为主，强行拖走了一缕神念。",
                effects: [
                  { type: "attribute", key: "daoHeart", value: -4 },
                  { type: "karma", value: 2 },
                ],
              },
            },
          ],
        },
        {
          id: "resist",
          text: "闭目守心，不借血月修行",
          effects: [
            { type: "attribute", key: "daoHeart", value: 4 },
            { type: "expPercent", value: 0.03 },
          ],
          narrative: "血月照了一夜，你的影子始终没有抬头。",
        },
      ],
    },
    {
      id: "ice_phoenix_trace",
      title: "冰羽掠空",
      category: "变异灵根",
      rarity: "rare",
      weight: 14,
      cooldown: 9,
      conditions: [
        {
          type: "any",
          conditions: [
            { type: "root", ids: ["ice"] },
            { type: "region", ids: ["xuanshui_ravine"] },
          ],
        },
      ],
      description: "一道冰蓝色羽影从山巅掠过，落下的寒气在水面开出一朵不会融化的花。",
      choices: [
        {
          id: "follow",
          text: "循冰羽痕迹追去",
          outcomes: [
            {
              chance: 0.64,
              fortuneBonus: 0.002,
              success: {
                text: "崖壁裂隙里藏着两枚上品灵石，冰花仍未凋谢。",
                effects: [{ type: "stone", tier: "high", value: 2 }],
              },
              failure: {
                text: "寒气在脚边合拢，你只得退回山道。",
                effects: [{ type: "attribute", key: "fortune", value: -1 }],
              },
            },
          ],
        },
        {
          id: "record",
          text: "观察冰羽脉络，推演御寒法门",
          effects: [
            { type: "techniqueMastery", value: 4 },
            { type: "attribute", key: "insight", value: 1 },
          ],
          narrative: "羽影消失后，冰花仍旧保持展翅的形状。",
        },
      ],
    },
    {
      id: "broken_sword_hilt",
      title: "断剑旧柄",
      category: "剑道",
      rarity: "common",
      weight: 9,
      once: true,
      description: "土里露出半截剑柄，剑身早已锈断，握柄上却有七道整齐的磨痕。",
      choices: [
        {
          id: "pick",
          text: "拔出剑柄，带回研究",
          effects: [
            { type: "techniqueMastery", value: 2 },
            { type: "flag", key: "sword_hilt_found", value: true },
          ],
          narrative: "剑柄入手的一刻，你听见极轻的一声剑鸣。",
        },
        {
          id: "bury",
          text: "重新掩埋，敬剑主一杯酒",
          effects: [
            { type: "karma", value: 2 },
            { type: "attribute", key: "daoHeart", value: 1 },
          ],
          narrative: "风从剑冢上吹过，像有人回了一礼。",
        },
      ],
    },
    {
      id: "sword_intent_echo",
      title: "残剑留意",
      category: "后续·剑道",
      rarity: "rare",
      weight: 17,
      once: true,
      conditions: [{ type: "flag", key: "sword_hilt_found", value: true }],
      description: "夜里剑柄自行发热，七道磨痕依次亮起，像是某位剑修用最后的力气留下了七次挥剑。",
      choices: [
        {
          id: "resonate",
          text: "以神念接住剑意",
          effects: [
            { type: "techniqueMastery", value: 7 },
            { type: "expPercent", value: 0.15 },
          ],
          narrative: "七道剑光在识海中重叠，最后合成最简单的一横。",
        },
        {
          id: "share",
          text: "把剑柄送去山下剑庐",
          effects: [
            { type: "karma", value: 3 },
            { type: "attribute", key: "insight", value: 1 },
          ],
          narrative: "剑庐老人接过断柄，久久没有说话，只向你郑重一礼。",
        },
      ],
    },
    {
      id: "mysterious_cauldron",
      title: "药田里的旧炉",
      category: "丹道",
      rarity: "rare",
      weight: 10,
      once: true,
      conditions: [{ type: "herbs", min: 1 }],
      description: "药田深处埋着一只没有炉耳的小鼎，鼎腹刻着与灵药叶脉相似的纹路。",
      choices: [
        {
          id: "dig",
          text: "耗一株灵药供炉，探查来历",
          effects: [
            { type: "herb", value: -1 },
            { type: "techniqueMastery", value: 2 },
            { type: "flag", key: "cauldron_found", value: true },
          ],
          narrative: "灵药化为青光没入鼎腹，小鼎轻轻震了一下。",
        },
        {
          id: "leave",
          text: "不动旧物，只记下位置",
          effects: [{ type: "stone", tier: "low", value: 2 }],
          narrative: "你搬开碎石，在底下发现前任主人留下的两枚灵石。",
        },
      ],
    },
    {
      id: "cauldron_spirit",
      title: "炉中青烟",
      category: "后续·丹道",
      rarity: "rare",
      weight: 17,
      once: true,
      conditions: [{ type: "flag", key: "cauldron_found", value: true }],
      description: "旧炉自己燃起一簇青色丹火，青烟盘旋成一只小兽的模样。它张口，却没有声音。",
      choices: [
        {
          id: "assist",
          text: "以灵力助它凝形",
          outcomes: [
            {
              chance: 0.72,
              fortuneBonus: 0.002,
              success: {
                text: "青烟凝成一枚延寿丹，炉中小兽安心散去。",
                effects: [
                  { type: "pill", pill: "life", value: 1 },
                  { type: "expPercent", value: 0.1 },
                ],
              },
              failure: {
                text: "丹火失控，药香变成焦味。",
                effects: [{ type: "attribute", key: "daoHeart", value: -2 }],
              },
            },
          ],
        },
        {
          id: "seal",
          text: "封住炉口，慢慢温养",
          effects: [
            { type: "techniqueMastery", value: 3 },
            { type: "karma", value: 2 },
          ],
          narrative: "青烟缩回炉心，小鼎安静下来。",
        },
      ],
    },
    {
      id: "heart_demon_mirror",
      title: "心镜照影",
      category: "心魔",
      rarity: "rare",
      weight: 16,
      cooldown: 8,
      conditions: [
        {
          type: "any",
          conditions: [
            { type: "demonized", value: true },
            { type: "daoHeart", max: 42 },
          ],
        },
      ],
      description: "你看见镜中的自己正在修炼，只是它每突破一次，镜外就多一道裂纹。",
      choices: [
        {
          id: "accept",
          text: "承认那是自己的一部分",
          effects: [
            { type: "attribute", key: "daoHeart", value: 6 },
            { type: "karma", value: 1 },
          ],
          narrative: "镜中人向你点头，裂纹没有消失，却不再继续蔓延。",
        },
        {
          id: "break",
          text: "以心境之力击碎幻镜",
          requirements: [{ type: "level", min: 31 }],
          outcomes: [
            {
              chance: 0.6,
              fortuneBonus: 0.0015,
              success: {
                text: "镜面碎裂，压在心口的执念随之散去。",
                effects: [{ type: "attribute", key: "daoHeart", value: 8 }],
              },
              failure: {
                text: "镜片倒卷，照出你最不愿承认的念头。",
                effects: [{ type: "attribute", key: "daoHeart", value: -6 }],
              },
            },
          ],
        },
      ],
    },
    {
      id: "black_market_relic",
      title: "黑市残卷",
      category: "市井",
      rarity: "rare",
      weight: 8,
      cooldown: 8,
      conditions: [{ type: "level", min: 21 }],
      description: "蒙面摊主把一页残卷推到阴影里：“只换灵石，不问来路，也不保真假。”",
      choices: [
        {
          id: "buy",
          text: "付五枚下品灵石买下",
          requirements: [{ type: "stones", tier: "low", min: 5 }],
          effects: [
            { type: "stone", tier: "low", value: -5 },
            { type: "techniqueMastery", value: 6 },
          ],
          narrative: "残卷上的字迹需要灵力才能显形，恰好补上功法中一段断层。",
        },
        {
          id: "inspect",
          text: "不买，暗中观察摊主",
          outcomes: [
            {
              chance: 0.45,
              fortuneBonus: 0.003,
              success: {
                text: "你循着摊主离去的方向，捡到一枚被遗落的上品灵石。",
                effects: [{ type: "stone", tier: "high", value: 1 }],
              },
              failure: {
                text: "摊主察觉了你的视线，第二日集市已换了地方。",
                effects: [{ type: "attribute", key: "fortune", value: -1 }],
              },
            },
          ],
        },
      ],
    },
    {
      id: "orange_tree_dream",
      title: "橘树一梦",
      category: "传说",
      rarity: "legendary",
      weight: 4,
      once: true,
      cooldown: 30,
      conditions: [{ type: "level", min: 51 }],
      description:
        "你在最大的橘树下睡着。梦里，整座橘子大陆变成一枚缓慢旋转的果实，而树根一直延伸到云层之上。",
      choices: [
        {
          id: "sleep",
          text: "顺着树根向天外走去",
          outcomes: [
            {
              chance: 0.56,
              fortuneBonus: 0.004,
              success: {
                text: "你从梦中带回一缕大陆本源，修为与悟性同时增长。",
                effects: [
                  { type: "expPercent", value: 0.35 },
                  { type: "attribute", key: "insight", value: 2 },
                ],
              },
              failure: {
                text: "梦里的路没有尽头。醒来时，橘树落了满地黄叶。",
                effects: [{ type: "lifespan", value: -3 }],
              },
            },
          ],
        },
        {
          id: "carve",
          text: "在树根刻下自己的道号",
          effects: [
            { type: "techniqueMastery", value: 4 },
            { type: "lifespan", value: 2 },
          ],
          narrative: "刻痕很快被树皮覆盖，但你能感觉到，橘树记住了这个名字。",
        },
      ],
    },
  ]);

  const EVENT_MAP = new Map(EVENTS.map((event) => [event.id, event]));

  function integer(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(Math.min(max, Math.max(min, parsed)));
  }

  function emptyState(now) {
    return {
      version: 1,
      activeId: "",
      readyAt: Math.max(0, Number(now) || 0),
      draws: 0,
      seen: {},
      flags: {},
      history: [],
      lastOutcome: null,
    };
  }

  function normalizeState(raw, now) {
    if (!raw || typeof raw !== "object") return emptyState(now);
    const seen = {};
    if (raw.seen && typeof raw.seen === "object") {
      Object.entries(raw.seen)
        .filter(([id]) => EVENT_MAP.has(id))
        .slice(0, EVENTS.length)
        .forEach(([id, count]) => {
          seen[id] = integer(count, 0, 0, 10000);
        });
    }
    const flags = {};
    if (raw.flags && typeof raw.flags === "object") {
      Object.entries(raw.flags)
        .filter(([key, value]) => /^[a-z0-9_]{1,60}$/.test(key) && typeof value === "boolean")
        .slice(0, 120)
        .forEach(([key, value]) => {
          flags[key] = value;
        });
    }
    const history = Array.isArray(raw.history)
      ? raw.history
          .filter(
            (entry) =>
              entry &&
              typeof entry === "object" &&
              EVENT_MAP.has(entry.eventId) &&
              typeof entry.text === "string"
          )
          .slice(-HISTORY_LIMIT)
          .map((entry) => ({
            eventId: entry.eventId,
            eventTitle: String(entry.eventTitle || EVENT_MAP.get(entry.eventId).title).slice(0, 80),
            choiceId: String(entry.choiceId || "").slice(0, 60),
            choiceText: String(entry.choiceText || "").slice(0, 160),
            outcome: ["success", "failure", "resolved"].includes(entry.outcome) ? entry.outcome : "resolved",
            text: entry.text.slice(0, 500),
            effectsText: String(entry.effectsText || "").slice(0, 300),
            at: Math.max(0, Number(entry.at) || 0),
            draw: integer(entry.draw, 0, 0, 1e7),
          }))
      : [];
    const last =
      raw.lastOutcome && typeof raw.lastOutcome === "object" && EVENT_MAP.has(raw.lastOutcome.eventId)
        ? {
            eventId: raw.lastOutcome.eventId,
            eventTitle: String(raw.lastOutcome.eventTitle || "").slice(0, 80),
            outcome: ["success", "failure", "resolved"].includes(raw.lastOutcome.outcome)
              ? raw.lastOutcome.outcome
              : "resolved",
            text: String(raw.lastOutcome.text || "").slice(0, 500),
            effectsText: String(raw.lastOutcome.effectsText || "").slice(0, 300),
            at: Math.max(0, Number(raw.lastOutcome.at) || 0),
          }
        : null;
    return {
      version: 1,
      activeId: EVENT_MAP.has(raw.activeId) ? raw.activeId : "",
      readyAt: Math.max(0, Number(raw.readyAt) || 0),
      draws: integer(raw.draws, 0, 0, 1e7),
      seen,
      flags,
      history,
      lastOutcome: last,
    };
  }

  function eventById(id) {
    return EVENT_MAP.get(id) || null;
  }

  function rootInfo(state) {
    return C.ROOTS[state && state.cultivation && state.cultivation.attributes.root] || C.ROOTS.mixed;
  }

  function stateFlag(state, key) {
    return Boolean(state.opportunities && state.opportunities.flags && state.opportunities.flags[key]);
  }

  function checkCondition(state, condition) {
    const cultivation = state.cultivation || {};
    const attributes = cultivation.attributes || {};
    const root = rootInfo(state);
    switch (condition.type) {
      case "level":
        return (
          (condition.min === undefined || state.level >= condition.min) &&
          (condition.max === undefined || state.level <= condition.max)
        );
      case "region":
        return condition.ids.includes(cultivation.regionId);
      case "root":
        return condition.ids.includes(root.id);
      case "rootKind":
        return condition.kinds.includes(root.kind);
      case "insight":
        return attributes.insight >= condition.min;
      case "fortune":
        return attributes.fortune >= condition.min;
      case "daoHeart":
        return (
          (condition.min === undefined || attributes.daoHeart >= condition.min) &&
          (condition.max === undefined || attributes.daoHeart <= condition.max)
        );
      case "lifespan":
        return (
          (condition.min === undefined || attributes.lifespan >= condition.min) &&
          (condition.max === undefined || attributes.lifespan <= condition.max)
        );
      case "stones":
        return (cultivation.stones && cultivation.stones[condition.tier || "low"]) >= condition.min;
      case "herbs":
        return (Number(cultivation.herbs) || 0) >= condition.min;
      case "pill":
        return (Number(cultivation.pills && cultivation.pills[condition.pill]) || 0) >= condition.min;
      case "techniqueMastery":
        return (Number(cultivation.technique) || 0) >= condition.min;
      case "karma":
        return (
          (condition.min === undefined || (Number(cultivation.karma) || 0) >= condition.min) &&
          (condition.max === undefined || (Number(cultivation.karma) || 0) <= condition.max)
        );
      case "demonized":
        return Boolean(cultivation.demonized) === condition.value;
      case "flag":
        return stateFlag(state, condition.key) === condition.value;
      case "any":
        return condition.conditions.some((item) => checkCondition(state, item));
      default:
        return false;
    }
  }

  function failedConditions(state, conditions) {
    return (conditions || []).filter((condition) => !checkCondition(state, condition));
  }

  function describeCondition(condition) {
    switch (condition.type) {
      case "level":
        return condition.min !== undefined ? `境界 Lv.${condition.min}` : `低于 Lv.${condition.max}`;
      case "region":
        return `位于${condition.ids.map((id) => (C.regionById(id) || { name: id }).name).join("、")}`;
      case "root":
        return `灵根为${condition.ids.map((id) => (C.ROOTS[id] || { name: id }).name).join("、")}`;
      case "rootKind":
        return `灵根档位为${condition.kinds
          .map(
            (kind) =>
              ({
                single: "单灵根",
                dual: "双灵根",
                mixed: "五灵根",
                variant: "变异灵根",
                innate: "先天道体",
              })[kind] || kind
          )
          .join("、")}`;
      case "insight":
        return `悟性 ${condition.min}`;
      case "fortune":
        return `福缘 ${condition.min}`;
      case "daoHeart":
        return condition.min !== undefined ? `道心 ${condition.min}` : `道心不高于 ${condition.max}`;
      case "lifespan":
        return "寿元状态契合";
      case "stones":
        return `${C.STONE_TIERS[condition.tier || "low"].short}灵石 ${condition.min}`;
      case "herbs":
        return `灵药 ${condition.min}`;
      case "pill":
        return `${condition.pill === "life" ? "延寿丹" : "破境丹"} ${condition.min}`;
      case "techniqueMastery":
        return `功法领悟 ${condition.min}`;
      case "karma":
        return "因果状态契合";
      case "demonized":
        return condition.value ? "已入魔修" : "未入魔";
      case "flag":
        return "需要前序机缘";
      case "any":
        return condition.conditions.map(describeCondition).join(" 或 ");
      default:
        return "条件未满足";
    }
  }

  function lastSeenDraw(state, eventId) {
    const entry = [...state.opportunities.history].reverse().find((item) => item.eventId === eventId);
    return entry ? entry.draw : -Infinity;
  }

  function isEligible(state, event) {
    const opportunity = state.opportunities;
    const count = Number(opportunity.seen[event.id]) || 0;
    if (event.once && count > 0) return false;
    if (event.maxTimes !== undefined && count >= event.maxTimes) return false;
    if (event.cooldown && opportunity.draws - lastSeenDraw(state, event.id) < event.cooldown) {
      return false;
    }
    return failedConditions(state, event.conditions).length === 0;
  }

  function eventWeight(state, event) {
    const opportunity = state.opportunities;
    const fortune = Number(state.cultivation.attributes.fortune) || 1;
    const last = lastSeenDraw(state, event.id);
    const since = opportunity.draws - last;
    let weight = Number(event.weight) || 1;
    weight *= RARITY_WEIGHT[event.rarity] || 1;
    if (since < 2) weight *= 0.12;
    else if (since < 4) weight *= 0.45;
    if (event.rarity !== "common") weight *= 1 + fortune * 0.002;
    return Math.max(0.001, weight);
  }

  function chooseEvent(state, random) {
    const candidates = EVENTS.filter((event) => isEligible(state, event));
    const pool = candidates.length ? candidates : [EVENT_MAP.get("dew_before_dawn")];
    const weights = pool.map((event) => eventWeight(state, event));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let roll = random() * total;
    for (let index = 0; index < pool.length; index += 1) {
      roll -= weights[index];
      if (roll <= 0) return pool[index];
    }
    return pool[pool.length - 1];
  }

  function status(state, now) {
    const opportunity = state.opportunities || emptyState(now);
    const active = eventById(opportunity.activeId);
    return {
      active,
      activeId: active ? active.id : "",
      readyAt: Number(opportunity.readyAt) || 0,
      cooldownMs: Math.max(0, (Number(opportunity.readyAt) || 0) - (Number(now) || Date.now())),
      conditionsText:
        active && Array.isArray(active.conditions) ? active.conditions.map(describeCondition) : [],
      draws: Number(opportunity.draws) || 0,
      history: [...opportunity.history].reverse(),
      lastOutcome: opportunity.lastOutcome,
      choices:
        active && Array.isArray(active.choices)
          ? active.choices.map((choice) => {
              const failed = failedConditions(state, choice.requirements);
              return {
                ...choice,
                available: failed.length === 0,
                missing: failed.map(describeCondition),
              };
            })
          : [],
    };
  }

  function draw(state, now, rng) {
    const ts = Number(now) || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.opportunities = normalizeState(state.opportunities, ts);
    const opportunity = state.opportunities;
    if (opportunity.activeId) {
      return { ok: true, event: eventById(opportunity.activeId), alreadyActive: true };
    }
    if (opportunity.readyAt > ts) {
      return { ok: false, reason: "cooldown", readyAt: opportunity.readyAt };
    }
    const event = chooseEvent(state, random);
    opportunity.activeId = event.id;
    opportunity.draws += 1;
    opportunity.lastOutcome = null;
    return { ok: true, event, draw: opportunity.draws };
  }

  function addStone(cultivation, tier, value) {
    const key = C.STONE_TIERS[tier] ? tier : "low";
    cultivation.stones[key] = Math.max(0, (Number(cultivation.stones[key]) || 0) + value);
    cultivation.spiritStones = cultivation.stones.low;
  }

  function rewardTechnique(state, random, tierId) {
    const candidates = Object.values(C.TECHNIQUES).filter(
      (technique) =>
        C.techniqueCompatible(state.cultivation, technique.id) && (!tierId || technique.tier === tierId)
    );
    if (!candidates.length) return null;
    const technique = candidates[Math.floor(random() * candidates.length) % candidates.length];
    state.cultivation.techniqueScrolls[technique.id] =
      (Number(state.cultivation.techniqueScrolls[technique.id]) || 0) + 1;
    return technique;
  }

  function applyEffects(state, effects, random) {
    const descriptions = [];
    const cultivation = state.cultivation;
    (effects || []).forEach((effect) => {
      switch (effect.type) {
        case "exp": {
          const amount = Math.max(0, Number(effect.value) || 0);
          const advanced = C.addExperience(cultivation, state.level, amount);
          state.level = advanced.level;
          descriptions.push(`修为 +${Math.round(amount)}`);
          break;
        }
        case "expPercent": {
          const value = Number(effect.value) || 0;
          const amount = Math.round(C.expRequired(state.level) * value);
          if (amount >= 0) {
            const advanced = C.addExperience(cultivation, state.level, amount);
            state.level = advanced.level;
            descriptions.push(`修为 +${amount}`);
          } else {
            cultivation.exp = Math.max(0, cultivation.exp + amount);
            descriptions.push(`修为 ${amount}`);
          }
          break;
        }
        case "stone": {
          addStone(cultivation, effect.tier, Math.round(Number(effect.value) || 0));
          descriptions.push(
            `${C.STONE_TIERS[effect.tier || "low"].short}灵石 ${Number(effect.value) >= 0 ? "+" : ""}${effect.value}`
          );
          break;
        }
        case "herb":
          cultivation.herbs = Math.max(0, (Number(cultivation.herbs) || 0) + effect.value);
          descriptions.push(`灵药 ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          break;
        case "pill":
          cultivation.pills[effect.pill] = Math.max(
            0,
            (Number(cultivation.pills[effect.pill]) || 0) + effect.value
          );
          descriptions.push(
            `${effect.pill === "life" ? "延寿丹" : "破境丹"} ${effect.value >= 0 ? "+" : ""}${effect.value}`
          );
          break;
        case "thunderPearl":
          cultivation.thunderPearls = Math.max(0, (Number(cultivation.thunderPearls) || 0) + effect.value);
          descriptions.push(`避雷珠 ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          break;
        case "attribute": {
          const key = effect.key;
          if (key === "insight" || key === "fortune" || key === "daoHeart" || key === "lifespan") {
            cultivation.attributes[key] = Math.min(
              C.MAX_ATTRIBUTE,
              Math.max(
                key === "daoHeart" ? 0 : 1,
                (Number(cultivation.attributes[key]) || 0) + effect.value
              )
            );
            const label = C.ATTRIBUTE_META[key].label;
            descriptions.push(`${label} ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          }
          break;
        }
        case "lifespan":
          cultivation.bonusLifespan = Math.max(0, (Number(cultivation.bonusLifespan) || 0) + effect.value);
          descriptions.push(`寿元 ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          break;
        case "techniqueMastery":
          cultivation.technique = Math.max(
            0,
            Math.min(C.MAX_TECHNIQUE_MASTERY, (Number(cultivation.technique) || 0) + effect.value)
          );
          descriptions.push(`功法领悟 ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          break;
        case "karma":
          cultivation.karma = Math.max(
            0,
            (Number(cultivation.karma) || 0) + Math.round(Number(effect.value) || 0)
          );
          descriptions.push(`业力 ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          break;
        case "coins":
          state.coins = Math.max(0, state.coins + Math.round(Number(effect.value) || 0));
          descriptions.push(`金币 ${effect.value >= 0 ? "+" : ""}${effect.value}`);
          break;
        case "flag":
          state.opportunities.flags[effect.key] = Boolean(effect.value);
          break;
        case "technique": {
          const technique = rewardTechnique(state, random, effect.tier);
          if (technique) descriptions.push(`获得功法卷轴「${technique.name}」`);
          break;
        }
        default:
          break;
      }
    });
    return descriptions;
  }

  function resolveChoice(state, choiceId, now, rng) {
    const ts = Number(now) || Date.now();
    const random = typeof rng === "function" ? rng : Math.random;
    state.opportunities = normalizeState(state.opportunities, ts);
    const opportunity = state.opportunities;
    const event = eventById(opportunity.activeId);
    if (!event) return { ok: false, reason: "no-active" };
    const choice = event.choices.find((item) => item.id === choiceId);
    if (!choice) return { ok: false, reason: "choice" };
    const failed = failedConditions(state, choice.requirements);
    if (failed.length) {
      return {
        ok: false,
        reason: "requirements",
        missing: failed.map(describeCondition),
      };
    }
    let outcomeKey = "resolved";
    let narrative = choice.narrative || choice.text;
    let effects = choice.effects || [];
    let chance = null;
    if (choice.outcomes && choice.outcomes.length) {
      const branch = choice.outcomes[0];
      chance = Math.max(
        0.05,
        Math.min(
          0.95,
          Number(branch.chance) +
            (Number(state.cultivation.attributes.fortune) || 0) * Number(branch.fortuneBonus || 0)
        )
      );
      const success = random() < chance;
      outcomeKey = success ? "success" : "failure";
      const selected = success ? branch.success : branch.failure;
      narrative = selected.text;
      effects = [...effects, ...(selected.effects || [])];
    }
    const effectsText = applyEffects(state, effects, random);
    opportunity.activeId = "";
    opportunity.readyAt = ts + DRAW_COOLDOWN_MS;
    opportunity.seen[event.id] = (Number(opportunity.seen[event.id]) || 0) + 1;
    const entry = {
      eventId: event.id,
      eventTitle: event.title,
      choiceId: choice.id,
      choiceText: choice.text,
      outcome: outcomeKey,
      text: narrative,
      effectsText: effectsText.join("，"),
      at: ts,
      draw: opportunity.draws,
    };
    opportunity.history.push(entry);
    opportunity.history = opportunity.history.slice(-HISTORY_LIMIT);
    opportunity.lastOutcome = {
      eventId: event.id,
      eventTitle: event.title,
      outcome: outcomeKey,
      text: narrative,
      effectsText: effectsText.join("，"),
      at: ts,
    };
    return {
      ok: true,
      event,
      choice,
      outcome: outcomeKey,
      chance,
      narrative,
      effectsText: effectsText.join("，"),
      entry,
      readyAt: opportunity.readyAt,
    };
  }

  return {
    DRAW_COOLDOWN_MS,
    HISTORY_LIMIT,
    RARITY_LABELS,
    EVENTS,
    emptyState,
    normalizeState,
    eventById,
    checkCondition,
    describeCondition,
    isEligible,
    eventWeight,
    status,
    draw,
    resolveChoice,
  };
});
