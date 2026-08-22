import { useEffect, useRef, useState } from "react";
import Board from "./Board";
import { IconChevronLeft } from "./Icons";
import { createEmptyBoard, checkWin, isBoardFull, cloneBoard } from "../game/logic";
import {
  PLAYER_COLOR, LINMO_COLOR,
  computeSkillDial, getAdaptiveMove,
  createMoveLog, recordPlayerMove, computeMatchQuality,
} from "../game/dailyTrialEngine";
import { pickInGameLine } from "../lib/linmoDialogue";
import { isInTelegram, useTelegramBackButton, hapticNotify, confirmDialog } from "../lib/telegram";

const THINKING_DELAY = 500;
const WIN_REVEAL_DELAY = 1000;
const DRAW_REVEAL_DELAY = 400;

// 对局过程中的闲聊台词池——不跟棋力测试那套"关卡触发"逻辑挂钩(每日
// 试炼没有关卡),纯粹是营造"对面坐着一个会说话的人"的氛围,林墨每走
// 完一步有几率(不是每次都换,不然太吵)换一句场面话。
const AMBIENT_LINE_KEYS = ["defense_trigger", "global_trigger"];
function pickAmbientLine() {
  const key = AMBIENT_LINE_KEYS[Math.floor(Math.random() * AMBIENT_LINE_KEYS.length)];
  return pickInGameLine(key);
}

// onFinish(result, quality): 对局真正分出胜负/和棋,揭晓动画播完之后调用,
// result 是 'win'|'lose'|'draw',quality 是这一局的过程表现分(0-1)——
// 上层(DailyTrialScreen)拿这两个值去调服务器结算,不在这个组件里直接碰
// 网络请求,棋盘逻辑和结算逻辑分开,便于以后加别的 NPC 时复用这个组件。
// 见面寒暄/邀请已经在进入这个组件之前的对话界面里说完了,这里开局只需要
// 一句轻量的"开始了"式台词,不需要外部传入。
export default function DailyTrialGameScreen({ playerRating, linmoRating, streak, gamesPlayed, onFinish, onAbort }) {
  useTelegramBackButton(() => handleExitClick());

  const [board, setBoard] = useState(createEmptyBoard());
  const [turn, setTurn] = useState(PLAYER_COLOR);
  const [lastMove, setLastMove] = useState(null);
  const [winInfo, setWinInfo] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [currentLine, setCurrentLine] = useState(() => pickInGameLine("game_start") || "你先来吧,我看看。");

  const moveLogRef = useRef(createMoveLog());
  const aiTimerRef = useRef(null);
  const revealTimerRef = useRef(null);
  const moveTokenRef = useRef(0);
  const finishedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      clearTimeout(revealTimerRef.current);
    };
  }, []);

  function applyMove(x, y, player, currentBoard) {
    const next = cloneBoard(currentBoard);
    next[y][x] = player;
    return next;
  }

  function finalize(result) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const quality = computeMatchQuality(moveLogRef.current);
    const delay = result === "draw" ? DRAW_REVEAL_DELAY : WIN_REVEAL_DELAY;
    setRevealing(true);
    revealTimerRef.current = setTimeout(() => {
      onFinish(result, quality);
    }, delay);
  }

  function performAiMove(currentBoard) {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    const token = ++moveTokenRef.current;
    setThinking(true);
    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      if (moveTokenRef.current !== token) return;

      const dial = computeSkillDial({
        playerRating, linmoRating, streak, gamesPlayed,
        board: currentBoard, aiColor: LINMO_COLOR, humanColor: PLAYER_COLOR,
      });
      const move = getAdaptiveMove(currentBoard, LINMO_COLOR, PLAYER_COLOR, dial);
      if (!move) {
        setThinking(false);
        finalize("draw");
        return;
      }

      const afterAi = applyMove(move.x, move.y, LINMO_COLOR, currentBoard);
      setBoard(afterAi);
      setLastMove([move.x, move.y]);
      setThinking(false);
      if (Math.random() < 0.5) {
        const line = pickAmbientLine();
        if (line) setCurrentLine(line);
      }

      const aiWin = checkWin(afterAi, move.x, move.y);
      if (aiWin) {
        setWinInfo(aiWin.line);
        hapticNotify("error");
        finalize("lose");
        return;
      }
      if (isBoardFull(afterAi)) {
        finalize("draw");
        return;
      }
      setTurn(PLAYER_COLOR);
    }, THINKING_DELAY);
  }

  function handleCellClick(x, y) {
    if (thinking || revealing || turn !== PLAYER_COLOR || finishedRef.current) return;

    const beforeBoard = board;
    recordPlayerMove(moveLogRef.current, beforeBoard, x, y, PLAYER_COLOR, LINMO_COLOR);
    const afterBoard = applyMove(x, y, PLAYER_COLOR, beforeBoard);
    setBoard(afterBoard);
    setLastMove([x, y]);

    const win = checkWin(afterBoard, x, y);
    if (win) {
      setWinInfo(win.line);
      hapticNotify("success");
      finalize("win");
      return;
    }
    if (isBoardFull(afterBoard)) {
      finalize("draw");
      return;
    }

    setTurn(LINMO_COLOR);
    performAiMove(afterBoard);
  }

  // 中途退出:体力已经在进入这一局之前扣掉了,不判负就退出等于"白扣
  // 体力还不影响连胜/评分",容易被当成"打不过就跑"的漏洞——所以中途
  // 退出按认输处理,给一个较低但非零的质量分(不是彻底摆烂,只是没
  // 下完)。
  async function handleExitClick() {
    if (finishedRef.current || revealing) return;
    const hasMoved = lastMove !== null;
    if (!hasMoved) {
      onAbort();
      return;
    }
    const confirmed = await confirmDialog("中途退出这局会按认输处理,确定吗?");
    if (!confirmed) return;
    if (finishedRef.current) return;
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    finishedRef.current = true;
    const quality = computeMatchQuality(moveLogRef.current);
    onFinish("lose", Math.min(quality, 0.4));
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

        <div className="room-topbar pve-topbar" style={isInTelegram ? { justifyContent: "flex-end" } : undefined}>
          {!isInTelegram && (
            <button className="room-icon-btn" onClick={handleExitClick} aria-label="返回">
              <IconChevronLeft />
            </button>
          )}
          <div className="pve-topbar-right">
            <div className="pve-turn-pill">
              {thinking ? (
                <><div className="spinner" /> 林墨思考中</>
              ) : revealing ? (
                <>{winInfo ? "五子连珠!" : "棋盘落满"}</>
              ) : (
                <>
                  <div className={`turn-dot black${turn === PLAYER_COLOR ? " active" : ""}`} />
                  <div className={`turn-dot white${turn === LINMO_COLOR ? " active" : ""}`} />
                  {turn === PLAYER_COLOR ? "轮到你" : "林墨回合"}
                </>
              )}
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
      </div>
    </div>
  );
}
