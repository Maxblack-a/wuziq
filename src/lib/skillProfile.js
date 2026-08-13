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
const NOT_TRIGGERED_SCORE = 50; // 关卡因为分层降级被跳过,没有数据,给个中性分,不拉低也不拉高

function checkpointScore(checkpoints, type) {
  const cp = checkpoints.find((c) => c.type === type);
  if (!cp) return { score: NOT_TRIGGERED_SCORE, confidence: "none" };
  return { score: CHECKPOINT_SCORE[cp.result] ?? NOT_TRIGGERED_SCORE, confidence: cp.catalyzed ? "assisted" : "natural" };
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

// 应变力:关卡 miss 之后紧接着几步的表现有没有明显滑坡。用"失误后的分数
// 走势是持平/回升"还是"越来越差"来判断,没有 miss 过的话给中性分——
// 不代表应变力不行,只是没有数据能看出来(小分放在 checklist 的置信度里体现)。
function adaptScore(checkpoints) {
  const missed = checkpoints.filter((c) => c.result === "miss" && c.recoveryTrend?.length >= 2);
  if (!missed.length) return NOT_TRIGGERED_SCORE;
  const trends = missed.map((c) => {
    const t = c.recoveryTrend;
    const rising = t[t.length - 1] >= t[0];
    return rising ? 75 : 35;
  });
  return Math.round(trends.reduce((a, b) => a + b, 0) / trends.length);
}

export function computeSkillProfile(testState) {
  const { checkpoints, moves, openingSamples } = testState;

  const defenseR = checkpointScore(checkpoints, "defense");
  const offenseR = checkpointScore(checkpoints, "offense");
  const globalR = checkpointScore(checkpoints, "global");

  const dims = {
    attack: offenseR.score,
    defense: defenseR.score,
    vision: globalR.score,
    calc: calcScore(moves),
    opening: openingScore(openingSamples),
    adapt: adaptScore(checkpoints),
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
    hiddenScore,
    confidence,
    type: type.key,
    typeInfo: type,
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
