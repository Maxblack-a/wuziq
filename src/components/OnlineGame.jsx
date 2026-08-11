import { useEffect, useState, useRef, useCallback } from "react";
import Board from "./Board";
import { supabase } from "../lib/supabase";
import { toBoard2D, checkWin, isBoardFull, cloneBoard, BOARD_SIZE } from "../game/logic";
import { hapticNotify, useTelegramBackButton, setClosingConfirmation } from "../lib/telegram";
import { IconUndo } from "./Icons";

const DISCONNECT_GRACE_MS = 20000; // 对方断线后,宽限20秒再允许判负
const WIN_REVEAL_DELAY = 1000;     // 五连产生后,先让连线动画播完,再切出结算面板(跟 PveScreen 一致)
const TURN_SECONDS = 30;           // 每一步的倒计时,纯展示用的软提醒,不会自动判负

const RESULT_COPY = {
  win: { title: "胜局", color: "var(--wood)" },
  lose: { title: "败局", color: "var(--gold)" },
  draw: { title: "和棋", color: "var(--fg)" },
};

function resultDesc(outcome, reason) {
  if (reason === "forfeit") return outcome === "win" ? "对方中途认输离开了。" : "你已选择认输离开。";
  if (reason === "disconnect") return outcome === "win" ? "对方长时间掉线,判你获胜。" : "你掉线太久,被判负了。";
  if (outcome === "win") return "五子连珠,漂亮的一局。";
  if (outcome === "lose") return "差一点,再来一局找回来。";
  return "棋盘落满,不分胜负。";
}

export default function OnlineGame({ roomId, myId, onExit, onMatched }) {
  const [room, setRoom] = useState(null);
  const [opponentName, setOpponentName] = useState("对手");
  const [lastMove, setLastMove] = useState(null);
  const [ratingDelta, setRatingDelta] = useState(null);
  // 乐观更新:落子瞬间先在本地显示,等服务器确认后再对齐/回滚
  const [pendingMove, setPendingMove] = useState(null); // { board, moveCountAfter }
  // 对手在线状态:disconnectSince=null 表示在线;有值表示从那一刻起断线,配合宽限期显示倒计时
  const [disconnectSince, setDisconnectSince] = useState(null);
  const [now, setNow] = useState(Date.now());
  // 五连产生后先让连线动画播完,这段时间里结果面板保持空白(揭晓延迟)
  const [revealing, setRevealing] = useState(false);
  // 认输需要二次确认,防误触——点"认输"先弹这个框,不直接执行
  const [resignConfirmOpen, setResignConfirmOpen] = useState(false);
  const [resigning, setResigning] = useState(false);
  // 悔棋:我自己发起请求 / 正在处理对方发来的请求
  const [requestingUndo, setRequestingUndo] = useState(false);
  const [respondingUndo, setRespondingUndo] = useState(false);
  // 结算后点"返回房间"
  const [returningToRoom, setReturningToRoom] = useState(false);

  const channelRef = useRef(null);
  const lastBoardFlatRef = useRef(null); // 上一次已知的棋盘(flat数组),用来跟新棋盘diff出"到底是哪一步"
  const revealTriggeredRef = useRef(false); // 防止同一次结算重复触发揭晓延迟的计时器
  const lobbyResetRef = useRef(false); // "返回房间"重开成功、状态回到 lobby 时,只重置一次本地残留状态
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  useEffect(() => {
    let cancelled = false;

    // roomId 变化通常发生在"再来一局"——这是切到一间全新的房间,上一局遗留的
    // 状态(积分变化、断线计时、乐观更新覆盖层……)都属于旧房间,必须先清空,
    // 不然新的一局可能显示上一局的旧积分变化,或者带着奇怪的残留状态
    setRoom(null);
    setLastMove(null);
    setRatingDelta(null);
    setPendingMove(null);
    setDisconnectSince(null);
    setOpponentName("对手");
    setRevealing(false);
    lastBoardFlatRef.current = null;
    revealTriggeredRef.current = false;
    lobbyResetRef.current = false;

    async function load() {
      const { data } = await supabase.from("rooms").select("*").eq("id", roomId).single();
      if (cancelled) return;
      lastBoardFlatRef.current = data?.board || null;
      setRoom(data);
    }
    load();

    // 同一个 channel 上同时挂落子同步(postgres_changes)、在线状态(presence)、
    // 以及"对方点了再来一局、新房间已经建好"的通知(用 rematch_of 精确关联,不用猜)
    const channel = supabase.channel(`room-${roomId}`, { config: { presence: { key: myId } } });

    channel
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          // 棋盘变化时,跟上一次已知的棋盘做个 diff,找出真正落子的那一格——
          // 不管这一步是我下的还是对方下的,都能算出正确的坐标,用来画获胜连线、
          // 高亮最后一手。之前这里只依赖"我自己点击时记录的坐标",导致对方
          // 赢的那一局,输的一方因为 lastMove 还停在自己上一手,连线根本对不上,
          // 直接就看不到获胜连线了。
          const newFlat = payload.new.board;
          const oldFlat = lastBoardFlatRef.current;
          if (oldFlat && newFlat) {
            for (let i = 0; i < newFlat.length; i++) {
              if (newFlat[i] !== oldFlat[i] && newFlat[i] !== 0) {
                setLastMove([i % BOARD_SIZE, Math.floor(i / BOARD_SIZE)]);
                break;
              }
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
      .on("presence", { event: "leave" }, ({ key }) => {
        if (key !== myId) setDisconnectSince(Date.now());
      })
      .on("presence", { event: "join" }, ({ key }) => {
        if (key !== myId) setDisconnectSince(null); // 对方回来了,清掉断线状态
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ online: true });
      });

    channelRef.current = channel;
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, myId]);

  // 断线倒计时 + 回合倒计时共用这一个秒表,对局进行中就一直走
  useEffect(() => {
    if (!room || room.status !== "playing") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [room?.status, room?.move_count]);

  // 一旦服务器状态追上了本地乐观更新的那一步,就不再需要覆盖层,以服务器数据为准
  useEffect(() => {
    if (!room || !pendingMove) return;
    if (room.move_count >= pendingMove.moveCountAfter) setPendingMove(null);
  }, [room, pendingMove]);

  useEffect(() => {
    if (!room) return;
    const opponentId = room.player1_id === myId ? room.player2_id : room.player1_id;
    if (!opponentId) return;
    supabase.from("profiles").select("display_name").eq("id", opponentId).single()
      .then(({ data }) => data && setOpponentName(data.display_name || "对手"));
  }, [room, myId]);

  // 结算之后,不管是不是自己触发的 finish_match,都从战绩表里把积分变化读出来
  useEffect(() => {
    if (!room || room.status !== "finished" || ratingDelta !== null) return;
    supabase.from("match_history").select("*").eq("room_id", roomId)
      .order("created_at", { ascending: false }).limit(1).single()
      .then(({ data }) => {
        if (!data) return;
        const mySlot = room.player1_id === myId ? 1 : 2;
        setRatingDelta(mySlot === 1
          ? data.player1_rating_after - data.player1_rating_before
          : data.player2_rating_after - data.player2_rating_before);
      });
  }, [room, roomId, myId, ratingDelta]);

  // 五连产生的瞬间先进入"揭晓中"状态,650ms 之后(跟连线动画同步)才真正
  // 把结果面板切出来,同一局只触发一次,不会因为 ratingDelta 之类的后续
  // 更新又重新播一遍动画
  useEffect(() => {
    if (!room) return;
    if (room.status !== "finished") { revealTriggeredRef.current = false; return; }
    if (pendingMove || revealTriggeredRef.current) return;
    revealTriggeredRef.current = true;
    if (room.winner && lastMove) {
      setRevealing(true);
      const t = setTimeout(() => setRevealing(false), WIN_REVEAL_DELAY);
      return () => clearTimeout(t);
    }
  }, [room, pendingMove, lastMove]);

  // "返回房间"重开成功、房间状态回到 lobby 时,清掉这一局遗留的本地状态,
  // 不然大厅界面还会带着上一局的最后一手/积分变化之类的残留
  useEffect(() => {
    if (!room) return;
    if (room.status === "lobby" && !lobbyResetRef.current) {
      lobbyResetRef.current = true;
      setLastMove(null);
      setRatingDelta(null);
      setRevealing(false);
      revealTriggeredRef.current = false;
    }
    if (room.status !== "lobby") lobbyResetRef.current = false;
  }, [room]);

  // 认输是对局进行中唯一的退出方式——不管是点棋盘内的"认输"按钮,还是按了
  // Telegram 原生返回键,一律先弹确认框,真正确认了才会执行认输 + 退出;
  // 大厅/结算之后没有"认输"这一说,直接退出就好
  const handleBackAction = useCallback(() => {
    if (room?.status === "playing") {
      setResignConfirmOpen(true);
    } else {
      onExit();
    }
  }, [room, onExit]);

  useTelegramBackButton(handleBackAction);

  // 对方断线超过宽限期后,不再需要还留在对局里的玩家手动点"判定我获胜"——
  // 宽限倒计时一归零就自动帮他结算。用 ref 防止在服务器状态还没通过
  // 订阅追上来的这几百毫秒里,effect 因为 now 每秒都在变而被重复触发、
  // 打出好几次重复的 finish_match 请求(RPC 本身虽然幂等,但没必要多打)。
  const autoForfeitTriggeredRef = useRef(false);
  useEffect(() => {
    if (!disconnectSince) { autoForfeitTriggeredRef.current = false; return; }
    if (!room || room.status !== "playing") return;
    if (autoForfeitTriggeredRef.current) return;
    const remaining = DISCONNECT_GRACE_MS - (now - disconnectSince);
    if (remaining > 0) return;
    autoForfeitTriggeredRef.current = true;
    claimForfeitWin();
  }, [room, disconnectSince, now]);

  // 对局进行中拦截 Telegram 的关闭手势,防止一划就把整个小程序关掉、棋局晾在那回不去
  useEffect(() => {
    setClosingConfirmation(room?.status === "playing");
    return () => setClosingConfirmation(false);
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

  // 挪到这里(大厅判断之前),因为大厅视图和真实对局视图都要用到断线倒计时
  const graceRemaining = disconnectSince ? Math.max(0, DISCONNECT_GRACE_MS - (now - disconnectSince)) : 0;

  // 大厅:双方都进房间了,但还没真正开始对局。房主(player1)点"开始对局"
  // 才会真正把状态推进到 playing。这一步之前不存在——之前是好友一接受邀请
  // 就直接被拽进真实对局,完全没有"进房间"和"开始打"的区分
  if (room.status === "lobby") {
    return (
      <div>
        <button className="btn-ghost" onClick={onExit}>← 返回</button>
        <div className="menu-header"><h2>对局大厅</h2></div>

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
            你<span className="mono">({mySlot === 1 ? "黑" : "白"})</span> VS {opponentName}<span className="mono">({mySlot === 1 ? "白" : "黑"})</span>
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

  // 有未确认的乐观更新时优先显示它,服务器数据到位后自动切回
  const board2D = pendingMove ? pendingMove.board : toBoard2D(room.board);
  const effectiveTurn = pendingMove ? pendingMove.turnAfter : room.current_turn;
  const isMyTurn = effectiveTurn === mySlot && room.status === "playing" && !pendingMove;

  // 悔棋请求:对方发起的、需要我回应的那一个
  const incomingUndo = room.status === "playing" && room.undo_requested_by && room.undo_requested_by !== myId;
  const myUndoPending = room.undo_requested_by === myId;
  const canRequestUndo = room.status === "playing" && !room.undo_requested_by && !!room.board_before_last_move && !pendingMove && !revealing;

  // 回合倒计时:从"上一次棋盘更新"的时间戳算 30 秒,纯展示用的软提醒,
  // 不会自动判负——真正的"长时间不动"由断线判定那一套走(玩家可以确认判对方负)
  const turnDeadline = room.status === "playing" ? new Date(room.updated_at).getTime() + TURN_SECONDS * 1000 : null;
  const turnSecondsLeft = turnDeadline ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : TURN_SECONDS;
  const turnUrgent = turnSecondsLeft <= 10;

  // 只有一方点了"返回房间"、还在等对方的状态
  const myRematchReady = mySlot === 1 ? room.player1_rematch_ready : room.player2_rematch_ready;
  const oppRematchReady = mySlot === 1 ? room.player2_rematch_ready : room.player1_rematch_ready;

  // 房主在大厅点"开始对局",真正把状态推进到 playing。RLS 允许双方任意一方
  // 更新这一行,但按钮只在房主这边渲染出来,保证正常流程下只有房主能点这个
  async function startMatch() {
    await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);
  }

  async function handleCellClick(x, y) {
    if (!isMyTurn || room.undo_requested_by) return; // 有悔棋请求在处理中时不能落子
    const beforeFlat = room.board; // 落子前的棋盘快照,留给"悔棋"用
    const next = cloneBoard(board2D);
    next[y][x] = mySlot;

    const win = checkWin(next, x, y);
    const full = isBoardFull(next);
    const nextTurn = mySlot === 1 ? 2 : 1;

    // 先本地落子,画面立刻响应,不等网络
    setLastMove([x, y]);
    setPendingMove({ board: next, turnAfter: nextTurn, moveCountAfter: room.move_count + 1 });

    const flat = next.flat();
    const { error } = await supabase.from("rooms").update({
      board: flat,
      current_turn: nextTurn,
      move_count: room.move_count + 1,
      board_before_last_move: beforeFlat,
      undo_requested_by: null,
    }).eq("id", roomId);

    if (error) {
      // 网络失败,回滚本地落子
      setPendingMove(null);
      setLastMove(null);
      hapticNotify("error");
      return;
    }

    if (win) {
      hapticNotify("success");
      const { data } = await supabase.rpc("finish_match", { p_room_id: roomId, p_winner: mySlot });
      if (data && !data.already_finished) {
        setRatingDelta(mySlot === 1 ? data.my1_delta : data.my2_delta);
      }
    } else if (full) {
      const { data } = await supabase.rpc("finish_match", { p_room_id: roomId, p_winner: 0 });
      if (data && !data.already_finished) {
        setRatingDelta(mySlot === 1 ? data.my1_delta : data.my2_delta);
      }
    }
  }

  // 对方断线超过宽限期:不再需要玩家手动点按钮判负,宽限倒计时一到就由
  // 上面那个 effect 自动调用这里,直接把还在线的这一方判赢
  async function claimForfeitWin() {
    const { data } = await supabase.rpc("finish_match", { p_room_id: roomId, p_winner: mySlot, p_reason: "disconnect" });
    if (data && !data.already_finished) {
      setRatingDelta(mySlot === 1 ? data.my1_delta : data.my2_delta);
    }
  }

  // 认输:点确认框里的"确认认输"才会真正执行
  async function confirmResign() {
    setResigning(true);
    const oppSlot = mySlot === 1 ? 2 : 1;
    await supabase.rpc("finish_match", { p_room_id: roomId, p_winner: oppSlot, p_reason: "forfeit" });
    setResigning(false);
    setResignConfirmOpen(false);
    onExit();
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

  // 结算后点"返回房间":两边都点过才会真正重开(房间状态回到 lobby 由后端
  // 判断并广播,这里只负责发起请求、进入"等待中"的 loading 态)
  async function handleReturnToRoom() {
    setReturningToRoom(true);
    await supabase.rpc("return_to_room", { p_room_id: roomId });
    setReturningToRoom(false);
  }

  const winLine = (() => {
    if (room.status !== "finished" || room.winner === 0 || !lastMove || pendingMove) return null;
    const w = checkWin(board2D, lastMove[0], lastMove[1]);
    return w?.line || null;
  })();

  // 结果面板只在"揭晓延迟"结束之后才显示,之前那 650ms 里棋盘上的连线
  // 动画独占这块空间的视觉注意力
  let result = null;
  if (room.status === "finished" && !pendingMove && !revealing) {
    if (room.winner === 0) result = { outcome: "draw", reason: room.end_reason };
    else result = { outcome: room.winner === mySlot ? "win" : "lose", reason: room.end_reason };
  }

  const boardLocked = revealing || !!result || !!room.undo_requested_by;

  return (
    <div>
      <div className="game-layout">
        {/* 顶栏没有"返回"这个按钮——对局进行中想退出只能走"认输",逼出
            一次确认弹窗,不给"手滑退出导致孤儿房间"留口子 */}
        <div className="room-topbar pve-topbar">
          {room.status === "playing" ? (
            <button className="resign-btn" onClick={() => setResignConfirmOpen(true)}>认输</button>
          ) : (
            <span />
          )}
          <div className="pve-topbar-right">
            <div className="pve-turn-pill">
              {revealing ? (
                <>{room.winner ? "五子连珠!" : "棋盘落满"}</>
              ) : result ? (
                <>对局结束</>
              ) : (
                <>
                  <div className={`turn-dot black${effectiveTurn === 1 ? " active" : ""}`} />
                  <div className={`turn-dot white${effectiveTurn === 2 ? " active" : ""}`} />
                  {opponentName}
                </>
              )}
            </div>
            {room.status === "playing" && (
              <button
                className="btn-undo"
                onClick={myUndoPending ? undefined : handleRequestUndo}
                disabled={!canRequestUndo || requestingUndo || myUndoPending}
              >
                <IconUndo size={15} /> {myUndoPending ? "等待回应…" : "悔棋"}
              </button>
            )}
          </div>
        </div>

        <div className="game-board-col">
          {/* 这块区域固定 74px 高度,不管里面放的是回合倒计时还是结算结果,
              棋盘的位置都不会跟着跳——三种状态(倒计时/揭晓中留空/结果)
              共用同一块预留空间 */}
          <div className="pve-result-panel">
            {result ? (
              <>
                <h2 className="pve-result-title" style={{ color: RESULT_COPY[result.outcome].color }}>
                  {RESULT_COPY[result.outcome].title}
                </h2>
                <p className="pve-result-desc">{resultDesc(result.outcome, result.reason)}</p>
                {typeof ratingDelta === "number" && (
                  <p className="mono" style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 700, color: ratingDelta >= 0 ? "var(--wood)" : "var(--gold)" }}>
                    {ratingDelta > 0 ? `+${ratingDelta}` : ratingDelta} 分
                  </p>
                )}
              </>
            ) : (
              !revealing && room.status === "playing" && (
                <div className={`turn-timer${turnUrgent ? " urgent" : ""}`}>
                  <div className="turn-timer-row">
                    <span className="turn-timer-label">{isMyTurn ? "轮到你" : `${opponentName} · 思考中`}</span>
                    <span className="turn-timer-count mono">{turnSecondsLeft}s</span>
                  </div>
                  <div className="turn-timer-track">
                    <div className="turn-timer-fill" style={{ width: `${(turnSecondsLeft / TURN_SECONDS) * 100}%` }} />
                  </div>
                </div>
              )
            )}
          </div>

          <Board
            board={board2D}
            onCellClick={handleCellClick}
            lastMove={lastMove}
            winLine={winLine}
            disabled={!isMyTurn}
            locked={boardLocked}
            onIllegalTap={() => hapticNotify("warning")}
            previewColor={mySlot}
          />

          {/* 对局结束后的操作按钮,沿用棋盘下方"确认落子"那一条 confirm-bar
              的位置——两者不会同时出现,视觉上正好是同一个位置被复用。
              这里不用"返回菜单/再来一局",改成"返回首页/返回房间",
              避免直接建一间新房间导致原来这间变孤儿房 */}
          {result && !myRematchReady && (
            <div className="confirm-bar">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={onExit}>返回首页</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleReturnToRoom} disabled={returningToRoom}>
                {returningToRoom ? "处理中…" : "返回房间"}
              </button>
            </div>
          )}

          {/* 我已经点过"返回房间",但对方还没点——可以在这等,也可以直接
              回首页去重新邀请好友或者进匹配找别的对手,不用死等这一间房 */}
          {result && myRematchReady && !oppRematchReady && (
            <div className="panel" style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
              <p className="muted" style={{ marginBottom: "var(--space-3)" }}>已返回房间,等待{opponentName}也返回…</p>
              <button className="btn-ghost" style={{ width: "100%" }} onClick={onExit}>去邀请好友 / 匹配其他对手</button>
            </div>
          )}
        </div>

        <p className="muted" style={{ textAlign: "center", fontSize: 12 }}>
          你执{mySlot === 1 ? "黑" : "白"} · {opponentName}执{mySlot === 1 ? "白" : "黑"}
        </p>

        {/* 断线提示:宽限期内只是提醒,倒计时一到就交给上面那个 effect
            自动判负结算,这里只是展示状态,不需要玩家点任何按钮——
            结算完成后 room.status 会变成 finished,这块提示自然跟着消失 */}
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
      </div>

      {/* 认输二次确认弹窗:防误触,点了"认输"入口不会立刻生效 */}
      {resignConfirmOpen && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ textAlign: "center" }}>
            <h2 className="text-heading">确定要认输吗?</h2>
            <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>
              确认后对方将直接获胜,这局无法恢复。
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setResignConfirmOpen(false)} disabled={resigning}>
                取消
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={confirmResign} disabled={resigning}>
                {resigning ? "处理中…" : "确认认输"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 对方发起的悔棋请求:需要我回应才会继续,不能单方面直接改棋盘 */}
      {incomingUndo && (
        <div className="modal-overlay">
          <div className="modal-panel" style={{ textAlign: "center" }}>
            <h2 className="text-heading">{opponentName} 请求悔棋</h2>
            <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>
              同意的话,棋盘会退回到对方那一步落子之前。
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => handleRespondUndo(false)} disabled={respondingUndo}>
                拒绝
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => handleRespondUndo(true)} disabled={respondingUndo}>
                同意
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
