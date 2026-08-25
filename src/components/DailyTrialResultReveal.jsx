import { useEffect, useRef, useState } from "react";
import MatchRecapBoard from "./MatchRecapBoard";
import Board from "./Board";
import { IconBolt, IconGem, IconExpStar, IconClock, IconListNumbers, IconMaximize, IconX } from "./Icons";
import { titleForExp, levelForExp, progressPctForExp, expProgressText } from "../lib/rank";
import { DAILY_STAMINA_CAP } from "../game/dailyTrialEngine";

// 飞行克隆用的钻石图标——跟 Icons.jsx 里 IconGem 是同一份 10 条线描边的
// 设计,这里单独存一份原始 SVG 字符串,是因为飞行克隆走的是原生 DOM
// (innerHTML 注入),不经过 React 渲染,没法直接塞一个 React 组件进去。
// 改 IconGem 形状的时候记得这份也要跟着改,不然结算页里"静止的钻石"
// 和"飞起来的钻石"会变成两个不一样的图标。
const DIAMOND_FLY_SVG = `<svg width="22" height="20" viewBox="0 0 24 22">
<polygon points="4.8,1.5 19.2,1.5 23,6.8 12,21 1,7" fill="#A8D8F0"/>
<g stroke="#1B5A8A" stroke-width="0.9" stroke-linecap="round" fill="none">
<line x1="4.8" y1="1.5" x2="9" y2="1.5"/><line x1="9" y1="1.5" x2="15" y2="1.5"/><line x1="15" y1="1.5" x2="19.2" y2="1.5"/>
<line x1="4.8" y1="1.5" x2="1" y2="7"/><line x1="19.2" y1="1.5" x2="23" y2="6.8"/><line x1="1" y1="7" x2="23" y2="6.8"/>
<line x1="1" y1="7" x2="12" y2="21"/><line x1="23" y1="6.8" x2="12" y2="21"/>
<polyline points="9,1.5 7.3,7.2 12,21"/><polyline points="15,1.5 16.9,6.4 12,21"/>
</g></svg>`;

// 结算揭晓页:胜/负/和棋 + 体力/钻石/经验的"飞行入账"动画。
// 设计上特意不跟"点评对话"(下一步)混在一起——这一屏只负责"数字层面
// 的客观反馈"(这局花了什么、赚了什么),态度/关系层面的反馈留给下一步
// 林墨的点评。三种资源各自的落点不一样:
//   体力 —— 只是数字倒数(开局那一刻已经在服务器端扣完了,这里纯粹是
//            "让玩家看见花掉的过程",不是真的在这一刻才扣)
//   钻石 —— 有右上角的计数徽章当"账户",飞过去落地、精确重合再消失
//   经验 —— 没有钻石那种独立计数徽章,落点是头像下方的等级进度条,
//            落地那一刻条本身往前长一截 + 阶内进度文字一起变
function describeRecapTitle(result, winLine) {
  const len = winLine?.length || 5;
  const word = len >= 6 ? "长连" : "五子连珠";
  if (result === "win") return `${word}取胜`;
  if (result === "lose") return `对手${word}`;
  return "棋逢对手,和棋收场";
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// 通用数值补间:duration 内把 onUpdate(v) 从 from 平滑推到 to,easeOutCubic。
function tween(from, to, duration, onUpdate, rafRef) {
  if (from === to) { onUpdate(to); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    onUpdate(from + (to - from) * eased);
    if (t < 1) rafRef.current = requestAnimationFrame(step);
  }
  rafRef.current = requestAnimationFrame(step);
}

function spawnSparkles(layerEl, containerRect, sourceEl) {
  const r = sourceEl.getBoundingClientRect();
  const cx = r.left - containerRect.left + r.width / 2;
  const cy = r.top - containerRect.top + r.height / 2;
  for (let i = 0; i < 6; i++) {
    const angle = ((Math.PI * 2) / 6) * i;
    const dist = 24 + Math.random() * 10;
    const s = document.createElement("span");
    s.className = "result-sparkle";
    s.style.left = cx + "px";
    s.style.top = cy + "px";
    s.style.setProperty("--dx", Math.cos(angle) * dist + "px");
    s.style.setProperty("--dy", Math.sin(angle) * dist + "px");
    s.style.animationDelay = "480ms";
    layerEl.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}

// 造一个"飞行克隆"元素:先在原地放大定住(带一点回弹),再一边缩小
// 一边真正飞向目标,落地跟目标精确中心重合。size/endSize 都是像素。
function flyClone({ layerEl, containerRect, sourceEl, targetEl, size, endSize, content, delay, onLanded }) {
  const sRect = sourceEl.getBoundingClientRect();
  const tRect = targetEl.getBoundingClientRect();
  const startCx = sRect.left - containerRect.left + sRect.width / 2;
  const startCy = sRect.top - containerRect.top + sRect.height / 2;
  const endCx = tRect.left - containerRect.left + tRect.width / 2;
  const endCy = tRect.top - containerRect.top + tRect.height / 2;
  const dx = endCx - startCx, dy = endCy - startCy;
  const endScale = endSize / size;

  const el = document.createElement("div");
  el.className = "result-fly-item";
  el.style.left = startCx - size / 2 + "px";
  el.style.top = startCy - size / 2 + "px";
  el.style.width = size + "px";
  el.style.height = size + "px";
  el.innerHTML = content;
  layerEl.appendChild(el);

  const timeoutId = setTimeout(() => {
    el.style.opacity = "1";
    const appear = el.animate([
      { transform: "scale(0.3)", opacity: 0 },
      { transform: "scale(1.4)", opacity: 1, offset: 0.5 },
      { transform: "scale(0.95)", opacity: 1, offset: 0.75 },
      { transform: "scale(1)", opacity: 1 },
    ], { duration: 600, easing: "ease-out", fill: "forwards" });
    appear.onfinish = () => {
      const fly = el.animate([
        { transform: "translate(0,0) scale(1)", offset: 0 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 16}px) scale(${(1 + endScale) / 2})`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${endScale})`, offset: 1 },
      ], { duration: 800, easing: "cubic-bezier(.3,0,.55,1)", fill: "forwards" });
      fly.onfinish = () => {
        el.remove();
        onLanded?.();
      };
    };
  }, delay);
  return timeoutId;
}

export default function DailyTrialResultReveal({
  result,
  avatarUrl,
  expBefore, expAfter, expDelta,
  diamondsBefore, diamondsAfter, diamondsDelta,
  staminaBefore, staminaAfter,
  meta,
  onContinue,
}) {
  const containerRef = useRef(null);
  const flyLayerRef = useRef(null);
  const staminaValueRef = useRef(null);
  const diamondValueRef = useRef(null);
  const diamondIconRef = useRef(null);
  const expFillRef = useRef(null);
  const expTextRef = useRef(null);
  const expTrackRef = useRef(null);
  const levelLabelRef = useRef(null);
  const diamondChipRef = useRef(null);
  const diamondChipIconRef = useRef(null);
  const expChipRef = useRef(null);
  const rafRefs = useRef([]);
  const timeoutRefs = useRef([]);
  const [showFullBoard, setShowFullBoard] = useState(false);

  const isWin = result === "win";
  const recapTitle = describeRecapTitle(result, meta?.winLine);

  useEffect(() => {
    const raf = { current: null };
    rafRefs.current.push(raf);
    tween(staminaBefore ?? staminaAfter, staminaAfter, 550, (v) => {
      if (staminaValueRef.current) staminaValueRef.current.textContent = Math.round(v);
    }, raf);

    if (!isWin) return () => {
      rafRefs.current.forEach((r) => cancelAnimationFrame(r.current));
      timeoutRefs.current.forEach((t) => clearTimeout(t));
    };

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

    popIn(diamondChipRef.current, 300);
    popIn(expChipRef.current, 520);

    const flyId = setTimeout(() => {
      flyClone({
        layerEl: layer,
        containerRect,
        sourceEl: diamondChipIconRef.current,
        targetEl: diamondIconRef.current,
        size: 22,
        endSize: diamondIconRef.current.getBoundingClientRect().width,
        content: DIAMOND_FLY_SVG,
        delay: 0,
        onLanded: () => {
          const raf2 = { current: null };
          rafRefs.current.push(raf2);
          tween(diamondsBefore, diamondsAfter, 450, (v) => {
            if (diamondValueRef.current) diamondValueRef.current.textContent = Math.round(v);
          }, raf2);
          diamondIconRef.current?.animate(
            [{ transform: "scale(1)" }, { transform: "scale(1.5)" }, { transform: "scale(1)" }],
            { duration: 450, easing: "ease" }
          );
        },
      });

      flyClone({
        layerEl: layer,
        containerRect,
        sourceEl: expChipRef.current,
        targetEl: expTrackRef.current,
        size: 26,
        endSize: 4,
        content: `<div class="result-fly-orb">+${expDelta}</div>`,
        delay: 150,
        onLanded: () => {
          const raf3 = { current: null };
          rafRefs.current.push(raf3);
          tween(expBefore, expAfter, 500, (v) => {
            const val = Math.round(v);
            if (expFillRef.current) expFillRef.current.style.width = progressPctForExp(val) + "%";
            if (expTextRef.current) expTextRef.current.textContent = expProgressText(val);
            // 经验跨阶/跨称号(比如"棋童5阶"涨成"棋士1阶")在这局奖励不大的
            // 情况下不常见,但边界附近确实可能发生——如果只更新进度条和
            // 阶内文字、不更新这里的称号,会出现"条已经空了但称号还没变"
            // 这种视觉矛盾,所以称号标签也跟着同一个补间一起刷新。
            if (levelLabelRef.current) {
              levelLabelRef.current.textContent = `LV.${levelForExp(val)} ${titleForExp(val)}`;
            }
          }, raf3);
          expTrackRef.current?.animate(
            [{ transform: "scaleY(1)" }, { transform: "scaleY(1.8)" }, { transform: "scaleY(1)" }],
            { duration: 380, easing: "ease" }
          );
        },
      });
    }, 900);
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
            <div className="result-resource-group">
              <div className="result-resource-item stamina">
                <IconBolt size={17} />
                <span ref={staminaValueRef}>{staminaBefore}</span>/{DAILY_STAMINA_CAP}
              </div>
              <div className="result-resource-item diamond">
                <span ref={diamondIconRef}><IconGem size={17} /></span>
                <span ref={diamondValueRef}>{diamondsBefore}</span>
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
          </div>

          {isWin ? (
            <div className="result-reward-row">
              <div className="result-reward-chip diamond" ref={diamondChipRef}>
                <div className="result-reward-chip-top">
                  <span className="result-reward-chip-icon-badge" ref={diamondChipIconRef}><IconGem size={16} /></span>
                  +{diamondsDelta}
                </div>
                <div className="result-reward-chip-label">钻石奖励</div>
              </div>
              <div className="result-reward-divider" />
              <div className="result-reward-chip exp" ref={expChipRef}>
                <div className="result-reward-chip-top">
                  <span className="result-reward-chip-icon-badge"><IconExpStar size={15} /></span>
                  +{expDelta}
                </div>
                <div className="result-reward-chip-label">经验奖励</div>
              </div>
            </div>
          ) : (
            <div className="result-reward-row">
              <div className="result-no-reward-chip">本局未获得奖励</div>
            </div>
          )}

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
              <div className="result-stat-cell">
                <div className="result-stat-cell-icon"><IconBolt size={16} /></div>
                <div className="result-stat-cell-value">-{staminaBefore - staminaAfter}</div>
                <div className="result-stat-cell-label">体力</div>
              </div>
            </div>
          </div>

          {!isWin && <div className="result-encourage-line">再接再厉,下一局找回来</div>}
        </div>
      </div>

      <div className="result-reveal-footer">
        <button className="btn-primary" onClick={onContinue}>继续</button>
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
