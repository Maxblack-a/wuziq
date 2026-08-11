export default function RulesModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-heading" style={{ marginBottom: "var(--space-3)" }}>玩法</h2>
        <ul className="text-body" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8, fontSize: 14 }}>
          <li>黑棋先手,双方轮流在棋盘交叉点上落子</li>
          <li>横、竖、斜方向任意一个方向连成 <b>5 颗或以上</b> 同色棋子即获胜</li>
          <li>棋盘 15×15,落满无人获胜则为平局</li>
          <li>联机对战会计入积分(赢一局 +10,输一局 -5,平局不加不减);人机对战不计分,随便练</li>
        </ul>
        <button className="btn-primary" style={{ width: "100%", marginTop: "var(--space-6)" }} onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}
