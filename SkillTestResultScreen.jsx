import { DIM_KEYS, DIM_LABELS } from "../lib/skillProfile";
import { RESULT_CONTINUE_LABEL } from "../lib/linmoDialogue";

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

// profile: computeSkillProfile 的返回值。onContinue: 看完数据,继续往下走
// (正常流程会接到 SkillTestEvaluationScreen 听林墨怎么说;从"我的"页面
// 回看历史结果时,外部会把它接到"返回"上——已经测过就不再提供重新测
// 的入口了,continueLabel 也会跟着换成"返回")。
//
// 这一屏现在只负责"数字层面的客观反馈"(类型/雷达图/六维分数),不带
// 任何林墨的点评对话——原来两者是揉在一起的,拆开之后有两个好处:
// 一是跟每日试炼结算页(DailyTrialResultReveal)的"数字先、点评后"
// 保持同一套产品语言;二是从"我的"页面回看历史结果时,只需要看数据,
// 不用每次都重新演一遍"让我想想怎么说"的停顿动画——点评/态度层面的
// 反馈交给 SkillTestEvaluationScreen,只在"刚测完"这条路径上出现。
export default function SkillTestResultScreen({ profile, onContinue, continueLabel }) {
  const { dims, typeInfo } = profile;

  return (
    <div style={{ padding: "var(--space-2) 0 var(--space-4)" }}>
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
