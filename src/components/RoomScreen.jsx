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
  IconSearch,
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
  const [roomId, setRoomId] = useState(incomingRoomId || null);
  const [room, setRoom] = useState(null);
  const [opponent, setOpponent] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [inviting, setInviting] = useState(false); // 是否展开"邀请好友"这个子面板
  const [friends, setFriends] = useState([]);
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [friendQuery, setFriendQuery] = useState(""); // 邀请面板里"搜索昵称加好友"的输入
  const [friendSearchResults, setFriendSearchResults] = useState([]);
  const [friendSearching, setFriendSearching] = useState(false);
  const [sentFriendRequestIds, setSentFriendRequestIds] = useState(new Set());
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [promotedFlash, setPromotedFlash] = useState(false); // 对方退出、我被自动扶正当房主的提示
  const [starting, setStarting] = useState(false);
  const onlineIds = useOnlineUserIds();
  const createdRef = useRef(false); // 防止重复建房间(比如 React 开发模式的双调用)
  const exitRequestedRef = useRef(false); // 建房请求还飞在路上时用户就点了退出,先记一笔
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
    // 这一步 insert 已经在数据库里真实落地了,不是"还没发生"。如果这个
    // 请求飞在路上的时候用户已经点了返回(那时候 roomId 还是 null,
    // handleExit 里没法带上 id 去调 leave_room,只能先在 exitRequestedRef
    // 上做个标记),现在拿到了它的 id,就该我们自己把这个刚生出来的
    // 孤儿房间清掉——不然它会一直挂在数据库里等 cleanup_stale_rooms
    // 一小时后才收拾,而且用户也早就已经在首页了,不用再 setRoom 展示出来
    if (exitRequestedRef.current) {
      supabase.rpc("leave_room", { p_room_id: data.id }).then(({ error }) => {
        if (error) console.error("清理来不及退出的房间失败", error);
      });
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

  // 检测"我被动成为房主"——原房主退出时,leave_room 会把 player1_id 改成我,
  // 这条 UPDATE 会通过上面已有的房间订阅自然推过来,这里只是拿一个 ref 存
  // 上一次的 player1_id,一旦发现"以前不是我、现在变成我了"就弹一下提示
  const prevHostIdRef = useRef(null);
  useEffect(() => {
    if (!room) return;
    const prevHostId = prevHostIdRef.current;
    if (prevHostId && prevHostId !== myId && room.player1_id === myId) {
      setPromotedFlash(true);
      const t = setTimeout(() => setPromotedFlash(false), 2600);
      return () => clearTimeout(t);
    }
    prevHostIdRef.current = room.player1_id;
  }, [room?.player1_id, myId]);

  // 退出房间(仅在对局开始前的这个页面才会调用得到——一旦 status 变成
  // playing,上面那个 effect 已经把人带去真实对局页面了,不会再走到这里):
  // 调 leave_room 这个原子 RPC,让服务端决定是"转让房主"还是"直接删房"。
  // 不 await 它——反正接下来就是导航回首页,成功或失败都不影响这一步,
  // 失败了(比如网络抖了一下)还有 cleanup_stale_rooms 定时任务兜底,
  // 不用为了保证退出请求送达而让用户在这多等一次网络往返。
  function handleExit() {
    if (roomId) {
      supabase.rpc("leave_room", { p_room_id: roomId }).then(({ error }) => {
        if (error) console.error("退出房间失败(不影响返回首页)", error);
      });
    } else {
      // 房间可能正在建的路上——insert 请求已经发出去了,只是响应还没
      // 回来,roomId 还没赋值到 state。这里没法直接带 id 去删,标记一下,
      // 等 createRoom 那边真的拿到新房间 id 时会检查这个标记并自己清理
      exitRequestedRef.current = true;
    }
    onExit();
  }

  // 物理/系统返回键(Telegram 原生 BackButton)跟页面自己顶栏的 "‹" 应该是
  // 同一个"返回"动作,行为不能不一样——不然会出现"点页面图标是先收起
  // 邀请面板,按系统返回键却直接把房间退了"这种同一操作两种结果的情况。
  // 所以这里也接上 handleTopBack,而不是原来写死的 handleExit。
  useTelegramBackButton(handleTopBack);

  // 顶栏这个 "‹" 图标(以及上面接的物理/系统返回键)要感知当前在不在
  // "邀请好友"这个子面板里:面板开着就先收起面板,回到"开始匹配/邀请好友"
  // 那一层;面板没开着,说明已经是最外层了,这时候点它才是真的退出房间。
  // 这样就不需要再在面板里单独放一个"返回匹配方式"的文字链接,两个长得
  // 很像又离得很近的返回控件容易被误触成另一个。
  function handleTopBack() {
    if (inviting) {
      setInviting(false);
      return;
    }
    handleExit();
  }

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

  // 邀请面板里顺带能搜昵称加好友——房间里想拉的人如果还不是好友,
  // 不用先跳去"好友"页,当场搜到、发申请,等对方同意了下次就能直接邀他对战。
  // 搜索/发申请这套逻辑跟 FriendsScreen 里那份是同一个功能,这里是个精简版。
  useEffect(() => {
    const q = friendQuery.trim();
    if (!q) { setFriendSearchResults([]); setFriendSearching(false); return; }
    setFriendSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, rating")
        .ilike("display_name", `%${q}%`)
        .neq("id", myId)
        .limit(20);
      setFriendSearchResults(data || []);
      setFriendSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [friendQuery, myId]);

  async function sendFriendRequest(targetId) {
    const { data, error } = await supabase.rpc("send_friend_request", { p_to_id: targetId });
    if (error || data?.error) { setErrorMsg(data?.error || "申请发送失败"); return; }
    if (data?.status === "auto_accepted") {
      // 对方之前也申请过我,已经直接成为好友——刷新好友列表,这样 TA 马上
      // 会出现在上面的"邀请对战"名单里,不用等再打开一次这个面板
      const { data: fr } = await supabase
        .from("friendships")
        .select("friend_id, profiles:friend_id(id, display_name, avatar_url, rating)")
        .eq("user_id", myId);
      setFriends((fr || []).map((r) => r.profiles).filter(Boolean));
    } else {
      setSentFriendRequestIds((prev) => new Set(prev).add(targetId));
    }
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
    // 改走 start_match RPC(原来是前端直接 update status)——RPC 里顺带把
    // 回合截止时间/双方初始心跳都种好了,配合服务端判负兜底机制用,
    // 见 schema.sql 里 start_match 的注释。
    const { data, error } = await supabase.rpc("start_match", { p_room_id: roomId });
    if (error || data?.error) { setStarting(false); setErrorMsg("开始失败,请重试"); return; }
    // 不需要在这里手动 setScreen——上面那个订阅 room.status 变化的 effect
    // 会自己触发 onMatched,房主自己这边和订阅是同一条路径,不用写两遍
  }

  const isHost = room?.player1_id === myId;
  const hasOpponent = !!room?.player2_id;
  const myName = playerName || "我";

  // 结算后点了"返回房间",但对方还没点:数据库层面这间房的对手位(player2_id)
  // 还占着上一局那个对手,可这局到底还续不续得上,得看对方点没点"返回房间"。
  // 用这两个 rematch_ready 标记判断——只要不是两边都点了,这个位置就该当成
  // "还没定下来",跟全新开一间房、根本没人来时用同一套 UI(开始匹配/邀请
  // 好友),而不是硬等对方或者另外画一个阉割版页面。
  const mySlot = room?.player1_id === myId ? 1 : room?.player2_id === myId ? 2 : null;
  const myRematchReady = mySlot === 1 ? room?.player1_rematch_ready : mySlot === 2 ? room?.player2_rematch_ready : false;
  const oppRematchReady = mySlot === 1 ? room?.player2_rematch_ready : mySlot === 2 ? room?.player1_rematch_ready : false;
  const awaitingRematch = room?.status === "finished" && myRematchReady && !oppRematchReady;

  // "邀请好友"这颗按钮(以及"好友在线"胶囊条)平时直接展开面板就好;但如果
  // 当前是 awaitingRematch 这种情况,原来的对手位事实上还被上一局的对手占着,
  // 没法把新邀请塞进同一个房间——这时候先悄悄换一间全新的干净房间,原来那间
  // 不用管(对方真要是也点了"返回房间",走的是它自己两边都确认那条路径,
  // 跟这里互不影响),再展开邀请面板,面板本身和"第一次进房间"时长得一模一样
  async function handleOpenInvite() {
    if (awaitingRematch) {
      setRoomId(null);
      setRoom(null);
      setOpponent(null);
      setInvitedIds(new Set());
      createRoom();
    }
    setInviting(true);
  }

  const myLevel = levelForRating(rating);
  const myTitle = titleForRating(rating ?? 0);
  const oppLevel = opponent ? levelForRating(opponent.rating) : null;
  const oppTitle = opponent ? titleForRating(opponent.rating ?? 0) : null;
  const opponentOnline = room?.player2_id ? onlineIds.has(room.player2_id) : false;
  const onlineFriendsCount = friends.filter((f) => onlineIds.has(f.id)).length;

  return (
    <div>
      {/* 顶栏:左"返回"/ 右"更多"。退出房间/收起邀请面板这个动作已经绑在
          Telegram 自带的返回键上(见下面 useTelegramBackButton(handleTopBack)),
          所以在 Telegram 环境里不重复画左边的"‹"图标;但在普通浏览器里
          Telegram 的原生返回键不存在,必须把这颗按钮画出来,否则用户没有
          任何办法退出房间。 */}
      <div className="room-topbar fade-in-up" style={isInTelegram ? { justifyContent: "flex-end" } : undefined}>
        {!isInTelegram && (
          <button className="room-icon-btn" onClick={handleTopBack} aria-label="返回">
            <IconChevronLeft />
          </button>
        )}
        <button className="room-icon-btn" onClick={handleShare} disabled={!room?.code} aria-label="更多操作">
          <IconMoreHorizontal />
        </button>
      </div>
      {copiedFlash && <div className="room-toast fade-in-up">邀请链接已复制</div>}
      {promotedFlash && <div className="room-toast fade-in-up">对方已离开,你已成为房主</div>}

      {/* 标题区:两侧小菱形装饰章 + 印章感标题,下方一条分隔线(中间嵌一个
          鎏金小点)再接一行"五子棋 · 标准模式"的模式说明。
          进了邀请好友这个子面板之后就不再需要——房间是哪个、什么模式,
          用户点进来那一下已经看过了,这里再占一截高度只会把下面真正
          要操作的好友列表往下挤,所以邀请面板打开时直接不渲染这块。 */}
      {!inviting && (
        <div className="room-title-wrap fade-in-up" style={{ animationDelay: "40ms" }}>
          <div className="room-title-row">
            <IconDiamondOutline size={11} />
            <h1 className="room-title-text">对局房间</h1>
            <IconDiamondOutline size={11} />
          </div>
          <div className="room-title-divider" />
          <p className="room-subtitle">五子棋 · 标准模式</p>
        </div>
      )}

      {/* VS 对阵区:双方头像 + 六边形等级徽章 + 昵称 + 段位胶囊 + 在线状态,
          中间是水墨飞白风格的 VS 徽章。邀请面板打开时切换成紧凑条
          (.vs-row-compact 收窄头像、隐去段位胶囊和在线文字这些次要信息),
          只保留"谁 vs 谁"这一眼状态,把空间让给下面的好友列表 */}
      <div className={`vs-row fade-in-up${inviting ? " vs-row-compact" : ""}`} style={{ animationDelay: "80ms" }}>
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

      {(!hasOpponent || awaitingRematch) && !inviting && (
        <>
          <button
            className="room-action-primary fade-in-up"
            style={{ animationDelay: "120ms" }}
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
            className="room-action-invite fade-in-up"
            style={{ animationDelay: "160ms" }}
            disabled={!roomId}
            onClick={handleOpenInvite}
          >
            <span className="cta-primary-lead">
              <span className="cta-primary-icon"><IconPersonPlus size={17} /></span>
              <span className="cta-primary-text">
                <span className="cta-primary-title">邀请好友</span>
                <span className="cta-primary-sub">INVITE FRIENDS</span>
              </span>
            </span>
            <span className="cta-primary-arrow">
              <IconArrowRight />
            </span>
          </button>

          <button className="friends-bar fade-in-up" style={{ animationDelay: "200ms" }} onClick={handleOpenInvite}>
            <span className="friends-bar-icon"><IconFriends size={18} /></span>
            <span className="friends-bar-text">
              好友在线 <span className="friends-bar-count">{onlineFriendsCount}</span> 人
            </span>
            <span className="friends-bar-link">
              查看全部 <IconChevronRight size={13} />
            </span>
          </button>

          <div className="room-footnote fade-in-up" style={{ animationDelay: "240ms" }}>
            <IconInfoCircle size={13} />
            房间创建后30分钟内未开始对局将自动解散
          </div>
        </>
      )}

      {(!hasOpponent || awaitingRematch) && inviting && (
        <div className="fade-in-up" style={{ marginTop: "var(--space-2)" }}>
          <p className="friend-section-label">好友列表</p>
          {friends.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, marginBottom: "var(--space-2)" }}>还没有好友,可以在下面搜索昵称添加。</p>
          ) : (
            friends.map((f) => (
              <div key={f.id} className="friend-row">
                <div className="friend-row-avatar">
                  {f.avatar_url ? <img src={f.avatar_url} alt="" /> : <IconAvatarFallback size={18} />}
                  <span className={`online-dot${onlineIds.has(f.id) ? " online" : ""}`} />
                </div>
                <div className="friend-row-info">
                  <div className="friend-row-name">{f.display_name || "玩家"}</div>
                  <div className="friend-row-meta">{onlineIds.has(f.id) ? "在线" : "离线"}</div>
                </div>
                <div className="friend-row-actions">
                  <button
                    className="friend-action-btn ghost"
                    disabled={invitedIds.has(f.id)}
                    onClick={() => inviteFriend(f)}
                  >
                    {invitedIds.has(f.id) ? "已邀请" : "邀请"}
                  </button>
                </div>
              </div>
            ))
          )}

          {/* 搜索昵称加好友:想拉的人还不是好友时,当场搜、当场发申请,
              不用先跳去"好友"页——取代了原来的好友码设计 */}
          <p className="friend-section-label">搜索昵称加好友</p>
          <div className="friend-search-box">
            <span className="friend-search-box-icon"><IconSearch size={17} /></span>
            <input
              value={friendQuery}
              onChange={(e) => setFriendQuery(e.target.value)}
              placeholder="输入对方的昵称"
            />
            {friendSearching && <span className="friend-search-box-spinner"><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /></span>}
          </div>

          {friendQuery.trim() && !friendSearching && friendSearchResults.length === 0 && (
            <p className="friend-search-hint">没有找到昵称包含"{friendQuery.trim()}"的玩家</p>
          )}

          {friendSearchResults.map((u) => {
            const isFriend = friends.some((f) => f.id === u.id);
            const isSent = sentFriendRequestIds.has(u.id);
            return (
              <div key={u.id} className="friend-row">
                <div className="friend-row-avatar">
                  {u.avatar_url ? <img src={u.avatar_url} alt="" /> : <IconAvatarFallback size={18} />}
                </div>
                <div className="friend-row-info">
                  <div className="friend-row-name">{u.display_name || "玩家"}</div>
                  <div className="friend-row-meta mono">积分 {u.rating}</div>
                </div>
                <div className="friend-row-actions">
                  <button
                    className="friend-action-btn ghost"
                    disabled={isFriend || isSent}
                    onClick={() => sendFriendRequest(u.id)}
                  >
                    {isFriend ? "已是好友" : isSent ? "已发送" : "加好友"}
                  </button>
                </div>
              </div>
            );
          })}

          {room?.code && (
            <div style={{ marginTop: "var(--space-4)" }}>
              <p className="friend-section-label" style={{ margin: "0 0 var(--space-2)" }}>
                也可以直接分享房间链接,不限于好友
              </p>
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
