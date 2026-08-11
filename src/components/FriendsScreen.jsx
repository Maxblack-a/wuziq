import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { IconAvatarFallback, IconSearch, IconChevronLeft } from "./Icons";

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// 加好友的方式:搜索对方昵称 → 发送好友申请 → 对方同意 → 双方互为好友。
// 原来那套"好友码"已经整个去掉了。
//
// 收到的好友申请、对战邀请不在这个页面里处理了——改成了 App.jsx 里全局的
// 强制弹窗(IncomingFriendRequestModal / IncomingInviteModal),不管停在
// 哪个页面,一来就弹出来,必须点同意/拒绝才能关掉,不会被漏掉、也不用
// 专门跑来这个页面才能看到,所以这里不用再重复展示一份列表。
export default function FriendsScreen({ myId, onMatched, onExit }) {
  useTelegramBackButton(onExit);
  const [friends, setFriends] = useState([]);
  const [sentRequestIds, setSentRequestIds] = useState(new Set()); // 我已经发出去、对方还没处理的申请
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [pendingInvite, setPendingInvite] = useState(null); // { friendId, friendName }
  const inviteChannelsRef = useRef([]); // 邀请好友对战时开的临时订阅,组件卸载要统一清理,避免连接泄漏

  useEffect(() => {
    return () => inviteChannelsRef.current.forEach((c) => supabase.removeChannel(c));
  }, []);

  async function loadFriends() {
    const { data } = await supabase
      .from("friendships")
      .select("friend_id, profiles:friend_id(id, display_name, rating, avatar_url)")
      .eq("user_id", myId);
    setFriends((data || []).map((r) => r.profiles).filter(Boolean));
  }

  async function loadSentRequests() {
    const { data } = await supabase
      .from("friend_requests")
      .select("to_id")
      .eq("from_id", myId)
      .eq("status", "pending");
    setSentRequestIds(new Set((data || []).map((r) => r.to_id)));
  }

  useEffect(() => {
    if (!myId) return;
    loadFriends();
    loadSentRequests();

    // 我发出去的申请被对方同意/拒绝了——刷新"已发送"状态和好友列表,
    // 不然按钮会一直卡在"已发送"、搜索结果也不会变成"已是好友"
    const sentChannel = supabase
      .channel(`friend-requests-sent-${myId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "friend_requests", filter: `from_id=eq.${myId}` },
        (payload) => {
          if (payload.new.status !== "pending") {
            loadSentRequests();
            if (payload.new.status === "accepted") loadFriends();
          }
        }
      ).subscribe();

    return () => supabase.removeChannel(sentChannel);
  }, [myId]);

  // 搜昵称:防抖 400ms 再查,避免每敲一个字就打一次库
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, rating")
        .ilike("display_name", `%${q}%`)
        .neq("id", myId)
        .limit(20);
      setSearchResults(data || []);
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [query, myId]);

  async function sendFriendRequest(targetId) {
    setErrorMsg("");
    const { data, error } = await supabase.rpc("send_friend_request", { p_to_id: targetId });
    if (error || data?.error) {
      setErrorMsg(data?.error || "申请发送失败,请重试");
      return;
    }
    if (data?.status === "auto_accepted") {
      setSuccessMsg("对方也申请过你,已经直接成为好友啦");
      setTimeout(() => setSuccessMsg(""), 3000);
      loadFriends();
    } else {
      setSentRequestIds((prev) => new Set(prev).add(targetId));
    }
  }

  const friendIdSet = new Set(friends.map((f) => f.id));

  async function inviteFriendToGame(friendId, friendName) {
    const code = randomRoomCode();
    const { data: room, error } = await supabase
      .from("rooms")
      .insert({ code, mode: "invite", status: "waiting", player1_id: myId, current_turn: 1 })
      .select().single();
    if (error) { setErrorMsg("创建对局失败"); return; }

    const { data: invite, error: inviteErr } = await supabase
      .from("game_invites")
      .insert({ from_id: myId, to_id: friendId, room_id: room.id })
      .select().single();
    if (inviteErr) { setErrorMsg("邀请发送失败"); return; }

    setPendingInvite({ friendId, friendName, code });
    setErrorMsg("");

    function cleanup() {
      supabase.removeChannel(channel);
      inviteChannelsRef.current = inviteChannelsRef.current.filter((c) => c !== channel);
    }

    // 同一个 channel 上同时盯两件事:对方接受了(rooms 变成 playing)、
    // 或者对方忽略/拒绝了(game_invites 变成 declined)——两种结果都要有反馈,
    // 不能发出去就没下文,人干等着自己却不知道
    const channel = supabase.channel(`invite-room-${room.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        (payload) => {
          if (payload.new.status !== "waiting") {
            setPendingInvite(null);
            onMatched(room.id);
            cleanup();
          }
        }
      )
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_invites", filter: `id=eq.${invite.id}` },
        (payload) => {
          if (payload.new.status === "declined") {
            setPendingInvite(null);
            setErrorMsg(`${friendName || "对方"} 婉拒了这次邀请`);
            cleanup();
          }
        }
      )
      .subscribe();
    inviteChannelsRef.current.push(channel);
  }

  return (
    <div>
      {/* Telegram 自带的返回键已经接了同一个 onExit(见上面
          useTelegramBackButton),UI 上不用再重复画一份;但普通浏览器里
          没有 Telegram 原生返回键,这里必须补一个,否则用户没法退出。 */}
      {!isInTelegram && (
        <div className="room-topbar" style={{ marginBottom: 4 }}>
          <button className="room-icon-btn" onClick={onExit} aria-label="返回">
            <IconChevronLeft />
          </button>
        </div>
      )}
      <div className="menu-header"><h2>好友</h2></div>

      {/* 搜索昵称加好友——取代原来的好友码 */}
      <p className="friend-section-label">搜索昵称添加好友</p>
      <div className="friend-search-box">
        <span className="friend-search-box-icon"><IconSearch size={17} /></span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入对方的昵称"
        />
        {searching && <span className="friend-search-box-spinner"><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /></span>}
      </div>

      {query.trim() && !searching && searchResults.length === 0 && (
        <p className="friend-search-hint">没有找到昵称包含"{query.trim()}"的玩家</p>
      )}

      {searchResults.map((u) => {
        const isFriend = friendIdSet.has(u.id);
        const isSent = sentRequestIds.has(u.id);
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

      {(errorMsg || successMsg) && (
        <p style={{ color: errorMsg ? "var(--amber)" : "var(--jade)", marginTop: 4, marginBottom: 8, fontSize: 13 }}>
          {errorMsg || `${successMsg} ✓`}
        </p>
      )}

      <p className="friend-section-label">好友列表({friends.length}）</p>
      {friends.length === 0 && <p className="muted" style={{ fontSize: 13 }}>还没有好友,搜索对方昵称添加一个吧。</p>}
      {friends.map((f) => (
        <div key={f.id} className="friend-row">
          <div className="friend-row-avatar">
            {f.avatar_url ? <img src={f.avatar_url} alt="" /> : <IconAvatarFallback size={18} />}
          </div>
          <div className="friend-row-info">
            <div className="friend-row-name">{f.display_name || "玩家"}</div>
            <div className="friend-row-meta mono">积分 {f.rating}</div>
          </div>
          <div className="friend-row-actions">
            {pendingInvite?.friendId === f.id ? (
              <span className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />等待中
              </span>
            ) : (
              <button
                className="friend-action-btn"
                disabled={!!pendingInvite}
                onClick={() => inviteFriendToGame(f.id, f.display_name)}
              >
                邀请对战
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
