export default function RulesModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-heading" style={{ marginBottom: "var(--space-3)" }}>玩法</h2>
        <ul className="text-body" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8, fontSize: 14 }}>
          <li>红棋先手,双方轮流走子,吃掉对方棋子或将死对方即可获胜</li>
          <li>帅(将)、仕(士)、相(象)不能出九宫/过河;马走"日"字忌蹩腿;象走"田"字忌塞眼;炮吃子必须隔一子(炮架)</li>
          <li>棋盘 9×10,一方无子可走(被将死或困毙)则负,不区分平局</li>
          <li>联机对战会计入经验值(赢一局 +10,输一局 +4,平局 +6);人机对战不计分,随便练</li>
        </ul>
        <button className="btn-primary" style={{ width: "100%", marginTop: "var(--space-6)" }} onClick={onClose}>
          知道了
        </button>
      </div>
    </div>
  );
}
