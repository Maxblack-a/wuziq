import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { shareInviteLink, isInTelegram, useTelegramBackButton } from "../lib/telegram";

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "your_bot";
const APP_SHORT_NAME = import.meta.env.VITE_TELEGRAM_APP_NAME || "gomoku";

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function FriendsScreen({ myId, myFriendCode, onMatched, onExit }) {
  useTelegramBackButton(onExit);
  const [friends, setFriends] = useState([]);
  const [invites, setInvites] = useState([]);
  const [codeInput, setCodeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(null); // { friendId, friendName }
  const inviteChannelsRef = useRef([]); // 邀请好友时开的临时订阅,组件卸载要统一清理,避免连接泄漏

  useEffect(() => {
    return () => inviteChannelsRef.current.forEach(c => supabase.removeChannel(c));
  }, []);

  const [copiedFlash, setCopiedFlash] = useState(false);

  async function handleShareFriendCode() {
    const result = await shareInviteLink(`friend_${myFriendCode}`, BOT_USERNAME, APP_SHORT_NAME);
    if (result.copied) {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2000);
    }
  }

  async function loadFriends() {
    const { data } = await supabase
      .from("friendships")
      .select("friend_id, profiles:friend_id(id, display_name, rating, avatar_url)")
      .eq("user_id", myId);
    setFriends((data || []).map(r => r.profiles).filter(Boolean));
  }

  async function loadInvites() {
    const { data } = await supabase
      .from("game_invites")
      .select("id, room_id, status, profiles:from_id(display_name)")
      .eq("to_id", myId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setInvites(data || []);
  }

  useEffect(() => {
    loadFriends();
    loadInvites();

    const channel = supabase
      .channel(`invites-${myId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "game_invites", filter: `to_id=eq.${myId}` },
        () => loadInvites()
      ).subscribe();

    return () => supabase.removeChannel(channel);
  }, [myId]);

  const [successMsg, setSuccessMsg] = useState("");

  async function handleAddFriend() {
    if (codeInput.length < 6) return;
    setBusy(true);
    setErrorMsg("");
    setSuccessMsg("");
    const { data, error } = await supabase.rpc("add_friend_by_code", {
      my_id: myId, target_code: codeInput,
    });
    setBusy(false);
    if (error || data?.error) {
      setErrorMsg(data?.error || "添加失败,请重试");
      return;
    }
    setCodeInput("");
    setSuccessMsg(`已添加 ${data?.display_name || "好友"}`);
    setTimeout(() => setSuccessMsg(""), 3000);
    loadFriends();
  }

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
      inviteChannelsRef.current = inviteChannelsRef.current.filter(c => c !== channel);
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

    // 应用内通知已经发出去了,是否还要额外弹 Telegram 分享面板交给用户自己选,
    // 不强制自动弹出——对方是已知好友、已经收到过应用内提示,自动弹分享面板
    // 打断用户体验,像是应用没弄清楚这一步到底要不要分享
  }

  async function shareInviteToFriend() {
    if (!pendingInvite?.code) return;
    await shareInviteLink(`room_${pendingInvite.code}`, BOT_USERNAME, APP_SHORT_NAME);
  }

  async function respondInvite(invite, accept) {
    if (accept) {
      const { data: newRoomId, error } = await supabase.rpc("accept_game_invite", { p_invite_id: invite.id });
      if (error || !newRoomId) {
        setErrorMsg("对局已失效,可能对方已经取消或超时");
        loadInvites();
        return;
      }
      onMatched(newRoomId);
    } else {
      await supabase.from("game_invites").update({ status: "declined" }).eq("id", invite.id);
      loadInvites();
    }
  }

  return (
    <div>
      <button className="btn-ghost" onClick={onExit}>← 返回</button>
      <div className="menu-header"><h2>好友</h2></div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ marginBottom: 8 }}>我的好友码</p>
        <div className="room-code-display mono" style={{ margin: "0 0 12px" }}>{myFriendCode || "------"}</div>
        <button
          className="btn-ghost"
          style={{ width: "100%" }}
          onClick={handleShareFriendCode}
        >
          {copiedFlash ? "已复制到剪贴板 ✓" : isInTelegram ? "分享好友码" : "复制好友链接"}
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ marginBottom: 8 }}>输入好友的码添加</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="mono"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="A3F9K2"
            style={{
              flex: 1, padding: 12, fontSize: 16, textAlign: "center",
              background: "var(--ink)", color: "var(--fg)", border: "1px solid var(--ink-line)",
              borderRadius: "var(--radius-sm)",
            }}
          />
          <button className="btn-primary" disabled={busy || codeInput.length < 6} onClick={handleAddFriend}>添加</button>
        </div>
        {errorMsg && <p style={{ color: "var(--amber)", marginTop: 8 }}>{errorMsg}</p>}
        {successMsg && <p style={{ color: "var(--jade)", marginTop: 8 }}>{successMsg} ✓</p>}
      </div>

      {invites.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p className="muted" style={{ marginBottom: 8 }}>对战邀请</p>
          {invites.map(inv => (
            <div key={inv.id} className="mode-card" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div className="title">{inv.profiles?.display_name || "好友"} 邀请你对战</div>
              </div>
              <button className="btn-primary" style={{ padding: "8px 14px" }} onClick={() => respondInvite(inv, true)}>接受</button>
              <button className="btn-ghost" style={{ padding: "8px 14px" }} onClick={() => respondInvite(inv, false)}>忽略</button>
            </div>
          ))}
        </div>
      )}

      <p className="muted" style={{ marginBottom: 4 }}>好友列表({friends.length}）</p>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>点"邀请对战"会直接在应用内通知对方,不用另外发链接</p>
      {friends.length === 0 && <p className="muted">还没有好友,分享上面的好友码试试。</p>}
      {friends.map(f => (
        <div key={f.id} className="mode-card" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <div className="title">{f.display_name || "玩家"}</div>
            <div className="desc mono">积分 {f.rating}</div>
          </div>
          {pendingInvite?.friendId === f.id ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />等待中
              </span>
              <button className="btn-ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={shareInviteToFriend}>
                分享链接
              </button>
            </span>
          ) : (
            <button
              className="btn-primary"
              style={{ padding: "8px 14px" }}
              disabled={!!pendingInvite}
              onClick={() => inviteFriendToGame(f.id, f.display_name)}
            >
              邀请对战
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
