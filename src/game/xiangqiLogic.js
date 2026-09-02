// 中国象棋核心规则引擎
// 棋盘坐标：x 0-8（9列），y 0-9（10行）。y=0 是黑方底线，y=9 是红方底线。
// 棋子编码：正数=红方，负数=黑方，绝对值代表棋子种类
export const BOARD_W = 9;
export const BOARD_H = 10;

export const EMPTY = 0;
export const RED = 1;
export const BLACK = -1;

// 棋子种类（绝对值）
export const SHUAI = 1; // 帅/将
export const SHI = 2;   // 仕/士
export const XIANG = 3; // 相/象
export const MA = 4;    // 马
export const CHE = 5;   // 车
export const PAO = 6;   // 炮
export const BING = 7;  // 兵/卒

export const PIECE_NAME = {
  [RED]: { [SHUAI]: "帅", [SHI]: "仕", [XIANG]: "相", [MA]: "马", [CHE]: "车", [PAO]: "炮", [BING]: "兵" },
  [BLACK]: { [SHUAI]: "将", [SHI]: "士", [XIANG]: "象", [MA]: "马", [CHE]: "车", [PAO]: "炮", [BING]: "卒" },
};

export function pieceColor(p) {
  if (p === 0) return 0;
  return p > 0 ? RED : BLACK;
}
export function pieceType(p) {
  return Math.abs(p);
}

export function createInitialBoard() {
  const b = Array.from({ length: BOARD_H }, () => Array(BOARD_W).fill(EMPTY));
  const back = [CHE, MA, XIANG, SHI, SHUAI, SHI, XIANG, MA, CHE];
  // 黑方（顶部，y=0..2）
  for (let x = 0; x < 9; x++) b[0][x] = -back[x];
  b[2][1] = -PAO; b[2][7] = -PAO;
  for (const x of [0, 2, 4, 6, 8]) b[3][x] = -BING;
  // 红方（底部，y=7..9）
  for (let x = 0; x < 9; x++) b[9][x] = back[x];
  b[7][1] = PAO; b[7][7] = PAO;
  for (const x of [0, 2, 4, 6, 8]) b[6][x] = BING;
  return b;
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function inBounds(x, y) {
  return x >= 0 && x < BOARD_W && y >= 0 && y < BOARD_H;
}

function inPalace(x, y, color) {
  if (x < 3 || x > 5) return false;
  return color === RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

function isRedSide(y) {
  return y >= 5;
}

// 生成某个棋子在当前棋盘上的"伪合法"走法（不考虑走后自己是否被将军）
export function pseudoMoves(board, x, y) {
  const p = board[y][x];
  if (!p) return [];
  const color = pieceColor(p);
  const type = pieceType(p);
  const moves = [];
  const push = (nx, ny) => {
    if (!inBounds(nx, ny)) return false;
    const target = board[ny][nx];
    if (target === 0) {
      moves.push([nx, ny]);
      return true; // 可继续（用于车/炮的滑动逻辑外部处理）
    }
    if (pieceColor(target) !== color) moves.push([nx, ny]);
    return false;
  };

  if (type === SHUAI) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inPalace(nx, ny, color)) push(nx, ny);
    }
  } else if (type === SHI) {
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (inPalace(nx, ny, color)) push(nx, ny);
    }
  } else if (type === XIANG) {
    for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const nx = x + dx, ny = y + dy;
      const ex = x + dx / 2, ey = y + dy / 2; // 象眼
      if (!inBounds(nx, ny)) continue;
      if (color === RED ? ny < 5 : ny > 4) continue; // 不能过河
      if (board[ey][ex] !== 0) continue; // 塞象眼
      push(nx, ny);
    }
  } else if (type === MA) {
    const legs = [
      { d: [1, 0], jumps: [[2, 1], [2, -1]] },
      { d: [-1, 0], jumps: [[-2, 1], [-2, -1]] },
      { d: [0, 1], jumps: [[1, 2], [-1, 2]] },
      { d: [0, -1], jumps: [[1, -2], [-1, -2]] },
    ];
    for (const leg of legs) {
      const legX = x + leg.d[0], legY = y + leg.d[1];
      if (!inBounds(legX, legY) || board[legY][legX] !== 0) continue; // 蹩马腿
      for (const [dx, dy] of leg.jumps) {
        const nx = x + dx, ny = y + dy;
        push(nx, ny);
      }
    }
  } else if (type === CHE) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = x + dx, ny = y + dy;
      while (inBounds(nx, ny)) {
        const cont = push(nx, ny);
        if (!cont) break;
        nx += dx; ny += dy;
      }
    }
  } else if (type === PAO) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let nx = x + dx, ny = y + dy;
      let jumped = false;
      while (inBounds(nx, ny)) {
        const target = board[ny][nx];
        if (!jumped) {
          if (target === 0) {
            moves.push([nx, ny]);
          } else {
            jumped = true; // 遇到炮架
          }
        } else {
          if (target !== 0) {
            if (pieceColor(target) !== color) moves.push([nx, ny]);
            break;
          }
        }
        nx += dx; ny += dy;
      }
    }
  } else if (type === BING) {
    const forward = color === RED ? -1 : 1;
    push(x, y + forward);
    const crossedRiver = color === RED ? y <= 4 : y >= 5;
    if (crossedRiver) {
      push(x + 1, y);
      push(x - 1, y);
    }
  }
  return moves;
}

export function findGeneral(board, color) {
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      if (board[y][x] === color * SHUAI) return [x, y];
    }
  }
  return null;
}

// 判断 color 方是否被将军
export function isInCheck(board, color) {
  const gen = findGeneral(board, color);
  if (!gen) return false;
  const [gx, gy] = gen;
  const enemy = -color;

  // 飞将：双方将帅照面（同一列之间无子）也算被将军
  const otherGen = findGeneral(board, enemy);
  if (otherGen && otherGen[0] === gx) {
    let blocked = false;
    const [oy] = [otherGen[1]];
    const from = Math.min(gy, oy) + 1;
    const to = Math.max(gy, oy) - 1;
    for (let y = from; y <= to; y++) {
      if (board[y][gx] !== 0) { blocked = true; break; }
    }
    if (!blocked) return true;
  }

  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const p = board[y][x];
      if (p === 0 || pieceColor(p) !== enemy) continue;
      const moves = pseudoMoves(board, x, y);
      if (moves.some(([mx, my]) => mx === gx && my === gy)) return true;
    }
  }
  return false;
}

// 生成某个位置棋子的合法走法（排除走后被将军的走法）
export function legalMovesFrom(board, x, y) {
  const p = board[y][x];
  if (!p) return [];
  const color = pieceColor(p);
  const candidates = pseudoMoves(board, x, y);
  const legal = [];
  for (const [nx, ny] of candidates) {
    const next = cloneBoard(board);
    next[ny][nx] = p;
    next[y][x] = 0;
    if (!isInCheck(next, color)) legal.push([nx, ny]);
  }
  return legal;
}

// 生成某一方全部合法走法：[{ from:[x,y], to:[x,y] }]
export function allLegalMoves(board, color) {
  const result = [];
  for (let y = 0; y < BOARD_H; y++) {
    for (let x = 0; x < BOARD_W; x++) {
      const p = board[y][x];
      if (p === 0 || pieceColor(p) !== color) continue;
      const moves = legalMovesFrom(board, x, y);
      for (const [nx, ny] of moves) {
        result.push({ from: [x, y], to: [nx, ny] });
      }
    }
  }
  return result;
}

export function applyMove(board, from, to) {
  const next = cloneBoard(board);
  const [fx, fy] = from;
  const [tx, ty] = to;
  next[ty][tx] = next[fy][fx];
  next[fy][fx] = 0;
  return next;
}

// 游戏状态判定：返回 { over, winner, reason } 或 null（未结束）
// winner: RED / BLACK / 0(和棋) ; reason: 'checkmate' | 'stalemate' | 'repetition' | 'sixty_move'
//
// history/noCaptureHalfmoves 是可选参数——不传就退化成"只判绝杀/困毙"，
// 老调用点(比如 supabase 交叉验证脚本、旧的 chooseAiMove 自对弈测试)
// 不用跟着改。真正要判和棋,调用方需要自己在每步之后维护这两样东西:
//   history：数组，每走一步用 positionKey(next, nextTurn) 追加进去
//   noCaptureHalfmoves：数字，这步吃子了就清零,没吃子就 +1
export function positionKey(board, colorToMove) {
  // 局面 key 除了子力分布,还得把"轮到谁走"编进去——同样的摆子,轮到红
  // 走和轮到黑走是两个不同的局面,不能算重复。90 个格子直接拼字符串,
  // 用逗号分隔避免个位数/两位数棋子值粘在一起产生歧义(比如 "-7" 后面
  // 紧跟 "10" 不分隔的话会看着像 "-710")。
  return board.flat().join(",") + "|" + colorToMove;
}

const REPETITION_LIMIT = 3;       // 同一局面(含轮走方)出现 3 次判和
const SIXTY_MOVE_HALFMOVES = 120; // 中国象棋"60回合无吃子判和"按双方各60步算,合 120 个半步

export function checkGameOver(board, colorToMove, history = null, noCaptureHalfmoves = 0) {
  const moves = allLegalMoves(board, colorToMove);
  if (moves.length === 0) {
    const inCheck = isInCheck(board, colorToMove);
    return {
      over: true,
      winner: -colorToMove,
      reason: inCheck ? "checkmate" : "stalemate",
    };
  }
  // 将帅是否被吃掉（理论上合法规则下不会发生，但兜底）
  if (!findGeneral(board, RED)) return { over: true, winner: BLACK, reason: "captured" };
  if (!findGeneral(board, BLACK)) return { over: true, winner: RED, reason: "captured" };

  if (noCaptureHalfmoves >= SIXTY_MOVE_HALFMOVES) {
    return { over: true, winner: 0, reason: "sixty_move" };
  }
  if (history) {
    const key = positionKey(board, colorToMove);
    const count = history.filter((k) => k === key).length;
    if (count >= REPETITION_LIMIT) {
      return { over: true, winner: 0, reason: "repetition" };
    }
  }
  return null;
}

export function isLegalMove(board, from, to, color) {
  const [fx, fy] = from;
  const p = board[fy][fx];
  if (!p || pieceColor(p) !== color) return false;
  const legal = legalMovesFrom(board, fx, fy);
  return legal.some(([x, y]) => x === to[0] && y === to[1]);
}
