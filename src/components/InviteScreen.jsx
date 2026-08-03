import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { shareInviteLink, isInTelegram, useTelegramBackButton } from "../lib/telegram";

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "your_bot";
const APP_SHORT_NAME = import.meta.env.VITE_TELEGRAM_APP_NAME || "gomoku";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看混的字符
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function InviteScreen({ myId, prefillCode, onMatched, onExit }) {
  useTelegramBackButton(onExit);
  const [mode, setMode] = useState(prefillCode ? "join" : "choose"); // choose | create | join
  const [code, setCode] = useState(prefillCode || "");
  const [roomId, setRoomId] = useState(null);
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  async function createRoom() {
    const newCode = randomCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code: newCode, mode: "invite", status: "waiting", player1_id: myId, current_turn: 1 })
      .select()
      .single();

    if (error) { setErrorMsg("创建房间失败,请重试"); return; }
    setCode(newCode);
    setRoomId(data.id); // 触发下面的 useEffect 去订阅这个房间的状态变化
    setMode("create");
  }

  // 等好友加入的订阅放在 useEffect 里管理,这样组件卸载(比如用户点返回)时
  // 能正确调用 removeChannel 清理掉,不会留下没人用的 WebSocket 连接
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`invite-${roomId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => { if (payload.new.status === "playing") onMatchedRef.current(roomId); }
      ).subscribe();

    return () => supabase.removeChannel(channel);
  }, [roomId]);

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

  if (mode === "choose") {
    return (
      <div>
        <button className="btn-ghost" onClick={onExit}>← 返回</button>
        <div className="menu-header">
          <h2>邀请好友</h2>
        </div>
        <div className="mode-list">
          <button className="mode-card" onClick={createRoom}>
            <div className="icon">➕</div>
            <div><div className="title">创建房间</div><div className="desc">生成邀请码,分享给好友</div></div>
          </button>
          <button className="mode-card" onClick={() => setMode("join")}>
            <div className="icon">🔑</div>
            <div><div className="title">输入房间号</div><div className="desc">加入好友创建的对局</div></div>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div>
        <button className="btn-ghost" onClick={onExit}>← 返回</button>
        <div className="menu-header"><h2>等待好友加入</h2></div>
        <div className="room-code-display mono">{code}</div>
        <button
          className="btn-primary"
          style={{ width: "100%" }}
          onClick={handleShare}
        >
          {copiedFlash ? "已复制到剪贴板 ✓" : isInTelegram ? "分享邀请链接" : "复制邀请链接"}
        </button>
        <p className="muted" style={{ textAlign: "center", marginTop: 16 }}>
          <span className="spinner" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 8 }} />
          对方加入后自动开局
        </p>
      </div>
    );
  }

  const [copiedFlash, setCopiedFlash] = useState(false);

  async function handleShare() {
    const result = await shareInviteLink(`room_${code}`, BOT_USERNAME, APP_SHORT_NAME);
    if (result.copied) {
      setCopiedFlash(true);
      setTimeout(() => setCopiedFlash(false), 2000);
    }
  }

  if (mode === "join" && prefillCode && !errorMsg) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <div className="spinner" style={{ margin: "0 auto 20px" }} />
        <p className="muted">正在加入房间 {prefillCode}…</p>
      </div>
    );
  }

  return (
    <div>
      <button className="btn-ghost" onClick={onExit}>← 返回</button>
      <div className="menu-header"><h2>输入房间号</h2></div>
      <input
        className="mono"
        value={code}
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
