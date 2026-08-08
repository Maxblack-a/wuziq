import { useState, useEffect } from "react";
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
      <div className={`board-wrap${disabled ? " board-disabled" : ""}`}>
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

      {pending && (
        <div className="confirm-bar">
          <button className="btn-ghost" style={{ flex: 1 }} onClick={handleCancel}>取消</button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleConfirm}>确认落子</button>
        </div>
      )}
    </div>
  );
}
