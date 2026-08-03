import { BOARD_SIZE } from "../game/logic";

const STAR_POINTS = new Set(["3,3", "3,11", "11,3", "11,11", "7,7"]);

export default function Board({ board, onCellClick, lastMove, winLine, disabled, onIllegalTap }) {
  const winSet = new Set((winLine || []).map(([x, y]) => `${x},${y}`));

  function handleCellTap(x, y, cell) {
    if (disabled || cell !== 0) {
      onIllegalTap?.();
      return;
    }
    onCellClick(x, y);
  }

  return (
    <div className={`board-wrap${disabled ? " board-disabled" : ""}`}>
      <div className="board-grid">
        {board.map((row, y) =>
          row.map((cell, x) => {
            const isStar = STAR_POINTS.has(`${x},${y}`);
            const isLast = lastMove && lastMove[0] === x && lastMove[1] === y;
            return (
              <div
                key={`${x}-${y}`}
                className={`board-cell${isStar && cell === 0 ? " star-point" : ""}`}
                onClick={() => handleCellTap(x, y, cell)}
              >
                {cell !== 0 && (
                  <div className={`stone ${cell === 1 ? "black" : "white"}${isLast ? " last-move" : ""}${winSet.has(`${x},${y}`) ? " winning" : ""}`} />
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
    </div>
  );
}
