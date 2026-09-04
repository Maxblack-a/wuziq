import { useEffect, useRef, useState } from "react";
import XiangqiBoard from "./XiangqiBoard";
import {
  createTestState, recordPlayerMove, getTestAiMove, recordAiMove, checkTestOver,
  computeXiangqiSkillProfile, PLAYER_COLOR, AI_COLOR,
} from "../game/xiangqiSkillProfile";
import { legalMovesFrom, isInCheck, RED } from "../game/xiangqiLogic";
import { moveToChineseNotation } from "../game/chineseNotation";
import { supabase } from "../lib/supabase";
import { hapticNotify } from "../lib/telegram";

const THINKING_DELAY = 500; // 跟五子棋版 SkillTestScreen 一样固定思考延迟,不用来演强弱,只是给点节奏感
const WIN_REVEAL_DELAY = 1000;
const DRAW_REVEAL_DELAY = 400;

// 契约跟五子棋版 SkillTestScreen.jsx 完全一致:这个组件只管"跑完一局
// 棋、算出画像",真正的写库(submit_skill_test_result)和结果揭晓页路由
// 统一交给 App.jsx 的 handleSkillTestFinish 做——不要在这里自己调 RPC,
// 那样会跟 App.jsx 已有的"查历史 -> 写结果 -> 同步本地 profile -> 跳
// 揭晓页"这一整套流程重复冲突。
// onFinish(profile, testState, reason, sessionId) / onAbort() 签名照抄。
export default function XiangqiSkillTestScreen({ onFinish, onAbort }) {
  const [state, setState] = useState(() => createTestState());
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [lastMoveNotation, setLastMoveNotation] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const sessionIdRef = useRef(null);
  const aiTimerRef = useRef(null);
  const revealTimerRef = useRef(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    supabase.rpc("start_skill_test").then(({ data, error }) => {
      if (error) { console.error("创建棋力测试 session 失败", error); return; }
      sessionIdRef.current = data;
    });
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
      clearTimeout(revealTimerRef.current);
    };
  }, []);

  const legalTargets = selected ? legalMovesFrom(state.board, selected[0], selected[1]) : [];
  const checkColor = isInCheck(state.board, state.turn) ? state.turn : null;

  function finalize(finalState, reason, outcome) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const profile = computeXiangqiSkillProfile(finalState.moves);
    const proceed = () => onFinish(profile, finalState, reason, sessionIdRef.current);
    setRevealing(true);
    revealTimerRef.current = setTimeout(proceed, outcome === "draw" ? DRAW_REVEAL_DELAY : WIN_REVEAL_DELAY);
  }

  function runAiTurn(afterPlayerState) {
    setThinking(true);
    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      const move = getTestAiMove(afterPlayerState);
      if (!move) {
        setThinking(false);
        finalize(afterPlayerState, "no_ai_move", "draw");
        return;
      }
      const next = { ...afterPlayerState };
      const notation = moveToChineseNotation(next.board, move.from, move.to);
      recordAiMove(next, move);
      setLastMove({ from: move.from, to: move.to });
      setLastMoveNotation(notation);
      setThinking(false);

      const over = checkTestOver(next);
      if (over) {
        setState(next);
        const outcome = over.winner === PLAYER_COLOR ? "win" : over.winner === AI_COLOR ? "lose" : "draw";
        hapticNotify(outcome === "win" ? "success" : outcome === "lose" ? "error" : "warning");
        finalize(next, over.reason, outcome);
        return;
      }
      setState(next);
    }, THINKING_DELAY);
  }

  function handleBoardMove(from, to) {
    if (thinking || revealing || state.turn !== PLAYER_COLOR) return;
    const next = { ...state };
    const notation = moveToChineseNotation(next.board, from, to);
    recordPlayerMove(next, from, to);
    setSelected(null);
    setLastMove({ from, to });
    setLastMoveNotation(notation);

    const over = checkTestOver(next);
    if (over) {
      setState(next);
      const outcome = over.winner === PLAYER_COLOR ? "win" : over.winner === AI_COLOR ? "lose" : "draw";
      hapticNotify(outcome === "win" ? "success" : "warning");
      finalize(next, over.reason, outcome);
      return;
    }
    setState(next);
    runAiTurn(next);
  }

  return (
    <div className="app-shell">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-2) 0" }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)", letterSpacing: "0.15em" }}>· 棋力测试 ·</span>
      </div>

      <div className="xq-player-row">
        <div className="xq-player-identity">
          <span className={`xq-player-dot ${AI_COLOR === RED ? "xq-red" : "xq-black"}`} />
          <span className="xq-player-name">测试对手</span>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {!revealing && state.turn === AI_COLOR ? (thinking ? "思考中…" : "回合中") : ""}
        </span>
      </div>

      {lastMoveNotation && (
        <div className="xq-last-move-pill">
          <span className="xq-last-move-pill-label">最近走子</span>
          <span className="xq-last-move-pill-value">{lastMoveNotation}</span>
        </div>
      )}

      <XiangqiBoard
        board={state.board}
        onMove={handleBoardMove}
        selected={selected}
        onSelectChange={setSelected}
        legalTargets={state.turn === PLAYER_COLOR ? legalTargets : []}
        lastMove={lastMove}
        checkColor={checkColor}
        disabled={state.turn !== PLAYER_COLOR}
        locked={revealing}
      />

      <div className="xq-player-row">
        <div className="xq-player-identity">
          <span className={`xq-player-dot ${PLAYER_COLOR === RED ? "xq-red" : "xq-black"}`} />
          <span className="xq-player-name">我方</span>
        </div>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {!revealing && state.turn === PLAYER_COLOR ? "轮到你" : ""}
        </span>
      </div>

      {checkColor && !revealing && (
        <p style={{ textAlign: "center", color: "var(--seal-red)", fontWeight: 700, margin: "2px 0 0" }}>将军！</p>
      )}

      <p className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: "var(--space-3)" }}>
        正常下完这一局,系统会根据你的实际走法生成六维画像 —— 不是问卷,下棋就是测试。
      </p>
      {onAbort && (
        <button className="btn-ghost" style={{ display: "block", margin: "var(--space-4) auto 0" }} onClick={onAbort} disabled={revealing}>
          先不测了
        </button>
      )}
    </div>
  );
}
