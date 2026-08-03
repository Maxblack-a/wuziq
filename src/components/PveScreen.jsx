import { useState, useCallback } from "react";
import Board from "./Board";
import ResultModal from "./ResultModal";
import { createEmptyBoard, checkWin, isBoardFull, cloneBoard, BLACK, WHITE } from "../game/logic";
import { getAiMove } from "../game/ai";
import { useTelegramBackButton, hapticImpact, hapticNotify, confirmDialog } from "../lib/telegram";

export default function PveScreen({ onExit }) {
  useTelegramBackButton(onExit);
  const [difficulty, setDifficulty] = useState("medium");
  const [board, setBoard] = useState(createEmptyBoard());
  const [turn, setTurn] = useState(BLACK); // 玩家执黑先手
  const [lastMove, setLastMove] = useState(null);
  const [winInfo, setWinInfo] = useState(null);
  const [result, setResult] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState([]); // 用于悔棋

  const reset = useCallback(() => {
    setBoard(createEmptyBoard());
    setTurn(BLACK);
    setLastMove(null);
    setWinInfo(null);
    setResult(null);
    setHistory([]);
  }, []);

  async function handleDifficultyChange(key) {
    if (key === difficulty) return;
    // 棋盘上已经有子了(不是刚开局),手滑碰到难度按钮不该无声无息把这盘棋清空
    const inProgress = history.length > 0 || lastMove !== null;
    if (inProgress) {
      const confirmed = await confirmDialog("切换难度会放弃当前这盘棋,确定吗?");
      if (!confirmed) return;
    }
    setDifficulty(key);
    reset();
  }

  function applyMove(x, y, player, currentBoard) {
    const next = cloneBoard(currentBoard);
    next[y][x] = player;
    return next;
  }

  function handleCellClick(x, y) {
    if (result || thinking || turn !== BLACK) return;

    const next = applyMove(x, y, BLACK, board);
    setHistory(h => [...h, board]);
    setBoard(next);
    setLastMove([x, y]);
    hapticImpact("light");

    const win = checkWin(next, x, y);
    if (win) {
      setWinInfo(win.line);
      setResult({ outcome: "win" });
      hapticNotify("success");
      return;
    }
    if (isBoardFull(next)) {
      setResult({ outcome: "draw" });
      return;
    }

    setTurn(WHITE);
    setThinking(true);
    // 延迟一下模拟"思考",体验更自然
    setTimeout(() => {
      const move = getAiMove(next, WHITE, BLACK, difficulty);
      if (!move) { setThinking(false); return; }
      const afterAi = applyMove(move.x, move.y, WHITE, next);
      setBoard(afterAi);
      setLastMove([move.x, move.y]);
      setThinking(false);

      const aiWin = checkWin(afterAi, move.x, move.y);
      if (aiWin) {
        setWinInfo(aiWin.line);
        setResult({ outcome: "lose" });
        hapticNotify("error");
      } else if (isBoardFull(afterAi)) {
        setResult({ outcome: "draw" });
      } else {
        setTurn(BLACK);
      }
    }, 450);
  }

  function undo() {
    if (history.length < 1 || thinking || result) return;
    const prevBoard = history[history.length - 1];
    setBoard(prevBoard);
    setHistory(h => h.slice(0, -1));
    setTurn(BLACK);
    setWinInfo(null);
    setLastMove(null);
  }

  return (
    <div>
      <div className="game-layout">
        <div className="game-board-col">
          <Board board={board} onCellClick={handleCellClick} lastMove={lastMove} winLine={winInfo} disabled={thinking} onIllegalTap={() => hapticNotify("warning")} />
        </div>

        <div className="game-info-col">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn-ghost" onClick={onExit}>← 返回</button>
            <div className="turn-indicator">
              {thinking ? (
                <><div className="spinner" /> AI 思考中</>
              ) : (
                <>
                  <div className={`turn-dot black${turn === 1 ? " active" : ""}`} />
                  <div className={`turn-dot white${turn === 2 ? " active" : ""}`} />
                  {turn === 1 ? "轮到你" : "对方回合"}
                </>
              )}
            </div>
          </div>

          <div className="diff-row">
            {[["easy", "简单"], ["medium", "中等"], ["hard", "困难"]].map(([key, label]) => (
              <button
                key={key}
                className={`diff-btn${difficulty === key ? " active" : ""}`}
                onClick={() => handleDifficultyChange(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, textAlign: "center" }}>人机对战不计入积分和战绩</p>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <button className="btn-ghost" onClick={undo} disabled={history.length < 1 || thinking || !!result}>悔棋</button>
          </div>
        </div>
      </div>

      <ResultModal result={result} onRematch={reset} onExit={onExit} />
    </div>
  );
}
