import { useEffect, useRef, useState } from "react";
import Board from "./Board";
import { createEmptyBoard, checkWin, isBoardFull, cloneBoard } from "../game/logic";
import { skillTestEngine, PLAYER_COLOR, LINMO_COLOR, MAX_MOVES_PER_SIDE } from "../game/skillTest";
import { computeSkillProfile } from "../lib/skillProfile";
import { pickInGameLine } from "../lib/linmoDialogue";
import { hapticNotify } from "../lib/telegram";

const THINKING_DELAY = 500; // 固定思考延迟,不用像三档AI那样区分快慢——这不是在"演强弱",只是给点节奏感
const WIN_REVEAL_DELAY = 1000;
const DRAW_REVEAL_DELAY = 400;

// onFinish(profile, testState, reason): 测试结束(不管是关卡收集完、撞了步数
// 上限、还是真的下出了胜负)统一走这一个回调,交给上层决定去结果揭晓页。
// onAbort: 中途放弃,不产出结果,等同于没测过。
export default function SkillTestScreen({ onFinish, onAbort }) {
  const [board, setBoard] = useState(createEmptyBoard());
  const [turn, setTurn] = useState(PLAYER_COLOR);
  const [lastMove, setLastMove] = useState(null);
  const [winInfo, setWinInfo] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [testState, setTestState] = useState(() => skillTestEngine.createTestState());
  const [currentLine, setCurrentLine] = useState(() => pickInGameLine("game_start"));
  const linmoTimerRef = useRef(null);
  const revealTimerRef = useRef(null);
  const finishedRef = useRef(false); // 防止揭晓延迟期间又触发一次 finalize

  useEffect(() => {
    return () => {
      if (linmoTimerRef.current) clearTimeout(linmoTimerRef.current);
      clearTimeout(revealTimerRef.current);
    };
  }, []);

  function applyMove(x, y, player, currentBoard) {
    const next = cloneBoard(currentBoard);
    next[y][x] = player;
    return next;
  }

  function finalize(finalTestState, reason, outcome) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const profile = computeSkillProfile(finalTestState);
    const proceed = () => onFinish(profile, finalTestState, reason);
    if (outcome) {
      setRevealing(true);
      revealTimerRef.current = setTimeout(proceed, outcome === "draw" ? DRAW_REVEAL_DELAY : WIN_REVEAL_DELAY);
    } else {
      proceed();
    }
  }

  function performLinMoMove(afterPlayerBoard, stateAfterPlayer) {
    setThinking(true);
    linmoTimerRef.current = setTimeout(() => {
      linmoTimerRef.current = null;
      const { move, testState: preMoveState, dialogueKey } = skillTestEngine.decideLinMoMove(afterPlayerBoard, stateAfterPlayer);
      if (!move) {
        setThinking(false);
        finalize(stateAfterPlayer, "game_over", "draw");
        return;
      }
      const afterLinMo = applyMove(move.x, move.y, LINMO_COLOR, afterPlayerBoard);
      const recordedState = skillTestEngine.recordLinMoMove(afterPlayerBoard, preMoveState, move.x, move.y);

      setBoard(afterLinMo);
      setLastMove([move.x, move.y]);
      setThinking(false);
      if (dialogueKey) {
        const line = pickInGameLine(dialogueKey);
        if (line) setCurrentLine(line);
      }

      const linmoWin = checkWin(afterLinMo, move.x, move.y);
      if (linmoWin) {
        setWinInfo(linmoWin.line);
        hapticNotify("error");
        finalize(recordedState, "game_over", "lose");
        return;
      }
      if (isBoardFull(afterLinMo)) {
        finalize(recordedState, "game_over", "draw");
        return;
      }
      if (skillTestEngine.isFinished(recordedState)) {
        finalize(recordedState, recordedState.moveIndex >= MAX_MOVES_PER_SIDE ? "step_cap" : "checkpoints_done", null);
        return;
      }
      setTestState(recordedState);
      setTurn(PLAYER_COLOR);
    }, THINKING_DELAY);
  }

  function handleCellClick(x, y) {
    if (thinking || revealing || turn !== PLAYER_COLOR) return;

    const beforeBoard = board;
    const afterBoard = applyMove(x, y, PLAYER_COLOR, beforeBoard);
    const recordedState = skillTestEngine.recordPlayerMove(beforeBoard, testState, x, y);

    setBoard(afterBoard);
    setLastMove([x, y]);

    // 关卡判定结果(挡住了/没挡住/抓住机会了没)会追加在 checkpoints 末尾,
    // 一有新增就说明玩家刚才这一步刚好回应了某个正在等待判定的关卡——
    // 立刻给一句针对性反馈,而不是让判定结果只留在数据里、玩家完全无感。
    // 注意这里要赶在 performLinMoMove 把 thinking 置为 true 之前设置,
    // 不然同一个事件循环里会被"思考中"的状态盖掉,玩家根本看不到。
    if (recordedState.checkpoints.length > testState.checkpoints.length) {
      const cp = recordedState.checkpoints[recordedState.checkpoints.length - 1];
      const line = pickInGameLine(`${cp.type}_${cp.result}`);
      if (line) setCurrentLine(line);
    }

    const win = checkWin(afterBoard, x, y);
    if (win) {
      setWinInfo(win.line);
      hapticNotify("success");
      finalize(recordedState, "game_over", "win");
      return;
    }
    if (isBoardFull(afterBoard)) {
      finalize(recordedState, "game_over", "draw");
      return;
    }

    setTestState(recordedState);
    setTurn(LINMO_COLOR);
    performLinMoMove(afterBoard, recordedState);
  }

  return (
    <div>
      <div className="game-layout">
        <div className="skilltest-header">
          <div className="skilltest-avatar">
            <img src="/linmo-portrait.webp" alt="林墨" />
          </div>
          <div className="skilltest-header-text">
            <div className="skilltest-name">林墨</div>
            <div className="skilltest-line">
              {currentLine}
              {thinking && <span className="skilltest-thinking-dots" aria-hidden="true">…</span>}
            </div>
          </div>
        </div>

        <div className="game-board-col">
          <Board
            board={board}
            onCellClick={handleCellClick}
            lastMove={lastMove}
            winLine={winInfo}
            disabled={thinking}
            locked={revealing}
            onIllegalTap={() => hapticNotify("warning")}
            previewColor={PLAYER_COLOR}
          />
        </div>

        <div className="game-info-col">
          <button className="btn-ghost" style={{ width: "100%" }} onClick={onAbort} disabled={thinking || revealing}>
            先不测了
          </button>
        </div>
      </div>
    </div>
  );
}
