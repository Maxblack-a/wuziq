import { IconAvatarFallback } from "./Icons";

// 全局弹窗:不管当前停在哪个页面,只要有人搜到我、申请加我为好友就弹出来,
// 跟 IncomingInviteModal(对战邀请弹窗)是同一套模式——必须点"同意"或
// "拒绝"才能关掉,没有单独的关闭/叉号,不能靠点击遮罩层跳过不处理。
export default function IncomingFriendRequestModal({ request, busy, onAccept, onDecline }) {
  return (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ textAlign: "center" }}>
        <div className="invite-modal-avatar">
          {request.fromAvatar ? <img src={request.fromAvatar} alt="" /> : <IconAvatarFallback size={30} />}
        </div>
        <h2 className="text-heading" style={{ margin: "var(--space-3) 0 var(--space-1)" }}>
          {request.fromName || "有人"} 申请添加你为好友
        </h2>
        <p className="muted" style={{ marginBottom: "var(--space-4)", fontSize: 13 }}>
          同意后可以互相邀请对战、在好友列表看到对方在线状态
        </p>

        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <button className="btn-ghost" style={{ flex: 1 }} disabled={busy} onClick={onDecline}>
            拒绝
          </button>
          <button className="btn-primary" style={{ flex: 1 }} disabled={busy} onClick={onAccept}>
            {busy ? "处理中…" : "同意"}
          </button>
        </div>
      </div>
    </div>
  );
}
