import { useState } from "react";
import RulesModal from "./RulesModal";
import HeroBoard from "./HeroBoard";
import { IconFriends, IconTrophy, IconProfile, IconRobot, IconLink } from "./Icons";

export default function MainMenu({ onSelect, playerName, rating }) {
  const [showRules, setShowRules] = useState(false);

  return (
    <div>
      {/* 顶部轻量入口:图标+极小文字,不用按钮边框,不跟品牌区抢视觉重量 */}
      <nav className="top-nav-light">
        <button className="nav-icon-btn" onClick={() => setShowRules(true)} aria-label="玩法规则">
          <span className="nav-icon-circle">?</span>
          <span>规则</span>
        </button>
        <button className="nav-icon-btn" onClick={() => onSelect("friends")}>
          <IconFriends />
          <span>好友</span>
        </button>
        <button className="nav-icon-btn" onClick={() => onSelect("leaderboard")}>
          <IconTrophy />
          <span>排行榜</span>
        </button>
        <button className="nav-icon-btn" onClick={() => onSelect("profile")}>
          <IconProfile />
          <span>我的</span>
        </button>
      </nav>

      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* 品牌区 */}
      <div className="brand-hero fade-in-up" style={{ animationDelay: "0ms" }}>
        <div className="brand-name">WUZIGIX</div>
        <h1>五子棋</h1>
        <p className="brand-slogan">黑白之间 · 一念胜负</p>
        <p className="muted" style={{ marginTop: "var(--space-2)" }}>
          {playerName ? `欢迎回来,${playerName}` : "连接中…"}
          {typeof rating === "number" && <span className="mono" style={{ color: "var(--wood)", marginLeft: 8 }}>{rating} 分</span>}
        </p>
      </div>

      {/* 品牌核心视觉:静态棋盘展示。入场动效已经在 HeroBoard 组件内部
          精心设计过了(棋盒淡入定住 + 棋子逐颗落下),这里不再额外包一层
          fade-in-up,避免两层动效叠在一起显得乱 */}
      <HeroBoard />

      {/* 主 CTA:开始对局(对应原有的匹配对战入口) */}
      <button className="cta-primary fade-in-up" style={{ animationDelay: "140ms" }} onClick={() => onSelect("matchmaking")}>
        <span className="cta-primary-title">开始对局</span>
        <span className="cta-primary-sub">START MATCH</span>
      </button>

      {/* 次级入口:人机挑战 + 邀请好友,并排、视觉分量低于主CTA */}
      <div className="secondary-row fade-in-up" style={{ animationDelay: "200ms" }}>
        <button className="secondary-card" onClick={() => onSelect("pve")}>
          <div className="secondary-card-icon"><IconRobot /></div>
          <div className="secondary-card-title">人机挑战</div>
          <div className="secondary-card-sub">AI MATCH</div>
          <div className="secondary-card-desc">三档难度</div>
        </button>
        <button className="secondary-card" onClick={() => onSelect("invite")}>
          <div className="secondary-card-icon"><IconLink /></div>
          <div className="secondary-card-title">邀请好友</div>
          <div className="secondary-card-sub">PRIVATE GAME</div>
          <div className="secondary-card-desc">链接直达</div>
        </button>
      </div>
    </div>
  );
}
