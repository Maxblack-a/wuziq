// 首页品牌核心视觉:一小段木纹棋盘 + 几颗黑白棋子的静态构图。
// 纯展示用,不接收、不依赖任何真实对局数据,不是可交互的 Board 组件。

const GRID = 5; // 只画一小段网格,营造"这是一个棋局空间"的氛围,不是完整15x15棋盘
const CELL = 32;
const PAD = 20;
const SIZE = PAD * 2 + CELL * (GRID - 1);

// 手动摆几颗棋子,纯粹为了构图好看,不代表任何真实棋局
const STONES = [
  { x: 1, y: 1, color: "black" },
  { x: 2, y: 1, color: "white" },
  { x: 1, y: 2, color: "white" },
  { x: 2, y: 3, color: "black" },
  { x: 3, y: 2, color: "black" },
];

function pos(i) {
  return PAD + i * CELL;
}

export default function HeroBoard() {
  return (
    <div className="hero-board-wrap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" role="img" aria-label="棋盘装饰">
        <defs>
          <linearGradient id="heroWood" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--board-wood-1)" />
            <stop offset="100%" stopColor="var(--board-wood-2)" />
          </linearGradient>
          <radialGradient id="heroBlack" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="var(--stone-black-hi)" />
            <stop offset="100%" stopColor="var(--stone-black)" />
          </radialGradient>
          <radialGradient id="heroWhite" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="var(--stone-white-hi)" />
            <stop offset="100%" stopColor="var(--stone-white)" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={SIZE} height={SIZE} rx="18" fill="url(#heroWood)" />

        {Array.from({ length: GRID }).map((_, i) => (
          <line key={`h${i}`} x1={pos(0)} y1={pos(i)} x2={pos(GRID - 1)} y2={pos(i)} stroke="rgba(245,240,230,0.35)" strokeWidth="1" />
        ))}
        {Array.from({ length: GRID }).map((_, i) => (
          <line key={`v${i}`} x1={pos(i)} y1={pos(0)} x2={pos(i)} y2={pos(GRID - 1)} stroke="rgba(245,240,230,0.35)" strokeWidth="1" />
        ))}

        {STONES.map((s, idx) => (
          <circle
            key={idx}
            cx={pos(s.x)}
            cy={pos(s.y)}
            r={CELL * 0.36}
            fill={s.color === "black" ? "url(#heroBlack)" : "url(#heroWhite)"}
            style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}
          />
        ))}
      </svg>
    </div>
  );
}
