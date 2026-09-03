// 象棋 AI 引擎 v2 —— 给每日试炼的自适应难度系统当地基用,同时也是
// 阶段一"人机对战"里那个简单贪心 AI 的正式替代版(接口保持兼容,
// XiangqiPveScreen.jsx 不用改)。
// 五子棋那份 ai.js 的核心设计是"候选点 -> {attack, defend} 两个分数 ->
// 分档选点",这里原样复用同一套骨架,只是把"候选点"从棋盘上的一个空格
// 换成"一步走法(from->to)",评分方式也从"棋型识别"换成"吃子价值 +
// 局面评估的一阶前瞻",毕竟象棋没有五子棋那种连珠棋型可以直接查表。
import {
  pieceColor, pieceType, applyMove, allLegalMoves, isInCheck,
  checkGameOver, pseudoMoves, RED,
  SHUAI, SHI, XIANG, MA, CHE, PAO, BING,
} from "./xiangqiLogic";

export const VALUE = {
  [SHUAI]: 10000, [SHI]: 20, [XIANG]: 20, [MA]: 45, [CHE]: 90, [PAO]: 45, [BING]: 10,
};
const BING_CROSSED_BONUS = 12; // 卒过河之后价值明显上升(能横走、威胁面更大)
const CHECK_BONUS = 40;        // 这一步能将军,给的"进攻分"加成
const IN_CHECK_DEFEND_BONUS = 60; // 自己正被将军时,任何一手合法解将棋都算有效防守

// ---- 局面静态评估:子力 + 过河兵加成 + 机动性 + 将军状态 ----
function materialAndMobility(board, color) {
  let material = 0;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = board[y][x];
      if (!p) continue;
      let v = VALUE[pieceType(p)];
      if (pieceType(p) === BING) {
        const crossed = pieceColor(p) === RED ? y <= 4 : y >= 5;
        if (crossed) v += BING_CROSSED_BONUS;
      }
      material += pieceColor(p) === color ? v : -v;
    }
  }
  return material;
}

export function evaluate(board, color) {
  const opp = -color;
  let score = materialAndMobility(board, color);
  score += (allLegalMoves(board, color).length - allLegalMoves(board, opp).length) * 1.5;
  if (isInCheck(board, opp)) score += 25;
  if (isInCheck(board, color)) score -= 25;
  return score;
}

// 某个格子是否被 byColor 一方至少一枚子攻击到——用于粗略判断"这枚子是不是
// 正悬在那里没人保护",不做完整的静态交换评估(SEE),只看"有没有威胁",
// 够用于给"防守分"当参考,不追求子力交换精算。
function isSquareAttacked(board, x, y, byColor) {
  for (let py = 0; py < 10; py++) {
    for (let px = 0; px < 9; px++) {
      const p = board[py][px];
      if (p === 0 || pieceColor(p) !== byColor) continue;
      if (pseudoMoves(board, px, py).some(([mx, my]) => mx === x && my === y)) return true;
    }
  }
  return false;
}

// 给 aiColor 在当前棋盘上的每一步合法走法算 {from,to,attack,defend}——
// attack 是"这步棋能白吃到多少子/能不能顺手将军",defend 是"这步棋能不能
// 让一枚本来悬着的子脱险,或者解掉当前的将军"。跟 gomoku 版一样,这两个
// 分数是后面所有分档决策的原始输入。
export function scoreCandidates(board, aiColor, humanColor) {
  const inCheckNow = isInCheck(board, aiColor);
  return allLegalMoves(board, aiColor).map(({ from, to }) => {
    const movingPiece = board[from[1]][from[0]];
    const captured = board[to[1]][to[0]];
    const capturedValue = captured ? VALUE[pieceType(captured)] : 0;
    const next = applyMove(board, from, to);
    const givesCheck = isInCheck(next, humanColor);

    const wasHanging = isSquareAttacked(board, from[0], from[1], humanColor);
    const stillHanging = isSquareAttacked(next, to[0], to[1], humanColor);
    const dangerReduced = wasHanging && !stillHanging ? VALUE[pieceType(movingPiece)] : 0;

    return {
      from, to,
      attack: capturedValue + (givesCheck ? CHECK_BONUS : 0),
      defend: dangerReduced + (inCheckNow ? IN_CHECK_DEFEND_BONUS : 0),
    };
  });
}

// 唯一的"底线":能一步将死对方,就不用再权衡任何别的因素,直接走。
// 象棋跟五子棋不一样的地方是——"必须防守"这件事已经被 allLegalMoves
// 兜底了(正被将军时,不解将的走法根本不在合法走法列表里),不需要再单独
// 判一次"要不要挡",这也是这份引擎比 gomoku 那份 findForcedMove 简单的
// 地方。
export function findForcedMove(scored, board, aiColor, humanColor) {
  for (const c of scored) {
    const next = applyMove(board, c.from, c.to);
    const over = checkGameOver(next, humanColor);
    if (over && over.winner === aiColor) return c;
  }
  return null;
}

export function bestScoreFor(board, color, opponent) {
  const scored = scoreCandidates(board, color, opponent);
  if (!scored.length) return 0;
  return Math.max(...scored.map((c) => Math.max(c.attack, c.defend)));
}

function weightedRandomPick(list, weightFn) {
  const weights = list.map((c) => Math.max(weightFn(c), 0.001));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

export function styledBase(c, personality) {
  return Math.max(c.attack * personality.aggression, c.defend * personality.caution);
}

// 低档:纯静态评分 + 加权随机,不看对手会怎么回应
export function pickByDialLow(pool, personality) {
  return weightedRandomPick(pool, (c) => Math.pow(Math.max(styledBase(c, personality), 1), personality.patience));
}

// 中档:1 层前瞻——每个候选走完之后,倒扣对手在新局面下能拿到的最高分
export function pickByDialMid(board, pool, aiColor, humanColor, personality) {
  const withLookahead = pool.map((c) => {
    const next = applyMove(board, c.from, c.to);
    const oppBest = bestScoreFor(next, humanColor, aiColor);
    const finalScore = styledBase(c, personality) - oppBest * 0.9 * personality.precision;
    return { ...c, finalScore };
  });
  return weightedRandomPick(withLookahead, (c) => Math.pow(Math.max(c.finalScore, 1), personality.patience));
}

// 高档:只在评分最高的一小撮候选里做 2 层前瞻,零随机,直接选算出来最优的
export function pickByDialHigh(board, pool, aiColor, humanColor, personality) {
  const topCandidates = [...pool]
    .sort((a, b) => styledBase(b, personality) - styledBase(a, personality))
    .slice(0, 10);

  let best = null;
  for (const c of topCandidates) {
    const next = applyMove(board, c.from, c.to);
    let finalScore = styledBase(c, personality);

    const oppScored = scoreCandidates(next, humanColor, aiColor);
    const oppForced = findForcedMove(oppScored, next, humanColor, aiColor);
    const oppMove = oppForced || oppScored.reduce(
      (b, x) => (!b || Math.max(x.attack, x.defend) > Math.max(b.attack, b.defend) ? x : b), null
    );
    if (oppMove) {
      const oppScore = Math.max(oppMove.attack, oppMove.defend);
      const next2 = applyMove(next, oppMove.from, oppMove.to);
      const aiFollowUp = bestScoreFor(next2, aiColor, humanColor);
      finalScore = finalScore - oppScore * 0.9 * personality.precision + aiFollowUp * 0.5;
    }
    if (!best || finalScore > best.finalScore) {
      best = { ...c, finalScore };
    }
  }
  return best;
}

// ---- 独立难度档位(不挂在每日试炼评分系统上时用,阶段一"人机对战"
//      XiangqiPveScreen.jsx 调的就是这个,接口跟旧版保持兼容) ----
const SIMPLE_PERSONALITY = { aggression: 1, caution: 1, precision: 1, patience: 1 };

export function chooseAiMove(board, color, difficulty = "normal") {
  const opp = -color;
  const scored = scoreCandidates(board, color, opp);
  if (!scored.length) return null;
  const forced = findForcedMove(scored, board, color, opp);
  if (forced) return forced;

  if (difficulty === "easy") return pickByDialLow(scored, SIMPLE_PERSONALITY);
  if (difficulty === "hard") return pickByDialHigh(board, scored, color, opp, SIMPLE_PERSONALITY);
  return pickByDialMid(board, scored, color, opp, SIMPLE_PERSONALITY);
}
