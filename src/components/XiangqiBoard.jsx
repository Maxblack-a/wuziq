import { useState, useEffect } from "react";
import { BOARD_W, BOARD_H, PIECE_NAME, pieceColor, pieceType, RED } from "../game/xiangqiLogic";
import { hapticImpact } from "../lib/telegram";

// 坐标系与五子棋 Board.jsx 保持同一套写法：统一用 MARGIN + STEP 换算百分比,
// 网格线、棋子、点击热区、河界文字、九宫斜线全部按这一套坐标算,不会走样。
const MARGIN_X = 6;
const MARGIN_Y = 5;
const STEP_X = (100 - MARGIN_X * 2) / (BOARD_W - 1);
const STEP_Y = (100 - MARGIN_Y * 2) / (BOARD_H - 1);
const px = (x) => MARGIN_X + x * STEP_X;
const py = (y) => MARGIN_Y + y * STEP_Y;

export default function XiangqiBoard({
  board, onMove, selected, onSelectChange, legalTargets = [], lastMove,
  checkColor, disabled, locked, onIllegalTap,
}) {
  const interactionBlocked = disabled || locked;
  const [internalSelected, setInternalSelected] = useState(null);
  const sel = selected !== undefined ? selected : internalSelected;
  const setSel = onSelectChange || setInternalSelected;

  useEffect(() => {
    if (interactionBlocked) setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionBlocked]);

  const targetSet = new Set((legalTargets || []).map(([x, y]) => `${x},${y}`));

  function handleTap(x, y) {
    if (interactionBlocked) { onIllegalTap?.(); return; }
    const piece = board[y][x];

    if (sel && sel[0] === x && sel[1] === y) {
      setSel(null);
      hapticImpact("light");
      return;
    }

    if (targetSet.has(`${x},${y}`) && sel) {
      onMove(sel, [x, y]);
      setSel(null);
      hapticImpact("medium");
      return;
    }

    if (piece !== 0) {
      setSel([x, y]);
      hapticImpact("light");
      return;
    }

    onIllegalTap?.();
  }

  const xs = Array.from({ length: BOARD_W }, (_, i) => i);
  const ys = Array.from({ length: BOARD_H }, (_, i) => i);
  const targetList = legalTargets || [];

  return (
    <div className={`xq-board-wrap${disabled ? " xq-board-disabled" : ""}`}>
      <div className="xq-board-grid">
        <svg className="xq-lines-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* 竖线：中间河界处断开（y=4 到 y=5 之间不连） */}
          {xs.map((x) => (
            <g key={`v${x}`}>
              <line className="xq-line" x1={px(x)} y1={py(0)} x2={px(x)} y2={py(4)} />
              <line className="xq-line" x1={px(x)} y1={py(5)} x2={px(x)} y2={py(9)} />
            </g>
          ))}
          {ys.map((y) => (
            <line key={`h${y}`} className="xq-line" x1={px(0)} y1={py(y)} x2={px(8)} y2={py(y)} />
          ))}
          {/* 九宫斜线：上下各一个米字格局部 */}
          <line className="xq-line" x1={px(3)} y1={py(0)} x2={px(5)} y2={py(2)} />
          <line className="xq-line" x1={px(5)} y1={py(0)} x2={px(3)} y2={py(2)} />
          <line className="xq-line" x1={px(3)} y1={py(7)} x2={px(5)} y2={py(9)} />
          <line className="xq-line" x1={px(5)} y1={py(7)} x2={px(3)} y2={py(9)} />
          <rect className="xq-frame" x={px(0)} y={py(0)} width={px(8) - px(0)} height={py(9) - py(0)} />

          {/* 选中棋子 -> 各合法落点之间的虚线连接,一眼看出"能走去哪几个方向",
              而不是孤零零几个点散在棋盘上看不出跟谁有关系 */}
          {sel && targetList.map(([tx, ty]) => (
            <line
              key={`path-${tx}-${ty}`} className="xq-move-path"
              x1={px(sel[0])} y1={py(sel[1])} x2={px(tx)} y2={py(ty)}
            />
          ))}
        </svg>

        <div className="xq-river-label" style={{ top: `${(py(4) + py(5)) / 2}%` }}>
          <span>楚 河</span>
          <span>汉 界</span>
        </div>

        {ys.map((y) =>
          xs.map((x) => {
            const piece = board[y][x];
            const isSel = sel && sel[0] === x && sel[1] === y;
            const isTarget = targetSet.has(`${x},${y}`);
            const isLast = lastMove && ((lastMove.from[0] === x && lastMove.from[1] === y) || (lastMove.to[0] === x && lastMove.to[1] === y));
            return (
              <div
                key={`${x}-${y}`}
                className="xq-cell"
                style={{
                  left: `${px(x) - STEP_X / 2}%`, top: `${py(y) - STEP_Y / 2}%`,
                  width: `${STEP_X}%`, height: `${STEP_Y}%`,
                }}
                onClick={() => handleTap(x, y)}
              >
                {isTarget && <div className={`xq-target${piece !== 0 ? " xq-target-capture" : ""}`} />}
                {piece !== 0 && (
                  <div
                    className={`xq-piece ${pieceColor(piece) === RED ? "xq-red" : "xq-black"}${isSel ? " xq-selected" : ""}${isLast ? " xq-last-move" : ""}${checkColor === pieceColor(piece) ? " xq-in-check" : ""}`}
                  >
                    <span className="xq-piece-glyph">{PIECE_NAME[pieceColor(piece)][pieceType(piece)]}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
