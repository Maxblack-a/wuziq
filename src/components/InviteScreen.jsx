import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { shareInviteLink, isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { useOnlineUserIds } from "../lib/presence";

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "your_bot";
const APP_SHORT_NAME = import.meta.env.VITE_TELEGRAM_APP_NAME || "gomoku";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看混的字符
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// mode: autojoin(带邀请码进来,自动加入) | host(默认,进来直接建房间) | manualjoin(手动输房间号)
export default function InviteScreen({ myId, prefillCode, onMatched, onExit }) {
  useTelegramBackButton(onExit);
  const [mode, setMode] = useState(prefillCode ? "autojoin" : "host");
  const [code, setCode] = useState(prefillCode || "");
  const [roomId, setRoomId] = useState(null);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedFlash, setCopiedFlash] = useState(false);
  const [friends, setFriends] = useState([]);
  const [invitedIds, setInvitedIds] = useState(new Set());
  const onlineIds = useOnlineUserIds();
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;
  const createdRef = useRef(false); // 防止重复建房间(比如 React 开发模式的双调用)

  async function handleShare() {
    const result = await shareInviteLink(`room_${code}`, BOT_USERNAME, APP_SHORT_NAME);
    if (result.copied) {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2000);
    }
  }

  async function createRoom() {
    const newCode = randomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code: newCode, mode: "invite", status: "waiting", player1_id: myId, current_turn: 1 })
      .select()
      .single();

    if (error) { setErrorMsg("创建房间失败,请重试"); return; }
    setCode(newCode);
    setRoomId(data.id);
  }

  // 进这个页面(不是带邀请码进来的情况下)直接自动建房间,不用先点一次"创建房间"
  useEffect(() => {
    if (mode === "host" && !roomId && !createdRef.current) {
      createdRef.current = true;
      createRoom();
    }
  }, [mode, roomId]);

  // 拉取好友列表,给"直接邀请"用
  useEffect(() => {
    if (mode !== "host" || !myId) return;
    supabase
      .from("friendships")
      .select("friend_id, profiles:friend_id(id, display_name, rating)")
      .eq("user_id", myId)
      .then(({ data }) => setFriends((data || []).map((r) => r.profiles).filter(Boolean)));
  }, [mode, myId]);

  // 等房间状态变成 playing 就自动进对局——不管是对方扫码/点链接加入,
  // 还是从下面好友列表直接邀请、对方点了接受,走的都是同一个房间,这一个订阅就够了
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`invite-${roomId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => { if (payload.new.status !== "waiting") onMatchedRef.current(roomId); }
      ).subscribe();

    return () => supabase.removeChannel(channel);
  }, [roomId]);

  async function inviteFriend(friend) {
    if (!roomId || invitedIds.has(friend.id)) return;
    const { error } = await supabase.from("game_invites").insert({ from_id: myId, to_id: friend.id, room_id: roomId });
    if (error) { setErrorMsg("邀请发送失败"); return; }
    setInvitedIds((prev) => new Set(prev).add(friend.id));
  }

  async function joinRoom(targetCode) {
    setJoining(true);
    setErrorMsg("");
    const { data: id, error } = await supabase.rpc("join_room", {
      room_code: targetCode.toUpperCase().trim(),
      me: myId,
    });
    setJoining(false);
    if (error || !id) {
      setErrorMsg("房间号无效,或者对局已经开始");
      return;
    }
    onMatched(id);
  }

  useEffect(() => {
    if (prefillCode) joinRoom(prefillCode);
  }, [prefillCode]);

  if (mode === "autojoin" && !errorMsg) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div className="spinner" style={{ margin: "0 auto 20px" }} />
        <p className="muted">正在加入房间 {prefillCode}…</p>
      </div>
    );
  }

  if (mode === "manualjoin") {
    return (
      <div>
        <button className="btn-ghost" onClick={() => setMode("host")}>← 返回</button>
        <div className="menu-header"><h2>输入房间号</h2></div>
        <input
          className="mono"
          value={code === prefillCode ? "" : code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="例如 A3F9K2"
          maxLength={6}
          style={{
            width: "100%", padding: 16, fontSize: 22, textAlign: "center",
            background: "var(--ink)", color: "var(--fg)", border: "1px solid var(--ink-line)",
            borderRadius: "var(--radius-md)", marginBottom: 16,
          }}
        />
        {errorMsg && <p style={{ color: "var(--amber)", textAlign: "center" }}>{errorMsg}</p>}
        <button className="btn-primary" style={{ width: "100%" }} disabled={joining || code.length < 6} onClick={() => joinRoom(code)}>
          {joining ? "加入中…" : "加入对局"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <button className="btn-ghost" onClick={onExit}>← 返回</button>
      <div className="menu-header"><h2>邀请好友</h2></div>

      {!roomId ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div className="spinner" style={{ margin: "0 auto" }} />
        </div>
      ) : (
        <>
          <div className="room-code-display mono">{code}</div>
          <button className="btn-primary" style={{ width: "100%" }} onClick={handleShare}>
            {copiedFlash ? "已复制到剪贴板 ✓" : isInTelegram ? "分享邀请链接" : "复制邀请链接"}
          </button>
          <p className="muted" style={{ textAlign: "center", marginTop: 12, fontSize: 13 }}>
            <span className="spinner" style={{ display: "inline-block", verticalAlign: "middle", width: 14, height: 14, borderWidth: 2, marginRight: 6 }} />
            对方加入后自动开局
          </p>

          <p className="muted" style={{ marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>或者直接邀请好友</p>
          {friends.length === 0 && <p className="muted" style={{ fontSize: 13 }}>还没有好友,去"好友"页面添加一个吧。</p>}
          {friends.map((f) => (
            <div key={f.id} className="mode-card" style={{ marginBottom: "var(--space-2)" }}>
              <span className={`online-dot${onlineIds.has(f.id) ? " online" : ""}`} />
              <div style={{ flex: 1 }}>
                <div className="title">{f.display_name || "玩家"}</div>
                <div className="desc">{onlineIds.has(f.id) ? "在线" : "离线"}</div>
              </div>
              <button className="btn-ghost" style={{ padding: "8px 14px" }} disabled={invitedIds.has(f.id)} onClick={() => inviteFriend(f)}>
                {invitedIds.has(f.id) ? "已邀请" : "邀请"}
              </button>
            </div>
          ))}

          {errorMsg && <p style={{ color: "var(--amber)", textAlign: "center", marginTop: 8 }}>{errorMsg}</p>}

          <button className="btn-ghost" style={{ width: "100%", marginTop: "var(--space-4)" }} onClick={() => setMode("manualjoin")}>
            已有房间号?输入加入
          </button>
        </>
      )}
    </div>
  );
}
