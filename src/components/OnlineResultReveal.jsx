import { useEffect, useRef, useState } from "react";
import MatchRecapBoard from "./MatchRecapBoard";
import Board from "./Board";
import { IconExpStar, IconClock, IconListNumbers, IconMaximize, IconX } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";
import { tween, spawnSparkles, flyClone } from "../lib/resultRevealAnim";

// 联机对战结算揭晓页——跟每日试炼结算页(DailyTrialResultReveal)共用
// 同一套 .result-reveal-* 视觉语言(见 dailytrial.css),但联机对战没有
// 体力/钻石这两种资源,只有经验值一项奖励,所以这里砍掉了资源条、钻石飞行、
// 只保留"经验飞入头像下方进度条"这一条动画线,并且不管胜负平,经验奖励
// 永远大于 0(赢+10/输+4/和+6,规则见 schema.sql 的 finish_match),
// 不需要每日试炼那种"本局未获得奖励"分支。
// 认输/掉线判负这两种非正常结束的原因,每日试炼里不存在,这里额外加了
// 一行小字说明(desc)和对应的回顾标题文案。
function describeRecapTitle(outcome, reason, winLine) {
  if (reason === "forfeit") return outcome === "win" ? "对方认输离场" : "你选择了认输";
  if (reason === "disconnect") return outcome === "win" ? "对方掉线,判你获胜" : "你掉线太久,判负";
  const len = winLine?.length || 5;
  const word = len >= 6 ? "长连" : "五子连珠";
  if (outcome === "win") return `${word}取胜`;
  if (outcome === "lose") return `对手${word}`;
  return "棋逢对手,和棋收场";
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export default function OnlineResultReveal({
  result,       // 'win' | 'lose' | 'draw'
  reason,       // 'normal' | 'forfeit' | 'disconnect'
  desc,         // 一行文字说明(认输/掉线/正常结束),沿用 OnlineGame 里原有的 resultDesc 文案
  avatarUrl,
  expBefore, expAfter, expDelta,
  opponentName,
  mySlot,
  meta,         // { board, winLine, durationSec, moveCount }
  onExit,
  onReturnToRoom,
  returningToRoom = false,
}) {
  const containerRef = useRef(null);
  const flyLayerRef = useRef(null);
  const expFillRef = useRef(null);
  const expTextRef = useRef(null);
  const expTrackRef = useRef(null);
  const levelLabelRef = useRef(null);
  const expChipRef = useRef(null);
  const rafRefs = useRef([]);
  const timeoutRefs = useRef([]);
  const [showFullBoard, setShowFullBoard] = useState(false);

  const recapTitle = describeRecapTitle(result, reason, meta?.winLine);

  useEffect(() => {
    const containerRect = containerRef.current.getBoundingClientRect();
    const layer = flyLayerRef.current;

    function popIn(el, delay) {
      const id = setTimeout(() => {
        if (!el) return;
        el.style.opacity = "1";
        el.animate([
          { transform: "scale(0.3)" },
          { transform: "scale(1.5)", offset: 0.45 },
          { transform: "scale(0.9)", offset: 0.72 },
          { transform: "scale(1)" },
        ], { duration: 750, easing: "ease-out", fill: "forwards" });
        spawnSparkles(layer, containerRect, el);
      }, delay);
      timeoutRefs.current.push(id);
    }

    popIn(expChipRef.current, 300);

    const flyId = setTimeout(() => {
      flyClone({
        layerEl: layer,
        containerRect,
        sourceEl: expChipRef.current,
        targetEl: expTrackRef.current,
        size: 26,
        endSize: 4,
        content: `<div class="result-fly-orb">+${expDelta}</div>`,
        delay: 0,
        onLanded: () => {
          const raf = { current: null };
          rafRefs.current.push(raf);
          tween(expBefore, expAfter, 500, (v) => {
            const val = Math.round(v);
            if (expFillRef.current) expFillRef.current.style.width = progressPctForExp(val) + "%";
            if (expTextRef.current) expTextRef.current.textContent = expProgressText(val);
            // 涨分不多的情况下跨阶/跨称号并不常见,但边界附近确实可能发生——
            // 只更新进度条和阶内文字、不更新称号,会出现"条已经空了但称号
            // 还没变"这种视觉矛盾,所以称号标签也跟着同一个补间一起刷新。
            if (levelLabelRef.current) {
              levelLabelRef.current.textContent = `LV.${levelForExp(val)} ${titleForExp(val)}`;
            }
          }, raf);
          expTrackRef.current?.animate(
            [{ transform: "scaleY(1)" }, { transform: "scaleY(1.8)" }, { transform: "scaleY(1)" }],
            { duration: 380, easing: "ease" }
          );
        },
      });
    }, 700);
    timeoutRefs.current.push(flyId);

    return () => {
      rafRefs.current.forEach((r) => cancelAnimationFrame(r.current));
      timeoutRefs.current.forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="result-reveal-screen">
      <div className="result-reveal-scroll">
        <div className="result-reveal-inner" ref={containerRef}>
          <div className="result-fly-layer" ref={flyLayerRef} />

          <div className="result-topbar">
            <div className="result-identity">
              <div className="result-avatar">
                {avatarUrl && <img src={avatarUrl} alt="" />}
              </div>
              <div className="result-identity-level" ref={levelLabelRef}>
                LV.{levelForExp(expBefore)} {titleForExp(expBefore)}
              </div>
            </div>
          </div>

          <div className="result-exp-block">
            <div className="result-exp-track" ref={expTrackRef}>
              <div
                className="result-exp-fill"
                ref={expFillRef}
                style={{ width: `${progressPctForExp(expBefore)}%` }}
              />
            </div>
            <div className="result-exp-text" ref={expTextRef}>{expProgressText(expBefore)}</div>
          </div>

          <div className="result-title-zone">
            <div className="result-ornament-row">
              <span className="result-ornament-line" />
              <span className="result-ornament-dot" />
              <span className="result-ornament-line" />
            </div>
            <div className={`result-title ${result}`}>
              {result === "win" ? "胜利" : result === "lose" ? "失败" : "和棋"}
            </div>
            <div className="result-ornament-row">
              <span className="result-ornament-line" />
              <span className="result-ornament-dot" />
              <span className="result-ornament-line" />
            </div>
            {desc && <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>{desc}</p>}
          </div>

          <div className="result-reward-row">
            <div className="result-reward-chip exp" ref={expChipRef}>
              <div className="result-reward-chip-top">
                <span className="result-reward-chip-icon-badge"><IconExpStar size={15} /></span>
                +{expDelta}
              </div>
              <div className="result-reward-chip-label">经验奖励</div>
            </div>
          </div>

          <div className="result-recap-card">
            <div className="result-recap-title">{recapTitle}</div>
            {meta?.winLine ? (
              <div
                className="result-recap-board-wrap"
                onClick={() => setShowFullBoard(true)}
                role="button"
                tabIndex={0}
                aria-label="查看完整对局"
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setShowFullBoard(true); }}
              >
                <MatchRecapBoard board={meta?.board} winLine={meta?.winLine} />
                <span className="result-recap-expand-hint"><IconMaximize size={13} /></span>
              </div>
            ) : (
              <div className="result-recap-board-wrap">
                <MatchRecapBoard board={meta?.board} winLine={meta?.winLine} />
              </div>
            )}
            {meta?.winLine && <div className="result-recap-tap-caption">点击查看完整对局</div>}
            <div className="result-recap-divider">
              <span className="result-recap-divider-line" />
              <span className="result-recap-divider-dot" />
              <span className="result-recap-divider-line" />
            </div>
            <div className="result-stats-grid">
              <div className="result-stat-cell">
                <div className="result-stat-cell-icon"><IconClock size={16} /></div>
                <div className="result-stat-cell-value">{formatDuration(meta?.durationSec ?? 0)}</div>
                <div className="result-stat-cell-label">用时</div>
              </div>
              <div className="result-stat-cell">
                <div className="result-stat-cell-icon"><IconListNumbers size={16} /></div>
                <div className="result-stat-cell-value">{meta?.moveCount ?? 0} 手</div>
                <div className="result-stat-cell-label">手数</div>
              </div>
            </div>
          </div>

          <div className="result-encourage-line">
            你执{mySlot === 1 ? "黑" : "白"} · {opponentName}执{mySlot === 1 ? "白" : "黑"}
          </div>
        </div>
      </div>

      <div className="result-reveal-footer">
        <div className="result-reveal-footer-row">
          <button className="btn-ghost" onClick={onExit}>返回首页</button>
          <button className="btn-primary" onClick={onReturnToRoom} disabled={returningToRoom}>
            {returningToRoom ? "处理中…" : "返回房间"}
          </button>
        </div>
      </div>

      {showFullBoard && meta?.board && (
        <div className="recap-modal-overlay" onClick={() => setShowFullBoard(false)}>
          <div className="recap-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="recap-modal-header">
              <div className="recap-modal-title">完整对局回放</div>
              <button className="recap-modal-close" onClick={() => setShowFullBoard(false)} aria-label="关闭">
                <IconX size={15} />
              </button>
            </div>
            <Board board={meta.board} winLine={meta.winLine} locked onCellClick={() => {}} />
            <div className="recap-modal-footer-text">
              共 {meta.moveCount ?? 0} 手 · {formatDuration(meta.durationSec ?? 0)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
