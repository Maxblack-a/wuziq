// 首页品牌核心视觉:收藏级棋盘展示。
// 纯展示用 SVG,不接收/不依赖任何真实对局数据,跟真正用来下棋的
// Board.jsx(15x15、可交互、接游戏状态)完全独立——这里所有的木纹、
// 棋子颜色都是本组件自己定义的局部渐变,故意不复用全局的
// --stone-black / --stone-white 这些 token,这样首页的展示效果可以
// 跟真实对局棋盘的观感各自独立调整,互不影响。

const GRID = 5;
const CELL = 32;
const PAD = 22;
const SIZE = PAD * 2 + CELL * (GRID - 1);
const BOX_PAD = 14; // 棋盒外框比棋盘网格本身再宽出来的部分,做出"棋盒边缘"的留白
const OUTER = SIZE + BOX_PAD * 2;
const THICK = 7; // 模拟棋盒厚度的偏移量

// "刚开局、下一步即将发生"的局面:4黑3白,聚拢在棋盘中央偏一侧,
// 不是随机摆的,是特意收拢成一个自然的开局阵型
const STONES = [
  { x: 2, y: 1, color: "black", delay: 0 },
  { x: 1, y: 2, color: "white", delay: 90 },
  { x: 2, y: 2, color: "black", delay: 180 },
  { x: 3, y: 2, color: "white", delay: 270 },
  { x: 2, y: 3, color: "black", delay: 360 },
  { x: 1, y: 1, color: "white", delay: 450 },
  { x: 3, y: 3, color: "black", delay: 540 },
];

function pos(i) {
  return BOX_PAD + PAD + i * CELL;
}

export default function HeroBoard() {
  return (
    <div className="hero-board-outer">
      <div className="hero-board-wrap">
        <svg viewBox={`0 0 ${OUTER} ${OUTER}`} width="100%" height="100%" role="img" aria-label="棋盘装饰">
          <defs>
            {/* 棋盒木纹:深胡桃木渐变 */}
            <linearGradient id="boxWood" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6B4226" />
              <stop offset="100%" stopColor="#3A2414" />
            </linearGradient>
            <linearGradient id="boxWoodSide" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2E1C0F" />
              <stop offset="100%" stopColor="#1D110A" />
            </linearGradient>
            {/* 顶部环境光:让棋盒看起来是被上方光源照着的 */}
            <linearGradient id="topLight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,250,240,0.16)" />
              <stop offset="45%" stopColor="rgba(255,250,240,0)" />
            </linearGradient>
            {/* 极细微的木纹噪点,远看基本看不出来,近看有质感 */}
            <filter id="woodGrain">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
              <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.05 0" />
            </filter>

            {/* 黑曜石棋子:深色底 + 一道偏移高光弧,模拟表面反光 */}
            <radialGradient id="obsidian" cx="38%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#4A4038" />
              <stop offset="55%" stopColor="#221D18" />
              <stop offset="100%" stopColor="#0F0C09" />
            </radialGradient>
            {/* 玉石棋子:偏冷的浅青玉调,带温润柔光感 */}
            <radialGradient id="jade" cx="38%" cy="30%" r="78%">
              <stop offset="0%" stopColor="#F8FBF4" />
              <stop offset="45%" stopColor="#E2ECDD" />
              <stop offset="100%" stopColor="#C7D8C2" />
            </radialGradient>
          </defs>

          {/* 棋盒侧面(厚度感):往右下偏移一点、颜色更深,模拟盒体的侧边 */}
          <rect x={THICK} y={THICK} width={OUTER - THICK} height={OUTER - THICK} rx="20" fill="url(#boxWoodSide)" />
          {/* 棋盒主体表面 */}
          <rect x="0" y="0" width={OUTER - THICK} height={OUTER - THICK} rx="20" fill="url(#boxWood)" />
          <rect x="0" y="0" width={OUTER - THICK} height={OUTER - THICK} rx="20" filter="url(#woodGrain)" />
          <rect x="0" y="0" width={OUTER - THICK} height={OUTER - THICK} rx="20" fill="url(#topLight)" />

          {/* 内嵌的棋盘网格区域,比外框略深一点,做出"盒中盘"的层次 */}
          <rect x={BOX_PAD - 4} y={BOX_PAD - 4} width={SIZE + 8} height={SIZE + 8} rx="10" fill="rgba(0,0,0,0.18)" />

          {Array.from({ length: GRID }).map((_, i) => (
            <line key={`h${i}`} x1={pos(0)} y1={pos(i)} x2={pos(GRID - 1)} y2={pos(i)} stroke="rgba(245,240,230,0.3)" strokeWidth="1" />
          ))}
          {Array.from({ length: GRID }).map((_, i) => (
            <line key={`v${i}`} x1={pos(i)} y1={pos(0)} x2={pos(i)} y2={pos(GRID - 1)} stroke="rgba(245,240,230,0.3)" strokeWidth="1" />
          ))}

          {STONES.map((s, idx) => (
            <g
              key={idx}
              className="hero-stone"
              style={{ animationDelay: `${420 + s.delay}ms`, transformOrigin: `${pos(s.x)}px ${pos(s.y)}px` }}
            >
              <circle
                cx={pos(s.x)}
                cy={pos(s.y)}
                r={CELL * 0.36}
                fill={s.color === "black" ? "url(#obsidian)" : "url(#jade)"}
                style={{ filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.4))" }}
              />
              {/* 高光弧:每颗棋子左上方一小道亮弧,加强"表面反光"的质感 */}
              <ellipse
                cx={pos(s.x) - CELL * 0.12}
                cy={pos(s.y) - CELL * 0.13}
                rx={CELL * 0.1}
                ry={CELL * 0.06}
                fill={s.color === "black" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.75)"}
                transform={`rotate(-30 ${pos(s.x) - CELL * 0.12} ${pos(s.y) - CELL * 0.13})`}
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
