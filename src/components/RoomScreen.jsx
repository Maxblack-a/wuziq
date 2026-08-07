import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { shareInviteLink, isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { useOnlineUserIds } from "../lib/presence";
import { titleForRating, levelForRating } from "../lib/rank";
import {
  IconAvatarFallback,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconMoreHorizontal,
  IconCoinStack,
  IconPlay,
  IconPersonPlus,
  IconInfoCircle,
  IconDiamondOutline,
  IconFriends,
} from "./Icons";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看混的字符
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "your_bot";
const APP_SHORT_NAME = import.meta.env.VITE_TELEGRAM_APP_NAME || "gomoku";

// "开始对局"点进来之后的房间页:先是我一个人在房里,VS 位置空着,
// 可以选"开始匹配"或者"邀请好友一起对局"把对手填进那个空位;对手一旦进来
// (不管是接受了邀请、还是扫码/输房间号加入的),状态会变成 lobby,
// 双方头像都亮出来,由房主点"开始游戏"才真正进对局——这一步之前是
// 直接扔进真实对局,现在中间多了这一层"确认双方都到齐了"的缓冲。
//
// roomId 是可选的:从首页"开始对局"点进来时没有,这里自己建一间新房间;
// 但如果是接受好友邀请、或者点邀请链接进来的(App.jsx 已经知道房间号了),
// 就直接传进来,不再重复建房间。
//
// 这一版按新设计图重做了整个视觉:顶部换成"返回 + 更多"的轻量图标栏
// (Telegram 原生的 Close/标题栏不算在内,那是系统层的,这里从图标栏
// 开始才是页面自己的内容)、居中的印章式标题区、放大的 VS 头像位配
// 六边形等级徽章、"好友在线"胶囊条、墨色主 CTA、描边邀请按钮,以及
// 底部的房间自动解散提示。
export default function RoomScreen({ myId, roomId: incomingRoomId, playerName, avatarUrl, rating, onMatched, onExit, onRandomMatch }) {
  useTelegramBackButton(onExit);

  const [roomId, setRoomId] = useState(incomingRoomId || null);
  const [room, setRoom] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [inviting, setInviting] = useState(false); // 是否展开"邀请好友"这个子面板
  const [friends, setFriends] = useState([]);
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [starting, setStarting] = useState(false);
  const onlineIds = useOnlineUserIds();
  const createdRef = useRef(false); // 防止重复建房间(比如 React 开发模式的双调用)
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  // 没有现成房间号时,自己建一间——房主(player1)就是我。抽成一个独立函数
  // 而不是直接写在 effect 里,是因为下面失败提示那边需要一个"重试"按钮,
  // 重试要能重新调用这同一段逻辑,不能只在 effect 首次挂载时跑一次。
  const buildingRef = useRef(false); // 防止"正在建的时候"重试按钮被连点触发第二次插入
  async function createRoom() {
    if (buildingRef.current) return;
    buildingRef.current = true;
    setErrorMsg("");
    const code = randomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code, mode: "invite", status: "waiting", player1_id: myId, current_turn: 1 })
      .select()
      .single();
    buildingRef.current = false;
    if (error) {
      // 之前这里只丢一句写死的"创建房间失败,请重试",真正的报错原因被吞掉了,
      // 没法判断到底是登录会话还没就绪(RLS 拒绝)、网络问题、还是别的什么。
      // 打到 console 方便接 USB 调试查看,同时也把 message 直接显示在页面上——
      // 毕竟这是跑在 Telegram WebView 里,用户手机上大概率够不着控制台。
      console.error("创建房间失败", error);
      setErrorMsg(`创建房间失败:${error.message || error.code || "请重试"}`);
      return;
    }
    setRoomId(data.id);
    setRoom(data);
  }

  useEffect(() => {
    if (incomingRoomId || createdRef.current) return;
    createdRef.current = true;
    createRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRoomId, myId]);

  // 有现成房间号的话(接受邀请/扫码进来),直接把房间数据读出来
  useEffect(() => {
    if (!incomingRoomId) return;
    supabase.from("rooms").select("*").eq("id", incomingRoomId).single()
      .then(({ data }) => data && setRoom(data));
  }, [incomingRoomId]);

  // 订阅这间房间的变化:对手加入(player2_id 从空变有值)、状态从
  // waiting → lobby → playing,都是同一行数据的 UPDATE,一个订阅够用
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`room-lobby-${roomId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => setRoom(payload.new)
      ).subscribe();
    return () => supabase.removeChannel(channel);
  }, [roomId]);

  // 对手进来之后,把 ta 的头像/昵称/分数拉出来显示在 VS 的另一侧——
  // 分数是为了推算 ta 的 LV.几 等级徽章,跟"我"这边用同一套算法
  useEffect(() => {
    if (!room?.player2_id) { setOpponent(null); return; }
    supabase.from("profiles").select("display_name, avatar_url, rating").eq("id", room.player2_id).single()
      .then(({ data }) => setOpponent(data));
  }, [room?.player2_id]);

  // 状态推进到 playing 的那一刻(房主点了"开始游戏"),不管我是房主
  // 自己点的、还是作为对方在旁边看着状态变化的,都统一走 onMatched 进真实对局
  useEffect(() => {
    if (room?.status === "playing") onMatchedRef.current(roomId);
  }, [room?.status, roomId]);

  // 拉一次好友列表,给"邀请好友"面板和"好友在线"这行胶囊条用
  useEffect(() => {
    if (!myId) return;
    supabase
      .from("friendships")
      .select("friend_id, profiles:friend_id(id, display_name, avatar_url, rating)")
      .eq("user_id", myId)
      .then(({ data }) => setFriends((data || []).map((r) => r.profiles).filter(Boolean)));
  }, [myId]);

  async function inviteFriend(friend) {
    if (!roomId || invitedIds.has(friend.id)) return;
    const { error } = await supabase.from("game_invites").insert({ from_id: myId, to_id: friend.id, room_id: roomId });
    if (error) { setErrorMsg("邀请发送失败"); return; }
    setInvitedIds((prev) => new Set(prev).add(friend.id));
  }

  async function handleShare() {
    if (!room?.code) return;
    const result = await shareInviteLink(`room_${room.code}`, BOT_USERNAME, APP_SHORT_NAME);
    if (result.copied) {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2000);
    }
  }

  async function handleStartGame() {
    setStarting(true);
    const { error } = await supabase.from("rooms").update({ status: "playing" }).eq("id", roomId);
    if (error) { setStarting(false); setErrorMsg("开始失败,请重试"); return; }
    // 不需要在这里手动 setScreen——上面那个订阅 room.status 变化的 effect
    // 会自己触发 onMatched,房主自己这边和订阅是同一条路径,不用写两遍
  }

  const isHost = room?.player1_id === myId;
  const hasOpponent = !!room?.player2_id;
  const myName = playerName || "我";

  const myLevel = levelForRating(rating);
  const myTitle = titleForRating(rating ?? 1200);
  const oppLevel = opponent ? levelForRating(opponent.rating) : null;
  const oppTitle = opponent ? titleForRating(opponent.rating ?? 1200) : null;
  const opponentOnline = room?.player2_id ? onlineIds.has(room.player2_id) : false;
  const onlineFriendsCount = friends.filter((f) => onlineIds.has(f.id)).length;

  return (
    <div>
      {/* 顶栏:左返回 / 右更多——Telegram 原生的 Close/标题栏在这一层之外,
          这里只是页面自己的内容,严格对应设计图里"< ... "那一行 */}
      <div className="room-topbar fade-in-up">
        <button className="room-icon-btn" onClick={onExit} aria-label="返回">
          <IconChevronLeft />
        </button>
        <button className="room-icon-btn" onClick={handleShare} disabled={!room?.code} aria-label="更多操作">
          <IconMoreHorizontal />
        </button>
      </div>
      {copiedFlash && <div className="room-toast fade-in-up">邀请链接已复制</div>}

      {/* 标题区:两侧小菱形装饰章 + 印章感标题,下方一条分隔线(中间嵌一个
          鎏金小点)再接一行"五子棋 · 标准模式"的模式说明 */}
      <div className="room-title-wrap fade-in-up" style={{ animationDelay: "40ms" }}>
        <div className="room-title-row">
          <IconDiamondOutline size={11} />
          <h1 className="room-title-text">对局房间</h1>
          <IconDiamondOutline size={11} />
        </div>
        <div className="room-title-divider" />
        <p className="room-subtitle">五子棋 · 标准模式</p>
      </div>

      {/* VS 对阵区:双方头像 + 六边形等级徽章 + 昵称 + 段位胶囊 + 在线状态,
          中间是水墨飞白风格的 VS 徽章 */}
      <div className="vs-row fade-in-up" style={{ animationDelay: "80ms" }}>
        <div className="vs-slot">
          <div className="vs-avatar">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <IconAvatarFallback size={26} />}
            <span className="vs-avatar-badge">{myLevel}</span>
          </div>
          <div className="vs-name">{myName}</div>
          <span className="vs-level-tag">LV.{myLevel} {myTitle}</span>
          <div className="vs-status-row">
            <span className="vs-status-dot" />
            在线
          </div>
        </div>

        <div className="vs-center">
          <span className="vs-plain-text">VS</span>
        </div>

        <div className="vs-slot">
          {opponent ? (
            <>
              <div className="vs-avatar">
                {opponent.avatar_url ? <img src={opponent.avatar_url} alt="" /> : <IconAvatarFallback size={26} />}
                <span className="vs-avatar-badge">{oppLevel}</span>
              </div>
              <div className="vs-name">{opponent.display_name || "对手"}</div>
              <span className="vs-level-tag">LV.{oppLevel} {oppTitle}</span>
              <div className="vs-status-row">
                <span className={`vs-status-dot${opponentOnline ? "" : " offline"}`} />
                {opponentOnline ? "在线" : "离线"}
              </div>
            </>
          ) : (
            <>
              <div className="vs-avatar vs-avatar-empty">
                <IconAvatarFallback size={26} />
                <span className="vs-avatar-badge">?</span>
              </div>
              <div className="vs-name muted">等待加入</div>
              {invitedIds.size > 0 ? (
                <>
                  <div className="vs-search-text">已邀请,等待确认…</div>
                  <div className="vs-search-dots">
                    <span className="vs-search-dot" />
                    <span className="vs-search-dot" />
                    <span className="vs-search-dot" />
                  </div>
                </>
              ) : (
                <div className="vs-status-row">
                  <span className="vs-status-dot offline" />
                  空位待定
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {!hasOpponent && !inviting && (
        <>
          <button className="friends-bar fade-in-up" style={{ animationDelay: "120ms" }} onClick={() => setInviting(true)}>
            <span className="friends-bar-icon"><IconFriends size={18} /></span>
            <span className="friends-bar-text">
              好友在线 <span className="friends-bar-count">{onlineFriendsCount}</span> 人
            </span>
            <span className="friends-bar-link">
              查看全部 <IconChevronRight size={13} />
            </span>
          </button>

          <button
            className="room-action-primary fade-in-up"
            style={{ animationDelay: "160ms" }}
            disabled={!roomId}
            onClick={onRandomMatch}
          >
            <span className="cta-primary-lead">
              <span className="cta-primary-icon"><IconCoinStack size={17} /></span>
              <span className="cta-primary-text">
                <span className="cta-primary-title">开始匹配</span>
                <span className="cta-primary-sub">START MATCH</span>
              </span>
            </span>
            <span className="cta-primary-arrow">
              <IconArrowRight />
            </span>
          </button>

          <button
            className="btn-outline-pill fade-in-up"
            style={{ animationDelay: "200ms" }}
            disabled={!roomId}
            onClick={() => setInviting(true)}
          >
            <IconPersonPlus size={18} />
            邀请好友一起对局
          </button>

          <div className="room-footnote fade-in-up" style={{ animationDelay: "240ms" }}>
            <IconInfoCircle size={13} />
            房间创建后30分钟内未开始对局将自动解散
          </div>
        </>
      )}

      {!hasOpponent && inviting && (
        <div className="fade-in-up" style={{ marginTop: "var(--space-2)" }}>
          <button className="room-back-link" onClick={() => setInviting(false)}>
            <IconChevronLeft size={16} /> 返回匹配方式
          </button>

          {friends.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>还没有好友,去"好友"页面添加一个吧。</p>
          ) : (
            friends.map((f) => (
              <div key={f.id} className="mode-card" style={{ marginBottom: "var(--space-2)" }}>
                <span className={`online-dot${onlineIds.has(f.id) ? " online" : ""}`} />
                <div style={{ flex: 1 }}>
                  <div className="title">{f.display_name || "玩家"}</div>
                  <div className="desc">{onlineIds.has(f.id) ? "在线" : "离线"}</div>
                </div>
                <button
                  className="btn-ghost"
                  style={{ padding: "8px 14px" }}
                  disabled={invitedIds.has(f.id)}
                  onClick={() => inviteFriend(f)}
                >
                  {invitedIds.has(f.id) ? "已邀请" : "邀请"}
                </button>
              </div>
            ))
          )}

          {room?.code && (
            <div style={{ marginTop: "var(--space-4)" }}>
              <p className="muted" style={{ marginBottom: "var(--space-2)", fontSize: 13 }}>
                也可以直接分享房间链接,不限于好友
              </p>
              <div className="room-code-display mono">{room.code}</div>
              <button className="btn-ghost" style={{ width: "100%" }} onClick={handleShare}>
                {copiedFlash ? "已复制到剪贴板 ✓" : isInTelegram ? "分享邀请链接" : "复制邀请链接"}
              </button>
            </div>
          )}
        </div>
      )}

      {hasOpponent && room?.status === "lobby" && (
        <div className="fade-in-up" style={{ marginTop: "var(--space-2)" }}>
          {isHost ? (
            <button className="room-action-primary" disabled={starting} onClick={handleStartGame}>
              <span className="cta-primary-lead">
                <span className="cta-primary-icon"><IconPlay size={17} /></span>
                <span className="cta-primary-text">
                  <span className="cta-primary-title">{starting ? "开始中…" : "开始游戏"}</span>
                  <span className="cta-primary-sub">START GAME</span>
                </span>
              </span>
              <span className="cta-primary-arrow">
                <IconArrowRight />
              </span>
            </button>
          ) : (
            <div style={{ textAlign: "center", padding: "var(--space-6) 0" }}>
              <div className="spinner" style={{ margin: "0 auto 12px" }} />
              <p className="muted">对方已加入,等待房主开始游戏…</p>
            </div>
          )}
        </div>
      )}

      {errorMsg && (
        <div style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
          <p style={{ color: "var(--seal-red)", fontSize: 13 }}>{errorMsg}</p>
          {!roomId && (
            <button className="btn-ghost" style={{ marginTop: "var(--space-2)" }} onClick={createRoom}>
              重试
            </button>
          )}
        </div>
      )}
    </div>
  );
}
