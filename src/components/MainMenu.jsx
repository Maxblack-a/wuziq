import { useState } from "react";
import RulesModal from "./RulesModal";

export default function MainMenu({ onSelect, playerName, rating }) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10 }}>
        <button
          className="btn-ghost"
          style={{ padding: "8px 14px", width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowRules(true)}
          aria-label="玩法规则"
        >
          ?
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" style={{ padding: "8px 14px" }} onClick={() => onSelect("friends")}>好友</button>
          <button className="btn-ghost" style={{ padding: "8px 14px" }} onClick={() => onSelect("leaderboard")}>排行榜</button>
          <button className="btn-ghost" style={{ padding: "8px 14px" }} onClick={() => onSelect("profile")}>我的</button>
        </div>
      </div>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      <div className="menu-header">
        <div className="eyebrow">墨 局</div>
        <h1>五子棋</h1>
        <p className="muted">
          {playerName ? `欢迎回来,${playerName}` : "连接中…"}
          {typeof rating === "number" && <span className="mono" style={{ color: "var(--jade)", marginLeft: 8 }}>{rating} 分</span>}
        </p>
      </div>

      <div className="mode-list">
        <button className="mode-card" onClick={() => onSelect("pve")}>
          <div className="icon">🤖</div>
          <div>
            <div className="title">人机对战</div>
            <div className="desc">三档难度,随时可以悔棋练手</div>
          </div>
        </button>

        <button className="mode-card" onClick={() => onSelect("matchmaking")}>
          <div className="icon">🎲</div>
          <div>
            <div className="title">匹配对战</div>
            <div className="desc">自动匹配一位正在等待的玩家</div>
          </div>
        </button>

        <button className="mode-card" onClick={() => onSelect("invite")}>
          <div className="icon">🔗</div>
          <div>
            <div className="title">邀请好友</div>
            <div className="desc">生成一个链接,发给任何人都能加入</div>
          </div>
        </button>
      </div>
    </div>
  );
}
