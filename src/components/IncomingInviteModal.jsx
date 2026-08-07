import { useState } from "react";
import { IconAvatarFallback } from "./Icons";

// 全局弹窗:不管当前停在哪个页面,只要有好友发来对战邀请就弹出来。
// 挂在 App.jsx 最外层(跟具体是哪个 screen 无关),所以在好友页、
// 甚至首页都能收到。回复文字是选填的,不填就是单纯的接受/拒绝。
export default function IncomingInviteModal({ invite, busy, onAccept, onDecline }) {
  const [message, setMessage] = useState("");

  return (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ textAlign: "center" }}>
        <div className="invite-modal-avatar">
          {invite.fromAvatar ? <img src={invite.fromAvatar} alt="" /> : <IconAvatarFallback size={30} />}
        </div>
        <h2 className="text-heading" style={{ margin: "var(--space-3) 0 var(--space-1)" }}>
          {invite.fromName || "好友"} 邀请你对战
        </h2>
        <p className="muted" style={{ marginBottom: "var(--space-4)", fontSize: 13 }}>
          接受后会直接进入对局房间,由对方开局
        </p>

        <textarea
          className="invite-modal-input"
          placeholder="回句话吧,不填也可以"
          maxLength={80}
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-4)" }}>
          <button className="btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={() => onDecline(message.trim() || null)}>
            拒绝
          </button>
          <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={() => onAccept(message.trim() || null)}>
            {busy ? "处理中…" : "接受"}
          </button>
        </div>
      </div>
    </div>
  );
}
