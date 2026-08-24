import { BLACK, WHITE } from "../game/logic";

// 结算页"对局回顾"卡片里的棋盘缩略图。这里刻意只画获胜连线那 5 颗
// 棋子,不画真实对局里其余的棋子——真实对局常常二十来手,如果把
// 所有棋子都摆出来,一张 100 出头像素的小图会挤得根本看不出重点。
// 代价是这张缩略图不是"这局棋的完整快照",只是"获胜手法"的示意图;
// 如果以后要做完整复盘,得从 meta.board 里另外取完整数据,不能指望
// 这张缩略图本身能还原全局(见 DailyTrialResultReveal 里点开"查看完整
// 对局"用的是 meta.board 原始数据,不是这个组件)。
const WINDOW = 5; // 只需要装下 5 颗连线棋子,不用像之前那样留 7x7 的余量
const SIZE_PX = 104;
const PAD = SIZE_PX * 0.12;
const CELL = (SIZE_PX - PAD * 2) / (WINDOW - 1);

function toPx(i) {
  return PAD + i * CELL;
}

export default function MatchRecapBoard({ board, winLine }) {
  if (!winLine || winLine.length < 2) return null;

  const xs = winLine.map((c) => c[0]);
  const ys = winLine.map((c) => c[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);

  // 把连线的 5 个格子映射到一个小窗口里(不管连线是横、竖还是斜,
  // 减去左上角坐标就落进 0..len-1 的范围)
  const stones = winLine.map(([x, y], i) => ({
    dx: x - minX,
    dy: y - minY,
    color: board?.[y]?.[x],
    order: i,
  }));

  const first = stones[0], last = stones[stones.length - 1];

  return (
    <svg width={SIZE_PX} height={SIZE_PX} viewBox={`0 0 ${SIZE_PX} ${SIZE_PX}`} className="recap-board-svg" role="img" aria-label="获胜连线回顾">
      <rect width={SIZE_PX} height={SIZE_PX} rx="8" fill="var(--wood-soft)" />
      <g stroke="var(--border-token)" strokeWidth="0.5">
        {Array.from({ length: WINDOW }, (_, i) => (
          <line key={`v${i}`} x1={toPx(i)} y1={toPx(0)} x2={toPx(i)} y2={toPx(WINDOW - 1)} />
        ))}
        {Array.from({ length: WINDOW }, (_, i) => (
          <line key={`h${i}`} x1={toPx(0)} y1={toPx(i)} x2={toPx(WINDOW - 1)} y2={toPx(i)} />
        ))}
      </g>
      <line
        x1={toPx(first.dx)} y1={toPx(first.dy)}
        x2={toPx(last.dx)} y2={toPx(last.dy)}
        stroke="var(--seal-red)" strokeWidth="2.4" opacity="0.55" strokeLinecap="round"
      />
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
