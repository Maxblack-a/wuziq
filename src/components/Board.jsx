import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { BOARD_SIZE } from "../game/logic";
import { hapticImpact } from "../lib/telegram";

const STAR_POINTS = new Set(["3,3", "3,11", "11,3", "11,11", "7,7"]);

// previewColor: 1=黑 2=白,决定"待确认"的预览棋子显示成什么颜色(当前该谁落子)
export default function Board({ board, onCellClick, lastMove, winLine, disabled, onIllegalTap, previewColor }) {
  // 点击先只是"选中"一个格子(pending),显示一个半透明预览棋子;
  // 真正调用 onCellClick(落子、同步给对手)要等用户点了"确认落子"才会发生。
  // 这样用户可以先看一眼选的位置对不对,改主意了也能改选别的格子或者取消。
  const [pending, setPending] = useState(null); // { x, y } | null

  useEffect(() => {
    // 轮到对方了(或者棋局状态变化导致这个棋盘被禁用),清掉还没确认的选择,
    // 避免残留一个不该出现的预览棋子
    if (disabled) setPending(null);
  }, [disabled]);

  // 棋盘必须是正方形,之前用 CSS 的 aspect-ratio / padding-top 百分比技巧来撑出
  // 正方形,但这类"自动高度"的解析在不同 WebView 内核里(尤其是桌面版 Telegram
  // 内置的浏览器内核,跟手机端、跟普通 Chrome 都不是同一套渲染实现)表现不一致,
  // 会导致网格线定位用到的百分比算错基准,出现棋盘偏向一角、周围留白不均的问题。
  // 这里改成用 JS 直接量出容器实际渲染宽度,显式写死成一个像素高度——
  // 不再依赖任何引擎对"这个高度算不算确定尺寸"的判断,量出来是多少就是多少,
  // 换哪个 WebView 内核结果都一样。
  const wrapRef = useRef(null);
  const [squarePx, setSquarePx] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function measure() {
      const w = el.clientWidth;
      if (w > 0) setSquarePx(w);
    }
    measure();
    // ResizeObserver 覆盖:窗口缩放、Telegram 桌面端可调整窗口大小、
    // 移动端横竖屏切换、字体大小系统设置变化等一切会改变宽度的情况
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("orientationchange", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("orientationchange", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const winSet = new Set((winLine || []).map(([x, y]) => `${x},${y}`));

  function handleCellTap(x, y, cell) {
    if (disabled || cell !== 0) {
      onIllegalTap?.();
      return;
    }
    if (pending && pending.x === x && pending.y === y) {
      setPending(null); // 再点一下已经选中的格子,当作取消选择
      hapticImpact("light");
      return;
    }
    setPending({ x, y }); // 选中新的格子(如果之前选了别的,直接替换,方便改主意)
    hapticImpact("light");
  }

  function handleConfirm() {
    if (!pending || disabled) return;
    onCellClick(pending.x, pending.y);
    setPending(null);
    hapticImpact("medium");
  }

  function handleCancel() {
    setPending(null);
  }

  return (
    <div>
      <div
        ref={wrapRef}
        className={`board-wrap${disabled ? " board-disabled" : ""}`}
        style={squarePx ? { height: `${squarePx}px` } : undefined}
      >
        <div className="board-inner">
          <div className="board-grid">
            {board.map((row, y) =>
              row.map((cell, x) => {
                const isStar = STAR_POINTS.has(`${x},${y}`);
                const isLast = lastMove && lastMove[0] === x && lastMove[1] === y;
                const isPending = pending && pending.x === x && pending.y === y;
                return (
                  <div
                    key={`${x}-${y}`}
                    className={`board-cell${isStar && cell === 0 ? " star-point" : ""}`}
                    onClick={() => handleCellTap(x, y, cell)}
                  >
                    {cell !== 0 && (
                      <div className={`stone ${cell === 1 ? "black" : "white"}${isLast ? " last-move" : ""}${winSet.has(`${x},${y}`) ? " winning" : ""}`} />
                    )}
                    {cell === 0 && isPending && (
                      <div className={`stone preview ${previewColor === 1 ? "black" : "white"}`} />
                    )}
                  </div>
                );
              })
            )}
            {winLine && winLine.length === 5 && (
              <svg className="win-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                <line
                  className="win-line-path"
                  x1={(winLine[0][0] + 0.5) * (100 / BOARD_SIZE)}
                  y1={(winLine[0][1] + 0.5) * (100 / BOARD_SIZE)}
                  x2={(winLine[4][0] + 0.5) * (100 / BOARD_SIZE)}
                  y2={(winLine[4][1] + 0.5) * (100 / BOARD_SIZE)}
                />
              </svg>
            )}
          </div>
          {disabled && <div className="board-disabled-badge">对方回合</div>}
        </div>
      </div>

      {pending && (
        <div className="confirm-bar">
          <button className="btn-ghost" style={{ flex: 1 }} onClick={handleCancel}>取消</button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm}>确认落子</button>
        </div>
      )}
    </div>
  );
}
