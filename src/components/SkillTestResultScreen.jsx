import { useEffect, useState } from "react";
import { DIM_KEYS, DIM_LABELS } from "../lib/skillProfile";
import {
  RESULT_INTRO_LINE, resultLine, RESULT_CONTINUE_LABEL,
  compareToLastLine, recentTrendLine,
} from "../lib/linmoDialogue";

const THINKING_PAUSE = 1100; // "让我想想怎么说……"之后停顿多久再把点评说出来
const COMPARE_PAUSE = 900; // 点评说完,再停一下才接着聊"跟上次比"/"最近怎么样"

const SIZE = 220;
const CENTER = SIZE / 2;
const MAX_R = 80;
const RINGS = [0.33, 0.66, 1];

function pointOnAxis(index, value01) {
  // 六边形,第一个轴朝正上方,顺时针排布
  const angle = -Math.PI / 2 + index * (Math.PI * 2) / DIM_KEYS.length;
  const r = MAX_R * value01;
  return [CENTER + r * Math.cos(angle), CENTER + r * Math.sin(angle)];
}

function polygonPoints(values01) {
  return DIM_KEYS.map((k, i) => pointOnAxis(i, values01[k])).map(([x, y]) => `${x},${y}`).join(" ");
}

function RadarChart({ dims }) {
  const values01 = {};
  DIM_KEYS.forEach((k) => { values01[k] = Math.max(0.04, Math.min(1, dims[k] / 100)); });

  return (
    <svg width={SIZE} height={SIZE + 24} viewBox={`0 0 ${SIZE} ${SIZE + 24}`}>
      {/* 背景网格:三圈同心六边形 */}
      {RINGS.map((r) => (
        <polygon
          key={r}
          points={DIM_KEYS.map((_, i) => pointOnAxis(i, r)).map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="var(--border-token)"
          strokeWidth="1"
        />
      ))}
      {/* 六条轴线 */}
      {DIM_KEYS.map((_, i) => {
        const [x, y] = pointOnAxis(i, 1);
        return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--border-token)" strokeWidth="1" />;
      })}
      {/* 实际数值多边形 */}
      <polygon points={polygonPoints(values01)} fill="var(--gold)" fillOpacity="0.32" stroke="var(--wood)" strokeWidth="2" strokeLinejoin="round" />
      {DIM_KEYS.map((k, i) => {
        const [x, y] = pointOnAxis(i, values01[k]);
        return <circle key={k} cx={x} cy={y} r="3" fill="var(--wood)" />;
      })}
      {/* 维度标签,沿每根轴的最外侧摆放 */}
      {DIM_KEYS.map((k, i) => {
        const [x, y] = pointOnAxis(i, 1.28);
        return (
          <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="var(--fg)" fontFamily="var(--font-body)">
            {DIM_LABELS[k]}
          </text>
        );
      })}
    </svg>
  );
}

// profile: computeSkillProfile 的返回值。onContinue: 揭晓看完,继续原来该走的路由。
// continueLabel: 按钮文案,测完当场揭晓用"继续"(默认),从"我的"页面回看
// 历史结果时外部会传"返回"进来,复用同一个组件不用另外再画一份。
export default function SkillTestResultScreen({ profile, priorHistory, onContinue, continueLabel, introLine }) {
  const { dims, typeInfo, type, highlights } = profile;

  // "下完了。让我想想怎么说……"之后先停顿一下再把点评说出来——现实中
  // 复盘一盘棋不会脱口而出,这个停顿本身就是"他真的在想"的一部分。
  // 停顿期间只露出雷达图/类型标签这些"数据类"的内容,点评这句"话"
  // 延后出现。
  //
  // "跟上次比""最近这段时间"这两句再往后错一拍——像是林墨说完这局的
  // 点评之后,又想起来点别的,顺嘴接了一句,而不是把所有话一口气倒出来。
  // 只有 priorHistory 真的有数据时才会算出内容,没有历史记录(比如第一次
  // 测试)这一拍就什么都不显示,不占位置。
  const [revealed, setRevealed] = useState(false);
  const [compareRevealed, setCompareRevealed] = useState(false);
  const [compareText] = useState(() => compareToLastLine(dims, priorHistory));
  const [trendText] = useState(() => recentTrendLine(dims, priorHistory));
  // resultLine 内部用 Math.random() 从候选池里挑一条,必须只算一次存起来——
  // 不然 compareRevealed 这类 state 变化触发重渲染时,resultLine 会被
  // 重新调用,点评文字可能在玩家眼皮底下悄悄换成另一条候选,像是林墨
  // 说话说到一半换了一句话
  const [comment] = useState(() => resultLine(type, highlights));

  useEffect(() => {
    setRevealed(false);
    setCompareRevealed(false);
    const t1 = setTimeout(() => setRevealed(true), THINKING_PAUSE);
    const t2 = setTimeout(() => setCompareRevealed(true), THINKING_PAUSE + COMPARE_PAUSE);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [profile]);

  return (
    <div style={{ padding: "var(--space-2) 0 var(--space-4)" }}>
      <div className="result-linmo-row">
        <div className="result-linmo-portrait">
          <img src="/linmo-portrait.webp" alt="林墨" />
        </div>
        <div className="result-linmo-bubble">
          <p style={{ marginBottom: 4, color: "var(--fg-muted)", fontSize: 12 }}>
            {introLine || RESULT_INTRO_LINE}
            {!revealed && <span className="result-thinking-dots" aria-hidden="true">…</span>}
          </p>
          {revealed && (
            <div className="result-comment-reveal">
              <p>{comment}</p>
            </div>
          )}
          {revealed && compareRevealed && (compareText || trendText) && (
            <div className="result-comment-reveal" style={{ marginTop: 8 }}>
              {compareText && <p>{compareText}</p>}
              {trendText && <p style={{ marginTop: 4 }}>{trendText}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="result-type-badge">
        <div className="result-type-name">{typeInfo.name}</div>
        <div className="result-type-summary">{typeInfo.summary}</div>
      </div>

      <div className="radar-wrap">
        <RadarChart dims={dims} />
      </div>

      <div className="result-dim-list">
        {DIM_KEYS.map((k) => (
          <div key={k} className="result-dim-row">
            <div className="result-dim-label">{DIM_LABELS[k]}</div>
            <div className="result-dim-track">
              <div className="result-dim-fill" style={{ width: `${Math.max(4, Math.min(100, dims[k]))}%` }} />
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" style={{ width: "100%", marginTop: "var(--space-6)" }} onClick={onContinue}>
        {continueLabel || RESULT_CONTINUE_LABEL}
      </button>
    </div>
  );
}
