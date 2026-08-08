import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useTelegramBackButton } from "../lib/telegram";

// 这个页面现在只剩"用邀请码/邀请链接加入别人的房间"这一件事——
// "建房间邀请好友"已经并到 RoomScreen 里去了,不再重复一份。
// mode: autojoin(带邀请码进来,自动加入) | manualjoin(手动输房间号)
export default function InviteScreen({ myId, prefillCode, onMatched, onExit }) {
  useTelegramBackButton(onExit);
  const [mode, setMode] = useState(prefillCode ? "autojoin" : "manualjoin");
  const [code, setCode] = useState(prefillCode || "");
  const [joining, setJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCode]);

  if (mode === "autojoin" && !errorMsg) {
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
