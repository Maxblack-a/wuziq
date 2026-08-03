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

/**
 * 计算 AI 的落子
 * @param board 二维数组
 * @param aiPlayer AI 执子颜色 (1或2)
 * @param humanPlayer 对手颜色
 * @param difficulty 'easy' | 'medium' | 'hard'
 */
export function getAiMove(board, aiPlayer, humanPlayer, difficulty = "medium") {
  const moves = candidateMoves(board);

  const scored = moves.map(([x, y]) => {
    const attack = evaluatePoint(board, x, y, aiPlayer);
    const defend = evaluatePoint(board, x, y, humanPlayer);
    // 进攻优先,但如果对手威胁更大就必须防守
    const score = Math.max(attack, defend * 0.95) + attack * 0.05;
    return { x, y, score };
  });

  scored.sort((a, b) => b.score - a.score);

  if (difficulty === "hard") {
    // 之前这里直接返回第一层评分最高的点,等于完全不看"我下完这步,对手怎么回应"——
    // 说是困难难度,其实还是纯贪心。现在给最优的几个候选点多看一层:
    // 模拟落子后,对手能拿到的最高分是多少,倒扣回去,尽量不留"看起来分高、
    // 实际上给对手送出更大威胁"的点。
    // 但如果第一层已经是必胜/必须防守的分数(活四、冲四这个级别),没必要
    // 再多算一层浪费时间,直接走。
    if (scored[0].score >= SCORE.FOUR) return scored[0];

    const topN = scored.slice(0, Math.min(6, scored.length));
    const lookahead = topN.map(({ x, y, score }) => {
      const trial = cloneBoard(board);
      trial[y][x] = aiPlayer;
      const opponentReplies = candidateMoves(trial).map(([ox, oy]) => evaluatePoint(trial, ox, oy, humanPlayer));
      const opponentBest = opponentReplies.length ? Math.max(...opponentReplies) : 0;
      return { x, y, finalScore: score - opponentBest * 0.9 };
    });
    lookahead.sort((a, b) => b.finalScore - a.finalScore);
    return lookahead[0];
  }

  if (difficulty === "medium") {
    // 从前 3 个较优解里带一点随机性,不至于每次都是"最优解"那么难打
    const pool = scored.slice(0, Math.min(3, scored.length));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // easy: 从前 6 个里随机选,并且不主动做最强攻击判断,给新手留出机会
  const pool = scored.slice(0, Math.min(6, scored.length));
  return pool[Math.floor(Math.random() * pool.length)];
}
