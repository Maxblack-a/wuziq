import { useEffect, useState } from "react";
import {
  RESULT_INTRO_LINE, resultLine, RESULT_CONTINUE_LABEL,
  compareToLastLine, recentTrendLine,
} from "../lib/linmoDialogue";
import { IconArrowRight, IconSparkle } from "./Icons";

const THINKING_PAUSE = 1100; // "让我想想怎么说……"之后停顿多久再把点评说出来
const COMPARE_PAUSE = 900; // 点评说完,再停一下才接着聊"跟上次比"/"最近怎么样"

// 棋风测试结果的第二屏:林墨怎么看这份结果——从原来"小头像 + 对话框"
// 那种轻量的行内条,换成跟 LinMoIntroScreen(邀请测试那一屏)完全一样
// 的格式:整张背景照片 + 票根切角气泡,而不是插在数据下面的一小条。
// 用的是同一套 .linmo-scene / .linmo-invite-bubble 类,不是另起一套
// 视觉语言。
//
// 只在"刚测完"这条路径上出现(App.jsx 里紧接在 SkillTestResultScreen
// 后面),从"我的"页面回看历史结果不会走到这一屏——回看历史要的是
// 数据本身,不需要每次都重新演一遍这段点评动画。
//
// 停顿节奏:先露出"让我想想怎么说……",停一下再把点评说出来,点评说完
// 再停一下才接"跟上次比"/"最近这段时间"(有没有内容取决于 priorHistory,
// 复测功能去掉之后这两句在实践中基本不会出现,见 linmoDialogue.js 里
// compareToLastLine/recentTrendLine 附近的说明)——现实中复盘一盘棋
// 不会脱口而出,这个停顿本身就是"他真的在想"的一部分。introLine 允许
// 调用方换一句开场白,不过目前没有调用方在用这个能力。
export default function SkillTestEvaluationScreen({ profile, priorHistory, onContinue, continueLabel, introLine }) {
  const { dims, type, highlights } = profile;

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
    <div className="linmo-scene">
      <picture>
        <source srcSet="/linmo-scene.webp" type="image/webp" />
        <img
          className="linmo-scene-bg"
          src="/linmo-scene.jpg"
          width="941"
          height="1672"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
        />
      </picture>

      <div className="linmo-scene-column">
        <div className="linmo-brand-block">
          <div className="linmo-brand-name">XIANGQIX</div>
          <div className="linmo-brand-title-row">
            <h1>象棋</h1>
            <span className="linmo-brand-seal">规</span>
          </div>
          <p className="linmo-brand-slogan">楚河汉界 · 一步定乾坤</p>
        </div>

        <div className="linmo-bubble linmo-invite-bubble">
          <span className="linmo-bubble-deco" aria-hidden="true"><IconSparkle size={16} /></span>
          <div className="linmo-invite-bubble-name">
            林墨<span className="linmo-invite-bubble-name-icon"><IconSparkle size={11} /></span>
          </div>
          <div className="linmo-invite-bubble-divider" />

          <p className="linmo-bubble-line linmo-invite-bubble-line">
            {introLine || RESULT_INTRO_LINE}
            {!revealed && <span className="result-thinking-dots" aria-hidden="true">…</span>}
          </p>
          {revealed && (
            <p className="linmo-bubble-line linmo-invite-bubble-line result-comment-reveal" style={{ marginTop: 8 }}>
              {comment}
            </p>
          )}
          {revealed && compareRevealed && compareText && (
            <p className="linmo-bubble-line linmo-invite-bubble-line result-comment-reveal" style={{ marginTop: 8 }}>
              {compareText}
            </p>
          )}
          {revealed && compareRevealed && trendText && (
            <p className="linmo-bubble-line linmo-invite-bubble-line result-comment-reveal" style={{ marginTop: 4 }}>
              {trendText}
            </p>
          )}

          <div className="linmo-invite-bubble-end-divider"><span className="linmo-invite-bubble-end-divider-dot" /></div>
        </div>

        <div className="linmo-actions-row linmo-invite-actions-row">
          <button className="linmo-cta linmo-invite-cta" onClick={onContinue}>
            <span>{continueLabel || RESULT_CONTINUE_LABEL}</span>
            <IconArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
