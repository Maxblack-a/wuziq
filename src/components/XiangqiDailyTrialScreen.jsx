import { useEffect, useRef, useState } from "react";
import XiangqiBoard from "./XiangqiBoard";
import { IconChevronLeft, IconBolt, IconGem, IconFlame } from "./Icons";
import { getDailyTrialStatus, startDailyTrial, finishDailyTrial } from "../lib/dailyTrial";
import { pickRandomNpc } from "../lib/npcRoster";
import {
  createInitialBoard, applyMove, legalMovesFrom, isInCheck, checkGameOver, positionKey, RED,
} from "../game/xiangqiLogic";
import {
  PLAYER_COLOR, NPC_COLOR, computeSkillDial, getAdaptiveMove, classifyMoveSituation,
  createMoveLog, recordPlayerMove, computeMatchQuality, getDisplayStamina, STAMINA_COST,
} from "../game/xiangqiDailyTrialEngine";
import { useTelegramBackButton, hapticNotify } from "../lib/telegram";

// 象棋版这里没有把 dailyDialogue.js 里那 300 多行五子棋专属台词照搬过来
// (棋型相关的措辞完全对不上象棋),先给每位棋手配一小组通用短句,按
// classifyMoveSituation 分类挑一句——分量比原版轻,但保证棋手说的话跟
// 棋盘上真实发生的事情对得上,不会牛头不对马嘴。以后想恢复到原版那种
// 台词密度,在这张表里按 npcId/situation 加句子就行,不需要动状态机。
const VOICE_LINES = {
  linmo: {
    attack: ["这一步,该我进攻了。", "看好了。"],
    danger: ["差一点。", "算你走对了这一手。"],
    neutral: ["嗯。", "继续。"],
  },
  suqing: {
    attack: ["找到破绽了。", "该收网了。"],
    danger: ["先稳住。", "不急,一步步来。"],
    neutral: ["再看看。", "棋还长。"],
  },
  xiaoqi: {
    attack: ["冲！", "接招～"],
    danger: ["哎呀,差点被将军了。", "好险好险。"],
    neutral: ["嘿嘿,想什么呢。", "轮到我啦。"],
  },
  shenzhiyuan: {
    attack: ["时机到了。", "该出手了。"],
    danger: ["无妨,能应对。", "早有准备。"],
    neutral: ["静观其变。", "不急。"],
  },
};
function pickVoiceLine(npcId, situation) {
  const bank = VOICE_LINES[npcId] || VOICE_LINES.linmo;
  const list = bank[situation] || bank.neutral;
  return list[Math.floor(Math.random() * list.length)];
}

export default function XiangqiDailyTrialScreen({ onExit, onExitHome }) {
  const [npc, setNpc] = useState(() => pickRandomNpc());
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [phase, setPhase] = useState("intro"); // intro | playing | result
  const [session, setSession] = useState(null); // { sessionId, rating, npcRating }
  const [board, setBoard] = useState(createInitialBoard());
  const [turn, setTurn] = useState(RED);
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [bubble, setBubble] = useState(null);
  const [gameOver, setGameOver] = useState(null);
  const [settling, setSettling] = useState(false);
  const [settlement, setSettlement] = useState(null);
  const [error, setError] = useState(null);

  const moveLogRef = useRef(createMoveLog());
  const moveCountRef = useRef(0);
  const startTimeRef = useRef(null);
  const aiTimerRef = useRef(null);
  const positionHistoryRef = useRef([]);
  const noCaptureRef = useRef(0);

  useTelegramBackButton(phase === "playing" ? () => {} : onExit);

  async function refreshStatus(npcId) {
    setLoadingStatus(true);
    try {
      const s = await getDailyTrialStatus(npcId);
      setStatus(s);
    } catch (e) {
      setError(e.message || "加载状态失败");
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => { refreshStatus(npc.id); }, [npc.id]);
  useEffect(() => () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); }, []);

  function handleReroll() {
    setNpc((cur) => pickRandomNpc(cur.id));
  }

  async function handleStart() {
    setError(null);
    try {
      const s = await startDailyTrial(npc.id);
      setSession(s);
      setStatus((prev) => ({ ...prev, stamina: s.stamina, diamonds: s.diamonds }));
      setBoard(createInitialBoard());
      setTurn(RED);
      setSelected(null);
      setLastMove(null);
      setGameOver(null);
      setSettlement(null);
      setBubble(null);
      moveLogRef.current = createMoveLog();
      moveCountRef.current = 0;
      positionHistoryRef.current = [];
      noCaptureRef.current = 0;
      startTimeRef.current = Date.now();
      setPhase("playing");
    } catch (e) {
      setError(e.message || "体力不足或加载失败");
    }
  }

  const legalTargets = selected ? legalMovesFrom(board, selected[0], selected[1]) : [];

  function doMove(from, to, isPlayerMove) {
    const wasCapture = board[to[1]][to[0]] !== 0;
    const next = applyMove(board, from, to);
    const nextTurn = -turn;
    if (isPlayerMove) {
      recordPlayerMove(moveLogRef.current, board, from, to, PLAYER_COLOR, NPC_COLOR);
    } else {
      const situation = classifyMoveSituation(board, { from, to }, NPC_COLOR, PLAYER_COLOR);
      setBubble(pickVoiceLine(npc.id, situation));
    }
    moveCountRef.current += 1;
    noCaptureRef.current = wasCapture ? 0 : noCaptureRef.current + 1;
    positionHistoryRef.current = [...positionHistoryRef.current, positionKey(next, nextTurn)];
    setBoard(next);
    setLastMove({ from, to });
    setSelected(null);
    setTurn(nextTurn);

    const over = checkGameOver(next, nextTurn, positionHistoryRef.current, noCaptureRef.current);
    if (over) {
      setGameOver(over);
      hapticNotify(over.winner === 0 ? "warning" : over.winner === PLAYER_COLOR ? "success" : "error");
    }
  }

  function handleBoardMove(from, to) {
    if (turn !== PLAYER_COLOR || gameOver || thinking) return;
    doMove(from, to, true);
  }

  // NPC 走子
  useEffect(() => {
    if (phase !== "playing" || gameOver) return;
    if (turn !== NPC_COLOR) return;
    setThinking(true);
    aiTimerRef.current = setTimeout(() => {
      const dial = computeSkillDial({
        playerRating: session.rating,
        npcRating: session.npcRating,
        streak: status?.streak ?? 0,
        board,
        gamesPlayed: status?.gamesPlayed ?? Infinity,
        npcId: npc.id,
      });
      const move = getAdaptiveMove(board, NPC_COLOR, PLAYER_COLOR, dial, npc.id);
      setThinking(false);
      if (!move) return;
      doMove(move.from, move.to, false);
    }, 450 + Math.random() * 350);
    return () => clearTimeout(aiTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, phase, gameOver]);

  // 结算
  useEffect(() => {
    if (!gameOver || settling || settlement) return;
    (async () => {
      setSettling(true);
      const result = gameOver.winner === 0 ? "draw" : gameOver.winner === PLAYER_COLOR ? "win" : "lose";
      const quality = computeMatchQuality(moveLogRef.current);
      const durationSec = startTimeRef.current ? Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000)) : undefined;
      try {
        const r = await finishDailyTrial(session.sessionId, npc.id, result, quality, moveCountRef.current, durationSec);
        setSettlement(r);
        setStatus((prev) => ({ ...prev, ...r }));
      } catch (e) {
        setError(e.message || "结算失败");
      } finally {
        setSettling(false);
        setPhase("result");
      }
    })();
  }, [gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkColor = gameOver ? null : (isInCheck(board, turn) ? turn : null);

  if (phase === "intro") {
    return (
      <div className="app-shell">
        <div className="screen-header">
          <button className="nav-icon-btn" onClick={onExit}><IconChevronLeft /></button>
          <div className="screen-title">每日试炼</div>
          <div style={{ width: 40 }} />
        </div>
        <div style={{ padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="panel" style={{ textAlign: "center", padding: "var(--space-6)" }}>
            <img src={npc.portrait} alt={npc.name} style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover", margin: "0 auto var(--space-3)" }} />
            <div style={{ fontSize: "var(--text-heading)", fontWeight: 700 }}>{npc.name}</div>
            {!loadingStatus && status && (
              <div className="muted" style={{ marginTop: "var(--space-2)", fontSize: 13 }}>
                你的隐藏分 {status.rating} · 连胜 {status.streak > 0 ? status.streak : 0}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-4)" }}>
            <span className="pve-turn-pill"><IconBolt size={14} /> {getDisplayStamina(status?.stamina, status?.staminaDate)}/{20}</span>
            <span className="pve-turn-pill"><IconGem size={14} /> {status?.diamonds ?? 0}</span>
            {status?.streak > 0 && <span className="pve-turn-pill"><IconFlame size={14} /> {status.streak}连胜</span>}
          </div>

          {error && <div style={{ color: "var(--seal-red)", textAlign: "center", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <button className="secondary-card" style={{ flex: 1 }} onClick={handleReroll}>换一位</button>
            <button className="cta-primary" style={{ flex: 2 }} onClick={handleStart} disabled={loadingStatus || (status && status.stamina < STAMINA_COST)}>
              {status && status.stamina < STAMINA_COST ? "体力不足" : `挑战 (消耗${STAMINA_COST}体力)`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "result") {
    const won = gameOver?.winner === PLAYER_COLOR;
    const drawn = gameOver?.winner === 0;
    const drawReasonText = gameOver?.reason === "repetition" ? "局面三次重复" : gameOver?.reason === "sixty_move" ? "60回合无吃子" : "和棋";
    return (
      <div className="app-shell" style={{ textAlign: "center", padding: "var(--space-8) var(--space-6)" }}>
        <div style={{ fontSize: "var(--text-title)", fontWeight: 700, marginBottom: "var(--space-2)" }}>
          {drawn ? "和棋" : won ? "挑战成功！" : "惜败"}
        </div>
        <p className="muted" style={{ marginBottom: "var(--space-4)" }}>
          {drawn ? `跟 ${npc.name} 打成了和棋(${drawReasonText})。` : won ? `将死了 ${npc.name}，漂亮！` : `被 ${npc.name} 将死了，再来一局。`}
        </p>
        {settlement ? (
          <div className="panel" style={{ marginBottom: "var(--space-6)", padding: "var(--space-4)" }}>
            <div>隐藏分 {settlement.rating} · 连胜 {settlement.streak > 0 ? settlement.streak : 0}</div>
            <div className="muted" style={{ marginTop: "var(--space-2)" }}>
              +{settlement.exp ?? 0} 经验{won ? " · +1 钻石" : ""}
            </div>
          </div>
        ) : (
          <div className="spinner" style={{ margin: "0 auto var(--space-6)" }} />
        )}
        <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
          <button className="cta-primary" onClick={() => { refreshStatus(npc.id); setPhase("intro"); }}>再挑战一次</button>
          <button className="secondary-card" onClick={onExitHome}>返回首页</button>
        </div>
      </div>
    );
  }

  // phase === "playing"
  return (
    <div className="app-shell">
      <div className="screen-header">
        <div style={{ width: 40 }} />
        <div className="screen-title">{npc.name} · 每日试炼</div>
        <div style={{ width: 40 }} />
      </div>

      <div className="xq-status-bar">
        <div className="xq-turn-badge">
          <span className={`xq-turn-dot ${turn === RED ? "xq-red" : "xq-black"}`} />
          {gameOver ? "对局结束" : thinking ? `${npc.name}思考中…` : "轮到你"}
        </div>
        {checkColor && !gameOver && <div style={{ color: "var(--seal-red)", fontWeight: 700 }}>将军！</div>}
      </div>

      {bubble && !gameOver && (
        <div style={{ textAlign: "center", padding: "0 var(--space-6) var(--space-2)", color: "var(--text-secondary)", fontSize: 13 }}>
          “{bubble}”
        </div>
      )}

      <XiangqiBoard
        board={board}
        onMove={handleBoardMove}
        selected={selected}
        onSelectChange={setSelected}
        legalTargets={turn === PLAYER_COLOR ? legalTargets : []}
        lastMove={lastMove}
        checkColor={checkColor}
        disabled={turn !== PLAYER_COLOR}
        locked={!!gameOver}
      />

      {gameOver && settling && (
        <div style={{ textAlign: "center", padding: "var(--space-6)" }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
          <p className="muted" style={{ marginTop: "var(--space-2)" }}>结算中…</p>
        </div>
      )}
    </div>
  );
}
