import { useEffect, useState } from "react";
import { DIM_KEYS, DIM_LABELS } from "../lib/skillProfile";
import { RESULT_INTRO_LINE, resultLine, RESULT_CONTINUE_LABEL, pickIncompleteNote } from "../lib/linmoDialogue";

const THINKING_PAUSE = 1100; // "让我想想怎么说……"之后停顿多久再把点评说出来

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
export default function SkillTestResultScreen({ profile, onContinue, continueLabel, introLine }) {
  const { dims, typeInfo, type, highlights, completeness } = profile;

  // "下完了。让我想想怎么说……"之后先停顿一下再把点评说出来——现实中
  // 复盘一盘棋不会脱口而出,这个停顿本身就是"他真的在想"的一部分。
  // 停顿期间只露出雷达图/类型标签这些"数据类"的内容,点评这句"话"
  // 延后出现;incompleteNote(关卡没测全的坦白)跟点评一起延后,免得
  // 玩家还没看到点评就先看到"这局没测全",顺序上显得奇怪。
  const [revealed, setRevealed] = useState(false);
  const [incompleteNote] = useState(() => (
    completeness && completeness.checkpointsTriggered < 3 ? pickIncompleteNote() : null
  ));

  useEffect(() => {
    setRevealed(false);
    const timer = setTimeout(() => setRevealed(true), THINKING_PAUSE);
    return () => clearTimeout(timer);
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
              <p>{resultLine(type, highlights)}</p>
              {incompleteNote && (
                <p style={{ marginTop: 6, color: "var(--fg-muted)", fontSize: 12 }}>{incompleteNote}</p>
              )}
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
