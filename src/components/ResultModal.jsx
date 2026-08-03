export default function ResultModal({ result, onRematch, onExit, rematchLoading = false }) {
  if (!result) return null;

  const { outcome, ratingDelta, reason } = result; // 'win' | 'lose' | 'draw'
  const title = outcome === "win" ? "胜局" : outcome === "lose" ? "败局" : "和棋";

  const desc = (() => {
    if (reason === "forfeit") return outcome === "win" ? "对方中途认输离开了。" : "你已选择认输离开。";
    if (reason === "disconnect") return outcome === "win" ? "对方长时间掉线,判你获胜。" : "你掉线太久,被判负了。";
    if (outcome === "win") return "五子连珠,漂亮的一局。";
    if (outcome === "lose") return "差一点,再来一局找回来。";
    return "棋盘落满,不分胜负。";
  })();

  return (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ textAlign: "center" }}>
        <h2 className="text-heading" style={{ color: outcome === "win" ? "var(--wood)" : outcome === "lose" ? "var(--gold)" : "var(--fg)" }}>
          {title}
        </h2>
        <p className="text-caption" style={{ marginTop: "var(--space-2)" }}>{desc}</p>
        {typeof ratingDelta === "number" && (
          <p className="mono" style={{ marginTop: "var(--space-3)", fontSize: 20, color: ratingDelta > 0 ? "var(--wood)" : ratingDelta < 0 ? "var(--gold)" : "var(--fg-muted)" }}>
            {ratingDelta > 0 ? `+${ratingDelta}` : ratingDelta} 分
          </p>
        )}
        <div style={{ display: "flex", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
          <button className="btn-ghost" style={{ flex: 1 }} onClick={onExit}>返回菜单</button>
          <button className="btn-primary" style={{ flex: 1 }} onClick={onRematch} disabled={rematchLoading}>
            {rematchLoading ? "创建中…" : "再来一局"}
          </button>
        </div>
      </div>
    </div>
  );
}
