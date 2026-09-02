import { useState, useRef, useEffect, useCallback } from "react";
import XiangqiBoard from "./XiangqiBoard";
import { IconUndo, IconChevronLeft } from "./Icons";
import {
  createInitialBoard, cloneBoard, applyMove, legalMovesFrom, isLegalMove,
  isInCheck, checkGameOver, positionKey, RED, BLACK,
} from "../game/xiangqiLogic";
import { chooseAiMove } from "../game/xiangqiAi";
import { useTelegramBackButton, hapticNotify } from "../lib/telegram";

const AI_THINK_DELAY = { easy: 300, normal: 550 };

// 第一阶段的本地演示页:红先黑后,玩家可选执红/执黑,AI 走对方。
// 后续阶段会把这里换成正式接入在线对战/每日试炼的版本。
export default function XiangqiPveScreen({ onExit, onExitHome }) {
  useTelegramBackButton(onExit);

  const [playerColor, setPlayerColor] = useState(null); // null = 未选边
  const [difficulty, setDifficulty] = useState("normal");
  const [board, setBoard] = useState(createInitialBoard());
  const [turn, setTurn] = useState(RED); // 红方永远先手
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [history, setHistory] = useState([]);
  const [gameOver, setGameOver] = useState(null); // { winner, reason } | null
  const [thinking, setThinking] = useState(false);

  const aiColor = playerColor === RED ? BLACK : RED;
  const aiTimerRef = useRef(null);
  const moveTokenRef = useRef(0);
  // 判和用的两个累积状态,跟悔棋用的 history state(棋盘快照栈)是两回事,
  // 不需要触发重渲染,用 ref 存就行——每步走完更新,悔棋时从对应的快照
  // 里整体恢复(见下面 pushHistory 把这两样也一起存进快照的做法)。
  const positionHistoryRef = useRef([]);
  const noCaptureRef = useRef(0);

  useEffect(() => () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); }, []);

  const legalTargets = selected ? legalMovesFrom(board, selected[0], selected[1]) : [];

  function pushHistory(prevBoard, prevTurn) {
    setHistory((h) => [...h, {
      board: prevBoard, turn: prevTurn,
      posHistory: [...positionHistoryRef.current], noCapture: noCaptureRef.current,
    }]);
  }

  function doMove(from, to) {
    if (gameOver || thinking) return;
    const mover = board[from[1]][from[0]];
    if (!mover) return;
    if (!isLegalMove(board, from, to, turn)) return;

    const wasCapture = board[to[1]][to[0]] !== 0;
    pushHistory(cloneBoard(board), turn);
    const next = applyMove(board, from, to);
    const nextTurn = -turn;
    noCaptureRef.current = wasCapture ? 0 : noCaptureRef.current + 1;
    positionHistoryRef.current = [...positionHistoryRef.current, positionKey(next, nextTurn)];
    setBoard(next);
    setLastMove({ from, to });
    setSelected(null);
    setTurn(nextTurn);

    const over = checkGameOver(next, nextTurn, positionHistoryRef.current, noCaptureRef.current);
    if (over) {
      setGameOver(over);
      if (over.winner === 0) hapticNotify?.("warning");
      else hapticNotify?.(over.winner === playerColor ? "success" : "error");
    }
  }

  // 玩家点击棋盘落子（只在轮到玩家时生效，AI 回合棋盘会被锁住）
  function handleBoardMove(from, to) {
    if (turn !== playerColor) return;
    doMove(from, to);
  }

  // AI 走子
  useEffect(() => {
    if (!playerColor || gameOver) return;
    if (turn !== aiColor) return;
    setThinking(true);
    moveTokenRef.current += 1;
    const token = moveTokenRef.current;
    aiTimerRef.current = setTimeout(() => {
      if (token !== moveTokenRef.current) return;
      const move = chooseAiMove(board, aiColor, difficulty === "easy" ? "easy" : "normal");
      setThinking(false);
      if (!move) return;
      doMove(move.from, move.to);
    }, AI_THINK_DELAY[difficulty] || 500);
    return () => clearTimeout(aiTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, playerColor, gameOver]);

  function handleUndo() {
    // 悔棋要把 AI 的那步也一起撤掉，回到玩家自己上次落子之前
    if (thinking || history.length === 0) return;
    const stepsBack = history.length >= 2 && history[history.length - 1].turn === aiColor ? 2 : 1;
    const target = history[history.length - stepsBack];
    setBoard(target.board);
    setTurn(target.turn);
    setHistory((h) => h.slice(0, h.length - stepsBack));
    positionHistoryRef.current = target.posHistory;
    noCaptureRef.current = target.noCapture;
    setSelected(null);
    setLastMove(null);
    setGameOver(null);
  }

  function handleRestart() {
    setBoard(createInitialBoard());
    setTurn(RED);
    setSelected(null);
    setLastMove(null);
    setHistory([]);
    positionHistoryRef.current = [];
    noCaptureRef.current = 0;
    setGameOver(null);
  }

  const checkColor = gameOver ? null : (isInCheck(board, turn) ? turn : null);

  if (!playerColor) {
    return (
      <div className="app-shell">
        <div className="screen-header">
          <button className="nav-icon-btn" onClick={onExit}><IconChevronLeft /></button>
          <div className="screen-title">象棋 · 人机对战</div>
          <div style={{ width: 40 }} />
        </div>
        <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div style={{ fontSize: "var(--text-heading)", fontWeight: 600 }}>选择你执子的颜色</div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <button className="cta-primary" style={{ flex: 1 }} onClick={() => setPlayerColor(RED)}>执红（先手）</button>
            <button className="cta-primary" style={{ flex: 1 }} onClick={() => setPlayerColor(BLACK)}>执黑（后手）</button>
          </div>
          <div style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-4)" }}>AI 难度</div>
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <button className={`secondary-card${difficulty === "easy" ? " active" : ""}`} style={{ flex: 1 }} onClick={() => setDifficulty("easy")}>随意</button>
            <button className={`secondary-card${difficulty === "normal" ? " active" : ""}`} style={{ flex: 1 }} onClick={() => setDifficulty("normal")}>正常</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="screen-header">
        <button className="nav-icon-btn" onClick={onExit}><IconChevronLeft /></button>
        <div className="screen-title">象棋 · 人机对战</div>
        <button className="nav-icon-btn" onClick={handleUndo}><IconUndo /></button>
      </div>

      <div className="xq-status-bar">
        <div className="xq-turn-badge">
          <span className={`xq-turn-dot ${turn === RED ? "xq-red" : "xq-black"}`} />
          {gameOver ? "对局结束" : thinking ? "对方思考中…" : turn === playerColor ? "轮到你" : "对方回合"}
        </div>
        {checkColor && !gameOver && <div style={{ color: "var(--seal-red)", fontWeight: 700 }}>将军！</div>}
      </div>

      <XiangqiBoard
        board={board}
        onMove={handleBoardMove}
        selected={selected}
        onSelectChange={setSelected}
        legalTargets={turn === playerColor ? legalTargets : []}
        lastMove={lastMove}
        checkColor={checkColor}
        disabled={turn !== playerColor}
        locked={!!gameOver}
      />

      {gameOver && (
        <div style={{ padding: "var(--space-6)", textAlign: "center" }}>
          <div style={{ fontSize: "var(--text-heading)", fontWeight: 700, marginBottom: "var(--space-3)" }}>
            {gameOver.winner === 0 ? "和棋" : gameOver.winner === playerColor ? "你赢了！" : "你输了"}
            {gameOver.reason === "checkmate" ? "（将死）"
              : gameOver.reason === "stalemate" ? "（困毙）"
              : gameOver.reason === "repetition" ? "（局面三次重复）"
              : gameOver.reason === "sixty_move" ? "（60回合无吃子）"
              : ""}
          </div>
          <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
            <button className="cta-primary" onClick={handleRestart}>再来一局</button>
            <button className="secondary-card" onClick={onExitHome}>返回首页</button>
          </div>
        </div>
      )}
    </div>
  );
}
