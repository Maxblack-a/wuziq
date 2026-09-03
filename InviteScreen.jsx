import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { isInTelegram, useTelegramBackButton } from "../lib/telegram";
import { IconChevronLeft } from "./Icons";

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
      <div className="menu-header"><h2>输入房间号</h2></div>
      <input
        className="mono"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="例如 A3F9K2"
        maxLength={6}
        style={{
          width: "100%", padding: 16, fontSize: 22, textAlign: "center",
          background: "var(--wood-soft)", color: "var(--fg)", border: "1px solid var(--ink-line)",
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
