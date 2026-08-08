export const BOARD_SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1; // player1,先手
export const WHITE = 2; // player2,后手

export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

// 数据库里存的是一维/嵌套 jsonb,统一转换成二维数组方便计算
export function toBoard2D(flatOrNested) {
  if (!flatOrNested || flatOrNested.length === 0) return createEmptyBoard();
  if (Array.isArray(flatOrNested[0])) return flatOrNested;
  const b = createEmptyBoard();
  flatOrNested.forEach((v, i) => {
    b[Math.floor(i / BOARD_SIZE)][i % BOARD_SIZE] = v;
  });
  return b;
}

const DIRECTIONS = [
  [1, 0], [0, 1], [1, 1], [1, -1],
];

// 返回 { winner, line } , line 是获胜的五个坐标,方便画连线动画
export function checkWin(board, lastX, lastY) {
  const player = board[lastY][lastX];
  if (!player) return null;

  for (const [dx, dy] of DIRECTIONS) {
    const line = [[lastX, lastY]];

    let x = lastX + dx, y = lastY + dy;
    while (inBounds(x, y) && board[y][x] === player) {
      line.push([x, y]);
      x += dx; y += dy;
    }
    x = lastX - dx; y = lastY - dy;
    while (inBounds(x, y) && board[y][x] === player) {
      line.unshift([x, y]);
      x -= dx; y -= dy;
    }

    if (line.length >= 5) {
      // 长连(6子以上)的情况下,不能简单取数组最前面5个——那样不保证包含
      // 刚刚下的这颗子。以刚落子的位置为中心尽量居中取一段5连,越界就贴边。
      const originalIdx = line.findIndex(([x, y]) => x === lastX && y === lastY);
      let start = Math.max(0, originalIdx - 2);
      start = Math.min(start, line.length - 5);
      return { winner: player, line: line.slice(start, start + 5) };
    }
  }
  return null;
}

export function isBoardFull(board) {
  return board.every(row => row.every(cell => cell !== EMPTY));
}

export function inBounds(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

export function cloneBoard(board) {
  return board.map(row => row.slice());
}
