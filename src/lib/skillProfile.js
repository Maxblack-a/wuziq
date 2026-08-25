// 六维风格分 + 隐藏综合水平分 + 棋手类型,全部从 skillTest.js 采集到的
// 原始数据(逐步棋谱 + 关卡事件)派生——这一层是"展示/消费层",可以
// 随时重新设计权重甚至重新计算,不影响原始数据的存储格式。

const DIM_KEYS = ["attack", "defense", "vision", "calc", "opening", "adapt"];

const DIM_LABELS = {
  attack: "攻击力",
  defense: "防守力",
  vision: "全局观",
  calc: "计算力",
  opening: "布局感",
  adapt: "应变力",
};

// 关卡结果 -> 分数的映射,hit 满分、partial 折中、miss 垫底但不是 0
// (0 分在雷达图上会画出一个尖角戳到圆心,视觉上很突兀,而且"没测到"
// 跟"测到了但是很差"应该有区别,后者才该是 0 附近)
const CHECKPOINT_SCORE = { hit: 92, partial: 58, miss: 22 };

// 这一局里玩家整体落子质量的均值(0~1)——跟"计算力"用的是同一份数据,
// 单独抽出来是因为好几个维度在关卡没有真正触发时都要用它做兜底估算。
function overallQualityRatio(moves) {
  const relevant = moves.filter((m) => m.player === "human" && m.bestAvailable > 0);
  if (!relevant.length) return null;
  const sum = relevant.reduce((s, m) => s + Math.min(1, Math.max(m.attack, m.defend) / m.bestAvailable), 0);
  return sum / relevant.length;
}

// 某一关这局没有真正触发,通常是因为棋在关卡触发之前就真的分出了胜负
// (双活三这类五子棋规则本身决定的必胜棋型,不是引擎能完全防住的)。
// 遇到这种情况不再留一个孤零零的、跟这局实际表现毫无关系的中性 50 分——
// 用这局里其实已经采集到的"整体落子质量"做一个有依据的估算,保证每一项
// 都有一个站得住脚、从这局真实数据算出来的数字,而不是一片空白。
// confidence 仍然区分 natural/assisted/estimated,供内部诊断使用,但
// 不会再拿"estimated"去反过来在界面上标"这局没测出"这类否定性的话——
// 玩家看到的应该始终是一份完整的结果。
function checkpointScore(checkpoints, type, moves) {
  const cp = checkpoints.find((c) => c.type === type);
  if (cp) {
    return { score: CHECKPOINT_SCORE[cp.result] ?? 50, confidence: cp.catalyzed ? "assisted" : "natural" };
  }
  const ratio = overallQualityRatio(moves);
  if (ratio != null) {
    return { score: Math.round(ratio * 100), confidence: "estimated" };
  }
  return { score: 50, confidence: "estimated" };
}

// 计算力:每一步实际落点分值 跟 当时局面理论最高分之间的差距,差距越小分越高。
// 只看玩家自己的棋谱(player === 'human'),忽略开局前几手(样本太少、
// 候选池本来就窄,差距天然是 0,会虚高)。
function calcScore(moves) {
  const relevant = moves.filter((m) => m.player === "human" && m.bestAvailable > 0);
  if (!relevant.length) return 50;
  const gaps = relevant.map((m) => {
    const actual = Math.max(m.attack, m.defend);
    return Math.min(1, actual / m.bestAvailable);
  });
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.round(avg * 100);
}

// 布局感:开局采样阶段落子跟"已有己方棋子"的空间关联度。距离 1(紧贴)
// 给满分区间,距离越远分数线性下降,超过 4 格基本判定为"另起炉灶"。
function openingScore(samples) {
  const withDist = samples.filter((s) => s.distToNearestOwn != null);
  if (!withDist.length) return 50;
  const scores = withDist.map((s) => Math.max(0, 100 - (s.distToNearestOwn - 1) * 28));
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// 应变力:关卡 miss 或 partial 之后紧接着几步的表现有没有明显滑坡。用
// "受挫后的分数走势是持平/回升"还是"越来越差"来判断——miss 是更硬的
// 挫折信号,partial(没做到最优但也不算彻底失手)压力更轻,回升/下滑
// 给的分差也相应收窄,避免"partial 之后随便走两步"就跟"miss 之后真扛
// 住了"混到同一档分数。
// 之前这里只认 miss,没出现过 miss 的话直接给中性分——但这局面站得住
// (棋下得越稳越测不出应变力)也站不住(玩家会以为自己应变力一般,实际
// 只是这局没给他机会犯错)。所以返回值除了分数,还带一个 measured 标记,
// 没有真实数据时消费方(结果页)可以选择不把这个分数当真实测量值展示。
// 应变力:优先信号是关卡 miss/partial 之后紧接着几步的走势——这是最
// 直接的"受挫之后稳不稳"的证据,有就优先用。
// 备用信号:游戏现在会一直下到真正分出胜负,不会再半路掐断,所以只要
// 这一局棋够长,就算玩家全程没有明显失误(压根没有 miss/partial 可看),
// 依然可以从"前半程和后半程下棋质量有没有掉线"这个更宏观的指标里,
// 看出他一整盘棋下不下得稳——不然"应变力"会变成一个必须先犯错才能
// 被测出来的维度,对下得好的玩家反而不公平,而且是"这局没测出"最常见
// 的来源(不是判定逻辑漏了,是这条维度的定义本身对多数正常发挥的对局
// 都没有数据)。
function adaptScore(checkpoints, moves) {
  const withTrend = checkpoints.filter((c) => (c.result === "miss" || c.result === "partial") && c.recoveryTrend?.length >= 2);
  if (withTrend.length) {
    const trends = withTrend.map((c) => {
      const t = c.recoveryTrend;
      const rising = t[t.length - 1] >= t[0];
      const swing = c.result === "miss" ? 20 : 10;
      return rising ? 55 + swing : 55 - swing;
    });
    const score = Math.round(trends.reduce((a, b) => a + b, 0) / trends.length);
    return { score, measured: true };
  }

  const relevant = moves.filter((m) => m.player === "human" && m.bestAvailable > 0);
  if (relevant.length < 8) return { score: 50, measured: false };
  const mid = Math.floor(relevant.length / 2);
  const avgRatio = (list) => list.reduce((s, m) => s + Math.max(m.attack, m.defend) / m.bestAvailable, 0) / list.length;
  const delta = avgRatio(relevant.slice(mid)) - avgRatio(relevant.slice(0, mid));
  // delta 是前后两段"落子质量比例"的差,本身落在 -1~1 之间,乘 40 映射
  // 到跟其他维度同量级的浮动区间,55 分是"前后没有明显变化"时的基准
  const score = Math.round(Math.max(20, Math.min(90, 55 + delta * 40)));
  return { score, measured: true };
}

// 从原始信号里挑几个"这一局专属"的具体细节,给 lib/linmoDialogue.js 的
// resultLine 引用——不算分,只是把关卡结果/回合数这些事实整理成结构化
// 数据,具体怎么措辞交给 linmoDialogue 决定。取不到的字段留 null/undefined,
// 由 resultLine 那边决定要不要因此退回到只说通用点评。
function buildHighlights(testState) {
  const { checkpoints, moves } = testState;
  const findCp = (type) => checkpoints.find((c) => c.type === type) || null;

  const defenseCp = findCp("defense");
  const offenseCp = findCp("offense");
  const globalCp = findCp("global");

  const relevant = moves.filter((m) => m.player === "human" && m.bestAvailable > 0);
  const near = relevant.filter((m) => Math.max(m.attack, m.defend) / m.bestAvailable >= 0.95);

  const recoveredSetback = checkpoints.find((c) => (c.result === "miss" || c.result === "partial") && c.recoveryTrend?.length >= 2
    && c.recoveryTrend[c.recoveryTrend.length - 1] >= c.recoveryTrend[0]);

  return {
    defense: defenseCp ? { result: defenseCp.result, turn: defenseCp.triggeredAtMove } : null,
    offense: offenseCp ? { result: offenseCp.result, turn: offenseCp.triggeredAtMove } : null,
    global: globalCp ? { result: globalCp.result, turn: globalCp.triggeredAtMove } : null,
    calc: relevant.length ? { total: relevant.length, near: near.length } : null,
    opening: openingScore(testState.openingSamples) >= 60,
    adapt: recoveredSetback ? { recovered: true, missTurn: recoveredSetback.triggeredAtMove } : null,
    totalMoves: moves.length,
  };
}

export function computeSkillProfile(testState) {
  const { checkpoints, moves, openingSamples } = testState;

  const defenseR = checkpointScore(checkpoints, "defense", moves);
  const offenseR = checkpointScore(checkpoints, "offense", moves);
  const globalR = checkpointScore(checkpoints, "global", moves);
  const adaptR = adaptScore(checkpoints, moves);

  const dims = {
    attack: offenseR.score,
    defense: defenseR.score,
    vision: globalR.score,
    calc: calcScore(moves),
    opening: openingScore(openingSamples),
    adapt: adaptR.score,
  };

  // 每个维度是不是"这一局真正实测出来的",而不是关卡没触发时用整体
  // 落子质量估算出来的——这个字段只做内部记录/诊断用,不再驱动结果页
  // 的展示(不管是不是估算出来的,玩家看到的都应该是一份完整、正常呈现
  // 的结果,不再标"这局没测出"这类否定性的话)。
  const dimsMeasured = {
    attack: offenseR.confidence !== "estimated",
    defense: defenseR.confidence !== "estimated",
    vision: globalR.confidence !== "estimated",
    calc: moves.some((m) => m.player === "human" && m.bestAvailable > 0),
    opening: openingSamples.some((s) => s.distToNearestOwn != null),
    adapt: adaptR.measured,
  };

  // 隐藏综合水平分(0-100,不展示):关卡命中率 + 计算精度加权,是每日
  // 试炼冷启动难度匹配用的起点,置信度低时不应该被当成精确值使用——
  // 置信度跟着一起返回,由消费方(每日试炼)决定要不要放宽浮动范围。
  const triggeredCount = checkpoints.length;
  const hiddenScore = Math.round(
    dims.calc * 0.35 + dims.defense * 0.25 + dims.attack * 0.25 + dims.vision * 0.15
  );
  const confidence = triggeredCount >= 3 ? "medium" : triggeredCount >= 1 ? "low" : "very_low";

  const type = classifyType(dims);

  return {
    dims,
    dimLabels: DIM_LABELS,
    dimsMeasured,
    hiddenScore,
    confidence,
    type: type.key,
    typeInfo: type,
    highlights: buildHighlights(testState),
    completeness: { checkpointsTriggered: triggeredCount, totalMoves: moves.length },
  };
}

// ---- 棋手类型判定:按"相对形状"而不是绝对分数 ----
// 找出比六维平均值明显高出一截的维度,只有一个 -> 单维型;有两个且都在
// TYPE_COMBOS 定义的组合里 -> 组合型;都差不多平 -> 均衡型。
const THRESHOLD_ABOVE_MEAN = 13;

const TYPE_DEFS = {
  attack: { key: "attack", name: "强攻型", summary: "擅长主动制造威胁、找杀棋,风格凌厉。" },
  defense: { key: "defense", name: "铁壁型", summary: "化解威胁又快又准,不容易被偷袭得手。" },
  vision: { key: "vision", name: "统帅型", summary: "习惯纵览整个棋盘,不容易漏看局部之外的动向。" },
  calc: { key: "calc", name: "精算型", summary: "落子贴近理论最优解,少走亏损的棋。" },
  opening: { key: "opening", name: "谋士型", summary: "棋感好,落子讲章法,擅长为后面铺垫。" },
  adapt: { key: "adapt", name: "随机应变型", summary: "计划被打乱后能很快调整,不容易慌了阵脚。" },
  attack_calc: { key: "attack_calc", name: "杀手型", summary: "进攻意识强,又能精准算出致命的那一手。" },
  defense_adapt: { key: "defense_adapt", name: "磐石型", summary: "扛得住压力,被打乱节奏也不崩,属于耐磨型棋手。" },
  vision_opening: { key: "vision_opening", name: "军师型", summary: "擅长经营整盘棋的节奏和大局,偏策略型打法。" },
  balanced: { key: "balanced", name: "均衡型", summary: "六维发展均衡,没有明显短板,样样过得去。" },
};

const COMBO_KEYS = new Set(["attack_calc", "defense_adapt", "vision_opening"]);
function comboKeyFor(a, b) {
  const pair = [a, b].sort().join("_");
  if (pair === "attack_calc" || pair === "calc_attack") return "attack_calc";
  if (pair === "adapt_defense" || pair === "defense_adapt") return "defense_adapt";
  if (pair === "opening_vision" || pair === "vision_opening") return "vision_opening";
  return null;
}

function classifyType(dims) {
  const mean = DIM_KEYS.reduce((s, k) => s + dims[k], 0) / DIM_KEYS.length;
  const above = DIM_KEYS
    .map((k) => ({ key: k, delta: dims[k] - mean }))
    .filter((d) => d.delta >= THRESHOLD_ABOVE_MEAN)
    .sort((a, b) => b.delta - a.delta);

  if (above.length >= 2) {
    const combo = comboKeyFor(above[0].key, above[1].key);
    if (combo) return TYPE_DEFS[combo];
  }
  if (above.length >= 1) return TYPE_DEFS[above[0].key];
  return TYPE_DEFS.balanced;
}

export { DIM_KEYS, DIM_LABELS, TYPE_DEFS };
