import { useState, useEffect } from "react";
import { BOARD_SIZE } from "../game/logic";
import { hapticImpact } from "../lib/telegram";

const STAR_POINTS = new Set(["3,3", "3,11", "11,3", "11,11", "7,7"]);

// 棋盘边缘到最外圈线的留白 + 交叉点间距,统一用这两个数算,棋子、点击热区、
// 网格线、星位点、胜负连线全部按同一套坐标系来,不会再出现"线和棋子对不上"
// 的问题。MARGIN 改小/改大就是收窄/放宽边框,不用再去猜该改哪个变量。
const MARGIN = 4.375; // 对应设计图里 14px / 320px 的比例
const STEP = (100 - MARGIN * 2) / (BOARD_SIZE - 1);
const pos = (i) => MARGIN + i * STEP;

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

  const winSet = new Set((winLine || []).map(([x, y]) => `${x},${y}`));
  const lines = Array.from({ length: BOARD_SIZE }, (_, i) => i);

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
      <div className={`board-wrap${disabled ? " board-disabled" : ""}`}>
        <div className="board-grid">
          {/* 网格线直接用 SVG 画,15 条横线 + 15 条竖线首尾相连,天然围成一个
              完整的边框,不会像 CSS 背景渐变那样在最外层因为取整被裁掉 */}
          <svg className="board-lines-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            {lines.map((i) => (
              <line key={`h${i}`} className="board-line" x1={MARGIN} y1={pos(i)} x2={100 - MARGIN} y2={pos(i)} />
            ))}
            {lines.map((i) => (
              <line key={`v${i}`} className="board-line" x1={pos(i)} y1={MARGIN} x2={pos(i)} y2={100 - MARGIN} />
            ))}
            <rect className="board-frame" x={MARGIN} y={MARGIN} width={100 - MARGIN * 2} height={100 - MARGIN * 2} />
          </svg>

          {board.map((row, y) =>
            row.map((cell, x) => {
              const isStar = STAR_POINTS.has(`${x},${y}`);
              const isLast = lastMove && lastMove[0] === x && lastMove[1] === y;
              const isPending = pending && pending.x === x && pending.y === y;
              return (
                <div
                  key={`${x}-${y}`}
                  className={`board-cell${isStar && cell === 0 ? " star-point" : ""}`}
                  style={{ left: `${pos(x) - STEP / 2}%`, top: `${pos(y) - STEP / 2}%`, width: `${STEP}%`, height: `${STEP}%` }}
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
                x1={pos(winLine[0][0])}
                y1={pos(winLine[0][1])}
                x2={pos(winLine[4][0])}
                y2={pos(winLine[4][1])}
              />
            </svg>
          )}
        </div>
        {disabled && <div className="board-disabled-badge">对方回合</div>}
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
