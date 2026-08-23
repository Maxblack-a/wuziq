import { BOARD_SIZE, BLACK, WHITE } from "../game/logic";

// 结算页"对局回顾"卡片里的棋盘缩略图。完整 15x15 棋盘缩到 100 出头像素
// 根本看不清任何形状,所以这里只裁一个 7x7 的小窗口——优先裁在获胜连线
// 附近(让人一眼看出"就是这条线赢的"),没有连线(和棋/中途退出)就退回
// 裁在棋子最密集的重心附近,不会出现"一大片空棋盘"这种没意义的画面。
const WINDOW = 7;
const SIZE_PX = 104;
const PAD = SIZE_PX * 0.09;
const CELL = (SIZE_PX - PAD * 2) / (WINDOW - 1);

function toPx(i) {
  return PAD + i * CELL;
}

export default function MatchRecapBoard({ board, winLine }) {
  if (!board) return null;

  let cx, cy;
  if (winLine && winLine.length) {
    const xs = winLine.map((c) => c[0]);
    const ys = winLine.map((c) => c[1]);
    cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  } else {
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (board[y]?.[x]) { sx += x; sy += y; n += 1; }
      }
    }
    cx = n ? Math.round(sx / n) : Math.floor(BOARD_SIZE / 2);
    cy = n ? Math.round(sy / n) : Math.floor(BOARD_SIZE / 2);
  }

  const half = Math.floor(WINDOW / 2);
  const startX = Math.min(Math.max(0, cx - half), BOARD_SIZE - WINDOW);
  const startY = Math.min(Math.max(0, cy - half), BOARD_SIZE - WINDOW);

  const winSet = new Set((winLine || []).map(([x, y]) => `${x},${y}`));
  const stones = [];
  for (let dy = 0; dy < WINDOW; dy++) {
    for (let dx = 0; dx < WINDOW; dx++) {
      const bx = startX + dx, by = startY + dy;
      const v = board[by]?.[bx];
      if (v) stones.push({ dx, dy, color: v, isWin: winSet.has(`${bx},${by}`) });
    }
  }

  let winEndpoints = null;
  if (winLine && winLine.length >= 2) {
    const inWindow = winLine.filter(
      ([x, y]) => x >= startX && x < startX + WINDOW && y >= startY && y < startY + WINDOW
    );
    if (inWindow.length >= 2) {
      const first = inWindow[0], last = inWindow[inWindow.length - 1];
      winEndpoints = [
        [toPx(first[0] - startX), toPx(first[1] - startY)],
        [toPx(last[0] - startX), toPx(last[1] - startY)],
      ];
    }
  }

  return (
    <svg width={SIZE_PX} height={SIZE_PX} viewBox={`0 0 ${SIZE_PX} ${SIZE_PX}`} className="recap-board-svg" role="img" aria-label="对局回顾棋盘">
      <rect width={SIZE_PX} height={SIZE_PX} rx="8" fill="var(--wood-soft)" />
      <g stroke="var(--border-token)" strokeWidth="0.5">
        {Array.from({ length: WINDOW }, (_, i) => (
          <line key={`v${i}`} x1={toPx(i)} y1={toPx(0)} x2={toPx(i)} y2={toPx(WINDOW - 1)} />
        ))}
        {Array.from({ length: WINDOW }, (_, i) => (
          <line key={`h${i}`} x1={toPx(0)} y1={toPx(i)} x2={toPx(WINDOW - 1)} y2={toPx(i)} />
        ))}
      </g>
      {winEndpoints && (
        <line
          x1={winEndpoints[0][0]} y1={winEndpoints[0][1]}
          x2={winEndpoints[1][0]} y2={winEndpoints[1][1]}
          stroke="var(--seal-red)" strokeWidth="2.4" opacity="0.55" strokeLinecap="round"
        />
      )}
      {stones.map((s, i) => (
        <circle
          key={i}
          cx={toPx(s.dx)} cy={toPx(s.dy)} r={CELL * 0.32}
          fill={s.color === BLACK ? "var(--ink-token)" : "var(--wood-soft)"}
          stroke={s.color === WHITE ? "var(--wood)" : "none"}
          strokeWidth={s.color === WHITE ? 0.9 : 0}
        />
      ))}
    </svg>
  );
}
