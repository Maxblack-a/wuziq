import { useId } from "react";
import { BLACK, WHITE } from "../game/logic";

// 结算页"对局回顾"卡片里的棋盘缩略图。这里刻意只画获胜连线那 5 颗
// 棋子,不画真实对局里其余的棋子——真实对局常常二十来手,如果把
// 所有棋子都摆出来,一张 100 出头像素的小图会挤得根本看不出重点。
// 代价是这张缩略图不是"这局棋的完整快照",只是"获胜手法"的示意图;
// 如果以后要做完整复盘,得从 meta.board 里另外取完整数据,不能指望
// 这张缩略图本身能还原全局(见 DailyTrialResultReveal 里点开"查看完整
// 对局"用的是 meta.board 原始数据,不是这个组件)。
//
// 棋子质感刻意复用主棋盘(board.css .stone-black/.stone-white)同一套
// "径向高光渐变 + 投影"配色变量(--stone-black/--stone-black-hi/
// --stone-white/--stone-white-hi),而不是像之前那样直接拿 --ink-token/
// --wood-soft 铺纯色——纯色圆点在这么小的尺寸下看着扁平、廉价,跟主
// 棋盘里棋子的立体感对不上,补上同一套渐变后两处棋子才是"同一种材质"。
const WINDOW = 5; // 只需要装下 5 颗连线棋子,不用像之前那样留 7x7 的余量
const SIZE_PX = 112;
const PAD = SIZE_PX * 0.14;
const CELL = (SIZE_PX - PAD * 2) / (WINDOW - 1);
const STONE_R = CELL * 0.4;

function toPx(i) {
  return PAD + i * CELL;
}

export default function MatchRecapBoard({ board, winLine }) {
  const uid = useId();
  const blackGradId = `recap-black-${uid}`;
  const whiteGradId = `recap-white-${uid}`;
  const shadowId = `recap-shadow-${uid}`;

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
      <defs>
        <linearGradient id={`recap-bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F6ECD9" />
          <stop offset="100%" stopColor="#EBDBBE" />
        </linearGradient>
        <radialGradient id={blackGradId} cx="32%" cy="28%" r="75%">
          <stop offset="0%" stopColor="var(--stone-black-hi)" />
          <stop offset="70%" stopColor="var(--stone-black)" />
        </radialGradient>
        <radialGradient id={whiteGradId} cx="32%" cy="28%" r="75%">
          <stop offset="0%" stopColor="var(--stone-white-hi)" />
          <stop offset="75%" stopColor="var(--stone-white)" />
        </radialGradient>
        <filter id={shadowId} x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodColor="#000" floodOpacity="0.35" />
        </filter>
      </defs>

      <rect width={SIZE_PX} height={SIZE_PX} rx="10" fill={`url(#recap-bg-${uid})`} />
      <rect width={SIZE_PX} height={SIZE_PX} rx="10" fill="none" stroke="rgba(90, 56, 26, 0.18)" strokeWidth="1" />

      <g stroke="rgba(139, 94, 46, 0.4)" strokeWidth="0.7">
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
        stroke="var(--seal-red)" strokeWidth="2.6" opacity="0.5" strokeLinecap="round"
      />

      {stones.map((s, i) => (
        <circle
          key={i}
          cx={toPx(s.dx)} cy={toPx(s.dy)} r={STONE_R}
          fill={s.color === BLACK ? `url(#${blackGradId})` : `url(#${whiteGradId})`}
          stroke={s.color === WHITE ? "rgba(91, 56, 35, 0.3)" : "none"}
          strokeWidth={s.color === WHITE ? 0.8 : 0}
          filter={`url(#${shadowId})`}
        />
      ))}
    </svg>
  );
}
