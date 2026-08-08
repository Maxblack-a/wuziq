import { useEffect, useState, useRef, useCallback } from "react";
import Board from "./Board";
import ResultModal from "./ResultModal";
import { supabase } from "../lib/supabase";
import { toBoard2D, checkWin, isBoardFull, cloneBoard, BOARD_SIZE } from "../game/logic";
import { hapticNotify, confirmDialog, useTelegramBackButton, setClosingConfirmation } from "../lib/telegram";

const DISCONNECT_GRACE_MS = 20000; // 对方断线后,宽限20秒再允许判负

export default function OnlineGame({ roomId, myId, onExit, onMatched }) {
  const [room, setRoom] = useState(null);
  const [opponentName, setOpponentName] = useState("对手");
  const [lastMove, setLastMove] = useState(null);
  const [ratingDelta, setRatingDelta] = useState(null);
  const [rematching, setRematching] = useState(false);
  // 乐观更新:落子瞬间先在本地显示,等服务器确认后再对齐/回滚
  const [pendingMove, setPendingMove] = useState(null); // { board, moveCountAfter }
  // 对手在线状态:disconnectSince=null 表示在线;有值表示从那一刻起断线,配合宽限期显示倒计时
  const [disconnectSince, setDisconnectSince] = useState(null);
  const [now, setNow] = useState(Date.now());
  const channelRef = useRef(null);
  const lastBoardFlatRef = useRef(null); // 上一次已知的棋盘(flat数组),用来跟新棋盘diff出"到底是哪一步"
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
    lastBoardFlatRef.current = null;

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

  // 断线倒计时的秒表:disconnectSince 刚变化的瞬间先同步一次当前时间,
  // 不等 setInterval 的第一个周期(否则最多有1秒的显示误差,因为 now 还停在旧值)
  useEffect(() => {
    if (!disconnectSince) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [disconnectSince]);

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

  // 主动点返回(或者按 Telegram 原生返回按钮):对局进行中算认输,离开的人自己上报自己的负分
  // 注意:这三个 hook 必须放在下面的 "if (!room) return" 之前,不然 room 还没加载完的那几次
  // 渲染会跳过它们,不同渲染之间 hook 调用数量不一致,违反 React Hooks 规则
  const handleExitClick = useCallback(async () => {
    if (room?.status === "playing") {
      const confirmed = await confirmDialog("确定要认输离开吗?对方将直接获胜。");
      if (!confirmed) return;
      const oppSlot = (room.player1_id === myId ? 1 : 2) === 1 ? 2 : 1;
      await supabase.rpc("finish_match", { p_room_id: roomId, p_winner: oppSlot, p_reason: "forfeit" });
    }
    onExit();
  }, [room, roomId, myId, onExit]);

  useTelegramBackButton(handleExitClick);

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
        <button className="btn-ghost" onClick={handleExitClick}>← 返回</button>
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

  const canClaimForfeit = room.status === "playing" && disconnectSince && graceRemaining === 0;

  // 房主在大厅点"开始对局",真正把状态推进到 playing。RLS 允许双方任意一方
  // 更新这一行,但按钮只在房主这边渲染出来,保证正常流程下只有房主能点这个
  async function startMatch() {
    await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);
  }

  async function handleCellClick(x, y) {
    if (!isMyTurn) return;
    const next = cloneBoard(board2D);
    next[y][x] = mySlot;

    const win = checkWin(next, x, y);
    const full = isBoardFull(next);
    const nextTurn = mySlot === 1 ? 2 : 1;

    // 先本地落子,画面立刻响应,不等网络
    setLastMove([x, y]);
    setPendingMove({ board: next, turnAfter: nextTurn, moveCountAfter: room.move_count + 1 });
    // 落子的震动反馈已经在 Board 组件"确认落子"那一步震过了,这里不用再震一次

    const flat = next.flat();
    const { error } = await supabase.from("rooms").update({
      board: flat,
      current_turn: nextTurn,
      move_count: room.move_count + 1,
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

  // 对方断线超过宽限期,由还在线的一方主动判负结算
  async function claimForfeitWin() {
    const { data } = await supabase.rpc("finish_match", { p_room_id: roomId, p_winner: mySlot, p_reason: "disconnect" });
    if (data && !data.already_finished) {
      setRatingDelta(mySlot === 1 ? data.my1_delta : data.my2_delta);
    }
  }

  // 再来一局:不管是不是我先点的,create_rematch 都是幂等的——
  // 如果对方已经先点过了,会直接把已经建好的那间房查回来,不会重复建
  async function handleRematch() {
    setRematching(true);
    const { data: newRoomId, error } = await supabase.rpc("create_rematch", { p_old_room_id: roomId });
    setRematching(false);
    if (error || !newRoomId) { onExit(); return; }
    onMatched(newRoomId);
  }

  let result = null;
  if (room.status === "finished" && !pendingMove) {
    if (room.winner === 0) result = { outcome: "draw", ratingDelta, reason: room.end_reason };
    else result = { outcome: room.winner === mySlot ? "win" : "lose", ratingDelta, reason: room.end_reason };
  }

  const winLine = (() => {
    if (room.status !== "finished" || room.winner === 0 || !lastMove || pendingMove) return null;
    const w = checkWin(board2D, lastMove[0], lastMove[1]);
    return w?.line || null;
  })();

  return (
    <div>
      <div className="game-layout">
        <div className="game-board-col">
          <Board
            board={board2D}
            onCellClick={handleCellClick}
            lastMove={lastMove}
            winLine={winLine}
            disabled={!isMyTurn}
            onIllegalTap={() => hapticNotify("warning")}
            previewColor={mySlot}
          />
        </div>

        <div className="game-info-col">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button className="btn-ghost" onClick={handleExitClick}>← 返回</button>
            <div className="turn-indicator">
              <div className={`turn-dot black${effectiveTurn === 1 ? " active" : ""}`} />
              <div className={`turn-dot white${effectiveTurn === 2 ? " active" : ""}`} />
              {room.status === "waiting" ? "等待对手加入…" : isMyTurn ? "轮到你" : `${opponentName} 思考中`}
            </div>
          </div>

          <p className="muted" style={{ textAlign: "right", fontSize: 12 }}>
            你执{mySlot === 1 ? "黑" : "白"}
          </p>

          {disconnectSince && room.status === "playing" && (
            <div className="panel" style={{ textAlign: "center" }}>
              {graceRemaining > 0 ? (
                <p className="muted">对方似乎断线了,{Math.ceil(graceRemaining / 1000)} 秒后可判负</p>
              ) : (
                <>
                  <p className="muted" style={{ marginBottom: 8 }}>对方长时间未响应</p>
                  <button className="btn-primary" style={{ width: "100%" }} onClick={claimForfeitWin} disabled={!canClaimForfeit}>
                    判定我获胜
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <ResultModal result={result} onExit={onExit} onRematch={handleRematch} rematchLoading={rematching} />
    </div>
  );
}
