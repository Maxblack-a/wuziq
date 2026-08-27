// 点"每日试炼"但还没做过棋风测试(状态不是 completed)时弹出的门槛
// 弹窗——跟 RulesModal / IncomingInviteModal 是同一套 modal-overlay /
// modal-panel 视觉规范。挂在 App.jsx 里,由 navigate() 拦截
// navigate("daily") 触发,不需要哪个具体页面单独关心这件事。
export default function DailyTrialGateModal({ onStartTest, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-heading" style={{ marginBottom: "var(--space-3)" }}>
          先测一下棋风
        </h2>
        <p className="muted" style={{ margin: 0, lineHeight: 1.8, fontSize: 14 }}>
          每日试炼会按你的真实水平匹配对手强度,完成棋风测试后才能进入——
          测完就知道自己大概什么段位,上来就能打得刚刚好,不用瞎猜。
        </p>
        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={onClose}>
            先不测了
          </button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={onStartTest}>
            去测一测
          </button>
        </div>
      </div>
    </div>
  );
}
