import { useEffect, useState, useRef, useCallback } from "react";
import XiangqiBoard from "./XiangqiBoard";
import { supabase, getStoredSessionId, sendHeartbeat } from "../lib/supabase";
import {
  createInitialBoard, cloneBoard, applyMove, legalMovesFrom, isInCheck, RED, BLACK,
} from "../game/xiangqiLogic";
import { moveToChineseNotation } from "../game/chineseNotation";
import { levelForExp } from "../lib/rank";
import { hapticNotify, useTelegramBackButton, setClosingConfirmation } from "../lib/telegram";
import { IconUndo, IconFlag, IconHandshake, IconChevronLeft, IconSettings } from "./Icons";
import RulesModal from "./RulesModal";

const HEARTBEAT_INTERVAL_MS = 8000;
const DISCONNECT_GRACE_MS = 20000;
const TURN_SECONDS = 60; // 跟 xiangqi_online.sql 里 make_move/start_match 写入的 60 秒回合时限保持一致

function resultDesc(outcome, reason, endKind) {
  if (reason === "forfeit") return outcome === "win" ? "对方中途认输离开了。" : "你已选择认输离开。";
  if (reason === "disconnect") return outcome === "win" ? "对方长时间掉线,判你获胜。" : "你掉线太久,被判负了。";
  if (endKind === "stalemate") return outcome === "win" ? "对方无子可走,困毙告负。" : "你已无子可走,困毙告负。";
  if (outcome === "win") return "将死对方,漂亮的一局。";
  if (outcome === "lose") return "被将死了,再来一局找回来。";
  return "对局结束。";
}

// 9x10 象棋的 flat 下标是 y*9+x(区别于五子棋的 y*15+x),棋盘更小,
// diff 出"到底是哪一步"用同样的思路,只是换一下宽度常量
function flatToBoard2D(flat) {
  if (!flat || flat.length === 0) return createInitialBoard();
  const b = Array.from({ length: 10 }, () => Array(9).fill(0));
  flat.forEach((v, i) => { b[Math.floor(i / 9)][i % 9] = v; });
  return b;
}

export default function XiangqiOnlineGame({ roomId, myId, avatarUrl, myExp, onExit, onMatched }) {
  const [room, setRoom] = useState(null);
  const [opponentName, setOpponentName] = useState("对手");
  const [opponentExp, setOpponentExp] = useState(null);
  const [lastMove, setLastMove] = useState(null); // { from:[x,y], to:[x,y] }
  const [lastMoveNotation, setLastMoveNotation] = useState(null); // "炮二平五" 这种记法字符串
  const [expInfo, setExpInfo] = useState(null);
  const [pendingMove, setPendingMove] = useState(null); // { board, turnAfter, moveCountAfter }
  const [disconnectSince, setDisconnectSince] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [resignConfirmOpen, setResignConfirmOpen] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [requestingUndo, setRequestingUndo] = useState(false);
  const [respondingUndo, setRespondingUndo] = useState(false);
  const [requestingDraw, setRequestingDraw] = useState(false);
  const [respondingDraw, setRespondingDraw] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [returningToRoom, setReturningToRoom] = useState(false);
  const [selected, setSelected] = useState(null);
  const [endKind, setEndKind] = useState(null); // 'checkmate' | 'stalemate' | null,来自 make_move 返回值

  const channelRef = useRef(null);
  const lastBoardFlatRef = useRef(null);
  const lobbyResetRef = useRef(false);
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;
  const gameStartRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setRoom(null);
    setLastMove(null);
    setLastMoveNotation(null);
    setExpInfo(null);
    setOpponentExp(null);
    setPendingMove(null);
    setDisconnectSince(null);
    setOpponentName("对手");
    setSelected(null);
    setEndKind(null);
    lastBoardFlatRef.current = null;
    lobbyResetRef.current = false;
    gameStartRef.current = null;

    async function load() {
      const { data } = await supabase.from("rooms").select("*").eq("id", roomId).single();
      if (cancelled) return;
      lastBoardFlatRef.current = data?.board || null;
      setRoom(data);
    }
    load();

    const channel = supabase.channel(`room-${roomId}`, { config: { presence: { key: myId } } });
    channel
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const newFlat = payload.new.board;
          const oldFlat = lastBoardFlatRef.current;
          if (oldFlat && newFlat && oldFlat.length === newFlat.length) {
            let from = null, to = null;
            for (let i = 0; i < newFlat.length; i++) {
              if (newFlat[i] === oldFlat[i]) continue;
              if (oldFlat[i] !== 0 && newFlat[i] === 0) from = [i % 9, Math.floor(i / 9)];
              if (newFlat[i] !== 0) to = [i % 9, Math.floor(i / 9)];
            }
            if (from && to) {
              setLastMove({ from, to });
              setLastMoveNotation(moveToChineseNotation(flatToBoard2D(oldFlat), from, to));
            }
          }
          lastBoardFlatRef.current = newFlat;
          setRoom(payload.new);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "rooms", filter: `rematch_of=eq.${roomId}` },
        (payload) => onMatchedRef.current(payload.new.id)
      )
      .on("presence", { event: "leave" }, ({ key }) => { if (key !== myId) setDisconnectSince(Date.now()); })
      .on("presence", { event: "join" }, ({ key }) => { if (key !== myId) setDisconnectSince(null); })
      .subscribe(async (status) => { if (status === "SUBSCRIBED") await channel.track({ online: true }); });

    channelRef.current = channel;
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [roomId, myId]);

  useEffect(() => {
    if (!room || room.status !== "playing") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [room?.status, room?.move_count]);

  useEffect(() => {
    if (room?.status !== "playing") return;
    sendHeartbeat(roomId);
    const timer = setInterval(() => sendHeartbeat(roomId), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [room?.status, roomId]);

  useEffect(() => {
    if (!room || !pendingMove) return;
    if (room.move_count >= pendingMove.moveCountAfter) setPendingMove(null);
  }, [room, pendingMove]);

  useEffect(() => {
    if (!room) return;
    const opponentId = room.player1_id === myId ? room.player2_id : room.player1_id;
    if (!opponentId) return;
    supabase.from("profiles_public").select("display_name, exp").eq("id", opponentId).single()
      .then(({ data }) => {
        if (!data) return;
        setOpponentName(data.display_name || "对手");
        setOpponentExp(data.exp ?? 0);
      });
  }, [room, myId]);

  useEffect(() => {
    if (room?.status === "playing" && gameStartRef.current === null) gameStartRef.current = Date.now();
  }, [room?.status]);

  useEffect(() => {
    if (!room || room.status !== "finished" || expInfo !== null) return;
    supabase.from("match_history").select("*").eq("room_id", roomId)
      .order("created_at", { ascending: false }).limit(1).single()
      .then(({ data }) => {
        if (!data) return;
        const mySlot = room.player1_id === myId ? 1 : 2;
        const before = mySlot === 1 ? data.player1_exp_before : data.player2_exp_before;
        const after = mySlot === 1 ? data.player1_exp_after : data.player2_exp_after;
        setExpInfo({ before, after, delta: after - before });
      });
  }, [room, roomId, myId, expInfo]);

  const lobbyResetEffectRef = useRef(false);
  useEffect(() => {
    if (!room) return;
    if (room.status === "lobby" && !lobbyResetRef.current) {
      lobbyResetRef.current = true;
      setLastMove(null); setLastMoveNotation(null); setExpInfo(null); setEndKind(null);
      gameStartRef.current = null;
    }
    if (room.status !== "lobby") lobbyResetRef.current = false;
  }, [room]);

  const handleBackAction = useCallback(() => {
    if (room?.status === "playing") setResignConfirmOpen(true);
    else onExit();
  }, [room, onExit]);
  useTelegramBackButton(handleBackAction);

  const autoForfeitTriggeredRef = useRef(false);
  useEffect(() => {
    if (!disconnectSince) { autoForfeitTriggeredRef.current = false; return; }
    if (!room || room.status !== "playing") return;
    if (autoForfeitTriggeredRef.current) return;
    const remaining = DISCONNECT_GRACE_MS - (now - disconnectSince);
    if (remaining > 0) return;
    autoForfeitTriggeredRef.current = true;
    claimForfeitWin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, disconnectSince, now]);

  useEffect(() => {
    setClosingConfirmation(room?.status === "playing");
    return () => setClosingConfirmation(false);
  }, [room?.status]);

  useEffect(() => {
    if (room?.status !== "playing") return;
    function handleBeforeUnload(e) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [room?.status]);

  if (!room) {
    return (
      <div style={{ textAlign: "center", padding: 60 }}>
        <div className="spinner" style={{ margin: "0 auto" }} />
        <p className="muted" style={{ marginTop: 16 }}>加载对局中…</p>
      </div>
    );
  }

  const mySlot = room.player1_id === myId ? 1 : 2;
  const myColor = mySlot === 1 ? RED : BLACK;
  const graceRemaining = disconnectSince ? Math.max(0, DISCONNECT_GRACE_MS - (now - disconnectSince)) : 0;

  if (room.status === "lobby") {
    return (
      <div>
        <button className="btn-ghost" onClick={onExit}>← 返回</button>
        <div className="menu-header"><h2>象棋对局大厅</h2></div>
        {disconnectSince && (
          <div className="panel" style={{ textAlign: "center", marginBottom: "var(--space-4)" }}>
            {graceRemaining > 0 ? (
              <p className="muted">对方似乎断开了连接,{Math.ceil(graceRemaining / 1000)} 秒后可以确认</p>
            ) : (
              <>
                <p className="muted" style={{ marginBottom: "var(--space-2)" }}>对方已经离开了房间</p>
                <button className="btn-ghost" style={{ width: "100%" }} onClick={onExit}>返回菜单</button>
              </>
            )}
          </div>
        )}
        <div className="panel" style={{ textAlign: "center", marginBottom: "var(--space-4)" }}>
          <p className="text-body">
            你<span className="mono">({mySlot === 1 ? "红" : "黑"})</span> VS {opponentName}<span className="mono">({mySlot === 1 ? "黑" : "红"})</span>
          </p>
          <p className="muted" style={{ fontSize: 13, marginTop: "var(--space-2)" }}>
            双方都已经在房间里了{mySlot === 1 ? ",随时可以开始" : ",等房主开始"}
          </p>
        </div>
        {mySlot === 1 ? (
          <button className="btn-primary" style={{ width: "100%" }} onClick={startMatch} disabled={!!disconnectSince}>开始对局</button>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto 12px" }} />
            <p className="muted">等待房主开始对局…</p>
          </div>
        )}
      </div>
    );
  }

  const board2D = pendingMove ? pendingMove.board : flatToBoard2D(room.board);
  const effectiveTurnSlot = pendingMove ? pendingMove.turnAfter : room.current_turn;
  const isMyTurn = effectiveTurnSlot === mySlot && room.status === "playing" && !pendingMove;
  const effectiveTurnColor = effectiveTurnSlot === 1 ? RED : BLACK;

  const incomingUndo = room.status === "playing" && room.undo_requested_by && room.undo_requested_by !== myId;
  const myUndoPending = room.undo_requested_by === myId;
  const canRequestUndo = room.status === "playing" && !room.undo_requested_by && !room.draw_requested_by && !!room.board_before_last_move && !pendingMove;

  const incomingDraw = room.status === "playing" && room.draw_requested_by && room.draw_requested_by !== myId;
  const myDrawPending = room.draw_requested_by === myId;
  const canRequestDraw = room.status === "playing" && !room.draw_requested_by && !room.undo_requested_by && !pendingMove;

  const turnDeadline = room.status === "playing" && room.turn_deadline ? new Date(room.turn_deadline).getTime() : null;
  const turnSecondsLeft = turnDeadline ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : TURN_SECONDS;
  const turnUrgent = turnSecondsLeft <= 15;

  function isSessionSupersededError(error) { return !!error && /SESSION_SUPERSEDED/i.test(error.message || ""); }
  function handleSessionSuperseded() { window.location.reload(); }

  async function startMatch() {
    await supabase.rpc("start_match", { p_room_id: roomId });
  }

  async function handleBoardMove(from, to) {
    if (!isMyTurn || room.undo_requested_by || room.draw_requested_by) { hapticNotify("warning"); return; }
    const piece = board2D[from[1]][from[0]];
    const next = cloneBoard(board2D);
    next[to[1]][to[0]] = piece;
    next[from[1]][from[0]] = 0;
    const nextSlot = mySlot === 1 ? 2 : 1;

    setLastMove({ from, to });
    setLastMoveNotation(moveToChineseNotation(board2D, from, to));
    setSelected(null);
    setPendingMove({ board: next, turnAfter: nextSlot, moveCountAfter: room.move_count + 1 });

    const { data, error } = await supabase.rpc("make_move", {
      p_room_id: roomId, p_fx: from[0], p_fy: from[1], p_tx: to[0], p_ty: to[1],
      p_session_id: getStoredSessionId(),
    });

    if (error || data?.error) {
      setPendingMove(null);
      setLastMove(null);
      hapticNotify("error");
      if (isSessionSupersededError(error)) handleSessionSuperseded();
      return;
    }

    if (data.game_status === "finished") {
      if (data.winner === mySlot) hapticNotify("success");
      setEndKind(data.end_kind || null);
      const fd = data.settlement;
      if (fd && !fd.already_finished) {
        const delta = mySlot === 1 ? fd.my1_delta : fd.my2_delta;
        const after = mySlot === 1 ? fd.p1_new : fd.p2_new;
        setExpInfo({ before: after - delta, after, delta });
      }
    } else if (data.in_check) {
      hapticNotify("warning");
    }
  }

  async function claimForfeitWin() {
    const { data } = await supabase.rpc("finish_match", {
      p_room_id: roomId, p_winner: mySlot, p_reason: "disconnect", p_session_id: getStoredSessionId(),
    });
    if (data && !data.already_finished) {
      const delta = mySlot === 1 ? data.my1_delta : data.my2_delta;
      const after = mySlot === 1 ? data.p1_new : data.p2_new;
      setExpInfo({ before: after - delta, after, delta });
    }
  }

  async function confirmResign() {
    setResigning(true);
    const oppSlot = mySlot === 1 ? 2 : 1;
    const { data, error } = await supabase.rpc("finish_match", {
      p_room_id: roomId, p_winner: oppSlot, p_reason: "forfeit", p_session_id: getStoredSessionId(),
    });
    setResigning(false);
    if (isSessionSupersededError(error)) { handleSessionSuperseded(); return; }
    if (error || data?.error) { hapticNotify("error"); return; }
    setResignConfirmOpen(false);
    if (data && !data.already_finished) {
      const delta = mySlot === 1 ? data.my1_delta : data.my2_delta;
      const after = mySlot === 1 ? data.p1_new : data.p2_new;
      setExpInfo({ before: after - delta, after, delta });
    }
    setRoom((r) => (r ? { ...r, status: "finished", winner: oppSlot, end_reason: "forfeit" } : r));
  }

  async function handleRequestUndo() {
    setRequestingUndo(true);
    await supabase.rpc("request_undo", { p_room_id: roomId });
    setRequestingUndo(false);
  }
  async function handleRespondUndo(accept) {
    setRespondingUndo(true);
    await supabase.rpc("respond_undo", { p_room_id: roomId, p_accept: accept });
    setRespondingUndo(false);
  }
  async function handleRequestDraw() {
    setRequestingDraw(true);
    await supabase.rpc("request_draw", { p_room_id: roomId });
    setRequestingDraw(false);
  }
  async function handleRespondDraw(accept) {
    setRespondingDraw(true);
    // 同意的那一刻服务端会直接结算(和棋),棋盘状态跟经验值变化都会通过
    // 下面 room.status==='finished' 那个通用 effect 从 match_history 里
    // 拿到,这里不用重复处理——跟 handleRespondUndo 保持同一套"只管
    // 发请求,结果交给订阅"的写法。
    await supabase.rpc("respond_draw", { p_room_id: roomId, p_accept: accept });
    setRespondingDraw(false);
  }
  async function handleReturnToRoom() {
    setReturningToRoom(true);
    await supabase.rpc("return_to_room", { p_room_id: roomId });
    setReturningToRoom(false);
    onMatched(roomId);
  }

  const checkColor = room.status === "playing" && !pendingMove && isInCheck(board2D, effectiveTurnColor) ? effectiveTurnColor : null;
  const boardLocked = !!result || !!room.undo_requested_by || !!room.draw_requested_by;
  const legalTargets = selected && isMyTurn ? legalMovesFrom(board2D, selected[0], selected[1]) : [];

  let result = null;
  if (room.status === "finished" && !pendingMove) {
    if (room.winner === 0) result = { outcome: "draw", reason: room.end_reason };
    else result = { outcome: room.winner === mySlot ? "win" : "lose", reason: room.end_reason };
  }

  if (result) {
    const durationSec = room.started_at
      ? Math.max(1, Math.round((Date.now() - new Date(room.started_at).getTime()) / 1000))
      : gameStartRef.current ? Math.max(1, Math.round((Date.now() - gameStartRef.current) / 1000)) : 0;
    return (
      <div className="app-shell" style={{ textAlign: "center", padding: "var(--space-8) var(--space-6)" }}>
        <div style={{ fontSize: "var(--text-title)", fontWeight: 700, marginBottom: "var(--space-2)" }}>
          {result.outcome === "win" ? "你赢了！" : result.outcome === "lose" ? "你输了" : "和棋"}
        </div>
        <p className="muted" style={{ marginBottom: "var(--space-4)" }}>{resultDesc(result.outcome, result.reason, endKind)}</p>
        {expInfo ? (
          <p className="text-body" style={{ marginBottom: "var(--space-6)" }}>
            经验值 {expInfo.before} → {expInfo.after}（{expInfo.delta >= 0 ? "+" : ""}{expInfo.delta}） · 用时 {durationSec}秒
          </p>
        ) : (
          <div className="spinner" style={{ margin: "0 auto var(--space-6)" }} />
        )}
        <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
          <button className="btn-primary" onClick={handleReturnToRoom} disabled={returningToRoom}>
            {returningToRoom ? "处理中…" : "再来一局"}
          </button>
          <button className="btn-ghost" onClick={onExit}>返回菜单</button>
        </div>
      </div>
    );
  }

  const myLevel = levelForExp(myExp);
  const opponentLevel = levelForExp(opponentExp);
  const myTimerPct = isMyTurn ? (turnSecondsLeft / TURN_SECONDS) * 100 : 100;
  const oppTimerPct = !isMyTurn && room.status === "playing" ? (turnSecondsLeft / TURN_SECONDS) * 100 : 100;

  return (
    <div>
      <div className="game-layout">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2) 0" }}>
          <button className="nav-icon-btn" onClick={handleBackAction}><IconChevronLeft /></button>
          <span style={{ fontSize: 13, color: "var(--text-secondary)", letterSpacing: "0.15em" }}>
            · {room.status === "playing" ? "对局中" : "对局"} ·
          </span>
          <button className="nav-icon-btn" onClick={() => setRulesOpen(true)}><IconSettings /></button>
        </div>

        {/* 对手状态行:黑点/红点 + 昵称 + 等级徽章 + 计时(带进度条),
            布局照抄参考图里"● 对手 Lv.18 [币]1250  02:38"那一整行,
            只是把"[币]1250"换成了这个项目本来就有的经验值。 */}
        <div className="xq-player-row">
          <div className="xq-player-identity">
            <span className={`xq-player-dot ${mySlot === 1 ? "xq-black" : "xq-red"}`} />
            <span className="xq-player-name">{opponentName}</span>
            <span className="xq-player-level">Lv.{opponentLevel}</span>
          </div>
          <div className="xq-player-timer-col">
            <span className={`xq-player-timer-count${!isMyTurn && turnUrgent ? " xq-urgent" : ""}`}>
              {room.status === "playing" && !isMyTurn ? `${turnSecondsLeft}s` : "--"}
            </span>
            <div className="xq-player-timer-track">
              <div
                className="xq-player-timer-fill"
                style={{
                  width: `${!isMyTurn ? oppTimerPct : 100}%`,
                  background: mySlot === 1
                    ? "linear-gradient(90deg, #3a3a3a, #171717)"
                    : "linear-gradient(90deg, #C24A3C, #A13A2E)",
                }}
              />
            </div>
          </div>
        </div>

        {lastMoveNotation && (
          <div className="xq-last-move-pill">
            <span className="xq-last-move-pill-label">最近走子</span>
            <span className="xq-last-move-pill-value">{lastMoveNotation}</span>
          </div>
        )}

        <div className="game-board-col">
          <XiangqiBoard
            board={board2D}
            onMove={handleBoardMove}
            selected={selected}
            onSelectChange={setSelected}
            legalTargets={legalTargets}
            lastMove={lastMove}
            checkColor={checkColor}
            disabled={!isMyTurn}
            locked={boardLocked}
            onIllegalTap={() => hapticNotify("warning")}
          />
        </div>

        {/* 我方状态行,跟上面对手那行结构一样,只是颜色跟计时方向相反 */}
        <div className="xq-player-row">
          <div className="xq-player-identity">
            <span className={`xq-player-dot ${mySlot === 1 ? "xq-red" : "xq-black"}`} />
            <span className="xq-player-name">我方</span>
            <span className="xq-player-level">Lv.{myLevel}</span>
          </div>
          <div className="xq-player-timer-col">
            <span className={`xq-player-timer-count${isMyTurn && turnUrgent ? " xq-urgent" : ""}`}>
              {room.status === "playing" && isMyTurn ? `${turnSecondsLeft}s` : "--"}
            </span>
            <div className="xq-player-timer-track">
              <div className="xq-player-timer-fill xq-green" style={{ width: `${isMyTurn ? myTimerPct : 100}%` }} />
            </div>
          </div>
        </div>

        {checkColor && room.status === "playing" && (
          <p style={{ textAlign: "center", color: "var(--seal-red)", fontWeight: 700, margin: "2px 0 0" }}>将军！</p>
        )}

        {disconnectSince && room.status === "playing" && (
          <div className="panel" style={{ textAlign: "center" }}>
            {graceRemaining > 0 ? (
              <p className="muted">对方似乎断线了,{Math.ceil(graceRemaining / 1000)} 秒后自动判负</p>
            ) : (
              <p className="muted" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                对方长时间未响应,正在为你判定获胜…
              </p>
            )}
          </div>
        )}

        {room.status === "playing" && (
          <div className="xq-action-bar">
            <button className="xq-action-btn xq-danger" onClick={() => setResignConfirmOpen(true)}>
              <IconFlag size={16} /> 认输
            </button>
            <button
              className="xq-action-btn"
              onClick={myDrawPending ? undefined : () => handleRequestDraw()}
              disabled={!canRequestDraw || requestingDraw || myDrawPending}
            >
              <IconHandshake size={16} /> {myDrawPending ? "等待回应…" : "提和"}
            </button>
            <button
              className="xq-action-btn"
              onClick={myUndoPending ? undefined : handleRequestUndo}
              disabled={!canRequestUndo || requestingUndo || myUndoPending}
            >
              <IconUndo size={16} /> {myUndoPending ? "等待回应…" : "悔棋"}
            </button>
          </div>
        )}
      </div>

      {resignConfirmOpen && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ textAlign: "center" }}>
            <h2 className="text-heading">确定要认输吗?</h2>
            <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>确认后对方将直接获胜,这局无法恢复。</p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setResignConfirmOpen(false)} disabled={resigning}>取消</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={confirmResign} disabled={resigning}>{resigning ? "处理中…" : "确认认输"}</button>
            </div>
          </div>
        </div>
      )}

      {incomingUndo && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ textAlign: "center" }}>
            <h2 className="text-heading">{opponentName} 请求悔棋</h2>
            <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>同意的话,棋盘会退回到对方那一步落子之前。</p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => handleRespondUndo(false)} disabled={respondingUndo}>拒绝</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleRespondUndo(true)} disabled={respondingUndo}>同意</button>
            </div>
          </div>
        </div>
      )}

      {incomingDraw && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ textAlign: "center" }}>
            <h2 className="text-heading">{opponentName} 提议和棋</h2>
            <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>同意的话,这局立刻结束,双方各记一次和棋。</p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => handleRespondDraw(false)} disabled={respondingDraw}>拒绝</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleRespondDraw(true)} disabled={respondingDraw}>同意</button>
            </div>
          </div>
        </div>
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
