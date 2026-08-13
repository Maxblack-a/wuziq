import { BOARD_SIZE, EMPTY, inBounds, cloneBoard } from "./logic";

// 棋型分值表(己方棋型 -> 分数),数值参考经典五子棋启发式引擎的常见配置
const SCORE = {
  FIVE: 100000,
  LIVE_FOUR: 10000,      // 活四:两端都空,下一步必胜
  FOUR: 1000,            // 冲四:一端被堵
  LIVE_THREE: 800,       // 活三:能长成活四
  SLEEP_THREE: 100,
  LIVE_TWO: 80,
  SLEEP_TWO: 10,
};

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function lineScore(board, x, y, player, dx, dy) {
  // 统计以 (x,y) 为起点、某方向连续同色棋子数,以及两端是否被封
  let count = 1;
  let openEnds = 0;

  let nx = x + dx, ny = y + dy;
  while (inBounds(nx, ny) && board[ny][nx] === player) { count++; nx += dx; ny += dy; }
  if (inBounds(nx, ny) && board[ny][nx] === EMPTY) openEnds++;

  nx = x - dx; ny = y - dy;
  while (inBounds(nx, ny) && board[ny][nx] === player) { count++; nx -= dx; ny -= dy; }
  if (inBounds(nx, ny) && board[ny][nx] === EMPTY) openEnds++;

  if (count >= 5) return SCORE.FIVE;
  if (count === 4) return openEnds === 2 ? SCORE.LIVE_FOUR : (openEnds === 1 ? SCORE.FOUR : 0);
  if (count === 3) return openEnds === 2 ? SCORE.LIVE_THREE : (openEnds === 1 ? SCORE.SLEEP_THREE : 0);
  if (count === 2) return openEnds === 2 ? SCORE.LIVE_TWO : (openEnds === 1 ? SCORE.SLEEP_TWO : 0);
  return 0;
}

function evaluatePoint(board, x, y, player) {
  if (board[y][x] !== EMPTY) return -1;
  let total = 0;
  const trial = cloneBoard(board);
  trial[y][x] = player;
  for (const [dx, dy] of DIRS) {
    total += lineScore(trial, x, y, player, dx, dy);
  }
  return total;
}

function candidateMoves(board) {
  // 只考虑已有棋子周围 2 格范围内的空位,避免在空棋盘上做 15x15 全量搜索
  const moves = new Set();
  let hasStone = false;
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== EMPTY) {
        hasStone = true;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx, ny = y + dy;
            if (inBounds(nx, ny) && board[ny][nx] === EMPTY) moves.add(`${nx},${ny}`);
          }
        }
      }
    }
  }
  if (!hasStone) return [[7, 7]]; // 空棋盘:天元开局
  return Array.from(moves).map(s => s.split(",").map(Number));
}

// 给某一方(player)在当前棋盘上算出所有候选点的进攻分(自己下会形成什么棋型)
// 和防守分(对手下会形成什么棋型),这一份数据是后面所有决策的基础
function scoreCandidates(board, player, opponent) {
  return candidateMoves(board).map(([x, y]) => ({
    x, y,
    attack: evaluatePoint(board, x, y, player),
    defend: evaluatePoint(board, x, y, opponent),
  }));
}

// ---- 三档共用的底线 ----
// 出现成五(直接赢)、冲四、活四这个级别的棋型时——不管是自己能形成还是
// 对手能形成——不允许任何随机流程插手,必须直接走最合理的那一步。
// 这条线以前只写在困难档里,现在三档统一遵守:哪怕是最低难度,也不能出现
// "对手都快连成五了它还在随机" 这种会被一眼看穿"AI在放水/AI没脑子"的情况。
function findForcedMove(scored) {
  // 能直接赢就直接赢,不用再权衡任何别的因素
  const ownWin = scored.find(c => c.attack >= SCORE.FIVE);
  if (ownWin) return ownWin;

  // 冲四/活四级别:自己被逼到必须防,或者自己能形成冲四/活四抢到主动权,
  // 都属于"再不处理这盘棋的走向就定了"的量级
  const critical = scored.filter(c => c.attack >= SCORE.FOUR || c.defend >= SCORE.FOUR);
  if (!critical.length) return null;

  critical.sort((a, b) => {
    const av = Math.max(a.attack, a.defend);
    const bv = Math.max(b.attack, b.defend);
    if (bv !== av) return bv - av;
    return b.defend - a.defend; // 分数打平时优先选防守,更稳妥,不冒险抢攻
  });
  return critical[0];
}

// ---- 活三预警层 ----
// 活三级别的威胁一旦出现(自己能做出活三,或者对手能做出活三),就是
// "正常人看到三个子连起来就会开始防范" 的那条心理线——虽然还没到
// "必须立刻处理不然就输" 的强制程度,但候选范围要收窄到真正跟这个
// 威胁相关的几个点,不能再跟棋盘上其他无关的点混在一起随机选。
//
// defend 乘了 1.1 的权重:避免重演之前"进攻分天然多加 5% 奖励"导致
// AI 明知对手在结三线却跑去下自己棋的那个漏洞——同等量级下,略微
// 倾向选择更保守的防守方向。
function findThreatPool(scored) {
  const triggered = scored.some(c => c.attack >= SCORE.LIVE_THREE || c.defend >= SCORE.LIVE_THREE);
  if (!triggered) return null;
  const threshold = SCORE.LIVE_THREE * 0.6;
  return scored.filter(c => Math.max(c.attack, c.defend * 1.1) >= threshold);
}

// ---- 平静局面下的候选池 ----
// 不再是"排名前 N 个候选随机选"(名次固定,容易随出一个分数烂到不成话、
// 一眼假的点),改成"分数达到最高分某个比例以上的都进池子",保证不管
// 随到哪一个,复盘时都能看出这一步是有道理的、只是不是最优解而已。
// ratio 越低,候选池越宽、随机性越大;三档的差异主要就体现在这个比例上。
function generalPool(scored, ratio) {
  const maxScore = Math.max(...scored.map(c => Math.max(c.attack, c.defend)), 1);
  const pool = scored.filter(c => Math.max(c.attack, c.defend) >= maxScore * ratio);
  return pool.length ? pool : scored;
}

// 按分数做线性加权随机(分越高被选中概率越大,但不是排名硬卡),
// 比"前 N 名等概率"更平滑,也更不容易被玩家摸出"AI只会在这几个选项里选"的规律
function weightedRandomPick(candidates, scoreFn) {
  const weights = candidates.map(c => Math.max(scoreFn(c), 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// 给 player 在 board 上找一步"最优解"(不带随机,不带随机池收窄逻辑),
// 用于模拟"对手/自己接下来会怎么回应"这种前瞻计算,而不是最终真正落子的决策
function bestMoveFor(board, player, opponent) {
  const scored = scoreCandidates(board, player, opponent);
  if (!scored.length) return null;
  const forced = findForcedMove(scored);
  if (forced) return forced;
  return scored.reduce(
    (best, c) => (!best || Math.max(c.attack, c.defend) > Math.max(best.attack, best.defend) ? c : best),
    null
  );
}

function bestScoreFor(board, player, opponent) {
  const move = bestMoveFor(board, player, opponent);
  return move ? Math.max(move.attack, move.defend) : 0;
}

// 双威胁预警:数一数在 board 这个局面下,forPlayer 有几个"独立的点"
// 能达到活三级别(也就是能凭一步棋新建一条活三,不是去延长已经存在的
// 那条)。如果这个数字 >= 2,说明棋盘上同时埋了两条快成型的线——这正是
// "悄悄布两条线、一步同时引爆成双活三"这种打法的前兆,而普通的
// 1层/2层预判只会看"对手能拿到的最高分是多少",完全捕捉不到
// "有没有两个地方同时逼近临界点"这件事,是之前留的一个真实漏洞
function countLiveThreeThreats(board, forPlayer, against) {
  const scored = scoreCandidates(board, forPlayer, against);
  return scored.filter(c => c.attack >= SCORE.LIVE_THREE).length;
}

// 简单:纯静态评估,不看"我下完对手会怎么回应",从候选池里加权随机选
function pickEasy(pool) {
  return weightedRandomPick(pool, c => Math.max(c.attack, c.defend));
}

// 中等:1 层预判——模拟落子后,对手能拿到的最高分是多少,倒扣回去,
// 尽量不留"看起来分高、实际上给对手送出更大威胁"的点;
// 算完之后依然是加权随机选,不是死盯着"倒扣后最优解"那一个点不放,
// 这样打法有章法(能防住需要往前想一步才能看出来的坑),但长期打
// 依然能摸出规律、找到能赢的缝
function pickMedium(board, pool, aiPlayer, humanPlayer) {
  const withLookahead = pool.map(c => {
    const trial = cloneBoard(board);
    trial[c.y][c.x] = aiPlayer;
    const oppBest = bestScoreFor(trial, humanPlayer, aiPlayer);
    let finalScore = Math.max(c.attack, c.defend) - oppBest * 0.9;

    // 双威胁预警(中等力度):明显减分,但不是直接踢出候选池——
    // 中等档最终还是加权随机选,减分之后这一步被选中的概率会大幅降低,
    // 但不是每次都能躲开,留一点"研究一下能钻的空子"
    if (countLiveThreeThreats(trial, humanPlayer, aiPlayer) >= 2) {
      finalScore -= SCORE.LIVE_THREE * 3;
    }

    return { x: c.x, y: c.y, finalScore };
  });
  return weightedRandomPick(withLookahead, c => c.finalScore);
}

// 困难:2 层预判——我下这步 -> 对手最优回应 -> 我对这个回应的最优反击,
// 三步都算完再综合打分,零随机,直接选算出来最优的一手。
// 候选范围收窄到分数最高的前 8 个再往下算,不然模拟对手+反击这两层
// 的计算量在手机端会明显卡顿
function pickHard(board, pool, aiPlayer, humanPlayer) {
  const topCandidates = [...pool]
    .sort((a, b) => Math.max(b.attack, b.defend) - Math.max(a.attack, a.defend))
    .slice(0, 8);

  let best = null;
  for (const c of topCandidates) {
    const board1 = cloneBoard(board);
    board1[c.y][c.x] = aiPlayer;

    const oppMove = bestMoveFor(board1, humanPlayer, aiPlayer);
    let finalScore = Math.max(c.attack, c.defend);

    if (oppMove) {
      const oppScore = Math.max(oppMove.attack, oppMove.defend);
      const board2 = cloneBoard(board1);
      board2[oppMove.y][oppMove.x] = humanPlayer;
      const aiFollowUp = bestScoreFor(board2, aiPlayer, humanPlayer);
      // 对手这步回应要倒扣,但自己后续还能反击回来多少要加回去——
      // 不然会过度悲观地回避一些"暂时让一步、但马上能反打回去"的好棋
      finalScore = finalScore - oppScore * 0.9 + aiFollowUp * 0.5;
    }

    // 双威胁预警(重力度):困难档是零随机、直接选算出来分数最高的那个点,
    // 所以只有让这个选项的分数远低于其他候选,才能保证"只要看见了就一定
    // 会避开",不能像中等档那样只是"降低被随机选中的概率"
    if (countLiveThreeThreats(board1, humanPlayer, aiPlayer) >= 2) {
      finalScore -= SCORE.LIVE_THREE * 8;
    }

    if (!best || finalScore > best.finalScore) {
      best = { x: c.x, y: c.y, finalScore };
    }
  }
  return best;
}

/**
 * 计算 AI 的落子
 * @param board 二维数组
 * @param aiPlayer AI 执子颜色 (1或2)
 * @param humanPlayer 对手颜色
 * @param difficulty 'easy' | 'medium' | 'hard'
 */
export function getAiMove(board, aiPlayer, humanPlayer, difficulty = "medium") {
  const scored = scoreCandidates(board, aiPlayer, humanPlayer);
  if (!scored.length) return null;

  // 底线:必杀/必防级别的威胁,三档统一强制处理,不参与随机
  const forced = findForcedMove(scored);
  if (forced) return forced;

  // 活三级别的威胁:收窄到真正相关的候选点
  const threatPool = findThreatPool(scored);

  if (threatPool) {
    if (difficulty === "hard") return pickHard(board, threatPool, aiPlayer, humanPlayer);
    if (difficulty === "medium") return pickMedium(board, threatPool, aiPlayer, humanPlayer);
    return pickEasy(threatPool);
  }

  // 平静局面:按难度采用不同宽窄的候选池
  if (difficulty === "hard") {
    return pickHard(board, generalPool(scored, 0.75), aiPlayer, humanPlayer);
  }
  if (difficulty === "medium") {
    return pickMedium(board, generalPool(scored, 0.7), aiPlayer, humanPlayer);
  }
  return pickEasy(generalPool(scored, 0.55));
}

// ---- 以下这批导出专供 game/skillTest.js(棋力测试的"林墨"引擎)复用 ----
// 棋力测试需要的不是"直接给我一步棋",而是"给我候选点的原始打分,
// 我自己按测试关卡的需要去挑",所以把内部这几个原本只在本文件用的
// 函数也导出,避免在 skillTest.js 里重新写一遍同样的棋型评估逻辑——
// 两处评估标准不一致,是最容易埋下"测试判定跟AI实际下棋逻辑对不上"
// 这种bug的地方。
export {
  SCORE,
  scoreCandidates,
  evaluatePoint,
  candidateMoves,
  findForcedMove,
  findThreatPool,
  bestMoveFor,
  bestScoreFor,
  countLiveThreeThreats,
  generalPool,
  weightedRandomPick,
};
